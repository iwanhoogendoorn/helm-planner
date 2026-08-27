/** Habit analytics: all computed from daily-note lines. */
import type { Habit, HabitCompletion, HabitPart, IsoDate } from '../core/types';
import { addDays, diffDays, startOfWeek } from '../core/dates';
import { occursOn } from '../core/recurrence';
import { periodOf, type Period, type PeriodKind } from '../core/periods';

/** The schedule and parts in force on a day: an earlier definition from `history`, else the current one. */
export function definitionAt(h: Habit, date: IsoDate): { schedule: Habit['schedule']; parts?: HabitPart[] } {
  if (h.history) for (const e of h.history) if (date <= e.until) return e;
  return h;
}

/** Inside a recorded pause span (an open span runs to forever). */
export function pausedOn(h: Habit, date: IsoDate): boolean {
  return (h.pauses ?? []).some((p) => date >= p.from && (p.to === undefined || date <= p.to));
}

export function habitDue(h: Habit, date: IsoDate): boolean {
  if (h.removed) return false;
  if (h.created !== undefined && date < h.created) return false;
  if (pausedOn(h, date)) return false;
  // Paused by hand (no span recorded): not due at all, as before spans existed.
  if (!h.active && !(h.pauses ?? []).some((p) => p.to === undefined)) return false;
  return occursOn(definitionAt(h, date).schedule, date);
}

/** The occurrences a habit has on a due day: one per part, or a single day-level one. `date` = as defined that day. */
export function habitOccurrences(h: Habit, date?: IsoDate): (HabitPart | undefined)[] {
  const parts = date === undefined ? h.parts : definitionAt(h, date).parts;
  return parts && parts.length > 0 ? parts : [undefined];
}

/** Habits whose note is gone but whose ticks still sit in daily notes, rebuilt from those lines. */
export function ghostHabits(habits: Map<string, Habit>, completions: HabitCompletion[]): Habit[] {
  const seen = new Map<string, { last: IsoDate; text?: string }>();
  for (const c of completions) {
    if (habits.has(c.habitId) || !c.habitId.startsWith('hab-')) continue;
    const cur = seen.get(c.habitId);
    if (!cur || c.date > cur.last) seen.set(c.habitId, { last: c.date, ...(c.text ?? cur?.text ? { text: c.text ?? cur?.text } : {}) });
  }
  return [...seen.entries()].map(([id, x]) => {
    const raw = (x.text ?? id).replace(/\s*🆔\s*\S+/, '').trim();
    const em = /^(\p{Extended_Pictographic}\uFE0F?)\s+(.+)$/u.exec(raw);
    return { id, title: em ? em[2]! : raw || id, ...(em ? { icon: em[1]! } : {}), path: '', schedule: { raw: 'every day', parsed: true, frequency: 'daily', interval: 1 }, active: false, graceDays: 0, removed: true } as Habit;
  }).sort((a, b) => a.title.localeCompare(b.title));
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

/** Per-occurrence and per-day state lookups for one habit, from its completions. */
function dayStates(h: Habit, completions: HabitCompletion[], today: IsoDate): { occ: (HabitPart | undefined)[]; occAt: (d: IsoDate) => (HabitPart | undefined)[]; stateOf: (d: IsoDate, part?: HabitPart) => HabitCompletion['state'] | undefined; stateOn: (d: IsoDate) => HabitDayState; first: IsoDate | undefined } {
  const occ = habitOccurrences(h);
  const occAt = (d: IsoDate): (HabitPart | undefined)[] => habitOccurrences(h, d);
  const key = (d: IsoDate, part?: HabitPart): string => `${d}|${part ?? ''}`;
  const rec = new Map<string, HabitCompletion['state']>();
  let first: IsoDate | undefined;
  for (const c of completions) if (c.habitId === h.id) { rec.set(key(c.date, c.part), c.state); if (first === undefined || c.date < first) first = c.date; }
  // A day-level tick also satisfies a parted habit's single remaining occurrence, and vice versa, so an old note still counts.
  const stateOf = (d: IsoDate, part?: HabitPart): HabitCompletion['state'] | undefined => rec.get(key(d, part)) ?? (part !== undefined && occAt(d).length === 1 ? rec.get(key(d)) : undefined);
  /** Fold the day's occurrences into one state. */
  const stateOn = (d: IsoDate): HabitDayState => {
    if (d > today) return 'future';
    const states = occAt(d).map((p) => stateOf(d, p));
    const done = states.filter((s) => s === 'done').length;
    const skipped = states.filter((s) => s === 'skipped').length;
    if (done > 0 && done + skipped === states.length) return 'done';
    if (skipped === states.length && skipped > 0) return 'skipped';
    if (!habitDue(h, d)) return done > 0 ? 'done' : 'off';
    if (done > 0) return d === today ? 'pending' : 'partial';
    return d === today ? 'pending' : 'missed';
  };
  return { occ, occAt, stateOf, stateOn, first };
}

export function habitStats(h: Habit, completions: HabitCompletion[], today: IsoDate, weekStartsOn: 1 | 7 = 1, historyDays = 84): HabitStats {
  const { occAt, stateOf, stateOn } = dayStates(h, completions, today);
  const occ = occAt(today);

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
      for (const p of occAt(d)) { due++; if (stateOf(d, p) === 'done') done++; }
    }
    return due === 0 ? 0 : done / due;
  };
  const ws = startOfWeek(today, weekStartsOn);
  let doneThisWeek = 0, scheduledThisWeek = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(ws, i);
    if (habitDue(h, d)) scheduledThisWeek += occAt(d).length;
    for (const p of occAt(d)) if (stateOf(d, p) === 'done') doneThisWeek++;
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

