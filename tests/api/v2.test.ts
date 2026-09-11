import { describe, expect, it } from 'vitest';
import { setup, TODAY } from '../data/fixture';
import { handle, type ApiDeps, type ApiRequest } from '../../src/api/routes';
import type { HelmSettings } from '../../src/core/types';

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function api(extra: Record<string, string> = {}, settings: Partial<HelmSettings> = {}) {
  const s = await setup(extra, settings);
  const written: string[] = [];
  const origWrite = s.vault.write.bind(s.vault);
  s.vault.write = async (p: string, c: string) => { written.push(p); await origWrite(p, c); };
  const deps: ApiDeps = {
    index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: '9.9.9', vaultName: 'Test vault', read: (p) => s.vault.read(p), readBinary: (p) => s.vault.readBinary(p),
    written: () => { const w = [...new Set(written)]; written.length = 0; return w; },
  };
  const call = (method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<{ status: number; body: any; raw?: any }> =>
    handle({ method, path, query, body } as ApiRequest, deps) as Promise<{ status: number; body: any; raw?: any }>;
  return { ...s, call };
}

describe('v2 · health, settings and task serialisation', () => {
  it('health says api 2, carries a revision that moves on every change, the vault name and the week start', async () => {
    const { call } = await api();
    const h1 = (await call('GET', 'health')).body;
    expect(h1).toMatchObject({ ok: true, api: 2, vault: 'Test vault', weekStartsOn: 1 });
    expect(typeof h1.revision).toBe('number');
    await call('POST', 'tasks', { text: 'Bump the revision' });
    const h2 = (await call('GET', 'health')).body;
    expect(h2.revision).toBeGreaterThan(h1.revision);
  });

  it('serves the client-relevant settings', async () => {
    const { call } = await api();
    const r = await call('GET', 'settings');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ dayStarts: '08:00', dailyCapacityMinutes: 360, weekStartsOn: 1, inboxNote: '01 INBOX/Inbox.md', captureTags: ['meeting', 'followup', 'task'] });
    expect(r.body.focus).toEqual({ focusMaxMinutes: 50, focusMinMinutes: 15, breakMinutes: 5, longBreakMinutes: 20, blocksBeforeLongBreak: 3 });
    expect(await call('POST', 'settings')).toMatchObject({ status: 405 });
  });

  it('fetches tasks by a list of refs, in the order asked, skipping unknown ones', async () => {
    const { call } = await api();
    const r = await call('GET', 'tasks', undefined, { ids: 'tsk-0002,tsk-nope,tsk-0001' });
    expect(r.status).toBe(200);
    expect(r.body.tasks.map((t: any) => t.id)).toEqual(['tsk-0002', 'tsk-0001']);
    expect((await call('GET', 'tasks', undefined, { ids: '' })).body.tasks).toEqual([]);
  });

  it('extends task JSON with the v2 fields and returns the whole tree, follow-ups and attachments on GET /tasks/:id', async () => {
    const { call, m } = await api({ '81 AI/Chapter notes.md': '---\nhelm-task: tsk-0001\n---\n# Chapter notes\n' });
    const t = (await call('GET', 'tasks/tsk-0001')).body;
    expect(t).toMatchObject({ id: 'tsk-0001', ref: 'tsk-0001', title: 'Draft chapter list', priority: 'high', phaseId: 'prj-book#outline', projectTitle: 'Oracle Book Writing', progress: null, effortRaw: null, timeBlock: null, mirrorOf: null, follows: null });
    expect(t.children).toHaveLength(1);
    expect(t.children[0]).toMatchObject({ text: 'Collect diagrams', status: 'done', children: [] });
    expect(t.attachments.notes.map((n: any) => n.path)).toEqual(['81 AI/Chapter notes.md']);
    // A follow-up is a task blocked on the original's id.
    await m.followUp('tsk-0002', { date: TODAY });
    const again = (await call('GET', 'tasks/tsk-0002')).body;
    expect(again.followUps).toHaveLength(1);
    const fu = (await call('GET', `tasks/${again.followUps[0]}`)).body;
    expect(fu.follows).toBe('tsk-0002');
    // The list keeps the flat one-level summary.
    const list = (await call('GET', 'tasks', undefined, { ids: 'tsk-0001' })).body.tasks[0];
    expect(list.children).toBeUndefined();
    expect(list.subtasks[0]).toMatchObject({ text: 'Collect diagrams', ref: expect.any(String) });
    expect((await call('GET', 'tasks/tsk-nope')).status).toBe(404);
  });

  it('a mirrored daily line names its source by ref and a timed line carries a time block', async () => {
    const { call } = await api();
    const r = await call('POST', 'tasks', { text: 'Stand-up', scheduled: TODAY, time: '09:00', timeEnd: '09:15', effortMinutes: 15 });
    expect(r.body.task).toMatchObject({ time: '09:00', timeEnd: '09:15', timeBlock: { start: '09:00', end: '09:15' }, effortRaw: '15m', noteDate: TODAY });
    const mirror = (await call('GET', 'tasks', undefined, { date: TODAY, status: 'all' })).body.tasks.find((t: any) => t.text === 'Chapter 1');
    expect(mirror).toBeUndefined(); // mirrors stay out of the list; the source shows instead
  });
});

describe('v2 · the day', () => {
  it('serves a day the way the Today tab reads it: parts, time blocks, done, habits, daybook, timeline', async () => {
    const { call } = await api();
    const r = await call('GET', 'day/2026-08-25');
    expect(r.status).toBe(200);
    const d = r.body;
    expect(d).toMatchObject({ date: '2026-08-25', isToday: false, capacityMinutes: 360 });
    expect(d.notePath).toContain('25, Tuesday');
    const all = [...d.byPart.morning, ...d.byPart.afternoon, ...d.byPart.evening, ...d.byPart.anytime];
    expect(all.some((it: any) => it.task.text === 'Fix router config' && it.kind === 'daily')).toBe(true);
    expect(all.some((it: any) => it.kind === 'mirror' && it.task.text === 'Chapter 1' && it.display === null)).toBe(true);
    expect(d.done.map((t: any) => t.text)).toContain('Pay invoice');
    // A timed line inside a Helm section is a daily item in its part (only lines outside the region become time blocks).
    expect(d.byPart.morning.some((it: any) => it.task.text === 'Start with OIB' && it.task.time === '08:00')).toBe(true);
    expect(d.timeBlocks).toEqual([]);
    expect(d.habits.map((h: any) => h.id).sort()).toEqual(['hab-read', 'hab-workout']);
    const workout = d.habits.find((h: any) => h.id === 'hab-workout');
    expect(workout.occurrences).toEqual([{ part: null, state: 'done', line: expect.any(Number) }]);
    expect(d.daybook).toEqual({ heading: null, entries: [] });
    expect(d.timeline.timed.some((e: any) => e.task.text === 'Start with OIB' && e.start === 8 * 60)).toBe(true);
    expect((await call('GET', 'day/friday')).status).toBe(400);
    expect((await call('PUT', 'day/2026-08-25')).status).toBe(405);
  });

  it('creates the note and syncs the habits on demand', async () => {
    const { call, vault } = await api();
    const note = await call('POST', 'day/2026-08-27/note');
    expect(note.status).toBe(200);
    expect(note.body.path).toContain('27, Thursday');
    expect(await vault.exists(note.body.path)).toBe(true);
    const habits = await call('POST', 'day/2026-08-27/habits');
    expect(habits.body.added).toBe(true);
    expect(await vault.read(note.body.path)).toContain('hab-workout');
  });

  it('ranks candidates and writes a plan the way the modal does, removing what was dropped', async () => {
    const { call, vault } = await api();
    const c = await call('GET', `day/${TODAY}/candidates`);
    expect(c.status).toBe(200);
    expect(c.body.capacityMinutes).toBe(360);
    expect(c.body.candidates.length).toBeGreaterThan(0);
    expect(c.body.candidates[0]).toMatchObject({ reason: expect.any(String), score: expect.any(Number), minutes: expect.any(Number) });
    const overdue = c.body.candidates.find((x: any) => x.task.text === 'Renew passport');
    expect(overdue.reason).toBe('overdue');
    const plumber = c.body.candidates.find((x: any) => x.task.text === 'Call the plumber');
    const r = await call('POST', `day/${TODAY}/plan`, { items: [{ ref: plumber.task.ref, part: 'afternoon' }, { ref: 'tsk-0001' }] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ planned: 2, removed: 0 });
    const note = await vault.read(r.body.written.find((p: string) => p.includes('26, Wednesday')));
    expect(note).toContain('Call the plumber');
    expect(note).toContain('tsk-0001');
    expect(note).toContain('hab-workout'); // habits come along, as in the modal
    const rem = await call('POST', `day/${TODAY}/plan`, { items: [], remove: ['tsk-0001'] });
    expect(rem.body.removed).toBe(1);
    expect(await vault.read(note ? r.body.written[0] : '')).not.toContain('tsk-0001');
    expect((await call('POST', `day/${TODAY}/plan`, {})).status).toBe(400);
    expect((await call('POST', `day/${TODAY}/plan`, { items: [{ ref: 'tsk-nope' }] })).status).toBe(404);
  });

  it('lists what wrap-up would ask about and applies the decisions in order, continuing past a failure', async () => {
    const { call, index, vault } = await api();
    const g = await call('GET', 'day/2026-08-25/wrapup');
    expect(g.status).toBe(200);
    expect(g.body).toMatchObject({ suggestedDate: '2026-08-26', rolloverTarget: 'tomorrow' });
    const texts = g.body.open.map((it: any) => it.task.text);
    expect(texts).toContain('Fix router config');
    expect(texts).toContain('Chapter 1');
    expect(texts).not.toContain('Pay invoice'); // done already
    expect(g.body.projectsTouched).toEqual([]); // the fixture's mirror has no resolvable source, so no project is touched
    const router = g.body.open.find((it: any) => it.task.text === 'Fix router config').task;
    const chapter = g.body.open.find((it: any) => it.task.text === 'Chapter 1').task;
    const r = await call('POST', 'day/2026-08-25/wrapup', {
      decisions: [{ ref: router.ref, fate: 'date', date: '2026-08-28', part: 'morning' }, { ref: chapter.ref, fate: 'done' }, { ref: 'tsk-nope', fate: 'tomorrow' }],
      log: [{ projectId: 'prj-book', text: 'Wrapped the day.' }],
    });
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(2);
    expect(r.body.failed).toEqual([{ ref: 'tsk-nope', error: 'No task tsk-nope' }]);
    expect(index.task('tsk-0003@2026-08-25')!.status).toBe('done');
    expect([...index.snapshot.tasks.values()].some((t) => t.text === 'Fix router config' && t.noteDate === '2026-08-28')).toBe(true);
    expect(await vault.read('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')).toContain('Wrapped the day.');
    expect((await call('POST', 'day/2026-08-25/wrapup', { decisions: [{ ref: router.ref, fate: 'sideways' }] })).status).toBe(400);
    expect((await call('POST', 'day/2026-08-25/wrapup', {})).status).toBe(400);
  });

  it('rolls a day over', async () => {
    const { call } = await api();
    const r = await call('POST', 'day/2026-08-25/rollover', { to: '2026-08-27' });
    expect(r.status).toBe(200);
    expect(r.body.moved).toBeGreaterThan(0);
    expect(r.body.written.some((p: string) => p.includes('27, Thursday'))).toBe(true);
    expect((await call('POST', 'day/2026-08-25/rollover', { to: 'never' })).status).toBe(400);
  });

  it('writes, edits, replies to and removes daybook entries', async () => {
    const { call } = await api();
    const a = await call('POST', `day/${TODAY}/daybook`, { text: 'Started on the outline', time: '09:15' });
    expect(a.status).toBe(201);
    expect(a.body.entries).toHaveLength(1);
    const line = a.body.entries[0].line;
    expect(a.body.entries[0]).toMatchObject({ time: '09:15', text: 'Started on the outline', replies: [] });
    const rep = await call('POST', `day/${TODAY}/daybook/${line}/replies`, { text: 'Went well' });
    expect(rep.status).toBe(201);
    expect(rep.body.entries[0].replies).toEqual([{ text: 'Went well', icon: '💬', line: line + 1 }]);
    const ed = await call('PATCH', `day/${TODAY}/daybook/${line}`, { text: 'Started on the outline, properly' });
    expect(ed.body.entries[0].text).toBe('Started on the outline, properly');
    const day = await call('GET', `day/${TODAY}`);
    expect(day.body.daybook.heading).toEqual(expect.any(Number));
    expect((await call('DELETE', `day/${TODAY}/daybook/999`)).status).toBe(404);
    const del = await call('DELETE', `day/${TODAY}/daybook/${line}`);
    expect(del.body.entries).toEqual([]);
    expect((await call('POST', `day/${TODAY}/daybook`, {})).status).toBe(400);
  });

  it('lays a focus day out with the pomodoro settings around what is booked', async () => {
    const { call } = await api();
    const r = await call('POST', 'focus/layout', { start: '09:00', date: '2026-08-25', tasks: [{ ref: 'tsk-0001', minutes: 120 }, { ref: 'tsk-0002' }] });
    expect(r.status).toBe(200);
    expect(r.body.blocks[0]).toMatchObject({ taskKey: 'tsk-0001', kind: 'focus', start: '09:00', index: 1, of: 3 });
    expect(r.body.blocks.some((b: any) => b.kind === 'break')).toBe(true);
    expect(r.body.focusMinutes).toBe(120 + 30);
    expect(r.body.busy).toEqual([{ start: '08:00', end: '09:00' }]);
    expect((await call('POST', 'focus/layout', { tasks: [] })).status).toBe(400);
  });
});

