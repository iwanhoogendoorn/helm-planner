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
    index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: '9.9.9', vaultName: 'Test vault',
    written: () => { const w = [...new Set(written)]; written.length = 0; return w; },
  };
  const call = (method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<{ status: number; body: any }> =>
    handle({ method, path, query, body } as ApiRequest, deps) as Promise<{ status: number; body: any }>;
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
