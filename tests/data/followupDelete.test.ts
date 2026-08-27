import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';

const text = (s: string, needle: string): string[] => s.split('\n').filter((l) => /^\s*- \[/.test(l) && l.includes(needle));

describe('deleting a follow-up leaves the original alone', () => {
  it('daily original, follow-up on another day', async () => {
    const { m, vault, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    const r = await m.followUp(orig.key, { text: 'Continue OIB', date: TODAY, markOriginalDone: true });
    const fu = [...index.snapshot.tasks.values()].find((t) => t.text.startsWith('Continue OIB'))!;
    await m.deleteTask(fu.key);
    expect(text(await vault.read(dailyPath(TODAY)), 'Continue OIB')).toEqual([]);
    expect(text(await vault.read(dailyPath('2026-08-25')), r.id)).toHaveLength(1);
    expect(text(await vault.read(dailyPath('2026-08-25')), 'Start with OIB')).toHaveLength(1);
  });
  it('daily original, follow-up on the same day, then the follow-up deleted from a stale task object', async () => {
    const { m, vault, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.noteDate === '2026-08-25' && t.status === 'todo' && t.section !== 'outside')!;
    await m.followUp(orig.key, { text: 'Continue OIB', date: '2026-08-25', part: 'morning', markOriginalDone: false });
    const fu = [...index.snapshot.tasks.values()].find((t) => t.text.startsWith('Continue OIB'))!;
    await m.deleteTask(fu.key);
    const note = await vault.read(dailyPath('2026-08-25'));
    expect(text(note, 'Continue OIB')).toEqual([]);
    expect(text(note, 'Start with OIB')).toHaveLength(1);
  });
  it('project original: deleting the follow-up (project line or its mirror) keeps the original and its mirror', async () => {
    const { m, vault, index } = await setup();
    const orig = [...index.snapshot.tasks.values()].find((t) => t.origin === 'project' && t.projectId === 'prj-book' && t.status !== 'done')!;
    await m.schedule(orig.key, TODAY);
    const o2 = [...index.snapshot.tasks.values()].find((t) => t.text === orig.text && t.origin === 'project')!;
    const before = text(await vault.read(orig.path), o2.id!).length;
    const r = await m.followUp(o2.key, { text: 'Second pass', date: TODAY, markOriginalDone: false });
    const fuMirror = [...index.snapshot.tasks.values()].find((t) => t.text.startsWith('Second pass') && t.origin === 'daily-mirror')!;
    await m.deleteTask(fuMirror.key);
    let proj = await vault.read(orig.path);
    expect(text(proj, 'Second pass')).toHaveLength(1);
    expect(text(proj, r.id)).toHaveLength(before + 1); // the follow-up's ⛔ reference on top of what was there
    const fuProj = [...index.snapshot.tasks.values()].find((t) => t.text.startsWith('Second pass') && t.origin === 'project')!;
    await m.deleteTask(fuProj.key);
    proj = await vault.read(orig.path);
    expect(text(proj, 'Second pass')).toEqual([]);
    expect(text(proj, r.id)).toHaveLength(before); // back to what was there before the follow-up
    expect(text(await vault.read(dailyPath(TODAY)), orig.text)).toHaveLength(1);
  });
});
