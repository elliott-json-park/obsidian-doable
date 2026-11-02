/*
 * The everyday part of the Tasks query language, so ```tasks blocks that people
 * already have keep rendering:
 *
 *   not done
 *   due before tomorrow
 *   path includes Projects
 *   tags include #work
 *   group by due
 *   sort by priority
 *   limit 20
 *
 * Every line is one condition and all of them must hold. Lines this reader does
 * not understand are reported back rather than silently changing the result.
 */

import { addDays, addMonths, Day, daysInMonth, fromParts, isDay, parts, startOfWeek } from './dates';
import { Priority, Status } from './task';

export interface QueryTask {
  description: string;
  status: Status;
  priority: Priority;
  created: Day | null;
  start: Day | null;
  scheduled: Day | null;
  due: Day | null;
  done: Day | null;
  recurrence: string | null;
  tags: string[];
  path: string;
  heading: string | null;
  line: number;
}

export type GroupKey = 'due' | 'scheduled' | 'start' | 'happens' | 'done' | 'filename' | 'folder' | 'path' | 'heading' | 'priority' | 'status' | 'tags';
type SortKey = 'due' | 'scheduled' | 'start' | 'happens' | 'done' | 'created' | 'priority' | 'description' | 'path' | 'filename' | 'status' | 'urgency';

export interface Query {
  filters: Array<(t: QueryTask) => boolean>;
  sorts: Array<{ key: SortKey; reverse: boolean }>;
  groups: GroupKey[];
  limit: number | null;
  skipped: string[];
}

export interface QueryContext {
  today: Day;
  weekStart: number;
}

type DateField = 'due' | 'scheduled' | 'start' | 'done' | 'created' | 'happens';

const PRIORITY_WORD: Record<string, Priority> = { highest: 5, high: 4, medium: 3, none: 2, low: 1, lowest: 0 };

function dateOf(t: QueryTask, f: DateField): Day | null {
  if (f === 'happens') return [t.start, t.scheduled, t.due].filter((d): d is Day => !!d).sort()[0] ?? null;
  return t[f];
}

/** A date phrase as an inclusive range of days. */
export function dateRange(text: string, c: QueryContext): [Day, Day] | null {
  const s = text.trim().toLowerCase();
  if (isDay(s)) return [s, s];
  const span = s.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{4}-\d{2}-\d{2})$/);
  if (span && isDay(span[1]) && isDay(span[2])) return [span[1], span[2]];
  if (s === 'today') return [c.today, c.today];
  if (s === 'tomorrow') return [addDays(c.today, 1), addDays(c.today, 1)];
  if (s === 'yesterday') return [addDays(c.today, -1), addDays(c.today, -1)];
  const rel = s.match(/^(last|this|next)\s+(week|month|year)$/);
  if (rel) {
    const shift = rel[1] === 'last' ? -1 : rel[1] === 'next' ? 1 : 0;
    if (rel[2] === 'week') {
      const from = addDays(startOfWeek(c.today, c.weekStart), 7 * shift);
      return [from, addDays(from, 6)];
    }
    const p = parts(c.today);
    if (rel[2] === 'month') {
      const first = addMonths(fromParts(p.y, p.m, 1), shift);
      const q = parts(first);
      return [first, fromParts(q.y, q.m, daysInMonth(q.y, q.m))];
    }
    return [fromParts(p.y + shift, 1, 1), fromParts(p.y + shift, 12, 31)];
  }
  const inN = s.match(/^in\s+(\d+|one|two|three|four|five|six|seven)\s+(days?|weeks?|months?)$/);
  if (inN) {
    const n = Number(inN[1]) || ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven'].indexOf(inN[1]);
    const d = /^day/.test(inN[2]) ? addDays(c.today, n) : /^week/.test(inN[2]) ? addDays(c.today, 7 * n) : addMonths(c.today, n);
    return [d, d];
  }
  const ago = s.match(/^(\d+)\s+(days?|weeks?)\s+ago$/);
  if (ago) {
    const d = addDays(c.today, -Number(ago[1]) * (/^week/.test(ago[2]) ? 7 : 1));
    return [d, d];
  }
  const month = s.match(/^(\d{4})-(\d{2})$/);
  if (month) {
    const y = Number(month[1]), m = Number(month[2]);
    return [fromParts(y, m, 1), fromParts(y, m, daysInMonth(y, m))];
  }
  return null;
}

