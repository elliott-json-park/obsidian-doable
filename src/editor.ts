/*
 * Inside notes. The task line keeps its Tasks text, but while you are not on
 * that line its fields read as small chips: "Thu, Nov 5", "every week", a
 * priority mark. Click a chip to change it. Put the cursor on the line and the
 * plain text comes back to edit by hand.
 *
 * Typing "@" on a task line offers dates, written as 📅 when picked.
 */

import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder } from '@codemirror/state';
import type { SyntaxNode } from '@lezer/common';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, WidgetType } from '@codemirror/view';
import {
  App, Editor, EditorPosition, EditorSuggest, EditorSuggestContext, EditorSuggestTriggerInfo, editorLivePreviewField,
  MarkdownPostProcessorContext, setIcon, TFile,
} from 'obsidian';
import { addDays, Day, nextWeekday, startOfWeek, today, weekday } from './dates';
import { t } from './i18n';
import type DoablePlugin from './main';
import { parseQuickAdd } from './nlp';
import { editLine, FieldSpan, fieldSpans, parseTask, Priority, TaskFields } from './task';
import { dayLabel, repeatLabel } from './words';

const PRIORITY_ICON: Record<number, string> = { 5: 'chevrons-up', 4: 'chevron-up', 3: 'equal', 1: 'chevron-down', 0: 'chevrons-down' };
const DATE_ICON: Record<string, string> = { due: 'calendar', scheduled: 'calendar-clock', start: 'play', created: 'plus', done: 'check', cancelled: 'x' };

function chipText(s: FieldSpan, now: Day): { text: string; icon: string; tone: string } {
  switch (s.kind) {
    case 'priority': {
      const p = parseTask(`- [ ] x ${s.value}`)?.priority ?? 2;
      return { text: t(`priority.${p}` as 'priority.4'), icon: PRIORITY_ICON[p] ?? 'flag', tone: `p${p}` };
    }
    case 'recurrence': return { text: repeatLabel(s.value), icon: 'repeat', tone: 'repeat' };
    case 'due': case 'scheduled': case 'start': case 'created': case 'done': case 'cancelled': {
      const late = s.kind === 'due' && s.value < now;
      return { text: dayLabel(s.value, now), icon: DATE_ICON[s.kind], tone: late ? 'late' : s.value === now && s.kind !== 'done' ? 'today' : s.kind };
    }
    default: return { text: s.value, icon: 'link', tone: 'quiet' };
  }
}

class ChipWidget extends WidgetType {
  constructor(private span: FieldSpan, private done: boolean, private onClick: (el: HTMLElement) => void) {
    super();
  }

  eq(other: ChipWidget): boolean {
    return other.span.kind === this.span.kind && other.span.value === this.span.value && other.done === this.done;
  }

  toDOM(): HTMLElement {
    const c = chipText(this.span, today());
    const el = createSpan({ cls: `dbl-chip is-${c.tone}${this.done ? ' is-finished' : ''}` });
    setIcon(el.createSpan({ cls: 'dbl-chip-icon' }), c.icon);
    el.createSpan({ text: c.text });
    el.setAttr('aria-label', `${this.span.kind}: ${this.span.value}`);
    el.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); this.onClick(el); });
    return el;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

export function chipExtension(plugin: DoablePlugin) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(u: ViewUpdate): void {
      if (u.docChanged || u.viewportChanged || u.selectionSet || u.startState.field(editorLivePreviewField) !== u.state.field(editorLivePreviewField)) {
        this.decorations = this.build(u.view);
      }
    }

    build(view: EditorView): DecorationSet {
      const b = new RangeSetBuilder<Decoration>();
      if (!plugin.settings.chips || !view.state.field(editorLivePreviewField)) return b.finish();
      const busy = new Set<number>();
      for (const r of view.state.selection.ranges) {
        const a = view.state.doc.lineAt(r.from).number, z = view.state.doc.lineAt(r.to).number;
        for (let n = a; n <= z; n++) busy.add(n);
      }
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          pos = line.to + 1;
          if (busy.has(line.number) || !/\[.\]/.test(line.text) || inCodeOrMeta(view, line.from)) continue;
          const spans = fieldSpans(line.text);
          if (!spans.length) continue;
          const task = parseTask(line.text);
          const finished = task?.status === 'done' || task?.status === 'cancelled';
          for (const s of spans) {
            if (s.kind === 'id' || s.kind === 'dependsOn' || s.kind === 'onCompletion') continue;
            const lineNo = line.number;
            const text = line.text;
            b.add(line.from + s.from, line.from + s.to, Decoration.replace({
              widget: new ChipWidget(s, finished, el => plugin.editChip(view, lineNo, text, s, el)),
            }));
          }
        }
      }
      return b.finish();
    }
  }, { decorations: v => v.decorations });
}

