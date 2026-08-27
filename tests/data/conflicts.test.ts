import { describe, expect, it } from 'vitest';
import { setup, TODAY } from './fixture';
import { bookingsOn, conflictsFor, describeConflicts } from '../../src/data/conflicts';

describe('time conflicts', () => {
  it('lists what is booked on a day and finds overlaps, using the effort when there is no end time', async () => {
    const { index, settings, m } = await setup();
    await m.addTask({ text: 'Dentist', date: TODAY, fields: { time: { start: '10:00', end: '11:00' } } });
    await m.addTask({ text: 'Quick call', date: TODAY, fields: { time: { start: '14:00' }, effortMinutes: 15 } });
    const b = bookingsOn(index.snapshot, TODAY, settings);
    expect(b.map((x) => `${x.start}-${x.end} ${x.label}`)).toEqual(['10:00-11:00 Dentist', '14:00-14:15 Quick call']);
    expect(describeConflicts(conflictsFor(index.snapshot, TODAY, { start: '10:30', end: '11:30' }, settings))).toBe('10:00–11:00 Dentist');
    expect(conflictsFor(index.snapshot, TODAY, { start: '11:00', end: '12:00' }, settings)).toEqual([]);           // touching is fine
    expect(conflictsFor(index.snapshot, TODAY, { start: '09:45' }, settings, { effortMinutes: 30 }).map((c) => c.label)).toEqual(['Dentist']); // 09:45–10:15 by effort
    expect(conflictsFor(index.snapshot, TODAY, { start: '14:10' }, settings).map((c) => c.label)).toEqual(['Quick call']);
    const dentist = [...index.snapshot.tasks.values()].find((t) => t.text === 'Dentist')!;
    expect(conflictsFor(index.snapshot, TODAY, { start: '10:00', end: '11:00' }, settings, { excludeKeys: [dentist.key] })).toEqual([]); // editing itself
    expect(conflictsFor(index.snapshot, '2026-09-01', { start: '10:00', end: '11:00' }, settings)).toEqual([]);
  });
});
