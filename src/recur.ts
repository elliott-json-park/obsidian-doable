/*
 * Recurrence, computed the way the Tasks plugin computes it, with the same rrule
 * library, so a task completed here gets the same next date it would get there:
 *
 *   - the next date follows the reference date (due, then scheduled, then start),
 *     or the completion day for `when done`;
 *   - every other date moves by the same number of days;
 *   - `every month` from the 31st lands on the last day of a shorter month.
 */

import { RRule } from 'rrule';
import { addDays, Day, diffDays, fromUTC, parts, toUTC } from './dates';

export interface Occurrence {
  start: Day | null;
  scheduled: Day | null;
  due: Day | null;
}

export function referenceOf(o: Occurrence): Day | null {
  return o.due ?? o.scheduled ?? o.start;
}

function parse(rule: string): { options: ReturnType<typeof RRule.parseText>; whenDone: boolean } | null {
  const m = rule.trim().match(/^([a-zA-Z0-9, !]+?)( when done)?$/i);
  if (!m) return null;
  try {
    const options = RRule.parseText(m[1].trim());
    if (!options || options.freq === undefined) return null;
    return { options, whenDone: m[2] !== undefined };
  } catch {
    return null;
  }
}

/** True when the rule is one the recurrence engine understands. */
export function isValidRule(rule: string): boolean {
  return parse(rule) !== null;
}

/** A readable form of the rule, as rrule writes it (`every week on Monday`). */
export function ruleText(rule: string): string {
  const p = parse(rule);
  if (!p) return rule;
  try {
    return new RRule(p.options).toText() + (p.whenDone ? ' when done' : '');
  } catch {
    return rule;
  }
}

/** The dates of the next occurrence, or null when the rule cannot be read or has ended. */
export function nextOccurrence(rule: string, o: Occurrence, doneOn: Day): Occurrence | null {
  const p = parse(rule);
  if (!p) return null;
  const ref = referenceOf(o);
  const base = p.whenDone || ref === null ? doneOn : ref;
  const next = nextAfter(p.options, base);
  if (next === null) return null;
  if (ref === null) return { start: null, scheduled: null, due: null };
  const shift = diffDays(ref, next);
  const move = (d: Day | null) => (d === null ? null : addDays(d, shift));
  return { start: move(o.start), scheduled: move(o.scheduled), due: move(o.due) };
}

function after(options: ReturnType<typeof RRule.parseText>, from: Day): Day | null {
  const rr = new RRule({ ...options, dtstart: toUTC(from) });
  /* The end of `from`, so an occurrence on the day itself does not count. */
  const d = rr.after(new Date(toUTC(from).getTime() + 86_399_999));
  return d ? fromUTC(d) : null;
}

function nextAfter(options: ReturnType<typeof RRule.parseText>, from: Day): Day | null {
  let next = after(options, from);
  if (next === null) return null;
  const text = new RRule(options).toText();
  const month = text.match(/every( \d+)? month(s)?(.*)?/);
  const year = text.match(/every( \d+)? year(s)?(.*)?/);
  let anchor = from;
  /* The 31st does not exist in every month; step back until it does. */
  if (month && !text.includes(' on ')) {
    const n = month[1] ? Number(month[1].trim()) : 1;
    for (let i = 0; i < 4 && next !== null && monthsBetween(anchor, next) > n; i++) {
      anchor = addDays(anchor, -1);
      next = after(options, anchor);
    }
  } else if (year) {
    const n = year[1] ? Number(year[1].trim()) : 1;
    for (let i = 0; i < 4 && next !== null && parts(next).y - parts(anchor).y > n; i++) {
      anchor = addDays(anchor, -1);
      next = after(options, anchor);
    }
  }
  return next;
}

function monthsBetween(a: Day, b: Day): number {
  const pa = parts(a), pb = parts(b);
  return (pb.y - pa.y) * 12 + (pb.m - pa.m);
}
