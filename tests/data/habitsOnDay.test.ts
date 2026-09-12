import { describe, expect, it } from 'vitest';
import { setup } from './fixture';
import { habitsOnDay } from '../../src/data/habits';

describe('habitsOnDay', () => {
  it('lists the habits due on a day, or ticked that day, with one occurrence each and its state', async () => {
    const { index } = await setup();
    const snap = index.snapshot;
    const rows = habitsOnDay(index.allHabits(), snap.completions, '2026-08-25');
    expect(rows.map((r) => r.habit.id).sort()).toEqual(['hab-read', 'hab-workout']);
    const workout = rows.find((r) => r.habit.id === 'hab-workout')!;
    expect(workout.due).toBe(true);
    expect(workout.occurrences).toEqual([{ state: 'done', line: expect.any(Number), path: expect.stringContaining('25, Tuesday') }]);
    const read = rows.find((r) => r.habit.id === 'hab-read')!;
    expect(read.occurrences).toEqual([{ state: 'pending' }]);
    // A weekday habit is off on Saturday; the daily one is still there.
    expect(habitsOnDay(index.allHabits(), snap.completions, '2026-08-29').map((r) => r.habit.id)).toEqual(['hab-read']);
  });

  it('gives a parted habit one occurrence per part, ticked where its line sits', async () => {
    const { index, m } = await setup({ '02 PROJECTS/Habits/Stretch.md': '---\ntype: habit\nid: hab-stretch\ntitle: Stretch\nschedule: every day\nparts:\n  - morning\n  - evening\n---\n' });
    await m.setHabitState('hab-stretch', '2026-08-26', 'done', 'morning');
    const row = habitsOnDay(index.allHabits(), index.snapshot.completions, '2026-08-26').find((r) => r.habit.id === 'hab-stretch')!;
    expect(row.occurrences.map((o) => [o.part, o.state])).toEqual([['morning', 'done'], ['evening', 'pending']]);
  });
});
