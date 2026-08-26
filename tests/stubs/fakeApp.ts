/** A fake Obsidian `App` over a MemoryVault — enough for HelmPlugin.onload and the vault-event pipeline. */
import { MemoryVault } from '../../src/data/vault';
import { TFile } from './obsidian';

export class FakeTFile extends TFile {
  constructor(public override path: string) { super(); this.stat = { mtime: 1 }; }
}

type Handler = (...a: unknown[]) => void;

class FakeVault {
  private handlers = new Map<string, Handler[]>();
  adapter: { read: (p: string) => Promise<string>; exists: (p: string) => Promise<boolean> };
  constructor(public files: MemoryVault, private config: Map<string, string>) {
    this.adapter = {
      read: async (p) => { const c = this.config.get(p) ?? this.files.files.get(p); if (c === undefined) throw new Error('ENOENT'); return c; },
      exists: async (p) => this.config.has(p) || this.files.files.has(p),
    };
  }
  getName(): string { return 'fake'; }
  getMarkdownFiles(): FakeTFile[] { return [...this.files.files.keys()].filter((p) => p.endsWith('.md')).map((p) => new FakeTFile(p)); }
  getAbstractFileByPath(p: string): FakeTFile | null { return this.files.files.has(p) ? new FakeTFile(p) : null; }
  async read(f: FakeTFile): Promise<string> { return this.files.read(f.path); }
  async modify(f: FakeTFile, c: string): Promise<void> { await this.files.write(f.path, c); }
  async create(p: string, c: string): Promise<FakeTFile> { await this.files.write(p, c); return new FakeTFile(p); }
  async createFolder(): Promise<void> {}
  on(name: string, fn: Handler): { name: string } { this.handlers.set(name, [...(this.handlers.get(name) ?? []), fn]); return { name }; }
  emit(name: string, ...args: unknown[]): void { for (const h of this.handlers.get(name) ?? []) h(...args); }
}

class FakeWorkspace {
  private ready: (() => void)[] = [];
  onLayoutReady(fn: () => void): void { this.ready.push(fn); }
  fireLayoutReady(): void { for (const f of this.ready) f(); }
  getLeavesOfType(): unknown[] { return []; }
  getLeaf(): { setViewState: () => Promise<void>; view: unknown; openFile: () => Promise<void> } { return { setViewState: async () => undefined, view: {}, openFile: async () => undefined }; }
  revealLeaf(): void {}
  requestSaveLayout(): void {}
  openLinkText(): void {}
}

export interface Cmd { id: string; name: string; callback?: () => void; checkCallback?: (c: boolean) => boolean | void; editorCheckCallback?: (c: boolean, e: unknown, v: unknown) => boolean | void }

export class FakeApp {
  configFiles = new Map<string, string>();
  vault: FakeVault;
  workspace = new FakeWorkspace();
  metadataCache = { resolvedLinks: {} };
  fileManager = { renameFile: async () => undefined };
  commands: Cmd[] = [];
  views = new Map<string, unknown>();
  ribbons: { icon: string; title: string }[] = [];
  protocolHandlers = new Map<string, unknown>();
  constructor(mem: MemoryVault) { this.vault = new FakeVault(mem, this.configFiles); }
}

/* Plugin base used by main.ts: patch the stub's Plugin with the methods HelmPlugin calls. */
import { Plugin as StubPlugin } from './obsidian';
const P = StubPlugin.prototype as unknown as Record<string, unknown>;
P['addCommand'] = function (this: { app: FakeApp }, c: Cmd) { this.app.commands.push(c); };
P['registerView'] = function (this: { app: FakeApp }, t: string, f: unknown) { this.app.views.set(t, f); };
P['addStatusBarItem'] = function () { return document.createElement('div'); };
P['addRibbonIcon'] = function (this: { app: FakeApp }, icon: string, title: string) { this.app.ribbons.push({ icon, title }); return document.createElement('div'); };
P['addSettingTab'] = function () {};
P['registerEvent'] = function () {};
P['registerObsidianProtocolHandler'] = function (this: { app: FakeApp }, n: string, f: unknown) { this.app.protocolHandlers.set(n, f); };
P['loadData'] = async function () { return null; };
P['saveData'] = async function () {};
