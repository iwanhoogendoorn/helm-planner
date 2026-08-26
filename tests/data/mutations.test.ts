import { describe, expect, it } from 'vitest';
import { setup, dailyPath, TODAY, SETTINGS } from './fixture';
import { renderDailyTemplate } from '../../src/data/mutations';

const BOOK = '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md';

describe('scheduling', () => {
  it('plans a project task onto today: ⏳ on the source, mirror in the note', async () => {
    const { m, vault, index } = await setup();
    await m.schedule('tsk-0001', TODAY);
    const src = await vault.read(BOOK);
    expect(src).toContain('- [ ] Draft chapter list 🆔 tsk-0001 ⏳ 2026-08-26 ⏫');
    const daily = await vault.read(dailyPath(TODAY));
    expect(daily).toContain('## Plan\n### Anytime\n- [ ] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]]\n\n# ');
    expect(daily).not.toContain('%%');
    expect(index.task('tsk-0001')!.scheduled).toBe(TODAY);
    expect(index.mirrorsOf('tsk-0001')).toHaveLength(1);
    // Idempotent.
    await m.schedule('tsk-0001', TODAY);
    expect((await vault.read(dailyPath(TODAY))).split('tsk-0001').length - 1).toBe(1);
  });

  it('assigns an id when the source has none', async () => {
    const { m, vault, index } = await setup();
    const t = index.allTasks().find((x) => x.text === 'Buy reference books')!;
    await m.schedule(t.key, '2026-08-27');
    const src = await vault.read(BOOK);
    expect(src).toMatch(/- \[ \] Buy reference books 🆔 tsk-[a-z0-9]{6} ⏳ 2026-08-27 ⏱️ 45m/);
    const daily = await vault.read(dailyPath('2026-08-27'));
    expect(daily).toMatch(/- \[ \] Buy reference books 🆔 tsk-[a-z0-9]{6} 🔗 \[\[Oracle Book Writing\]\] ⏱️ 45m/);
  });

  it('reschedules: the mirror moves, the old day loses it', async () => {
    const { m, vault } = await setup();
    await m.schedule('tsk-0001', TODAY);
    await m.schedule('tsk-0001', '2026-08-28');
    expect(await vault.read(dailyPath(TODAY))).not.toContain('tsk-0001');
    expect(await vault.read(dailyPath('2026-08-28'))).toContain('tsk-0001');
    expect(await vault.read(BOOK)).toContain('⏳ 2026-08-28');
    await m.schedule('tsk-0001', undefined);
    expect(await vault.read(dailyPath('2026-08-28'))).not.toContain('tsk-0001');
    expect(await vault.read(BOOK)).not.toContain('⏳');
  });

  it('a past mirror is left alone when rescheduling', async () => {
    const { m, vault, index } = await setup({ [BOOK]: (await setup()).vault.files.get(BOOK)!.replace('- [ ] Chapter 1 📅 2026-08-20', '- [ ] Chapter 1 🆔 tsk-0003 📅 2026-08-20 ⏳ 2026-08-25') });
    expect(index.mirrorsOf('tsk-0003')).toHaveLength(1);
    await m.schedule('tsk-0003', TODAY);
    expect(await vault.read(dailyPath('2026-08-25'))).toContain('- [ ] Chapter 1 🆔 tsk-0003 📅 2026-08-20 🔗 [[Oracle Book Writing]]');
    expect(await vault.read(dailyPath(TODAY))).toContain('tsk-0003');
  });

  it('moves an inbox task into the day (subtree included) and back', async () => {
    const { m, vault, index } = await setup();
    const t = index.allTasks().find((x) => x.text === 'Renew passport')!;
    await m.schedule(t.key, TODAY);
    expect(await vault.read('01 INBOX/Inbox.md')).toBe('# Inbox\n\n- [ ] Call the plumber\n');
    const daily = await vault.read(dailyPath(TODAY));
    expect(daily).toContain('### Anytime\n- [ ] Renew passport 📅 2026-08-20\n\t- [ ] Find photo\n');
    const moved = index.allTasks().find((x) => x.text === 'Renew passport')!;
    expect(moved.origin).toBe('daily');
    await m.schedule(moved.key, undefined);
    expect(await vault.read('01 INBOX/Inbox.md')).toContain('- [ ] Renew passport 📅 2026-08-20\n\t- [ ] Find photo\n');
    expect(await vault.read(dailyPath(TODAY))).not.toContain('Renew passport');
  });

  it('moving the last task out of a section drops the empty heading', async () => {
    const { m, vault, index } = await setup();
    await m.addTask({ text: 'Only one', date: TODAY });
    await m.addTask({ text: 'Its child', parentKey: index.allTasks().find((x) => x.text === 'Only one')!.key });
    const t = index.allTasks().find((x) => x.text === 'Only one')!;
    await m.schedule(t.key, '2026-08-27');
    const today = await vault.read(dailyPath(TODAY));
    expect(today).not.toContain('### Anytime');
    expect(today).toContain('## Plan\n'); // heading stays, sections go
    expect(await vault.read(dailyPath('2026-08-27'))).toContain('### Anytime\n- [ ] Only one\n\t- [ ] Its child\n');
  });

  it('moves a daily task from a past day: leaves a forwarded record', async () => {
    const { m, vault, index } = await setup();
    const t = index.allTasks().find((x) => x.text === 'Fix router config')!;
    await m.schedule(t.key, TODAY);
    expect(await vault.read(dailyPath('2026-08-25'))).toContain('- [>] Fix router config ⏱️ 30m');
    expect(await vault.read(dailyPath(TODAY))).toContain('### Afternoon\n- [ ] Fix router config ⏱️ 30m\n'); // keeps its part of the day
  });

  it('a note task gets ⏳ and a mirror linking the note', async () => {
    const { m, vault, index } = await setup();
    const t = index.allTasks().find((x) => x.text === 'Learn Rust')!;
    await m.schedule(t.key, TODAY);
    expect(await vault.read('02 PROJECTS/Backlog Tasks.md')).toMatch(/- \[ \] Learn Rust 🆔 tsk-\w+ ⏳ 2026-08-26/);
    expect(await vault.read(dailyPath(TODAY))).toMatch(/- \[ \] Learn Rust 🆔 tsk-\w+ 🔗 \[\[Backlog Tasks\]\]/);
  });
});

