/** Helm — plugin entry point. Wires the index, mutations and views to Obsidian. */
import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from 'obsidian';
import { DEFAULT_SETTINGS, type HelmSettings, type IsoDate } from './core/types';
import { todayLocal } from './core/dates';
import { HelmIndex, DAILY_FALLBACK } from './data/index';
import { Mutations } from './data/mutations';
import { ObsidianVault } from './obsidianVault';
import { HelmView, VIEW_TYPE } from './ui/view';
import type { TabId, UiContext } from './ui/context';
import { HelmSettingTab } from './ui/settingsTab';
import { openCapture } from './ui/modals/capture';
import { openPlanDay } from './ui/modals/planDay';
import { openWrapUp } from './ui/modals/wrapUp';
import { openProjectForm } from './ui/modals/projectForm';
import { openHabitForm } from './ui/modals/habitForm';
import { pickProject } from './ui/menus';
import { runSelfTest } from './selftest';

export default class HelmPlugin extends Plugin {
  override settings: HelmSettings = { ...DEFAULT_SETTINGS };
  vault!: ObsidianVault;
  index!: HelmIndex;
  mutations!: Mutations;
  private daily = { folder: '', format: '', template: '' };
  private periodic: Record<'year' | 'quarter' | 'month' | 'week', { folder: string; format: string; template: string }> = { year: { folder: '', format: '', template: '' }, quarter: { folder: '', format: '', template: '' }, month: { folder: '', format: '', template: '' }, week: { folder: '', format: '', template: '' } };
  private reconcileTimer: number | undefined;
  private pendingPaths = new Set<string>();
  private updateTimer: number | undefined;
  private busy = 0;

  override async onload(): Promise<void> {
    await this.loadSettings();
    await this.readDailyConfig();

    this.vault = new ObsidianVault(this.app);
    this.index = new HelmIndex(this.vault, {
      settings: () => this.settings,
      today: () => this.today(),
      dailyConfig: () => ({ folder: this.daily.folder || DAILY_FALLBACK.folder, format: this.daily.format || DAILY_FALLBACK.format }),
      periodicConfig: () => ({ year: this.periodic.year, quarter: this.periodic.quarter, month: this.periodic.month, week: this.periodic.week }),
    });
    this.mutations = new Mutations({
      vault: this.vault,
      index: this.index,
      settings: () => this.settings,
      today: () => this.today(),
      notify: (m) => { new Notice(m); },
      dailyTemplate: () => this.readDailyTemplate(),
      periodicTemplate: (kind) => this.readTemplate(this.periodic[kind].template),
    });
    this.index.onChange(() => this.refreshViews());

    this.registerView(VIEW_TYPE, (leaf) => new HelmView(leaf, (view) => this.uiContext(view)));
    this.addRibbonIcon('compass', 'Open Helm', () => void this.openView());
    this.addSettingTab(new HelmSettingTab(this.app, this));
    this.registerCommands();
    this.registerVaultEvents();
    this.registerObsidianProtocolHandler('helm', (params) => {
      const tab = (params['tab'] as TabId | undefined) ?? 'today';
      const date = params['date'];
      void this.openView().then(() => this.activeView()?.navigate(tab, { ...(date ? { date } : {}) }));
      if (params['action'] === 'selftest') void this.selfTest();
      if (params['action'] === 'capture') openCapture(this.uiContext(), { ...(params['text'] ? { text: params['text'] } : {}) });
    });

    this.app.workspace.onLayoutReady(() => {
      void this.index.rebuild().then(() => void this.reconcileSoon());
      if (this.settings.openOnStartup) void this.openView();
    });
  }

  override onunload(): void {
    if (this.reconcileTimer) window.clearTimeout(this.reconcileTimer);
    if (this.updateTimer) window.clearTimeout(this.updateTimer);
  }

  today(): IsoDate { return todayLocal(); }
  dailyConfig(): { folder: string; format: string; template: string } { return this.daily; }
  onSettingsChanged(): void { void this.index.rebuild(); }

