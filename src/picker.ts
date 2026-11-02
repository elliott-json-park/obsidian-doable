/*
 * The date picker: a few one-tap choices, a line you can type a date into, a
 * month to point at, and the repeat rule beside it. One small surface for
 * "when", wherever a date is shown.
 */

import { setIcon } from 'obsidian';
import { addDays, addMonths, Day, daysInMonth, fromParts, nextWeekday, parts, startOfWeek, today, weekday } from './dates';
import { locale, t } from './i18n';
import { parseQuickAdd } from './nlp';
import { dayLabel, repeatLabel } from './words';

export interface PickerResult {
  day?: Day | null;
  repeat?: string | null;
}

export interface PickerOptions {
  day: Day | null;
  repeat: string | null;
  weekStart: number;
  /** Hide the repeat row, for fields other than the task's day. */
  noRepeat?: boolean;
  onPick: (r: PickerResult) => void;
}

const REPEATS: Array<[string | null, () => string]> = [
  [null, () => t('repeat.none')],
  ['every day', () => t('repeat.day')],
  ['every weekday', () => t('repeat.weekday')],
  ['every week', () => t('repeat.week')],
  ['every month', () => t('repeat.month')],
  ['every year', () => t('repeat.year')],
];

let open: DatePicker | null = null;

export class DatePicker {
  private el: HTMLElement;
  private month: Day;
  private grid!: HTMLElement;
  private title!: HTMLElement;
  private typed!: HTMLElement;
  private cleanup: Array<() => void> = [];

  static show(anchor: HTMLElement | { x: number; y: number }, o: PickerOptions): DatePicker {
    open?.close();
    open = new DatePicker(anchor, o);
    return open;
  }

