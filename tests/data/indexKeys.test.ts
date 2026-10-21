import { describe, expect, it } from 'vitest';
import { setup } from './fixture';

describe('index keys and kinds', () => {
  it('gives every duplicate of an id its own key, across three files (CD-09)', async () => {
    const { index } = await setup({
      '02 PROJECTS/A.md': '# A\n\n- [ ] From A 🆔 tsk-x\n',
      '02 PROJECTS/B.md': '# B\n\n- [ ] From B 🆔 tsk-x\n',
      '02 PROJECTS/C.md': '# C\n\n- [ ] From C 🆔 tsk-x\n',
    });
    const texts = [...index.snapshot.tasks.values()].filter((t) => t.id === 'tsk-x').map((t) => t.text).sort();
    expect(texts).toEqual(['From A', 'From B', 'From C']);
    const keys = [...index.snapshot.tasks.values()].filter((t) => t.id === 'tsk-x').map((t) => t.key);
    expect(new Set(keys).size).toBe(3);
  });

  it('reads a song from the frontmatter only, never from a body line (CD-15)', async () => {
    const { index } = await setup({
      '02 PROJECTS/Lyrics.md': '# Lyrics\n\nThe chorus goes\ntype: song\nand then the bridge.\n',
      '02 PROJECTS/Hallelujah.md': '---\ntype: song\nartist: Cohen\n---\n# Hallelujah\n',
    });
    expect(index.isSongNote('02 PROJECTS/Lyrics.md')).toBe(false);
    expect(index.isSongNote('02 PROJECTS/Hallelujah.md')).toBe(true);
    expect(index.songs().map((s) => s.artist)).toEqual(['Cohen']);
  });
});
