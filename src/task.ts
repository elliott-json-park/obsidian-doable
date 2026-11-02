/*
 * One task line, read and written in the Tasks plugin's format, so a vault that
 * already uses Tasks needs no migration and keeps working with it:
 *
 *   - [ ] Call Ana #home ⏫ 🔁 every week ➕ 2026-11-01 📅 2026-11-05 ^ab12
 *
 * Fields are read from the end of the line in any order, as Tasks does, and
 * written back in Tasks' order. Nothing else on the line is touched.
 */

import { Day } from './dates';

export type Status = 'todo' | 'doing' | 'done' | 'cancelled';

/** 5 highest … 0 lowest. 2 means no priority. */
export type Priority = 0 | 1 | 2 | 3 | 4 | 5;

export const PRIORITY_EMOJI: Record<Priority, string> = { 5: '🔺', 4: '⏫', 3: '🔼', 2: '', 1: '🔽', 0: '⏬' };

export interface TaskFields {
  description: string;
  priority: Priority;
  created: Day | null;
  start: Day | null;
  scheduled: Day | null;
  due: Day | null;
  done: Day | null;
  cancelled: Day | null;
  recurrence: string | null;
  onCompletion: string | null;
  id: string | null;
  dependsOn: string | null;
  /** A trailing ` ^blockid`, kept as written. */
  block: string | null;
}

export interface TaskLine extends TaskFields {
  /** Everything before the box: indentation, `- `, `1. `, `> - `. */
  prefix: string;
  /** The character in the box. */
  mark: string;
  status: Status;
  tags: string[];
}

const TASK_RE = /^((?:\s|>)*(?:[-*+]|\d+[.)])\s+)\[(.)\](?:\s+(.*))?$/;
const VS = '️?';
const DATE = '(\\d{4}-\\d{2}-\\d{2})';

const FIELDS: Array<{ re: RegExp; apply: (t: TaskFields, m: RegExpMatchArray) => void }> = [
  { re: new RegExp(`\\s*(🔺|⏫|🔼|🔽|⏬)${VS}$`), apply: (t, m) => { t.priority = priorityOf(m[1]); } },
  { re: new RegExp(`\\s*✅${VS} *${DATE}$`), apply: (t, m) => { t.done = m[1]; } },
  { re: new RegExp(`\\s*❌${VS} *${DATE}$`), apply: (t, m) => { t.cancelled = m[1]; } },
  { re: new RegExp(`\\s*(?:📅|📆|🗓)${VS} *${DATE}$`), apply: (t, m) => { t.due = m[1]; } },
  { re: new RegExp(`\\s*(?:⏳|⌛)${VS} *${DATE}$`), apply: (t, m) => { t.scheduled = m[1]; } },
  { re: new RegExp(`\\s*🛫${VS} *${DATE}$`), apply: (t, m) => { t.start = m[1]; } },
  { re: new RegExp(`\\s*➕${VS} *${DATE}$`), apply: (t, m) => { t.created = m[1]; } },
  { re: new RegExp(`\\s*🔁${VS} *([a-zA-Z0-9, !]+)$`), apply: (t, m) => { t.recurrence = m[1].trim(); } },
  { re: new RegExp(`\\s*🏁${VS} *([a-zA-Z]+)$`), apply: (t, m) => { t.onCompletion = m[1]; } },
  { re: new RegExp(`\\s*🆔${VS} *([a-zA-Z0-9-_]+)$`), apply: (t, m) => { t.id = m[1]; } },
  /* No two neighbouring parts can match the same spaces: this runs on every keystroke. */
  { re: new RegExp(`\\s*⛔${VS} *([\\w-]+(?:\\s*,\\s*[\\w-]+)*)\\s*$`), apply: (t, m) => { t.dependsOn = m[1].replace(/\s/g, ''); } },
];

