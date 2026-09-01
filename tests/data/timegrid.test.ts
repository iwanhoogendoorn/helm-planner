import { describe, expect, it } from 'vitest';
import { gridHours, layOutDay, snapToSlot, toHhmm, toneOf, windowOf } from '../../src/data/timegrid';
import { SETTINGS } from './fixture';
import type { Task } from '../../src/core/types';

const task = (text: string, time?: { start: string; end?: string }, extra: Partial<Task> = {}): Task => ({
  key: text, text, status: 'todo', path: 'x.md', line: 0, depth: 0, childKeys: [], tags: [], blockedBy: [],
  priority: 'normal', origin: 'daily', raw: { indent: '', line: '', eol: '\n' } as never,
  ...(time ? { time } : {}), ...extra,
} as unknown as Task);

describe('laying a day out as a grid', () => {
  it('splits timed work from everything else, and gives a box its length', () => {
    const d = layOutDay('2026-08-30', [task('Dinner', { start: '17:00', end: '19:30' }), task('Sort the drive'), task('Standup', { start: '09:00' }, { effortMinutes: 15 })], SETTINGS);
    expect(d.allDay.map((t) => t.text)).toEqual(['Sort the drive']);
    expect(d.timed.map((e) => [e.task.text, e.start, e.end])).toEqual([
      ['Standup', 540, 555],      // no end time: the effort says a quarter of an hour
      ['Dinner', 1020, 1170],
    ]);
    expect(windowOf(task('x'), SETTINGS)).toBeUndefined();
    // No effort either: the default estimate stands in.
    expect(windowOf(task('y', { start: '10:00' }), SETTINGS)!.end).toBe(600 + SETTINGS.defaultEffortMinutes);
  });

  it('puts overlapping boxes side by side, and keeps a cluster at one width', () => {
    const d = layOutDay('2026-08-30', [
      task('A', { start: '09:00', end: '10:00' }),
      task('B', { start: '09:30', end: '10:30' }),
      task('C', { start: '09:45', end: '11:00' }),
      task('Later', { start: '14:00', end: '15:00' }),
    ], SETTINGS);
    const by = Object.fromEntries(d.timed.map((e) => [e.task.text, e]));
    expect([by['A']!.column, by['B']!.column, by['C']!.column]).toEqual([0, 1, 2]);
    expect([by['A']!.columns, by['B']!.columns, by['C']!.columns]).toEqual([3, 3, 3]); // one width down the cluster
    expect([by['Later']!.column, by['Later']!.columns]).toEqual([0, 1]); // a new cluster starts full width
  });

  it('reuses a column once its box has finished', () => {
    const d = layOutDay('2026-08-30', [
      task('Morning', { start: '09:00', end: '10:00' }),
      task('Over both', { start: '09:30', end: '12:00' }),
      task('After', { start: '10:00', end: '11:00' }),
    ], SETTINGS);
    const by = Object.fromEntries(d.timed.map((e) => [e.task.text, e]));
    expect(by['After']!.column).toBe(0); // “Morning” has ended, so its column is free again
    expect(by['Over both']!.column).toBe(1);
  });

  it('shows the working day, stretched to cover anything outside it', () => {
    const quiet = layOutDay('2026-08-30', [], SETTINGS);
    expect(gridHours([quiet], SETTINGS)).toEqual({ from: 420, to: 1320 }); // 07:00 → 22:00, an hour of room above
    const early = layOutDay('2026-08-30', [task('Flight', { start: '05:15', end: '06:00' })], SETTINGS);
    expect(gridHours([early], SETTINGS).from).toBe(240); // 04:00, so the 05:15 box is not clipped
    const late = layOutDay('2026-08-30', [task('Party', { start: '22:30', end: '23:45' })], SETTINGS);
    expect(gridHours([late], SETTINGS).to).toBe(1440);
  });

  it('colours a box by where the work comes from', () => {
    expect(toneOf(task('Ring the plumber'))).toBe('task');
    expect(toneOf(task('#meeting Standup'))).toBe('meeting');
    expect(toneOf(task('Draft', undefined, { projectId: 'prj-book' }))).toBe('project');
    expect(toneOf(task('Done thing', undefined, { status: 'done' }))).toBe('done');
  });
});

describe('dropping on the grid', () => {
  const from = 7 * 60;                      // the grid starts at 07:00
  const to = 22 * 60;
  const at = (y: number, opts = {}): string => toHhmm(snapToSlot(y, from, to, { pxPerHour: 56, ...opts }));

  it('snaps to the quarter hour, from the top of the box', () => {
    expect(at(0)).toBe('07:00');
    expect(at(56)).toBe('08:00');            // one hour down
    expect(at(14)).toBe('07:15');            // a quarter is 14px
    expect(at(28)).toBe('07:30');
    expect(at(42)).toBe('07:45');
    // Anything in between goes to the nearest quarter, not the nearest hour.
    expect(at(20)).toBe('07:15');
    expect(at(24)).toBe('07:30');
    expect(at(45)).toBe('07:45');            // 48 minutes past → the 45 mark
    expect(at(50)).toBe('08:00');            // 54 minutes past → the hour
  });

  it('never lands above the grid or past its end', () => {
    expect(at(-40)).toBe('07:00');
    expect(at(10_000)).toBe('21:45');
    expect(at(10_000, { length: 60 })).toBe('21:00');   // an hour-long box still fits
  });
});
