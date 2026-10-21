/**
 * Habit numbers for a render, worked out once. `habitStats` walks up to 84 days of history over every
 * completion, and Today, Habits and the cards each asked again per tile, per chip and per day-part.
 * Results are kept against the completions array they came from: the index builds a new one with each
 * snapshot, so a stale answer cannot outlive the data. Same inputs, same answer — it is a pure function.
 */
import type { Habit, HabitCompletion, IsoDate } from '../core/types';
import { habitStats as computeStats, type HabitStats } from '../data/habits';

const stats = new WeakMap<HabitCompletion[], WeakMap<Habit, Map<string, HabitStats>>>();

export function habitStats(h: Habit, completions: HabitCompletion[], today: IsoDate, weekStartsOn: 1 | 7 = 1, historyDays = 84): HabitStats {
  let byHabit = stats.get(completions);
  if (!byHabit) { byHabit = new WeakMap(); stats.set(completions, byHabit); }
  let byArgs = byHabit.get(h);
  if (!byArgs) { byArgs = new Map(); byHabit.set(h, byArgs); }
  const k = `${today}|${weekStartsOn}|${historyDays}`;
  let st = byArgs.get(k);
  if (!st) { st = computeStats(h, completions, today, weekStartsOn, historyDays); byArgs.set(k, st); }
  return st;
}

const byDay = new WeakMap<HabitCompletion[], Map<string, HabitCompletion[]>>();

/** The completions of one habit on one day, from an index built once per completions array. */
export function completionsOn(completions: HabitCompletion[], habitId: string, date: IsoDate): HabitCompletion[] {
  let m = byDay.get(completions);
  if (!m) {
    m = new Map();
    for (const c of completions) {
      const k = `${c.habitId}|${c.date}`;
      const list = m.get(k);
      if (list) list.push(c); else m.set(k, [c]);
    }
    byDay.set(completions, m);
  }
  return m.get(`${habitId}|${date}`) ?? [];
}
