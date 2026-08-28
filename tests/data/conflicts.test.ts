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

describe('free slots', () => {
  it('gives each part of the day its own window', async () => {
    const { partWindow } = await import('../../src/data/conflicts');
    const { SETTINGS } = await import('./fixture');
    expect(partWindow('morning', SETTINGS)).toEqual({ from: '08:00', to: '12:00' });
    expect(partWindow('afternoon', SETTINGS)).toEqual({ from: '12:00', to: '18:00' });
    expect(partWindow('evening', SETTINGS)).toEqual({ from: '18:00', to: '22:00' });
    expect(partWindow('anytime', SETTINGS)).toEqual({ from: '08:00', to: '22:00' });
  });

  it('finds the first gap that fits, skipping what is booked and the past', async () => {
    const { setup, TODAY } = await import('./fixture');
    const { freeSlotOn } = await import('../../src/data/conflicts');
    const { m, index, settings } = await setup();
    const free = (o: Parameters<typeof freeSlotOn>[3]): string | undefined => freeSlotOn(index.snapshot, TODAY, settings, o);
    expect(free({ part: 'evening', effortMinutes: 30 })).toBe('18:00'); // empty evening starts at its beginning
    await m.addTask({ text: 'Dinner', date: TODAY, fields: { time: { start: '18:00', end: '19:00' } } });
    await m.addTask({ text: 'Call', date: TODAY, fields: { time: { start: '19:00', end: '19:20' } } });
    expect(free({ part: 'evening', effortMinutes: 30 })).toBe('19:20'); // right after the last one
    expect(free({ part: 'evening', effortMinutes: 30, notBefore: '20:00' })).toBe('20:00');
    expect(free({ part: 'morning', effortMinutes: 60 })).toBe('08:00'); // other parts are untouched
    await m.addTask({ text: 'Late', date: TODAY, fields: { time: { start: '19:20', end: '21:50' } } });
    expect(free({ part: 'evening', effortMinutes: 30 })).toBeUndefined(); // 21:50 + 30m runs past 22:00
    expect(free({ effortMinutes: 30 })).toBe('08:00'); // the whole day still has room
  });
});
