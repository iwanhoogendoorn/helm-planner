import { describe, expect, it } from 'vitest';
import { setup, TODAY } from '../data/fixture';
import { handle, type ApiDeps, type ApiRequest } from '../../src/api/routes';

/* eslint-disable @typescript-eslint/no-explicit-any */

async function api() {
  const s = await setup();
  const written: string[] = [];
  const origWrite = s.vault.write.bind(s.vault);
  s.vault.write = async (p: string, c: string) => { written.push(p); await origWrite(p, c); };
  const deps: ApiDeps = {
    index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: '9.9.9', read: (p) => s.vault.read(p),
    written: () => { const w = [...new Set(written)]; written.length = 0; return w; },
  };
  const call = (method: string, path: string, body?: unknown, query: Record<string, string> = {}): Promise<{ status: number; body: any }> =>
    handle({ method, path, query, body } as ApiRequest, deps) as Promise<{ status: number; body: any }>;
  return { ...s, call };
}

describe('the local API', () => {
  it('reports health and lists tasks with filters', async () => {
    const { call } = await api();
    const health = await call('GET', 'health');
    expect(health.status).toBe(200);
    expect(health.body).toMatchObject({ ok: true, version: '9.9.9', today: TODAY });
    expect(health.body.counts.tasks).toBeGreaterThan(0);

    const open = await call('GET', 'tasks');
    expect(open.status).toBe(200);
    expect(open.body.tasks.every((t: any) => t.open)).toBe(true);
    expect(open.body.tasks.some((t: any) => t.text === 'Draft chapter list')).toBe(true);
    expect(open.body.tasks.every((t: any) => t.source !== 'daily-mirror')).toBe(true);

    const byProject = await call('GET', 'tasks', undefined, { project: 'prj-kitchen' });
    expect(byProject.body.tasks.every((t: any) => t.project.id === 'prj-kitchen')).toBe(true);
    const done = await call('GET', 'tasks', undefined, { status: 'done' });
    expect(done.body.tasks.every((t: any) => t.status === 'done')).toBe(true);
    const search = await call('GET', 'tasks', undefined, { q: 'plumber', status: 'all' });
    expect(search.body.tasks.map((t: any) => t.text)).toContain('Call the plumber');
    const overdue = await call('GET', 'tasks', undefined, { overdue: 'true' });
    expect(overdue.body.tasks.length).toBeGreaterThan(0);
    expect(overdue.body.tasks.every((t: any) => t.due < TODAY)).toBe(true);
  });

  it('creates a task on a day, reads it back by id and reports the files it touched', async () => {
    const { call, vault } = await api();
    const r = await call('POST', 'tasks', { text: 'Ring the plumber', scheduled: TODAY, part: 'afternoon', effortMinutes: 30, priority: 'high' });
    expect(r.status).toBe(201);
    const t = r.body.task;
    expect(t.id).toMatch(/^tsk-/);
    expect(t).toMatchObject({ text: 'Ring the plumber', status: 'todo', open: true, scheduled: TODAY, part: 'afternoon', effortMinutes: 30, priority: 'high' });
    expect(r.body.written.some((p: string) => p.includes('26, Wednesday'))).toBe(true); // the daily note
    expect(await vault.read(t.path)).toContain('Ring the plumber');
    const again = await call('GET', `tasks/${t.id}`);
    expect(again.body.text).toBe('Ring the plumber');
    expect((await call('GET', 'tasks/tsk-nope')).status).toBe(404);
  });

  it('schedules, unschedules, ticks and deletes through the same paths the buttons use', async () => {
    const { call, vault, index } = await api();
    const made = (await call('POST', 'tasks', { text: 'Book the venue' })).body.task; // no date: goes to the inbox
    expect(made.source).toBe('inbox');

    const moved = await call('PATCH', `tasks/${made.id}`, { scheduled: '2026-08-28', part: 'morning' });
    expect(moved.status).toBe(200);
    expect(moved.body.task).toMatchObject({ scheduled: '2026-08-28', part: 'morning' });
    expect(await vault.read('70 OBSIDIAN/70-06 Daily Notes/2026/08 - August/35/28, Friday, Aug, 2026.md')).toContain('Book the venue');

    const unscheduled = await call('PATCH', `tasks/${made.id}`, { scheduled: null });
    expect(unscheduled.body.task.scheduled).toBeNull();

    const ticked = await call('PATCH', `tasks/${made.id}`, { status: 'done' });
    expect(ticked.body.task).toMatchObject({ status: 'done', open: false });

    const gone = await call('DELETE', `tasks/${made.id}`);
    expect(gone.status).toBe(200);
    expect([...index.snapshot.tasks.values()].some((t) => t.id === made.id)).toBe(false);
  });

  it('adds a subtask under a task and reports it on the parent', async () => {
    const { call } = await api();
    const parent = (await call('POST', 'tasks', { text: 'Ship the draft', scheduled: TODAY })).body.task;
    const kid = await call('POST', `tasks/${parent.id}/subtasks`, { text: 'Proof it' });
    expect(kid.status).toBe(201);
    expect(kid.body.task).toMatchObject({ text: 'Proof it', depth: 1, parentId: parent.id });
    const after = await call('GET', `tasks/${parent.id}`);
    expect(after.body.subtasks.map((s: any) => s.text)).toEqual(['Proof it']);
  });

  it('creates, edits and deletes projects, and puts a task in one', async () => {
    const { call, index } = await api();
    const list = await call('GET', 'projects');
    expect(list.body.projects.map((p: any) => p.title)).toContain('Oracle Book Writing');

    const p = (await call('POST', 'projects', { title: 'Garden Rebuild', area: 'Home', due: '2026-10-01' })).body.project;
    expect(p).toMatchObject({ title: 'Garden Rebuild', area: 'Home', due: '2026-10-01', status: 'active' });

    const inProject = (await call('POST', 'tasks', { text: 'Order gravel', projectId: p.id })).body.task;
    expect(inProject.project.id).toBe(p.id);

    const patched = await call('PATCH', `projects/${p.id}`, { status: 'on-hold', priority: 'high' });
    expect(patched.body.project).toMatchObject({ status: 'on-hold', priority: 'high' });
    expect(await call('PATCH', `projects/${p.id}`, { status: 'paused' })).toMatchObject({ status: 400 }); // not a status Helm knows
    expect(await call('POST', 'projects', { title: 'Nope', status: 'sideways' })).toMatchObject({ status: 400 });

    expect((await call('DELETE', `projects/${p.id}`)).status).toBe(200);
    expect(index.project(p.id)).toBeUndefined();
  });

  it('says no clearly instead of writing nonsense', async () => {
    const { call } = await api();
    expect(await call('POST', 'tasks', {})).toMatchObject({ status: 400, body: { error: 'A task needs text' } });
    expect(await call('POST', 'tasks', { text: 'x', scheduled: 'friday' })).toMatchObject({ status: 400 });
    expect(await call('POST', 'tasks', { text: 'x', projectId: 'prj-nope' })).toMatchObject({ status: 404 });
    const t = (await call('POST', 'tasks', { text: 'Something' })).body.task;
    expect(await call('PATCH', `tasks/${t.id}`, { status: 'sideways' })).toMatchObject({ status: 400 });
    expect(await call('PATCH', `tasks/${t.id}`, { part: 'midnight' })).toMatchObject({ status: 400 });
    expect(await call('PATCH', `tasks/${t.id}`, {})).toMatchObject({ status: 400, body: { error: 'Nothing to change' } });
    expect(await call('GET', 'nonsense')).toMatchObject({ status: 404 });
    expect(await call('DELETE', 'tasks')).toMatchObject({ status: 405 });
  });
});

