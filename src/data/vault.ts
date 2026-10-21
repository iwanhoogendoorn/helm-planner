import { parseFrontmatter, splitLines } from '../core/frontmatter';

/** The only thing the data layer needs from a vault. Obsidian implements it in ui/obsidianVault.ts. */
export interface VaultAdapter {
  /** Every markdown path in the vault, vault-relative, forward slashes. */
  list(): Promise<string[]>;
  /** Non-markdown files worth knowing about (.canvas, .excalidraw). */
  listOther?(): Promise<string[]>;
  read(path: string): Promise<string>;
  /** Overwrite. Creates parent folders as needed. */
  write(path: string, content: string): Promise<void>;
  /**
   * Read, transform and save an existing file in one step, so nothing written in between (an editor
   * saving, another plugin) is lost. Returns the content after. Obsidian's `vault.process` where there is one.
   */
  process?(path: string, fn: (content: string) => string): Promise<string>;
  exists(path: string): Promise<boolean>;
  mtime(path: string): number | undefined;
  /** Move a file or folder (and everything under it). */
  rename?(from: string, to: string): Promise<void>;
  delete?(path: string): Promise<void>;
  /** Move a file or folder to the trash (recoverable). */
  trash?(path: string): Promise<void>;
  /** Write a binary file (icons). */
  writeBinary?(path: string, data: ArrayBuffer): Promise<void>;
  /** Read a binary file (icons, drawings). */
  readBinary?(path: string): Promise<ArrayBuffer>;
  /** Create a folder (and parents). */
  createFolder?(path: string): Promise<void>;
  /** Frontmatter of a markdown file without reading it in full (a metadata cache where there is one). */
  frontmatter?(path: string): Record<string, unknown> | undefined;
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
  async listOther(): Promise<string[]> { return [...this.files.keys()].filter((p) => /\.(canvas|excalidraw)$/.test(p)); }
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
  async process(path: string, fn: (content: string) => string): Promise<string> {
    const c = await this.read(path);
    const next = fn(c);
    if (next !== c) await this.write(path, next);
    return next;
  }
  folders = new Set<string>();
  async createFolder(path: string): Promise<void> { this.folders.add(path.replace(/\/+$/, '')); }
  async exists(path: string): Promise<boolean> { return this.files.has(path) || this.folders.has(path.replace(/\/+$/, '')) || [...this.files.keys()].some((p) => p.startsWith(path.replace(/\/+$/, '') + '/')); }
  mtime(path: string): number | undefined { return this.mtimes.get(path); }
  async rename(from: string, to: string): Promise<void> {
    for (const p of [...this.files.keys()]) {
      if (p === from || p.startsWith(from + '/')) {
        const c = this.files.get(p)!;
        const dest = to + p.slice(from.length);
        this.files.delete(p);
        this.files.set(dest, c);
        this.mtimes.set(dest, this.mtimes.get(p) ?? this.clock++);
        this.mtimes.delete(p);
      }
    }
  }
  async delete(path: string): Promise<void> { this.files.delete(path); this.mtimes.delete(path); }
  frontmatter(path: string): Record<string, unknown> | undefined {
    const c = this.files.get(path);
    return c === undefined ? undefined : simpleFrontmatter(c);
  }
  binaries = new Map<string, ArrayBuffer>();
  async writeBinary(path: string, data: ArrayBuffer): Promise<void> { this.binaries.set(path, data); }
  async readBinary(path: string): Promise<ArrayBuffer> {
    const b = this.binaries.get(path);
    if (b === undefined) throw new Error(`ENOENT ${path}`);
    return b;
  }
  trashed: string[] = [];
  async trash(path: string): Promise<void> {
    for (const p of [...this.files.keys()]) if (p === path || p.startsWith(path + '/')) { this.files.delete(p); this.mtimes.delete(p); this.trashed.push(p); }
  }
}

/**
 * A note's frontmatter the way a metadata cache hands it over — lists as lists, `key:` as null — for the
 * vaults that have no cache of their own (memory, plain folder). Undefined when there is none.
 */
export function simpleFrontmatter(content: string): Record<string, unknown> | undefined {
  const fm = parseFrontmatter(splitLines(content).lines);
  return fm.present ? { ...fm.values } : undefined;
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