const YEARLY = `---
title: 2026
---
# 2026

## Goals

- [ ] Publish the OCI networking book 🆔 gol-book26
- [x] Get OCI certified 🆔 gol-cert26 ✅ 2026-06-01
`;
const HORIZON_EXTRA = {
  'Yearly Notes/2026.md': YEARLY,
  'Quarterly Notes/2026-Q3.md': '---\ntitle: 2026-Q3\n---\n# Q3 2026\n\n## Goals\n\n- [ ] Finish the kitchen design\n',
  '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md': `---\ntitle: Oracle Book Writing\ntype: project\nstatus: active\npriority: high\nid: prj-book\nperiod: 2026-Q3\ngoal: gol-book26\n---\n\n# Oracle Book Writing\n\n## Tasks\n\n- [ ] Draft chapter list 🆔 tsk-0001\n- [x] Kick-off call ✅ 2026-08-10\n`,
};

describe('v2 · habits', () => {
  it('lists habits with their stats, all=true adds paused and ghost habits, and one habit can carry its history', async () => {
    const { call, m } = await api();
    const list = await call('GET', 'habits');
    expect(list.status).toBe(200);
    expect(list.body.habits.map((h: any) => h.id).sort()).toEqual(['hab-read', 'hab-workout']);
    const workout = list.body.habits.find((h: any) => h.id === 'hab-workout');
    expect(workout).toMatchObject({ title: 'Morning workout', icon: '🏃', active: true, schedule: { raw: 'every weekday', frequency: 'weekly' }, parts: [] });
    expect(workout.stats).toMatchObject({ dueToday: true, streak: expect.any(Number), days: expect.any(Array) });
    expect(workout.stats.days).toHaveLength(84);
    await m.setHabitFields('hab-read', { active: false });
    expect((await call('GET', 'habits')).body.habits.map((h: any) => h.id)).toEqual(['hab-workout']);
    expect((await call('GET', 'habits', undefined, { all: 'true' })).body.habits.map((h: any) => h.id).sort()).toEqual(['hab-read', 'hab-workout']);
    const one = await call('GET', 'habits/hab-workout', undefined, { history: 'week' });
    expect(one.body.history).toMatchObject({ kind: 'week', due: expect.any(Number), done: expect.any(Number), rate: expect.any(Number), from: expect.any(String) });
    expect(one.body.history.periods[0]).toMatchObject({ kind: 'week', key: expect.stringMatching(/^\d{4}-W\d{2}$/) });
    expect(one.body.history.cells).toHaveLength(one.body.history.periods.length);
    expect((await call('GET', 'habits/hab-workout', undefined, { history: 'fortnight' })).status).toBe(400);
    expect((await call('GET', 'habits/hab-nope')).status).toBe(404);
  });

  it('creates, edits, pauses, resumes and deletes a habit', async () => {
    const { call, vault } = await api();
    const bad = await call('POST', 'habits', { title: 'Stretch', schedule: 'whenever' });
    expect(bad.status).toBe(400);
    const r = await call('POST', 'habits', { title: 'Stretch', schedule: 'every day', parts: ['morning', 'evening'], color: 'green', icon: '🧘' });
    expect(r.status).toBe(201);
    expect(r.body.habit).toMatchObject({ title: 'Stretch', parts: ['morning', 'evening'], color: 'green', icon: '🧘', active: true });
    const id = r.body.habit.id;
    expect(await vault.exists(r.body.habit.path)).toBe(true);
    const ed = await call('PATCH', `habits/${id}`, { title: 'Stretch well', graceDays: 2, targetPerWeek: 5 });
    expect(ed.body.habit).toMatchObject({ title: 'Stretch well', graceDays: 2, targetPerWeek: 5 });
    expect((await call('PATCH', `habits/${id}`, { color: 'beige' })).status).toBe(400);
    expect((await call('PATCH', `habits/${id}`, {})).status).toBe(400);
    const paused = await call('POST', `habits/${id}/pause`);
    expect(paused.body.habit.active).toBe(false);
    expect(paused.body.habit.pauses).toEqual([{ from: TODAY }]);
    expect((await call('POST', `habits/${id}/pause`)).status).toBe(400);
    expect((await call('POST', `habits/${id}/resume`)).body.habit.active).toBe(true);
    const del = await call('DELETE', `habits/${id}`);
    expect(del.status).toBe(200);
    expect((await call('GET', `habits/${id}`)).status).toBe(404);
  });

  it('ticks, skips and clears an occurrence the way the Today tab does, and moves a habit into a part for a day', async () => {
    const { call, vault, index } = await api();
    const done = await call('POST', 'habits/hab-workout/state', { date: TODAY, state: 'done' });
    expect(done.status).toBe(200);
    expect(done.body.occurrences).toEqual([{ part: null, state: 'done', line: expect.any(Number) }]);
    const note = await vault.read(index.dailyPath(TODAY));
    expect(note).toMatch(/- \[x\] 🏃 Morning workout 🆔 hab-workout ✅ 2026-08-26/);
    const cleared = await call('POST', 'habits/hab-workout/state', { date: TODAY, state: 'pending' });
    expect(cleared.body.occurrences[0].state).toBe('missed'); // the line is back to `[ ]`; a present, unticked line reads as missed (pending = no line at all)
    expect(await vault.read(index.dailyPath(TODAY))).toMatch(/- \[ \] 🏃 Morning workout 🆔 hab-workout/);
    const skipped = await call('POST', 'habits/hab-workout/state', { date: TODAY, state: 'skipped' });
    expect(skipped.body.occurrences[0].state).toBe('skipped');
    expect((await call('POST', 'habits/hab-workout/state', { date: TODAY, state: 'maybe' })).status).toBe(400);
    const moved = await call('POST', 'habits/hab-read/move', { date: TODAY, part: 'evening' });
    expect(moved.status).toBe(200);
    const d = await call('GET', `day/${TODAY}`);
    expect(d.body.habits.find((h: any) => h.id === 'hab-read').occurrences[0].part).toBe('evening');
    expect((await call('POST', 'habits/hab-read/move', { date: TODAY, part: 'night' })).status).toBe(400);
  });
});