describe('moving a task into a project over the API', () => {
  it('takes its notes, drawings and links with it', async () => {
    const s = await setup({
      '81 AI/Cert research.md': '---\nhelm-task: tsk-grow\n---\n# Cert research\n',
    });
    await s.m.addTask({ text: 'Build the cert lab [OCI docs](https://docs.example.com/oci)', date: TODAY, fields: { id: 'tsk-grow' } });
    const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: 't', written: () => [], read: (p) => s.vault.read(p) };
    const r = await handle({ method: 'PATCH', path: 'tasks/tsk-grow', query: {}, body: { projectId: 'prj-kitchen' } }, deps) as { status: number; body: any };
    expect(r.status).toBe(200);
    expect(r.body.task.project.id).toBe('prj-kitchen');
    const note = await s.vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md');
    expect(note).toContain('[[Cert research]]');
    expect(note).toContain('docs.example.com/oci');
    const bad = await handle({ method: 'PATCH', path: 'tasks/tsk-grow', query: {}, body: { projectId: 'prj-nope' } }, deps);
    expect(bad.status).toBe(404);
  });
});

describe('profiled projects over the API', () => {
  it('creates a music project, adds a song as a sub-project with assignments and steps, lists it, and archives it', async () => {
    const { call } = await api();
    const made = await call('POST', 'projects', { title: 'Music Studies', profile: 'music', people: ['Iwan', 'Zaara'], status: 'active' });
    expect(made.status).toBe(201);
    expect(made.body.project.profile).toBe('music');
    expect(made.body.project.modes).toContain('Piano solo');
    const id = made.body.project.id as string;

    const item = await call('POST', `projects/${id}/items`, {
      title: 'Amazing Grace', note: 'Amazing Grace', group: 'September 2026',
      assignments: [{ person: 'Iwan', mode: 'Piano solo', steps: ['Right hand', 'Left hand'] }, { person: 'Zaara', mode: 'singing' }],
      stepEffortMinutes: 20,
    });
    expect(item.status).toBe(201);
    expect(item.body.item.kind).toBe('project');
    expect(item.body.item.note).toBe('Amazing Grace');
    expect(item.body.item.group).toBe('September 2026');
    expect(item.body.item.period).toBe('2026-09');
    expect(item.body.item.people).toEqual(['Iwan', 'Zaara']);
    expect(item.body.item.work.map((w: any) => w.mode)).toEqual(['Piano solo', 'Singing']);
    expect(item.body.item.work[0].kind).toBe('phase');
    expect(item.body.item.work[0].steps.map((s: any) => s.text)).toEqual(['Right hand', 'Left hand']);
    expect(item.body.item.work[0].steps[0].effortMinutes).toBe(20);
    expect(item.body.item.work[0].steps.every((s: any) => typeof s.id === 'string' && s.id.startsWith('tsk-'))).toBe(true);
    const songId = item.body.item.id as string;
    expect((await call('GET', `projects/${songId}`)).body.parentId).toBe(id);

    const items = await call('GET', `projects/${id}/items`);
    expect(items.status).toBe(200);
    expect(items.body.items).toHaveLength(1);
    expect(items.body.items[0].work[1].person).toBe('Zaara');

    const stepId = item.body.item.work[0].steps[0].id as string;
    const planned = await call('PATCH', `tasks/${stepId}`, { scheduled: '2026-09-10' });
    expect(planned.status).toBe(200);
    expect(planned.body.task.scheduled).toBe('2026-09-10');

    const more = await call('POST', `projects/${songId}/phases`, { title: 'Iwan · Piano chords', tasks: ['Chords per section', 'Play along'], effortMinutes: 15 });
    expect(more.status).toBe(201);
    expect(more.body.tasks).toHaveLength(2);
    expect((await call('GET', `projects/${id}/items`)).body.items[0].work).toHaveLength(3);

    // A line item is still possible when asked for.
    const line = await call('POST', `projects/${id}/items`, { title: 'Sign of the Times', group: 'September 2026', assignments: [{ person: 'Zaara', mode: 'Singing', steps: ['Warm up'] }], asProject: false });
    expect(line.status).toBe(201);
    expect(line.body.item.kind).toBe('task');
    expect(line.body.item.work[0].steps).toHaveLength(1);
    const lineSteps = await call('POST', `tasks/${line.body.item.work[0].id}/steps`, { steps: ['Verse 1'] });
    expect(lineSteps.status).toBe(201);

    const bad = await call('POST', `projects/${id}/items`, { title: 'X', assignments: [{ mode: 'Juggling' }] });
    expect(bad.status).toBe(400);

    const archived = await call('POST', `projects/${songId}/archive`);
    expect(archived.status).toBe(200);
    expect((await call('GET', `projects/${id}/items`)).body.items.every((it: any) => it.id !== songId)).toBe(true);
  });
});

