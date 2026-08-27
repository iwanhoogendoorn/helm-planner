import { describe, expect, it } from 'vitest';
import { ghostHabits, habitHistories, habitStart } from '../../src/data/habits';
import { parseRecurrence } from '../../src/core/recurrence';
import type { Habit, HabitCompletion } from '../../src/core/types';

const TODAY = '2026-08-26'; // Wednesday
const workout: Habit = { id: 'hab-w', title: 'Workout', path: 'H/Workout.md', schedule: parseRecurrence('every weekday'), active: true, graceDays: 0, created: '2026-08-03' };
const read: Habit = { id: 'hab-r', title: 'Read', path: 'H/Read.md', schedule: parseRecurrence('every day'), active: true, graceDays: 1 };
const done = (habitId: string, date: string): HabitCompletion => ({ habitId, date, state: 'done' } as HabitCompletion);
const ticks = [done('hab-w', '2026-08-04'), done('hab-w', '2026-08-05'), done('hab-w', '2026-08-25'), done('hab-r', '2026-08-20'), done('hab-r', '2026-08-21'), done('hab-r', '2026-08-22')];

describe('all-time habit history', () => {
  it('starts at the creation date, else the first tick, else twelve weeks back', () => {
    expect(habitStart(workout, ticks, TODAY)).toBe('2026-08-03');
    expect(habitStart(read, ticks, TODAY)).toBe('2026-08-20');
    expect(habitStart({ ...read, id: 'hab-x' }, ticks, TODAY)).toBe('2026-06-04');
  });

  it('buckets due and done occurrences per week with shared columns; life-long streaks', () => {
    const { periods, rows } = habitHistories([workout, read], ticks, 'week', TODAY);
    expect(periods.map((p) => p.key)).toEqual(['2026-W32', '2026-W33', '2026-W34', '2026-W35']);
    const w = rows.find((r) => r.habit.id === 'hab-w')!;
    expect(w.cells.map((c) => `${c.done}/${c.due}`)).toEqual(['2/5', '0/5', '0/5', '1/3']);
    expect(w.cells[0]!.rate).toBeCloseTo(0.4);
    expect([w.due, w.done, w.rate]).toEqual([18, 3, 3 / 18]);
    expect(w.bestStreak).toBe(2);
    expect(w.streak).toBe(1); // yesterday's tick; Monday 24th was missed, no grace
    const r = rows.find((x) => x.habit.id === 'hab-r')!;
    expect(r.cells.map((c) => c.state)).toEqual(['before', 'before', 'rated', 'rated']);
    expect(r.cells.map((c) => `${c.done}/${c.due}`)).toEqual(['0/0', '0/0', '3/4', '0/3']);
    expect(r.bestStreak).toBe(3);
  });

  it('counts a tick on an unscheduled day (or while paused) as a bonus occurrence, never above 100%', () => {
    const { rows } = habitHistories([workout], [...ticks, done('hab-w', '2026-08-09')], 'week', TODAY); // a Sunday
    expect(rows[0]!.cells[0]!.due).toBe(6);
    expect(rows[0]!.cells[0]!.done).toBe(3);
    const paused = habitHistories([{ ...workout, active: false }], ticks, 'month', TODAY).rows[0]!;
    expect([paused.due, paused.done, paused.rate]).toEqual([3, 3, 1]);
  });

  it('buckets by month, quarter and year too', () => {
    for (const [kind, keys] of [['month', ['2026-08']], ['quarter', ['2026-Q3']], ['year', ['2026']]] as const) {
      const { periods, rows } = habitHistories([workout], ticks, kind, TODAY);
      expect(periods.map((p) => p.key)).toEqual(keys);
      expect(rows[0]!.cells.map((c) => `${c.done}/${c.due}`)).toEqual(['3/18']);
    }
  });
});

describe('changed, paused and removed habits', () => {
  const changed: Habit = { ...workout, id: 'hab-c', history: [{ until: '2026-08-16', schedule: parseRecurrence('every day') }], pauses: [{ from: '2026-08-10', to: '2026-08-12' }] };

  it('judges each day by the definition in force then, and skips paused spans', () => {
    const { rows } = habitHistories([changed], [], 'week', TODAY);
    // W33 (10–16 Aug): daily, but 10–12 paused → 4 due. W34 (17–23): weekdays → 5. W35: Mon–Wed → 3.
    expect(rows[0]!.cells.map((c) => c.due)).toEqual([7, 4, 5, 3]);
    expect(rows[0]!.cells[0]!.period.key).toBe('2026-W32');
  });

  it('a hand-paused habit without spans is never due; an open span pauses from its start', () => {
    const { rows } = habitHistories([{ ...workout, id: 'hab-p', active: false, pauses: [{ from: '2026-08-24' }] }], [done('hab-p', '2026-08-04')], 'week', TODAY);
    expect(rows[0]!.cells.map((c) => c.due)).toEqual([5, 5, 5, 0]);
    expect(habitHistories([{ ...workout, id: 'hab-q', active: false }], [], 'week', TODAY).rows[0]!.due).toBe(0);
  });

  it('rebuilds removed habits from the ticks left in daily notes', () => {
    const gone = [{ habitId: 'hab-gone', date: '2026-08-05', state: 'done', text: '🧘 Meditate 🆔 hab-gone' }, { habitId: 'hab-gone', date: '2026-08-06', state: 'done', text: '🧘 Meditate 🆔 hab-gone' }] as unknown as HabitCompletion[];
    const ghosts = ghostHabits(new Map([[workout.id, workout], [read.id, read]]), [...ticks, ...gone]);
    expect(ghosts).toHaveLength(1);
    expect(ghosts[0]).toMatchObject({ id: 'hab-gone', title: 'Meditate', icon: '🧘', active: false, removed: true });
    const { rows } = habitHistories(ghosts, gone, 'month', TODAY);
    expect(rows[0]!.from).toBe('2026-08-05');
    expect([rows[0]!.due, rows[0]!.done, rows[0]!.rate]).toEqual([2, 2, 1]);
  });
});
