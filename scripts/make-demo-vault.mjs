/*
 * Writes a sample vault with tasks spread the way a real one has them: in
 * projects, in daily notes, in an inbox, some late, some repeating, some done,
 * and a ```tasks block written for the Tasks plugin.
 *
 *   node scripts/make-demo-vault.mjs [vault dir]
 *
 * Dates are relative to the day it runs, so the agenda always has something
 * late, something today and something coming. Installs the built plugin.
 */
import { mkdirSync, writeFileSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';

const vault = process.argv[2] ?? '../데모_볼트';

const pad = n => String(n).padStart(2, '0');
const now = new Date();
const day = n => {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const notes = {
  'Inbox.md': `- [ ] Reply to Jun about the venue 📅 ${day(0)}
- [ ] Book a dentist appointment
- [ ] Return the library books 🔼 📅 ${day(-2)}
- [ ] Look into a standing desk #home
- [ ] Throw away the old flyers 🏁 delete
`,
  'Projects/Website Redesign.md': `---
status: active
---
The hub for everything about the redesign. Kickoff notes are in [[Meeting 01]].

## This week

- [ ] Pick a colour palette #design ⏫ 📅 ${day(0)}
- [ ] Write the about page #writing 📅 ${day(1)}
- [/] Migrate the blog posts 🛫 ${day(-3)} 📅 ${day(4)}
- [x] Collect logo options ✅ ${day(-1)} 📅 ${day(-1)}

## Later

- [ ] Set up analytics 📅 ${day(12)}
- [ ] Fix the mobile menu 🔺 📅 ${day(-1)}
- [ ] Ask [[Mina Park]] for copy review ⏳ ${day(2)}
`,
  'Projects/Garden.md': `- [ ] Order seeds before the sale ends ⏫ 📅 ${day(3)}
- [ ] Water the seedlings 🔁 every 2 days 📅 ${day(0)}
- [ ] Turn the compost 🔁 every week on Saturday 📅 ${day(-4)}
- [ ] Sketch the new bed layout
`,
  'Areas/Home.md': `## Chores

- [ ] Take out recycling 🔁 every week 📅 ${day(1)}
- [ ] Pay rent 🔁 every month on the 1st ⏫ 📅 ${day(6)}
- [ ] Replace the hallway bulb #home
- [x] Clean the fridge ✅ ${day(0)}

## Errands

- [ ] Pick up the parcel at the post office 📅 ${day(0)}
- [ ] Renew passport 🔽 📅 ${day(40)}
`,
  'Areas/Health.md': `- [ ] Morning stretch 🔁 every day 📅 ${day(0)}
- [ ] Book a blood test 📅 ${day(9)}
- [ ] Try the new running route #run
`,
  'Work/Meeting 01.md': `Decisions about the redesign.

- [ ] Send the summary to the team 📅 ${day(-1)}
- [ ] Draft the timeline for [[Website Redesign]] ⏳ ${day(1)}
- Decided: launch after the content freeze.
`,
  'Work/Mina Park.md': `Writer, helps with copy.

- [ ] Share the brand voice doc with Mina 📅 ${day(5)}
`,
  [`Daily/${day(0)}.md`]: `## Plan

- [ ] Review the pull requests 📅 ${day(0)}
- [ ] 30 minutes of reading

## Log

Started the day with the palette question.
`,
  [`Daily/${day(-1)}.md`]: `- [x] Draft the newsletter ✅ ${day(-1)}
- [ ] Call the bank about the card 📅 ${day(-1)}
`,
  'Overview.md': `This block was written for the Tasks plugin. Doable draws it too.

\`\`\`tasks
not done
due before in 7 days
path includes Projects
group by filename
sort by due
\`\`\`

How a task line looks, as an example:

\`\`\`md
- [ ] Example task 📅 ${day(3)}
\`\`\`

## Everything recurring

\`\`\`tasks
not done
is recurring
sort by due
\`\`\`
`,
  '할 일.md': `- [ ] 장보기 목록 정리 📅 ${day(0)}
- [ ] 엄마께 전화하기 📅 ${day(2)}
- [ ] 분리수거 🔁 every week on Tuesday 📅 ${day(1)}
`,
};

if (existsSync(vault)) {
  for (const f of ['Inbox.md', 'Projects', 'Areas', 'Work', 'Daily', 'Overview.md', '할 일.md']) rmSync(join(vault, f), { recursive: true, force: true });
}
for (const [path, body] of Object.entries(notes)) {
  const file = join(vault, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body);
}

const config = join(vault, '.obsidian');
const plugin = join(config, 'plugins', 'doable');
mkdirSync(plugin, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  if (existsSync(f)) copyFileSync(f, join(plugin, f));
}
rmSync(join(plugin, 'data.json'), { force: true });
writeFileSync(join(config, 'community-plugins.json'), JSON.stringify(['doable'], null, 2));
writeFileSync(join(config, 'app.json'), JSON.stringify({ livePreview: true, alwaysUpdateLinks: true }, null, 2));
writeFileSync(join(config, 'core-plugins.json'), JSON.stringify(['file-explorer', 'global-search', 'switcher', 'daily-notes', 'command-palette', 'outline'], null, 2));
writeFileSync(join(config, 'daily-notes.json'), JSON.stringify({ folder: 'Daily', format: 'YYYY-MM-DD' }, null, 2));
for (const f of ['workspace.json', 'workspace-mobile.json']) rmSync(join(config, f), { force: true });
console.log(`demo vault: ${Object.keys(notes).length} notes at ${vault}`);