describe('v2 · inbox, week, calendar, periods, horizons, goals', () => {
  it('serves the inbox grouped like the Inbox tab', async () => {
    const { call } = await api();
    const r = await call('GET', 'inbox');
    expect(r.status).toBe(200);
    expect(r.body.inbox.map((t: any) => t.text)).toEqual(['Call the plumber', 'Renew passport']);
    expect(r.body.loose).toEqual([{ path: '02 PROJECTS/Backlog Tasks.md', title: 'Backlog Tasks', count: 1, tasks: [expect.objectContaining({ text: 'Learn Rust' })] }]);
    expect(r.body.unscheduledProject.map((t: any) => t.text)).toContain('Get three quotes');
  });

  it('serves a week and a calendar range, with refs by default and tasks on request', async () => {
    const { call } = await api();
    const w = await call('GET', 'week', undefined, { anchor: TODAY });
    expect(w.status).toBe(200);
    expect(w.body).toMatchObject({ start: '2026-08-24', end: '2026-08-30', capacityMinutes: 360 });
    expect(w.body.days).toHaveLength(7);
    const tue = w.body.days.find((x: any) => x.date === '2026-08-25');
    expect(tue.open.map((t: any) => t.text)).toContain('Fix router config');
    expect(tue.done.map((t: any) => t.text)).toContain('Pay invoice');
    expect(w.body.overdue.length).toBeGreaterThan(0);
    expect((await call('GET', 'week', undefined, { anchor: 'monday' })).status).toBe(400);

    const c = await call('GET', 'calendar', undefined, { from: '2026-08-24', to: '2026-08-30' });
    expect(c.body.days).toHaveLength(7);
    const cTue = c.body.days.find((x: any) => x.date === '2026-08-25');
    expect(cTue).toMatchObject({ open: expect.any(Number), done: 1, openRefs: expect.any(Array), doneRefs: expect.any(Array) });
    expect(cTue.openRefs.every((r: string) => typeof r === 'string')).toBe(true);
    const cEmbed = await call('GET', 'calendar', undefined, { from: '2026-08-25', to: '2026-08-25', tasks: 'true' });
    expect(cEmbed.body.days[0].doneTasks[0]).toMatchObject({ text: 'Pay invoice' });
    expect((await call('GET', 'calendar', undefined, { from: '2026-01-01', to: '2027-12-31' })).status).toBe(400);
    expect((await call('GET', 'calendar', undefined, { from: '2026-01-01' })).status).toBe(400);
  });

  it('serves a period, the horizons of a year, and creates a periodic note', async () => {
    const { call, vault } = await api(HORIZON_EXTRA);
    const q = await call('GET', 'periods/2026-Q3');
    expect(q.status).toBe(200);
    expect(q.body.period).toMatchObject({ key: '2026-Q3', kind: 'quarter', from: '2026-07-01', to: '2026-09-30', notePath: 'Quarterly Notes/2026-Q3.md' });
    expect(q.body.projects.map((p: any) => p.id)).toEqual(['prj-book']);
    expect(q.body.projects[0].health).toMatchObject({ total: 2, done: 1 });
    expect(q.body.goals[0]).toMatchObject({ text: 'Finish the kitchen design', periodKey: '2026-Q3', progress: 0 });
    expect(q.body.isCurrent).toBe(true);
    const y = await call('GET', 'horizons', undefined, { year: '2026' });
    expect(y.body.quarters).toHaveLength(4);
    expect(y.body.months).toHaveLength(12);
    expect(y.body.year.goals.map((g: any) => g.id)).toEqual(['gol-book26', 'gol-cert26']);
    expect(y.body.year.goals[0]).toMatchObject({ projectIds: ['prj-book'], taskTotal: 2, taskDone: 1, progress: 0.5 });
    expect(y.body.current).toMatchObject({ quarter: '2026-Q3', month: '2026-08' });
    expect((await call('GET', 'periods/soon')).status).toBe(400);
    const wk = await call('GET', 'periods/2026-W35');
    expect(wk.body.period).toMatchObject({ kind: 'week', from: '2026-08-24', notePath: null });
    const made = await call('POST', 'periods/2026-W35/note');
    expect(made.status).toBe(200);
    expect(made.body.path).toBe('Weekly Notes/2026-W35.md');
    expect(await vault.exists('Weekly Notes/2026-W35.md')).toBe(true);
  });

  it('adds, edits, links and deletes goals', async () => {
    const { call, vault } = await api(HORIZON_EXTRA);
    const r = await call('POST', 'goals', { periodKey: '2026-09', text: 'Two practice tests' });
    expect(r.status).toBe(201);
    expect(r.body.goal).toMatchObject({ text: 'Two practice tests', periodKey: '2026-09', status: 'todo' });
    expect(r.body.goal.id).toMatch(/^gol-/);
    expect(await vault.read('Monthly Notes/2026-09.md')).toContain('Two practice tests');
    const list = await call('GET', 'goals', undefined, { period: '2026-09' });
    expect(list.body.goals.map((g: any) => g.id)).toEqual([r.body.goal.id]);
    const ed = await call('PATCH', `goals/${r.body.goal.id}`, { status: 'done', text: 'Two practice tests passed' });
    expect(ed.body.goal).toMatchObject({ status: 'done', text: 'Two practice tests passed', progress: 1 });
    expect((await call('PATCH', 'goals/gol-book26', { status: 'later' })).status).toBe(400);
    expect((await call('PATCH', 'goals/gol-nope', { status: 'done' })).status).toBe(404);
    const link = await call('POST', 'projects/prj-kitchen/goal', { goalKey: r.body.goal.id });
    expect(link.status).toBe(200);
    expect(link.body.project).toMatchObject({ goalId: r.body.goal.id, period: '2026-09' });
    const unlink = await call('POST', 'projects/prj-kitchen/goal', { goalKey: null });
    expect(unlink.body.project.goalId).toBeNull();
    expect((await call('POST', 'goals', { periodKey: 'someday', text: 'x' })).status).toBe(400);
    expect((await call('DELETE', `goals/${r.body.goal.id}`)).status).toBe(200);
    expect((await call('GET', 'goals', undefined, { period: '2026-09' })).body.goals).toEqual([]);
  });
});

