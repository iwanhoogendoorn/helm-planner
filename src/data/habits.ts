/** Habit analytics: all computed from daily-note lines. */
import type { Habit, HabitCompletion, IsoDate } from '../core/types';
import { addDays, diffDays, startOfWeek } from '../core/dates';
import { occursOn } from '../core/recurrence';

export interface HabitStats {
  habit: Habit;
  dueToday: boolean;
  doneToday: boolean;
  streak: number;
  bestStreak: number;
  /** Done / scheduled over the last 7 and 30 days. */
  rate7: number;
  rate30: number;
  doneThisWeek: number;
  scheduledThisWeek: number;
  /** 12-week heat map, oldest first: 'done' | 'skipped' | 'missed' | 'off' | 'future'. */
  days: { date: IsoDate; state: 'done' | 'skipped' | 'missed' | 'off' | 'future' | 'pending' }[];
}

export function habitDue(h: Habit, date: IsoDate): boolean {
  return h.active && occursOn(h.schedule, date);
}

export function habitStats(h: Habit, completions: HabitCompletion[], today: IsoDate, weekStartsOn: 1 | 7 = 1, historyDays = 84): HabitStats {
  const byDate = new Map<IsoDate, HabitCompletion['state']>();
  for (const c of completions) if (c.habitId === h.id) byDate.set(c.date, c.state);

  const stateOn = (d: IsoDate): 'done' | 'skipped' | 'missed' | 'off' | 'future' | 'pending' => {
    if (d > today) return 'future';
    const rec = byDate.get(d);
    if (rec === 'done') return 'done';
    if (rec === 'skipped') return 'skipped';
    if (!habitDue(h, d)) return 'off';
    if (d === today) return 'pending';
    return 'missed';
  };

  const days: HabitStats['days'] = [];
  for (let i = historyDays - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    days.push({ date: d, state: stateOn(d) });
  }

  // Streak: walk back from today; today pending does not break it.
  let streak = 0;
  let misses = 0;
  for (let i = 0; i < 400; i++) {
    const d = addDays(today, -i);
    const s = stateOn(d);
    if (s === 'done') { streak++; misses = 0; continue; }
    if (s === 'off' || s === 'skipped' || s === 'pending') continue;
    misses++;
    if (misses > h.graceDays) break;
  }
  // Best streak over the history window (cheap, approximate to the window).
  let best = 0;
  let cur = 0;
  let m2 = 0;
  for (const d of days) {
    if (d.state === 'done') { cur++; m2 = 0; best = Math.max(best, cur); continue; }
    if (d.state === 'off' || d.state === 'skipped' || d.state === 'pending' || d.state === 'future') continue;
    m2++;
    if (m2 > h.graceDays) cur = 0;
  }
  const rate = (n: number): number => {
    let due = 0;
    let done = 0;
    for (let i = 0; i < n; i++) {
      const d = addDays(today, -i);
      if (!habitDue(h, d)) continue;
      due++;
      if (byDate.get(d) === 'done') done++;
    }
    return due === 0 ? 0 : done / due;
  };
  const ws = startOfWeek(today, weekStartsOn);
  let doneThisWeek = 0;
  let scheduledThisWeek = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    if (habitDue(h, d)) scheduledThisWeek++;
    if (byDate.get(d) === 'done') doneThisWeek++;
  }
  return {
    habit: h,
    dueToday: habitDue(h, today),
    doneToday: byDate.get(today) === 'done',
    streak, bestStreak: Math.max(best, streak),
    rate7: rate(7), rate30: rate(30),
    doneThisWeek, scheduledThisWeek: h.targetPerWeek ?? scheduledThisWeek,
    days,
  };
}

export function daysSince(a: IsoDate, b: IsoDate): number { return diffDays(a, b); }
