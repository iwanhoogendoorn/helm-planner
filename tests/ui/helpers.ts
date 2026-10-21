import { Notice } from '../stubs/obsidian';
import { setup, TODAY } from '../data/fixture';
import type { UiContext } from '../../src/ui/context';

/** A UI context over the test fixture; `over` replaces any of its members. */
export async function ctxFor(extra?: Record<string, string>, over: Partial<UiContext> = {}) {
  const s = await setup(extra);
  const ctx: UiContext = {
    app: { vault: { adapter: { exists: async () => true } } } as never,
    index: s.index, mutations: s.m, settings: () => s.settings, saveSettings: async () => undefined,
    today: () => TODAY, now: () => '14:37', notify: (m) => { new Notice(m); },
    openFile: async () => undefined, openLink: () => undefined, refresh: () => undefined, navigate: () => undefined,
    run: async (_l, fn) => { await fn(); }, trackModal: () => undefined, resourceUrl: (p) => `app://${p}`,
    ...over,
  };
  return { ...s, ctx };
}
