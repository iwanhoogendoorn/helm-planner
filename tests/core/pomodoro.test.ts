import { describe, expect, it } from 'vitest';
import { DEFAULT_FOCUS, layOutDayPlan, splitFocus } from '../../src/core/pomodoro';

describe('cutting a task into stretches of work', () => {
  it('leaves a short task whole and splits a long one evenly', () => {
    expect(splitFocus(25, DEFAULT_FOCUS)).toEqual([25]);
    expect(splitFocus(50, DEFAULT_FOCUS)).toEqual([50]);
    expect(splitFocus(90, DEFAULT_FOCUS)).toEqual([45, 45]);        // two of the same, not 50 + 40
    expect(splitFocus(120, DEFAULT_FOCUS)).toEqual([40, 40, 40]);
    expect(splitFocus(150, DEFAULT_FOCUS)).toEqual([50, 50, 50]);
    // Never longer than the maximum, and the parts add up to the task.
    for (const total of [10, 35, 75, 100, 185, 240]) {
      const parts = splitFocus(total, DEFAULT_FOCUS);
      expect(Math.max(...parts)).toBeLessThanOrEqual(DEFAULT_FOCUS.focusMaxMinutes);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it('honours a different maximum', () => {
    expect(splitFocus(60, { ...DEFAULT_FOCUS, focusMaxMinutes: 25 })).toEqual([20, 20, 20]);   // three that fit, not two that do not
    expect(splitFocus(25, { ...DEFAULT_FOCUS, focusMaxMinutes: 25 })).toEqual([25]);
  });
});

describe('laying a day out', () => {
  const opts = { ...DEFAULT_FOCUS, from: '09:00', to: '17:00' };

  it('puts a break after every stretch, and a longer one after a few', () => {
    const out = layOutDayPlan([{ key: 'a', minutes: 30 }, { key: 'b', minutes: 30 }, { key: 'c', minutes: 30 }], opts);
    expect(out.blocks.map((b) => [b.kind, b.start, b.end])).toEqual([
      ['focus', '09:00', '09:30'], ['break', '09:30', '09:35'],
      ['focus', '09:35', '10:05'], ['break', '10:05', '10:10'],
      ['focus', '10:10', '10:40'], ['break', '10:40', '11:00'],   // the third break is the long one
    ]);
    expect(out.focusMinutes).toBe(90);
    expect(out.breakMinutes).toBe(30);
    expect(out.overflow).toEqual([]);
  });

  it('splits a long task and numbers the parts', () => {
    const out = layOutDayPlan([{ key: 'long', minutes: 90 }], opts);
    const focus = out.blocks.filter((b) => b.kind === 'focus');
    expect(focus.map((b) => [b.start, b.end, `${b.index} of ${b.of}`])).toEqual([
      ['09:00', '09:45', '1 of 2'],
      ['09:50', '10:35', '2 of 2'],
    ]);
  });

  it('works around what is already booked', () => {
    const out = layOutDayPlan([{ key: 'a', minutes: 45 }], { ...opts, busy: [{ start: '09:30', end: '10:30' }] });
    expect(out.blocks[0]).toMatchObject({ kind: 'focus', start: '10:30', end: '11:15' });   // after the meeting, not through it
    const clashes = out.blocks.filter((b) => b.start < '10:30' && b.end > '09:30');
    expect(clashes).toEqual([]);
  });

  it('hands back what does not fit instead of squeezing it in', () => {
    const out = layOutDayPlan([{ key: 'a', minutes: 120 }, { key: 'b', minutes: 120 }, { key: 'c', minutes: 60 }], { ...opts, from: '09:00', to: '12:00' });
    expect(out.overflow.map((t) => t.key)).toEqual(['b', 'c']);
    expect(out.blocks.every((b) => b.end <= '12:00')).toBe(true);
    expect(out.focusMinutes).toBe(120);
  });
});
