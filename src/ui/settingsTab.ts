/**
 * Settings: a left nav over grouped panels, the layout AWTY / Food Spot /
 * Watch, Read and Learn use. Each panel has an icon, a subtitle and a status
 * chip so its state is legible without reading every row; paths are picked
 * from a suggester rather than typed; lists are chips, not comma strings.
 *
 * NB: Obsidian's SettingTab base class owns `navEl` (the tab's sidebar entry).
 * Reusing that name for our section nav made Obsidian hoist it into the
 * sidebar on the first open after startup — hence `sectionNavEl`.
 */
import { AbstractInputSuggest, PluginSettingTab, Setting, setIcon, TFile, TFolder, type App, type Plugin, type TextComponent } from 'obsidian';
import { DEFAULT_SETTINGS, type HelmSettings } from '../core/types';
import type { PeriodKind } from '../core/periods';

export const PERIOD_LABELS: Record<PeriodKind, string> = { year: 'Yearly', quarter: 'Quarterly', month: 'Monthly', week: 'Weekly' };

export interface SettingsHost extends Plugin {
  settings: HelmSettings;
  saveSettings(): Promise<void>;
  loadSettings(): Promise<void>;
  dailyConfig(): { folder: string; format: string; template: string };
  periodicConfigFor(kind: 'year' | 'quarter' | 'month' | 'week'): { folder: string; format: string; template: string };
  onSettingsChanged(): void;
  templateInfo(kind: PeriodKind): Promise<{ source: 'custom' | 'periodic-notes' | 'built-in'; path?: string; exists: boolean }>;
  templateTargetPath(kind: PeriodKind): string;
  writeTemplate(kind: PeriodKind, replace: boolean): Promise<'created' | 'replaced' | 'skipped'>;
  createCurrentPeriodicNotes(): Promise<string[]>;
  excalidrawFolderPath(): string | undefined;
}

type ChipTone = 'ok' | 'warn' | 'pending';
interface GroupHandle { content: HTMLElement; setChip(text: string, tone: ChipTone): void }
type StrKey = { [K in keyof HelmSettings]: HelmSettings[K] extends string ? K : never }[keyof HelmSettings];
type BoolKey = { [K in keyof HelmSettings]: HelmSettings[K] extends boolean ? K : never }[keyof HelmSettings];
type NumKey = 'dailyCapacityMinutes' | 'defaultEffortMinutes' | 'staleProjectDays';

export const NAV_SECTIONS: { id: string; label: string; icon: string }[] = [
  { id: 'folders', label: 'Folders', icon: 'folder' },
  { id: 'daily', label: 'Daily notes', icon: 'calendar-days' },
  { id: 'horizons', label: 'Horizons', icon: 'mountain' },
  { id: 'planning', label: 'Planning', icon: 'sliders-horizontal' },
  { id: 'drawings', label: 'Drawings', icon: 'pen-tool' },
  { id: 'view', label: 'View', icon: 'layout-dashboard' },
  { id: 'about', label: 'About', icon: 'info' },
];

/** Folder or note picker on a plain text input. */
class PathSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, private input: HTMLInputElement, private kind: 'folder' | 'note', private onPick: (v: string) => void) { super(app, input); }
  private candidates(): string[] {
    const vault = this.app.vault as unknown as { getAllLoadedFiles?: () => unknown[]; getMarkdownFiles: () => { path: string }[] };
    if (this.kind === 'note') return vault.getMarkdownFiles().map((f) => f.path);
    const loaded = vault.getAllLoadedFiles?.();
    if (loaded) return loaded.filter((f): f is TFolder => f instanceof TFolder).map((f) => f.path).filter((p) => p !== '/' && p !== '');
    const out = new Set<string>();
    for (const f of vault.getMarkdownFiles()) { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/')); }
    return [...out];
  }
  override getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.candidates().filter((p) => p.toLowerCase().includes(q)).sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 30);
  }
  override renderSuggestion(value: string, el: HTMLElement): void { el.setText(value); }
  override selectSuggestion(value: string): void { this.input.value = value; this.onPick(value); this.close(); }
}

export class HelmSettingTab extends PluginSettingTab {
  private active = 'folders';
  private sectionNavEl!: HTMLElement;
  private bodyEl!: HTMLElement;

