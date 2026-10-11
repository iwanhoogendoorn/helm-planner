import { describe, expect, it } from 'vitest';
import { scheduleOptions } from '../../src/ui/menus';
import type { IsoDate } from '../../src/core/types';

/** The menu as it reads, with `—` where a line marks the start of next week. */
const labels = (today: string, weekStartsOn: 1 | 7 = 1): string[] => scheduleOptions(today as IsoDate, weekStartsOn).flatMap((o) => (o.weekBreak ? ['—', o.label] : [o.label]));

describe('scheduleOptions', () => {
  it('on a Monday: the rest of the week by name, then next week', () => {
    expect(labels('2026-09-28')).toEqual(['Today', 'Tomorrow', 'Wednesday 30 Sep', 'Thursday 1 Oct', 'Friday 2 Oct', 'Saturday 3 Oct', 'Sunday 4 Oct', '—', 'Next week (Mon 5 Oct)', 'Pick a date…', 'Unschedule']);
  });
  it('late in the week: a rolling six days, running into next week past a line', () => {
    expect(labels('2026-10-02')).toEqual(['Today', 'Tomorrow', 'Sunday 4 Oct', '—', 'Monday 5 Oct', 'Tuesday 6 Oct', 'Wednesday 7 Oct', 'Thursday 8 Oct', 'Pick a date…', 'Unschedule']);
  });
  it('on a Sunday the list does not run dry: tomorrow starts next week, and the days after it follow', () => {
    expect(labels('2026-10-11')).toEqual(['Today', '—', 'Tomorrow', 'Tuesday 13 Oct', 'Wednesday 14 Oct', 'Thursday 15 Oct', 'Friday 16 Oct', 'Saturday 17 Oct', 'Pick a date…', 'Unschedule']);
  });
  it('follows a week that starts on Sunday', () => {
    expect(labels('2026-10-02', 7)).toEqual(['Today', 'Tomorrow', '—', 'Sunday 4 Oct', 'Monday 5 Oct', 'Tuesday 6 Oct', 'Wednesday 7 Oct', 'Thursday 8 Oct', 'Pick a date…', 'Unschedule']);
    expect(labels('2026-10-04', 7)).toEqual(['Today', 'Tomorrow', 'Tuesday 6 Oct', 'Wednesday 7 Oct', 'Thursday 8 Oct', 'Friday 9 Oct', 'Saturday 10 Oct', '—', 'Next week (Sun 11 Oct)', 'Pick a date…', 'Unschedule']);
  });
});
