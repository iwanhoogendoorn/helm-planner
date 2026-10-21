// @vitest-environment jsdom
/** Regression tests for the UI review findings (REVIEW-ui.md), one describe per finding. */
import { beforeEach, describe, expect, it } from 'vitest';
import { Modal, Notice } from '../stubs/obsidian';
import { setup, TODAY } from '../data/fixture';
import type { UiContext } from '../../src/ui/context';
import { taskList } from '../../src/ui/taskRow';
import { followsOf as slowFollows, followUpsOf as slowUps } from '../../src/data/planner';
import { followsOf, followUpsOf } from '../../src/ui/taskLinks';
import { selection } from '../../src/ui/selection';
import { clearFolds } from '../../src/ui/fold';

/* eslint-disable @typescript-eslint/no-explicit-any */

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

beforeEach(() => { document.body.innerHTML = ''; Notice.messages = []; Modal.last = undefined; selection.clear(); clearFolds(); });

describe('F1 · follow-up lookups are built once per snapshot', () => {
  it('gives the same answers as the linear scans', async () => {
    const { ctx, m, index } = await ctxFor();
    await m.followUp('tsk-0002', { date: TODAY });
    await m.followUp('tsk-0002', { date: '2026-09-01' });
    const snap = index.snapshot;
    for (const t of snap.tasks.values()) {
      expect(followsOf(snap, t)).toBe(slowFollows(snap, t));
      expect(followUpsOf(snap, t)).toEqual(slowUps(snap, t));
    }
    expect(followUpsOf(snap, index.taskById('tsk-0002')!)).toHaveLength(2);
    void ctx;
  });

  it('does not walk every task once per row when a list renders', async () => {
    const { ctx, index } = await ctxFor();
    const snap = index.snapshot;
    const all = [...snap.tasks.values()];
    let walks = 0;
    const values = snap.tasks.values.bind(snap.tasks);
    (snap.tasks as any).values = () => { walks++; return values(); };
    const rows = [...all, ...all, ...all];      // enough rows that a per-row scan shows
    taskList(ctx, rows);
    expect(walks).toBeLessThanOrEqual(1);
  });
});