  constructor(app: App, private host: SettingsHost) { super(app, host); }

  /** Save, and if the write fails say so and fall back to what the disk holds. */
  private async save(): Promise<void> {
    try { await this.host.saveSettings(); this.host.onSettingsChanged(); }
    catch (err) {
      console.error('[helm] could not save settings', err);
      try { await this.host.loadSettings(); } catch { /* disk unreadable; the live object is the best truth */ }
      this.renderBody();
      throw new Error('Helm: could not save that setting — reverted.');
    }
  }

  private exists(path: string): boolean {
    if (path.trim() === '') return false;
    const p = path.replace(/\/+$/, '');
    if (this.app.vault.getAbstractFileByPath(p)) return true;
    return this.app.vault.getMarkdownFiles().some((f) => f.path.startsWith(p + '/'));
  }
  private pathChip(path: string, what = 'folder'): { text: string; tone: ChipTone } {
    return path.trim() === '' ? { text: `no ${what}`, tone: 'warn' } : this.exists(path) ? { text: 'found', tone: 'ok' } : { text: 'not found', tone: 'warn' };
  }

  private group(parent: HTMLElement, o: { icon: string; title: string; subtitle: string; chip?: { text: string; tone: ChipTone } }): GroupHandle {
    const box = parent.createDiv({ cls: 'helm-sgroup' });
    const head = box.createDiv({ cls: 'helm-sgroup-head' });
    setIcon(head.createDiv({ cls: 'helm-sgroup-icon' }), o.icon);
    const titles = head.createDiv({ cls: 'helm-sgroup-titles' });
    titles.createDiv({ cls: 'helm-sgroup-title', text: o.title });
    titles.createDiv({ cls: 'helm-sgroup-sub', text: o.subtitle });
    const chip = head.createSpan({ cls: 'helm-schip' });
    chip.style.display = 'none';
    const setChip = (text: string, tone: ChipTone): void => {
      chip.style.display = '';
      chip.setText(text);
      chip.removeClass('helm-schip-ok', 'helm-schip-warn', 'helm-schip-pending');
      chip.addClass(`helm-schip-${tone}`);
    };
    if (o.chip) setChip(o.chip.text, o.chip.tone);
    return { content: box.createDiv({ cls: 'helm-sgroup-body' }), setChip };
  }

  /** A `?` on a row that reveals the long explanation only when asked. */
  private help(setting: Setting, text: string): void {
    let helpEl: HTMLElement | null = null;
    setting.addExtraButton((b) => b.setIcon('help-circle').setTooltip('What does this do?').onClick(() => {
      if (helpEl) { helpEl.remove(); helpEl = null; return; }
      helpEl = createDiv({ cls: 'helm-setting-help', text });
      setting.settingEl.insertAdjacentElement('afterend', helpEl);
    }));
  }
  private note(parent: HTMLElement, text: string): void { parent.createDiv({ cls: 'helm-setting-note', text }); }

