/*
 * Quick add: "Call Ana tomorrow #home every week !high" becomes a task with a
 * due date, a recurrence and a priority. English, Korean and Chinese are read
 * together, whatever the interface language, because people mix them.
 *
 * Every recognised phrase is reported with its position, so the input can show
 * what was understood before anything is written.
 */

import {
  addDays, addMonths, Day, daysInMonth, fromParts, isDay, nextWeekday, parts, startOfWeek,
} from './dates';
import { Priority } from './task';
import { isValidRule } from './recur';
import { allMatches } from './re';

export type PartKind = 'date' | 'repeat' | 'priority';

export interface Part {
  kind: PartKind;
  from: number;
  to: number;
  text: string;
}

export interface Parsed {
  description: string;
  due: Day | null;
  recurrence: string | null;
  priority: Priority;
  parts: Part[];
}

export interface ParseOptions {
  today: Day;
  /** 0 Sunday, 1 Monday. */
  weekStart: number;
}

/* Word edges that also refuse #tags, paths, possessives and hyphenated words.
   The left edge is checked in code (see edgeOk): lookbehind does not run on
   older iOS. */
const L = '';
const R = "(?![\\p{L}\\p{N}_'’/-])";

const EN_DAYS: Record<string, number> = {
  sunday: 0, sun: 0, monday: 1, mon: 1, tuesday: 2, tue: 2, tues: 2, wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4, friday: 5, fri: 5, saturday: 6, sat: 6,
};
const EN_DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const EN_MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const KO_DAYS: Record<string, number> = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
const ZH_DAYS: Record<string, number> = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
const WORD_NUM: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

const FULL_DAY = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
const SHORT_DAY = 'sun|mon|tues?|weds?|thu(?:rs?)?|fri|sat';
const MONTH = Object.keys(EN_MONTHS).sort((a, b) => b.length - a.length).join('|');

type Rule = {
  kind: PartKind;
  re: RegExp;
  read: (m: RegExpMatchArray, o: ParseOptions) => { due?: Day; recurrence?: string; priority?: Priority } | null;
};

const num = (s: string) => WORD_NUM[s.toLowerCase()] ?? Number(s);

/* A date with no year means the next time that date comes round. */
function upcoming(o: ParseOptions, m: number, d: number, y?: number): Day | null {
  if (m < 1 || m > 12 || d < 1) return null;
  let year = y ?? parts(o.today).y;
  if (d > daysInMonth(year, m)) return null;
  let day = fromParts(year, m, d);
  if (y === undefined && day < o.today) {
    year += 1;
    if (d > daysInMonth(year, m)) return null;
    day = fromParts(year, m, d);
  }
  return day;
}

function inUnits(o: ParseOptions, n: number, unit: string): Day {
  if (/^(d|day|일|天)/i.test(unit)) return addDays(o.today, n);
  if (/^(w|week|주|周|星期)/i.test(unit)) return addDays(o.today, n * 7);
  return addMonths(o.today, n);
}

const nextWeek = (o: ParseOptions) => addDays(startOfWeek(o.today, o.weekStart), 7);

