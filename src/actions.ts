/*
 * Every write to a note. Each edit finds its line again before touching it: at
 * the line it was read from if the text still matches, otherwise at the one
 * place in the note with that exact text. If neither holds, nothing is written.
 * Line endings and everything else in the note are left as they were.
 */

import { App, MarkdownView, moment, normalizePath, TFile } from 'obsidian';
import { insertionPoint, splice, Spliced } from './splice';
import { addDays, Day, today } from './dates';
import type { Item } from './index';
import { nextOccurrence, isValidRule } from './recur';
import type { Settings } from './settings';
import { editLine, emptyFields, parseTask, Priority, serializeFields, serializeTask, TaskFields } from './task';
import { t } from './i18n';

export type Outcome = { ok: true; undo: Undo | null; next?: Day | null; badRule?: string } | { ok: false; reason: 'changed' | 'missing' };

/** Enough to put a note back the way an action found it. */
export interface Undo {
  path: string;
  near: number;
  wrote: string[];
  had: string[];
}

export class Actions {
  constructor(private app: App, private settings: () => Settings) {}

  private file(path: string): TFile | null {
    const f = this.app.vault.getAbstractFileByPath(path);
    return f instanceof TFile ? f : null;
  }

  /**
   * Changes a note's text. When the note is open, the change goes through its
   * editor, so unsaved typing is kept and the change can be undone there too.
   */
  private async edit(file: TFile, change: (text: string) => string | null): Promise<void> {
    const view = this.app.workspace.getLeavesOfType('markdown')
      .map(l => l.view)
      .find((v): v is MarkdownView => v instanceof MarkdownView && v.file?.path === file.path);
    if (!view) {
      await this.app.vault.process(file, data => change(data) ?? data);
      return;
    }
    const editor = view.editor;
    const before = editor.getValue();
    const after = change(before);
    if (after === null || after === before) return;
    /* Replace only the stretch that differs, so the cursor and scroll stay put. */
    let head = 0;
    while (head < before.length && head < after.length && before[head] === after[head]) head++;
    let tail = 0;
    while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
    editor.replaceRange(after.slice(head, after.length - tail), editor.offsetToPos(head), editor.offsetToPos(before.length - tail));
  }

  /**
   * Replaces `had` (found near line `near`) with what `make` returns. Returns
   * where it landed, or why it could not.
   */
  async replace(path: string, near: number, had: string[], make: (found: string[]) => string[] | null): Promise<{ at: number; wrote: string[]; had: string[] } | 'changed' | 'missing'> {
    const file = this.file(path);
    if (!file) return 'missing';
    let result: Spliced | null = null;
    await this.edit(file, data => {
      result = splice(data, near, had, make);
      return result ? result.text : null;
    });
    const r = result as Spliced | null;
    return r ? { at: r.at, wrote: r.wrote, had: r.had } : 'changed';
  }

  private async editTask(item: Item, change: (line: string) => string[]): Promise<Outcome> {
    const r = await this.replace(item.path, item.line, [item.text], found => change(found[0]));
    if (typeof r === 'string') return { ok: false, reason: r };
    return { ok: true, undo: { path: item.path, near: r.at, wrote: r.wrote, had: r.had } };
  }

  async undo(u: Undo): Promise<boolean> {
    const r = await this.replace(u.path, u.near, u.wrote, () => u.had);
    return typeof r !== 'string';
  }

  /** Completes an open task, or reopens a finished one. */
  async toggle(item: Item, on: Day = today()): Promise<Outcome> {
    let next: Day | null | undefined;
    let badRule: string | undefined;
    const s = this.settings();
    const out = await this.editTask(item, line => {
      const task = parseTask(line);
      if (!task) return [line];
      if (task.status === 'done' || task.status === 'cancelled') {
        return [editLine(line, { mark: ' ', done: null, cancelled: null })];
      }
      const done = editLine(line, { mark: 'x', done: s.doneDate ? on : task.done });
      /* 🏁 delete: as in Tasks, a finished task removes itself. */
      const keep = task.onCompletion?.toLowerCase() === 'delete' ? [] : [done];
      if (!task.recurrence) return keep;
      const occ = nextOccurrence(task.recurrence, task, on);
      if (!occ) {
        badRule = isValidRule(task.recurrence) ? undefined : task.recurrence;
        return keep;
      }
      next = occ.due ?? occ.scheduled ?? occ.start;
      const again = serializeTask({
        ...task, mark: ' ', status: 'todo', done: null, cancelled: null,
        start: occ.start, scheduled: occ.scheduled, due: occ.due,
        /* As in Tasks: a new occurrence gets today's creation date only when that setting is on. */
        created: s.createdDate ? on : null,
        /* A block id belongs to one line only. */
        block: null,
      });
      return s.nextBelow ? [...keep, again] : [again, ...keep];
    });
    if (out.ok) { out.next = next; out.badRule = badRule; }
    return out;
  }

