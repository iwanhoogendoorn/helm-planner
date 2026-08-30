import { describe, expect, it } from 'vitest';
import { setup } from './fixture';

const BOOK = '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md';

describe('deleting a phase', () => {
  it('takes the heading away and keeps what it held, in the project’s own list', async () => {
    const { m, vault, index } = await setup();
    const before = index.project('prj-book')!;
    const phase = before.phases[0]!;
    const held = phase.taskKeys.map((k) => index.task(k)!.text);
    expect(held.length).toBeGreaterThan(0);

    const carried = await m.deletePhase('prj-book', phase.id);
    expect(carried).toBe(held.length);

    const after = index.project('prj-book')!;
    expect(after.phases.map((p) => p.title)).not.toContain(phase.title);
    expect(after.phases).toHaveLength(before.phases.length - 1);
    const note = await vault.read(BOOK);
    expect(note).not.toMatch(new RegExp(`^#+ (Phase|Stage)[:\\-] ${phase.title}`, 'm'));
    for (const text of held) {
      expect(note).toContain(text);                                   // the work is still written down
      expect(after.looseTaskKeys.map((k) => index.task(k)!.text)).toContain(text); // and belongs to the project
    }
  });

  it('an empty phase just goes', async () => {
    const { m, index } = await setup();
    await m.addPhase('prj-book', 'Nothing here');
    const added = index.project('prj-book')!.phases.find((p) => p.title === 'Nothing here')!;
    expect(await m.deletePhase('prj-book', added.id)).toBe(0);
    expect(index.project('prj-book')!.phases.map((p) => p.title)).not.toContain('Nothing here');
  });

  it('makes a Tasks heading when the project has none', async () => {
    const { m, vault, index } = await setup({
      '02 PROJECTS/Solo/Solo.md': '---\ntype: project\nid: prj-solo\ntitle: Solo\nstatus: active\n---\n\n## Phase: Only phase\n\n- [ ] Do the thing\n',
    });
    const phase = index.project('prj-solo')!.phases[0]!;
    expect(await m.deletePhase('prj-solo', phase.id)).toBe(1);
    const note = await vault.read('02 PROJECTS/Solo/Solo.md');
    expect(note).toMatch(/## Tasks\n\n- \[ \] Do the thing/);
    expect(index.project('prj-solo')!.looseTaskKeys.map((k) => index.task(k)!.text)).toEqual(['Do the thing']);
  });

  it('refuses a phase that is not there', async () => {
    const { m } = await setup();
    await expect(m.deletePhase('prj-book', 'prj-book#nope')).rejects.toThrow(/not found/i);
  });
});
