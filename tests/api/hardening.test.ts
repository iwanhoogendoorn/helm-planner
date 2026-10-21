import { describe, expect, it } from 'vitest';
import { api } from './v2.test';
import { TODAY } from '../data/fixture';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Every file in the vault, so a test can assert a refused request wrote nothing at all. */
const filesOf = (vault: any): Map<string, string> => new Map(vault.files as Map<string, string>);

describe('H1 · a list field cannot smuggle a newline into a note', () => {
  const EVIL = 'evil\nstatus: done\ninjected: yes';

  it('refuses a control character in any list field of POST /projects, and writes nothing', async () => {
    const { call, vault } = await api();
    const before = filesOf(vault);
    for (const body of [
      { title: 'Tags', tags: ['fine', EVIL] },
      { title: 'Tasks', tasks: ['one\n- [x] forged done line 🆔 tsk-dup'] },
      { title: 'Notes', notes: ['Plan\n## Log'] },
      { title: 'Phase tasks', phases: [{ title: 'P', tasks: ['a\rb'] }] },
      { title: 'People', people: ['Iwan\nstatus: done'] },
      { title: 'Modes', modes: ['x\u0007'] },
    ]) {
      const r = await call('POST', 'projects', body);
      expect(r.status, JSON.stringify(body)).toBe(400);
      expect(r.body.error).toMatch(/control characters|line breaks/);
    }
    expect(filesOf(vault)).toEqual(before);
  });

  it('refuses a tag that is not a single word, so a tag cannot become a YAML key', async () => {
    const { call } = await api();
    expect((await call('POST', 'projects', { title: 'T', tags: ['a: b'] })).status).toBe(400);
    expect((await call('POST', 'projects', { title: 'T', tags: ['two words'] })).status).toBe(400);
    const r = await call('POST', 'projects', { title: 'Tagged', tags: ['#home', 'work/deep', 'café'] });
    expect(r.status).toBe(201);
  });

  it('refuses a control character in phase tasks, steps, item steps and capture tags', async () => {
    const { call, vault } = await api();
    const before = filesOf(vault);
    expect((await call('POST', 'projects/prj-book/phases', { title: 'New phase', tasks: ['a\nb'] })).status).toBe(400);
    expect((await call('POST', 'tasks/tsk-0001/steps', { steps: ['ok', 'bad\n- [x] forged'] })).status).toBe(400);
    expect((await call('POST', 'capture', { text: 'Buy milk', tags: ['x\ny'] })).status).toBe(400);
    expect((await call('POST', 'capture', { text: 'Buy milk', tags: ['two words'] })).status).toBe(400);
    expect((await call('POST', 'tasks/bulk', { refs: ['tsk-0001\n'], action: 'status', status: 'done' })).status).toBe(400);
    expect(filesOf(vault)).toEqual(before);
    const made = await call('POST', 'projects', { title: 'Music Studies', profile: 'music', people: ['Iwan'] });
    const r = await call('POST', `projects/${made.body.project.id}/items`, { title: 'Song', assignments: [{ person: 'Iwan', mode: 'Piano solo', steps: ['a\nb'] }] });
    expect(r.status).toBe(400);
  });

  it('still accepts clean lists and trims them as before', async () => {
    const { call, index } = await api();
    const r = await call('POST', 'projects/prj-book/phases', { title: 'Clean', tasks: ['  one  ', '', 'two'] });
    expect(r.status).toBe(201);
    expect(r.body.tasks.map((t: any) => t.text)).toEqual(['one', 'two']);
    expect(index.task('tsk-0001')).toBeDefined();
    expect((await call('POST', 'capture', { text: 'Buy milk', tags: ['#errand'], date: TODAY })).status).toBe(201);
  });
});

describe('M1 · PATCH /tasks/:ref validates every field before it writes', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['status then a bad priority', { status: 'done', priority: 'bogus' }],
    ['a move then a parentId', { projectId: 'prj-book', parentId: 'tsk-0001' }],
    ['a schedule then a bad due', { scheduled: TODAY, due: 'friday' }],
    ['status then an unknown blocker', { status: 'done', blockedBy: ['tsk-nope'] }],
    ['a known blocker then a bad effort', { blockedBy: ['tsk-0001'], effortMinutes: -1 }],
    ['progress then a bad recurrence', { progress: 50, recurrence: 'whenever' }],
    ['a part then a bad time', { part: 'evening', time: '25:00' }],
    ['status then a bad text', { status: 'doing', text: 'two\nlines' }],
  ];
  for (const [name, body] of cases) {
    it(`refuses ${name} and leaves the vault untouched`, async () => {
      const { call, vault } = await api();
      const t = (await call('POST', 'tasks', { text: 'Atomic edit', scheduled: TODAY })).body.task;
      const before = filesOf(vault);
      const r = await call('PATCH', `tasks/${t.id}`, body);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(filesOf(vault)).toEqual(before);
    });
  }

  it('still applies a valid multi-field edit, including timeEnd on its own and blockers', async () => {
    const { call, index } = await api();
    const t = (await call('POST', 'tasks', { text: 'Edit me', scheduled: TODAY, time: '10:00', timeEnd: '10:30' })).body.task;
    const r = await call('PATCH', `tasks/${t.id}`, { status: 'doing', priority: 'high', timeEnd: '11:00', blockedBy: ['tsk-0001'] });
    expect(r.status).toBe(200);
    expect(r.body.task).toMatchObject({ status: 'doing', priority: 'high' });
    expect(index.taskById(t.id)).toMatchObject({ time: { start: '10:00', end: '11:00' }, blockedBy: ['tsk-0001'] });
    expect((await call('PATCH', `tasks/${t.id}`, {})).status).toBe(400);
  });
});
