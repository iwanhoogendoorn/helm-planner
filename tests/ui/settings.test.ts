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
    templateInfo: async () => ({ source: 'built-in', exists: false }),
    templateTargetPath: (k: string) => `Templates/${k.toUpperCase()} NOTE TEMPLATE.md`,
    writeTemplate: vi.fn(async () => 'created'),
    createCurrentPeriodicNotes: vi.fn(async () => []),
    excalidrawFolderPath: () => '70 OBSIDIAN/70-02 Excalidraw',
    aiAvailable: () => true,
    aiPing: async () => 'OK',
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
  it('has the shared shell: left nav with every section, grouped panels with icon, subtitle and chip', () => {
    const { root, texts, nav } = make();
    expect(root.classList.contains('helm-settings')).toBe(true);
    expect(texts('.helm-settings-nav-item')).toEqual(NAV_SECTIONS.map((s) => s.label));
    expect(root.querySelector('.helm-settings-nav-item.is-active')!.textContent).toBe('Folders');
    expect(texts('.helm-sgroup-title')).toEqual(['Where things live', 'What Helm scans']);
    expect(root.querySelector('.helm-sgroup-icon')!.getAttribute('data-icon')).toBe('folder');
    for (const s of NAV_SECTIONS) { nav(s.label); expect(root.querySelector('.helm-settings-nav-item.is-active')!.textContent).toBe(s.label); expect(root.querySelectorAll('.helm-sgroup').length).toBeGreaterThan(0); }
  });

  it('path chips report whether a folder exists, and pickers are attached to path inputs', () => {
    const { root } = make();
    expect(root.querySelector('.helm-schip')!.textContent).toBe('found');
    expect(root.querySelector('.helm-schip')!.classList.contains('helm-schip-ok')).toBe(true);
    const missing = make({ projectsFolder: '99 NOPE' });
    expect(missing.root.querySelector('.helm-schip')!.textContent).toBe('not found');
    expect(AbstractInputSuggest.instances.length).toBeGreaterThan(0);
    const sugg = AbstractInputSuggest.instances[0] as unknown as { getSuggestions: (q: string) => string[] };
    expect(sugg.getSuggestions('habits')).toContain('02 PROJECTS/Habits');
  });

  it('typing a folder saves, re-indexes and updates the chip', async () => {
    const { root, host } = make();
    const input = root.querySelector<HTMLInputElement>('.helm-path-input')!;
    input.value = '99 NOPE'; input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 0));
    expect(host.settings.projectsFolder).toBe('99 NOPE');
    expect(host.saveSettings).toHaveBeenCalled();
    expect(host.onSettingsChanged).toHaveBeenCalled();
    expect(root.querySelector('.helm-schip')!.textContent).toBe('not found');
  });

  it('excluded paths are chips you add with a picker and remove with a click', async () => {
    const { root, host, texts } = make({ excludePaths: ['02 PROJECTS/ZZZ. Project Archive'] });
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
    expect(root.querySelector('.helm-settings-nav-item.is-active')!.textContent).toBe('Folders');
  });
});
