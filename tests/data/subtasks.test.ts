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

  it('hands every subtask to a follow-up, finished ones included, keeping their state and nesting', async () => {
    const { m, vault, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    await m.addTask({ text: 'Read the docs', parentKey: orig.key });
    await m.addTask({ text: 'Draw the diagram', parentKey: orig.key });
    const done = index.task(orig.key)!.childKeys.map((k) => index.task(k)!).find((t) => t.text === 'Read the docs')!;
    await m.setStatus(done.key, 'done');
    const keep = index.task(orig.key)!.childKeys.map((k) => index.task(k)!).find((t) => t.text === 'Draw the diagram')!;
    await m.addTask({ text: 'Pick the colours', parentKey: keep.key });

    const r = await m.followUp(orig.key, { text: 'Carry on', date: '2026-08-28' });
    const friday = await vault.read(dailyPath('2026-08-28'));
    expect(friday).toMatch(/- \[ \] Carry on[^\n]*\n\s+- \[x\] Read the docs[^\n]*\n\s+- \[ \] Draw the diagram\n\s+\s+- \[ \] Pick the colours/);
    const yesterday = await vault.read(dailyPath('2026-08-25'));
    expect(yesterday).not.toContain('Read the docs'); // everything moved, done or not
    expect(yesterday).not.toContain('Draw the diagram');
    const byId = (id: string) => [...index.snapshot.tasks.values()].find((t) => t.id === id && t.origin !== 'daily-mirror')!;
    expect(byId(r.followUpId).childKeys.map((k) => index.task(k)!.text)).toEqual(['Read the docs', 'Draw the diagram']);
    expect(index.task(byId(r.followUpId).childKeys[0]!)!.status).toBe('done'); // a done subtask stays done
    expect(byId(r.id).childKeys).toEqual([]);
  });

  it('moves a task within the day and to another day with its subtasks', async () => {
    const { m, vault, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    await m.addTask({ text: 'Sub A', parentKey: orig.key });
    await m.addTask({ text: 'Sub B', parentKey: orig.key });
    // Dragged to another part of the same day: the subtasks come along.
    await m.setPart(index.task(orig.key)!.key, 'evening');
    const day = await vault.read(dailyPath('2026-08-25'));
    expect(day).toMatch(/### C\. Evening\n(?:.*\n)*?- \[ \] 08:00 - 09:00: Start with OIB\n\t- \[ \] Sub A\n\t- \[ \] Sub B/);
    expect(day.split('### A. Morning')[1]!.split('###')[0]).not.toContain('Sub A');
    // Moved to another day: parent and subtasks land there together.
    await m.schedule(index.task(orig.key)!.key, '2026-08-28');
    const friday = await vault.read(dailyPath('2026-08-28'));
    expect(friday).toMatch(/- \[ \] .*Start with OIB[^\n]*\n\t- \[ \] Sub A\n\t- \[ \] Sub B/);
  });

  it('moves nothing when a task has no subtasks', async () => {
    const { m, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    expect(await m.moveSubtasks(orig.key, orig.key)).toBe(0);
  });
});