describe('status', () => {
  it('ticks a mirror → source done, and back', async () => {
    const { m, vault, index } = await setup();
    await m.schedule('tsk-0001', TODAY);
    await m.setStatus(`tsk-0001@${TODAY}`, 'done');
    expect(await vault.read(BOOK)).toContain('- [x] Draft chapter list 🆔 tsk-0001 ⏳ 2026-08-26 ⏫ ✅ 2026-08-26');
    expect(await vault.read(dailyPath(TODAY))).toContain('- [x] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]] ✅ 2026-08-26');
    expect(index.task('tsk-0001')!.status).toBe('done');
    await m.setStatus('tsk-0001', 'todo');
    expect(await vault.read(BOOK)).toContain('- [ ] Draft chapter list 🆔 tsk-0001 ⏳ 2026-08-26 ⏫\n');
    expect(await vault.read(dailyPath(TODAY))).toContain('- [ ] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]]\n');
  });

  it('completing a recurring task spawns the next one above it', async () => {
    const { m, vault } = await setup();
    await m.setStatus('tsk-0002', 'done');
    const src = await vault.read(BOOK);
    expect(src).toMatch(/- \[ \] Chapter 2 🆔 tsk-\w{6} 🔁 every week\n- \[x\] Chapter 2 🆔 tsk-0002 🔁 every week ✅ 2026-08-26/);
  });

  it('completing a recurring daily task puts the next one in the next note', async () => {
    const { m, vault, index } = await setup();
    await m.addTask({ text: 'Water plants', date: TODAY, fields: { recurrence: { raw: 'every 2 days', parsed: true, frequency: 'daily', interval: 2 } } });
    const t = index.allTasks().find((x) => x.text === 'Water plants')!;
    await m.setStatus(t.key, 'done');
    expect(await vault.read(dailyPath(TODAY))).toContain('- [x] Water plants 🔁 every 2 days ✅ 2026-08-26');
    expect(await vault.read(dailyPath('2026-08-28'))).toContain('- [ ] Water plants 🔁 every 2 days');
  });

  it('daily done date is the note date', async () => {
    const { m, vault, index } = await setup();
    const t = index.allTasks().find((x) => x.text === 'Fix router config')!;
    await m.setStatus(t.key, 'done');
    expect(await vault.read(dailyPath('2026-08-25'))).toContain('- [x] Fix router config ⏱️ 30m ✅ 2026-08-25');
  });
});