describe('v2 · task extras', () => {
  it('patches time blocks, progress and recurrence, and refuses a parent change', async () => {
    const { call, vault } = await api();
    const t = (await call('POST', 'tasks', { text: 'Write the intro', scheduled: TODAY })).body.task;
    const timed = await call('PATCH', `tasks/${t.id}`, { time: '10:00', timeEnd: '10:45' });
    expect(timed.body.task).toMatchObject({ time: '10:00', timeEnd: '10:45' }); // the line keeps its section; a day view places it by time
    expect((await call('PATCH', `tasks/${t.id}`, { time: null })).body.task.time).toBeNull();
    expect((await call('PATCH', `tasks/${t.id}`, { time: 'ten' })).status).toBe(400);
    const prog = await call('PATCH', `tasks/${t.id}`, { progress: 40 });
    expect(prog.body.task).toMatchObject({ progress: 40, status: 'doing' });
    expect((await call('PATCH', `tasks/${t.id}`, { progress: 100 })).body.task.status).toBe('done');
    expect((await call('PATCH', `tasks/${t.id}`, { progress: 150 })).status).toBe(400);
    const rec = await call('PATCH', `tasks/${t.id}`, { recurrence: 'every week on monday' });
    expect(rec.body.task).toMatchObject({ recurrence: 'every week on monday', recurrenceParsed: { frequency: 'weekly', weekdays: [1] } });
    expect(await vault.read(t.path)).toContain('🔁 every week on monday');
    expect((await call('PATCH', `tasks/${t.id}`, { recurrence: 'whenever' })).status).toBe(400);
    expect((await call('PATCH', `tasks/${t.id}`, { recurrence: null })).body.task.recurrence).toBeNull();
    expect((await call('PATCH', `tasks/${t.id}`, { parentId: 'tsk-0001' })).status).toBe(400);
  });

  it('stops a task repeating', async () => {
    const { call } = await api();
    expect((await call('POST', 'tasks/tsk-0001/stop-repeating')).status).toBe(400); // does not repeat
    const r = await call('POST', 'tasks/tsk-0002/stop-repeating');
    expect(r.status).toBe(200);
    expect(r.body.task.recurrence).toBeNull();
  });

  it('follows a task up on another day', async () => {
    const { call, index } = await api();
    const r = await call('POST', 'tasks/tsk-0002/followup', { date: '2026-08-28', part: 'morning', text: 'Chapter 2 — second pass', addTag: true, markOriginalDone: false });
    expect(r.status).toBe(201);
    expect(r.body.followUp).toMatchObject({ text: 'Chapter 2 — second pass #followup', blockedBy: ['tsk-0002'], scheduled: '2026-08-28' });
    expect(r.body.followUp.project.id).toBe('prj-book');
    expect(index.taskById('tsk-0002')!.status).toBe('todo');
    expect((await call('POST', 'tasks/tsk-0002/followup', {})).status).toBe(400);
    await expect(call('POST', 'tasks/tsk-0001/followup', { date: '2026-08-28' })).rejects.toThrow(/subtasks/); // Helm refuses; the server turns that into a 500
  });

  it('plans a task into a time slot on a day', async () => {
    const { call } = await api();
    const r = await call('POST', 'tasks/tsk-0002/plan-into', { date: '2026-08-27', time: { start: '14:00', end: '15:30' }, effortMinutes: 90 });
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({ scheduled: '2026-08-27', time: '14:00', timeEnd: '15:30', effortMinutes: 90 });
    expect((await call('POST', 'tasks/tsk-0002/plan-into', { date: '2026-08-27' })).status).toBe(400);
  });

  it('turns a task into a project, carrying what was attached', async () => {
    const { call, index } = await api({ '81 AI/Cert research.md': '---\nhelm-task: tsk-grow\n---\n# Cert research\n' });
    const t = (await call('POST', 'tasks', { text: 'Build the cert lab [OCI docs](https://docs.example.com/oci)', scheduled: TODAY })).body.task;
    await index.rebuild();
    const grow = (await call('PATCH', `tasks/${t.id}`, { text: 'Build the cert lab [OCI docs](https://docs.example.com/oci)' })).body.task; // an id it can be attached by
    void grow;
    const r = await call('POST', `tasks/${t.id}/project`, { area: 'Oracle', status: 'active' });
    expect(r.status).toBe(201);
    expect(r.body.project).toMatchObject({ title: 'Build the cert lab', area: 'Oracle', status: 'active', links: [{ url: 'https://docs.example.com/oci', label: 'OCI docs' }] });
    expect(r.body.carried).toMatchObject({ links: 1 });
    expect((await call('POST', 'tasks/tsk-nope/project', {})).status).toBe(404);
    expect((await call('POST', 'tasks/tsk-0002/project', { status: 'sideways' })).status).toBe(400);
  });

  it('adds and removes links on a task and reorders subtasks', async () => {
    const { call } = await api();
    const added = await call('POST', 'tasks/tsk-0002/links', { url: 'https://example.com/spec', label: 'Spec' });
    expect(added.body.task.links).toEqual([{ url: 'https://example.com/spec', label: 'Spec' }]);
    expect((await call('POST', 'tasks/tsk-0002/links', { url: 'not a url' })).status).toBe(400);
    const removed = await call('DELETE', 'tasks/tsk-0002/links', { url: 'https://example.com/spec' });
    expect(removed.body.task.links).toEqual([]);

    const parent = (await call('POST', 'tasks', { text: 'Ship the draft', scheduled: TODAY })).body.task;
    const a = (await call('POST', `tasks/${parent.id}/subtasks`, { text: 'A' })).body.task;
    const b = (await call('POST', `tasks/${parent.id}/subtasks`, { text: 'B' })).body.task;
    const r = await call('POST', `tasks/${b.ref}/subtasks/reorder`, { beforeRef: a.ref });
    expect(r.status).toBe(200);
    expect((await call('GET', `tasks/${parent.id}`)).body.children.map((c: any) => c.text)).toEqual(['B', 'A']);
    expect((await call('POST', `tasks/${parent.id}/subtasks/reorder`, { beforeRef: null })).status).toBe(400); // not a subtask
  });
});

describe('v2 · projects', () => {
  it('serves the whole project page: phases with task trees, loose tasks, children, parent, goal, log, attachments', async () => {
    const { call, m } = await api({
      ...HORIZON_EXTRA,
      '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md': `---\ntitle: Oracle Book Writing\ntype: project\nstatus: active\npriority: high\nid: prj-book\nperiod: 2026-Q3\ngoal: gol-book26\n---\n\n# Oracle Book Writing\n\n## Phase: Outline 📅 2026-09-15\n\n- [ ] Draft chapter list 🆔 tsk-0001 ⏫\n\t- [x] Collect diagrams ✅ 2026-08-20\n- [x] Kick-off call ✅ 2026-08-10\n\n## Tasks\n\n- [ ] Buy reference books ⏱️ 45m\n\n## Log\n\n- 2026-08-20 — Outline approved.\n- 2026-08-22 — Editor booked.\n`,
      '81 AI/Book plan.md': '---\nhelm-project: prj-book\n---\n# Book plan\n',
    });
    const r = await call('GET', 'projects/prj-book');
    expect(r.status).toBe(200);
    const p = r.body;
    expect(p.phases).toHaveLength(1);
    expect(p.phases[0]).toMatchObject({ slug: 'outline', title: 'Outline', due: '2026-09-15', taskCount: 3, doneCount: 2, state: 'active' }); // phase progress counts subtasks too
    expect(p.phases[0].tasks.map((t: any) => t.text)).toEqual(['Draft chapter list', 'Kick-off call']);
    expect(p.phases[0].tasks[0].children[0].text).toBe('Collect diagrams');
    expect(p.looseTasks.map((t: any) => t.text)).toEqual(['Buy reference books']);
    expect(p.parent).toBeNull();
    expect(p.goal).toMatchObject({ id: 'gol-book26' });
    expect(p.log).toEqual([{ date: '2026-08-20', text: 'Outline approved.', line: expect.any(Number) }, { date: '2026-08-22', text: 'Editor booked.', line: expect.any(Number) }]);
    expect(p.attachments.notes.map((n: any) => n.path)).toEqual(['81 AI/Book plan.md']);
    expect(p.nextAction.text).toBe('Draft chapter list');
    expect(p.health).toMatchObject({ total: 4, done: 2, open: 2, flags: expect.any(Array) }); // health counts subtasks too
    const child = await call('GET', 'projects/prj-oracle');
    expect(child.body.children.map((c: any) => c.id)).toEqual(['prj-cert']);
    expect(child.body.children[0].health).toBeDefined();
    expect((await call('GET', 'projects/prj-cert')).body.parent).toEqual({ id: 'prj-oracle', title: 'Oracle' });
    void m;
    expect((await call('GET', 'projects/prj-nope')).status).toBe(404);
  });

  it('pins, orders, binds a goal and refuses a parent change on PATCH; reorders the list', async () => {
    const { call } = await api(HORIZON_EXTRA);
    const r = await call('PATCH', 'projects/prj-kitchen', { pinned: true, order: 3, goal: 'gol-cert26' });
    expect(r.body.project).toMatchObject({ pinned: true, order: 3, goalId: 'gol-cert26' });
    expect((await call('GET', 'projects')).body.projects[0].id).toBe('prj-kitchen'); // pinned first
    expect((await call('PATCH', 'projects/prj-kitchen', { goal: null })).body.project.goalId).toBeNull();
    expect((await call('PATCH', 'projects/prj-kitchen', { goal: 'gol-nope' })).status).toBe(404);
    expect((await call('PATCH', 'projects/prj-kitchen', { pinned: 'yes' })).status).toBe(400);
    expect((await call('PATCH', 'projects/prj-kitchen', { parentId: 'prj-oracle' })).status).toBe(400);
    const order = await call('POST', 'projects/reorder', { ids: ['prj-cert', 'prj-book'] });
    expect(order.status).toBe(200);
    expect((await call('GET', 'projects/prj-cert')).body.order).toBe(1);
    expect((await call('GET', 'projects/prj-book')).body.order).toBe(2);
    expect((await call('POST', 'projects/reorder', { ids: ['prj-nope'] })).status).toBe(404);
  });

  it('renames and deletes phases, appends to the log, and manages links and related tasks', async () => {
    const { call, vault } = await api();
    const ren = await call('PATCH', 'projects/prj-book/phases/outline', { title: 'Outline v2', due: null });
    expect(ren.status).toBe(200);
    expect(ren.body.project.phases[0]).toMatchObject({ title: 'Outline v2', due: null });
    expect((await call('PATCH', 'projects/prj-book/phases/outline-v2', {})).status).toBe(400); // the slug follows the title
    expect((await call('PATCH', 'projects/prj-book/phases/nope', { title: 'x' })).status).toBe(404);
    const del = await call('DELETE', 'projects/prj-book/phases/writing');
    expect(del.status).toBe(200);
    expect(del.body.carried).toBe(2);
    expect((await call('GET', 'projects/prj-book')).body.phases.map((p: any) => p.title)).toEqual(['Outline v2']);

    const log = await call('POST', 'projects/prj-book/log', { text: 'Reviewed the outline.' });
    expect(log.status).toBe(201);
    expect(log.body.log).toEqual([{ date: TODAY, text: 'Reviewed the outline.', line: expect.any(Number) }]);
    expect(await vault.read('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')).toContain(`- ${TODAY} — Reviewed the outline.`);
    expect((await call('POST', 'projects/prj-book/log', {})).status).toBe(400);

    const link = await call('POST', 'projects/prj-book/links', { url: 'https://publisher.example.com', label: 'Publisher' });
    expect(link.body.links).toEqual([{ url: 'https://publisher.example.com', label: 'Publisher' }]);
    const unlink = await call('DELETE', 'projects/prj-book/links', { url: 'https://publisher.example.com' });
    expect(unlink.body.links).toEqual([]);

    const rel = await call('POST', 'projects/prj-kitchen/related', { ref: 'tsk-0001' });
    expect(rel.status).toBe(200);
    expect(rel.body).toMatchObject({ taskId: 'tsk-0001', relatedTaskIds: ['tsk-0001'] });
    expect((await call('GET', 'projects/prj-kitchen')).body.relatedTaskIds).toEqual(['tsk-0001']);
    expect((await call('DELETE', 'projects/prj-kitchen/related/tsk-nope')).status).toBe(404);
    const unrel = await call('DELETE', 'projects/prj-kitchen/related/tsk-0001');
    expect(unrel.body.relatedTaskIds).toEqual([]);
    expect((await call('GET', 'projects/prj-book/attachments')).body).toEqual({ notes: [], drawings: [] });
  });
});

