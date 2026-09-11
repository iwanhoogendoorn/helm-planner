/**
 * VaultAdapter over a plain folder on disk, for running Helm's data layer and API outside Obsidian
 * (the dev server, scripts, tests against a real vault copy). Mirrors what ObsidianVault does with
 * Obsidian's API: hidden folders are invisible, trash is `.trash/`, writes are remembered for the
 * API's `written` reply. Node only — never imported by the plugin bundle.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VaultAdapter } from './vault';

const SKIP_DIRS = new Set(['node_modules']);

export class FsVault implements VaultAdapter {
  readonly root: string;
  private writes: string[] = [];

  constructor(root: string) { this.root = path.resolve(root); }

  /** Paths written since the last call — the API reports them so a caller can see what it changed. */
  takeWrites(): string[] { const w = [...new Set(this.writes)]; this.writes = []; return w; }
  private noteWrite(p: string): void { this.writes.push(p); if (this.writes.length > 200) this.writes = this.writes.slice(-200); }

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
    await fs.promises.writeFile(full, content, 'utf8');
  }

  async writeBinary(p: string, data: ArrayBuffer): Promise<void> {
    const full = this.abs(p);
    this.noteWrite(p);
    await fs.promises.mkdir(path.dirname(full), { recursive: true });
    await fs.promises.writeFile(full, Buffer.from(data));
  }

  async readBinary(p: string): Promise<ArrayBuffer> {
    const buf = await fs.promises.readFile(this.abs(p));
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
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

  /** Simple frontmatter (`key: value` lines), like MemoryVault — enough for the type/id keys Helm looks at before parsing a file properly. */
  frontmatter(p: string): Record<string, unknown> | undefined {
    let c: string;
    try { c = fs.readFileSync(this.abs(p), 'utf8'); } catch { return undefined; }
    if (!c.startsWith('---')) return undefined;
    const end = c.indexOf('\n---', 3);
    const out: Record<string, unknown> = {};
    for (const line of c.slice(4, end === -1 ? undefined : end).split('\n')) { const m = /^([\w-]+):\s*(.*)$/.exec(line); if (m) out[m[1]!] = m[2]!; }
    return out;
  }
}
