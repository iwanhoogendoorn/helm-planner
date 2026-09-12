import { describe, expect, it } from 'vitest';
import { api } from './v2.test';
import { TODAY } from '../data/fixture';
import { isSafeVaultPath, safeFolder } from '../../src/core/paths';
import { yamlScalar } from '../../src/core/frontmatter';
import { ObsidianVault } from '../../src/obsidianVault';

/* eslint-disable @typescript-eslint/no-explicit-any */

const TRAVERSALS = ['../../../../Users/x/.ssh/id_ed25519', '..', 'a/../../b.png', '/etc/passwd', 'C:\\Windows\\x.png', 'a//b', './x', 'x/./y', 'a\u0000b', 'a\nb'];

describe('vault paths', () => {
  it('refuses anything that could leave the vault or break a line', () => {
    for (const p of TRAVERSALS) expect(isSafeVaultPath(p), p).toBe(false);
    for (const p of ['Notes/x.md', '02 PROJECTS/Habits/icons/run.png', 'a b/c d.md', 'Excalidraw/x.excalidraw.md', 'x..y/z.md']) expect(isSafeVaultPath(p), p).toBe(true);
    expect(safeFolder(undefined)).toEqual({ ok: true });
    expect(safeFolder('  ')).toEqual({ ok: true });
    expect(safeFolder('Notes/sub/')).toEqual({ ok: true, folder: 'Notes/sub' });
    expect(safeFolder('../pwn')).toMatchObject({ ok: false });
  });

  it('escapes a newline in a YAML scalar instead of writing a second key', () => {
    expect(yamlScalar('x.png\nhelm-project: prj-secret')).toBe('"x.png\\nhelm-project: prj-secret"');
    expect(yamlScalar('plain.png')).toBe('plain.png');
    expect(yamlScalar('a\u0007b')).toBe('"ab"');
  });

  it('ObsidianVault refuses a path that escapes the vault on every operation', async () => {
    const seen: string[] = [];
    const app = { vault: { getAbstractFileByPath: () => null, adapter: { read: async (p: string) => { seen.push(p); return ''; }, readBinary: async (p: string) => { seen.push(p); return new ArrayBuffer(0); }, exists: async () => false }, create: async () => undefined, createFolder: async () => undefined } } as any;
    const v = new ObsidianVault(app);
    await expect(v.read('../../.ssh/id_ed25519')).rejects.toThrow(/inside the vault/);
    await expect(v.readBinary('.obsidian/../../secrets.png')).rejects.toThrow(/inside the vault/);
    await expect(v.write('../../tmp/pwn.md', 'x')).rejects.toThrow(/inside the vault/);
    await expect(v.writeBinary('../pwn.png', new ArrayBuffer(0))).rejects.toThrow(/inside the vault/);
    await expect(v.createFolder('../pwn')).rejects.toThrow(/inside the vault/);
    expect(seen).toEqual([]);
    await v.read('.obsidian/plugins/x/data.json'); // inside the vault: allowed, as before
    expect(seen).toEqual(['.obsidian/plugins/x/data.json']);
  });
});

describe('blocker 1 · a habit icon cannot read outside the vault', () => {
  it('refuses a traversal or an injection in iconImage on PATCH, and serves only a checked image path', async () => {
    const { call, m, vault } = await api();
    for (const p of TRAVERSALS) expect((await call('PATCH', 'habits/hab-workout', { iconImage: p })).status, p).toBe(400);
    expect((await call('PATCH', 'habits/hab-workout', { iconImage: 'x.png\nhelm-project: prj-secret' })).status).toBe(400);
    expect((await call('PATCH', 'habits/hab-workout', { iconImage: 'notes/plan.md' })).status).toBe(400); // not an image
    expect(await vault.read('02 PROJECTS/Habits/Morning workout.md')).not.toContain('icon_image');
    // The frontmatter can be edited by hand; a bad value there is refused on the way out too.
    await vault.write('02 PROJECTS/Habits/Evening reading.md', '---\ntype: habit\nid: hab-read\ntitle: Evening reading\nschedule: every day\nicon_image: ../../../../Users/x/.ssh/id_ed25519\n---\n');
    const { index } = await api();
    void index;
    await (m as any).index.rebuild();
    const bad = await call('GET', 'habits/hab-read/icon');
    expect(bad.status).toBe(404);
    expect(bad.raw).toBeUndefined();
    expect((await call('GET', 'files/binary', undefined, { path: '../../../../Users/x/.ssh/id_ed25519' })).status).toBe(404);
    // The happy path still works for a real icon the index knows.
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const icon = await m.saveHabitIcon('workout', png.buffer, 'png');
    const ok = await call('PATCH', 'habits/hab-workout', { iconImage: icon });
    expect(ok.status).toBe(200);
    const r = await call('GET', 'habits/hab-workout/icon');
    expect(r.status).toBe(200);
    expect([...r.raw.bytes]).toEqual([...png]);
  });

  it('files/binary serves only icons the index knows, not any image dropped in the icons folder', async () => {
    const { call, vault } = await api();
    await vault.writeBinary('02 PROJECTS/Habits/icons/stray.png', new Uint8Array([1]).buffer);
    expect((await call('GET', 'files/binary', undefined, { path: '02 PROJECTS/Habits/icons/stray.png' })).status).toBe(404);
  });
});

