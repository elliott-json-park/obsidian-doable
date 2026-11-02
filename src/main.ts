import { Editor, MarkdownView, Notice, Plugin, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { Actions, describeError, Outcome } from './actions';
import { QueryBlock } from './block';
import { Day, today } from './dates';
import { chipExtension, DateSuggest, priorityOfValue, readingChips, rewriteLine } from './editor';
import { TaskIndex, Item } from './index';
import { t } from './i18n';
import { DatePicker } from './picker';
import { RowHost, rowMenu } from './rows';
import { DEFAULTS, DoableSettingTab, Settings } from './settings';
import { editLine, FieldSpan, parseTask, Priority, whenField, whenOf } from './task';
import { AgendaView, VIEW_TYPE } from './view';
import { dayLabel, repeatLabel, weekStartIndex } from './words';

const TASKS_ID = 'obsidian-tasks-plugin';

export default class DoablePlugin extends Plugin {
  settings: Settings = { ...DEFAULTS };
  index!: TaskIndex;
  actions!: Actions;
  private toastEl: HTMLElement | null = null;
  private toastTimer: number | null = null;

  async onload(): Promise<void> {
    this.settings = { ...DEFAULTS, ...(await this.loadData() as Partial<Settings> | null) };
    this.index = new TaskIndex(this.app, () => this.settings);
    this.actions = new Actions(this.app, () => this.settings);

    this.registerView(VIEW_TYPE, leaf => new AgendaView(leaf, this));
    this.addRibbonIcon('circle-check-big', t('name'), () => { void this.openAgenda(); });
    this.addSettingTab(new DoableSettingTab(this.app, this));

    this.addCommand({ id: 'open', name: t('command.open'), callback: () => { void this.openAgenda(); } });
    this.addCommand({ id: 'add', name: t('command.add'), callback: () => { void this.openAgenda(true); } });
    this.addCommand({
      id: 'toggle',
      name: t('command.toggle'),
      editorCheckCallback: (checking, editor) => {
        const line = editor.getLine(editor.getCursor().line);
        if (!parseTask(line)) return false;
        if (!checking) void this.toggleInEditor(editor);
        return true;
      },
    });
    this.addCommand({
      id: 'date',
      name: t('command.date'),
      editorCheckCallback: (checking, editor) => {
        const lineNo = editor.getCursor().line;
        if (!parseTask(editor.getLine(lineNo))) return false;
        if (!checking) {
          const c = (editor as unknown as { coordsAtPos?: (p: { line: number; ch: number }) => { left: number; bottom: number } | null }).coordsAtPos?.(editor.getCursor());
          this.pickDateInEditor(editor, lineNo, c ? { x: c.left, y: c.bottom } : { x: window.innerWidth / 2, y: window.innerHeight / 3 });
        }
        return true;
      },
    });

    this.registerEditorExtension(chipExtension(this));
    this.registerEditorSuggest(new DateSuggest(this.app, this));
    this.registerMarkdownPostProcessor((el, ctx) => readingChips(el, ctx, this));
    this.registerMarkdownCodeBlockProcessor('doable', (source, el, ctx) => ctx.addChild(new QueryBlock(el, source, this, ctx.sourcePath)));

    this.app.workspace.onLayoutReady(() => { void this.start(); });
    this.register(() => { this.toastEl?.remove(); });
  }

  private async start(): Promise<void> {
    await this.importFromTasks();
    /* Tasks draws ```tasks itself; draw it only when Tasks is not there. */
    if (!this.tasksPluginActive()) {
      try {
        this.registerMarkdownCodeBlockProcessor('tasks', (source, el, ctx) => ctx.addChild(new QueryBlock(el, source, this, ctx.sourcePath)));
      } catch {
        /* Another plugin owns the block. */
      }
    }
    this.registerEvent(this.app.metadataCache.on('changed', (file, data, cache) => this.index.onChanged(file, data, cache)));
    this.registerEvent(this.app.vault.on('delete', f => this.index.onDeleted(f.path)));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { if (f instanceof TFile) this.index.onRenamed(f, old); }));
    await this.index.rebuild();
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  tasksPluginActive(): boolean {
    const plugins = (this.app as unknown as { plugins?: { enabledPlugins?: Set<string> } }).plugins;
    return !!plugins?.enabledPlugins?.has(TASKS_ID);
  }

  /** Takes over the Tasks plugin's choices once, so a switch changes nothing. */
  private async importFromTasks(): Promise<void> {
    if (this.settings.importedFromTasks) return;
    this.settings.importedFromTasks = true;
    const path = `${this.app.vault.configDir}/plugins/${TASKS_ID}/data.json`;
    try {
      if (!(await this.app.vault.adapter.exists(path))) { await this.saveSettings(); return; }
      const data = JSON.parse(await this.app.vault.adapter.read(path)) as { globalFilter?: string; setCreatedDate?: boolean; recurrenceOnNextLine?: boolean; setDoneDate?: boolean };
      const took: string[] = [];
      if (data.globalFilter && /^#\S+$/.test(data.globalFilter.trim())) { this.settings.filterTag = data.globalFilter.trim(); took.push(data.globalFilter.trim()); }
      if (data.setCreatedDate) { this.settings.createdDate = true; took.push('➕'); }
      if (data.recurrenceOnNextLine) { this.settings.nextBelow = true; took.push('🔁'); }
      if (data.setDoneDate === false) { this.settings.doneDate = false; took.push('✅'); }
      if (took.length) new Notice(t('settings.imported', { what: took.join(', ') }), 8000);
    } catch {
      /* A settings file we cannot read changes nothing. */
    }
    await this.saveSettings();
  }

  weekStart(): number {
    return weekStartIndex(this.settings.weekStart);
  }

  reduced(): boolean {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  refreshEditors(): void {
    this.app.workspace.updateOptions();
  }

  async openAgenda(focusAdd = false): Promise<void> {
    const { workspace } = this.app;
    let leaf: WorkspaceLeaf | null = workspace.getLeavesOfType(VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    await workspace.revealLeaf(leaf);
    if (focusAdd && leaf.view instanceof AgendaView) leaf.view.focusAdd();
  }

  private agenda(): AgendaView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    return leaf?.view instanceof AgendaView ? leaf.view : null;
  }

  /* ---------------------------------------------------------------- rows */

  rowHost(view: AgendaView | null): RowHost {
    return {
      app: this.app,
      toggle: (item, row) => this.toggle(item, row, view),
      pickDate: (item, anchor) => this.pickDate(item, anchor),
      menu: (item, e) => rowMenu(item, e, {
        open: () => this.open(item),
        date: () => this.pickDate(item, e),
        priority: p => { void this.withUndo(this.actions.setPriority(item, p), `${t('priority.title')}: ${t(`priority.${p}` as 'priority.4')}`); },
        cancel: () => { void this.cancel(item); },
        toggle: () => this.toggle(item, null, view),
      }),
      open: item => this.open(item),
    };
  }

  toggle(item: Item, row: HTMLElement | null, view: AgendaView | null): void {
    const finishing = item.status === 'todo' || item.status === 'doing';
    if (row && finishing) {
      row.addClass('is-completing');
      (view ?? this.agenda())?.hold(this.reduced() ? 0 : 900);
    }
    void this.actions.toggle(item).then(out => {
      if (!out.ok) { row?.removeClass('is-completing'); new Notice(describeError(out.reason)); return; }
      if (out.badRule) new Notice(t('error.rule', { rule: out.badRule }));
      if (!finishing || !out.undo) return;
      const undo = out.undo;
      const msg = out.next ? t('toast.next', { date: dayLabel(out.next) }) : t('toast.done');
      this.toast(msg, () => { void this.actions.undo(undo); });
    });
  }

  private async cancel(item: Item): Promise<void> {
    const out = await this.actions.cancel(item);
    if (!out.ok) { new Notice(describeError(out.reason)); return; }
    const undo = out.undo;
    if (undo) this.toast(t('toast.cancelled'), () => { void this.actions.undo(undo); });
  }

  async moveTo(item: Item, field: 'due' | 'scheduled' | 'start', day: Day | null): Promise<void> {
    const out = await this.actions.reschedule(item, field, day);
    if (!out.ok) { new Notice(describeError(out.reason)); return; }
    const undo = out.undo;
    if (undo) this.toast(day ? t('toast.moved', { date: dayLabel(day) }) : t('when.none'), () => { void this.actions.undo(undo); });
  }

  pickDate(item: Item, anchor: HTMLElement | MouseEvent): void {
    const field = whenField(item);
    DatePicker.show(anchor instanceof HTMLElement ? anchor : { x: anchor.clientX, y: anchor.clientY }, {
      day: whenOf(item),
      repeat: item.recurrence,
      weekStart: this.weekStart(),
      onPick: r => {
        if (r.repeat !== undefined) {
          const change = r.repeat && !whenOf(item) ? { recurrence: r.repeat, due: today() } : { recurrence: r.repeat };
          void this.withUndo(this.actions.setFields(item, change), r.repeat ? repeatLabel(r.repeat) : t('repeat.none'));
          return;
        }
        if (r.day !== undefined) void this.moveTo(item, field, r.day);
      },
    });
  }

  /** Every change from a list can be taken back for a few seconds. */
  private async withUndo(p: Promise<Outcome>, message: string): Promise<void> {
    const out = await p;
    if (!out.ok) { new Notice(describeError(out.reason)); return; }
    const undo = out.undo;
    if (undo) this.toast(message, () => { void this.actions.undo(undo); });
  }

  open(item: Item): void {
    const file = this.app.vault.getAbstractFileByPath(item.path);
    if (!(file instanceof TFile)) { new Notice(t('error.missing')); return; }
    void this.app.workspace.getLeaf(false).openFile(file, { eState: { line: item.line } }).then(() => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (view && view.file?.path === item.path) {
        view.editor.setCursor({ line: item.line, ch: view.editor.getLine(item.line).length });
        view.editor.scrollIntoView({ from: { line: item.line, ch: 0 }, to: { line: item.line, ch: 0 } }, true);
      }
    });
  }

  /* -------------------------------------------------------------- editor */

  private async toggleInEditor(editor: Editor): Promise<void> {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const file = view?.file;
    if (!file) return;
    const line = editor.getCursor().line;
    const text = editor.getLine(line);
    const task = parseTask(text);
    if (!task) return;
    const item: Item = { ...task, path: file.path, line, text, heading: null, key: '' };
    /* Let the editor's own buffer reach the file before rewriting the line. */
    await view.save();
    this.toggle(item, null, null);
  }

  /** A chip in the editor was clicked. */
  editChip(view: EditorView, lineNo: number, line: string, span: FieldSpan, el: HTMLElement): void {
    if (span.kind === 'priority') {
      const current = priorityOfValue(span.value);
      const order: Priority[] = [4, 3, 2, 1, 0, 5];
      const next = order[(order.indexOf(current) + 1) % order.length];
      if (!rewriteLine(view, lineNo, line, { priority: next })) new Notice(t('error.changed'));
      return;
    }
    const task = parseTask(line);
    if (!task) return;
    const field = span.kind === 'recurrence' ? whenField(task) : span.kind;
    if (field !== 'due' && field !== 'scheduled' && field !== 'start' && field !== 'done' && field !== 'created' && field !== 'cancelled') return;
    DatePicker.show(el, {
      day: task[field],
      repeat: task.recurrence,
      weekStart: this.weekStart(),
      noRepeat: field === 'done' || field === 'created' || field === 'cancelled',
      onPick: r => {
        const change = r.repeat !== undefined ? { recurrence: r.repeat } : { [field]: r.day ?? null };
        if (!rewriteLine(view, lineNo, line, change)) new Notice(t('error.changed'));
      },
    });
  }

  pickDateInEditor(editor: Editor, lineNo: number, at: { x: number; y: number }): void {
    const original = editor.getLine(lineNo);
    const task = parseTask(original);
    if (!task) return;
    const field = whenField(task);
    DatePicker.show(at, {
      day: whenOf(task),
      repeat: task.recurrence,
      weekStart: this.weekStart(),
      onPick: r => {
        /* The line may have moved while the picker was open. */
        let n = editor.getLine(lineNo) === original ? lineNo : -1;
        if (n < 0) {
          const hits: number[] = [];
          for (let i = 0; i < editor.lineCount(); i++) if (editor.getLine(i) === original) hits.push(i);
          if (hits.length === 1) n = hits[0];
        }
        if (n < 0) { new Notice(t('error.changed')); return; }
        const next = editLine(original, r.repeat !== undefined ? { recurrence: r.repeat } : { [field]: r.day ?? null });
        if (next !== original) editor.setLine(n, next);
      },
    });
  }

  /* --------------------------------------------------------------- toast */

  /** One quiet message at the bottom, with Undo when there is something to undo. */
  toast(message: string, undo?: () => void): void {
    this.toastEl?.remove();
    if (this.toastTimer !== null) window.clearTimeout(this.toastTimer);
    const el = document.body.createDiv({ cls: 'dbl-toast' });
    setIcon(el.createSpan({ cls: 'dbl-toast-icon' }), 'check');
    el.createSpan({ cls: 'dbl-toast-text', text: message });
    if (undo) {
      const b = el.createEl('button', { cls: 'dbl-toast-undo', text: t('toast.undo') });
      b.addEventListener('click', () => { undo(); el.remove(); });
    }
    this.toastEl = el;
    window.requestAnimationFrame(() => el.addClass('is-on'));
    this.toastTimer = window.setTimeout(() => {
      el.removeClass('is-on');
      window.setTimeout(() => el.remove(), 260);
    }, 5000);
  }
}