describe('v2 · review, stats, search', () => {
  it('serves the weekly review with its checklist', async () => {
    const { call } = await api(HORIZON_EXTRA);
    const r = await call('GET', 'review');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ weekStart: '2026-08-24', activeCount: expect.any(Number), staleCount: expect.any(Number) });
    expect(r.body.throughput).toHaveLength(8);
    expect(r.body.projects[0].health).toBeDefined();
    expect(r.body.checklist.map((c: any) => c.id)).toEqual(['inbox', 'overdue', 'next', 'stale', 'week']);
    expect(r.body.checklist.find((c: any) => c.id === 'inbox')).toMatchObject({ done: false, count: 2, auto: true });
    expect(r.body.checklist.find((c: any) => c.id === 'week')).toMatchObject({ done: false, auto: false });
    expect(r.body.goalsInPlay.map((g: any) => g.id)).toContain('gol-book26');
  });

  it('serves dashboard stats with refs instead of tasks, and the filter options', async () => {
    const { call } = await api();
    const r = await call('GET', 'stats', undefined, { from: '2026-08-01', to: TODAY, sources: 'daily,project' });
    expect(r.status).toBe(200);
    expect(r.body.filter).toEqual({ from: '2026-08-01', to: TODAY, sources: ['daily', 'project'] });
    expect(r.body.totals.done).toBeGreaterThan(0);
    expect(r.body.perDay).toHaveLength(26);
    expect(r.body.perDay.every((s: any) => Array.isArray(s.taskRefs) && s.tasks === undefined)).toBe(true);
    expect(r.body.byProject[0]).toMatchObject({ project: { id: expect.any(String), title: expect.any(String) }, doneTaskRefs: expect.any(Array) });
    expect(r.body.habits[0]).toMatchObject({ id: expect.any(String), rate: expect.any(Number), streak: expect.any(Number) });
    const refs = r.body.perWeek.flatMap((w: any) => w.taskRefs);
    const back = await call('GET', 'tasks', undefined, { ids: refs.join(',') });
    expect(back.body.tasks.length).toBe(new Set(refs).size);
    const dflt = await call('GET', 'stats');
    expect(dflt.body.days).toBe(30);
    expect((await call('GET', 'stats', undefined, { sources: 'email' })).status).toBe(400);
    expect((await call('GET', 'stats', undefined, { project: 'prj-nope' })).status).toBe(404);
    const o = await call('GET', 'stats/options');
    expect(o.body).toMatchObject({ areas: ['Oracle'], sources: ['daily', 'project', 'note', 'inbox'], periods: { quarter: '2026-Q3', month: '2026-08' } });
    expect(o.body.projects.map((p: any) => p.id)).toContain('prj-book');
  });

  it('searches everything with the query grammar and offers starting points', async () => {
    const { call } = await api();
    const r = await call('GET', 'search', undefined, { q: 'chapter is:open' });
    expect(r.status).toBe(200);
    expect(r.body.query).toMatchObject({ words: ['chapter'], status: 'open' });
    expect(r.body.hits.every((h: any) => h.kind === 'task' && h.task.open)).toBe(true);
    expect(r.body.hits.map((h: any) => h.title)).toContain('Chapter 1');
    const mixed = await call('GET', 'search', undefined, { q: 'oracle', limit: '3' });
    expect(mixed.body.hits).toHaveLength(3);
    expect(mixed.body.hits.some((h: any) => h.kind === 'project' && h.project.id)).toBe(true);
    expect((await call('GET', 'search', undefined, { q: '' })).body.hits).toEqual([]);
    const sp = await call('GET', 'search/starting-points');
    expect(sp.body.groups.map((g: any) => g.label)).toContain('Overdue');
    expect(sp.body.groups[0].hits[0]).toMatchObject({ kind: 'task', task: expect.any(Object) });
  });
});

