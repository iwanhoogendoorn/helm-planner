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