const RULES: Rule[] = [
  /* ------------------------------------------------------------- repeats */
  {
    kind: 'repeat',
    re: new RegExp(`${L}every\\s+other\\s+(day|week|month|year)${R}(\\s+when\\s+done)?`, 'giu'),
    read: m => ({ recurrence: `every 2 ${m[1].toLowerCase()}s${m[2] ? ' when done' : ''}` }),
  },
  {
    kind: 'repeat',
    re: new RegExp(`${L}every\\s+(?:(\\d+)\\s+)?(days?|weekdays?|weeks?|months?|years?|${FULL_DAY}|${SHORT_DAY})` +
      `((?:\\s*(?:,|and)\\s*(?:${FULL_DAY}|${SHORT_DAY}))*)` +
      `(\\s+on\\s+(?:the\\s+)?(?:\\d{1,2}(?:st|nd|rd|th)?|last(?:\\s+(?:${FULL_DAY}))?|(?:${FULL_DAY})(?:\\s*,\\s*(?:${FULL_DAY}))*))?` +
      `${R}(\\s+when\\s+done)?`, 'giu'),
    read: m => {
      const n = m[1] ? Number(m[1]) : 1;
      const unit = m[2].toLowerCase();
      const done = m[5] ? ' when done' : '';
      let rule: string;
      if (unit in EN_DAYS) {
        const days = [unit, ...(m[3] ? m[3].split(/\s*(?:,|and)\s*/).map(s => s.trim().toLowerCase()).filter(Boolean) : [])];
        rule = `every week on ${days.map(d => EN_DAY_NAMES[EN_DAYS[d]]).join(', ')}`;
      } else {
        const base = unit.replace(/s$/, '');
        rule = base === 'weekday' ? 'every weekday' : n === 1 ? `every ${base}` : `every ${n} ${base}s`;
        if (m[4]) rule += ' ' + m[4].trim().toLowerCase().replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, w => w[0].toUpperCase() + w.slice(1));
      }
      rule += done;
      return isValidRule(rule) ? { recurrence: rule } : null;
    },
  },
  {
    kind: 'repeat',
    /* Only as the last word: "the daily report" is not a repeat. */
    re: new RegExp(`${L}(daily|weekly|monthly|yearly|annually)${R}(?=\\s*$)`, 'giu'),
    read: m => ({ recurrence: { daily: 'every day', weekly: 'every week', monthly: 'every month', yearly: 'every year', annually: 'every year' }[m[1].toLowerCase()] }),
  },
  { kind: 'repeat', re: /매일|날마다/gu, read: () => ({ recurrence: 'every day' }) },
  { kind: 'repeat', re: /(?:매\s*)?평일마다|매\s*평일/gu, read: () => ({ recurrence: 'every weekday' }) },
  {
    kind: 'repeat',
    re: /매주\s*([월화수목금토일])요일/gu,
    read: m => ({ recurrence: `every week on ${EN_DAY_NAMES[KO_DAYS[m[1]]]}` }),
  },
  { kind: 'repeat', re: /격주/gu, read: () => ({ recurrence: 'every 2 weeks' }) },
  { kind: 'repeat', re: /매주/gu, read: () => ({ recurrence: 'every week' }) },
  {
    kind: 'repeat',
    re: /(?:매월|매달)\s*(\d{1,2})일/gu,
    read: m => ({ recurrence: `every month on the ${ordinal(Number(m[1]))}` }),
  },
  { kind: 'repeat', re: /매월|매달/gu, read: () => ({ recurrence: 'every month' }) },
  { kind: 'repeat', re: /매년|해마다/gu, read: () => ({ recurrence: 'every year' }) },
  { kind: 'repeat', re: /每(?:天|日)/gu, read: () => ({ recurrence: 'every day' }) },
  { kind: 'repeat', re: /每个?工作日/gu, read: () => ({ recurrence: 'every weekday' }) },
  {
    kind: 'repeat',
    re: /每(?:周|星期|个星期)([一二三四五六日天])/gu,
    read: m => ({ recurrence: `every week on ${EN_DAY_NAMES[ZH_DAYS[m[1]]]}` }),
  },
  { kind: 'repeat', re: /每(?:周|星期|个星期)/gu, read: () => ({ recurrence: 'every week' }) },
  {
    kind: 'repeat',
    re: /每(?:个)?月(\d{1,2})[日号]/gu,
    read: m => ({ recurrence: `every month on the ${ordinal(Number(m[1]))}` }),
  },
  { kind: 'repeat', re: /每(?:个)?月/gu, read: () => ({ recurrence: 'every month' }) },
  { kind: 'repeat', re: /每年/gu, read: () => ({ recurrence: 'every year' }) },

  /* -------------------------------------------------------------- dates */
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by|on)\\s+)?(\\d{4}-\\d{2}-\\d{2})${R}`, 'giu'),
    read: m => (isDay(m[1]) ? { due: m[1] } : null),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by|on)\\s+)?(?:the\\s+)?day\\s+after\\s+tomorrow${R}`, 'giu'),
    read: (_m, o) => ({ due: addDays(o.today, 2) }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by)\\s+)?(today|tonight)${R}`, 'giu'),
    read: (_m, o) => ({ due: o.today }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by)\\s+)?(tomorrow|tmrw?)${R}`, 'giu'),
    read: (_m, o) => ({ due: addDays(o.today, 1) }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by)\\s+)?next\\s+week${R}`, 'giu'),
    read: (_m, o) => ({ due: nextWeek(o) }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by)\\s+)?next\\s+month${R}`, 'giu'),
    read: (_m, o) => ({ due: addMonths(fromParts(parts(o.today).y, parts(o.today).m, 1), 1) }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by|on)\\s+(?:the\\s+)?|this\\s+)weekend${R}`, 'giu'),
    read: (_m, o) => ({ due: nextWeekday(o.today, 6) }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by)\\s+)?(?:the\\s+)?end\\s+of\\s+(?:the\\s+)?month${R}`, 'giu'),
    read: (_m, o) => { const p = parts(o.today); return { due: fromParts(p.y, p.m, daysInMonth(p.y, p.m)) }; },
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by)\\s+)?in\\s+(\\d+|an?|one|two|three|four|five|six|seven|eight|nine|ten)\\s+(days?|weeks?|months?)${R}`, 'giu'),
    read: (m, o) => ({ due: inUnits(o, num(m[1]), m[2]) }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by|on)\\s+)?(?:(next|this)\\s+)?(${FULL_DAY})${R}`, 'giu'),
    read: (m, o) => ({ due: weekdayFrom(o, EN_DAYS[m[2].toLowerCase()], m[1]) }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by|on|next|this)\\s+)(${SHORT_DAY})${R}`, 'giu'),
    read: (m, o) => ({ due: weekdayFrom(o, EN_DAYS[m[1].toLowerCase()], /next/i.test(m[0]) ? 'next' : undefined) }),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by|on)\\s+)?(${MONTH})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?${R}`, 'giu'),
    read: (m, o) => dueOrNull(upcoming(o, EN_MONTHS[m[1].toLowerCase()], Number(m[2]), m[3] ? Number(m[3]) : undefined)),
  },
  {
    kind: 'date',
    re: new RegExp(`${L}(?:(?:due|by|on)\\s+)?(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH})\\.?(?:,?\\s+(\\d{4}))?${R}`, 'giu'),
    read: (m, o) => dueOrNull(upcoming(o, EN_MONTHS[m[2].toLowerCase()], Number(m[1]), m[3] ? Number(m[3]) : undefined)),
  },
  {
    kind: 'date',
    /* "1/2 cup" is a fraction; a bare M/D counts only after due, by or on. */
    re: new RegExp(`${L}(?:due|by|on)\\s+(\\d{1,2})/(\\d{1,2})(?:/(\\d{4}))?${R}`, 'giu'),
    read: (m, o) => dueOrNull(upcoming(o, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined)),
  },
  /* Korean */
  { kind: 'date', re: /오늘(?:까지)?/gu, read: (_m, o) => ({ due: o.today }) },
  { kind: 'date', re: /내일(?:까지)?/gu, read: (_m, o) => ({ due: addDays(o.today, 1) }) },
  { kind: 'date', re: /모레(?:까지)?/gu, read: (_m, o) => ({ due: addDays(o.today, 2) }) },
  { kind: 'date', re: /글피(?:까지)?/gu, read: (_m, o) => ({ due: addDays(o.today, 3) }) },
  {
    kind: 'date',
    re: /(이번\s*주|다음\s*주|담주)?\s*([월화수목금토일])요일(?:까지)?/gu,
    read: (m, o) => ({ due: koWeekday(o, KO_DAYS[m[2]], m[1]) }),
  },
  { kind: 'date', re: /(?:다음\s*주|담주)(?:까지)?/gu, read: (_m, o) => ({ due: nextWeek(o) }) },
  { kind: 'date', re: /다음\s*달(?:까지)?/gu, read: (_m, o) => ({ due: addMonths(fromParts(parts(o.today).y, parts(o.today).m, 1), 1) }) },
  { kind: 'date', re: /(?:이번\s*)?주말(?:까지)?/gu, read: (_m, o) => ({ due: nextWeekday(o.today, 6) }) },
  { kind: 'date', re: /이번\s*달\s*말(?:까지)?|월말(?:까지)?/gu, read: (_m, o) => { const p = parts(o.today); return { due: fromParts(p.y, p.m, daysInMonth(p.y, p.m)) }; } },
  {
    kind: 'date',
    re: /(\d+)\s*(일|주|개월|달)\s*(?:후|뒤)(?:까지)?/gu,
    read: (m, o) => ({ due: inUnits(o, Number(m[1]), m[2] === '달' ? '개월' : m[2]) }),
  },
  {
    kind: 'date',
    re: /(?:(\d{4})년\s*)?(\d{1,2})월\s*(\d{1,2})일(?:까지)?/gu,
    read: (m, o) => dueOrNull(upcoming(o, Number(m[2]), Number(m[3]), m[1] ? Number(m[1]) : undefined)),
  },
  /* Chinese */
  { kind: 'date', re: /今天|今日/gu, read: (_m, o) => ({ due: o.today }) },
  { kind: 'date', re: /大后天/gu, read: (_m, o) => ({ due: addDays(o.today, 3) }) },
  { kind: 'date', re: /后天/gu, read: (_m, o) => ({ due: addDays(o.today, 2) }) },
  { kind: 'date', re: /明天|明日/gu, read: (_m, o) => ({ due: addDays(o.today, 1) }) },
  {
    kind: 'date',
    re: /(下|这|本)?(?:个)?(?:周|星期|礼拜)([一二三四五六日天])/gu,
    read: (m, o) => ({ due: zhWeekday(o, ZH_DAYS[m[2]], m[1]) }),
  },
  { kind: 'date', re: /下(?:个)?(?:周|星期|礼拜)/gu, read: (_m, o) => ({ due: nextWeek(o) }) },
  { kind: 'date', re: /下(?:个)?月/gu, read: (_m, o) => ({ due: addMonths(fromParts(parts(o.today).y, parts(o.today).m, 1), 1) }) },
  { kind: 'date', re: /(?:这|本)?周末/gu, read: (_m, o) => ({ due: nextWeekday(o.today, 6) }) },
  {
    kind: 'date',
    re: /(\d+)\s*(天|周|个?月)后/gu,
    read: (m, o) => ({ due: inUnits(o, Number(m[1]), m[2].replace('个', '')) }),
  },
  {
    kind: 'date',
    re: /(?:(\d{4})年)?(\d{1,2})月(\d{1,2})[日号]/gu,
    read: (m, o) => dueOrNull(upcoming(o, Number(m[2]), Number(m[3]), m[1] ? Number(m[1]) : undefined)),
  },

  /* ----------------------------------------------------------- priority */
  {
    kind: 'priority',
    re: /!(highest|high|medium|med|lowest|low|[1-5]|최고|높음|보통|낮음|최저|最高|高|中|低|最低)(?=\s|$)/giu,
    read: m => ({ priority: priorityWord(m[1].toLowerCase()) }),
  },
  {
    kind: 'priority',
    re: /(!!!|!!)(?=\s|$)/gu,
    read: m => ({ priority: m[1] === '!!!' ? 5 : 4 }),
  },
];

