/* Every match of a global pattern, typed, without String.prototype.matchAll. */
export function allMatches(re: RegExp, text: string): RegExpExecArray[] {
  const g = re.global ? re : new RegExp(re.source, re.flags + 'g');
  const out: RegExpExecArray[] = [];
  g.lastIndex = 0;
  for (let m = g.exec(text); m !== null; m = g.exec(text)) {
    out.push(m);
    if (m[0] === '') g.lastIndex++;
  }
  g.lastIndex = 0;
  return out;
}
