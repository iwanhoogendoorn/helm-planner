import { describe, expect, it } from 'vitest';
import { setup, TODAY, SETTINGS } from './fixture';
import { compareProjects, projectHealth } from '../../src/data/planner';

const listed = (index: { allProjects: () => { id: string; title: string }[]; snapshot: unknown }, s = SETTINGS): string[] => {
  const snap = (index as unknown as { snapshot: Parameters<typeof projectHealth>[0] }).snapshot;
  return (index.allProjects() as Parameters<typeof projectHealth>[1][])
    .map((p) => projectHealth(snap, p, TODAY, s))
    .sort(compareProjects)
    .map((h) => h.project.title);
};

describe('pinning and ordering projects', () => {
  it('pins a project to the top and lets it back down again', async () => {
    const { m, index, vault } = await setup();
    const before = listed(index);
    expect(before[0]).not.toBe('Kitchen Remodel');

    await m.setProjectPinned('prj-kitchen', true);
    expect(index.project('prj-kitchen')!.pinned).toBe(true);
    expect(await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')).toMatch(/^pinned: true$/m);
    expect(listed(index)[0]).toBe('Kitchen Remodel'); // ahead of every other project, whatever its status

    await m.setProjectPinned('prj-kitchen', false);
    expect(index.project('prj-kitchen')!.pinned).toBeUndefined();
    expect(listed(index)).toEqual(before);
  });

  it('keeps the order you put projects in, and moves one up or down', async () => {
    const { m, index, vault } = await setup();
    // Ordering applies within a status group, which is how the list is built; these two are both active.
    const active = ['prj-book', 'prj-oracle'];
    const names = (): string[] => listed(index).filter((t) => t === 'Oracle Book Writing' || t === 'Oracle');
    expect(names()).toEqual(['Oracle Book Writing', 'Oracle']);

    await m.setProjectOrder(['prj-oracle', 'prj-book']);
    expect(index.project('prj-oracle')!.order).toBe(1);
    expect(index.project('prj-book')!.order).toBe(2);
    expect(await vault.read('02 PROJECTS/⮕ Oracle/⮕ Oracle.md')).toMatch(/^order: 1$/m);
    expect(names()).toEqual(['Oracle', 'Oracle Book Writing']);

    await m.moveProjectBy('prj-book', -1, ['prj-oracle', 'prj-book']);
    expect(index.project('prj-book')!.order).toBe(1);
    expect(names()).toEqual(['Oracle Book Writing', 'Oracle']);

    // Moving past either end does nothing.
    await m.moveProjectBy('prj-book', -1, ['prj-book', 'prj-oracle']);
    expect(index.project('prj-book')!.order).toBe(1);
    void active;
  });

  it('projects you never ordered stay after the ones you did', async () => {
    const { m, index } = await setup();
    await m.setProjectOrder(['prj-oracle']);
    const all = listed(index);
    expect(all.indexOf('Oracle')).toBeLessThan(all.indexOf('Oracle Book Writing'));
    expect(index.project('prj-book')!.order).toBeUndefined();
  });
});
