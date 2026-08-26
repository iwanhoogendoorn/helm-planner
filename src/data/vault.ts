/** The only thing the data layer needs from a vault. Obsidian implements it in ui/obsidianVault.ts. */
export interface VaultAdapter {
  /** Every markdown path in the vault, vault-relative, forward slashes. */
  list(): Promise<string[]>;
  read(path: string): Promise<string>;
  /** Overwrite. Creates parent folders as needed. */
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mtime(path: string): number | undefined;
  /** Move a file or folder (and everything under it). */
  rename?(from: string, to: string): Promise<void>;
  delete?(path: string): Promise<void>;
  /** Move a file or folder to the trash (recoverable). */
  trash?(path: string): Promise<void>;
  /** Write a binary file (icons). */
  writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
}

export class MemoryVault implements VaultAdapter {
  files = new Map<string, string>();
  mtimes = new Map<string, number>();
  writes: string[] = [];
  private clock = 1;

  constructor(seed: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(seed)) this.files.set(p, c), this.mtimes.set(p, this.clock++);
  }
  async list(): Promise<string[]> { return [...this.files.keys()].filter((p) => p.endsWith('.md')); }
  async read(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`ENOENT ${path}`);
    return c;
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.mtimes.set(path, this.clock++);
    this.writes.push(path);
  }
  async exists(path: string): Promise<boolean> { return this.files.has(path); }
  mtime(path: string): number | undefined { return this.mtimes.get(path); }
  async rename(from: string, to: string): Promise<void> {
    for (const p of [...this.files.keys()]) {
      if (p === from || p.startsWith(from + '/')) { const c = this.files.get(p)!; this.files.delete(p); this.files.set(to + p.slice(from.length), c); }
    }
  }
  async delete(path: string): Promise<void> { this.files.delete(path); }
  binaries = new Map<string, ArrayBuffer>();
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> { this.binaries.set(path, data); }
  trashed: string[] = [];
  async trash(path: string): Promise<void> {
    for (const p of [...this.files.keys()]) if (p === path || p.startsWith(path + '/')) { this.files.delete(p); this.trashed.push(p); }
  }
}

export function folderOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
}

export function isUnder(path: string, folder: string): boolean {
  if (folder === '' || folder === '/') return true;
  const f = folder.replace(/\/+$/, '');
  return path === f || path.startsWith(f + '/');
}