function textTest(line: string): ((s: string) => boolean) | null {
  const m = line.match(/^(includes|does not include|regex matches|regex does not match)\s+(.+)$/i);
  if (!m) return null;
  const op = m[1].toLowerCase();
  if (op.startsWith('regex')) {
    const r = m[2].trim().match(/^\/(.*)\/([a-z]*)$/);
    if (!r) return null;
    let re: RegExp;
    try { re = new RegExp(r[1], r[2]); } catch { return null; }
    return op === 'regex matches' ? s => re.test(s) : s => !re.test(s);
  }
  const needle = m[2].trim().toLowerCase();
  return op === 'includes' ? s => s.toLowerCase().includes(needle) : s => !s.toLowerCase().includes(needle);
}

function parseFilter(line: string, c: QueryContext): ((t: QueryTask) => boolean) | null {
  const l = line.trim();
  const lower = l.toLowerCase();
  if (lower === 'not done') return t => t.status !== 'done' && t.status !== 'cancelled';
  if (lower === 'done') return t => t.status === 'done' || t.status === 'cancelled';
  if (lower === 'is recurring') return t => !!t.recurrence;
  if (lower === 'is not recurring') return t => !t.recurrence;

  const has = lower.match(/^(no|has)\s+(due|scheduled|start|done|created|happens)\s+date$/);
  if (has) {
    const f = has[2] as DateField;
    return has[1] === 'no' ? t => dateOf(t, f) === null : t => dateOf(t, f) !== null;
  }

  const date = lower.match(/^(due|scheduled|starts?|done|created|happens)\s+(?:(before|after|on or before|on or after|on|in)\s+)?(.+)$/);
  if (date) {
    const field = (date[1].startsWith('start') ? 'start' : date[1]) as DateField;
    const op = date[2] ?? 'on';
    const range = dateRange(date[3], c);
    if (!range) return null;
    const [from, to] = range;
    const cmp = (d: Day) => {
      switch (op) {
        case 'before': return d < from;
        case 'after': return d > to;
        case 'on or before': return d <= to;
        case 'on or after': return d >= from;
        default: return d >= from && d <= to;
      }
    };
    /* As in Tasks: a task with no start date passes every start filter, and
       "happens" holds when any of its start, scheduled or due dates does. */
    if (field === 'start') return t => t.start === null || cmp(t.start);
    if (field === 'happens') return t => [t.start, t.scheduled, t.due].some(d => d !== null && cmp(d));
    return t => { const d = dateOf(t, field); return d !== null && cmp(d); };
  }

  const text = l.match(/^(path|filename|folder|heading|description)\s+(.+)$/i);
  if (text) {
    const test = textTest(text[2]);
    if (!test) return null;
    const key = text[1].toLowerCase();
    return t => {
      const value = key === 'path' ? t.path
        : key === 'filename' ? t.path.slice(t.path.lastIndexOf('/') + 1).replace(/\.md$/, '')
          : key === 'folder' ? t.path.slice(0, Math.max(0, t.path.lastIndexOf('/') + 1))
            : key === 'heading' ? t.heading ?? ''
              : t.description;
      return test(value);
    };
  }

  const tags = l.match(/^tags?\s+(include|includes|do not include|does not include)\s+(.+)$/i);
  if (tags) {
    const needle = tags[2].trim().replace(/^#/, '').toLowerCase();
    const want = !/not/i.test(tags[1]);
    return t => t.tags.some(x => x.slice(1).toLowerCase().includes(needle)) === want;
  }

  const pr = lower.match(/^priority is\s+(?:(above|below|not)\s+)?(highest|high|medium|none|low|lowest)$/);
  if (pr) {
    const p = PRIORITY_WORD[pr[2]];
    if (pr[1] === 'above') return t => t.priority > p;
    if (pr[1] === 'below') return t => t.priority < p;
    if (pr[1] === 'not') return t => t.priority !== p;
    return t => t.priority === p;
  }

  const status = lower.match(/^status\.type is\s+(not\s+)?(todo|done|in_progress|cancelled)$/);
  if (status) {
    const map: Record<string, Status> = { todo: 'todo', done: 'done', in_progress: 'doing', cancelled: 'cancelled' };
    const s = map[status[2]];
    return status[1] ? t => t.status !== s : t => t.status === s;
  }
  return null;
}

/* Instructions that change only how Tasks draws its results. */
const LAYOUT = /^(hide|show)\s|^short(\s+mode)?$|^full(\s+mode)?$|^explain$|^ignore global query$|^#/i;

export function parseQuery(source: string, c: QueryContext): Query {
  const q: Query = { filters: [], sorts: [], groups: [], limit: null, skipped: [] };
  const lines = source.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (LAYOUT.test(line)) continue;
    const lower = line.toLowerCase();
    const limit = lower.match(/^limit\s+(?:to\s+)?(\d+)(?:\s+tasks?)?$/);
    if (limit) { q.limit = Number(limit[1]); continue; }
    const sort = lower.match(/^sort by\s+(due|scheduled|start|happens|done|created|priority|description|path|filename|status|urgency)(\s+reverse)?$/);
    if (sort) { q.sorts.push({ key: sort[1] as SortKey, reverse: !!sort[2] }); continue; }
    const group = lower.match(/^group by\s+(due|scheduled|start|happens|done|filename|folder|path|heading|priority|status|tags)(\s+reverse)?$/);
    if (group) { q.groups.push(group[1] as GroupKey); continue; }
    const f = parseFilter(line, c);
    if (f) q.filters.push(f);
    else q.skipped.push(line);
  }
  return q;
}

