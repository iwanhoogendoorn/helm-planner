import { describe, expect, it } from 'vitest';
import { MemoryVault } from '../../src/data/vault';
import { ObsidianVault } from '../../src/obsidianVault';
import { FakeApp } from '../stubs/fakeApp';
import { hasHelmKeys } from '../../src/core/noteRef';

describe('MemoryVault fidelity (CD-21)', () => {
  it('moves mtimes with a rename and forgets them on delete and trash', async () => {
    const v = new MemoryVault({ 'a/x.md': 'x', 'b.md': 'b', 'c.md': 'c' });
    const t = v.mtime('a/x.md');
    await v.rename('a', 'z');
    expect(v.mtime('z/x.md')).toBe(t);
    expect(v.mtime('a/x.md')).toBeUndefined();
    await v.delete('b.md');
    expect(v.mtime('b.md')).toBeUndefined();
    await v.trash('c.md');
    expect(v.mtime('c.md')).toBeUndefined();
  });

  it('hands frontmatter over the way a metadata cache does: lists as lists', () => {
    const v = new MemoryVault({ 'n.md': '---\nhelm-task:\n  - tsk-1\ntags: [a, b]\nempty:\n---\n# n\n' });
    expect(v.frontmatter('n.md')).toEqual({ 'helm-task': ['tsk-1'], tags: ['a', 'b'], empty: null });
    expect(hasHelmKeys(v.frontmatter('n.md'))).toBe(true);
  });
});

describe('ObsidianVault', () => {
  it('never probes a path outside the vault, even for lookups (CD-19)', async () => {
    const probed: string[] = [];
    const app = { vault: { getAbstractFileByPath: (p: string) => { probed.push(p); return null; }, adapter: { exists: async (p: string) => { probed.push(p); return true; } }, getResourcePath: () => 'x' }, metadataCache: {} };
    const v = new ObsidianVault(app as never);
    expect(await v.exists('../outside.md')).toBe(false);
    expect(v.mtime('../outside.md')).toBeUndefined();
    expect(v.frontmatter('../../etc/passwd')).toBeUndefined();
    expect(v.resourceUrl('../x.png')).toBeUndefined();
    expect(probed).toEqual([]);
    expect(await v.exists('Notes/x.md')).toBe(true); // inside: asked as before
  });

  it('process goes through Obsidian\'s atomic vault.process and reports the write', async () => {
    const mem = new MemoryVault({ 'n.md': 'one' });
    const v = new ObsidianVault(new FakeApp(mem) as never);
    expect(await v.process('n.md', (c) => `${c} two`)).toBe('one two');
    expect(mem.files.get('n.md')).toBe('one two');
    expect(v.takeWrites()).toEqual(['n.md']);
    await v.process('n.md', (c) => c);
    expect(v.takeWrites()).toEqual([]);
    await expect(v.process('../n.md', (c) => c)).rejects.toThrow(/inside the vault/);
  });
});
