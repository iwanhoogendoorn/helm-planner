import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FsVault } from '../../src/data/fsVault';

let root: string;
let vault: FsVault;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'helm-fsvault-'));
  const put = (p: string, c: string): void => { mkdirSync(join(root, p, '..'), { recursive: true }); writeFileSync(join(root, p), c); };
  put('01 INBOX/Inbox.md', '# Inbox\n\n- [ ] Call the plumber\n');
  put('02 PROJECTS/Kitchen/Kitchen.md', '---\ntitle: Kitchen\ntype: project\nid: prj-k\n---\n# Kitchen\n');
  put('02 PROJECTS/Kitchen/plan.excalidraw', '{}');
  put('02 PROJECTS/Kitchen/board.canvas', '{}');
  put('.obsidian/app.json', '{}');
  put('.trash/Old.md', '# gone\n');
  put('node_modules/pkg/index.md', '# not a note\n');
  put('.helm-dev-token', 'secret');
  vault = new FsVault(root);
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe('FsVault', () => {
  it('lists markdown files recursively and leaves hidden folders, the trash and node_modules out', async () => {
    expect(await vault.list()).toEqual(['01 INBOX/Inbox.md', '02 PROJECTS/Kitchen/Kitchen.md']);
    expect(await vault.listOther()).toEqual(['02 PROJECTS/Kitchen/board.canvas', '02 PROJECTS/Kitchen/plan.excalidraw']);
  });

  it('reads, writes (creating folders), reports mtimes and remembers what it wrote', async () => {
    expect(await vault.read('01 INBOX/Inbox.md')).toContain('Call the plumber');
    await vault.write('70 OBSIDIAN/Daily/2026/09/11.md', '# Today\n');
    expect(readFileSync(join(root, '70 OBSIDIAN/Daily/2026/09/11.md'), 'utf8')).toBe('# Today\n');
    expect(await vault.exists('70 OBSIDIAN/Daily/2026/09/11.md')).toBe(true);
    expect(await vault.exists('70 OBSIDIAN/Daily')).toBe(true);
    expect(await vault.exists('nope.md')).toBe(false);
    expect(vault.mtime('70 OBSIDIAN/Daily/2026/09/11.md')).toBeGreaterThan(0);
    expect(vault.mtime('nope.md')).toBeUndefined();
    await vault.write('01 INBOX/Inbox.md', '# Inbox\n');
    expect(vault.takeWrites()).toEqual(['70 OBSIDIAN/Daily/2026/09/11.md', '01 INBOX/Inbox.md']);
    expect(vault.takeWrites()).toEqual([]);
  });

  it('parses simple frontmatter without a metadata cache', () => {
    expect(vault.frontmatter('02 PROJECTS/Kitchen/Kitchen.md')).toEqual({ title: 'Kitchen', type: 'project', id: 'prj-k' });
    expect(vault.frontmatter('01 INBOX/Inbox.md')).toBeUndefined();
    expect(vault.frontmatter('missing.md')).toBeUndefined();
  });

  it('renames folders with everything under them, deletes, and trashes into .trash', async () => {
    await vault.rename('02 PROJECTS/Kitchen', '02 PROJECTS/Kitchen Remodel');
    expect(await vault.list()).toContain('02 PROJECTS/Kitchen Remodel/Kitchen.md');
    expect(existsSync(join(root, '02 PROJECTS/Kitchen'))).toBe(false);
    await expect(vault.rename('02 PROJECTS/Nope', '02 PROJECTS/Else')).rejects.toThrow(/Not in the vault/);

    await vault.trash('01 INBOX/Inbox.md');
    expect(await vault.list()).not.toContain('01 INBOX/Inbox.md');
    expect(existsSync(join(root, '.trash/Inbox.md'))).toBe(true);
    await vault.write('01 INBOX/Inbox.md', '# again\n');
    await vault.trash('01 INBOX/Inbox.md');
    expect(existsSync(join(root, '.trash/Inbox 1.md'))).toBe(true);

    await vault.delete('02 PROJECTS/Kitchen Remodel');
    expect(await vault.list()).toEqual([]);
    await vault.delete('never-there.md'); // force: no throw
  });

  it('writes binaries and creates folders', async () => {
    await vault.writeBinary('icons/x.png', new Uint8Array([1, 2, 3]).buffer);
    expect([...readFileSync(join(root, 'icons/x.png'))]).toEqual([1, 2, 3]);
    await vault.createFolder('a/b/c');
    expect(existsSync(join(root, 'a/b/c'))).toBe(true);
    expect(vault.takeWrites()).toEqual(['icons/x.png']);
  });

  it('refuses paths that escape the vault and maps absolute paths back to vault-relative ones', () => {
    expect(() => vault.abs('../outside.md')).toThrow(/Outside the vault/);
    expect(vault.rel(join(root, '01 INBOX', 'Inbox.md'))).toBe('01 INBOX/Inbox.md');
    expect(vault.rel(join(root, '..', 'x.md'))).toBeUndefined();
    expect(FsVault.visible('.obsidian/app.json')).toBe(false);
    expect(FsVault.visible('02 PROJECTS/Kitchen/Kitchen.md')).toBe(true);
  });
});