const STATUS_ORDER: Record<Status, number> = { doing: 0, todo: 1, done: 2, cancelled: 3 };

function sortValue(t: QueryTask, key: SortKey): string | number {
  switch (key) {
    case 'priority': return -t.priority;
    case 'description': return t.description.toLowerCase();
    case 'path': return t.path;
    case 'filename': return t.path.slice(t.path.lastIndexOf('/') + 1);
    case 'status': return STATUS_ORDER[t.status];
    case 'urgency': return defaultScore(t);
    default: return dateOf(t, key) ?? '9999-99-99';
  }
}

/* Open first, then by day, then by priority: what the agenda does. */
function defaultScore(t: QueryTask): string {
  const open = t.status === 'done' || t.status === 'cancelled' ? '1' : '0';
  return `${open}${t.due ?? t.scheduled ?? t.start ?? '9999-99-99'}${9 - t.priority}`;
}

function compare(a: string | number, b: string | number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function runQuery<T extends QueryTask>(q: Query, tasks: T[]): T[] {
  let out = tasks.filter(t => q.filters.every(f => f(t)));
  const sorts = q.sorts.length ? q.sorts : [{ key: 'urgency' as SortKey, reverse: false }];
  out = out.slice().sort((a, b) => {
    for (const s of sorts) {
      const r = compare(sortValue(a, s.key), sortValue(b, s.key));
      if (r !== 0) return s.reverse ? -r : r;
    }
    return compare(a.path, b.path) || a.line - b.line;
  });
  if (q.limit !== null) out = out.slice(0, q.limit);
  return out;
}

export function groupName(t: QueryTask, key: GroupKey): string[] {
  switch (key) {
    case 'filename': return [t.path.slice(t.path.lastIndexOf('/') + 1).replace(/\.md$/, '')];
    case 'folder': return [t.path.slice(0, Math.max(0, t.path.lastIndexOf('/') + 1)) || '/'];
    case 'path': return [t.path.replace(/\.md$/, '')];
    case 'heading': return [t.heading ?? '(No heading)'];
    case 'priority': return [['Lowest', 'Low', 'Normal', 'Medium', 'High', 'Highest'][t.priority] + ' priority'];
    case 'status': return [{ todo: 'Todo', doing: 'In progress', done: 'Done', cancelled: 'Cancelled' }[t.status]];
    case 'tags': return t.tags.length ? t.tags : ['(No tags)'];
    default: {
      const d = dateOf(t, key);
      return [d ?? `No ${key} date`];
    }
  }
}

/** Groups in a stable order: by name, dates naturally sort themselves. */
export function groupTasks<T extends QueryTask>(tasks: T[], keys: GroupKey[]): Array<{ names: string[]; tasks: T[] }> {
  if (keys.length === 0) return [{ names: [], tasks }];
  const map = new Map<string, { names: string[]; tasks: T[] }>();
  for (const t of tasks) {
    let paths: string[][] = [[]];
    for (const k of keys) {
      const next: string[][] = [];
      for (const p of paths) for (const n of groupName(t, k)) next.push([...p, n]);
      paths = next;
    }
    for (const names of paths) {
      const id = names.join('\u0000');
      const g = map.get(id) ?? { names, tasks: [] };
      g.tasks.push(t);
      map.set(id, g);
    }
  }
  return Array.from(map.values()).sort((a, b) => compare(a.names.join('\u0000'), b.names.join('\u0000')));
}