describe('adding tasks', () => {
  it('to a phase, to the tasks section, to a day, to the inbox, as a child', async () => {
    const { m, vault, index } = await setup();
    const book = index.project('prj-book')!;
    await m.addTask({ text: 'Chapter 3', projectId: 'prj-book', phaseId: book.phases[1]!.id });
    expect(await vault.read(BOOK)).toContain('- [ ] Chapter 2 🆔 tsk-0002 🔁 every week\n- [ ] Chapter 3\n\n## Tasks');
    await m.addTask({ text: 'Order paper', projectId: 'prj-book' });
    expect(await vault.read(BOOK)).toContain('- [ ] Buy reference books ⏱️ 45m\n- [ ] Order paper\n');
    await m.addTask({ text: 'Quick one', date: TODAY, fields: { priority: 'high' } });
    expect(await vault.read(dailyPath(TODAY))).toContain('### Anytime\n- [ ] Quick one ⏫');
    await m.addTask({ text: 'Someday' });
    expect(await vault.read('01 INBOX/Inbox.md')).toContain('\t- [ ] Find photo\n- [ ] Someday\n');
    await m.addTask({ text: 'Sub', parentKey: 'tsk-0001' });
    expect(await vault.read(BOOK)).toContain('\t- [x] Collect diagrams ✅ 2026-08-20\n\t- [ ] Sub\n- [ ] Review with editor');
    // Project task with a date: mirrored immediately.
    await m.addTask({ text: 'Planned one', projectId: 'prj-kitchen', date: TODAY });
    expect(await vault.read(dailyPath(TODAY))).toMatch(/- \[ \] Planned one 🆔 tsk-\w+ 🔗 \[\[Kitchen Remodel\]\]/);
    // Project without a Tasks heading gets one.
    await m.addTask({ text: 'First task', projectId: 'prj-oracle' });
    expect(await vault.read('02 PROJECTS/⮕ Oracle/⮕ Oracle.md')).toBe('---\ntitle: Oracle\ntype: project\nstatus: active\npriority: normal\nid: prj-oracle\n---\n# Oracle\n\n## Tasks\n\n- [ ] First task\n');
  });
});

