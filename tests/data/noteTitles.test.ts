import { describe, expect, it } from 'vitest';
import { setup } from './fixture';

describe('resolving a note by title', () => {
  it('never lets an archived or trashed note win a title from a live one', async () => {
    const { index, vault, settings } = await setup();
    const live = `${settings.notesFolder}/Twinkle Twinkle.md`;
    const archived = `${settings.archiveFolder}/Twinkle Twinkle/Twinkle Twinkle.md`;
    const trashed = '.trash/Twinkle Twinkle.md';
    await vault.write(live, '---\ntype: song\ntitle: Twinkle Twinkle\n---\n# Twinkle Twinkle\n');
    index.update(live, await vault.read(live));
    // The look-alikes arrive later, which is when "last one wins" would go wrong.
    await vault.write(archived, '---\ntype: project\nid: prj-old\ntitle: Twinkle Twinkle\n---\n');
    index.update(archived, await vault.read(archived));
    await vault.write(trashed, '# old copy\n');
    index.update(trashed, await vault.read(trashed));
    await index.rebuild();
    const book = '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md';
    const before = await vault.read(book);
    await vault.write(book, before + '\n## Notes\n\n- [[Twinkle Twinkle]]\n');
    index.update(book, await vault.read(book));
    const attached = index.notesFor({ kind: 'project', id: 'prj-book', title: 'Oracle Book Writing' }).map((n) => n.path);
    expect(attached).toContain(live);
    expect(attached).not.toContain(archived);
  });
});