/* Korean words carry particles, and the same syllables start other words:
   "내일까지" is a date, "내일로" and "매일경제" are not. */
for (const rule of RULES) {
  if (/[가-힣]/.test(rule.re.source)) {
    rule.re = new RegExp(`(?:${rule.re.source})(?:까지|에|부터)?(?![가-힣])`, rule.re.flags);
  }
}

/** The character before a match must not glue it to the word in front. */
function edgeOk(rule: Rule, before: string): boolean {
  if (before === '') return true;
  if (rule.kind === 'priority') return /\s/.test(before);
  const src = rule.re.source;
  if (/[가-힣]/.test(src)) return !/[가-힣]/.test(before);
  if (/[\u4e00-\u9fff]/.test(src)) return true;
  return !/[\p{L}\p{N}_#/]/u.test(before);
}

function dueOrNull(d: Day | null): { due: Day } | null {
  return d ? { due: d } : null;
}

function ordinal(n: number): string {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${s}`;
}

function priorityWord(w: string): Priority {
  if (['highest', '1', '최고', '最高'].includes(w)) return 5;
  if (['high', '2', '높음', '高'].includes(w)) return 4;
  if (['medium', 'med', '3', '보통', '中'].includes(w)) return 3;
  if (['low', '4', '낮음', '低'].includes(w)) return 1;
  return 0;
}

/* "Friday" means the coming Friday, today included; "next Friday" means the
   one in next week. */
function weekdayFrom(o: ParseOptions, target: number, which?: string): Day {
  if (which && which.toLowerCase() === 'next') {
    return addDays(nextWeek(o), (target - o.weekStart + 7) % 7);
  }
  return nextWeekday(o.today, target);
}

function koWeekday(o: ParseOptions, target: number, which?: string): Day {
  if (which && /다음|담/.test(which)) return addDays(nextWeek(o), (target - o.weekStart + 7) % 7);
  if (which && /이번/.test(which)) return addDays(startOfWeek(o.today, o.weekStart), (target - o.weekStart + 7) % 7);
  return nextWeekday(o.today, target);
}

function zhWeekday(o: ParseOptions, target: number, which?: string): Day {
  if (which === '下') return addDays(nextWeek(o), (target - o.weekStart + 7) % 7);
  if (which === '这' || which === '本') return addDays(startOfWeek(o.today, o.weekStart), (target - o.weekStart + 7) % 7);
  return nextWeekday(o.today, target);
}

export function parseQuickAdd(input: string, o: ParseOptions): Parsed {
  const found: Array<Part & { value: ReturnType<Rule['read']> }> = [];
  for (const rule of RULES) {
    for (const m of allMatches(rule.re, input)) {
      const from = m.index, to = from + m[0].length;
      if (!edgeOk(rule, input.slice(Math.max(0, from - 1), from))) continue;
      if (found.some(f => from < f.to && to > f.from)) continue;
      /* One date, one repeat and one priority: the first of each wins. */
      if (found.some(f => f.kind === rule.kind)) continue;
      const value = rule.read(m, o);
      if (!value) continue;
      found.push({ kind: rule.kind, from, to, text: m[0], value });
    }
  }
  found.sort((a, b) => a.from - b.from);
  let description = '';
  let at = 0;
  for (const f of found) {
    description += input.slice(at, f.from);
    at = f.to;
  }
  description += input.slice(at);
  description = description.replace(/\s{2,}/g, ' ').trim();

  const out: Parsed = { description, due: null, recurrence: null, priority: 2, parts: found.map(({ value: _v, ...p }) => p) };
  for (const f of found) {
    if (f.value?.due) out.due = f.value.due;
    if (f.value?.recurrence) out.recurrence = f.value.recurrence;
    if (f.value?.priority !== undefined) out.priority = f.value.priority;
  }
  /* A repeat needs a day to count from. "every Monday" starts on the next Monday. */
  if (out.recurrence && !out.due) out.due = firstOccurrence(out.recurrence, o.today);
  return out;
}

function firstOccurrence(rule: string, today: Day): Day | null {
  const days = rule.match(/on ((?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday)(?:, )?)+/);
  if (days) {
    const wanted = days[0].slice(3).split(', ').map(d => EN_DAY_NAMES.indexOf(d)).filter(d => d >= 0);
    return wanted.map(d => nextWeekday(today, d)).sort()[0] ?? today;
  }
  if (/weekday/.test(rule)) {
    const w = new Date(`${today}T00:00:00Z`).getUTCDay();
    return w === 0 ? addDays(today, 1) : w === 6 ? addDays(today, 2) : today;
  }
  const monthDay = rule.match(/every month on the (\d+)/);
  if (monthDay) {
    const p = parts(today);
    const n = Number(monthDay[1]);
    const here = fromParts(p.y, p.m, Math.min(n, daysInMonth(p.y, p.m)));
    if (here >= today) return here;
    const q = parts(addMonths(fromParts(p.y, p.m, 1), 1));
    return fromParts(q.y, q.m, Math.min(n, daysInMonth(q.y, q.m)));
  }
  return today;
}