/* Fenced code, front matter and comments show examples, not tasks. */
function inCodeOrMeta(view: EditorView, pos: number): boolean {
  for (let n: SyntaxNode | null = syntaxTree(view.state).resolveInner(pos, 1); n; n = n.parent) {
    if (/codeblock|frontmatter|comment|math/i.test(n.name)) return true;
  }
  return false;
}

/**
 * Rewrites one line of a CodeMirror document through the task format. The line
 * must still read as it did when the chip was drawn; if it moved, it is found
 * by its text, and if that is not certain nothing is written.
 */
export function rewriteLine(view: EditorView, lineNo: number, expected: string, change: Partial<TaskFields> & { mark?: string }): boolean {
  const doc = view.state.doc;
  let at = lineNo <= doc.lines && doc.line(lineNo).text === expected ? lineNo : -1;
  if (at < 0) {
    for (let n = 1; n <= doc.lines; n++) {
      if (doc.line(n).text !== expected) continue;
      if (at > 0) return false;
      at = n;
    }
  }
  if (at < 0) return false;
  const line = doc.line(at);
  const next = editLine(line.text, change);
  if (next !== line.text) view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
  return true;
}

/* ------------------------------------------------------------- reading view */

const READ_RE = /(🔺|⏫|🔼|🔽|⏬)️?|(📅|📆|🗓|⏳|⌛|🛫|➕|✅|❌)️? *(\d{4}-\d{2}-\d{2})|🔁️? *([a-zA-Z0-9, !]+?)(?= *(?:📅|📆|🗓|⏳|⌛|🛫|➕|✅|❌|🏁|🆔|⛔|🔺|⏫|🔼|🔽|⏬|\^|$))/gu;
const TAIL = /^(?:\s+|#[^\s#]+|\^[\w-]+|(?:🔺|⏫|🔼|🔽|⏬|🏁\uFE0F? *[a-zA-Z]+|🆔\uFE0F? *[\w-]+|⛔\uFE0F? *[\w,-]+|(?:📅|📆|🗓|⏳|⌛|🛫|➕|✅|❌)\uFE0F? *\d{4}-\d{2}-\d{2}|🔁\uFE0F? *[a-zA-Z0-9, !]+?)\uFE0F?)*$/u;
const KIND: Record<string, FieldSpan['kind']> = { '📅': 'due', '📆': 'due', '🗓': 'due', '⏳': 'scheduled', '⌛': 'scheduled', '🛫': 'start', '➕': 'created', '✅': 'done', '❌': 'cancelled' };

export function readingChips(el: HTMLElement, _ctx: MarkdownPostProcessorContext, plugin: DoablePlugin): void {
  if (!plugin.settings.chips || plugin.tasksPluginActive()) return;
  el.querySelectorAll<HTMLElement>('li.task-list-item').forEach(li => {
    /* Only this item's own text, not the tasks nested under it. */
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (n.parentElement?.closest('li') === li && !n.parentElement?.closest('code, a') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes: Text[] = [];
    while (walker.nextNode()) nodes.push(walker.currentNode as Text);
    const finished = li.classList.contains('is-checked');
    for (const node of nodes) {
      const text = node.data;
      READ_RE.lastIndex = 0;
      if (!READ_RE.test(text)) continue;
      READ_RE.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let at = 0;
      for (const m of text.matchAll(READ_RE)) {
        const i = m.index ?? 0;
        /* A field in the middle of a sentence is part of the sentence. */
        if (!TAIL.test(text.slice(i + m[0].length))) continue;
        frag.append(text.slice(at, i));
        at = i + m[0].length;
        const span: FieldSpan = m[1] !== undefined
          ? { kind: 'priority', from: 0, to: 0, value: m[1] }
          : m[2] !== undefined
            ? { kind: KIND[m[2]], from: 0, to: 0, value: m[3] }
            : { kind: 'recurrence', from: 0, to: 0, value: m[4].trim() };
        const c = chipText(span, today());
        const chip = createSpan({ cls: `dbl-chip is-${c.tone}${finished ? ' is-finished' : ''}` });
        setIcon(chip.createSpan({ cls: 'dbl-chip-icon' }), c.icon);
        chip.createSpan({ text: c.text });
        chip.setAttr('aria-label', m[0]);
        frag.append(chip);
      }
      frag.append(text.slice(at));
      node.replaceWith(frag);
    }
  });
}

/* ----------------------------------------------------------------- @ dates */

interface DateChoice { label: string; hint: string; day: Day | null; pick?: boolean }

export class DateSuggest extends EditorSuggest<DateChoice> {
  constructor(app: App, private plugin: DoablePlugin) {
    super(app);
  }

  onTrigger(cursor: EditorPosition, editor: Editor, _file: TFile | null): EditorSuggestTriggerInfo | null {
    const line = editor.getLine(cursor.line);
    if (!parseTask(line)) return null;
    const before = line.slice(0, cursor.ch);
    const m = before.match(/(?:^|\s)@([\p{L}\p{N} /-]{0,24})$/u);
    if (!m) return null;
    return { start: { line: cursor.line, ch: cursor.ch - m[1].length - 1 }, end: cursor, query: m[1] };
  }

  getSuggestions(ctx: EditorSuggestContext): DateChoice[] {
    const now = today();
    const ws = this.plugin.weekStart();
    const q = ctx.query.trim();
    const out: DateChoice[] = [];
    if (q) {
      /* "@fri" should work too, though in a sentence "fri" alone is too loose to count. */
      let p = parseQuickAdd(q, { today: now, weekStart: ws });
      if (!p.due) p = parseQuickAdd(`on ${q}`, { today: now, weekStart: ws });
      if (p.due) out.push({ label: dayLabel(p.due, now, true), hint: p.due, day: p.due });
    }
    const base: DateChoice[] = [
      { label: t('when.today'), hint: now, day: now },
      { label: t('when.tomorrow'), hint: addDays(now, 1), day: addDays(now, 1) },
      ...[2, 3, 4, 5, 6].map(n => { const d = addDays(now, n); return { label: dayLabel(d, now), hint: d, day: d }; }),
      { label: t('when.weekend'), hint: nextWeekday(now, 6, weekday(now) === 6), day: nextWeekday(now, 6, weekday(now) === 6) },
      { label: t('when.nextWeek'), hint: addDays(startOfWeek(now, ws), 7), day: addDays(startOfWeek(now, ws), 7) },
    ];
    const ql = q.toLowerCase();
    for (const c of base) if (!ql || c.label.toLowerCase().startsWith(ql)) if (!out.some(o => o.day === c.day)) out.push(c);
    /* "@home" or "@john" is not a date: offer nothing, so Enter stays Enter. */
    if (q && out.length === 0) return [];
    if (!q) out.push({ label: t('suggest.pick'), hint: '', day: null, pick: true });
    return out.slice(0, 10);
  }

  renderSuggestion(c: DateChoice, el: HTMLElement): void {
    el.addClass('dbl-suggest');
    setIcon(el.createSpan({ cls: 'dbl-suggest-icon' }), c.pick ? 'calendar-search' : 'calendar');
    el.createSpan({ cls: 'dbl-suggest-label', text: c.label });
    if (c.hint) el.createSpan({ cls: 'dbl-suggest-hint', text: c.hint });
  }

  selectSuggestion(c: DateChoice): void {
    const ctx = this.context;
    if (!ctx) return;
    const editor = ctx.editor;
    const lineNo = ctx.start.line;
    editor.replaceRange('', ctx.start, ctx.end);
    const trimmed = editor.getLine(lineNo).replace(/\s+$/, '');
    if (trimmed !== editor.getLine(lineNo)) editor.setLine(lineNo, trimmed);
    if (c.pick) {
      const coords = (editor as unknown as { coordsAtPos?: (p: EditorPosition) => { left: number; bottom: number } | null }).coordsAtPos?.(ctx.start);
      this.plugin.pickDateInEditor(editor, lineNo, coords ? { x: coords.left, y: coords.bottom } : { x: window.innerWidth / 2, y: window.innerHeight / 3 });
      return;
    }
    const line = editor.getLine(lineNo).replace(/\s+$/, '');
    editor.setLine(lineNo, editLine(line, { due: c.day }));
  }
}

export function priorityOfValue(v: string): Priority {
  return (parseTask(`- [ ] x ${v}`)?.priority ?? 2);
}
