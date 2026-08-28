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

  it('refuses a follow-up on a task that has subtasks — that one gets moved instead', async () => {
    const { m, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    await m.addTask({ text: 'Sub one', parentKey: orig.key });
    await expect(m.followUp(index.task(orig.key)!.key, { text: 'Carry on', date: '2026-08-28' })).rejects.toThrow(/subtasks/i);
  });

  it('follows up a subtask like any other task: a normal task on the new day, linked back to it', async () => {
    const { m, vault, index } = await setup();
    const parent = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    await m.addTask({ text: 'Read the docs', parentKey: parent.key });
    const kid = index.task(parent.key)!.childKeys.map((k) => index.task(k)!)[0]!;
    const r = await m.followUp(kid.key, { text: 'Finish the docs', date: '2026-08-28' });
    const friday = await vault.read(dailyPath('2026-08-28'));
    expect(friday).toMatch(new RegExp(`^- \\[ \\] Finish the docs 🆔 tsk-\\w+ ⛔ ${r.id}$`, 'm')); // top level, not indented
    const fu = [...index.snapshot.tasks.values()].find((t) => t.id === r.followUpId && t.origin !== 'daily-mirror')!;
    expect(fu.depth).toBe(0);
    expect(fu.parentKey).toBeUndefined();
    // The subtask itself stays where it is, now carrying an id so the follow-up can point at it.
    const stillThere = [...index.snapshot.tasks.values()].find((t) => t.id === r.id)!;
    expect(stillThere.depth).toBe(1);
    expect((await vault.read(dailyPath('2026-08-25'))).match(/Read the docs/g)).toHaveLength(1);
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

});