export interface HabitPeriodCell {
  period: Period;
  /** Occurrences due and done inside the period, up to today. A tick on an unscheduled day counts as due and done. */
  due: number;
  done: number;
  rate: number;
  /** `before` = the habit did not exist yet; `future` = the period has not started. */
  state: 'rated' | 'idle' | 'before' | 'future';
}

export interface HabitHistory {
  habit: Habit;
  /** First day the habit is tracked from: its creation date or its earliest tick. */
  from: IsoDate;
  cells: HabitPeriodCell[];
  due: number;
  done: number;
  rate: number;
  streak: number;
  bestStreak: number;
}

/** The first day worth tracking a habit from: its creation date, else its earliest tick, else twelve weeks back. */
export function habitStart(h: Habit, completions: HabitCompletion[], today: IsoDate): IsoDate {
  const { first } = dayStates(h, completions, today);
  const candidates = [h.created, first].filter((x): x is IsoDate => x !== undefined);
  return candidates.length ? candidates.sort()[0]! : addDays(today, -83);
}

/**
 * Every habit's record over its whole life, bucketed by week / month / quarter / year.
 * All habits share one column set so the rows line up; a habit's cells before its start are `before`.
 */
export function habitHistories(habits: Habit[], completions: HabitCompletion[], kind: PeriodKind, today: IsoDate): { periods: Period[]; rows: HabitHistory[] } {
  if (habits.length === 0) return { periods: [], rows: [] };
  const starts = new Map(habits.map((h) => [h.id, habitStart(h, completions, today)]));
  const from = [...starts.values()].sort()[0]!;
  const periods: Period[] = [];
  for (let p = periodOf(from, kind); p.start <= today; p = periodOf(addDays(p.end, 1), kind)) periods.push(p);
  const rows = habits.map((h) => {
    const { occAt, stateOf, stateOn } = dayStates(h, completions, today);
    const start = starts.get(h.id)!;
    let due = 0, done = 0;
    const cells = periods.map((period): HabitPeriodCell => {
      if (period.end < start) return { period, due: 0, done: 0, rate: 0, state: 'before' };
      let pd = 0, pn = 0;
      for (let d = period.start < start ? start : period.start; d <= period.end && d <= today; d = addDays(d, 1)) {
        const occ = occAt(d);
        const dn = occ.filter((part) => stateOf(d, part) === 'done').length;
        if (habitDue(h, d)) pd += occ.length; else pd += dn; // an unscheduled tick still counts, as a bonus
        pn += dn;
      }
      due += pd; done += pn;
      return { period, due: pd, done: pn, rate: pd ? Math.min(1, pn / pd) : 0, state: pd || pn ? 'rated' : 'idle' };
    });
    // Streaks over the whole life, same rules as the card (grace days tolerated).
    let streak = 0, misses = 0;
    for (let d = today; d >= start; d = addDays(d, -1)) {
      const s = stateOn(d);
      if (s === 'done') { streak++; misses = 0; continue; }
      if (s === 'off' || s === 'skipped' || s === 'pending') continue;
      if (++misses > h.graceDays) break;
    }
    let best = 0, cur = 0, m2 = 0;
    for (let d = start; d <= today; d = addDays(d, 1)) {
      const s = stateOn(d);
      if (s === 'done') { cur++; m2 = 0; best = Math.max(best, cur); continue; }
      if (s === 'off' || s === 'skipped' || s === 'pending') continue;
      if (++m2 > h.graceDays) cur = 0;
    }
    return { habit: h, from: start, cells, due, done, rate: due ? Math.min(1, done / due) : 0, streak, bestStreak: Math.max(best, streak) };
  });
  return { periods, rows };
}
