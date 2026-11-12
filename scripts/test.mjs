/*
 * Unit tests for everything that does not need Obsidian: the task line format,
 * recurrence, quick add, queries and the strings. Each module is bundled to a
 * temporary CommonJS file with esbuild and exercised with node:assert.
 *
 *   node scripts/test.mjs
 */
import esbuild from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const dir = mkdtempSync(join(tmpdir(), 'doable-test-'));
const require = createRequire(import.meta.url);
let passed = 0, failed = 0;

const obsidianStub = {
  name: 'obsidian-stub',
  setup(b) {
    b.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const getLanguage = () => globalThis.obsidianLanguage || "en";' }));
  },
};

async function load(entry) {
  const out = join(dir, entry.replace(/\W/g, '_') + '.cjs');
  await esbuild.build({ entryPoints: [entry], bundle: true, format: 'cjs', platform: 'node', outfile: out, logLevel: 'silent', plugins: [obsidianStub] });
  return require(out);
}

function test(name, fn) {
  try { fn(); passed++; console.log('  ok  ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e && e.message ? e.message.split('\n').join('\n       ') : e)); }
}

const D = await load('src/dates.ts');
const T = await load('src/task.ts');
const R = await load('src/recur.ts');
const N = await load('src/nlp.ts');
const Q = await load('src/query.ts');
const L = await load('src/i18n.ts');

/* ------------------------------------------------------------------ dates */

test('day arithmetic crosses months, years and leap days', () => {
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(D.addMonths('2026-11-15', 3), '2027-02-15');
  assert.equal(D.diffDays('2026-11-01', '2026-12-01'), 30);
  assert.equal(D.weekday('2026-11-02'), 1);
  assert.equal(D.startOfWeek('2026-11-04', 1), '2026-11-02');
  assert.equal(D.startOfWeek('2026-11-04', 0), '2026-11-01');
  assert.ok(D.isDay('2026-02-28') && !D.isDay('2026-02-30') && !D.isDay('26-02-01'));
});

/* ------------------------------------------------------------- task lines */

test('reads every Tasks field, in any order, from the end of the line', () => {
  const t = T.parseTask('- [ ] Call Ana #home ⏫ 🔁 every week ➕ 2026-11-01 🛫 2026-11-02 ⏳ 2026-11-03 📅 2026-11-05 ^ab12');
  assert.equal(t.description, 'Call Ana #home');
  assert.equal(t.priority, 4);
  assert.equal(t.recurrence, 'every week');
  assert.deepEqual([t.created, t.start, t.scheduled, t.due], ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-05']);
  assert.equal(t.block, '^ab12');
  assert.deepEqual(t.tags, ['#home']);
  const u = T.parseTask('- [x] Pay rent 📅 2026-11-01 ✅ 2026-11-01 🔼');
  assert.equal(u.status, 'done');
  assert.equal(u.done, '2026-11-01');
  assert.equal(u.priority, 3);
});

test('accepts the alternative symbols and the variation selector', () => {
  const t = T.parseTask('* [ ] A 📆 2026-11-05 ⌛ 2026-11-04');
  assert.equal(t.due, '2026-11-05');
  assert.equal(t.scheduled, '2026-11-04');
  const u = T.parseTask('1. [/] B 🗓️ 2026-11-06');
  assert.equal(u.due, '2026-11-06');
  assert.equal(u.status, 'doing');
  assert.equal(u.prefix, '1. ');
});

test('tags between fields go back into the description, as in Tasks', () => {
  const t = T.parseTask('- [ ] Plan #a 📅 2026-11-05 #b');
  assert.equal(t.description, 'Plan #a #b');
  assert.equal(t.due, '2026-11-05');
  assert.equal(T.parseTask('- [ ] Just #tag').description, 'Just #tag');
});

test('a field in the middle of the text is part of the description', () => {
  const t = T.parseTask('- [ ] Book 📅 2026-11-05 flights');
  assert.equal(t.due, null);
  assert.equal(t.description, 'Book 📅 2026-11-05 flights');
});

test('writes fields back in the Tasks order and keeps the prefix', () => {
  const line = '  > - [ ] Write #work 📅 2026-11-05 ⏫ 🔁 every day';
  const out = T.editLine(line, { due: '2026-11-06' });
  assert.equal(out, '  > - [ ] Write #work ⏫ 🔁 every day 📅 2026-11-06');
});

test('an edit that changes nothing returns the line byte for byte', () => {
  const line = '- [ ] Odd   spacing 📅 2026-11-05  ⏫';
  assert.equal(T.editLine(line, { due: '2026-11-05' }), line);
});

test('the round trip of a serialised task is stable', () => {
  const lines = [
    '- [ ] A ⏫ 🔁 every week ➕ 2026-11-01 📅 2026-11-05',
    '- [x] B 🔽 📅 2026-10-01 ✅ 2026-10-02',
    '- [-] C ❌ 2026-10-03',
    '- [ ] D 🆔 abc ⛔ x,y 🏁 delete 📅 2026-11-05 ^blk',
  ];
  for (const l of lines) assert.equal(T.serializeTask(T.parseTask(l)), l);
});

test('ordinary list items and headings are not tasks', () => {
  assert.equal(T.parseTask('- not a task'), null);
  assert.equal(T.parseTask('# [ ] heading'), null);
  assert.ok(T.isTaskLine('- [ ]'));
});

/* ------------------------------------------------------------- recurrence */

const occ = (due, scheduled = null, start = null) => ({ due, scheduled, start });

test('weekly and daily rules follow the reference date', () => {
  assert.deepEqual(R.nextOccurrence('every week', occ('2026-11-05'), '2026-11-02'), occ('2026-11-12'));
  assert.deepEqual(R.nextOccurrence('every day', occ('2026-11-05'), '2026-11-09'), occ('2026-11-06'));
  assert.deepEqual(R.nextOccurrence('every week on Monday', occ('2026-11-04'), '2026-11-04'), occ('2026-11-09'));
});

test('when done counts from the completion day', () => {
  assert.deepEqual(R.nextOccurrence('every 3 days when done', occ('2026-11-01'), '2026-11-10'), occ('2026-11-13'));
});

test('every month from the 31st lands on the last day of a short month', () => {
  assert.deepEqual(R.nextOccurrence('every month', occ('2026-01-31'), '2026-01-31'), occ('2026-02-28'));
  assert.deepEqual(R.nextOccurrence('every month', occ('2026-03-31'), '2026-03-31'), occ('2026-04-30'));
  assert.deepEqual(R.nextOccurrence('every month on the last', occ('2026-02-28'), '2026-02-28'), occ('2026-03-31'));
  assert.deepEqual(R.nextOccurrence('every year', occ('2028-02-29'), '2028-02-29'), occ('2029-02-28'));
});

test('other dates move by the same number of days', () => {
  const n = R.nextOccurrence('every week', { start: '2026-11-01', scheduled: '2026-11-03', due: '2026-11-05' }, '2026-11-05');
  assert.deepEqual(n, { start: '2026-11-08', scheduled: '2026-11-10', due: '2026-11-12' });
  /* Without a due date the scheduled date is the reference. */
  assert.deepEqual(R.nextOccurrence('every 2 weeks', occ(null, '2026-11-03'), '2026-11-03'), occ(null, '2026-11-17'));
});

test('a task with a rule and no dates recurs without dates', () => {
  assert.deepEqual(R.nextOccurrence('every week', occ(null), '2026-11-03'), occ(null));
});

test('rules rrule cannot read are reported, not guessed', () => {
  assert.equal(R.nextOccurrence('every blue moon', occ('2026-11-05'), '2026-11-05'), null);
  assert.ok(R.isValidRule('every weekday'));
  assert.ok(!R.isValidRule('sometimes'));
});

/* -------------------------------------------------------------- quick add */

const O = { today: '2026-11-02', weekStart: 1 }; // a Monday

test('English dates, repeats and priorities', () => {
  let p = N.parseQuickAdd('Call Ana tomorrow #home', O);
  assert.equal(p.description, 'Call Ana #home');
  assert.equal(p.due, '2026-11-03');
  p = N.parseQuickAdd('Pay rent every month on the 1st !high', O);
  assert.equal(p.description, 'Pay rent');
  assert.equal(p.recurrence, 'every month on the 1st');
  assert.equal(p.priority, 4);
  assert.equal(p.due, '2026-12-01');
  p = N.parseQuickAdd('Standup every weekday', O);
  assert.equal(p.recurrence, 'every weekday');
  assert.equal(p.due, '2026-11-02');
  assert.equal(N.parseQuickAdd('Gym every mon, wed and fri', O).recurrence, 'every week on Monday, Wednesday, Friday');
  assert.equal(N.parseQuickAdd('Water plants every other day', O).recurrence, 'every 2 days');
});

test('English date phrases land on the right day', () => {
  const due = s => N.parseQuickAdd(s, O).due;
  assert.equal(due('x friday'), '2026-11-06');
  assert.equal(due('x next friday'), '2026-11-13');
  assert.equal(due('x monday'), '2026-11-02');
  assert.equal(due('x next week'), '2026-11-09');
  assert.equal(due('x in 3 days'), '2026-11-05');
  assert.equal(due('x in two weeks'), '2026-11-16');
  assert.equal(due('x nov 20'), '2026-11-20');
  assert.equal(due('x 3 jan'), '2027-01-03');
  assert.equal(due('x by 11/30'), '2026-11-30');
  assert.equal(due('x due 2027-02-01'), '2027-02-01');
  assert.equal(due('x this weekend'), '2026-11-07');
  assert.equal(due('x end of month'), '2026-11-30');
  assert.equal(due('x on sat'), '2026-11-07');
});

test('words that only look like dates stay in the description', () => {
  assert.equal(N.parseQuickAdd("Read today's paper", O).due, null);
  assert.equal(N.parseQuickAdd('Sat down with the team', O).due, null);
  assert.equal(N.parseQuickAdd('Call mom!', O).priority, 2);
  assert.equal(N.parseQuickAdd('Fix #mon-tags', O).due, null);
});

test('Korean phrases', () => {
  let p = N.parseQuickAdd('보고서 내일까지 #회사', O);
  assert.equal(p.description, '보고서 #회사');
  assert.equal(p.due, '2026-11-03');
  p = N.parseQuickAdd('분리수거 매주 화요일', O);
  assert.equal(p.recurrence, 'every week on Tuesday');
  assert.equal(p.due, '2026-11-03');
  assert.equal(N.parseQuickAdd('회의 다음 주 수요일', O).due, '2026-11-11');
  assert.equal(N.parseQuickAdd('정산 12월 5일', O).due, '2026-12-05');
  assert.equal(N.parseQuickAdd('약 먹기 매일 !높음', O).priority, 4);
  assert.equal(N.parseQuickAdd('세금 3일 후', O).due, '2026-11-05');
  assert.equal(N.parseQuickAdd('월세 매월 25일', O).recurrence, 'every month on the 25th');
});

test('Chinese phrases', () => {
  assert.equal(N.parseQuickAdd('交报告 明天', O).due, '2026-11-03');
  assert.equal(N.parseQuickAdd('开会 下周三', O).due, '2026-11-11');
  assert.equal(N.parseQuickAdd('健身 每周五', O).recurrence, 'every week on Friday');
  assert.equal(N.parseQuickAdd('交房租 12月1日', O).due, '2026-12-01');
});

test('every recognised phrase is reported with its place', () => {
  const p = N.parseQuickAdd('Call Ana tomorrow every week !high', O);
  assert.deepEqual(p.parts.map(x => x.kind), ['date', 'repeat', 'priority']);
  assert.equal(p.parts[0].text, 'tomorrow');
});

/* ---------------------------------------------------------------- queries */

const task = (o) => ({
  description: '', status: 'todo', priority: 2, created: null, start: null, scheduled: null, due: null,
  done: null, recurrence: null, tags: [], path: 'a.md', heading: null, line: 0, ...o,
});
const C = { today: '2026-11-02', weekStart: 1 };
const tasks = [
  task({ description: 'late', due: '2026-10-30', path: 'Work/a.md', tags: ['#work'], line: 1 }),
  task({ description: 'today', due: '2026-11-02', priority: 4, path: 'Work/a.md', line: 2 }),
  task({ description: 'soon', scheduled: '2026-11-04', path: 'Home/b.md', tags: ['#home'], line: 3 }),
  task({ description: 'done', status: 'done', due: '2026-11-01', done: '2026-11-01', path: 'Home/b.md', line: 4 }),
  task({ description: 'free', path: 'Inbox.md', recurrence: 'every week', line: 5 }),
];
const run = src => Q.runQuery(Q.parseQuery(src, C), tasks).map(t => t.description);

test('the common Tasks filters', () => {
  assert.deepEqual(run('not done\ndue before today'), ['late']);
  assert.deepEqual(run('not done\ndue on or before today').sort(), ['late', 'today']);
  assert.deepEqual(run('done'), ['done']);
  assert.deepEqual(run('no due date\nnot done').sort(), ['free', 'soon']);
  assert.deepEqual(run('path includes Home\nnot done'), ['soon']);
  assert.deepEqual(run('tags include #work'), ['late']);
  assert.deepEqual(run('tag does not include work\nnot done').sort(), ['free', 'soon', 'today']);
  assert.deepEqual(run('priority is above none'), ['today']);
  assert.deepEqual(run('is recurring'), ['free']);
  assert.deepEqual(run('happens this week\nnot done').sort(), ['soon', 'today']);
  assert.deepEqual(run('description includes OO'), ['soon']);
  assert.deepEqual(run('scheduled 2026-11-01 2026-11-05'), ['soon']);
});

test('sorting, limits and grouping', () => {
  assert.deepEqual(run('not done\nsort by priority\nlimit 1'), ['today']);
  assert.deepEqual(run('not done\nsort by description reverse'), ['today', 'soon', 'late', 'free']);
  const groups = Q.groupTasks(Q.runQuery(Q.parseQuery('not done', C), tasks), ['folder']);
  assert.deepEqual(groups.map(g => g.names[0]), ['/', 'Home/', 'Work/']);
});

test('unknown lines are reported, layout lines are ignored', () => {
  const q = Q.parseQuery('not done\nhide backlink\nshort mode\n(due today) OR (done)\n# a comment', C);
  assert.deepEqual(q.skipped, ['(due today) OR (done)']);
  assert.equal(q.filters.length, 1);
});

/* -------------------------------------------- fixes from the review pass */

const S = await load('src/splice.ts');

test('a CRLF note stays CRLF when one line becomes two, even at the end', () => {
  const r = S.splice('intro\r\n- [ ] water', 1, ['- [ ] water'], () => ['- [ ] next', '- [x] water']);
  assert.equal(r.text, 'intro\r\n- [ ] next\r\n- [x] water');
  const d = S.splice('a\r\nb', 1, ['b'], () => []);
  assert.equal(d.text, 'a');
  const m = S.splice('a\r\nb\r\nc\r\n', 1, ['b'], () => ['b1', 'b2']);
  assert.equal(m.text, 'a\r\nb1\r\nb2\r\nc\r\n');
});

test('a line is found again where it moved, and never guessed between twins', () => {
  assert.equal(S.splice('x\na\nb', 0, ['b'], () => ['B']).text, 'x\na\nB');
  assert.equal(S.splice('b\nx\nb', 5, ['b'], () => ['B']), null);
  assert.equal(S.splice('b\nx\nb', 2, ['b'], () => ['B']).text, 'b\nx\nB');
  assert.equal(S.splice('a', 0, ['gone'], () => ['x']), null);
});

test('quick add never writes into fenced code', () => {
  const note = ['## Tasks', '- [ ] a', '```bash', '# install', 'npm i', '```', '', '## Notes'];
  assert.equal(S.insertionPoint(note, 'Tasks'), 6);
  assert.equal(S.insertionPoint(['```md', '## Tasks', '```', 'text'], 'Tasks'), -1);
  assert.equal(S.insertionPoint(['text', '', ''], ''), 1);
});

test('the depends-on field cannot freeze the editor', () => {
  const evil = '- [ ] x ⛔ a' + '  ,b'.repeat(40) + ' !';
  const t0 = Date.now();
  T.parseTask(evil);
  T.fieldSpans(evil);
  assert.ok(Date.now() - t0 < 200, `took ${Date.now() - t0} ms`);
  assert.equal(T.parseTask('- [ ] y ⛔ a, b,c').dependsOn, 'a,b,c');
});

test('happens and starts match the way Tasks does', () => {
  const spread = [task({ description: 'spread', start: '2026-11-01', due: '2026-11-10' }), task({ description: 'nostart', due: '2026-11-20' })];
  const q = s => Q.runQuery(Q.parseQuery(s, C), spread).map(t => t.description);
  assert.deepEqual(q('happens after 2026-11-05'), ['spread', 'nostart']);
  assert.deepEqual(q('happens on 2026-11-10'), ['spread']);
  assert.deepEqual(q('starts after 2026-11-05'), ['nostart']);
});

test('ordinary words are not read as dates or repeats', () => {
  const p = s => N.parseQuickAdd(s, O);
  for (const s of ['프로젝트에 매달리기', '오늘날의 문제 정리', '매일경제 기사 스크랩', '내일로 티켓 예매', '주말농장 신청',
    'Write the daily report', 'Add 1/2 cup sugar', 'Learn 3/4 time', 'Fix tod parser', 'Plan weekend trip']) {
    const r = p(s);
    assert.ok(!r.due && !r.recurrence, `${s} -> ${r.due} ${r.recurrence}`);
    assert.equal(r.description, s);
  }
  assert.equal(p('보고서 내일까지').due, '2026-11-03');
  assert.equal(p('회의 내일에').due, '2026-11-03');
  assert.equal(p('Standup daily').recurrence, 'every day');
  assert.equal(p('Pay by 11/30').due, '2026-11-30');
});

/* ----------------------------------------------------------------- styles */

test('agenda and query blocks follow the font size setting (#1)', () => {
  const css = readFileSync('styles.css', 'utf8');
  assert.match(css, /--dbl-fs:\s*calc\(var\(--font-text-size, 16px\) - 1px\)/);
  // Everything drawn inside the agenda or a query block uses the --dbl-fs sizes,
  // not the fixed interface sizes that ignore Settings → Appearance → Font size.
  for (const sel of ['.dbl-sub', '.dbl-view .dbl-add-input', '.dbl-preview', '.dbl-section-head', '.dbl-section-empty', '.dbl-text',
    '.dbl-meta', '.dbl-when', '.dbl-view .dbl-more', '.dbl-empty-body', '.dbl-block-group', '.dbl-block-none', '.dbl-block-foot']) {
    const i = css.indexOf('\n' + sel + ' {');
    assert.ok(i >= 0, sel);
    const rule = css.slice(i, css.indexOf('}', i));
    assert.match(rule, /font-size: var\(--dbl-fs(-small|-smaller)?\)/, sel);
  }
});

/* ---------------------------------------------------------------- strings */

test('every language has the same keys and placeholders', () => {
  const en = Object.keys(L.STRINGS.en).sort();
  const holes = s => (s.match(/\{\w+\}/g) || []).sort().join(',');
  for (const lang of Object.keys(L.STRINGS)) {
    assert.deepEqual(Object.keys(L.STRINGS[lang]).sort(), en, lang);
    for (const k of en) assert.equal(holes(L.STRINGS[lang][k]), holes(L.STRINGS.en[k]), `${lang} ${k}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
