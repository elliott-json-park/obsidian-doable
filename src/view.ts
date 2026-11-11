/*
 * The agenda. One column, read top to bottom: what is late, what is today,
 * what is coming, and the tasks with no day at all. A line at the top adds a
 * task in plain words. Nothing here needs a query or a setting to be useful.
 */

import { ItemView, Platform, setIcon, WorkspaceLeaf } from 'obsidian';
import { addDays, Day, today } from './dates';
import type { Item } from './index';
import { plural, t } from './i18n';
import type DoablePlugin from './main';
import { parseQuickAdd, Parsed } from './nlp';
import { noteName, renderRow } from './rows';
import { whenField, whenOf } from './task';
import { dayHeading, dayLabel, longToday, repeatLabel, upcomingDays } from './words';

export const VIEW_TYPE = 'doable-agenda';

type SectionId = 'overdue' | 'today' | 'later' | 'anytime' | 'done' | `day:${string}`;

interface Section {
  id: SectionId;
  title: string;
  items: Item[];
  /** Where a dropped task goes; undefined means drops are not allowed. */
  drop?: Day | null;
  foldable: boolean;
  showDay: boolean;
  tone?: 'late' | 'today';
}

/* A long section shows its first rows; the rest are a click away. */
const SECTION_LIMIT = 40;

const ORDER = (a: Item, b: Item) =>
  b.priority - a.priority
  || (whenOf(a) ?? '9999').localeCompare(whenOf(b) ?? '9999')
  || a.path.localeCompare(b.path)
  || a.line - b.line;

export class AgendaView extends ItemView {
  private head!: HTMLElement;
  private sub!: HTMLElement;
  private input!: HTMLInputElement;
  private preview!: HTMLElement;
  private searchEl!: HTMLInputElement;
  private list!: HTMLElement;
  private query = '';
  private holdUntil = 0;
  private holdTimer: number | null = null;
  private rendered = false;
  /** A just-added task, to point it out when it arrives. */
  private fresh: string | null = null;
  /** Sections opened past their first rows. */
  private expanded = new Set<string>();

  constructor(leaf: WorkspaceLeaf, private plugin: DoablePlugin) {
    super(leaf);
  }