  private constructor(anchor: HTMLElement | { x: number; y: number }, private o: PickerOptions) {
    const p = parts(o.day ?? today());
    this.month = fromParts(p.y, p.m, 1);
    this.el = document.body.createDiv({ cls: 'dbl-picker' });
    this.build();
    this.place(anchor);
    const away = (e: PointerEvent) => { if (!this.el.contains(e.target as Node)) this.close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); this.close(); } };
    window.setTimeout(() => document.addEventListener('pointerdown', away, true), 0);
    document.addEventListener('keydown', key, true);
    this.cleanup.push(() => document.removeEventListener('pointerdown', away, true), () => document.removeEventListener('keydown', key, true));
  }

  close(): void {
    this.cleanup.forEach(f => f());
    this.el.remove();
    if (open === this) open = null;
  }

  private pick(r: PickerResult): void {
    this.close();
    this.o.onPick(r);
  }

  private build(): void {
    const now = today();
    const quick = this.el.createDiv({ cls: 'dbl-picker-quick' });
    const choices: Array<[string, string, Day | null]> = [
      ['sun', t('when.today'), now],
      ['sunrise', t('when.tomorrow'), addDays(now, 1)],
      ['sofa', t('when.weekend'), nextWeekday(now, 6, weekday(now) === 6)],
      ['arrow-right-to-line', t('when.nextWeek'), addDays(startOfWeek(now, this.o.weekStart), 7)],
      ['circle-off', t('when.none'), null],
    ];
    for (const [icon, label, day] of choices) {
      const b = quick.createEl('button', { cls: 'dbl-picker-choice' });
      setIcon(b.createSpan({ cls: 'dbl-picker-icon' }), icon);
      b.createSpan({ text: label });
      if (day) b.createSpan({ cls: 'dbl-picker-hint', text: shortDay(day) });
      if (day === this.o.day) b.addClass('is-on');
      b.addEventListener('click', () => this.pick({ day }));
    }

    const input = this.el.createEl('input', { cls: 'dbl-picker-input', attr: { type: 'text', placeholder: t('when.type'), 'aria-label': t('when.type') } });
    this.typed = this.el.createDiv({ cls: 'dbl-picker-typed' });
    const read = () => parseQuickAdd(input.value, { today: now, weekStart: this.o.weekStart });
    input.addEventListener('input', () => {
      const p = read();
      this.typed.empty();
      if (p.due) {
        this.typed.setText(`${dayLabel(p.due, now, true)}${p.recurrence ? ' · ' + repeatLabel(p.recurrence) : ''}`);
        this.showMonth(p.due);
      }
    });
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const p = read();
      if (p.due) this.pick(p.recurrence && !this.o.noRepeat ? { day: p.due, repeat: p.recurrence } : { day: p.due });
    });

    const head = this.el.createDiv({ cls: 'dbl-picker-head' });
    this.title = head.createSpan({ cls: 'dbl-picker-title' });
    const prev = head.createEl('button', { cls: 'dbl-picker-nav clickable-icon', attr: { 'aria-label': '‹' } });
    setIcon(prev, 'chevron-left');
    const next = head.createEl('button', { cls: 'dbl-picker-nav clickable-icon', attr: { 'aria-label': '›' } });
    setIcon(next, 'chevron-right');
    prev.addEventListener('click', () => this.showMonth(addMonths(this.month, -1)));
    next.addEventListener('click', () => this.showMonth(addMonths(this.month, 1)));
    this.grid = this.el.createDiv({ cls: 'dbl-picker-grid' });
    this.showMonth(this.month);

    if (!this.o.noRepeat) {
      const row = this.el.createDiv({ cls: 'dbl-picker-repeat' });
      setIcon(row.createSpan({ cls: 'dbl-picker-icon' }), 'repeat');
      const select = row.createEl('select', { cls: 'dropdown' });
      const current = this.o.repeat;
      let known = false;
      for (const [rule, label] of REPEATS) {
        const opt = select.createEl('option', { text: label(), value: rule ?? '' });
        if ((rule ?? null) === (current ?? null)) { opt.selected = true; known = true; }
      }
      if (current && !known) select.createEl('option', { text: repeatLabel(current), value: current }).selected = true;
      select.addEventListener('change', () => this.pick({ repeat: select.value || null }));
    }
    window.setTimeout(() => input.focus(), 0);
  }

  private showMonth(day: Day): void {
    const p = parts(day);
    this.month = fromParts(p.y, p.m, 1);
    this.title.setText(new Date(`${this.month}T12:00:00`).toLocaleDateString(locale(), { year: 'numeric', month: 'long' }));
    this.grid.empty();
    const ws = this.o.weekStart;
    for (let i = 0; i < 7; i++) {
      const name = new Date(Date.UTC(2026, 10, 1 + ((ws + i) % 7))).toLocaleDateString(locale(), { weekday: 'narrow', timeZone: 'UTC' });
      this.grid.createSpan({ cls: 'dbl-picker-dow', text: name });
    }
    const lead = (weekday(this.month) - ws + 7) % 7;
    for (let i = 0; i < lead; i++) this.grid.createSpan();
    const now = today();
    for (let d = 1; d <= daysInMonth(p.y, p.m); d++) {
      const date = fromParts(p.y, p.m, d);
      const b = this.grid.createEl('button', { cls: 'dbl-picker-day', text: String(d) });
      if (date === now) b.addClass('is-today');
      if (date === this.o.day) b.addClass('is-on');
      if (date < now) b.addClass('is-past');
      b.addEventListener('click', () => this.pick({ day: date }));
    }
  }

  private place(anchor: HTMLElement | { x: number; y: number }): void {
    const r = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
    const w = this.el.offsetWidth, h = this.el.offsetHeight;
    const vw = window.innerWidth, vh = window.innerHeight;
    let x = Math.min(r.left, vw - w - 8);
    let y = r.bottom + 6;
    if (y + h > vh - 8) y = Math.max(8, r.top - h - 6);
    x = Math.max(8, x);
    this.el.setCssProps({ '--dbl-x': `${x}px`, '--dbl-y': `${y}px` });
  }
}

function shortDay(day: Day): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short' });
}