describe('deleting a repeating task over the API', () => {
  it('takes a mode, and without one behaves as it always did', async () => {
    const s = await setup();
    const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: 't', read: (p) => s.vault.read(p), written: () => [] };
    const call = (method: string, path: string, query: Record<string, string> = {}): Promise<{ status: number; body: any }> =>
      handle({ method, path, query } as ApiRequest, deps) as Promise<{ status: number; body: any }>;
    const weekly = { recurrence: { raw: 'every week', parsed: true, frequency: 'weekly' as const, interval: 1 } };

    await s.m.addTask({ text: 'Weekly one', date: '2026-08-19', fields: weekly });
    const past = [...s.index.snapshot.tasks.values()].find((t) => t.text === 'Weekly one')!;
    await s.m.setStatus(past.key, 'done');
    await s.m.catchUpRecurring();
    const open = [...s.index.snapshot.tasks.values()].find((t) => t.text === 'Weekly one' && (t.noteDate ?? t.scheduled) === TODAY)!;

    expect(await call('DELETE', `tasks/${open.key}`, { mode: 'sideways' })).toMatchObject({ status: 400 });

    const r = await call('DELETE', `tasks/${open.key}`, { mode: 'once' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ skipped: TODAY, stopped: 0 });
    await s.m.catchUpRecurring();
    expect([...s.index.snapshot.tasks.values()].some((t) => t.text === 'Weekly one' && (t.noteDate ?? t.scheduled) === TODAY)).toBe(false);
  });
});

