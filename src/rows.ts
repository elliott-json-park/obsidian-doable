/*
 * One task as a row: a round box, the text, and its day. The same row is used
 * in the agenda and in query blocks, so a task looks and behaves the same
 * wherever it shows up.
 */

import { App, Menu, setIcon } from 'obsidian';
import { diffDays, today } from './dates';
import type { Item } from './index';
import { t } from './i18n';
import { whenOf } from './task';
import { dayLabel, repeatLabel } from './words';

export interface RowHost {
  app: App;
  toggle(item: Item, row: HTMLElement): void;
  pickDate(item: Item, anchor: HTMLElement): void;
  menu(item: Item, e: MouseEvent): void;
  open(item: Item): void;
}

export interface RowOptions {
  /** Show the day even when the section already says it. */
  showDay: boolean;
  showNote: boolean;
}

/** Draws inline Markdown in a description without running it as HTML. */
export function renderText(el: HTMLElement, text: string, app: App, sourcePath: string): void {
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]|\[([^\]]+)\]\(([^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|==([^=]+)==|(?<![\w*])\*([^*\s][^*]*)\*(?!\w)|(^|\s)(#[^\s#'"`,;:!?()[\]{}<>]+)/gu;
  let at = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index ?? 0;
    const lead = m[11] ?? '';
    el.appendText(text.slice(at, i) + lead);
    at = i + m[0].length;
    if (m[1] !== undefined) {
      const target = m[1];
      const a = el.createEl('a', { cls: 'internal-link dbl-link', text: m[2] ?? (target.replace(/#.*$/, '') || target) });
      a.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); void app.workspace.openLinkText(target, sourcePath, e.ctrlKey || e.metaKey); });
    } else if (m[3] !== undefined) {
      const a = el.createEl('a', { cls: 'external-link dbl-link', text: m[3], href: m[4] });
      a.setAttr('target', '_blank');
      a.setAttr('rel', 'noopener');
      a.addEventListener('click', e => e.stopPropagation());
    } else if (m[5] !== undefined) el.createEl('code', { text: m[5] });
    else if (m[6] !== undefined || m[7] !== undefined) el.createEl('strong', { text: m[6] ?? m[7] });
    else if (m[8] !== undefined) el.createEl('del', { text: m[8] });
    else if (m[9] !== undefined) el.createEl('mark', { text: m[9] });
    else if (m[10] !== undefined) el.createEl('em', { text: m[10] });
    else if (m[12] !== undefined) el.createSpan({ cls: 'dbl-tag', text: m[12] });
  }
  el.appendText(text.slice(at));
}

export function noteName(path: string): string {
  return path.replace(/^.*\//, '').replace(/\.md$/, '');
}

export function renderRow(parent: HTMLElement, item: Item, host: RowHost, o: RowOptions): HTMLElement {
  const row = parent.createDiv({ cls: 'dbl-row' });
  row.dataset.key = item.key;
  row.setAttr('tabindex', '-1');
  row.setAttr('role', 'listitem');
  const finished = item.status === 'done' || item.status === 'cancelled';
  row.toggleClass('is-done', item.status === 'done');
  row.toggleClass('is-cancelled', item.status === 'cancelled');
  row.toggleClass('is-doing', item.status === 'doing');
  row.dataset.priority = String(item.priority);

  const box = row.createEl('button', { cls: 'dbl-check', attr: { 'aria-label': finished ? t('menu.reopen') : t('menu.complete'), role: 'checkbox', 'aria-checked': String(finished) } });
  const tick = box.createSpan({ cls: 'dbl-check-tick' });
  setIcon(tick, item.status === 'cancelled' ? 'x' : 'check');
  box.addEventListener('click', e => { e.stopPropagation(); host.toggle(item, row); });

  const body = row.createDiv({ cls: 'dbl-body' });
  const text = body.createDiv({ cls: 'dbl-text' });
  renderText(text, item.description || ' ', host.app, item.path);

  const meta: Array<{ icon: string; text: string; cls?: string }> = [];
  if (o.showNote) meta.push({ icon: 'file-text', text: noteName(item.path) });
  if (item.recurrence) meta.push({ icon: 'repeat', text: repeatLabel(item.recurrence) });
  if (meta.length) {
    const m = body.createDiv({ cls: 'dbl-meta' });
    for (const x of meta) {
      const s = m.createSpan({ cls: `dbl-meta-item ${x.cls ?? ''}` });
      setIcon(s.createSpan({ cls: 'dbl-meta-icon' }), x.icon);
      s.createSpan({ text: x.text });
    }
  }

  const when = whenOf(item);
  const now = today();
  const chip = row.createEl('button', { cls: 'dbl-when' });
  if (when) {
    chip.setText(dayLabel(when, now));
    const late = item.due !== null && item.due < now && !finished;
    chip.toggleClass('is-late', late);
    chip.toggleClass('is-soon', !late && diffDays(now, when) <= 1);
    chip.toggleClass('is-quiet', !o.showDay && !late);
    if (item.scheduled && !item.due) chip.addClass('is-scheduled');
  } else {
    setIcon(chip, 'calendar-plus');
    chip.addClass('is-empty');
  }
  chip.setAttr('aria-label', t('menu.date'));
  chip.addEventListener('click', e => { e.stopPropagation(); host.pickDate(item, chip); });

  row.addEventListener('click', e => {
    if ((e.target as HTMLElement).closest('a, button')) return;
    host.open(item);
  });
  row.addEventListener('contextmenu', e => { e.preventDefault(); host.menu(item, e); });
  return row;
}

/** The context menu every row shares. */
export function rowMenu(item: Item, e: MouseEvent, h: {
  open: () => void; date: () => void; priority: (p: 0 | 1 | 2 | 3 | 4 | 5) => void; cancel: () => void; toggle: () => void;
}): void {
  const menu = new Menu();
  const finished = item.status === 'done' || item.status === 'cancelled';
  menu.addItem(i => i.setTitle(finished ? t('menu.reopen') : t('menu.complete')).setIcon(finished ? 'rotate-ccw' : 'check').onClick(h.toggle));
  menu.addItem(i => i.setTitle(t('menu.date')).setIcon('calendar').onClick(h.date));
  menu.addSeparator();
  for (const p of [5, 4, 3, 2, 1, 0] as const) {
    menu.addItem(i => i.setTitle(t(`priority.${p}` as 'priority.5')).setIcon(p === 2 ? 'minus' : p > 2 ? 'arrow-up' : 'arrow-down')
      .setChecked(item.priority === p).onClick(() => h.priority(p)));
  }
  menu.addSeparator();
  menu.addItem(i => i.setTitle(t('menu.open')).setIcon('file-text').onClick(h.open));
  if (!finished) menu.addItem(i => i.setTitle(t('menu.cancel')).setIcon('x').onClick(h.cancel));
  menu.showAtMouseEvent(e);
}
