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
    index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: '9.9.9',
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
    const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: 't', written: () => [] };
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
