/**
 * Build ~/dev/helm-test-vault: a small vault shaped like the real one —
 * 02 PROJECTS with umbrellas, Habits, an inbox, and daily notes in the
 * `YYYY/MM - MMMM/ww/DD, dddd, MMM, YYYY` layout. Refuses real-looking paths.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { addDays, formatDate, todayLocal } from '../src/core/dates';

const target = resolve(process.env['HELM_VAULT'] ?? join(homedir(), 'dev', 'helm-test-vault'));
if (/IWAN-REMOTE-VAULT|\/Documents\/|Desktop|iCloud|Dropbox/i.test(target) || target.split('/').length < 4) {
  console.error(`Refusing to seed into ${target}`);
  process.exit(2);
}
const today = process.env['HELM_TODAY'] ?? todayLocal();
const DAILY_FOLDER = '70 OBSIDIAN/70-06 Daily Notes';
const DAILY_FORMAT = 'YYYY/MM - MMMM/ww/DD, dddd, MMM, YYYY';

const files = new Map<string, string>();
const put = (p: string, c: string): void => { files.set(p, c); };
const d = (n: number): string => addDays(today, n);

put('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md', `---
title: Oracle Book Writing
type: project
status:
  - active
priority:
  - high
area:
  - Oracle
id: prj-book01
deadline: ${d(90)}
tags: project
---

# Oracle Book Writing

## Objective

Ship the OCI Networking book to the publisher.

## Phase: Outline 📅 ${d(-5)}

- [x] Draft chapter list 🆔 tsk-bk0001 ✅ ${d(-20)}
- [x] Review outline with editor ✅ ${d(-12)}

## Phase: Writing 📅 ${d(30)}

- [/] Chapter 4 revision 🆔 tsk-bk0002 ⏫ ⏱️ 2h
\t- [x] Verify diagrams ✅ ${d(-2)}
\t- [ ] Fix routing tables
- [ ] Chapter 5: create routing tables on the diagrams 📅 ${d(-3)} ⏱️ 1h30m
- [ ] Chapter 5: populate the routing tables ⛔ tsk-bk0002
- [ ] Chapter 6 first draft 📅 ${d(6)} ⏱️ 3h

## Phase: Production

- [ ] Recreate all diagrams in DrawIO
- [ ] Embed the recreated diagrams

## Tasks

- [ ] Buy reference books ⏱️ 45m
- [ ] Weekly progress mail to the publisher 🔁 every week on friday 📅 ${d(2)}

## Log

- ${d(-12)} — Outline approved.
`);

put('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md', `---
title: Kitchen Remodel
type: project
status: planned
priority: medium
area: House
id: prj-kitch1
start_date: ${d(14)}
due_date: ${d(120)}
---

# Kitchen Remodel

## Phase: Design

- [ ] Sketch the layout ⏱️ 1h
- [ ] Pick tiles
- [ ] Get three quotes 📅 ${d(10)}

## Phase: Build

- [ ] Demolition
- [ ] Plumbing

## Tasks
`);

put('02 PROJECTS/⮕ Oracle/⮕ Oracle.md', `---
title: Oracle
type: project
status: active
priority: normal
id: prj-oracl1
---

# Oracle

Umbrella for everything Oracle.
`);

put('02 PROJECTS/⮕ Oracle/OCI Certification/OCI Certification.md', `---
title: OCI Certification
type: project
status: active
priority: high
area: Oracle
id: prj-cert01
due_date: ${d(21)}
---

# OCI Certification

## Tasks

- [ ] Book the exam 📅 ${d(4)} ⏱️ 15m
- [ ] Practice test 1 ⏱️ 2h
- [ ] Practice test 2 ⏱️ 2h
- [x] Read the study guide ✅ ${d(-8)}
`);

put('02 PROJECTS/⮕ Oracle/NAT on DRG/NAT on DRG.md', `---
title: NAT on DRG
type: project
status: on-hold
priority: normal
area: Oracle
id: prj-natdrg
---

# NAT on DRG

## Tasks

- [?] Circle back on the bug ticket
`);

put('02 PROJECTS/Garage Sale/Garage Sale.md', `---
title: Garage Sale
type: project
status: active
priority: low
area: House
id: prj-garag1
---

# Garage Sale

## Tasks

- [x] Sort the boxes ✅ ${d(-40)}
- [x] Price everything ✅ ${d(-35)}
`);

put('02 PROJECTS/Old Website/Old Website.md', `---
title: Old Website
type: project
status: done
priority: low
id: prj-oldweb
---

# Old Website

- [x] Shut it down ✅ ${d(-100)}
`);

put('02 PROJECTS/Backlog Tasks.md', `# Backlog

- [ ] Learn Rust properly
- [ ] Replace the office chair
- [ ] Try the new espresso beans
`);

put('02 PROJECTS/Habits/Morning workout.md', `---
title: Morning workout
type: habit
id: hab-work01
schedule: every weekday
icon: 🏃
target_per_week: 4
grace_days: 1
---

# Morning workout
`);
put('02 PROJECTS/Habits/Evening reading.md', `---
title: Evening reading
type: habit
id: hab-read01
schedule: every day
icon: 📖
---
`);
put('02 PROJECTS/Habits/Piano practice.md', `---
title: Piano practice
type: habit
id: hab-piano1
schedule: every week on monday, wednesday, saturday
icon: 🎹
---
`);

put('01 INBOX/Inbox.md', `# Inbox

Capture here, triage in Helm.

- [ ] Call the plumber about the leak
- [ ] Renew passport 📅 ${d(-2)}
\t- [ ] Find a photo
- [ ] Idea: newsletter about OCI networking
- [ ] Book dentist
`);

// Daily notes: last 21 days with habit lines and some work, in the user's template shape.
const dailyPath = (date: string): string => `${DAILY_FOLDER}/${formatDate(date, DAILY_FORMAT)}.md`;
for (let i = 21; i >= 1; i--) {
  const date = d(-i);
  const title = formatDate(date, 'DD, dddd, MMM, YYYY');
  const wd = Number(new Date(date + 'T00:00:00Z').getUTCDay());
  const weekday = wd >= 1 && wd <= 5;
  const workout = weekday ? (i % 4 === 0 ? '- [ ]' : '- [x]') : null;
  const reading = i % 5 === 0 ? '- [ ]' : '- [x]';
  const habits = [workout ? `${workout} 🏃 Morning workout 🆔 hab-work01${workout === '- [x]' ? ` ✅ ${date}` : ''}` : null, `${reading} 📖 Evening reading 🆔 hab-read01${reading === '- [x]' ? ` ✅ ${date}` : ''}`].filter(Boolean).join('\n');
  const todayTasks = i === 1
    ? `### Today\n- [ ] Fix the router config ⏱️ 30m\n- [x] Pay the electricity invoice ✅ ${date}\n- [ ] Reply to Marieke #work`
    : i === 2 ? `### Today\n- [x] Clean the desk ✅ ${date}` : '';
  const mirrors = i === 1 ? `### From projects\n- [ ] Chapter 5: create routing tables on the diagrams 🆔 tsk-bk0003 📅 ${d(-3)} 🔗 [[Oracle Book Writing]] ⏱️ 1h30m` : '';
  put(dailyPath(date), `---
title: ${title}
Type: Daily Note
week: "[[${formatDate(date, 'gggg-[W]ww')}]]"
tags:
  - dailynotes
mood: 👍
---

> [!quote] The first step to getting the things you want out of life is this: decide what you want.
Previous day: [[${formatDate(d(-i - 1), 'DD, dddd, MMM, YYYY')}|Yesterday]]
Next day: [[${formatDate(d(-i + 1), 'DD, dddd, MMM, YYYY')}|Tomorrow]]

%% helm:start %%
## Plan
### Habits
${habits}
${todayTasks}
${mirrors}
%% helm:end %%

# Day planner

### A. Morning

- [ ] 07:00 - 08:00:
- [ ] 08:00 - 09:00: ${i === 1 ? 'Start with OCI Infra Builder (OIB)' : ''}
- [ ] 09:00 - 10:00:

### B. Afternoon

- [ ] 13:00 - 14:00: ${i === 1 ? 'Clean up email' : ''}
- [ ] 14:00 - 15:00:
`.replace(/\n{3,}/g, '\n\n'));
}
// The mirrored task must exist in the project note with that id: patch it in.
files.set('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md', files.get('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')!.replace(`- [ ] Chapter 5: create routing tables on the diagrams 📅 ${d(-3)} ⏱️ 1h30m`, `- [ ] Chapter 5: create routing tables on the diagrams 🆔 tsk-bk0003 ⏳ ${d(-1)} 📅 ${d(-3)} ⏱️ 1h30m`));

put('70 OBSIDIAN/70-07 Templates/DAILY NOTE TEMPLATE.md', `---
title: <% tp.file.title %>
Type: Daily Note
creation_date: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - dailynotes
mood: 👍
---

<%tp.web.daily_quote()%>

# Day planner

### A. Morning

- [ ] 07:00 - 08:00:
- [ ] 08:00 - 09:00:
- [ ] 09:00 - 10:00:

### B. Afternoon

- [ ] 13:00 - 14:00:
- [ ] 14:00 - 15:00:
`);

put('README.md', `# Helm test vault\n\nGenerated by scripts/seed-vault.ts. Disposable. Today = ${today}.\n`);

put('.obsidian/app.json', '{}');
put('.obsidian/appearance.json', '{ "accentColor": "" }');
put('.obsidian/core-plugins.json', JSON.stringify(['file-explorer', 'global-search', 'switcher', 'command-palette', 'daily-notes', 'page-preview', 'outline', 'word-count', 'file-recovery'], null, 2));
put('.obsidian/daily-notes.json', JSON.stringify({ folder: DAILY_FOLDER, template: '70 OBSIDIAN/70-07 Templates/DAILY NOTE TEMPLATE', format: DAILY_FORMAT, autorun: false }, null, 2));
put('.obsidian/community-plugins.json', JSON.stringify(['helm-planner'], null, 2));
put('.obsidian/plugins/helm-planner/data.json', JSON.stringify({ projectsFolder: '02 PROJECTS', habitsFolder: '02 PROJECTS/Habits', inboxNote: '01 INBOX/Inbox.md', developerActions: true, openOnStartup: true, dailyCapacityMinutes: 360 }, null, 2));

if (existsSync(target) && !existsSync(join(target, 'README.md')) && !process.argv.includes('--force')) {
  console.error(`${target} exists and was not made by this seeder; pass --force to wipe it.`);
  process.exit(3);
}
if (existsSync(target)) {
  for (const entry of ['01 INBOX', '02 PROJECTS', '70 OBSIDIAN', 'README.md', 'Helm Self-Test Report.md']) rmSync(join(target, entry), { recursive: true, force: true });
}
for (const [p, c] of files) {
  const full = join(target, p);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, c);
}
for (const f of ['main.js', 'manifest.json', 'styles.css']) {
  const src = resolve(f);
  if (existsSync(src)) cpSync(src, join(target, '.obsidian/plugins/helm-planner', f));
}
console.log(`Seeded ${files.size} files into ${target} (today=${today}).`);
