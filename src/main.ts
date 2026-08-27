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
import { TEMPLATE_FILE_NAMES } from './core/periodicTemplates';
import type { PeriodKind } from './core/periods';
import { PERIOD_LABELS } from './ui/settingsTab';
import { newDrawing, targetForDate, targetForPeriod } from './ui/drawings';
import { periodOf } from './core/periods';

export default class HelmPlugin extends Plugin {
  override settings: HelmSettings = { ...DEFAULT_SETTINGS };
  vault!: ObsidianVault;
  index!: HelmIndex;
  mutations!: Mutations;
  private daily = { folder: '', format: '', template: '' };
  private excalidrawFolder: string | undefined;
  private periodic: Record<'year' | 'quarter' | 'month' | 'week', { folder: string; format: string; template: string }> = { year: { folder: '', format: '', template: '' }, quarter: { folder: '', format: '', template: '' }, month: { folder: '', format: '', template: '' }, week: { folder: '', format: '', template: '' } };
  private reconcileTimer: number | undefined;
  private pendingPaths = new Set<string>();
  private updateTimer: number | undefined;
  private busy = 0;
  private openModals = new Set<{ close: () => void; onClose?: () => void }>();

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
      periodicTemplate: (kind) => this.readTemplate(this.periodicTemplatePath(kind) ?? ''),
      processTemplate: (path) => this.runTemplater(path),
      excalidrawFolder: () => this.excalidrawFolder,
    });
    this.index.onChange(() => this.refreshViews());

    this.registerView(VIEW_TYPE, (leaf) => new HelmView(leaf, (view) => this.uiContext(view)));
    this.addRibbonIcon('compass', 'Open Helm', () => void this.openView());
    this.addSettingTab(new HelmSettingTab(this.app, this));
    this.registerCommands();
    this.registerObsidianProtocolHandler('helm', (params) => {
      const tab = (params['tab'] as TabId | undefined) ?? 'today';
      const date = params['date'];
      void this.openView().then(() => this.activeView()?.navigate(tab, { ...(date ? { date } : {}) }));
      if (params['action'] === 'selftest') void this.selfTest();
      if (params['action'] === 'capture') openCapture(this.uiContext(), { ...(params['text'] ? { text: params['text'] } : {}) });
    });

    this.app.workspace.onLayoutReady(() => {
      // Vault events are wired only now: Obsidian replays a `create` for every file while it loads,
      // and treating those as edits meant re-linking 8,000 tasks and re-rendering 800 times at startup.
      void this.index.rebuild().then(async () => {
        this.registerVaultEvents();
        this.reconcileSoon();
        if (this.settings.autoCreatePeriodicNotes) {
          try {
            const created = await this.mutations.ensureCurrentPeriodicNotes();
            if (created.length > 0) new Notice(`Helm created ${created.map((c) => c.slice(c.lastIndexOf('/') + 1).replace(/\.md$/, '')).join(', ')}.`);
          } catch (err) { console.error('[helm] could not create periodic notes', err); }
        }
      });
      if (this.settings.openOnStartup) void this.openView();
    });
  }

  override onunload(): void {
    for (const m of this.openModals) { try { m.close(); } catch { /* already gone */ } }
    this.openModals.clear();
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
    const ex = await readJson('.obsidian/plugins/obsidian-excalidraw-plugin/data.json');
    this.excalidrawFolder = typeof ex?.['folder'] === 'string' && (ex['folder'] as string).trim() !== '' ? (ex['folder'] as string).replace(/\/+$/, '') : undefined;
  }

  excalidrawFolderPath(): string | undefined { return this.excalidrawFolder; }

  /* ── Setup checks ──────────────────────────────────────────────────── */

  pluginStatus(id: string): 'enabled' | 'disabled' | 'missing' {
    const a = this.app as unknown as { plugins?: { plugins?: Record<string, unknown>; manifests?: Record<string, unknown>; enabledPlugins?: Set<string> }; internalPlugins?: { getPluginById?: (id: string) => { enabled?: boolean } | null; plugins?: Record<string, { enabled?: boolean }> } };
    if (id.startsWith('core:')) {
      const cid = id.slice(5);
      const p = a.internalPlugins?.getPluginById?.(cid) ?? a.internalPlugins?.plugins?.[cid] ?? null;
      return !p ? 'missing' : p.enabled ? 'enabled' : 'disabled';
    }
    if (a.plugins?.plugins?.[id]) return 'enabled';
    return a.plugins?.manifests?.[id] ? 'disabled' : 'missing';
  }
  async enablePlugin(id: string): Promise<void> {
    const a = this.app as unknown as { plugins?: { enablePluginAndSave?: (id: string) => Promise<void> }; internalPlugins?: { getPluginById?: (id: string) => { enable?: (save: boolean) => Promise<void> } | null } };
    if (id.startsWith('core:')) { await a.internalPlugins?.getPluginById?.(id.slice(5))?.enable?.(true); return; }
    await a.plugins?.enablePluginAndSave?.(id);
  }
  openPluginInstall(id: string): void {
    const a = this.app as unknown as { setting?: { openTabById?: (id: string) => void; close?: () => void } };
    if (id.startsWith('core:')) { a.setting?.openTabById?.('core-plugins'); return; }
    window.open(`obsidian://show-plugin?id=${encodeURIComponent(id)}`);
  }
  dailyTemplatePath(): string | undefined { const p = this.settings.dailyNoteTemplate.trim() || this.daily.template; return p ? (p.endsWith('.md') ? p : `${p}.md`) : undefined; }
  /** Where a daily template would be written when none is configured. */
  dailyTemplateTarget(): string { return this.dailyTemplatePath() ?? `${this.templateTargetPath('week').replace(/\/[^/]*$/, '')}/DAILY NOTE TEMPLATE.md`; }
  async fileExists(path: string): Promise<boolean> { return this.vault.exists(path); }
  async ensureFolder(path: string): Promise<boolean> { return this.mutations.ensureFolder(path); }
  async ensureInboxNote(): Promise<boolean> { return this.mutations.ensureInboxNote(); }
  async writeDailyTemplate(replace: boolean): Promise<'created' | 'replaced' | 'skipped'> {
    const target = this.dailyTemplateTarget();
    const r = await this.mutations.writeDailyTemplate(target, { replace });
    if (!this.dailyTemplatePath()) { this.settings.dailyNoteTemplate = target; await this.saveSettings(); }
    return r;
  }
  private excalidrawInstalled(): boolean { return !!(this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins?.['obsidian-excalidraw-plugin']; }

  periodicConfigFor(kind: 'year' | 'quarter' | 'month' | 'week'): { folder: string; format: string; template: string } { return this.periodic[kind]; }

  /* ── Periodic note templates: Helm override → Periodic Notes → built-in ── */

  private templateOverride(kind: PeriodKind): string {
    const key = { year: 'yearlyTemplate', quarter: 'quarterlyTemplate', month: 'monthlyTemplate', week: 'weeklyTemplate' }[kind] as 'yearlyTemplate' | 'quarterlyTemplate' | 'monthlyTemplate' | 'weeklyTemplate';
    return this.settings[key].trim();
  }
  private periodicTemplatePath(kind: PeriodKind): string | undefined {
    const p = this.templateOverride(kind) || this.periodic[kind].template;
    return p ? (p.endsWith('.md') ? p : `${p}.md`) : undefined;
  }
  /** Which template a kind resolves to, and whether that note exists. */
  async templateInfo(kind: PeriodKind): Promise<{ source: 'custom' | 'periodic-notes' | 'built-in'; path?: string; exists: boolean }> {
    const path = this.periodicTemplatePath(kind);
    const exists = path ? await this.vault.exists(path) : false;
    const source = this.templateOverride(kind) ? 'custom' : this.periodic[kind].template ? 'periodic-notes' : 'built-in';
    return { source, ...(path ? { path } : {}), exists: exists && source !== 'built-in' };
  }
  /** Where "Create template note" writes for a kind: the configured path, else <templates folder>/<KIND> NOTE TEMPLATE.md. */
  templateTargetPath(kind: PeriodKind): string {
    const configured = this.periodicTemplatePath(kind);
    if (configured) return configured;
    const anyTemplate = this.daily.template || this.periodic.year.template || this.periodic.quarter.template || this.periodic.month.template || this.periodic.week.template;
    const folder = anyTemplate && anyTemplate.includes('/') ? anyTemplate.slice(0, anyTemplate.lastIndexOf('/')) : 'Templates';
    return `${folder}/${TEMPLATE_FILE_NAMES[kind]}`;
  }
  async writeTemplate(kind: PeriodKind, replace: boolean): Promise<'created' | 'replaced' | 'skipped'> {
    return this.mutations.writeTemplateNote(kind, this.templateTargetPath(kind), { replace });
  }
  async createCurrentPeriodicNotes(): Promise<string[]> { return this.mutations.ensureCurrentPeriodicNotes(); }

  /**
   * Hand a freshly created note (holding the raw template) to Templater, so the
   * user's own template — quotes, moment() links, scripts — comes out exactly
   * as it would from Templater itself. Undocumented API; guarded, best effort.
   */
  private async runTemplater(path: string): Promise<boolean> {
    const plugins = (this.app as unknown as { plugins?: { plugins?: Record<string, unknown> } }).plugins?.plugins;
    const tp = plugins?.['templater-obsidian'] as { templater?: { overwrite_file_commands?: (file: TFile) => Promise<void> } } | undefined;
    const fn = tp?.templater?.overwrite_file_commands;
    if (typeof fn !== 'function') return false;
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) return false;
    await fn.call(tp!.templater, file);
    return true;
  }

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
      now: () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; },
      notify: (m) => { new Notice(m); },
      openFile: (path, line) => this.openFile(path, line),
      openLink: (target, from) => { this.app.workspace.openLinkText(target, from ?? '', false); },
      refresh: () => (view ? view.requestRender() : this.refreshViews()),
      navigate: (tab, opts) => { void this.openView().then(() => (view ?? this.activeView())?.navigate(tab, opts)); },
      run: (label, fn) => this.run(label, fn),
      trackModal: (m) => { this.openModals.add(m); const orig = m.onClose?.bind(m); m.onClose = () => { orig?.(); this.openModals.delete(m); }; },
      resourceUrl: (path) => this.vault.resourceUrl(path),
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
    // A drawing Helm just wrote is not in the metadata cache yet, so the Excalidraw plugin would show it as
    // markdown. Ask for its view explicitly; fall back to a normal open when the plugin is not there.
    if (/\.excalidraw\.md$/i.test(path) && this.excalidrawInstalled()) {
      await leaf.setViewState({ type: 'excalidraw', state: { file: path }, active: true });
      this.app.workspace.setActiveLeaf(leaf, { focus: true });
      return;
    }
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
    const entries: { path: string; content?: string }[] = [];
    for (const p of paths) {
      const f = this.app.vault.getAbstractFileByPath(p);
      if (!(f instanceof TFile)) { entries.push({ path: p }); continue; }
      try { entries.push({ path: p, content: await this.app.vault.read(f) }); } catch (e) { console.warn('[helm] could not read', p, e); }
    }
    // One re-link and one render for the whole batch; unchanged files are skipped.
    if (this.index.updateMany(entries) > 0) this.reconcileSoon();
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
    this.addCommand({ id: 'open-week', name: 'Open Week', callback: () => void this.openView().then((v) => v.navigate('week', { date: this.today(), scope: 'week' })) });
    this.addCommand({ id: 'open-month', name: 'Open Month', callback: () => void this.openView().then((v) => v.navigate('week', { date: this.today(), scope: 'month' })) });
    this.addCommand({ id: 'open-quarter', name: 'Open Quarter', callback: () => void this.openView().then((v) => v.navigate('week', { date: this.today(), scope: 'quarter' })) });
    this.addCommand({ id: 'open-year', name: 'Open Year', callback: () => void this.openView().then((v) => v.navigate('week', { date: this.today(), scope: 'year' })) });
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
    this.addCommand({ id: 'create-periodic-notes', name: 'Create this week’s, month’s, quarter’s and year’s notes', callback: () => void this.run('Periodic notes', async () => { const c = await this.mutations.ensureCurrentPeriodicNotes(); new Notice(c.length === 0 ? 'This week, month, quarter and year already have notes.' : `Created ${c.length} note${c.length === 1 ? '' : 's'}: ${c.map((x) => x.slice(x.lastIndexOf('/') + 1).replace(/\.md$/, '')).join(', ')}.`); }) });
    this.addCommand({ id: 'write-periodic-templates', name: 'Write Helm’s periodic note templates (keeps existing ones)', callback: () => void this.run('Templates', async () => { const out: string[] = []; for (const k of ['year', 'quarter', 'month', 'week'] as PeriodKind[]) out.push(`${PERIOD_LABELS[k]}: ${await this.writeTemplate(k, false)}`); new Notice(out.join(' · ')); }) });
    this.addCommand({ id: 'drawing-today', name: 'New drawing for today', callback: () => newDrawing(ctx(), targetForDate(this.today())) });
    this.addCommand({ id: 'drawing-week', name: 'New drawing for this week', callback: () => newDrawing(ctx(), targetForPeriod(periodOf(this.today(), 'week'))) });
    this.addCommand({ id: 'rebuild-index', name: 'Rebuild index', callback: () => void this.run('Rebuild index', () => this.index.rebuild()) });
    this.addCommand({ id: 'move-recurring', name: 'Move recurring tasks to their next date', callback: () => void this.run('Move recurring', async () => { const n = await this.mutations.moveMisfiled(); new Notice(n === 0 ? 'Every dated task is already in the right note.' : `Moved ${n} task${n === 1 ? '' : 's'} to the note of its date.`); }) });
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