describe('editing', () => {
  it('updates text and dates and refreshes the mirror', async () => {
    const { m, vault } = await setup();
    await m.schedule('tsk-0001', TODAY);
    await m.updateTask('tsk-0001', { text: 'Draft the chapter list', due: '2026-09-01', priority: 'normal', effortMinutes: 90 });
    expect(await vault.read(BOOK)).toContain('- [ ] Draft the chapter list 🆔 tsk-0001 ⏳ 2026-08-26 📅 2026-09-01 ⏱️ 1h30m');
    expect(await vault.read(dailyPath(TODAY))).toContain('- [ ] Draft the chapter list 🆔 tsk-0001 📅 2026-09-01 🔗 [[Oracle Book Writing]] ⏱️ 1h30m');
    await m.updateTask(`tsk-0001@${TODAY}`, { scheduled: '2026-08-27' });
    expect(await vault.read(dailyPath('2026-08-27'))).toContain('tsk-0001');
  });

  it('editing the text of an id-less task keeps working afterwards', async () => {
    const { m, vault, index } = await setup();
    const t = index.allTasks().find((x) => x.text === 'Get three quotes')!;
    await m.updateTask(t.key, { text: 'Get four quotes', scheduled: TODAY });
    expect(await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')).toMatch(/- \[ \] Get four quotes 🆔 tsk-\w+ ⏳ 2026-08-26/);
    expect(await vault.read(dailyPath(TODAY))).toContain('Get four quotes');
  });

  it('deletes with subtree and mirrors', async () => {
    const { m, vault } = await setup();
    await m.schedule('tsk-0001', TODAY);
    await m.deleteTask('tsk-0001');
    expect(await vault.read(BOOK)).not.toContain('Collect diagrams');
    expect(await vault.read(dailyPath(TODAY))).not.toContain('tsk-0001');
  });

  it('moves an inbox task into a project keeping its plan', async () => {
    const { m, vault, index } = await setup();
    const t = index.allTasks().find((x) => x.text === 'Call the plumber')!;
    await m.schedule(t.key, TODAY);
    const moved = index.allTasks().find((x) => x.text === 'Call the plumber')!;
    await m.moveToProject(moved.key, 'prj-kitchen');
    expect(await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')).toMatch(/- \[ \] Get three quotes\n- \[ \] Call the plumber 🆔 tsk-\w+ ⏳ 2026-08-26\n/);
    const daily = await vault.read(dailyPath(TODAY));
    expect(daily.split('Call the plumber')).toHaveLength(2);
    expect(daily).toMatch(/### Anytime\n- \[ \] Call the plumber 🆔 tsk-\w+ 🔗 \[\[Kitchen Remodel\]\]/);
  });

  it('moves a task between phases', async () => {
    const { m, vault, index } = await setup();
    const book = index.project('prj-book')!;
    await m.moveToProject('tsk-0002', 'prj-book', book.phases[0]!.id);
    const src = await vault.read(BOOK);
    expect(src).toContain('- [x] Kick-off call ✅ 2026-08-10\n- [ ] Chapter 2 🆔 tsk-0002 🔁 every week\n\n## Phase: Writing\n\n- [ ] Chapter 1 📅 2026-08-20\n\n## Tasks');
  });
});

describe('day rituals', () => {
  it('plan day writes habits and tasks', async () => {
    const { m, vault } = await setup();
    await m.planDay(TODAY, ['tsk-0001']);
    const daily = await vault.read(dailyPath(TODAY));
    expect(daily).toContain('### Habits\n- [ ] Evening reading 🆔 hab-read\n- [ ] 🏃 Morning workout 🆔 hab-workout\n### Anytime\n- [ ] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]]');
    await m.setHabitState('hab-workout', TODAY, 'done');
    expect(await vault.read(dailyPath(TODAY))).toContain('- [x] 🏃 Morning workout 🆔 hab-workout ✅ 2026-08-26');
  });

  it('rollover from yesterday to today', async () => {
    const { m, vault, index } = await setup({ [BOOK]: (await setup()).vault.files.get(BOOK)!.replace('- [ ] Chapter 1 📅 2026-08-20', '- [ ] Chapter 1 🆔 tsk-0003 📅 2026-08-20 ⏳ 2026-08-25') });
    const r = await m.rollover('2026-08-25', TODAY);
    expect(r.moved).toBe(3);
    const y = await vault.read(dailyPath('2026-08-25'));
    expect(y).toContain('- [>] 08:00 - 09:00: Start with OIB'); // a planned slot with text is real work
    expect(y).toContain('- [ ] 07:00 - 08:00:'); // empty slots are left alone
    expect(y).toContain('- 🎂 No birthdays today');
    expect(y).toContain('- [>] Fix router config ⏱️ 30m');
    expect(y).toContain('- [x] Pay invoice ✅ 2026-08-25');
    expect(y).toContain('- [>] Chapter 1 🆔 tsk-0003 📅 2026-08-20 🔗 [[Oracle Book Writing]]');
    const t = await vault.read(dailyPath(TODAY));
    expect(t).toContain('### Morning\n- [ ] 08:00 - 09:00: Start with OIB\n### Afternoon\n- [ ] Fix router config ⏱️ 30m\n### Anytime\n- [ ] Chapter 1 🆔 tsk-0003 📅 2026-08-20 🔗 [[Oracle Book Writing]]');
    expect(index.task('tsk-0003')!.scheduled).toBe(TODAY);
  });
});

describe('reconcile', () => {
  it('daily tick flows to the source; source edits flow to the mirror', async () => {
    const { m, vault, index } = await setup();
    await m.schedule('tsk-0001', TODAY);
    // User ticks the mirror in the editor.
    const p = dailyPath(TODAY);
    index.update(p, (await vault.read(p)).replace('- [ ] Draft chapter list', '- [x] Draft chapter list'));
    vault.files.set(p, index.tasksInFile(p)[0]!.raw.line === '' ? '' : (await vault.read(p)).replace('- [ ] Draft chapter list', '- [x] Draft chapter list'));
    expect(await m.reconcile()).toBe(1);
    expect(await vault.read(BOOK)).toContain('- [x] Draft chapter list 🆔 tsk-0001 ⏳ 2026-08-26 ⏫ ✅ 2026-08-26');
    // User edits the source text in the editor.
    vault.files.set(BOOK, (await vault.read(BOOK)).replace('Draft chapter list', 'Draft chapter outline'));
    index.update(BOOK, await vault.read(BOOK));
    expect(await m.reconcile()).toBe(1);
    expect(await vault.read(p)).toContain('- [x] Draft chapter outline 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]] ✅ 2026-08-26');
    expect(await m.reconcile()).toBe(0);
  });

  it('a done mirror on a past day finishes the source, but the past note is not rewritten', async () => {
    const { m, vault } = await setup({ [BOOK]: (await setup()).vault.files.get(BOOK)!.replace('- [ ] Chapter 1 📅 2026-08-20', '- [ ] Chapter 1 🆔 tsk-0003 📅 2026-08-20') });
    // Source says "todo", the past mirror says "todo" as well → nothing to do even though the mirror text differs.
    expect(await m.reconcile()).toBe(0);
    await m.setStatus('tsk-0003', 'done');
    expect(await vault.read(dailyPath('2026-08-25'))).toContain('- [ ] Chapter 1 🆔 tsk-0003');
    expect(await m.reconcile()).toBe(0);
  });
});

describe('projects & habits', () => {
  it('creates a project under an umbrella and edits it', async () => {
    const { m, vault, index } = await setup();
    const p = await m.createProject({ title: 'OCI Book v2', status: 'planned', priority: 'high', parentId: 'prj-oracle', phases: [{ title: 'Plan', tasks: ['Outline'] }], tasks: ['Buy domain'] });
    expect(p.path).toBe('02 PROJECTS/⮕ Oracle/OCI Book v2/OCI Book v2.md');
    expect(p.parentId).toBe('prj-oracle');
    expect(p.phases[0]!.taskKeys).toHaveLength(1);
    await m.setProjectFields(p.id, { status: 'active', due: '2026-10-01' });
    const c = await vault.read(p.path);
    expect(c).toContain('status: active');
    expect(c).toContain('due_date: 2026-10-01');
    await m.addPhase(p.id, 'Write', '2026-11-01');
    expect(await vault.read(p.path)).toContain('- [ ] Outline\n\n## Phase: Write 📅 2026-11-01\n\n## Tasks');
    await m.renamePhase(p.id, index.project(p.id)!.phases[1]!.id, 'Write it', null);
    expect(await vault.read(p.path)).toContain('## Phase: Write it\n');
    await m.appendLog(p.id, 'Kicked off');
    expect(await vault.read(p.path)).toContain('## Log\n\n- 2026-08-26 — Kicked off');
    await expect(m.createProject({ title: 'OCI Book v2', status: 'planned', priority: 'high', parentId: 'prj-oracle' })).rejects.toThrow(/already exists/);
  });

  it('existing frontmatter keys are respected', async () => {
    const { m, vault } = await setup();
    await m.setProjectFields('prj-book', { due: '2027-01-01', status: 'on-hold' });
    const c = await vault.read(BOOK);
    expect(c).toContain('deadline: 2027-01-01');
    expect(c).toContain('status: on-hold');
    expect(c).not.toContain('due_date');
  });

  it('creates a habit', async () => {
    const { m, index } = await setup();
    await m.createHabit({ title: 'Stretch', schedule: 'every day', icon: '🧘' });
    const h = index.allHabits().find((x) => x.title === 'Stretch')!;
    expect(h.schedule.frequency).toBe('daily');
    await m.setHabitFields(h.id, { active: false });
    expect(index.snapshot.habits.get(h.id)!.active).toBe(false);
  });
});

describe('daily template', () => {
  it('evaluates moment() chains, offsets and lowercase yyyy from the real daily template', () => {
    const tpl = `---
title: <% tp.file.title %>
week: "[[<% moment(tp.file.title, 'DD, dddd, MMM, YYYY').format('YYYY-[W]WW') %>]]"
creation_date: <% tp.date.now("yyyy-MM-DD") %>
---
<%tp.web.daily_quote()%>  
Previous day: [[<% fileDate = moment(tp.file.title, 'DD, dddd, MMM, YYYY').subtract(1, 'd').format('DD, dddd, MMM, YYYY') %>|Yesterday]]  
Next day: [[<% fileDate = moment(tp.file.title, 'DD, dddd, MMM, YYYY').add(1, 'd').format('DD, dddd, MMM, YYYY') %>|Tomorrow]]
Next week: <% tp.date.now("YYYY-MM-DD", 7) %> · <% tp.date.tomorrow("DD") %>
`;
    expect(renderDailyTemplate(tpl, '2026-08-26', '26, Wednesday, Aug, 2026')).toBe(`---
title: 26, Wednesday, Aug, 2026
week: "[[2026-W35]]"
creation_date: 2026-08-26
---
  
Previous day: [[25, Tuesday, Aug, 2026|Yesterday]]  
Next day: [[27, Thursday, Aug, 2026|Tomorrow]]
Next week: 2026-09-02 · 27
`);
  });

  it('hands a Templater template to the engine when one is available', async () => {
    const { m, vault, index } = await setup();
    const { Mutations } = await import('../../src/data/mutations');
    const calls: string[] = [];
    const m2 = new Mutations({ vault, index, settings: () => (m as unknown as { d: { settings: () => typeof SETTINGS } }).d.settings(), today: () => TODAY, notify: () => undefined, dailyTemplate: async () => '<% tp.web.daily_quote() %>\n# {{title}}\n', processTemplate: async (p) => { calls.push(p); await vault.write(p, '> a quote\n# processed\n'); return true; } });
    const path = await m2.ensureDailyNote('2026-08-28');
    expect(calls).toEqual([path]);
    expect(await vault.read(path)).toBe('> a quote\n# processed\n');
    await m2.addTask({ text: 'After templater', date: '2026-08-28' });
    expect(await vault.read(path)).toBe('> a quote\n\n## Plan\n### Anytime\n- [ ] After templater\n\n# processed\n');
  });

  it('renders core and Templater placeholders', () => {
    const tpl = '---\ntitle: <% tp.file.title %>\ncreation_date: <% tp.date.now("YYYY-MM-DD") %>\n---\n<%tp.web.daily_quote()%>\n{{date:dddd}} {{title}}\n';
    expect(renderDailyTemplate(tpl, '2026-08-26', '26, Wednesday, Aug, 2026')).toBe('---\ntitle: 26, Wednesday, Aug, 2026\ncreation_date: 2026-08-26\n---\n\nWednesday 26, Wednesday, Aug, 2026\n');
    expect(renderDailyTemplate(undefined, '2026-08-26', 'X')).toContain('# X');
  });
});

describe('working inside the user\'s own Day planner sections', () => {
  const REAL = `---
title: 26, Wednesday, Aug, 2026
Type: Daily Note
tags:
  - dailynotes
---

> [!quote] Decide what you want.
Previous day: [[25, Tuesday, Aug, 2026|Yesterday]]  
Next day: [[27, Thursday, Aug, 2026|Tomorrow]]

# Backlog Tasks

[[Backlog Tasks]]

# Day planner

### A. Morning

- 🎂 No birthdays today — next: Gaurav on 07 Sep
- [ ] 07:00 - 08:00: 
- [ ] 08:00 - 09:00: Start with OCI Infra Builder (OIB)
- [ ] 09:00 - 10:00: 

---
### B. Afternoon

- [ ] 12:00 - 13:00: 
- [ ] 15:00 - 16:00: Search for a plumber

---
### C. Evening

- [ ] 18:00 - 19:00: 
`;
  it('inserts into the existing sections and leaves every other byte alone', async () => {
    const { m, vault, index } = await setup({ [dailyPath(TODAY)]: REAL });
    await m.addTask({ text: 'Close the original task', date: TODAY, part: 'afternoon' });
    await m.schedule('tsk-0001', TODAY, 'morning');
    await m.planDay(TODAY, []); // habits
    const out = await vault.read(dailyPath(TODAY));
    expect(out).toBe(REAL
      .replace('# Day planner\n\n### A. Morning', '# Day planner\n\n### Habits\n- [ ] Evening reading 🆔 hab-read\n- [ ] 🏃 Morning workout 🆔 hab-workout\n\n### A. Morning')
      .replace('- [ ] 09:00 - 10:00: \n', '- [ ] 09:00 - 10:00: \n- [ ] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]]\n')
      .replace('- [ ] 15:00 - 16:00: Search for a plumber\n', '- [ ] 15:00 - 16:00: Search for a plumber\n- [ ] Close the original task\n'));
    expect(out).not.toContain('## Plan');
    // The planner slot with text is a real afternoon task; empty slots are not tasks.
    const plumber = index.allTasks().find((t) => t.text === 'Search for a plumber')!;
    expect(plumber.section).toBe('afternoon');
    expect(index.tasksInFile(dailyPath(TODAY)).map((t) => t.text)).not.toContain('');
    // Move the project task to the evening, tick the plumber, roll the rest to tomorrow.
    await m.setPart(`tsk-0001@${TODAY}`, 'evening');
    await m.setStatus(plumber.key, 'done');
    const out2 = await vault.read(dailyPath(TODAY));
    expect(out2).toContain('### C. Evening\n\n- [ ] 18:00 - 19:00: \n- [ ] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]]\n');
    expect(out2).toContain('- [x] 15:00 - 16:00: Search for a plumber ✅ 2026-08-26');
    expect(out2).not.toContain('- [ ] 09:00 - 10:00: \n- [ ] Draft');
    expect(out2).toContain('- 🎂 No birthdays today');
    expect(out2.split('---\n### B. Afternoon')).toHaveLength(2);
  });
});

describe('stray lines', () => {
  it('a task outside the plan sections can be pulled into a part of the day', async () => {
    const note = `---\ntitle: 26, Wednesday, Aug, 2026\n---\n\n## Plan\n### Afternoon\n- [ ] Close the original task\n\n# Day planner\n\n### A. Morning\n\n- [ ] 07:00 - 08:00: \n\n### B. Afternoon\n\n- [ ] 15:00 - 16:00: Search for a plumber\n`;
    const { m, vault, index } = await setup({ [dailyPath(TODAY)]: note });
    const stray = index.allTasks().find((t) => t.text === 'Close the original task')!;
    expect(stray.section).toBe('outside');
    await m.setPart(stray.key, 'afternoon');
    expect(await vault.read(dailyPath(TODAY))).toBe(`---\ntitle: 26, Wednesday, Aug, 2026\n---\n\n## Plan\n### Afternoon\n\n# Day planner\n\n### A. Morning\n\n- [ ] 07:00 - 08:00: \n\n### B. Afternoon\n\n- [ ] 15:00 - 16:00: Search for a plumber\n- [ ] Close the original task\n`);
  });
});

describe('recurring tasks spawned in old notes', () => {
  const MONDAY = `---\ntitle: 24, Monday, Aug, 2026\n---\n\n# Day planner\n\n### A. Morning\n\n- [ ] 07:00 - 08:00: Infuus vervangen 📅 2026-08-31 🔁 every week on monday\n- [x] 07:00 - 08:00: Infuus vervangen 📅 2026-08-24 🔁 every week on monday ✅ 2026-08-24\n- [ ] 09:00 - 10:00: Something left undone\n`;
  it('are planned on their date, not carried over, and get moved to that note', async () => {
    const { m, vault, index, settings } = await setup({ [dailyPath('2026-08-24')]: MONDAY });
    const next = index.allTasks().find((t) => t.text === 'Infuus vervangen' && t.status === 'todo')!;
    const { candidates, plannedDate, dayPlan } = await import('../../src/data/planner');
    expect(plannedDate(next)).toBe('2026-08-31');
    expect(candidates(index.snapshot, TODAY, settings, TODAY).some((c) => c.task.key === next.key)).toBe(false);
    expect(candidates(index.snapshot, TODAY, settings, TODAY).some((c) => c.task.text === 'Something left undone' && c.reason === 'scheduled-past')).toBe(true);
    expect(dayPlan(index.snapshot, '2026-08-24', settings).today.filter((t) => t.status === 'todo').map((t) => t.text)).toEqual(['Something left undone']);
    expect(dayPlan(index.snapshot, '2026-08-31', settings).today.map((t) => t.text)).toEqual(['Infuus vervangen']);
    const r = await m.rollover('2026-08-24', TODAY);
    expect(r.moved).toBe(1);
    expect(await m.moveMisfiled({ onlyFuture: true })).toBe(1);
    const moved = await m.moveMisfiled();
    expect(moved).toBe(0);
    const monday = await vault.read(dailyPath('2026-08-24'));
    expect(monday).not.toContain('📅 2026-08-31');
    expect(monday).toContain('- [x] 07:00 - 08:00: Infuus vervangen 📅 2026-08-24');
    const nextMonday = await vault.read('70 OBSIDIAN/70-06 Daily Notes/2026/08 - August/36/31, Monday, Aug, 2026.md');
    expect(nextMonday).toContain('### Morning\n- [ ] 07:00 - 08:00: Infuus vervangen 📅 2026-08-31 🔁 every week on monday');
    expect(await m.reconcile()).toBe(0);
  });
  it('the automatic pass leaves old misfiled lines alone', async () => {
    const { m, vault } = await setup({ [dailyPath('2026-08-24')]: `# Day planner\n\n### A. Morning\n\n- [ ] Old thing 📅 2026-08-25\n` });
    expect(await m.moveMisfiled({ onlyFuture: true })).toBe(0);
    expect(await vault.read(dailyPath('2026-08-24'))).toContain('- [ ] Old thing 📅 2026-08-25');
    expect(await m.moveMisfiled()).toBe(1);
    expect(await vault.read(dailyPath('2026-08-25'))).toContain('- [ ] Old thing 📅 2026-08-25');
  });
});

describe('timed lines are kept in time order', () => {
  const NOTE = `# Day planner\n\n### A. Morning\n\n- [ ] 07:00 - 08:00: \n- [ ] 09:00 - 10:00: \n\n### B. Afternoon\n\n- [ ] 13:00 - 14:00: Clean up email\n- [ ] 16:00 - 17:00: \n`;
  it('a captured task with a time slots in chronologically and by part', async () => {
    const { m, vault } = await setup({ [dailyPath(TODAY)]: NOTE });
    await m.addTask({ text: 'Standup', date: TODAY, fields: { time: { start: '08:00', end: '08:30' } } });
    await m.addTask({ text: 'Dentist', date: TODAY, fields: { time: { start: '14:30' } } });
    await m.addTask({ text: 'Late one', date: TODAY, fields: { time: { start: '17:30' } } });
    await m.addTask({ text: 'No time', date: TODAY, part: 'afternoon' });
    expect(await vault.read(dailyPath(TODAY))).toBe(`# Day planner\n\n### A. Morning\n\n- [ ] 07:00 - 08:00: \n- [ ] 08:00 - 08:30: Standup\n- [ ] 09:00 - 10:00: \n\n### B. Afternoon\n\n- [ ] 13:00 - 14:00: Clean up email\n- [ ] 14:30: Dentist\n- [ ] 16:00 - 17:00: \n- [ ] 17:30: Late one\n- [ ] No time\n`);
  });
});