  async cancel(item: Item, on: Day = today()): Promise<Outcome> {
    return this.editTask(item, line => [editLine(line, { mark: '-', cancelled: on })]);
  }

  async setFields(item: Item, change: Partial<TaskFields>): Promise<Outcome> {
    return this.editTask(item, line => [editLine(line, change)]);
  }

  async setPriority(item: Item, p: Priority): Promise<Outcome> {
    return this.setFields(item, { priority: p });
  }

  /* --------------------------------------------------------------- adding */

  /** Where quick add writes, created if missing. */
  async target(): Promise<TFile> {
    const s = this.settings();
    if (s.target === 'daily') {
      const daily = this.dailyNote();
      if (daily) return this.ensure(daily.path, daily.template);
    }
    return this.ensure(normalizePath(s.inbox || 'Inbox.md'), null);
  }

  targetName(): string {
    const s = this.settings();
    const path = s.target === 'daily' ? this.dailyNote()?.path ?? s.inbox : s.inbox;
    return path.replace(/^.*\//, '').replace(/\.md$/, '');
  }

  private dailyNote(): { path: string; template: string | null } | null {
    const internal = (this.app as unknown as { internalPlugins?: { getPluginById(id: string): { enabled: boolean; instance?: { options?: { folder?: string; format?: string; template?: string } } } | null } }).internalPlugins;
    const daily = internal?.getPluginById('daily-notes');
    if (!daily?.enabled) return null;
    const o = daily.instance?.options ?? {};
    const name = moment().format(o.format || 'YYYY-MM-DD');
    const folder = (o.folder ?? '').replace(/^\/+|\/+$/g, '');
    return { path: normalizePath(`${folder ? folder + '/' : ''}${name}.md`), template: o.template ? normalizePath(o.template.endsWith('.md') ? o.template : `${o.template}.md`) : null };
  }

  private async ensure(path: string, template: string | null): Promise<TFile> {
    const existing = this.file(path);
    if (existing) return existing;
    const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    let body = '';
    const tpl = template ? this.file(template) : null;
    if (tpl) body = await this.app.vault.read(tpl);
    return this.app.vault.create(path, body);
  }

  /** Writes a new task and returns its line. */
  async add(fields: Partial<TaskFields> & { description: string }): Promise<{ file: TFile; line: string; undo: Undo }> {
    const s = this.settings();
    const file = await this.target();
    const task = { ...emptyFields(), ...fields };
    if (s.createdDate) task.created = today();
    if (s.filterTag && !new RegExp(`(^|\\s)${s.filterTag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`, 'i').test(task.description)) {
      task.description = `${task.description} ${s.filterTag}`;
    }
    const line = `- [ ] ${serializeFields(task)}`;
    let at = 0;
    await this.edit(file, data => {
      const crlf = data.includes('\r\n');
      const lines = data.replace(/\r\n/g, '\n').split('\n');
      at = insertionPoint(lines, s.heading);
      if (s.heading && at < 0) {
        while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
        if (lines.length) lines.push('');
        lines.push(`## ${s.heading}`);
        at = lines.length;
      }
      lines.splice(at, 0, line);
      const out = lines.join('\n');
      return crlf ? out.replace(/\n/g, '\r\n') : out;
    });
    return { file, line, undo: { path: file.path, near: at, wrote: [line], had: [] } };
  }

  async removeAdded(u: Undo): Promise<boolean> {
    const r = await this.replace(u.path, u.near, u.wrote, () => []);
    return typeof r !== 'string';
  }

  /** Moves a task's day, keeping the other dates where they are. */
  async reschedule(item: Item, field: 'due' | 'scheduled' | 'start', day: Day | null): Promise<Outcome> {
    return this.setFields(item, { [field]: day } as Partial<TaskFields>);
  }

  async postpone(item: Item, days: number): Promise<Outcome> {
    const d = item.due ?? item.scheduled ?? today();
    return this.reschedule(item, item.due ? 'due' : item.scheduled ? 'scheduled' : 'due', addDays(d < today() ? today() : d, days));
  }
}

export function describeError(reason: 'changed' | 'missing'): string {
  return reason === 'missing' ? t('error.missing') : t('error.changed');
}