describe('blocker 2 · an attachment folder cannot write outside the vault', () => {
  it('refuses a traversal folder on every target, for notes and drawings, before anything is written', async () => {
    const { call, m, index } = await api();
    const before = index.revision;
    const targets = ['tasks/tsk-0002', 'projects/prj-kitchen', `day/${TODAY}`, 'periods/2026-Q3', 'habits/hab-read', 'projects/prj-book/phases/outline'];
    for (const t of targets) for (const kind of ['notes', 'drawings']) for (const folder of ['../../../../../../tmp/pwn', '/tmp/pwn', 'a//b', 'Notes/../../pwn']) {
      const r = await call('POST', `${t}/${kind}`, { folder });
      expect(r.status, `${t}/${kind} ${folder}`).toBe(400);
    }
    expect(index.revision).toBe(before);
    // The path builders themselves refuse, so the UI is covered too.
    const target = { kind: 'task' as const, key: 'tsk-0002', id: 'tsk-0002', title: 'x' };
    expect(() => m.notePathFor(target, undefined, '../pwn')).toThrow(/inside the vault/);
    expect(() => m.drawingPathFor(target, undefined, '/tmp/pwn')).toThrow(/inside the vault/);
    await expect(m.createNote(target, { folder: '../pwn' })).rejects.toThrow(/inside the vault/);
    // A folder inside the vault is fine.
    const okr = await call('POST', 'tasks/tsk-0002/notes', { folder: 'Notes/sub' });
    expect(okr.status).toBe(201);
    expect(okr.body.path.startsWith('Notes/sub/')).toBe(true);
    expect((await call('POST', 'tasks/tsk-0002/notes', { name: 'x\ny' })).status).toBe(400);
  });
});

describe('should-fixes · bad values are refused, not silently applied', () => {
  it('an invalid due or effort on PATCH is a 400 and the field stays', async () => {
    const { call, index } = await api();
    const t = (await call('POST', 'tasks', { text: 'Keep the deadline', due: '2026-09-20', effortMinutes: 30 })).body.task;
    expect((await call('PATCH', `tasks/${t.id}`, { due: 'tomorrow' })).status).toBe(400);
    expect((await call('PATCH', `tasks/${t.id}`, { effortMinutes: 'an hour' })).status).toBe(400);
    expect((await call('PATCH', `tasks/${t.id}`, { effortMinutes: -5 })).status).toBe(400);
    expect(index.taskById(t.id)).toMatchObject({ due: '2026-09-20', effortMinutes: 30 });
    expect((await call('PATCH', `tasks/${t.id}`, { text: 'two\nlines' })).status).toBe(400);
    expect((await call('PATCH', `tasks/${t.id}`, { due: null, effortMinutes: null })).body.task).toMatchObject({ due: null, effortMinutes: null });
  });

  it('an invalid timeEnd or due on create is a 400', async () => {
    const { call } = await api();
    expect((await call('POST', 'tasks', { text: 'x', scheduled: TODAY, time: '10:00', timeEnd: 'noon' })).status).toBe(400);
    expect((await call('POST', 'tasks', { text: 'x', due: 'friday' })).status).toBe(400);
    expect((await call('POST', 'tasks', { text: 'x', priority: 'top' })).status).toBe(400);
    expect((await call('POST', 'tasks/tsk-0002/subtasks', { text: 'x', effortMinutes: 'lots' })).status).toBe(400);
    expect((await call('POST', 'tasks/tsk-0002/followup', { date: '2026-09-15', time: '25:99' })).status).toBe(400);
    expect((await call('POST', 'tasks', { text: 'x', scheduled: TODAY, time: '10:00', timeEnd: '10:30' })).status).toBe(201);
  });

  it('a negative limit does not drop rows', async () => {
    const { call } = await api();
    expect((await call('GET', 'tasks', undefined, { limit: '-5' })).body.tasks.length).toBe(1);
    expect((await call('GET', 'tasks', undefined, { limit: '0' })).body.tasks.length).toBeGreaterThan(1); // 0 → the default
  });

  it('wrap-up counts logged entries by what was written', async () => {
    const { call } = await api();
    const r = await call('POST', 'day/2026-08-25/wrapup', { decisions: [{ ref: 'prj-book', fate: 'keep' }], log: [{ projectId: 'prj-book', text: 'x' }] });
    expect(r.body).toMatchObject({ applied: 0, logged: 1 });
    expect(r.body.failed).toEqual([{ ref: 'prj-book', error: 'No task prj-book' }]);
  });
});