  /** Text row bound to a string setting; `pick` turns it into a folder / note picker. */
  private text(parent: HTMLElement, key: StrKey, o: { name: string; desc?: string; placeholder?: string; pick?: 'folder' | 'note'; fallback?: string; after?: (v: string) => void; help?: string; type?: string }): Setting {
    const s = this.host.settings;
    const commit = async (v: string): Promise<void> => { (s as Record<StrKey, string>)[key] = v.trim() || (o.fallback ?? ''); await this.save(); o.after?.(s[key]); };
    const st = new Setting(parent).setName(o.name);
    if (o.desc) st.setDesc(o.desc);
    st.addText((t: TextComponent) => {
      t.setPlaceholder(o.placeholder ?? '').setValue(s[key]).onChange((v) => void commit(v));
      if (o.type) t.inputEl.type = o.type;
      if (o.pick) { t.inputEl.addClass('helm-path-input'); new PathSuggest(this.app, t.inputEl, o.pick, (v) => void commit(v)); }
    });
    if (o.help) this.help(st, o.help);
    return st;
  }
  private toggle(parent: HTMLElement, key: BoolKey, name: string, desc: string, help?: string): Setting {
    const s = this.host.settings;
    const st = new Setting(parent).setName(name).setDesc(desc).addToggle((t) => t.setValue(s[key]).onChange((v) => { s[key] = v; void this.save(); }));
    if (help) this.help(st, help);
    return st;
  }
  private slider(parent: HTMLElement, key: NumKey, name: string, desc: string, min: number, max: number, step: number, unit: string): void {
    const s = this.host.settings;
    const st = new Setting(parent).setName(name).setDesc(desc);
    const wrap = st.controlEl.createDiv({ cls: 'helm-slider-wrap' });
    st.addSlider((sl) => { sl.setLimits(min, max, step).setValue(s[key]).setDynamicTooltip().onChange((v) => { (s as Record<NumKey, number>)[key] = v; void this.save(); }); wrap.appendChild(sl.sliderEl); });
    void unit;
  }
  private dropdown<K extends StrKey | 'weekStartsOn'>(parent: HTMLElement, key: K, name: string, desc: string, options: Record<string, string>, after?: () => void): void {
    const s = this.host.settings as unknown as Record<string, unknown>;
    new Setting(parent).setName(name).setDesc(desc).addDropdown((d) => d.addOptions(options).setValue(String(s[key])).onChange((v) => { s[key as string] = key === 'weekStartsOn' ? Number(v) : v; void this.save().then(after); }));
  }

