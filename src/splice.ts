/*
 * Finding a block of lines again and replacing it, without Obsidian, so it can
 * be tested. The block is looked for where it was read; if it is not there any
 * more, at the one place in the text where it now is. Anything less certain is
 * a refusal.
 */

export interface Spliced {
  text: string;
  /** First line of the block. */
  at: number;
  had: string[];
  wrote: string[];
}

export function findBlock(lines: string[], near: number, had: string[]): number {
  const bare = (i: number) => (lines[i] ?? '').replace(/\r$/, '');
  const matches = (at: number) => at >= 0 && at + had.length <= lines.length && had.every((h, k) => bare(at + k) === h);
  if (matches(near)) return near;
  if (had.length === 0) return -1;
  let hit = -1;
  for (let i = 0; i + had.length <= lines.length; i++) {
    if (!matches(i)) continue;
    if (hit >= 0) return -1;
    hit = i;
  }
  return hit;
}

/** Replaces the block, keeping the file's line endings. Null when it cannot be found. */
export function splice(text: string, near: number, had: string[], make: (found: string[]) => string[] | null): Spliced | null {
  const lines = text.split('\n');
  const at = findBlock(lines, near, had);
  if (at < 0) return null;
  const found = had.map((_h, k) => (lines[at + k] ?? '').replace(/\r$/, ''));
  const wrote = make(found);
  if (wrote === null) return null;
  const crlf = text.includes('\r\n');
  lines.splice(at, had.length, ...wrote);
  if (crlf) {
    /* Every line that is followed by another one ends in \r\n; the last keeps what it had. */
    for (let i = Math.max(0, at - 1); i < Math.min(lines.length - 1, at + wrote.length + 1); i++) {
      if (!lines[i].endsWith('\r')) lines[i] += '\r';
    }
    const last = lines.length - 1;
    if (!text.endsWith('\r') && lines[last].endsWith('\r')) lines[last] = lines[last].slice(0, -1);
  }
  return { text: lines.join('\n'), at, had: found, wrote };
}

/**
 * Where a new task goes: after the last line of the section under `heading`,
 * or at the end of the note, before trailing blank lines. Headings and ends
 * inside fenced code do not count. -1 when the heading is missing.
 */
export function insertionPoint(lines: string[], heading: string): number {
  const inFence: boolean[] = [];
  let fence: string | null = null;
  for (const l of lines) {
    const m = l.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence === null && m) { fence = m[1][0].repeat(m[1].length); inFence.push(true); continue; }
    if (fence !== null) {
      inFence.push(true);
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length && l.trim() === m[1]) fence = null;
      continue;
    }
    inFence.push(false);
  }
  const isHeading = (i: number) => !inFence[i] && /^#{1,6}\s/.test(lines[i]);
  let end = lines.length;
  if (heading) {
    const h = lines.findIndex((l, i) => isHeading(i) && l.replace(/^#{1,6}\s+/, '').replace(/\s+#*\s*$/, '').trim().toLowerCase() === heading.toLowerCase());
    if (h < 0) return -1;
    const level = (lines[h].match(/^#+/) ?? ['#'])[0].length;
    for (let i = h + 1; i < lines.length; i++) {
      if (!isHeading(i)) continue;
      if ((lines[i].match(/^#+/) ?? [''])[0].length <= level) { end = i; break; }
    }
    while (end > h + 1 && lines[end - 1].trim() === '') end--;
    return end;
  }
  while (end > 0 && lines[end - 1].trim() === '') end--;
  return end;
}
