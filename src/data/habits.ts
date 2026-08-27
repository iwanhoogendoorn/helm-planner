/** Habit analytics: all computed from daily-note lines. */
import type { Habit, HabitCompletion, HabitPart, IsoDate } from '../core/types';
import { addDays, diffDays, startOfWeek } from '../core/dates';
import { occursOn } from '../core/recurrence';

export function habitDue(h: Habit, date: IsoDate): boolean {
  return h.active && occursOn(h.schedule, date);
}

/** The occurrences a habit has on a due day: one per part, or a single day-level one. */
export function habitOccurrences(h: Habit): (HabitPart | undefined)[] {
  return h.parts && h.parts.length > 0 ? h.parts : [undefined];
}

export type HabitDayState = 'done' | 'partial' | 'skipped' | 'missed' | 'off' | 'future' | 'pending';

export interface HabitStats {
  habit: Habit;
  dueToday: boolean;
  doneToday: boolean;
  /** Today's occurrences and their state, in part order. */
  today: { part?: HabitPart; state: 'done' | 'skipped' | 'missed' | 'pending' }[];
  streak: number;
  bestStreak: number;
  /** Done / scheduled occurrences over the last 7 and 30 days. */
  rate7: number;
  rate30: number;
  doneThisWeek: number;
  scheduledThisWeek: number;
  /** 12-week heat map, oldest first. */
  days: { date: IsoDate; state: HabitDayState }[];
}

export function habitStats(h: Habit, completions: HabitCompletion[], today: IsoDate, weekStartsOn: 1 | 7 = 1, historyDays = 84): HabitStats {
  const occ = habitOccurrences(h);
  const key = (d: IsoDate, part?: HabitPart): string => `${d}|${part ?? ''}`;
  const rec = new Map<string, HabitCompletion['state']>();
  for (const c of completions) if (c.habitId === h.id) rec.set(key(c.date, c.part), c.state);
  // A day-level tick also satisfies a parted habit's single remaining occurrence, and vice versa, so an old note still counts.
  const stateOf = (d: IsoDate, part?: HabitPart): HabitCompletion['state'] | undefined => rec.get(key(d, part)) ?? (part !== undefined && occ.length === 1 ? rec.get(key(d)) : undefined);

  /** Fold the day's occurrences into one state. */
  const stateOn = (d: IsoDate): HabitDayState => {
    if (d > today) return 'future';
    const states = occ.map((p) => stateOf(d, p));
    const done = states.filter((s) => s === 'done').length;
    const skipped = states.filter((s) => s === 'skipped').length;
    if (done > 0 && done + skipped === states.length) return 'done';
    if (skipped === states.length && skipped > 0) return 'skipped';
    if (!habitDue(h, d)) return done > 0 ? 'done' : 'off';
    if (done > 0) return d === today ? 'pending' : 'partial';
    return d === today ? 'pending' : 'missed';
  };

  const days: HabitStats['days'] = [];
  for (let i = historyDays - 1; i >= 0; i--) { const d = addDays(today, -i); days.push({ date: d, state: stateOn(d) }); }

  let streak = 0;
  let misses = 0;
  for (let i = 0; i < 400; i++) {
    const s = stateOn(addDays(today, -i));
    if (s === 'done') { streak++; misses = 0; continue; }
    if (s === 'off' || s === 'skipped' || s === 'pending') continue;
    misses++;
    if (misses > h.graceDays) break;
  }
  let best = 0, cur = 0, m2 = 0;
  for (const d of days) {
    if (d.state === 'done') { cur++; m2 = 0; best = Math.max(best, cur); continue; }
    if (d.state === 'off' || d.state === 'skipped' || d.state === 'pending' || d.state === 'future') continue;
    m2++;
    if (m2 > h.graceDays) cur = 0;
  }
  const rate = (n: number): number => {
    let due = 0, done = 0;
    for (let i = 0; i < n; i++) {
      const d = addDays(today, -i);
      if (!habitDue(h, d)) continue;
      for (const p of occ) { due++; if (stateOf(d, p) === 'done') done++; }
    }
    return due === 0 ? 0 : done / due;
  };
  const ws = startOfWeek(today, weekStartsOn);
  let doneThisWeek = 0, scheduledThisWeek = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    if (habitDue(h, d)) scheduledThisWeek += occ.length;
    for (const p of occ) if (stateOf(d, p) === 'done') doneThisWeek++;
  }
  const todayOcc = occ.map((part) => { const s = stateOf(today, part); return { ...(part ? { part } : {}), state: (s ?? 'pending') as 'done' | 'skipped' | 'missed' | 'pending' }; });
  return {
    habit: h,
    dueToday: habitDue(h, today),
    doneToday: stateOn(today) === 'done',
    today: todayOcc,
    streak, bestStreak: Math.max(best, streak),
    rate7: rate(7), rate30: rate(30),
    doneThisWeek, scheduledThisWeek: h.targetPerWeek !== undefined ? h.targetPerWeek * occ.length : scheduledThisWeek,
    days,
  };
}

export function daysSince(a: IsoDate, b: IsoDate): number { return diffDays(a, b); }