describe('v2 · capture, attachments, notes, files', () => {
  it('parses a capture line the way the dialog previews it, without writing', async () => {
    const { call, index } = await api();
    const before = index.revision;
    const r = await call('POST', 'capture/parse', { text: 'Call the plumber tomorrow !high #home @Kitchen Remodel ~30m 14:00' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ text: 'Call the plumber #home', tags: ['home'], priority: 'high', scheduled: '2026-08-27', effortMinutes: 30, time: '14:00', part: 'afternoon', project: { id: 'prj-kitchen', title: 'Kitchen Remodel' } });
    expect(r.body.destination).toMatchObject({ kind: 'project+day', projectId: 'prj-kitchen', date: '2026-08-27', part: 'afternoon' });
    expect(r.body.destination.sentence).toContain('Kitchen Remodel');
    expect(index.revision).toBe(before);
    const unknown = await call('POST', 'capture/parse', { text: 'Fix it @Nowhere' });
    expect(unknown.body).toMatchObject({ project: null, unknownProject: 'Nowhere', destination: { kind: 'inbox' } });
    const dated = await call('POST', 'capture/parse', { text: 'Dentist', scheduled: TODAY, part: 'morning', tags: ['health'] });
    expect(dated.body).toMatchObject({ text: 'Dentist #health', destination: { kind: 'day', date: TODAY, part: 'morning' } });
    expect((await call('POST', 'capture/parse', { text: '   ' })).status).toBe(400);
  });

  it('captures the way Enter does: grammar, overrides, and the same write', async () => {
    const { call, vault } = await api();
    const r = await call('POST', 'capture', { text: 'Sketch the layout tomorrow ~45m @Kitchen Remodel', phaseId: undefined, tags: ['design'] });
    expect(r.status).toBe(201);
    expect(r.body.task).toMatchObject({ text: 'Sketch the layout #design', scheduled: '2026-08-27', effortMinutes: 45, effortRaw: '45m', project: { id: 'prj-kitchen' } });
    expect(r.body.destination.kind).toBe('project+day');
    expect(await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')).toContain('Sketch the layout #design');
    expect(r.body.written.some((p: string) => p.includes('27, Thursday'))).toBe(true);
    const inbox = await call('POST', 'capture', { text: 'Buy stamps' });
    expect(inbox.body.task.source).toBe('inbox');
    expect((await call('POST', 'capture', { text: 'Do it @Nowhere' })).status).toBe(400);
    expect((await call('POST', 'capture', { text: 'x', projectId: 'prj-nope' })).status).toBe(404);
    const rec = await call('POST', 'capture', { text: 'Water the plants', scheduled: TODAY, recurrence: 'every 3 days', time: '18:00', timeEnd: '18:10' });
    expect(rec.body.task).toMatchObject({ recurrence: 'every 3 days', time: '18:00', timeEnd: '18:10' });
  });

  it('lists attachments per target and creates notes for each', async () => {
    const { call, vault } = await api({ '81 AI/Week notes.md': '---\nhelm-period: 2026-W35\nhelm-date: 2026-08-25\nhelm-habit: hab-workout\n---\n# Week notes\n' });
    expect((await call('GET', 'day/2026-08-25/attachments')).body.notes.map((n: any) => n.path)).toEqual(['81 AI/Week notes.md']);
    expect((await call('GET', 'periods/2026-W35/attachments')).body.notes.map((n: any) => n.path)).toEqual(['81 AI/Week notes.md']);
    expect((await call('GET', 'habits/hab-workout/attachments')).body.notes.map((n: any) => n.path)).toEqual(['81 AI/Week notes.md']);
    expect((await call('GET', 'day/2026-08-24/attachments')).body).toEqual({ notes: [], drawings: [] });
    const t = await call('POST', 'tasks/tsk-0002/notes', { name: 'Chapter 2 research' });
    expect(t.status).toBe(201);
    expect(t.body.path).toContain('Chapter 2 research');
    expect(await vault.read(t.body.path)).toContain('helm-task: tsk-0002');
    expect(t.body.attachments.notes.map((n: any) => n.path)).toEqual([t.body.path]);
    const p = await call('POST', 'projects/prj-kitchen/notes', {});
    expect(await vault.read(p.body.path)).toContain('helm-project: prj-kitchen');
    const dn = await call('POST', `day/${TODAY}/notes`, { name: 'Standup' });
    expect(await vault.read(dn.body.path)).toContain(`helm-date: ${TODAY}`);
    const pn = await call('POST', 'periods/2026-Q3/notes', {});
    expect(await vault.read(pn.body.path)).toContain('helm-period: 2026-Q3');
    const hn = await call('POST', 'habits/hab-read/notes', {});
    expect(await vault.read(hn.body.path)).toContain('helm-habit: hab-read');
    const del = await call('DELETE', 'notes', { path: t.body.path });
    expect(del.status).toBe(200);
    expect(await vault.exists(t.body.path)).toBe(false);
    expect((await call('DELETE', 'notes', { path: '01 INBOX/Inbox.md' })).status).toBe(404); // not an attached note
  });

  it('serves a markdown file the index knows, and nothing else', async () => {
    const { call } = await api();
    const r = await call('GET', 'files', undefined, { path: '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ path: '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md', kind: 'project' });
    expect(r.body.content).toContain('# Kitchen Remodel');
    expect((await call('GET', 'files', undefined, { path: '01 INBOX/Inbox.md' })).body.kind).toBe('inbox');
    expect((await call('GET', 'files', undefined, { path: '../secrets.md' })).status).toBe(404);
    expect((await call('GET', 'files', undefined, { path: '.obsidian/app.json' })).status).toBe(404);
    expect((await call('GET', 'files', undefined, { path: 'Not indexed.md' })).status).toBe(404);
    expect((await call('GET', 'files')).status).toBe(400);
  });
});

describe('v2 · report and maintenance', () => {
  it('builds a report for a period and for one project, embedding tasks and keying the maps by project id', async () => {
    const { call } = await api(HORIZON_EXTRA);
    const r = await call('GET', 'report', undefined, { scope: 'week', anchor: TODAY, sections: 'history,plan,projects,goals' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ scope: 'week', from: '2026-08-24', to: '2026-08-30', standing: 'current', sections: { history: true, plan: true, ahead: false, projects: true, goals: true, habits: false, daybook: false } });
    expect(r.body.title).toContain('35');
    expect(r.body.headline).toHaveLength(4);
    expect(r.body.stats.perDay.every((x: any) => Array.isArray(x.taskRefs))).toBe(true);
    expect(r.body.days).toHaveLength(7);
    expect(r.body.days[1].done[0]).toMatchObject({ text: 'Pay invoice' });
    expect(typeof r.body.projectWork).toBe('object');
    expect(r.body.projects.length).toBeGreaterThan(0);
    const pid = r.body.projects[0].id;
    expect(r.body.projectDepths[pid]).toBe(0);
    expect(r.body.projectWork[pid].groups[0].tasks[0]).toMatchObject({ task: expect.any(Object), depth: 0 });
    expect(r.body.goals).toEqual([]); // a week holds no goal of its own; the year's goals belong to the year's report
    expect((await call('GET', 'report', undefined, { scope: 'year', anchor: TODAY })).body.goals.some((g: any) => g.id === 'gol-book26')).toBe(true);
    const day = await call('GET', 'report', undefined, { scope: 'day', anchor: '2026-08-25' });
    expect(day.body.plan).toMatchObject({ date: '2026-08-25', doneCount: 1 });
    expect(day.body.plan.byPart.anytime.length + day.body.plan.byPart.morning.length + day.body.plan.byPart.afternoon.length).toBeGreaterThan(0);
    const proj = await call('GET', 'projects/prj-book/report', undefined, { scope: 'quarter', anchor: TODAY });
    expect(proj.body.project.id).toBe('prj-book');
    expect(proj.body.title).toBe('Oracle Book Writing');
    expect(proj.body.projects.map((p: any) => p.id)).toEqual(['prj-book']);
    expect((await call('GET', 'report', undefined, { scope: 'fortnight' })).status).toBe(400);
    expect((await call('GET', 'report', undefined, { sections: 'history,gossip' })).status).toBe(400);
    expect((await call('GET', 'report', undefined, { project: 'prj-nope' })).status).toBe(404);
    expect((await call('GET', 'report.pdf', undefined, { scope: 'week' })).status).toBe(501);
  });

  it('runs the maintenance commands', async () => {
    const { call, index } = await api();
    const before = index.revision;
    const rb = await call('POST', 'maintenance/rebuild');
    expect(rb.status).toBe(200);
    expect(rb.body).toMatchObject({ rebuilt: true, counts: { projects: 4 } });
    expect(rb.body.revision).toBeGreaterThan(before);
    const rc = await call('POST', 'maintenance/reconcile');
    expect(rc.status).toBe(200);
    expect(typeof rc.body.fixed).toBe('number');
    const mv = await call('POST', 'maintenance/move-recurring');
    expect(mv.body).toMatchObject({ moved: expect.any(Number), written: expect.any(Array) });
    const cu = await call('POST', 'maintenance/catch-up-recurring', { aheadDays: 30 });
    expect(cu.body).toMatchObject({ spawned: expect.any(Number) });
    expect((await call('POST', 'maintenance/defrag')).status).toBe(405);
    expect((await call('GET', 'maintenance/rebuild')).status).toBe(405);
  });
});

describe('v2 · §14 amendments', () => {
  it('patches start and blockedBy, and the detail tells the next occurrence and whether a line is misfiled', async () => {
    const { call, vault } = await api();
    const t = (await call('POST', 'tasks', { text: 'Second pass', scheduled: TODAY })).body.task;
    const r = await call('PATCH', `tasks/${t.id}`, { start: '2026-08-28', blockedBy: ['tsk-0001', 'Renew passport'] });
    expect(r.status).toBe(404); // "Renew passport" is text, not a ref
    const inbox = (await call('GET', 'inbox')).body.inbox.find((x: any) => x.text === 'Renew passport');
    const ok = await call('PATCH', `tasks/${t.id}`, { start: '2026-08-28', blockedBy: ['tsk-0001', inbox.ref] });
    expect(ok.body.task.start).toBe('2026-08-28');
    expect(ok.body.task.blockedBy).toHaveLength(2);
    expect(ok.body.task.blockedBy[0]).toBe('tsk-0001');
    expect(ok.body.task.blockedBy[1]).toMatch(/^tsk-/); // the inbox line got an id stamped
    expect(await vault.read('01 INBOX/Inbox.md')).toContain(`Renew passport 🆔 ${ok.body.task.blockedBy[1]}`);
    expect(ok.body.task.blocked).toBe(true);
    expect((await call('PATCH', `tasks/${t.id}`, { blockedBy: [] })).body.task.blockedBy).toEqual([]);
    expect((await call('PATCH', `tasks/${t.id}`, { start: null })).body.task.start).toBeNull();
    expect((await call('PATCH', `tasks/${t.id}`, { blockedBy: [t.id] })).status).toBe(400);
    const detail = (await call('GET', 'tasks/tsk-0002')).body;
    expect(detail).toMatchObject({ nextOccurrence: expect.stringMatching(/^2026-/), misfiled: false });
    expect((await call('GET', 'tasks/tsk-0001')).body.nextOccurrence).toBeNull();
  });

  it('skips one occurrence, stamps an id on demand', async () => {
    const { call, index } = await api();
    expect((await call('POST', 'tasks/tsk-0001/skip')).status).toBe(400);
    const r = await call('POST', 'tasks/tsk-0002/skip');
    expect(r.status).toBe(200);
    expect(r.body.task.status).toBe('cancelled');
    expect(r.body.next).toMatch(/^2026-/);
    const inbox = (await call('GET', 'inbox')).body.inbox[0];
    expect(inbox.id).toBeNull();
    const id = await call('POST', `tasks/${inbox.ref}/ensure-id`);
    expect(id.body.id).toMatch(/^tsk-/);
    expect(index.taskById(id.body.id)!.text).toBe(inbox.text);
    expect((await call('POST', `tasks/${id.body.id}/ensure-id`)).body.id).toBe(id.body.id);
  });

  it('applies one action to many refs, ids first, a parent covering its subtasks, continuing past failures', async () => {
    const { call, index } = await api();
    const inbox = (await call('GET', 'inbox')).body.inbox.map((t: any) => t.ref);
    const r = await call('POST', 'tasks/bulk', { refs: [...inbox, 'tsk-nope'], action: 'schedule', date: '2026-08-28', part: 'morning' });
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(2);
    expect(r.body.failed).toEqual([{ ref: 'tsk-nope', error: 'No task tsk-nope' }]);
    expect(r.body.appliedIds.every((id: string) => id.startsWith('tsk-'))).toBe(true);
    expect([...index.snapshot.tasks.values()].filter((t) => t.noteDate === '2026-08-28' && t.depth === 0).map((t) => t.text).sort()).toEqual(['Call the plumber', 'Renew passport']);
    // The subtask "Find photo" travelled with its parent; naming both only acts on the parent.
    const passport = index.taskById(r.body.appliedIds[1])!;
    const kid = index.task(passport.childKeys[0]!)!;
    const both = await call('POST', 'tasks/bulk', { refs: [passport.id, kid.key], action: 'status', status: 'done' });
    expect(both.body.applied).toBe(1);
    expect(both.body.covered).toHaveLength(1);
    expect((await call('POST', 'tasks/bulk', { refs: ['tsk-0001'], action: 'teleport' })).status).toBe(400);
    expect((await call('POST', 'tasks/bulk', { refs: ['tsk-0001'], action: 'move', projectId: 'prj-nope' })).status).toBe(404);
    const moved = await call('POST', 'tasks/bulk', { refs: ['tsk-0002'], action: 'move', projectId: 'prj-kitchen' });
    expect(moved.body.applied).toBe(1);
    expect(index.taskById('tsk-0002')!.projectId).toBe('prj-kitchen');
    const gone = await call('POST', 'tasks/bulk', { refs: ['tsk-0002'], action: 'delete' });
    expect(gone.body.applied).toBe(1);
    expect(index.taskById('tsk-0002')).toBeUndefined();
  });

  it('writes the unmirrored project tasks into the day', async () => {
    const { call, vault, index } = await api();
    // A ⏳ written by hand in the project note: planned on a day whose note does not carry it yet.
    const path = '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md';
    const content = (await vault.read(path)).replace('- [ ] Chapter 2 🆔 tsk-0002 🔁 every week', '- [ ] Chapter 2 🆔 tsk-0002 ⏳ 2026-08-27 🔁 every week');
    await vault.write(path, content);
    index.update(path, content);
    const before = (await call('GET', 'day/2026-08-27')).body;
    expect(before.byPart.anytime.some((it: any) => it.kind === 'unmirrored' && it.task.id === 'tsk-0002')).toBe(true);
    const r = await call('POST', 'day/2026-08-27/write-unmirrored');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mirrored: 1, failed: [] });
    expect(await vault.read(index.dailyPath('2026-08-27'))).toContain('tsk-0002');
    const after = (await call('GET', 'day/2026-08-27')).body;
    expect(after.byPart.anytime.some((it: any) => it.kind === 'mirror' && it.display?.id === 'tsk-0002')).toBe(true);
    expect((await call('POST', 'day/2026-08-27/write-unmirrored')).body.mirrored).toBe(0);
  });

  it('lists free slots and bookings, prefers one, and finds a task\'s conflicts', async () => {
    const { call } = await api();
    await call('POST', 'tasks', { text: 'Stand-up', scheduled: TODAY, time: '09:00', timeEnd: '09:30' });
    await call('POST', 'tasks', { text: 'Review', scheduled: TODAY, time: '11:00', timeEnd: '12:00' });
    const r = await call('GET', `day/${TODAY}/slots`, undefined, { minutes: '30', part: 'morning' });
    expect(r.status).toBe(200);
    expect(r.body.bookings.map((b: any) => [b.start, b.end])).toEqual([['09:00', '09:30'], ['11:00', '12:00']]);
    expect(r.body.free).toEqual([{ start: '08:00', end: '09:00' }, { start: '09:30', end: '11:00' }]);
    expect(r.body.preferred).toEqual({ start: '08:00', end: '08:30' });
    const later = await call('GET', `day/${TODAY}/slots`, undefined, { minutes: '60', part: 'morning', notBefore: '09:15' });
    expect(later.body.free).toEqual([{ start: '09:30', end: '11:00' }]);
    expect(later.body.preferred.start).toBe('09:30');
    expect((await call('GET', `day/${TODAY}/slots`, undefined, { minutes: '-5' })).status).toBe(400);
    const c = await call('GET', 'tasks/tsk-0001/conflicts', undefined, { date: TODAY, time: '09:15', effortMinutes: '30' });
    expect(c.body.conflicts.map((b: any) => b.label)).toEqual(['Stand-up']);
    expect((await call('GET', 'tasks/tsk-0001/conflicts')).status).toBe(400); // not on a day, no time
  });

  it('fits the day without AI and applies the proposal the way the modal writes it', async () => {
    const { call, index } = await api();
    await call('POST', 'tasks', { text: 'Stand-up', scheduled: TODAY, time: '09:00', timeEnd: '09:30' });
    const a = (await call('POST', 'tasks', { text: 'Write chapter 3', scheduled: TODAY, effortMinutes: 90 })).body.task;
    const b = (await call('POST', 'tasks', { text: 'Answer mail', scheduled: TODAY })).body.task;
    const fit = await call('POST', `day/${TODAY}/fit`);
    expect(fit.status).toBe(200);
    expect(fit.body).toMatchObject({ source: 'helm', from: '08:00', to: '22:00' });
    expect(fit.body.busy).toEqual([{ start: '09:00', end: '09:30', label: 'Stand-up' }]);
    expect(fit.body.changes.map((c: any) => c.ref)).toEqual(expect.arrayContaining([a.ref, b.ref]));
    const ca = fit.body.changes.find((c: any) => c.ref === a.ref);
    expect(ca).toMatchObject({ time: expect.stringMatching(/^\d{2}:\d{2}$/), timeEnd: expect.stringMatching(/^\d{2}:\d{2}$/), effortMinutes: 90 });
    expect(fit.body.blocks.some((x: any) => x.kind === 'break')).toBe(true);
    const only = await call('POST', `day/${TODAY}/fit`, { refs: [b.ref] });
    expect(only.body.changes.map((c: any) => c.ref)).toEqual([b.ref]);
    const applied = await call('POST', `day/${TODAY}/fit/apply`, { changes: fit.body.changes });
    expect(applied.body).toMatchObject({ applied: 2, failed: [] });
    expect(index.taskById(a.id)!.time).toEqual({ start: ca.time, end: ca.timeEnd });
    expect((await call('POST', `day/${TODAY}/fit/apply`, { changes: [{ ref: a.ref, time: 'noon' }] })).status).toBe(400);
    expect((await call('POST', 'day/2026-08-05/fit')).status).toBe(400); // nothing there
  });

  it('creates a project with goal, tags, objective, notes, phases and tasks; adds a bare phase; manages phase links', async () => {
    const { call, vault } = await api(HORIZON_EXTRA);
    const r = await call('POST', 'projects', { title: 'Garden Rebuild', goal: 'gol-book26', tags: ['home', '#outdoor'], objective: 'A garden worth sitting in.', notes: ['Ask the neighbour first.'], phases: [{ title: 'Design', due: '2026-10-01', tasks: ['Sketch'] }, { title: 'Build' }], tasks: ['Order soil'] });
    expect(r.status).toBe(201);
    expect(r.body.project).toMatchObject({ title: 'Garden Rebuild', goalId: 'gol-book26', tags: expect.arrayContaining(['home', 'outdoor']) });
    expect(r.body.project.phases.map((p: any) => [p.slug, p.due])).toEqual([['design', '2026-10-01'], ['build', null]]);
    const note = await vault.read(r.body.project.path);
    expect(note).toContain('A garden worth sitting in.');
    expect(note).toContain('Ask the neighbour first.');
    expect(note).toContain('- [ ] Sketch');
    expect(note).toContain('- [ ] Order soil');
    expect((await call('POST', 'projects', { title: 'x', goal: 'gol-nope' })).status).toBe(404);
    expect((await call('POST', 'projects', { title: 'x', phases: [{ due: '2026-10-01' }] })).status).toBe(400);
    const ph = await call('POST', `projects/${r.body.project.id}/phases`, { title: 'Plant', due: '2026-11-01' });
    expect(ph.status).toBe(201);
    expect(ph.body.phase).toMatchObject({ slug: 'plant', due: '2026-11-01' });
    expect(ph.body.tasks).toEqual([]);
    const link = await call('POST', `projects/${r.body.project.id}/phases/plant/links`, { url: 'https://plants.example.com', label: 'Nursery' });
    expect(link.status).toBe(200);
    expect(link.body.links).toEqual([{ url: 'https://plants.example.com', label: 'Nursery' }]);
    expect((await call('GET', `projects/${r.body.project.id}`)).body.phases.find((p: any) => p.slug === 'plant').links).toHaveLength(1);
    const unlink = await call('DELETE', `projects/${r.body.project.id}/phases/plant/links`, { url: 'https://plants.example.com' });
    expect(unlink.body.links).toEqual([]);
    expect((await call('POST', `projects/${r.body.project.id}/phases/nope/links`, { url: 'https://x.example.com' })).status).toBe(404);
  });

  it('serves a habit\'s icon image bytes with its content type, and the diagnostics', async () => {
    const { call, vault, m } = await api();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]);
    const path = await m.saveHabitIcon('workout', png.buffer, 'png');
    await m.setHabitFields('hab-workout', { iconImage: path });
    void vault;
    const r = await call('GET', 'habits/hab-workout/icon');
    expect(r.status).toBe(200);
    expect(r.raw.contentType).toBe('image/png');
    expect([...r.raw.bytes]).toEqual([...png]);
    expect((await call('GET', 'habits/hab-read/icon')).status).toBe(404);
    const dg = await call('GET', 'diagnostics');
    expect(dg.status).toBe(200);
    expect(dg.body).toMatchObject({ ready: true, revision: expect.any(Number), diagnostics: expect.any(Array), dailyNotes: [] });
  });
});

