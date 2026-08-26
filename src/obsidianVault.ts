/** VaultAdapter over Obsidian's vault API. The only place the data layer meets Obsidian. */
import { normalizePath, TFile, type App } from 'obsidian';
import type { VaultAdapter } from './data/vault';

export class ObsidianVault implements VaultAdapter {
  constructor(private app: App) {}

  async list(): Promise<string[]> {
    return this.app.vault.getMarkdownFiles().map((f) => f.path);
  }

  async read(path: string): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (f instanceof TFile) return this.app.vault.read(f);
    // Files outside the vault index (e.g. .obsidian/…) go through the adapter.
    return this.app.vault.adapter.read(normalizePath(path));
  }

  async write(path: string, content: string): Promise<void> {
    const p = normalizePath(path);
    const f = this.app.vault.getAbstractFileByPath(p);
    if (f instanceof TFile) { await this.app.vault.modify(f, content); return; }
    const folder = p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '';
    if (folder && !this.app.vault.getAbstractFileByPath(folder)) await this.mkdirp(folder);
    await this.app.vault.create(p, content);
  }

  private async mkdirp(folder: string): Promise<void> {
    const parts = folder.split('/');
    let cur = '';
    for (const part of parts) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getAbstractFileByPath(cur)) {
        try { await this.app.vault.createFolder(cur); } catch { /* raced with another create */ }
      }
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.app.vault.getAbstractFileByPath(normalizePath(path)) !== null || this.app.vault.adapter.exists(normalizePath(path));
  }

  mtime(path: string): number | undefined {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    return f instanceof TFile ? f.stat.mtime : undefined;
  }

  async trash(path: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!f) throw new Error(`Not in the vault: ${path}`);
    await this.app.vault.trash(f, false);
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(from));
    if (!f) throw new Error(`Not in the vault: ${from}`);
    await this.app.fileManager.renameFile(f, normalizePath(to));
  }
}
