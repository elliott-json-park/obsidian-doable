/* How days and rules read to a person. */

import { moment } from 'obsidian';
import { addDays, Day, diffDays, parts, today } from './dates';
import { locale, t } from './i18n';
import { ruleText } from './recur';

/** "Today", "Tomorrow", "Thu", "Nov 20", "Nov 20, 2027" or "3 days ago". */
export function dayLabel(day: Day, now: Day = today(), long = false): string {
  const d = diffDays(now, day);
  if (d === 0) return t('day.today');
  if (d === 1) return t('day.tomorrow');
  if (d === -1) return t('day.yesterday');
  if (d < 0 && d > -7 && !long) return t('day.ago', { n: -d });
  const date = new Date(`${day}T12:00:00`);
  const sameYear = parts(day).y === parts(now).y;
  if (d > 1 && d < 7 && !long) return date.toLocaleDateString(locale(), { weekday: 'long' });
  const opts: Intl.DateTimeFormatOptions = long
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric' };
  if (!sameYear) opts.year = 'numeric';
  return date.toLocaleDateString(locale(), opts);
}

/** A day header in the agenda: "Tomorrow · Tue, Nov 3". */
export function dayHeading(day: Day, now: Day = today()): string {
  const d = diffDays(now, day);
  const full = new Date(`${day}T12:00:00`).toLocaleDateString(locale(), { weekday: 'long', month: 'short', day: 'numeric' });
  if (d === 1) return `${t('day.tomorrow')} · ${full}`;
  return full;
}

export function longToday(): string {
  return new Date().toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' });
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** The rule in the reader's language. Rules it cannot phrase stay as written. */
export function repeatLabel(rule: string): string {
  const r = rule.trim().toLowerCase().replace(/\s+/g, ' ');
  const done = / when done$/.test(r);
  const core = r.replace(/ when done$/, '');
  const said = phrase(core);
  if (said === null) return ruleText(rule);
  return done ? `${said} ${t('repeat.whenDone')}` : said;
}

function phrase(r: string): string | null {
  const simple: Record<string, string> = {
    'every day': t('repeat.day'), 'every weekday': t('repeat.weekday'), 'every week': t('repeat.week'),
    'every month': t('repeat.month'), 'every year': t('repeat.year'),
  };
  if (simple[r]) return simple[r];
  const n = r.match(/^every (\d+) (day|week|month|year)s?$/);
  if (n) return t(`repeat.every.${n[2]}` as 'repeat.every.day', { n: n[1] });
  const days = r.match(/^every (?:week on |)((?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)(?:(?:, | and )(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday))*)$/);
  if (days) {
    const names = days[1].split(/, | and /).map(d => weekdayName(WEEKDAYS.indexOf(d)));
    return t('repeat.onDays', { days: names.join(', ') });
  }
  const md = r.match(/^every month on the (\d+)(?:st|nd|rd|th)$/);
  if (md) return t('repeat.monthDay', { n: md[1] });
  if (r === 'every month on the last') return t('repeat.monthLast');
  return null;
}

function weekdayName(i: number): string {
  return new Date(Date.UTC(2026, 10, 1 + i)).toLocaleDateString(locale(), { weekday: 'short', timeZone: 'UTC' });
}

export function weekStartIndex(setting: 'auto' | 'mon' | 'sun'): number {
  if (setting === 'mon') return 1;
  if (setting === 'sun') return 0;
  try {
    const m = moment as unknown as { localeData(): { firstDayOfWeek(): number } };
    return m.localeData().firstDayOfWeek();
  } catch {
    return 1;
  }
}

export function upcomingDays(n: number, now: Day = today()): Day[] {
  return Array.from({ length: n }, (_x, i) => addDays(now, i + 1));
}
