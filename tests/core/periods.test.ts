import { describe, expect, it } from 'vitest';
import { comparePeriods, formatPeriod, monthPeriod, parsePeriod, parsePeriodFromPath, periodContains, periodOf, periodWithin, periodsOfYear, quarterPeriod, yearPeriod } from '../../src/core/periods';

describe('periods', () => {
  it('parses every spelling', () => {
    expect(parsePeriod('2026')).toMatchObject({ kind: 'year', key: '2026', start: '2026-01-01', end: '2026-12-31' });
    expect(parsePeriod('2026-Q3')).toMatchObject({ kind: 'quarter', key: '2026-Q3', start: '2026-07-01', end: '2026-09-30', label: 'Q3 2026' });
    expect(parsePeriod('Q3 2026')?.key).toBe('2026-Q3');
    expect(parsePeriod('2026q1')?.key).toBe('2026-Q1');
    expect(parsePeriod('2026-08')).toMatchObject({ kind: 'month', key: '2026-08', start: '2026-08-01', end: '2026-08-31', label: 'August 2026' });
    expect(parsePeriod('08-2026')?.key).toBe('2026-08');
    expect(parsePeriod('Aug 2026')?.key).toBe('2026-08');
    expect(parsePeriod('August 2026')?.key).toBe('2026-08');
    expect(parsePeriod('[[2026-Q3]]')?.key).toBe('2026-Q3');
    expect(parsePeriod('2026-08-15')?.key).toBe('2026-08');
    expect(parsePeriod('soon')).toBeUndefined();
    expect(parsePeriod('2026-13')).toBeUndefined();
  });
  it('containment and order', () => {
    expect(periodOf('2026-08-26', 'quarter').key).toBe('2026-Q3');
    expect(periodContains(quarterPeriod(2026, 3), '2026-09-30')).toBe(true);
    expect(periodContains(quarterPeriod(2026, 3), '2026-10-01')).toBe(false);
    expect(periodWithin(monthPeriod(2026, 8), quarterPeriod(2026, 3))).toBe(true);
    expect(periodWithin(quarterPeriod(2026, 3), yearPeriod(2026))).toBe(true);
    expect(periodWithin(quarterPeriod(2026, 4), monthPeriod(2026, 8))).toBe(false);
    expect([monthPeriod(2026, 1), yearPeriod(2026), quarterPeriod(2026, 1)].sort(comparePeriods).map((p) => p.key)).toEqual(['2026', '2026-Q1', '2026-01']);
    expect(periodsOfYear(2026).months).toHaveLength(12);
  });
  it('periodic-note names round trip', () => {
    expect(formatPeriod(yearPeriod(2026), 'YYYY')).toBe('2026');
    expect(formatPeriod(quarterPeriod(2026, 3), 'YYYY-[Q]Q')).toBe('2026-Q3');
    expect(formatPeriod(monthPeriod(2026, 8), 'YYYY-MM')).toBe('2026-08');
    expect(formatPeriod(monthPeriod(2026, 8), 'MMMM YYYY')).toBe('August 2026');
    expect(parsePeriodFromPath('Yearly/2026', 'YYYY', 'year')?.key).toBe('2026');
    expect(parsePeriodFromPath('Q/2026-Q3', 'YYYY-[Q]Q', 'quarter')?.key).toBe('2026-Q3');
    expect(parsePeriodFromPath('M/2026-08', 'YYYY-MM', 'month')?.key).toBe('2026-08');
    expect(parsePeriodFromPath('M/August 2026', 'MMMM YYYY', 'month')?.key).toBe('2026-08');
    expect(parsePeriodFromPath('M/notes', 'YYYY-MM', 'month')).toBeUndefined();
  });
});
