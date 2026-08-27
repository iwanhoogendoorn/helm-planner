import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';
import { parseHabit, renderHabitNote } from '../../src/core/habit';
import { habitStats, habitOccurrences } from '../../src/data/habits';
import { parseRecurrence } from '../../src/core/recurrence';
import type { Habit, HabitCompletion } from '../../src/core/types';

const MEDITATE = `---
title: Meditate
type: habit
id: hab-med
schedule: every day
active: true
grace_days: 0
parts: [morning, evening]
---
# Meditate
`;

describe('habits split over the day', () => {
  it('parses and renders parts, in day order, ignoring junk', () => {
    const h = parseHabit('02 PROJECTS/Habits/Meditate.md', MEDITATE)!;
    expect(h.parts).toEqual(['morning', 'evening']);
    expect(parseHabit('x.md', MEDITATE.replace('parts: [morning, evening]', 'part: evening'))!.parts).toEqual(['evening']);
    expect(parseHabit('x.md', MEDITATE.replace('parts: [morning, evening]', 'parts: [night, Evening, morning]'))!.parts).toEqual(['morning', 'evening']);
    expect(parseHabit('x.md', MEDITATE.replace('parts: [morning, evening]\n', ''))!.parts).toBeUndefined();
    expect(renderHabitNote({ id: 'hab-x', title: 'X', schedule: 'every day', parts: ['afternoon'], today: TODAY })).toContain('parts: [afternoon]');
    expect(habitOccurrences(h)).toEqual(['morning', 'evening']);
    expect(habitOccurrences({ ...h, parts: [] })).toEqual([undefined]);
  });

  it('stats fold the day: all ticks → done, some → partial, none → missed; rates and week counts are per occurrence', () => {
    const h: Habit = { id: 'hab-med', title: 'Meditate', path: 'x', schedule: parseRecurrence('every day'), active: true, graceDays: 0, parts: ['morning', 'evening'] };
    const c = (date: string, part: 'morning' | 'evening' | undefined, state: HabitCompletion['state']): HabitCompletion => ({ habitId: 'hab-med', date, path: 'd', line: 0, state, ...(part ? { part } : {}) });
    const comps = [c('2026-08-25', 'morning', 'done'), c('2026-08-25', 'evening', 'done'), c('2026-08-24', 'morning', 'done'), c('2026-08-24', 'evening', 'missed'), c('2026-08-23', 'morning', 'skipped'), c('2026-08-23', 'evening', 'done'), c(TODAY, 'morning', 'done')];
    const st = habitStats(h, comps, TODAY, 1, 7);
    const on = (d: string) => st.days.find((x) => x.date === d)!.state;
    expect(on('2026-08-25')).toBe('done');
    expect(on('2026-08-24')).toBe('partial');
    expect(on('2026-08-23')).toBe('done');      // skipped + done counts as done
    expect(on('2026-08-22')).toBe('missed');
    expect(on(TODAY)).toBe('pending');           // half done, day not over
    expect(st.today).toEqual([{ part: 'morning', state: 'done' }, { part: 'evening', state: 'pending' }]);
    expect(st.doneToday).toBe(false);
    expect(st.streak).toBe(1);                    // 25th done, 24th partial breaks it (grace 0)
    expect(st.doneThisWeek).toBe(4);              // Mon 24: 1, Tue 25: 2, Wed 26: 1 — Sun 23 is last week
    expect(st.scheduledThisWeek).toBe(14);
    // A single-part habit still accepts an old day-level tick.
    const single: Habit = { ...h, parts: ['morning'] };
    expect(habitStats(single, [c('2026-08-25', undefined, 'done')], TODAY, 1, 7).days.find((x) => x.date === '2026-08-25')!.state).toBe('done');
  });

  it('syncing a day writes one line at the top of each part; ticking a part only ticks that line; the index reads them as occurrences', async () => {
    const { m, vault, index } = await setup({ '02 PROJECTS/Habits/Meditate.md': MEDITATE });
    await m.syncHabitsForDay(TODAY);
    const note = await vault.read(dailyPath(TODAY));
    const section = (n: string, head: string): string => n.split(new RegExp(`\\n#{1,6} (?:[A-C]\\. )?${head}\\n`))[1]?.split(/\n#{1,6} /)[0] ?? '';
    expect(section(note, 'Morning')).toMatch(/- \[ \] Meditate 🆔 hab-med/);
    expect(section(note, 'Evening')).toMatch(/- \[ \] Meditate 🆔 hab-med/);
    expect(section(note, 'Afternoon')).not.toContain('hab-med');
    expect((note.match(/Meditate 🆔 hab-med/g) ?? []).length).toBe(2);
    expect(note.split('### Habits')[1]!.split('###')[0]).not.toContain('Meditate'); // not in the Habits section
    await m.setHabitState('hab-med', TODAY, 'done', 'morning');
    const after = await vault.read(dailyPath(TODAY));
    expect(after).toMatch(/- \[x\] Meditate 🆔 hab-med ✅ 2026-08-26/);
    expect((after.match(/- \[ \] Meditate 🆔 hab-med/g) ?? []).length).toBe(1);
    const occ = index.snapshot.completions.filter((c) => c.habitId === 'hab-med' && c.date === TODAY).map((c) => `${c.part}:${c.state}`).sort();
    expect(occ).toEqual(['evening:missed', 'morning:done']);
    expect(index.snapshot.tasks.has('hab-med')).toBe(false); // never a task
    // Syncing again does not duplicate.
    await m.syncHabitsForDay(TODAY);
    expect(((await vault.read(dailyPath(TODAY))).match(/hab-med/g) ?? []).length).toBe(2);
    // Editing the habit's parts through the API round-trips.
    await m.setHabitFields('hab-med', { parts: ['afternoon'] });
    expect(index.snapshot.habits.get('hab-med')!.parts).toEqual(['afternoon']);
    await m.setHabitFields('hab-med', { parts: [] });
    expect(index.snapshot.habits.get('hab-med')!.parts).toBeUndefined();
  });
});

describe('deleting a habit', () => {
  it('trashes the note and removes its lines from today, keeping yesterday’s record', async () => {
    const { m, vault, index } = await setup({ '02 PROJECTS/Habits/Meditate.md': MEDITATE });
    await m.syncHabitsForDay(TODAY);
    expect((await vault.read(dailyPath(TODAY))).includes('hab-med')).toBe(true);
    await m.deleteHabit('hab-med');
    expect(vault.trashed).toContain('02 PROJECTS/Habits/Meditate.md');
    expect(index.snapshot.habits.has('hab-med')).toBe(false);
    expect((await vault.read(dailyPath(TODAY))).includes('hab-med')).toBe(false);
    expect((await vault.read(dailyPath('2026-08-25'))).includes('hab-workout')).toBe(true); // other habits' records untouched
    await expect(m.deleteHabit('hab-nope')).rejects.toThrow(/Unknown habit/);
  });
});