  getViewType(): string { return VIEW_TYPE; }
  getDisplayText(): string { return t('name'); }
  getIcon(): string { return 'circle-check-big'; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass('dbl-view');
    this.plugin.askForStar();

    const top = root.createDiv({ cls: 'dbl-top' });
    const titles = top.createDiv({ cls: 'dbl-titles' });
    this.head = titles.createDiv({ cls: 'dbl-title' });
    this.sub = titles.createDiv({ cls: 'dbl-sub' });
    const find = top.createEl('button', { cls: 'dbl-icon clickable-icon', attr: { 'aria-label': t('search.placeholder') } });
    setIcon(find, 'search');

    const add = root.createDiv({ cls: 'dbl-add' });
    setIcon(add.createSpan({ cls: 'dbl-add-icon' }), 'plus');
    this.input = add.createEl('input', { cls: 'dbl-add-input', attr: { type: 'text', placeholder: t('add.placeholder'), 'aria-label': t('command.add'), enterkeyhint: 'done' } });
    this.preview = root.createDiv({ cls: 'dbl-preview' });
    this.input.addEventListener('input', () => this.showPreview());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); void this.addTask(); }
      if (e.key === 'Escape') { this.input.value = ''; this.showPreview(); }
    });

    this.searchEl = root.createEl('input', { cls: 'dbl-search', attr: { type: 'search', placeholder: t('search.placeholder') } });
    this.searchEl.hide();
    find.addEventListener('click', () => {
      const on = !this.searchEl.isShown();
      this.searchEl.toggle(on);
      find.toggleClass('is-active', on);
      if (on) this.searchEl.focus();
      else { this.searchEl.value = ''; this.query = ''; this.render(); }
    });
    this.searchEl.addEventListener('input', () => { this.query = this.searchEl.value.trim().toLowerCase(); this.render(); });

    this.list = root.createDiv({ cls: 'dbl-list', attr: { role: 'list' } });
    this.list.addEventListener('keydown', e => this.keys(e));

    this.registerEvent(this.plugin.index.on('update', () => this.refresh()));
    /* The day changes at midnight even when nothing else does. */
    this.registerInterval(window.setInterval(() => this.render(), 60_000));
    this.render();
    await Promise.resolve();
  }

  async onClose(): Promise<void> {
    if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
    await Promise.resolve();
  }

  focusAdd(): void {
    this.input.focus();
  }

  /** Lets a completed row finish its animation before the list moves. */
  hold(ms: number): void {
    this.holdUntil = Math.max(this.holdUntil, Date.now() + ms);
  }

  refresh(): void {
    const wait = this.holdUntil - Date.now();
    if (wait > 0) {
      if (this.holdTimer !== null) window.clearTimeout(this.holdTimer);
      this.holdTimer = window.setTimeout(() => { this.holdTimer = null; this.render(); }, wait);
      return;
    }
    this.render();
  }

  /* ---------------------------------------------------------- quick add */

  private parsed(): Parsed {
    return parseQuickAdd(this.input.value, { today: today(), weekStart: this.plugin.weekStart() });
  }

  private showPreview(): void {
    this.preview.empty();
    const text = this.input.value.trim();
    this.preview.toggleClass('is-on', text.length > 0);
    if (!text) return;
    const p = this.parsed();
    if (p.due) this.chip('calendar', dayLabel(p.due, today(), true), 'is-date');
    if (p.recurrence) this.chip('repeat', repeatLabel(p.recurrence), 'is-repeat');
    if (p.priority !== 2) this.chip('flag', t(`priority.${p.priority}` as 'priority.4'), 'is-priority');
    const into = this.preview.createSpan({ cls: 'dbl-preview-into', text: t('add.into', { note: this.plugin.actions.targetName() }) });
    into.setAttr('aria-live', 'polite');
  }

  private chip(icon: string, text: string, cls: string): void {
    const c = this.preview.createSpan({ cls: `dbl-pill ${cls}` });
    setIcon(c.createSpan({ cls: 'dbl-pill-icon' }), icon);
    c.createSpan({ text });
  }

  private async addTask(): Promise<void> {
    const p = this.parsed();
    if (!p.description) { this.plugin.toast(t('add.empty')); return; }
    const { file, line, undo } = await this.plugin.actions.add({ description: p.description, due: p.due, recurrence: p.recurrence, priority: p.priority });
    this.fresh = `${file.path}\u0000${line}`;
    this.input.value = '';
    this.showPreview();
    this.plugin.toast(t('add.done', { note: noteName(file.path) }), () => { void this.plugin.actions.removeAdded(undo); });
  }

  /* ------------------------------------------------------------ sections */

  private sections(items: Item[]): Section[] {
    const now = today();
    const days = this.plugin.settings.days;
    const open = items.filter(i => i.status === 'todo' || i.status === 'doing');
    const overdue = open.filter(i => i.due !== null && i.due < now);
    const rest = open.filter(i => !(i.due !== null && i.due < now));
    const todayItems = rest.filter(i => { const w = whenOf(i); return w !== null && w <= now; });
    const out: Section[] = [];
    if (overdue.length) out.push({ id: 'overdue', title: t('section.overdue'), items: overdue.sort(ORDER), foldable: false, showDay: true, tone: 'late' });
    out.push({ id: 'today', title: t('section.today'), items: todayItems.sort(ORDER), drop: now, foldable: false, showDay: false, tone: 'today' });
    for (const d of upcomingDays(days, now)) {
      const these = rest.filter(i => whenOf(i) === d).sort(ORDER);
      out.push({ id: `day:${d}`, title: dayHeading(d, now), items: these, drop: d, foldable: false, showDay: false });
    }
    const horizon = addDays(now, days);
    const later = rest.filter(i => { const w = whenOf(i); return w !== null && w > horizon; })
      .sort((a, b) => (whenOf(a) ?? '').localeCompare(whenOf(b) ?? '') || ORDER(a, b));
    if (later.length) out.push({ id: 'later', title: t('section.later'), items: later, foldable: true, showDay: true });
    const anytime = rest.filter(i => whenOf(i) === null).sort(ORDER);
    out.push({ id: 'anytime', title: t('section.anytime'), items: anytime, drop: null, foldable: true, showDay: true });
    const done = items.filter(i => (i.status === 'done' && i.done === now) || (i.status === 'cancelled' && i.cancelled === now));
    if (done.length) out.push({ id: 'done', title: t('section.done'), items: done.sort(ORDER), foldable: true, showDay: false });
    return out;
  }

  private matches(i: Item): boolean {
    if (!this.query) return true;
    const q = this.query;
    return i.description.toLowerCase().includes(q) || noteName(i.path).toLowerCase().includes(q) || i.tags.some(x => x.toLowerCase().includes(q));
  }

  /* -------------------------------------------------------------- render */

  render(): void {
    const items = this.plugin.index.all().filter(i => this.matches(i));
    const sections = this.sections(items);
    const todayCount = sections.find(s => s.id === 'today')?.items.length ?? 0;
    const late = sections.find(s => s.id === 'overdue')?.items.length ?? 0;
    this.head.setText(longToday());
    const sub = [todayCount ? plural('head.count', todayCount) : t('head.clear')];
    if (late) sub.push(t('head.overdue', { n: late }));
    this.sub.setText(sub.join(' · '));
    this.sub.toggleClass('is-late', late > 0);

    const before = this.measure();
    const focusKey = (document.activeElement as HTMLElement | null)?.closest?.('.dbl-row') ? (document.activeElement as HTMLElement).closest<HTMLElement>('.dbl-row')?.dataset.key : undefined;
    this.list.empty();

    const nothing = sections.every(s => s.items.length === 0);
    if (nothing) {
      const e = this.list.createDiv({ cls: 'dbl-empty' });
      setIcon(e.createDiv({ cls: 'dbl-empty-icon' }), 'circle-check-big');
      e.createDiv({ cls: 'dbl-empty-title', text: this.query ? t('empty.filtered') : t('empty.title') });
      if (!this.query) e.createDiv({ cls: 'dbl-empty-body', text: t('empty.body') });
    }

    const folded = new Set(this.plugin.settings.folded);
    for (const s of sections) {
      if (nothing) break;
      const isDay = s.id.startsWith('day:');
      if (isDay && s.items.length === 0) continue;
      const box = this.list.createDiv({ cls: `dbl-section is-${isDay ? 'day' : s.id}` });
      const head = box.createDiv({ cls: 'dbl-section-head' });
      if (s.tone) head.addClass(`is-${s.tone}`);
      const fold = s.foldable && folded.has(s.id);
      if (s.foldable) {
        const caret = head.createSpan({ cls: 'dbl-caret' });
        setIcon(caret, 'chevron-right');
        head.toggleClass('is-folded', fold);
        head.addClass('is-foldable');
        head.addEventListener('click', () => {
          const set = new Set(this.plugin.settings.folded);
          if (set.has(s.id)) set.delete(s.id); else set.add(s.id);
          this.plugin.settings.folded = Array.from(set);
          void this.plugin.saveSettings();
          this.render();
        });
      }
      head.createSpan({ cls: 'dbl-section-title', text: s.title });
      if (s.items.length) head.createSpan({ cls: 'dbl-section-count', text: String(s.items.length) });
      if (s.drop !== undefined) this.dropTarget(head, s.drop);

      if (fold) continue;
      if (s.id === 'today' && s.items.length === 0) {
        box.createDiv({ cls: 'dbl-section-empty', text: t('head.clear') });
        continue;
      }
      const rows = box.createDiv({ cls: 'dbl-rows' });
      const shown = this.expanded.has(s.id) ? s.items : s.items.slice(0, SECTION_LIMIT);
      for (const item of shown) {
        const row = renderRow(rows, item, this.plugin.rowHost(this), { showDay: s.showDay, showNote: true });
        this.draggable(row, item);
        if (this.fresh && `${item.path}\u0000${item.text}` === this.fresh) {
          row.addClass('is-fresh');
          this.fresh = null;
          window.setTimeout(() => row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 30);
        }
      }
      if (shown.length < s.items.length) {
        const more = box.createEl('button', { cls: 'dbl-more', text: t('list.more', { n: s.items.length - shown.length }) });
        more.addEventListener('click', () => { this.expanded.add(s.id); this.render(); });
      }
    }
    this.animate(before);
    if (focusKey) this.list.querySelector<HTMLElement>(`.dbl-row[data-key="${CSS.escape(focusKey)}"]`)?.focus();
    this.rendered = true;
  }

  /* FLIP: rows that stay glide to their new place, new rows fade in. */
  private measure(): Map<string, DOMRect> {
    const m = new Map<string, DOMRect>();
    if (!this.rendered || this.plugin.reduced()) return m;
    this.list.querySelectorAll<HTMLElement>('.dbl-row').forEach(r => m.set(stable(r.dataset.key ?? ''), r.getBoundingClientRect()));
    return m;
  }

  private animate(before: Map<string, DOMRect>): void {
    if (before.size === 0) return;
    const rows = Array.from(this.list.querySelectorAll<HTMLElement>('.dbl-row')).map(r => ({ r, now: r.getBoundingClientRect() }));
    if (rows.length > 120) return;
    for (const { r, now } of rows) {
      const was = before.get(stable(r.dataset.key ?? ''));
      if (!was) {
        r.animate([{ opacity: 0, transform: 'translateY(-4px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        continue;
      }
      const dy = was.top - now.top;
      if (Math.abs(dy) > 1) r.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 320, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
    }
  }

  /* ------------------------------------------------------------ dragging */

  private draggable(row: HTMLElement, item: Item): void {
    if (Platform.isMobile) return;
    row.setAttr('draggable', 'true');
    row.addEventListener('dragstart', e => {
      e.dataTransfer?.setData('text/x-doable', item.key);
      e.dataTransfer?.setData('text/plain', item.text);
      row.addClass('is-dragging');
      this.list.addClass('is-dragging');
    });
    row.addEventListener('dragend', () => { row.removeClass('is-dragging'); this.list.removeClass('is-dragging'); });
  }

  private dropTarget(head: HTMLElement, day: Day | null): void {
    head.addClass('is-drop');
    head.addEventListener('dragover', e => {
      if (!e.dataTransfer?.types.includes('text/x-doable')) return;
      e.preventDefault();
      head.addClass('is-over');
    });
    head.addEventListener('dragleave', () => head.removeClass('is-over'));
    head.addEventListener('drop', e => {
      head.removeClass('is-over');
      const key = e.dataTransfer?.getData('text/x-doable');
      const item = this.plugin.index.all().find(i => i.key === key);
      if (!item) return;
      e.preventDefault();
      void this.plugin.moveTo(item, whenField(item), day);
    });
  }

  /* ------------------------------------------------------------ keyboard */

  private keys(e: KeyboardEvent): void {
    const row = (e.target as HTMLElement).closest<HTMLElement>('.dbl-row');
    const rows = Array.from(this.list.querySelectorAll<HTMLElement>('.dbl-row'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const at = row ? rows.indexOf(row) : -1;
      const next = rows[Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))];
      next?.focus();
      return;
    }
    if (!row) return;
    const item = this.plugin.index.all().find(i => i.key === row.dataset.key);
    if (!item) return;
    if (e.key === ' ' && (e.target as HTMLElement) === row) { e.preventDefault(); this.plugin.toggle(item, row, this); }
    if (e.key === 'Enter' && (e.target as HTMLElement) === row) { e.preventDefault(); this.plugin.open(item); }
  }
}

/* A row keeps its identity while lines above it move. */
function stable(key: string): string {
  const [path, , text] = key.split('\u0000');
  return `${path}\u0000${text}`;
}
