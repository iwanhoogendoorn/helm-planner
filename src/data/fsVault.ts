/**
 * VaultAdapter over a plain folder on disk, for running Helm's data layer and API outside Obsidian
 * (the dev server, scripts, tests against a real vault copy). Mirrors what ObsidianVault does with
 * Obsidian's API: hidden folders are invisible, trash is `.trash/`, writes are remembered for the
 * API's `written` reply. Node only — never imported by the plugin bundle.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { simpleFrontmatter, type VaultAdapter } from './vault';

const SKIP_DIRS = new Set(['node_modules']);

export class FsVault implements VaultAdapter {
  readonly root: string;
  private writes: string[] = [];

  constructor(root: string) { this.root = path.resolve(root); }

  /** Paths written since the last call — the API reports them so a caller can see what it changed. */
  takeWrites(): string[] { const w = [...new Set(this.writes)]; this.writes = []; return w; }
  private noteWrite(p: string): void { this.walked = undefined; this.writes.push(p); if (this.writes.length > 200) this.writes = this.writes.slice(-200); }

  /** Absolute path for a vault-relative one; refuses anything that would leave the vault. */
  abs(rel: string): string {
    const full = path.resolve(this.root, rel.replace(/^\/+/, ''));
    if (full !== this.root && !full.startsWith(this.root + path.sep)) throw new Error(`Outside the vault: ${rel}`);
    return full;
  }

  /** Vault-relative path (forward slashes) for an absolute one under the root, or undefined. */
  rel(abs: string): string | undefined {
    const full = path.resolve(abs);
    if (full === this.root) return '';
    if (!full.startsWith(this.root + path.sep)) return undefined;
    return full.slice(this.root.length + 1).split(path.sep).join('/');
  }

  /** Hidden files and folders (`.obsidian`, `.trash`, `.git`, `.helm-dev-token`) are not part of the vault, as in Obsidian. */
  static visible(rel: string): boolean {
    return rel.split('/').every((seg) => seg !== '' && !seg.startsWith('.') && !SKIP_DIRS.has(seg));
  }

  /** The last walk, for the many links of one request: resolving each must not read the whole vault again. */
  private walked: { at: number; files: string[] } | undefined;
  private walkRecent(): string[] {
    if (!this.walked || Date.now() - this.walked.at > 1000) this.walked = { at: Date.now(), files: this.walk() };
    return this.walked.files;
  }

  private walk(): string[] {
    const out: string[] = [];
    const visit = (dir: string, prefix: string): void => {
      let entries: fs.Dirent[];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
        const rel = prefix ? `${prefix}/${e.name}` : e.name;
        if (e.isDirectory()) visit(path.join(dir, e.name), rel);
        else if (e.isFile()) out.push(rel);
      }
    };
    visit(this.root, '');
    return out.sort();
  }

  async list(): Promise<string[]> { return this.walk().filter((p) => p.endsWith('.md')); }
  async listOther(): Promise<string[]> { return this.walk().filter((p) => /\.(canvas|excalidraw)$/.test(p)); }

  async read(p: string): Promise<string> { return fs.promises.readFile(this.abs(p), 'utf8'); }

  async write(p: string, content: string): Promise<void> {
    const full = this.abs(p);
    this.noteWrite(p);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await writeAtomic(full, content);
  }

  async process(p: string, fn: (content: string) => string): Promise<string> {
    const c = await this.read(p);
    const next = fn(c);
    if (next !== c) await this.write(p, next);
    return next;
  }

  async writeBinary(p: string, data: ArrayBuffer): Promise<void> {
    const full = this.abs(p);
    this.noteWrite(p);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await writeAtomic(full, Buffer.from(data));
  }

  async readBinary(p: string): Promise<ArrayBuffer> {
    const buf = await fs.promises.readFile(this.abs(p));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  }

  /**
   * The file a wikilink names, as Obsidian finds it: that path itself, else the file of that name
   * wherever it is in the vault: beside the note that links to it first, else the shortest path when
   * several share the name. Hidden folders, anything outside the vault and a symbolic link (which
   * could point outside it) are never an answer.
   */
  resolveLink(link: string, from?: string): string | undefined {
    const want = link.replace(/^\/+/, '');
    if (!want || !FsVault.visible(want) || want.split('/').includes('..')) return undefined;
    if (this.isPlainFile(want)) return want;
    const beside = from?.includes('/') ? `${from.slice(0, from.lastIndexOf('/'))}/${want}` : undefined;
    if (beside && FsVault.visible(beside) && this.isPlainFile(beside)) return beside;
    return this.walkRecent().filter((p) => p.endsWith(`/${want}`) && this.isPlainFile(p)).sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
  }

  /** A real file at this path, reached through real folders: no link anywhere on the way. */
  private isPlainFile(rel: string): boolean {
    try {
      const full = this.abs(rel);
      return fs.lstatSync(full).isFile() && fs.realpathSync(full) === path.join(fs.realpathSync(this.root), ...rel.split('/'));
    } catch { return false; }
  }

  async createFolder(p: string): Promise<void> { await fs.promises.mkdir(this.abs(p), { recursive: true }); }

  async exists(p: string): Promise<boolean> { return fs.existsSync(this.abs(p)); }

  mtime(p: string): number | undefined {
    try { return fs.statSync(this.abs(p)).mtimeMs; } catch { return undefined; }
  }

  async rename(from: string, to: string): Promise<void> {
    const src = this.abs(from);
    const dst = this.abs(to);
    if (!fs.existsSync(src)) throw new Error(`Not in the vault: ${from}`);
    await fs.promises.mkdir(path.dirname(dst), { recursive: true });
    await fs.promises.rename(src, dst);
  }

  async delete(p: string): Promise<void> { await fs.promises.rm(this.abs(p), { recursive: true, force: true }); }

  /** Move into `.trash/` at the vault root, the way Obsidian's "move to vault trash" does; a name clash gets a numeric suffix. */
  async trash(p: string): Promise<void> {
    const src = this.abs(p);
    if (!fs.existsSync(src)) throw new Error(`Not in the vault: ${p}`);
    const trashDir = path.join(this.root, '.trash');
    await fs.promises.mkdir(trashDir, { recursive: true });
    const base = path.basename(src);
    let dst = path.join(trashDir, base);
    for (let n = 1; fs.existsSync(dst); n++) {
      const ext = path.extname(base);
      dst = path.join(trashDir, `${base.slice(0, base.length - ext.length)} ${n}${ext}`);
    }
    await fs.promises.rename(src, dst);
  }

  /** Frontmatter as a metadata cache would give it, like MemoryVault — what Helm looks at before parsing a file properly. */
  frontmatter(p: string): Record<string, unknown> | undefined {
    let c: string;
    try { c = fs.readFileSync(this.abs(p), 'utf8'); } catch { return undefined; }
    return simpleFrontmatter(c);
  }
}

/**
 * Write beside the target and rename over it: a crash or kill half-way leaves the old note, never half
 * of the new one. The temporary name is hidden, so a listing in between never shows it.
 */
async function writeAtomic(full: string, data: string | Buffer): Promise<void> {
  const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${process.pid}.${Date.now()}.helm-tmp`);
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, full);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
}
