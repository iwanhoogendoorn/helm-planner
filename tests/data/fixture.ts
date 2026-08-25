import { DEFAULT_SETTINGS, type HelmSettings } from '../../src/core/types';
import { HelmIndex } from '../../src/data/index';
import { Mutations } from '../../src/data/mutations';
import { MemoryVault } from '../../src/data/vault';

export const TODAY = '2026-08-26'; // Wednesday
export const DAILY_FOLDER = '70 OBSIDIAN/70-06 Daily Notes';
export const DAILY_FORMAT = 'YYYY/MM - MMMM/ww/DD, dddd, MMM, YYYY';

export const SETTINGS: HelmSettings = {
  ...DEFAULT_SETTINGS,
  projectsFolder: '02 PROJECTS',
  habitsFolder: '02 PROJECTS/Habits',
  inboxNote: '01 INBOX/Inbox.md',
  dailyNoteFolder: DAILY_FOLDER,
  dailyNoteFormat: DAILY_FORMAT,
  indentUnit: '\t',
};

export const P_BOOK = `---
title: Oracle Book Writing
type: project
status:
  - active
priority:
  - high
area: Oracle
id: prj-book
deadline: 2026-12-31
---

# Oracle Book Writing

## Phase: Outline 📅 2026-09-15

- [ ] Draft chapter list 🆔 tsk-0001 ⏫
\t- [x] Collect diagrams ✅ 2026-08-20
- [ ] Review with editor ⛔ tsk-0001
- [x] Kick-off call ✅ 2026-08-10

## Phase: Writing

- [ ] Chapter 1 📅 2026-08-20
- [ ] Chapter 2 🆔 tsk-0002 🔁 every week

## Tasks

- [ ] Buy reference books ⏱️ 45m
`;

export const P_KITCHEN = `---
title: Kitchen Remodel
type: project
status: planned
priority: medium
id: prj-kitchen
---

# Kitchen Remodel

## Tasks

- [ ] Get three quotes
`;

export const P_UMBRELLA = `---
title: Oracle
type: project
status: active
priority: normal
id: prj-oracle
---
# Oracle
`;

export const P_CHILD = `---
title: OCI Certification
type: project
status: active
priority: normal
id: prj-cert
---
# OCI Certification

## Tasks

- [ ] Book exam
`;

export const HABIT_WORKOUT = `---
type: habit
id: hab-workout
title: Morning workout
schedule: every weekday
icon: 🏃
---
`;

export const HABIT_READ = `---
type: habit
id: hab-read
title: Evening reading
schedule: every day
---
`;

export const INBOX = `# Inbox

- [ ] Call the plumber
- [ ] Renew passport 📅 2026-08-20
\t- [ ] Find photo
`;

export function dailyPath(date: string): string {
  // Only the tests' dates: hand-written to avoid re-testing formatDate here.
  const map: Record<string, string> = {
    '2026-08-24': '2026/08 - August/35/24, Monday, Aug, 2026',
    '2026-08-25': '2026/08 - August/35/25, Tuesday, Aug, 2026',
    '2026-08-26': '2026/08 - August/35/26, Wednesday, Aug, 2026',
    '2026-08-27': '2026/08 - August/35/27, Thursday, Aug, 2026',
    '2026-08-28': '2026/08 - August/35/28, Friday, Aug, 2026',
    '2026-09-02': '2026/09 - September/36/02, Wednesday, Sep, 2026',
  };
  return `${DAILY_FOLDER}/${map[date]!}.md`;
}

export const DAILY_YESTERDAY = `---
title: 25, Tuesday, Aug, 2026
---

# Day planner

### A. Morning

- [ ] 07:00 - 08:00:
- [ ] 08:00 - 09:00: Start with OIB

%% helm:start %%
## Plan
### Habits
- [x] 🏃 Morning workout 🆔 hab-workout ✅ 2026-08-25
### Today
- [ ] Fix router config ⏱️ 30m
- [x] Pay invoice ✅ 2026-08-25
### From projects
- [ ] Chapter 1 🆔 tsk-0003 📅 2026-08-20 🔗 [[Oracle Book Writing]]
%% helm:end %%
`;

export function makeVault(extra: Record<string, string> = {}): MemoryVault {
  return new MemoryVault({
    '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md': P_BOOK,
    '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md': P_KITCHEN,
    '02 PROJECTS/⮕ Oracle/⮕ Oracle.md': P_UMBRELLA,
    '02 PROJECTS/⮕ Oracle/OCI Certification/OCI Certification.md': P_CHILD,
    '02 PROJECTS/Habits/Morning workout.md': HABIT_WORKOUT,
    '02 PROJECTS/Habits/Evening reading.md': HABIT_READ,
    '01 INBOX/Inbox.md': INBOX,
    [dailyPath('2026-08-25')]: DAILY_YESTERDAY,
    '02 PROJECTS/Backlog Tasks.md': '# Backlog\n\n- [ ] Learn Rust\n',
    ...extra,
  });
}

export async function setup(extra: Record<string, string> = {}, settings: Partial<HelmSettings> = {}) {
  const vault = makeVault(extra);
  const s = { ...SETTINGS, ...settings };
  const index = new HelmIndex(vault, { settings: () => s, today: () => TODAY, dailyConfig: () => ({ folder: DAILY_FOLDER, format: DAILY_FORMAT }) });
  await index.rebuild();
  let seed = 42;
  const rng = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const notices: string[] = [];
  const m = new Mutations({ vault, index, settings: () => s, today: () => TODAY, notify: (x) => notices.push(x), rng });
  return { vault, index, m, notices, settings: s };
}
