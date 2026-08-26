/** What every view and modal gets. Keeps the UI ignorant of the plugin class. */
import type { App } from 'obsidian';
import type { HelmSettings, IsoDate, Task } from '../core/types';
import type { HelmIndex } from '../data/index';
import type { Mutations } from '../data/mutations';

export type TabId = 'today' | 'week' | 'projects' | 'inbox' | 'review' | 'horizons' | 'dashboard';

export interface UiContext {
  app: App;
  index: HelmIndex;
  mutations: Mutations;
  settings: () => HelmSettings;
  saveSettings: (patch: Partial<HelmSettings>) => Promise<void>;
  today: () => IsoDate;
  /** Wall-clock time, HH:MM. */
  now: () => string;
  notify: (msg: string) => void;
  /** Open a note (optionally at a line) in the editor. */
  openFile: (path: string, line?: number) => Promise<void>;
  openLink: (target: string, fromPath?: string) => void;
  /** Ask the current view to re-render from the index. */
  refresh: () => void;
  /** Navigate the view: a tab, and optionally a date (today/week) or project (projects). */
  navigate: (tab: TabId, opts?: { date?: IsoDate; projectId?: string; periodKey?: string; scope?: 'week' | 'month' | 'quarter' | 'year' }) => void;
  /** Run a mutation with error handling and a refresh afterwards. */
  run: (label: string, fn: () => Promise<unknown>) => Promise<void>;
  /** Whether an AI command can be run here (desktop with the Claude CLI). */
  aiAvailable: boolean;
  /** A URL the renderer can load a vault image from. */
  resourceUrl: (path: string) => string | undefined;
  /** Register an open modal so the plugin can close it on unload (a reload must never leave a dead overlay). */
  trackModal: (m: { close: () => void; onClose?: () => void }) => void;
}

export function taskLabel(t: Task): string {
  return t.text.trim() === '' ? '(no text)' : t.text;
}