describe('a new day and a new time in one PATCH', () => {
  it('lands in the part the new time falls in, not the old one', async () => {
    const s = await setup();
    const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: 't', read: (p) => s.vault.read(p), written: () => [] };
    await s.m.addTask({ text: 'Evening thing', date: TODAY, part: 'evening', fields: { time: { start: '19:00', end: '20:00' } } });
    const t = [...s.index.snapshot.tasks.values()].find((x) => x.text === 'Evening thing')!;
    const r = await handle({ method: 'PATCH', path: `tasks/${t.key}`, query: {}, body: { scheduled: '2026-08-28', time: '09:30', timeEnd: '10:15' } }, deps) as { status: number; body: any };
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({ scheduled: '2026-08-28', part: 'morning', time: '09:30', timeEnd: '10:15' });
  });
});

describe('ending a series from the API', () => {
  it('recurrence: null on the upcoming turn stops it for good, even if that line is deleted afterwards', async () => {
    const s = await setup();
    const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: 't', read: (p) => s.vault.read(p), written: () => [] };
    const weekly = { recurrence: { raw: 'every week', parsed: true, frequency: 'weekly' as const, interval: 1 } };
    await s.m.addTask({ text: 'Lesson', date: '2026-08-19', fields: weekly });
    await s.m.setStatus([...s.index.snapshot.tasks.values()].find((x) => x.text === 'Lesson')!.key, 'done');
    await s.m.catchUpRecurring();
    const open = [...s.index.snapshot.tasks.values()].find((x) => x.text === 'Lesson' && (x.noteDate ?? x.scheduled) === TODAY)!;
    await handle({ method: 'PATCH', path: `tasks/${open.key}`, query: {}, body: { recurrence: null } }, deps);
    await s.m.deleteTask([...s.index.snapshot.tasks.values()].find((x) => x.text === 'Lesson' && (x.noteDate ?? x.scheduled) === TODAY)!.key);
    await s.m.catchUpRecurring();
    expect([...s.index.snapshot.tasks.values()].some((x) => x.text === 'Lesson' && (x.noteDate ?? x.scheduled) === TODAY)).toBe(false);
  });
});

describe('what a task belongs to, in every task the API returns', () => {
  it('carries project, follow-up and linking project as `context`', async () => {
    const s = await setup();
    const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: 't', read: (p) => s.vault.read(p), written: () => [] };
    await s.m.addTask({ text: 'Plan the kitchen', date: TODAY, fields: { id: 'tsk-orig' } });
    await s.m.followUp(s.index.taskById('tsk-orig')!.key, { text: 'Order the tiles', date: TODAY });
    const fu = [...s.index.snapshot.tasks.values()].find((x) => x.text === 'Order the tiles')!;
    await s.m.linkTaskToProject('prj-kitchen', fu.key);

    const list = await handle({ method: 'GET', path: 'tasks', query: { q: 'Order the tiles' } }, deps) as { body: any };
    const ctx = list.body.tasks[0].context;
    expect(ctx).toEqual([
      { kind: 'follows', text: 'Plan the kitchen', title: 'Follow-up of: Plan the kitchen', ref: 'tsk-orig' },
      { kind: 'related', text: 'Kitchen Remodel', title: 'Linked from project: Kitchen Remodel', ref: 'prj-kitchen' },
    ]);
    const draft = await handle({ method: 'GET', path: 'tasks/tsk-0001', query: {} }, deps) as { body: any };
    expect(draft.body.context[0]).toMatchObject({ kind: 'project', text: 'Oracle Book Writing', ref: 'prj-book' });
  });
});
