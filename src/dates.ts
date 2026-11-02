/*
 * Calendar days as plain `YYYY-MM-DD` strings, the same form the task line uses.
 * Arithmetic happens in UTC on purpose: a day is a label, not an instant, so a
 * daylight-saving change can never move a task to the wrong day.
 */

export type Day = string;

const DAY_MS = 86_400_000;

export function isDay(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Today in the local time zone. */
export function today(now: Date = new Date()): Day {
  return fromParts(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export function fromParts(y: number, m: number, d: number): Day {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function toUTC(day: Day): Date {
  return new Date(`${day}T00:00:00Z`);
}

export function fromUTC(d: Date): Day {
  return d.toISOString().slice(0, 10);
}

export function parts(day: Day): { y: number; m: number; d: number } {
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

export function addDays(day: Day, n: number): Day {
  return fromUTC(new Date(toUTC(day).getTime() + n * DAY_MS));
}

/** Adds months, keeping the day of month where it exists and clamping where it does not. */
export function addMonths(day: Day, n: number): Day {
  const { y, m, d } = parts(day);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12), nm = index % 12 + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 is Sunday. */
export function weekday(day: Day): number {
  return toUTC(day).getUTCDay();
}

/** Whole days from a to b. */
export function diffDays(a: Day, b: Day): number {
  return Math.round((toUTC(b).getTime() - toUTC(a).getTime()) / DAY_MS);
}

/** The first day of the week holding `day`. */
export function startOfWeek(day: Day, weekStart: number): Day {
  return addDays(day, -((weekday(day) - weekStart + 7) % 7));
}

/** The next given weekday on or after `from` (or strictly after, with `after`). */
export function nextWeekday(from: Day, target: number, after = false): Day {
  let delta = (target - weekday(from) + 7) % 7;
  if (after && delta === 0) delta = 7;
  return addDays(from, delta);
}

export function minDay(...days: Array<Day | null | undefined>): Day | null {
  let best: Day | null = null;
  for (const d of days) if (d && (best === null || d < best)) best = d;
  return best;
}
