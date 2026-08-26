import { PluginSettingTab, Setting, type App, type Plugin } from 'obsidian';
import type { HelmSettings } from '../core/types';

export interface SettingsHost extends Plugin {
  settings: HelmSettings;
  saveSettings(): Promise<void>;
  dailyConfig(): { folder: string; format: string; template: string };
  periodicConfigFor(kind: 'year' | 'quarter' | 'month' | 'week'): { folder: string; format: string; template: string };
  onSettingsChanged(): void;
}

export class HelmSettingTab extends PluginSettingTab {
  constructor(app: App, private host: SettingsHost) { super(app, host); }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    const s = this.host.settings;
    const save = async (): Promise<void> => { await this.host.saveSettings(); this.host.onSettingsChanged(); };
    const text = (name: string, desc: string, key: keyof HelmSettings, placeholder = ''): void => {
      new Setting(containerEl).setName(name).setDesc(desc).addText((t) => t.setPlaceholder(placeholder).setValue(String(s[key] ?? '')).onChange(async (v) => { (s as unknown as Record<string, unknown>)[key] = v.trim(); await save(); }));
    };

    new Setting(containerEl).setName('Where things live').setHeading();
    text('Projects folder', 'One folder per project, with a note of the same name inside. Any note with “type: project” in its frontmatter is a project wherever it lives, but this is where Helm looks and creates.', 'projectsFolder', '02 PROJECTS');
    text('Habits folder', 'Notes with “type: habit” in their frontmatter.', 'habitsFolder', '02 PROJECTS/Habits');
    text('Inbox note', 'Where quick captures land when they have no date and no project.', 'inboxNote', '01 INBOX/Inbox.md');
    new Setting(containerEl).setName('Never index these paths').setDesc('Comma-separated path prefixes — archives, old task boards. Keeps the Inbox and the index clean.').addText((t) => t.setValue(s.excludePaths.join(', ')).onChange(async (v) => { s.excludePaths = v.split(',').map((x) => x.trim()).filter(Boolean); await save(); }));
    new Setting(containerEl).setName('Extra folders to scan').setDesc('Comma-separated. Tasks in these notes show up under “Tasks in other notes” in the Inbox and can be planned onto a day.').addText((t) => t.setValue(s.extraFolders.join(', ')).onChange(async (v) => { s.extraFolders = v.split(',').map((x) => x.trim()).filter(Boolean); await save(); }));

    const dc = this.host.dailyConfig();
    new Setting(containerEl).setName('Daily notes').setHeading();
    new Setting(containerEl).setName('Daily note folder').setDesc(`Leave empty to follow the Daily Notes / Periodic Notes plugin (currently: ${dc.folder || 'not configured'}).`).addText((t) => t.setPlaceholder(dc.folder).setValue(s.dailyNoteFolder).onChange(async (v) => { s.dailyNoteFolder = v.trim(); await save(); }));
    new Setting(containerEl).setName('Daily note format').setDesc(`Moment-style date format of the note path inside the folder. Leave empty to follow Obsidian (currently: ${dc.format || 'YYYY-MM-DD'}).`).addText((t) => t.setPlaceholder(dc.format).setValue(s.dailyNoteFormat).onChange(async (v) => { s.dailyNoteFormat = v.trim(); await save(); }));
    new Setting(containerEl).setName('Daily note template').setDesc(`Used when Helm has to create a daily note. Leave empty to follow Obsidian (currently: ${dc.template || 'none'}). {{date:FORMAT}}, {{title}} and the common Templater tags are filled in.`).addText((t) => t.setPlaceholder(dc.template).setValue(s.dailyNoteTemplate).onChange(async (v) => { s.dailyNoteTemplate = v.trim(); await save(); }));
    new Setting(containerEl).setName('Plan heading').setDesc('The heading whose section Helm owns in a daily note. Sub-headings Habits / Morning / Afternoon / Evening / Anytime live under it. Nothing outside that section is touched.').addText((t) => t.setValue(s.planHeading).onChange(async (v) => { s.planHeading = v.trim() || '## Plan'; await save(); }));
    new Setting(containerEl).setName('Parts of the day').setDesc('When the morning ends and when the afternoon ends (HH:MM). Time-blocked lines fall into a part by their start time.').addText((t) => t.setPlaceholder('12:00').setValue(s.morningEnds).onChange(async (v) => { if (/^\d{2}:\d{2}$/.test(v.trim())) { s.morningEnds = v.trim(); await save(); } })).addText((t) => t.setPlaceholder('18:00').setValue(s.afternoonEnds).onChange(async (v) => { if (/^\d{2}:\d{2}$/.test(v.trim())) { s.afternoonEnds = v.trim(); await save(); } }));
    new Setting(containerEl).setName('Move spawned recurrences to their date').setDesc('When a recurring task is ticked, Obsidian Tasks writes its next occurrence in the same note, dated later. On, Helm moves such lines into the note of their date (same part of the day) as soon as it sees them — only for dates from today on; older ones are left for the “Move recurring tasks to their next date” command, which moves everything.').addToggle((t) => t.setValue(s.autoMoveRecurring).onChange(async (v) => { s.autoMoveRecurring = v; await save(); }));
    new Setting(containerEl).setName('Stamp ➕ created date on new tasks').setDesc('Off keeps daily notes clean; on gives every captured task an Obsidian-Tasks created date.').addToggle((t) => t.setValue(s.writeCreatedDate).onChange(async (v) => { s.writeCreatedDate = v; await save(); }));
    new Setting(containerEl).setName('Where the plan goes in a new daily note').setDesc('Only matters for a note that has no plan heading yet.').addDropdown((d) => d.addOptions({ 'before-first-heading': 'Before the first heading', 'after-anchor': 'After a heading of my choosing', end: 'At the end of the note' }).setValue(s.regionPlacement).onChange(async (v) => { s.regionPlacement = v as HelmSettings['regionPlacement']; await save(); this.display(); }));
    if (s.regionPlacement === 'after-anchor') text('Anchor heading', 'Exact heading text, e.g. “## Tasks”. Falls back to “before the first heading” when it is missing.', 'regionAnchor', '## Helm');
    new Setting(containerEl).setName('Show day-planner time blocks').setDesc('Checkbox lines like “- [ ] 08:00 - 09:00: …” outside the Helm region are shown on the Today tab as time blocks.').addToggle((t) => t.setValue(s.showTimeBlocks).onChange(async (v) => { s.showTimeBlocks = v; await save(); }));

