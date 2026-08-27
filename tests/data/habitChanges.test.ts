import { describe, expect, it } from 'vitest';
import { setup } from './fixture';
import { parseHabit } from '../../src/core/habit';

describe('editing a habit records its history in the note', () => {
  it('closes the old definition at yesterday when the schedule or parts change; pausing and resuming write spans', async () => {
    const { m, vault, index } = await setup();
    const path = '02 PROJECTS/Habits/Morning workout.md';
    await m.setHabitFields('hab-workout', { title: 'Morning workout' }); // no change → no history
    expect(await vault.read(path)).not.toContain('history:');
    await m.setHabitFields('hab-workout', { schedule: 'every day', parts: ['morning', 'evening'] });
    const c1 = await vault.read(path);
    expect(c1).toContain('history:\n  - 2026-08-25 every weekday\n');
    expect(c1).toContain('schedule: every day');
    const h1 = parseHabit(path, c1)!;
    expect(h1.history).toEqual([{ until: '2026-08-25', schedule: expect.objectContaining({ raw: 'every weekday', parsed: true }) }]);
    await m.setHabitFields('hab-workout', { schedule: 'every 2 days' });
    const h2 = parseHabit(path, await vault.read(path))!;
    expect(h2.history!.map((e) => `${e.until} ${e.schedule.raw} ${e.parts?.join(',') ?? ''}`)).toEqual(['2026-08-25 every weekday ', '2026-08-25 every day morning,evening']);
    await m.setHabitFields('hab-workout', { active: false });
    expect(await vault.read(path)).toContain('paused:\n  - 2026-08-26..\n');
    expect(index.snapshot.habits.get('hab-workout')!.pauses).toEqual([{ from: '2026-08-26' }]);
    await m.setHabitFields('hab-workout', { active: true }); // same day → span dropped
    expect(await vault.read(path)).not.toContain('paused:');
    expect(index.snapshot.habits.get('hab-workout')!.pauses).toBeUndefined();
  });
});