/* Tags may sit between fields; Tasks moves them back into the description. */
const TRAILING_TAG = /\s+(#[^\s#'"`,;:!?()[\]{}<>]+)$/u;
const BLOCK = /\s+(\^[A-Za-z0-9-]+)$/;
const TAG_RE = /(^|\s)(#[^\s#'"`,;:!?()[\]{}<>]+)/gu;

export function priorityOf(emoji: string): Priority {
  switch (emoji) {
    case '🔺': return 5;
    case '⏫': return 4;
    case '🔼': return 3;
    case '🔽': return 1;
    case '⏬': return 0;
    default: return 2;
  }
}

export function statusOf(mark: string): Status {
  if (mark === 'x' || mark === 'X') return 'done';
  if (mark === '-') return 'cancelled';
  if (mark === '/') return 'doing';
  return 'todo';
}

export function isTaskLine(line: string): boolean {
  return TASK_RE.test(line);
}

export function emptyFields(description = ''): TaskFields {
  return {
    description, priority: 2, created: null, start: null, scheduled: null, due: null, done: null,
    cancelled: null, recurrence: null, onCompletion: null, id: null, dependsOn: null, block: null,
  };
}

/** Splits the text after the box into a description and its fields. */
export function parseBody(body: string): TaskFields {
  const t = emptyFields();
  let rest = body.replace(/\s+$/, '');
  const block = rest.match(BLOCK);
  if (block) { t.block = block[1]; rest = rest.slice(0, block.index); }
  let trailing: string[] = [];
  for (let runs = 0; runs < 24; runs++) {
    let matched = false;
    for (const f of FIELDS) {
      const m = rest.match(f.re);
      if (m && m.index !== undefined) {
        f.apply(t, m);
        rest = rest.slice(0, m.index);
        matched = true;
      }
    }
    const tag = rest.match(TRAILING_TAG);
    if (tag && tag.index !== undefined && fieldBefore(rest.slice(0, tag.index))) {
      trailing = [tag[1], ...trailing];
      rest = rest.slice(0, tag.index);
      matched = true;
    }
    if (!matched) break;
  }
  t.description = [rest.trim(), ...trailing].filter(Boolean).join(' ');
  return t;
}

/* Only lift a trailing tag out when a field sits before it; otherwise it is
   ordinary description and stays exactly where it was. */
function fieldBefore(text: string): boolean {
  return FIELDS.some(f => f.re.test(text));
}

export type SpanKind = 'priority' | 'done' | 'cancelled' | 'due' | 'scheduled' | 'start' | 'created' | 'recurrence' | 'onCompletion' | 'id' | 'dependsOn';

export interface FieldSpan {
  kind: SpanKind;
  /** Offsets in the whole line, covering the symbol and its value but not the space before. */
  from: number;
  to: number;
  value: string;
}

const SPAN_KINDS: SpanKind[] = ['priority', 'done', 'cancelled', 'due', 'scheduled', 'start', 'created', 'recurrence', 'onCompletion', 'id', 'dependsOn'];

/** Where each field sits on the line, for drawing it as a chip. */
export function fieldSpans(line: string): FieldSpan[] {
  const m = line.match(TASK_RE);
  if (!m || m[3] === undefined) return [];
  const offset = line.length - m[3].length;
  let rest = m[3].replace(/\s+$/, '');
  const block = rest.match(BLOCK);
  if (block) rest = rest.slice(0, block.index);
  const out: FieldSpan[] = [];
  for (let runs = 0; runs < 24; runs++) {
    let matched = false;
    FIELDS.forEach((f, i) => {
      const hit = rest.match(f.re);
      if (!hit || hit.index === undefined) return;
      const lead = hit[0].length - hit[0].trimStart().length;
      out.push({ kind: SPAN_KINDS[i], from: offset + hit.index + lead, to: offset + hit.index + hit[0].length, value: hit[1] });
      rest = rest.slice(0, hit.index);
      matched = true;
    });
    const tag = rest.match(TRAILING_TAG);
    if (tag && tag.index !== undefined && fieldBefore(rest.slice(0, tag.index))) {
      rest = rest.slice(0, tag.index);
      matched = true;
    }
    if (!matched) break;
  }
  return out.sort((a, b) => a.from - b.from);
}

export function parseTask(line: string): TaskLine | null {
  const m = line.match(TASK_RE);
  if (!m) return null;
  const fields = parseBody(m[3] ?? '');
  return { ...fields, prefix: m[1], mark: m[2], status: statusOf(m[2]), tags: tagsIn(fields.description) };
}

export function tagsIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(TAG_RE)) out.push(m[2]);
  return out;
}

export function serializeFields(t: TaskFields): string {
  const parts = [t.description];
  if (t.id) parts.push(`🆔 ${t.id}`);
  if (t.dependsOn) parts.push(`⛔ ${t.dependsOn}`);
  if (t.priority !== 2) parts.push(PRIORITY_EMOJI[t.priority]);
  if (t.recurrence) parts.push(`🔁 ${t.recurrence}`);
  if (t.onCompletion) parts.push(`🏁 ${t.onCompletion}`);
  if (t.created) parts.push(`➕ ${t.created}`);
  if (t.start) parts.push(`🛫 ${t.start}`);
  if (t.scheduled) parts.push(`⏳ ${t.scheduled}`);
  if (t.due) parts.push(`📅 ${t.due}`);
  if (t.cancelled) parts.push(`❌ ${t.cancelled}`);
  if (t.done) parts.push(`✅ ${t.done}`);
  if (t.block) parts.push(t.block);
  return parts.filter(Boolean).join(' ');
}

export function serializeTask(t: TaskLine): string {
  const body = serializeFields(t);
  return `${t.prefix}[${t.mark}]${body ? ' ' + body : ''}`;
}

/**
 * Rewrites a line with some fields changed. When nothing about the fields
 * changes, the original text comes back byte for byte.
 */
export function editLine(line: string, change: Partial<TaskFields> & { mark?: string }): string {
  const t = parseTask(line);
  if (!t) return line;
  const next: TaskLine = { ...t, ...change };
  next.status = statusOf(next.mark);
  if (sameFields(t, next) && next.mark === t.mark) return line;
  return serializeTask(next);
}

function sameFields(a: TaskFields, b: TaskFields): boolean {
  return (Object.keys(emptyFields()) as Array<keyof TaskFields>).every(k => a[k] === b[k]);
}

/** The day a task is about: due, then scheduled, then start. */
export function whenOf(t: TaskFields): Day | null {
  return t.due ?? t.scheduled ?? t.start;
}

/** Which field holds the task's day, so editing the day edits the right one. */
export function whenField(t: TaskFields): 'due' | 'scheduled' | 'start' {
  if (t.due) return 'due';
  if (t.scheduled) return 'scheduled';
  if (t.start) return 'start';
  return 'due';
}