    new Setting(containerEl).setName('Horizons — yearly, quarterly, monthly goals').setHeading();
    new Setting(containerEl).setName('Goals heading').setDesc('Heading in a yearly / quarterly / monthly note under which goals live as checkbox lines.').addText((t) => t.setValue(s.goalsHeading).onChange(async (v) => { s.goalsHeading = v.trim() || '## Goals'; await save(); }));
    for (const [kind, label, fk, fmk] of [['year', 'Yearly notes', 'yearlyFolder', 'yearlyFormat'], ['quarter', 'Quarterly notes', 'quarterlyFolder', 'quarterlyFormat'], ['month', 'Monthly notes', 'monthlyFolder', 'monthlyFormat'], ['week', 'Weekly notes', 'weeklyFolder', 'weeklyFormat']] as const) {
      const pc = this.host.periodicConfigFor(kind);
      new Setting(containerEl).setName(label).setDesc(`Folder and moment format. Leave empty to follow the Periodic Notes plugin (currently: ${pc.folder || 'not configured'} · ${pc.format || 'default'}).`)
        .addText((t) => t.setPlaceholder(pc.folder || 'folder').setValue(s[fk]).onChange(async (v) => { s[fk] = v.trim(); await save(); }))
        .addText((t) => t.setPlaceholder(pc.format || 'format').setValue(s[fmk]).onChange(async (v) => { s[fmk] = v.trim(); await save(); }));
    }

    new Setting(containerEl).setName('Planning').setHeading();
    new Setting(containerEl).setName('Daily capacity').setDesc('Minutes of focused work a day holds. Drives the capacity bar.').addSlider((sl) => sl.setLimits(60, 720, 30).setValue(s.dailyCapacityMinutes).setDynamicTooltip().onChange(async (v) => { s.dailyCapacityMinutes = v; await save(); }));
    new Setting(containerEl).setName('Default effort').setDesc('Minutes assumed for a task without a ⏱️ estimate.').addSlider((sl) => sl.setLimits(5, 120, 5).setValue(s.defaultEffortMinutes).setDynamicTooltip().onChange(async (v) => { s.defaultEffortMinutes = v; await save(); }));
    new Setting(containerEl).setName('Wrap-up default for unfinished tasks').addDropdown((d) => d.addOptions({ tomorrow: 'Move to tomorrow', unschedule: 'Take off the calendar' }).setValue(s.rolloverTarget).onChange(async (v) => { s.rolloverTarget = v as HelmSettings['rolloverTarget']; await save(); }));
    new Setting(containerEl).setName('Stale project after').setDesc('Days without activity before an active project is flagged in Review.').addSlider((sl) => sl.setLimits(3, 60, 1).setValue(s.staleProjectDays).setDynamicTooltip().onChange(async (v) => { s.staleProjectDays = v; await save(); }));
    new Setting(containerEl).setName('Week starts on').addDropdown((d) => d.addOptions({ '1': 'Monday', '7': 'Sunday' }).setValue(String(s.weekStartsOn)).onChange(async (v) => { s.weekStartsOn = Number(v) as 1 | 7; await save(); }));
    new Setting(containerEl).setName('Indent for new subtasks').addDropdown((d) => d.addOptions({ '\t': 'Tab', '  ': 'Two spaces', '    ': 'Four spaces' }).setValue(s.indentUnit).onChange(async (v) => { s.indentUnit = v; await save(); }));

    new Setting(containerEl).setName('View').setHeading();
    new Setting(containerEl).setName('Tab to open on').addDropdown((d) => d.addOptions({ today: 'Today', week: 'Week', projects: 'Projects', inbox: 'Inbox', review: 'Review', horizons: 'Horizons', dashboard: 'Dashboard' }).setValue(s.defaultTab).onChange(async (v) => { s.defaultTab = v as HelmSettings['defaultTab']; await save(); }));
    new Setting(containerEl).setName('Open Helm on startup').addToggle((t) => t.setValue(s.openOnStartup).onChange(async (v) => { s.openOnStartup = v; await save(); }));
    new Setting(containerEl).setName('Developer actions').setDesc('Adds the “Run self-test” command, which writes a report note into the vault. Off unless you are testing Helm.').addToggle((t) => t.setValue(s.developerActions).onChange(async (v) => { s.developerActions = v; await save(); }));
  }
}
