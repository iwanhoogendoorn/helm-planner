// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import * as real from '../../src/data/habits';
import { ctxFor } from './helpers';
import { renderToday } from '../../src/ui/tabs/today';
import { renderHabits, defaultHabitsState } from '../../src/ui/tabs/habits';
import { completionsOn, habitStats } from '../../src/ui/habitMemo';
import { TODAY } from '../data/fixture';

const calls: string[] = [];
vi.mock('../../src/data/habits', async (orig) => {
  const mod = await orig<typeof import('../../src/data/habits')>();
  return { ...mod, habitStats: (...a: Parameters<typeof mod.habitStats>) => { calls.push(`${a[0].id}|${a[4] ?? 84}`); return mod.habitStats(...a); } };
});

describe('F7 · habit statistics are worked out once per habit per render', () => {
  it('Today and Habits ask habitStats at most once per habit and history length', async () => {
    const { ctx, m } = await ctxFor();
    await m.setHabitState('hab-workout', TODAY, 'done');
    for (const draw of [(r: HTMLElement) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }), (r: HTMLElement) => renderHabits(ctx, r, defaultHabitsState())]) {
      calls.length = 0;
      draw(document.createElement('div'));
      draw(document.createElement('div'));                    // a second paint of the same snapshot
      expect(calls.length).toBeGreaterThan(0);
      expect(calls.length).toBe(new Set(calls).size);
    }
  });

  it('gives the same answers as the direct functions', async () => {
    const { index } = await ctxFor();
    const snap = index.snapshot;
    for (const hb of snap.habits.values()) {
      expect(habitStats(hb, snap.completions, TODAY, 1, 30)).toEqual(real.habitStats(hb, snap.completions, TODAY, 1, 30));
      expect(completionsOn(snap.completions, hb.id, TODAY)).toEqual(snap.completions.filter((c) => c.habitId === hb.id && c.date === TODAY));
    }
  });
});