  /* ── Settings ───────────────────────────────────────────────────────── */

  async loadSettings(): Promise<void> {
    const loaded = (await this.loadData()) as Partial<HelmSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...(loaded ?? {}) };
    if (!Array.isArray(this.settings.extraFolders)) this.settings.extraFolders = [];
  }

  async saveSettings(): Promise<void> { await this.saveData(this.settings); }

  private async readDailyConfig(): Promise<void> {
    const readJson = async (p: string): Promise<Record<string, unknown> | undefined> => {
      try { return JSON.parse(await this.app.vault.adapter.read(p)) as Record<string, unknown>; } catch { return undefined; }
    };
    const core = await readJson('.obsidian/daily-notes.json');
    const periodic = (await readJson('.obsidian/plugins/periodic-notes/data.json'))?.['daily'] as Record<string, unknown> | undefined;
    const pick = (k: string): string => {
      const c = core?.[k];
      const p = periodic?.[k];
      return typeof c === 'string' && c.trim() !== '' ? c : typeof p === 'string' ? p : '';
    };
    this.daily = { folder: pick('folder').replace(/\/+$/, ''), format: pick('format'), template: pick('template') };
    if (this.daily.template && !this.daily.template.endsWith('.md')) this.daily.template += '.md';
    const pn = await readJson('.obsidian/plugins/periodic-notes/data.json');
    const per = (k: 'yearly' | 'quarterly' | 'monthly' | 'weekly'): { folder: string; format: string; template: string } => {
      const c = pn?.[k] as Record<string, unknown> | undefined;
      const g = (key: string): string => (typeof c?.[key] === 'string' ? (c[key] as string) : '');
      return { folder: g('folder').replace(/\/+$/, ''), format: g('format'), template: g('template') };
    };
    this.periodic = { year: per('yearly'), quarter: per('quarterly'), month: per('monthly'), week: per('weekly') };
  }

  periodicConfigFor(kind: 'year' | 'quarter' | 'month' | 'week'): { folder: string; format: string; template: string } { return this.periodic[kind]; }

  private async readTemplate(p: string): Promise<string | undefined> {
    if (!p) return undefined;
    const path = p.endsWith('.md') ? p : `${p}.md`;
    try { return await this.vault.read(path); } catch { return undefined; }
  }

  private async readDailyTemplate(): Promise<string | undefined> {
    const p = this.settings.dailyNoteTemplate.trim() || this.daily.template;
    if (!p) return undefined;
    const path = p.endsWith('.md') ? p : `${p}.md`;
    try { return await this.vault.read(path); } catch { return undefined; }
  }

  /* ── UI wiring ──────────────────────────────────────────────────────── */

  uiContext(view?: HelmView): UiContext {
    return {
      app: this.app,
      index: this.index,
      mutations: this.mutations,
      settings: () => this.settings,
      saveSettings: async (patch) => { Object.assign(this.settings, patch); await this.saveSettings(); },
      today: () => this.today(),
      notify: (m) => { new Notice(m); },
      openFile: (path, line) => this.openFile(path, line),
      openLink: (target, from) => { this.app.workspace.openLinkText(target, from ?? '', false); },
      refresh: () => (view ? view.requestRender() : this.refreshViews()),
      navigate: (tab, opts) => { void this.openView().then(() => (view ?? this.activeView())?.navigate(tab, opts)); },
      run: (label, fn) => this.run(label, fn),
    };
  }

  private async run(label: string, fn: () => Promise<unknown>): Promise<void> {
    this.busy++;
    try {
      await fn();
    } catch (e) {
      console.error(`[helm] ${label} failed`, e);
      new Notice(`Helm: ${label} failed — ${(e as Error).message}`);
    } finally {
      this.busy--;
      this.refreshViews();
      this.reconcileSoon();
    }
  }

  /** Obsidian may hand back a deferred placeholder for a background tab; only real views can render. */
  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof HelmView) leaf.view.requestRender();
  }

  activeView(): HelmView | undefined {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) if (leaf.view instanceof HelmView) return leaf.view;
    return undefined;
  }

  async openView(): Promise<HelmView> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    let leaf: WorkspaceLeaf | null = existing ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getLeaf('tab');
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    const deferred = leaf as WorkspaceLeaf & { loadIfDeferred?: () => Promise<void> };
    if (typeof deferred.loadIfDeferred === 'function') await deferred.loadIfDeferred();
    await this.app.workspace.revealLeaf(leaf);
    if (!(leaf.view instanceof HelmView)) throw new Error('Helm view did not load');
    return leaf.view;
  }

  private async openFile(path: string, line?: number): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) { new Notice(`Not found: ${path}`); return; }
    const leaf = this.app.workspace.getLeaf(false);
    await leaf.openFile(f, line !== undefined ? { eState: { line } } : undefined);
    if (line !== undefined) {
      const view = leaf.view;
      if (view instanceof MarkdownView) { view.editor.setCursor({ line, ch: 0 }); view.editor.scrollIntoView({ from: { line, ch: 0 }, to: { line, ch: 0 } }, true); }
    }
  }

  /* ── Vault events → index → reconcile ───────────────────────────────── */

  private registerVaultEvents(): void {
    const touch = (path: string): void => {
      if (!this.index.inScope(path) && !this.index.hasFile(path)) return;
      this.pendingPaths.add(path);
      if (this.updateTimer) window.clearTimeout(this.updateTimer);
      this.updateTimer = window.setTimeout(() => void this.flushUpdates(), 250);
    };
    this.registerEvent(this.app.vault.on('modify', (f) => { if (f instanceof TFile) touch(f.path); }));
    this.registerEvent(this.app.vault.on('create', (f) => { if (f instanceof TFile) touch(f.path); }));
    this.registerEvent(this.app.vault.on('delete', (f) => { if (f instanceof TFile) { this.index.update(f.path, undefined); } }));
    this.registerEvent(this.app.vault.on('rename', (f, old) => { this.index.update(old, undefined); if (f instanceof TFile) touch(f.path); }));
  }

  private async flushUpdates(): Promise<void> {
    this.updateTimer = undefined;
    const paths = [...this.pendingPaths];
    this.pendingPaths.clear();
    for (const p of paths) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFile)) { this.index.update(p, undefined); continue; }
      try { this.index.update(p, await this.app.vault.read(f)); } catch (e) { console.warn('[helm] could not read', p, e); }
    }
    this.reconcileSoon();
  }

  private reconcileSoon(): void {
    if (this.reconcileTimer) window.clearTimeout(this.reconcileTimer);
    this.reconcileTimer = window.setTimeout(() => void this.reconcile(), 600);
  }

  private reconciling = false;
  private async reconcile(): Promise<void> {
    this.reconcileTimer = undefined;
    if (this.reconciling || this.busy > 0 || !this.index.ready) return;
    this.reconciling = true;
    try {
      const n = await this.mutations.reconcile();
      if (n > 0) console.debug(`[helm] reconciled ${n} line(s)`);
    } catch (e) {
      console.error('[helm] reconcile failed', e);
    } finally {
      this.reconciling = false;
    }
  }

  /* ── Commands ───────────────────────────────────────────────────────── */

  private registerCommands(): void {
    const ctx = (): UiContext => this.uiContext(this.activeView());
    this.addCommand({ id: 'open', name: 'Open Helm', callback: () => void this.openView() });
    this.addCommand({ id: 'open-today', name: 'Open Today', callback: () => void this.openView().then((v) => v.navigate('today', { date: this.today() })) });
    this.addCommand({ id: 'open-week', name: 'Open Week', callback: () => void this.openView().then((v) => v.navigate('week', { date: this.today() })) });
    this.addCommand({ id: 'open-projects', name: 'Open Projects', callback: () => void this.openView().then((v) => v.navigate('projects')) });
    this.addCommand({ id: 'open-inbox', name: 'Open Inbox', callback: () => void this.openView().then((v) => v.navigate('inbox')) });
    this.addCommand({ id: 'open-review', name: 'Open Review', callback: () => void this.openView().then((v) => v.navigate('review')) });
    this.addCommand({ id: 'open-dashboard', name: 'Open Dashboard', callback: () => void this.openView().then((v) => v.navigate('dashboard')) });
    this.addCommand({ id: 'open-horizons', name: 'Open Horizons (goals by year, quarter, month)', callback: () => void this.openView().then((v) => v.navigate('horizons')) });
    this.addCommand({ id: 'capture', name: 'Capture a task', callback: () => openCapture(ctx()) });
    this.addCommand({ id: 'capture-today', name: 'Capture a task for today', callback: () => openCapture(ctx(), { date: this.today() }) });
    this.addCommand({ id: 'plan-day', name: 'Plan my day', callback: () => openPlanDay(ctx(), this.today()) });
    this.addCommand({ id: 'wrap-up', name: 'Wrap up the day', callback: () => openWrapUp(ctx(), this.today()) });
    this.addCommand({ id: 'open-daily-note', name: 'Open today’s daily note (create if missing)', callback: () => void this.run('Open daily note', async () => { const p = await this.mutations.ensureDailyNote(this.today()); await this.openFile(p); }) });
    this.addCommand({ id: 'new-project', name: 'New project', callback: () => openProjectForm(ctx(), { onCreated: (p) => ctx().navigate('projects', { projectId: p.id }) }) });
    this.addCommand({ id: 'new-habit', name: 'New habit', callback: () => openHabitForm(ctx()) });
    this.addCommand({ id: 'rebuild-index', name: 'Rebuild index', callback: () => void this.run('Rebuild index', () => this.index.rebuild()) });
    this.addCommand({ id: 'sync-habits-today', name: 'Add today’s habits to the daily note', callback: () => void this.run('Habits', () => this.mutations.syncHabitsForDay(this.today())) });
    this.addCommand({
      id: 'task-under-cursor-today', name: 'Plan the task under the cursor for today', editorCheckCallback: (checking, editor, view) => {
        const t = this.taskAtCursor(view.file?.path, editor.getCursor().line);
        if (!t) return false;
        if (!checking) void this.run('Schedule', () => this.mutations.schedule(t.key, this.today()));
        return true;
      },
    });
    this.addCommand({
      id: 'task-under-cursor-tomorrow', name: 'Plan the task under the cursor for tomorrow', editorCheckCallback: (checking, editor, view) => {
        const t = this.taskAtCursor(view.file?.path, editor.getCursor().line);
        if (!t) return false;
        if (!checking) { const d = new Date(); d.setDate(d.getDate() + 1); void this.run('Schedule', () => this.mutations.schedule(t.key, todayLocal(d))); }
        return true;
      },
    });
    this.addCommand({
      id: 'task-under-cursor-project', name: 'Move the task under the cursor to a project…', editorCheckCallback: (checking, editor, view) => {
        const t = this.taskAtCursor(view.file?.path, editor.getCursor().line);
        if (!t || t.origin === 'project') return false;
        if (!checking) pickProject(ctx(), (p, ph) => void this.run('Move', () => this.mutations.moveToProject(t.key, p.id, ph)), { phases: true });
        return true;
      },
    });
    this.addCommand({ id: 'self-test', name: 'Run self-test (developer)', checkCallback: (checking) => { if (!this.settings.developerActions) return false; if (!checking) void this.selfTest(); return true; } });
  }

  private taskAtCursor(path: string | undefined, line: number) {
    if (!path) return undefined;
    return this.index.tasksInFile(path).find((t) => t.line === line);
  }

  private async selfTest(): Promise<void> {
    await this.run('Self-test', async () => {
      const report = await runSelfTest(this);
      const path = 'Helm Self-Test Report.md';
      await this.vault.write(path, report);
      await this.openFile(path);
    });
  }
}