const DRAW = (fm: string, text = ''): string => `---\n${fm}\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n\n## Text Elements\n${text}\n\n%%\n## Drawing\n\`\`\`json\n{"type":"excalidraw","elements":[]}\n\`\`\`\n%%\n`;

describe('v2 · Phase C: drawings, linking notes, binary files, daily-note info', () => {
  it('creates a drawing for a target, links and unlinks an existing one, and deletes one', async () => {
    const { call, vault } = await api({ 'Excalidraw/random.excalidraw.md': DRAW('', 'a sketch ^a'), 'Excalidraw/board.canvas': '{}' });
    const made = await call('POST', 'tasks/tsk-0002/drawings', { name: 'Chapter 2 flow' });
    expect(made.status).toBe(201);
    expect(made.body.path).toMatch(/Chapter 2 flow\.excalidraw\.md$/);
    expect(await vault.read(made.body.path)).toContain('helm-task: tsk-0002');
    expect(made.body.attachments.drawings.map((x: any) => x.path)).toEqual([made.body.path]);
    expect(made.body.target).toEqual({ kind: 'task', ref: 'tsk-0002' });
    const linked = await call('POST', 'projects/prj-kitchen/drawings/link', { path: 'Excalidraw/random.excalidraw.md' });
    expect(linked.status).toBe(200);
    expect(await vault.read('Excalidraw/random.excalidraw.md')).toContain('helm-project: prj-kitchen');
    expect(linked.body.attachments.drawings.map((x: any) => x.path)).toContain('Excalidraw/random.excalidraw.md');
    expect((await call('GET', 'projects/prj-kitchen/attachments')).body.drawings.map((x: any) => x.path)).toContain('Excalidraw/random.excalidraw.md');
    const unlinked = await call('DELETE', 'projects/prj-kitchen/drawings/link', { path: 'Excalidraw/random.excalidraw.md' });
    expect(unlinked.body.attachments.drawings.map((x: any) => x.path)).not.toContain('Excalidraw/random.excalidraw.md');
    expect((await call('DELETE', 'projects/prj-kitchen/drawings/link', { path: 'Excalidraw/random.excalidraw.md' })).status).toBe(404);
    expect((await call('POST', 'projects/prj-kitchen/drawings/link', { path: 'Excalidraw/nope.excalidraw.md' })).status).toBe(404);
    await expect(call('POST', `day/${TODAY}/drawings/link`, { path: 'Excalidraw/board.canvas' })).rejects.toThrow(/canvas/); // Helm's own refusal → 500
    const day = await call('POST', `day/${TODAY}/drawings`, {});
    expect(await vault.read(day.body.path)).toContain(`helm-date: ${TODAY}`);
    const per = await call('POST', 'periods/2026-W35/drawings', {});
    expect(await vault.read(per.body.path)).toContain('helm-period: 2026-W35');
    const hab = await call('POST', 'habits/hab-read/drawings', {});
    expect(await vault.read(hab.body.path)).toContain('helm-habit: hab-read');
    const del = await call('DELETE', 'drawings', { path: made.body.path });
    expect(del.status).toBe(200);
    expect(await vault.exists(made.body.path)).toBe(false);
    expect((await call('DELETE', 'drawings', { path: 'Excalidraw/nope.excalidraw.md' })).status).toBe(404);
  });

  it('offers linkable notes and links or unlinks an existing note to a target', async () => {
    const { call, vault } = await api({ '81 AI/Cert research.md': '# Cert research\n\nProse.\n', '81 AI/Other.md': '# Other\n' });
    const pick = await call('GET', 'notes/linkable', undefined, { q: 'cert' });
    expect(pick.status).toBe(200);
    expect(pick.body.notes.map((n: any) => n.path)).toEqual(['81 AI/Cert research.md', '02 PROJECTS/⮕ Oracle/OCI Certification/OCI Certification.md']); // title-prefix matches first
    const all = await call('GET', 'notes/linkable');
    expect(all.body.total).toBeGreaterThan(2);
    expect(all.body.notes.some((n: any) => n.kind === 'project')).toBe(true);
    expect(all.body.notes.some((n: any) => n.path.includes('Daily Notes'))).toBe(false); // a day is attached as a day
    const link = await call('POST', 'tasks/tsk-0002/notes/link', { path: '81 AI/Cert research.md' });
    expect(link.status).toBe(200);
    expect(await vault.read('81 AI/Cert research.md')).toContain('helm-task: tsk-0002');
    expect(link.body.attachments.notes.map((n: any) => n.path)).toEqual(['81 AI/Cert research.md']);
    expect((await call('GET', 'tasks/tsk-0002')).body.attachments.notes).toHaveLength(1);
    const hab = await call('POST', 'habits/hab-read/notes/link', { path: '81 AI/Cert research.md' });
    expect(hab.body.attachments.notes).toHaveLength(1);
    const unlink = await call('DELETE', 'tasks/tsk-0002/notes/link', { path: '81 AI/Cert research.md' });
    expect(unlink.body.attachments.notes).toEqual([]);
    expect(await vault.read('81 AI/Cert research.md')).not.toContain('helm-task');
    expect((await call('DELETE', 'tasks/tsk-0002/notes/link', { path: '81 AI/Cert research.md' })).status).toBe(404);
    expect((await call('POST', 'tasks/tsk-0002/notes/link', { path: 'Nowhere.md' })).status).toBe(404);
    expect((await call('POST', 'tasks/tsk-0002/notes/link', { path: '../x.md' })).status).toBe(400);
    expect((await call('POST', 'tasks/tsk-0002/notes/link', {})).status).toBe(400);
  });

  it('serves drawings and habit icons as bytes, and nothing else', async () => {
    const { call, m, vault } = await api({ 'Excalidraw/random.excalidraw.md': DRAW('', 'x ^a'), 'Excalidraw/board.canvas': '{"nodes":[]}' });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const icon = await m.saveHabitIcon('read', png.buffer, 'png');
    await m.setHabitFields('hab-read', { iconImage: icon });
    const r = await call('GET', 'files/binary', undefined, { path: icon });
    expect(r.status).toBe(200);
    expect(r.raw).toMatchObject({ contentType: 'image/png' });
    expect([...r.raw.bytes]).toEqual([...png]);
    await vault.writeBinary('Excalidraw/board.canvas', new TextEncoder().encode('{"nodes":[]}').buffer as ArrayBuffer);
    const canvas = await call('GET', 'files/binary', undefined, { path: 'Excalidraw/board.canvas' });
    expect(canvas.status).toBe(200);
    expect(canvas.raw.contentType).toBe('application/json');
    expect((await call('GET', 'files/binary', undefined, { path: '01 INBOX/Inbox.md' })).status).toBe(404);
    expect((await call('GET', 'files/binary', undefined, { path: '../etc/passwd' })).status).toBe(404);
    expect((await call('GET', 'files/binary', undefined, { path: 'Somewhere/photo.png' })).status).toBe(404); // an image the index does not know
    expect((await call('GET', 'files/binary')).status).toBe(400);
  });

  it('says whether the daily note exists and whether its region is usable', async () => {
    const { call } = await api();
    expect((await call('GET', 'day/2026-08-25')).body.dailyNote).toEqual({ exists: true, hasRegion: true, regionBroken: false });
    expect((await call('GET', 'day/2026-08-27')).body.dailyNote).toEqual({ exists: false, hasRegion: false, regionBroken: false });
  });
});

