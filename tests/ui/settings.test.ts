// @vitest-environment jsdom
/** The settings tab: nav sections, grouped panels, path chips, list editors, saving. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AbstractInputSuggest } from '../stubs/obsidian';
import { FakeApp } from '../stubs/fakeApp';
import { makeVault } from '../data/fixture';
import { DEFAULT_SETTINGS, type HelmSettings } from '../../src/core/types';
import { HelmSettingTab, NAV_SECTIONS, type SettingsHost } from '../../src/ui/settingsTab';

function make(over: Partial<HelmSettings> = {}) {
  const app = new FakeApp(makeVault());
  const host = {
    settings: { ...DEFAULT_SETTINGS, excludePaths: [...DEFAULT_SETTINGS.excludePaths], extraFolders: [], ...over },
    saveSettings: vi.fn(async () => undefined),
    loadSettings: vi.fn(async () => undefined),
    dailyConfig: () => ({ folder: '70 OBSIDIAN/70-06 Daily Notes', format: 'YYYY/MM - MMMM/WW/DD, dddd, MMM, YYYY', template: '70 OBSIDIAN/70-07 Templates/DAILY NOTE TEMPLATE.md' }),
    periodicConfigFor: () => ({ folder: '', format: '', template: '' }),
    onSettingsChanged: vi.fn(),
    today: () => '2026-08-26',
    apiStatus: () => ({ running: false }),
    restartApi: vi.fn(async () => undefined),
    newApiToken: () => 'test-token',
    templateInfo: async () => ({ source: 'built-in', exists: false }),
    templateTargetPath: (k: string) => `Templates/${k.toUpperCase()} NOTE TEMPLATE.md`,
    writeTemplate: vi.fn(async () => 'created'),
    createCurrentPeriodicNotes: vi.fn(async () => []),
    excalidrawFolderPath: () => '70 OBSIDIAN/70-02 Excalidraw',
    pluginStatus: (id: string) => (id === 'core:daily-notes' ? 'enabled' : id === 'templater-obsidian' ? 'disabled' : 'missing'),
    enablePlugin: vi.fn(async () => undefined),
    openPluginInstall: vi.fn(),
    dailyTemplatePath: () => '70 OBSIDIAN/70-07 Templates/DAILY NOTE TEMPLATE.md',
    dailyTemplateTarget: () => '70 OBSIDIAN/70-07 Templates/DAILY NOTE TEMPLATE.md',
    fileExists: async (p: string) => p.startsWith('02 PROJECTS') || p === '01 INBOX/Inbox.md',
    ensureFolder: vi.fn(async () => true),
    ensureInboxNote: vi.fn(async () => true),
    writeDailyTemplate: vi.fn(async () => 'created'),
    manifest: { version: '0.5.0', description: 'Plan the day from your notes.' },
  } as unknown as SettingsHost;
  const tab = new HelmSettingTab(app as never, host);
  tab.display();
  const root = tab.containerEl;
  const texts = (sel: string): string[] => [...root.querySelectorAll<HTMLElement>(sel)].map((e) => e.textContent?.trim() ?? '');
  const nav = (label: string): void => { const b = [...root.querySelectorAll<HTMLElement>('.helm-settings-nav-item')].find((e) => e.textContent?.trim() === label)!; b.click(); };
  return { app, host, tab, root, texts, nav };
}

beforeEach(() => { document.body.innerHTML = ''; AbstractInputSuggest.instances = []; });

describe('Settings tab', () => {
  it('has the shared shell: left nav with every section, grouped panels with icon, subtitle and chip', async () => {
    const { root, texts, nav } = make();
    expect(root.classList.contains('helm-settings')).toBe(true);
    expect(texts('.helm-settings-nav-item')).toEqual(NAV_SECTIONS.map((s) => s.label));
    expect(root.querySelector('.helm-settings-nav-item.is-active')!.textContent).toBe('Setup');
    nav('Folders');
    expect(texts('.helm-sgroup-title')).toEqual(['Where things live', 'What Helm scans']);
    expect(root.querySelector('.helm-sgroup-icon')!.getAttribute('data-icon')).toBe('folder');
    for (const s of NAV_SECTIONS) { nav(s.label); await new Promise((r) => setTimeout(r, 0)); expect(root.querySelector('.helm-settings-nav-item.is-active')!.textContent).toBe(s.label); expect(root.querySelectorAll('.helm-sgroup').length).toBeGreaterThan(0); }
  });

  it('path chips report whether a folder exists, and pickers are attached to path inputs', () => {
    const { root, nav } = make();
    nav('Folders');
    expect(root.querySelector('.helm-schip')!.textContent).toBe('found');
    expect(root.querySelector('.helm-schip')!.classList.contains('helm-schip-ok')).toBe(true);
    const missing = make({ projectsFolder: '99 NOPE' });
    missing.nav('Folders');
    expect(missing.root.querySelector('.helm-schip')!.textContent).toBe('not found');
    expect(AbstractInputSuggest.instances.length).toBeGreaterThan(0);
    const sugg = AbstractInputSuggest.instances[0] as unknown as { getSuggestions: (q: string) => string[] };
    expect(sugg.getSuggestions('habits')).toContain('02 PROJECTS/Habits');
  });

  it('typing a folder saves, re-indexes and updates the chip', async () => {
    const { root, host, nav } = make();
    nav('Folders');
    const input = root.querySelector<HTMLInputElement>('.helm-path-input')!;
    input.value = '99 NOPE'; input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(host.settings.projectsFolder).toBe('99 NOPE');
    expect(host.saveSettings).toHaveBeenCalled();
    expect(host.onSettingsChanged).toHaveBeenCalled();
    expect(root.querySelector('.helm-schip')!.textContent).toBe('not found');
  });

  it('excluded paths are chips you add with a picker and remove with a click', async () => {
    const { root, host, texts, nav } = make({ excludePaths: ['02 PROJECTS/ZZZ. Project Archive'] });
    nav('Folders');
    expect(texts('.helm-slist-text')).toEqual(['02 PROJECTS/ZZZ. Project Archive']);
    const add = root.querySelector<HTMLInputElement>('.helm-slist-add input')!;
    add.value = '80 ARCHIVE/'; add.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await new Promise((r) => setTimeout(r, 0));
    expect(host.settings.excludePaths).toEqual(['02 PROJECTS/ZZZ. Project Archive', '80 ARCHIVE']);
    expect(texts('.helm-slist-text')).toEqual(['02 PROJECTS/ZZZ. Project Archive', '80 ARCHIVE']);
    root.querySelector<HTMLButtonElement>('.helm-slist-remove')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(host.settings.excludePaths).toEqual(['80 ARCHIVE']);
    expect(root.querySelector('.helm-sgroup:nth-child(2) .helm-schip')!.textContent).toBe('1 excluded · 0 extra');
  });

  it('help toggles reveal the long explanation; daily notes chip follows Obsidian until overridden', () => {
    const { root, nav } = make();
    nav('Daily notes');
    expect(root.querySelector('.helm-schip')!.textContent).toBe('follows Obsidian');
    expect(root.querySelector('.helm-setting-note')!.textContent).toContain('70 OBSIDIAN/70-06 Daily Notes');
    const help = root.querySelector<HTMLElement>('[data-icon="help-circle"]')!;
    help.click();
    expect(root.querySelector('.helm-setting-help')).not.toBeNull();
    help.click();
    expect(root.querySelector('.helm-setting-help')).toBeNull();
    const custom = make({ dailyNoteFolder: 'Daily' }); custom.nav('Daily notes');
    expect(custom.root.querySelector('.helm-schip')!.textContent).toBe('custom');
  });

  it('about shows the version and reset restores defaults', async () => {
    const { root, host, nav } = make({ dailyCapacityMinutes: 90 });
    nav('About');
    expect(root.querySelector('.helm-sgroup-title')!.textContent).toBe('Helm 0.5.0');
    [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Reset')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(host.settings.dailyCapacityMinutes).toBe(DEFAULT_SETTINGS.dailyCapacityMinutes);
    expect(root.querySelector('.helm-settings-nav-item.is-active')!.textContent).toBe('Setup');
  });
});

describe('Setup section', () => {
  it('audits plugins, folders and templates with chips, offers Enable / Install / Create, and Fix everything runs the fixers', async () => {
    const { root, host, texts, nav } = make({ notesFolder: 'Notes', drawingsFolder: '' });
    nav('Setup');
    await new Promise((r) => setTimeout(r, 0));
    expect(texts('.helm-sgroup-title')).toEqual(['Setup', 'Companion plugins', 'Folders and notes', 'Templates']);
    const rows = [...root.querySelectorAll<HTMLElement>('.setting-item')];
    const row = (name: string) => rows.find((r) => r.querySelector('.setting-item-name')?.textContent?.startsWith(name))!;
    expect(row('Daily Notes (core)').querySelector('.helm-schip')!.textContent).toBe('enabled');
    expect(row('Templater').querySelector('.helm-schip')!.textContent).toBe('installed, disabled');
    expect(texts('.setting-item-control button').filter((t) => t === 'Enable')).toHaveLength(1);
    expect(row('Excalidraw').querySelector('.helm-schip')!.textContent).toBe('not installed (optional)');
    expect(row('Projects folder').querySelector('.helm-schip')!.textContent).toBe('found');
    expect(row('Notes folder').querySelector('.helm-schip')!.textContent).toBe('missing');
    expect(row('Daily note template').querySelector('.helm-schip')!.textContent).toBe('missing');
    expect(row('Yearly note template').querySelector('.helm-schip')!.textContent).toBe('built-in (not in vault)');
    const fixAll = [...root.querySelectorAll<HTMLButtonElement>('button')].find((b) => /^Fix \d+ items?$/.test(b.textContent ?? ''))!;
    expect(fixAll).toBeTruthy();
    fixAll.click();
    await new Promise((r) => setTimeout(r, 10));
    expect(host.enablePlugin).toHaveBeenCalledWith('templater-obsidian');
    expect(host.ensureFolder).toHaveBeenCalledWith('Notes');
    expect(host.writeDailyTemplate).toHaveBeenCalledWith(false);
    expect(host.writeTemplate).toHaveBeenCalledWith('year', false);
    expect(host.onSettingsChanged).toHaveBeenCalled();
  });
});
