import { describe, expect, it } from 'vitest';
import { setup, dailyPath } from './fixture';

describe('subtasks', () => {
  it('adds one under its parent, indented, in the same note', async () => {
    const { m, vault, index } = await setup();
    const parent = index.task('tsk-0001')!;
    await m.addTask({ text: 'Sketch the outline', parentKey: parent.key });
    const note = await vault.read(parent.path);
    const lines = note.split('\n');
    const at = lines.findIndex((l) => l.includes('Draft chapter list'));
    expect(lines.slice(at + 1).find((l) => l.includes('Sketch the outline'))).toMatch(/^\s+- \[ \] Sketch the outline/);
    const fresh = index.task('tsk-0001')!;
    const kid = fresh.childKeys.map((k) => index.task(k)!).find((t) => t.text === 'Sketch the outline')!;
    expect(kid.depth).toBe(1);
    expect(kid.parentKey).toBe(fresh.key);
  });

  it('hands unfinished subtasks to a follow-up and leaves the finished ones behind', async () => {
    const { m, vault, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    await m.addTask({ text: 'Read the docs', parentKey: orig.key });
    await m.addTask({ text: 'Draw the diagram', parentKey: orig.key });
    const fresh = index.task(orig.key)!;
    const done = fresh.childKeys.map((k) => index.task(k)!).find((t) => t.text === 'Read the docs')!;
    await m.setStatus(done.key, 'done');
    // A subtask of a subtask travels with it.
    const keep = index.task(orig.key)!.childKeys.map((k) => index.task(k)!).find((t) => t.text === 'Draw the diagram')!;
    await m.addTask({ text: 'Pick the colours', parentKey: keep.key });

    const r = await m.followUp(orig.key, { text: 'Carry on', date: '2026-08-28' });
    const friday = await vault.read(dailyPath('2026-08-28'));
    expect(friday).toContain('Carry on');
    expect(friday).toMatch(/- \[ \] Carry on[^\n]*\n\s+- \[ \] Draw the diagram\n\s+\s+- \[ \] Pick the colours/);
    const yesterday = await vault.read(dailyPath('2026-08-25'));
    expect(yesterday).toContain('Read the docs');       // the finished one stays with the original
    expect(yesterday).not.toContain('Draw the diagram'); // the unfinished ones moved
    expect(yesterday).not.toContain('Pick the colours');
    const byId = (id: string) => [...index.snapshot.tasks.values()].find((t) => t.id === id && t.origin !== 'daily-mirror')!;
    expect(byId(r.followUpId).childKeys.map((k) => index.task(k)!.text)).toEqual(['Draw the diagram']);
    expect(byId(r.id).childKeys.map((k) => index.task(k)!.text)).toEqual(['Read the docs']); // the original now carries an id, so look it up by that
  });

  it('moves nothing when every subtask is finished', async () => {
    const { m, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    await m.addTask({ text: 'Already done', parentKey: orig.key });
    const kid = index.task(orig.key)!.childKeys.map((k) => index.task(k)!)[0]!;
    await m.setStatus(kid.key, 'done');
    expect(await m.moveSubtasks(orig.key, orig.key)).toBe(0);
    expect(index.task(orig.key)!.childKeys).toHaveLength(1);
  });
});