describe('v2 · Phase C part 2: phases, drawings on /files, inbox cap, attached-only delete', () => {
  it('attaches notes and drawings to a phase', async () => {
    const { call, vault } = await api();
    const note = await call('POST', 'projects/prj-book/phases/outline/notes', { name: 'Outline notes' });
    expect(note.status).toBe(201);
    expect(await vault.read(note.body.path)).toContain('helm-phase: prj-book#outline');
    expect(note.body.target).toEqual({ kind: 'phase', id: 'prj-book#outline', projectId: 'prj-book' });
    const dr = await call('POST', 'projects/prj-book/phases/outline/drawings', {});
    expect(dr.status).toBe(201);
    expect(await vault.read(dr.body.path)).toContain('helm-phase: prj-book#outline');
    const att = await call('GET', 'projects/prj-book/phases/outline/attachments');
    expect(att.body.notes.map((n: any) => n.path)).toEqual([note.body.path]);
    expect(att.body.drawings.map((x: any) => x.path)).toEqual([dr.body.path]);
    const un = await call('DELETE', 'projects/prj-book/phases/outline/notes/link', { path: note.body.path });
    expect(un.body.attachments.notes).toEqual([]);
    expect((await call('GET', 'projects/prj-book/phases/nope/attachments')).status).toBe(404);
  });

  it('serves a known drawing as text on /files and only deletes attached drawings', async () => {
    const { call } = await api({ 'Excalidraw/board.canvas': '{"nodes":[]}', 'Excalidraw/loose.excalidraw.md': DRAW('', 'nothing links here ^a') });
    const r = await call('GET', 'files', undefined, { path: 'Excalidraw/board.canvas' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ path: 'Excalidraw/board.canvas', content: '{"nodes":[]}', kind: 'drawing' });
    expect((await call('GET', 'files', undefined, { path: 'Excalidraw/nope.canvas' })).status).toBe(404);
    expect((await call('DELETE', 'drawings', { path: 'Excalidraw/loose.excalidraw.md' })).status).toBe(404); // not attached to anything
    const made = await call('POST', 'tasks/tsk-0002/drawings', {});
    expect((await call('DELETE', 'drawings', { path: made.body.path })).status).toBe(200);
  });

  it('caps the inbox the way the tab does and pages one note', async () => {
    const lines = Array.from({ length: 40 }, (_, i) => `- [ ] Note task ${String(i + 1).padStart(2, '0')}`).join('\n');
    const { call } = await api({ '02 PROJECTS/Reading list.md': `# Reading\n\n${lines}\n` });
    const r = await call('GET', 'inbox');
    expect(r.status).toBe(200);
    expect(r.body.loose.map((g: any) => [g.title, g.count, g.tasks.length])).toEqual([['Reading list', 40, 15], ['Backlog Tasks', 1, 1]]);
    expect(r.body).toMatchObject({ looseTotal: 41, looseGroups: 2, unscheduledProjectTotal: expect.any(Number) });
    expect(r.body.unscheduledProject.length).toBeLessThanOrEqual(100);
    const small = await call('GET', 'inbox', undefined, { limit: '10' });
    expect(small.body.loose.map((g: any) => g.tasks.length)).toEqual([10, 0]);
    const wide = await call('GET', 'inbox', undefined, { perGroup: '40' });
    expect(wide.body.loose[0].tasks).toHaveLength(40);
    const page = await call('GET', 'inbox/notes', undefined, { path: '02 PROJECTS/Reading list.md', limit: '10', offset: '30' });
    expect(page.body).toMatchObject({ count: 40, offset: 30, limit: 10 });
    expect(page.body.tasks.map((t: any) => t.text)).toEqual(Array.from({ length: 10 }, (_, i) => `Note task ${31 + i}`));
    expect((await call('GET', 'inbox/notes', undefined, { path: '01 INBOX/Inbox.md' })).status).toBe(404);
    expect((await call('GET', 'inbox/notes')).status).toBe(400);
  });
});