  /** A list of paths as removable chips plus a picker to add one. */
  private pathList(parent: HTMLElement, key: 'excludePaths' | 'extraFolders', o: { name: string; desc: string; placeholder: string; onChange?: () => void }): void {
    const s = this.host.settings;
    const st = new Setting(parent).setName(o.name).setDesc(o.desc);
    st.settingEl.addClass('helm-setting-list');
    const list = st.controlEl.createDiv({ cls: 'helm-slist' });
    const commit = async (): Promise<void> => { await this.save(); draw(); o.onChange?.(); };
    const draw = (): void => {
      list.empty();
      if (s[key].length === 0) list.createSpan({ cls: 'helm-slist-empty', text: 'none' });
      for (const p of s[key]) {
        const chip = list.createSpan({ cls: 'helm-slist-item' });
        chip.createSpan({ text: p, cls: 'helm-slist-text' });
        if (!this.exists(p)) chip.createSpan({ cls: 'helm-slist-missing', text: '· not found' });
        const x = chip.createEl('button', { cls: 'helm-slist-remove', attr: { 'aria-label': `Remove ${p}` } });
        setIcon(x, 'x');
        x.onclick = () => { s[key] = s[key].filter((q) => q !== p); void commit(); };
      }
    };
    draw();
    const row = st.controlEl.createDiv({ cls: 'helm-slist-add' });
    const input = row.createEl('input', { type: 'text', placeholder: o.placeholder, cls: 'helm-path-input' });
    const add = (v: string): void => { const p = v.trim().replace(/\/+$/, ''); if (p === '' || s[key].includes(p)) return; s[key] = [...s[key], p]; input.value = ''; void commit(); };
    new PathSuggest(this.app, input, 'folder', add);
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(input.value); } });
    const btn = row.createEl('button', { text: 'Add' });
    btn.onclick = () => add(input.value);
  }

  // ── shell ─────────────────────────────────────────────────────────────

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('helm-settings');
    this.sectionNavEl = containerEl.createDiv({ cls: 'helm-settings-nav' });
    this.bodyEl = containerEl.createDiv({ cls: 'helm-settings-body' });
    for (const section of NAV_SECTIONS) {
      const btn = this.sectionNavEl.createEl('button', { cls: 'helm-settings-nav-item' });
      setIcon(btn.createSpan({ cls: 'helm-settings-nav-icon' }), section.icon);
      btn.createSpan({ text: section.label });
      btn.toggleClass('is-active', section.id === this.active);
      btn.onclick = () => {
        this.active = section.id;
        for (const el of Array.from(this.sectionNavEl.querySelectorAll('.helm-settings-nav-item'))) el.removeClass('is-active');
        btn.addClass('is-active');
        this.renderBody();
      };
    }
    this.renderBody();
  }

  override hide(): void { this.containerEl.removeClass('helm-settings'); super.hide(); }

  private renderBody(): void {
    const body = this.bodyEl;
    body.empty();
    switch (this.active) {
      case 'daily': this.renderDaily(body); break;
      case 'horizons': this.renderHorizons(body); break;
      case 'planning': this.renderPlanning(body); break;
      case 'drawings': this.renderDrawings(body); break;
      case 'view': this.renderView(body); break;
      case 'about': this.renderAbout(body); break;
      default: this.renderFolders(body);
    }
  }

  // ── folders ───────────────────────────────────────────────────────────

  private renderFolders(body: HTMLElement): void {
    const s = this.host.settings;
    const where = this.group(body, { icon: 'folder', title: 'Where things live', subtitle: 'Projects, habits and the inbox. Start typing to pick from the vault.', chip: this.pathChip(s.projectsFolder) });
    this.text(where.content, 'projectsFolder', { name: 'Projects folder', desc: 'One folder per project with a note of the same name inside.', placeholder: DEFAULT_SETTINGS.projectsFolder, pick: 'folder', fallback: DEFAULT_SETTINGS.projectsFolder, after: (v) => where.setChip(this.pathChip(v).text, this.pathChip(v).tone), help: 'Any note with “type: project” in its frontmatter is a project wherever it lives, but this is where Helm looks first and where “New project” creates folders. Only a folder note (Folder/Folder.md) can be an umbrella for sub-projects.' });
    this.text(where.content, 'habitsFolder', { name: 'Habits folder', desc: 'Notes with “type: habit”. Uploaded icons go in an “icons” subfolder.', placeholder: DEFAULT_SETTINGS.habitsFolder, pick: 'folder', fallback: DEFAULT_SETTINGS.habitsFolder });
    this.text(where.content, 'inboxNote', { name: 'Inbox note', desc: 'Where captures with no date and no project land.', placeholder: DEFAULT_SETTINGS.inboxNote, pick: 'note', fallback: DEFAULT_SETTINGS.inboxNote });
    this.text(where.content, 'archiveFolder', { name: 'Archive folder', desc: '“Archive project” moves a project folder here.', placeholder: DEFAULT_SETTINGS.archiveFolder, pick: 'folder', help: 'Keep the archive in the excluded paths below so archived projects stay out of the index and the Inbox.' });

    const scan = this.group(body, { icon: 'scan-search', title: 'What Helm scans', subtitle: 'Keep the index lean: skip archives, pull in extra task notes.' });
    const scanChip = (): void => scan.setChip(`${s.excludePaths.length} excluded · ${s.extraFolders.length} extra`, 'pending');
    scanChip();
    this.pathList(scan.content, 'excludePaths', { name: 'Never index these paths', desc: 'Path prefixes Helm skips entirely — archives, old task boards.', placeholder: 'Pick a folder to exclude…', onChange: scanChip });
    this.pathList(scan.content, 'extraFolders', { name: 'Extra folders to scan', desc: 'Tasks in these notes show up under “Tasks in other notes” in the Inbox and can be planned onto a day.', placeholder: 'Pick a folder to scan…', onChange: scanChip });
  }

  // ── daily notes ───────────────────────────────────────────────────────

  private renderDaily(body: HTMLElement): void {
    const s = this.host.settings;
    const dc = this.host.dailyConfig();
    const custom = (): boolean => !!(s.dailyNoteFolder || s.dailyNoteFormat || s.dailyNoteTemplate);
    const loc = this.group(body, { icon: 'calendar-days', title: 'Daily note location', subtitle: 'Leave everything empty to follow the Daily Notes / Periodic Notes plugin.', chip: custom() ? { text: 'custom', tone: 'ok' } : { text: 'follows Obsidian', tone: 'pending' } });
    const chip = (): void => loc.setChip(custom() ? 'custom' : 'follows Obsidian', custom() ? 'ok' : 'pending');
    this.note(loc.content, `Obsidian currently says: folder “${dc.folder || 'not configured'}”, format “${dc.format || 'YYYY-MM-DD'}”, template “${dc.template || 'none'}”.`);
    this.text(loc.content, 'dailyNoteFolder', { name: 'Folder', desc: 'Override only if Helm should look somewhere else.', placeholder: dc.folder || 'follows Obsidian', pick: 'folder', after: chip });
    this.text(loc.content, 'dailyNoteFormat', { name: 'Date format', desc: 'Moment format of the note path inside the folder; slashes make subfolders.', placeholder: dc.format || 'YYYY-MM-DD', after: chip, help: 'Example: YYYY/MM - MMMM/WW/DD, dddd, MMM, YYYY. Helm reads this to find the note for any date and to create missing ones.' });
    this.text(loc.content, 'dailyNoteTemplate', { name: 'Template', desc: 'Used when Helm has to create a daily note.', placeholder: dc.template || 'follows Obsidian', pick: 'note', after: chip, help: 'Templater is asked to render the note when it is installed; otherwise {{date:FORMAT}}, {{title}} and the common Templater date tags are filled in by Helm.' });

    const layout = this.group(body, { icon: 'list-tree', title: 'Plan layout', subtitle: 'Which sections of a daily note Helm writes into.', chip: { text: s.planHeading, tone: 'pending' } });
    this.text(layout.content, 'planHeading', { name: 'Plan heading', desc: 'Used only when a note has no Morning / Afternoon / Evening sections of its own.', placeholder: '## Plan', fallback: '## Plan', after: (v) => layout.setChip(v, 'pending'), help: 'Helm adopts the sections your template already has (Habits, Morning, Afternoon, Evening, Anytime — with or without an “A.” prefix, under any parent heading). Only when none exist does it create this heading with sub-sections under it. Nothing outside those sections is touched.' });
    this.dropdown(layout.content, 'regionPlacement', 'Where a new plan heading goes', 'Only matters for a note that has none of the sections yet.', { 'before-first-heading': 'Before the first heading', 'after-anchor': 'After a heading of my choosing', end: 'At the end of the note' }, () => this.renderBody());
    if (s.regionPlacement === 'after-anchor') this.text(layout.content, 'regionAnchor', { name: 'Anchor heading', desc: 'Exact heading text, e.g. “## Tasks”. Falls back to “before the first heading” when missing.', placeholder: '## Tasks' });
    this.toggle(layout.content, 'showTimeBlocks', 'Show day-planner time blocks', 'Lines like “- [ ] 08:00 - 09:00: …” outside Helm’s sections appear on Today as time blocks.');

    const parts = this.group(body, { icon: 'sun', title: 'Parts of the day', subtitle: 'Timed lines fall into Morning, Afternoon or Evening by their start time.', chip: { text: `${s.morningEnds} · ${s.afternoonEnds}`, tone: 'pending' } });
    const partsChip = (): void => parts.setChip(`${s.morningEnds} · ${s.afternoonEnds}`, 'pending');
    this.text(parts.content, 'morningEnds', { name: 'Morning ends at', placeholder: '12:00', fallback: '12:00', type: 'time', after: partsChip });
    this.text(parts.content, 'afternoonEnds', { name: 'Afternoon ends at', placeholder: '18:00', fallback: '18:00', type: 'time', after: partsChip });

    const beh = this.group(body, { icon: 'wand-sparkles', title: 'Behaviour', subtitle: 'What Helm does on its own while you work.' });
    this.toggle(beh.content, 'autoMoveRecurring', 'Move spawned recurrences to their date', 'When a recurring task is ticked, the next occurrence lands in the same note dated later. Helm moves it into the right day’s note.', 'Only occurrences dated today or later move automatically; older ones are left for the “Move recurring tasks to their next date” command, which moves everything.');
    this.toggle(beh.content, 'defaultCaptureTime', 'Capture starts at the current hour', 'A task captured for today gets the current hour as start time (14:37 → 14:00); the end follows the effort.');
    this.toggle(beh.content, 'writeCreatedDate', 'Stamp ➕ created date on new tasks', 'Off keeps daily notes clean; on gives every captured task an Obsidian Tasks created date.');
  }

  // ── horizons ──────────────────────────────────────────────────────────

  private renderHorizons(body: HTMLElement): void {
    const s = this.host.settings;
    const goals = this.group(body, { icon: 'target', title: 'Goals', subtitle: 'Goals are checkbox lines in your yearly, quarterly, monthly and weekly notes.', chip: { text: s.goalsHeading, tone: 'pending' } });
    this.text(goals.content, 'goalsHeading', { name: 'Goals heading', desc: 'The heading under which goals live in a periodic note.', placeholder: '## Goals', fallback: '## Goals', after: (v) => goals.setChip(v, 'pending'), help: 'A project bound to a goal (“Serves goal” in the project form) rolls its progress up into that goal on the Horizons tab.' });

    const kinds = [['year', 'Yearly notes', 'yearlyFolder', 'yearlyFormat', 'YYYY'], ['quarter', 'Quarterly notes', 'quarterlyFolder', 'quarterlyFormat', 'YYYY-[Q]Q'], ['month', 'Monthly notes', 'monthlyFolder', 'monthlyFormat', 'YYYY-MM'], ['week', 'Weekly notes', 'weeklyFolder', 'weeklyFormat', 'gggg-[W]ww']] as const;
    const custom = (): boolean => kinds.some(([, , fk, fmk]) => s[fk] !== '' || s[fmk] !== '');
    const per = this.group(body, { icon: 'calendar-range', title: 'Periodic notes', subtitle: 'Leave empty to follow the Periodic Notes plugin.', chip: custom() ? { text: 'custom', tone: 'ok' } : { text: 'follows Periodic Notes', tone: 'pending' } });
    const chip = (): void => per.setChip(custom() ? 'custom' : 'follows Periodic Notes', custom() ? 'ok' : 'pending');
    const tplKeys: Record<PeriodKind, 'yearlyTemplate' | 'quarterlyTemplate' | 'monthlyTemplate' | 'weeklyTemplate'> = { year: 'yearlyTemplate', quarter: 'quarterlyTemplate', month: 'monthlyTemplate', week: 'weeklyTemplate' };
    for (const [kind, label, fk, fmk, fallbackFmt] of kinds) {
      const pc = this.host.periodicConfigFor(kind);
      per.content.createDiv({ cls: 'helm-sgroup-label', text: label });
      this.note(per.content, `Periodic Notes says: ${pc.folder ? `“${pc.folder}”` : 'no folder'} · ${pc.format || fallbackFmt}${pc.template ? ` · template “${pc.template}”` : ''}.`);
      this.text(per.content, fk, { name: 'Folder', placeholder: pc.folder || 'follows Periodic Notes', pick: 'folder', after: chip });
      this.text(per.content, fmk, { name: 'Date format', placeholder: pc.format || fallbackFmt, after: chip });
      const tplRow = this.text(per.content, tplKeys[kind], { name: 'Template', placeholder: pc.template || 'Helm’s built-in template', pick: 'note', after: () => { chip(); void describe(); } });
      const describe = async (): Promise<void> => { const i = await this.host.templateInfo(kind); tplRow.setDesc(i.source === 'built-in' ? 'Using Helm’s built-in template.' : `${i.source === 'custom' ? 'Your template' : 'Periodic Notes’ template'}${i.exists ? '' : ' — note not found, Helm’s built-in one is used until it exists'}.`); };
      void describe();
    }

    const tpl = this.group(body, { icon: 'file-plus-2', title: 'Template notes', subtitle: 'Helm ships a template for each kind: navigation links, a Goals section, focus and review. Write them into your vault to edit them.' });
    for (const [kind, label] of kinds) {
      const target = this.host.templateTargetPath(kind);
      const row = new Setting(tpl.content).setName(`${label.replace(' notes', '')} template`).setDesc(target);
      row.settingEl.addClass('helm-setting-template');
      void this.host.templateInfo(kind).then((i) => {
        const exists = i.exists && i.path === target;
        row.addButton((b) => b.setButtonText(exists ? 'Replace…' : 'Create').setCta().onClick(async () => {
          if (exists && !window.confirm(`Replace “${target}” with Helm’s built-in ${label.toLowerCase().replace(' notes', '')} template? The current note is overwritten.`)) return;
          const r = await this.host.writeTemplate(kind, exists);
          row.setDesc(`${target} — ${r}`);
          this.renderBody();
        }));
      });
    }

    const auto = this.group(body, { icon: 'wand-sparkles', title: 'Automation', subtitle: 'Periodic notes that create themselves.', chip: s.autoCreatePeriodicNotes ? { text: 'on', tone: 'ok' } : { text: 'off', tone: 'pending' } });
    this.toggle(auto.content, 'autoCreatePeriodicNotes', 'Create this period’s notes on startup', 'When Helm loads it makes sure this week’s, month’s, quarter’s and year’s notes exist, from the templates above.');
    new Setting(auto.content).setName('Create them now').setDesc('This week, this month, this quarter and this year — only the ones missing.').addButton((b) => b.setButtonText('Create now').onClick(async () => { const c = await this.host.createCurrentPeriodicNotes(); b.setButtonText(c.length === 0 ? 'All present' : `Created ${c.length}`); }));
  }

  // ── planning ──────────────────────────────────────────────────────────

  private renderPlanning(body: HTMLElement): void {
    const s = this.host.settings;
    const cap = this.group(body, { icon: 'gauge', title: 'Capacity', subtitle: 'What a day holds and what an unestimated task costs.', chip: { text: `${Math.round(s.dailyCapacityMinutes / 60 * 10) / 10}h a day`, tone: 'pending' } });
    this.slider(cap.content, 'dailyCapacityMinutes', 'Daily capacity', 'Minutes of focused work a day holds. Drives the capacity bar on Today.', 60, 720, 30, 'min');
    this.slider(cap.content, 'defaultEffortMinutes', 'Default effort', 'Minutes assumed for a task without a ⏱️ estimate.', 5, 120, 5, 'min');

    const rhythm = this.group(body, { icon: 'repeat', title: 'Rhythm', subtitle: 'Wrap-up, review and the shape of the week.' });
    this.dropdown(rhythm.content, 'rolloverTarget', 'Wrap-up default for unfinished tasks', 'What Wrap up proposes for tasks that did not get done.', { tomorrow: 'Move to tomorrow', unschedule: 'Take off the calendar' });
    this.slider(rhythm.content, 'staleProjectDays', 'Stale project after', 'Days without activity before an active project is flagged in Review.', 3, 60, 1, 'days');
    this.dropdown(rhythm.content, 'weekStartsOn', 'Week starts on', 'Affects week numbers, the Calendar and “next week” in capture.', { '1': 'Monday', '7': 'Sunday' });

    const writing = this.group(body, { icon: 'pencil', title: 'Writing', subtitle: 'How Helm writes into your notes.' });
    this.dropdown(writing.content, 'indentUnit', 'Indent for new subtasks', 'Match what your editor uses.', { '\t': 'Tab', '  ': 'Two spaces', '    ': 'Four spaces' });
  }

  // ── drawings ──────────────────────────────────────────────────────────

  private renderDrawings(body: HTMLElement): void {
    const s = this.host.settings;
    const exFolder = this.host.excalidrawFolderPath();
    const where = this.group(body, { icon: 'pen-tool', title: 'Where drawings live', subtitle: 'Excalidraw drawings Helm creates or links for tasks, days, weeks, months, quarters, years and projects.', chip: s.drawingsFolder ? this.pathChip(s.drawingsFolder) : exFolder ? { text: 'follows Excalidraw', tone: 'pending' } : { text: 'Excalidraw not found', tone: 'warn' } });
    this.note(where.content, exFolder ? `The Excalidraw plugin keeps new drawings in “${exFolder}”; Helm follows it unless you set a folder here.` : 'The Excalidraw plugin is not installed or has no folder set; Helm uses “Excalidraw” unless you set a folder here.');
    this.text(where.content, 'drawingsFolder', { name: 'Folder', desc: 'For drawings attached to days, periods and tasks.', placeholder: exFolder ?? 'Excalidraw', pick: 'folder', after: (v) => where.setChip(v ? this.pathChip(v).text : 'follows Excalidraw', v ? this.pathChip(v).tone : 'pending') });
    this.toggle(where.content, 'projectDrawingsInProjectFolder', 'Project drawings live in the project folder', 'Next to the project note, like the drawings you already keep there.');
    this.text(where.content, 'drawingTemplate', { name: 'Drawing template', desc: 'An Excalidraw note to copy for new drawings (grid, colours, frames). Empty = blank.', placeholder: 'Excalidraw/Templates/Grid enabled.excalidraw', pick: 'note' });
    this.toggle(where.content, 'embedDrawings', 'Embed new drawings in the note', 'A `![[…excalidraw]]` line under a Diagrams heading in the daily, periodic or project note, so the drawing shows up inside the note too.');

    const how = this.group(body, { icon: 'link', title: 'How drawings are found', subtitle: 'Nothing to configure — this is what Helm looks at.' });
    this.note(how.content, 'A drawing belongs to a project when it sits in the project’s folder, when the project note embeds it, or when it links the project. It belongs to a day or a period when its name starts with that note’s title (“26, Wednesday, Aug, 2026 — flow”, “2026-W35 map”), when that note embeds it, or when its text links the note. It belongs to a task when Helm made it for that task or its text mentions the task’s 🆔. Drawings Helm creates carry helm-task / helm-project / helm-date / helm-period frontmatter, which always wins.');
  }

  // ── view ──────────────────────────────────────────────────────────────

  private renderView(body: HTMLElement): void {
    const s = this.host.settings;
    const open = this.group(body, { icon: 'layout-dashboard', title: 'Opening Helm', subtitle: 'Where the view starts and whether it opens by itself.' });
    this.dropdown(open.content, 'defaultTab', 'Tab to open on', '', { today: 'Today', week: 'Calendar', projects: 'Projects', inbox: 'Inbox', review: 'Review', horizons: 'Horizons', dashboard: 'Dashboard' });
    this.toggle(open.content, 'openOnStartup', 'Open Helm on startup', 'Opens the Helm view when the vault loads.');

    const dev = this.group(body, { icon: 'bug', title: 'Developer', subtitle: 'Only useful when testing Helm itself.', chip: s.developerActions ? { text: 'on', tone: 'warn' } : { text: 'off', tone: 'pending' } });
    this.toggle(dev.content, 'developerActions', 'Developer actions', 'Adds the “Run self-test” command, which writes a report note into the vault.').settingEl.addClass('helm-setting-dev');
    if (s.developerActions) new Setting(dev.content).setName('Self-test').setDesc('Runs Helm’s checks against this vault and writes “Helm Self-Test Report.md”.').addButton((b) => b.setButtonText('Run self-test').onClick(() => { (this.app as unknown as { commands?: { executeCommandById?: (id: string) => void } }).commands?.executeCommandById?.('helm-planner:self-test'); }));
  }

  // ── about ─────────────────────────────────────────────────────────────

  private renderAbout(body: HTMLElement): void {
    const m = this.host.manifest;
    const about = this.group(body, { icon: 'compass', title: `Helm ${m.version}`, subtitle: m.description });
    this.note(about.content, 'Helm plans your days from the notes you already keep: daily notes hold the plan, project notes hold the work, periodic notes hold the goals. Everything it writes is plain Obsidian Tasks markdown.');
    const cmds: [string, string][] = [['Open Helm', 'the view — Today, Calendar, Projects, Inbox, Review, Horizons, Dashboard'], ['Capture', 'one line in, a task out — dates, !priority, @Project, ~effort, times'], ['Plan today / Wrap up today', 'the morning and evening rituals'], ['Move recurring tasks to their next date', 'tidy spawned recurrences in one go'], ['New project / New habit', 'the click-driven forms']];
    const list = about.content.createDiv({ cls: 'helm-about-commands' });
    for (const [name, desc] of cmds) { const row = list.createDiv({ cls: 'helm-about-command' }); row.createSpan({ cls: 'helm-about-command-name', text: name }); row.createSpan({ cls: 'helm-about-command-desc', text: desc }); }
    new Setting(about.content).setName('Re-index the vault').setDesc('Rebuild Helm’s picture of projects, tasks, habits and goals from disk.').addButton((b) => b.setButtonText('Re-index').onClick(() => { this.host.onSettingsChanged(); }));
    new Setting(about.content).setName('Reset to defaults').setDesc('Puts every setting back to its default. Your notes are not touched.').addButton((b) => b.setButtonText('Reset').setWarning().onClick(() => { Object.assign(this.host.settings, DEFAULT_SETTINGS, { excludePaths: [...DEFAULT_SETTINGS.excludePaths], extraFolders: [...DEFAULT_SETTINGS.extraFolders] }); void this.save().then(() => { this.active = 'folders'; this.display(); }); }));
    void TFile;
  }
}
