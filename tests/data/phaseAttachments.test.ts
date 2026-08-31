import { describe, expect, it } from 'vitest';
import { setup } from './fixture';

const BOOK = '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md';

describe('a phase with its own notes, drawings and links', () => {
  const phaseOf = (index: { project: (id: string) => { phases: { id: string; title: string; projectId: string }[] } | undefined }) =>
    index.project('prj-book')!.phases[0]!;

  it('keeps a web address under the phase, not in the project’s list', async () => {
    const { m, index, vault } = await setup();
    const ph = phaseOf(index);
    expect(index.project('prj-book')!.links).toEqual([]);

    await m.addPhaseLink(ph.id, 'https://docs.example.com/blueprint', 'The blueprint');
    const after = index.project('prj-book')!;
    const fresh = after.phases.find((x) => x.id === ph.id)!;
    expect(fresh.links).toEqual([{ url: 'https://docs.example.com/blueprint', label: 'The blueprint' }]);
    expect(after.links).toEqual([]);                                  // the project itself gained nothing

    // It sits inside the phase's own block in the note.
    const lines = (await vault.read(BOOK)).split('\n');
    const at = lines.findIndex((l) => l.includes('docs.example.com/blueprint'));
    expect(at).toBeGreaterThan(fresh.headingLine ?? 0);
    expect(lines[at]).toBe('- [The blueprint](https://docs.example.com/blueprint)');

    await m.addPhaseLink(ph.id, 'https://docs.example.com/blueprint');   // twice changes nothing
    expect(index.project('prj-book')!.phases.find((x) => x.id === ph.id)!.links).toHaveLength(1);

    await m.removePhaseLink(ph.id, 'https://docs.example.com/blueprint');
    expect(index.project('prj-book')!.phases.find((x) => x.id === ph.id)!.links).toEqual([]);
    await expect(m.addPhaseLink(ph.id, 'just words')).rejects.toThrow(/not a web address/i);
    await expect(m.addPhaseLink('prj-book#nope', 'https://x.example.com')).rejects.toThrow(/not found/i);
  });

  it('attaches a note to the phase by frontmatter, and embeds it under the heading', async () => {
    const { m, index, vault } = await setup({
      '81 AI/Blueprint reading.md': '---\ntitle: Blueprint reading\n---\n# Blueprint reading\n',
    });
    const ph = phaseOf(index);
    const target = { kind: 'phase' as const, id: ph.id, projectId: ph.projectId, title: ph.title };
    expect(index.notesFor(target)).toEqual([]);

    await m.linkNote(target, '81 AI/Blueprint reading.md');
    expect(index.notesFor(target).map((n) => n.title)).toEqual(['Blueprint reading']);
    expect(await vault.read('81 AI/Blueprint reading.md')).toMatch(new RegExp(`helm-phase: ${ph.id.replace('#', '#')}`));

    // The project as a whole did not gain it — this belongs to the phase.
    expect(index.notesFor({ kind: 'project', id: 'prj-book', title: 'Oracle Book Writing' }).map((n) => n.title)).not.toContain('Blueprint reading');
    // And the link sits inside the phase's block.
    const lines = (await vault.read(BOOK)).split('\n');
    const at = lines.findIndex((l) => l.includes('[[Blueprint reading]]'));
    const fresh = index.project('prj-book')!.phases.find((x) => x.id === ph.id)!;
    expect(at).toBeGreaterThan(fresh.headingLine);
    expect(at).toBeLessThan(fresh.endLine + 2);
  });

  it('a drawing made for a phase carries the phase in its frontmatter', async () => {
    const { m, index, vault } = await setup();
    const ph = phaseOf(index);
    const target = { kind: 'phase' as const, id: ph.id, projectId: ph.projectId, title: ph.title };
    const path = await m.createDrawing(target, { name: 'Phase map' });
    expect(await vault.read(path)).toMatch(new RegExp(`helm-phase: ${ph.id}`));
    expect(index.drawingsFor(target).map((d) => d.title)).toEqual(['Phase map']);
    expect(path.startsWith('02 PROJECTS/Oracle Book Writing/')).toBe(true);   // the project's own folder
  });
});
