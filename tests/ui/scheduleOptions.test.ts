import { describe, expect, it } from 'vitest';
import { scheduleOptions } from '../../src/ui/menus';
import type { IsoDate } from '../../src/core/types';

const labels = (today: string, weekStartsOn: 1 | 7 = 1): string[] => scheduleOptions(today as IsoDate, weekStartsOn).map((o) => o.label);

describe('scheduleOptions', () => {
  it('names the rest of this week after tomorrow', () => {
    expect(labels('2026-09-28')).toEqual(['Today', 'Tomorrow', 'Wednesday 30 Sep', 'Thursday 1 Oct', 'Friday 2 Oct', 'Saturday 3 Oct', 'Sunday 4 Oct', 'Next week (Mon 5 Oct)', 'Pick a date…', 'Unschedule']);
  });
  it('late in the week lists only the days left', () => {
    expect(labels('2026-10-02')).toEqual(['Today', 'Tomorrow', 'Sunday 4 Oct', 'Next week (Mon 5 Oct)', 'Pick a date…', 'Unschedule']);
  });
  it('on the last day, tomorrow is next week and is offered once', () => {
    expect(labels('2026-10-04')).toEqual(['Today', 'Tomorrow', 'Pick a date…', 'Unschedule']);
  });
  it('follows a week that starts on Sunday', () => {
    expect(labels('2026-10-02', 7)).toEqual(['Today', 'Tomorrow', 'Next week (Sun 4 Oct)', 'Pick a date…', 'Unschedule']);
  });
});
