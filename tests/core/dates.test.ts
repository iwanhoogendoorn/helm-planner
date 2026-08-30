import { describe, expect, it } from 'vitest';
import { addDays, addMonths, diffDays, formatDate, humanDate, isoWeek, isoWeekday, parseDateFromPath, startOfWeek, isIsoDate, relativeDays } from '../../src/core/dates';
import { parseCapture, resolveDate } from '../../src/core/nlp';
import { nextOccurrence, occursOn, parseRecurrence, formatRecurrence } from '../../src/core/recurrence';

describe('dates', () => {
  it('validates', () => {
    expect(isIsoDate('2026-02-29')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
  });
  it('arithmetic', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(diffDays('2026-08-26', '2026-09-01')).toBe(6);
    expect(isoWeekday('2026-08-26')).toBe(3); // Wednesday
    expect(startOfWeek('2026-08-26')).toBe('2026-08-24');
    expect(startOfWeek('2026-08-26', 7)).toBe('2026-08-23');
    expect(isoWeek('2026-08-26')).toEqual({ year: 2026, week: 35 });
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 });
  });
  it('formats the daily note path pattern', () => {
    const p = formatDate('2026-08-26', 'YYYY/MM - MMMM/ww/DD, dddd, MMM, YYYY');
    expect(p).toBe('2026/08 - August/35/26, Wednesday, Aug, 2026');
    expect(parseDateFromPath('70 OBSIDIAN/70-06 Daily Notes/2026/08 - August/35/26, Wednesday, Aug, 2026', 'YYYY/MM - MMMM/ww/DD, dddd, MMM, YYYY')).toBe('2026-08-26');
    expect(parseDateFromPath('Daily/2026-08-26', 'YYYY-MM-DD')).toBe('2026-08-26');
    expect(parseDateFromPath('Daily/notes', 'YYYY-MM-DD')).toBeUndefined();
    expect(formatDate('2026-08-26', '[W]ww')).toBe('W35');
  });
  it('human labels', () => {
    expect(humanDate('2026-08-26', '2026-08-26')).toBe('Today');
    expect(humanDate('2026-08-27', '2026-08-26')).toBe('Tomorrow');
    expect(humanDate('2026-09-04', '2026-08-26')).toBe('Fri 4 Sep');
    expect(relativeDays('2026-08-20', '2026-08-26')).toBe('6 days ago');
  });
});

describe('recurrence', () => {
  it('parses Obsidian Tasks phrasing', () => {
    expect(parseRecurrence('every week on monday, thursday')).toMatchObject({ parsed: true, frequency: 'weekly', weekdays: [1, 4] });
    expect(parseRecurrence('every 3 days')).toMatchObject({ frequency: 'daily', interval: 3 });
    expect(parseRecurrence('every month on the 1st, 15th')).toMatchObject({ frequency: 'monthly', monthDays: [1, 15] });
    expect(parseRecurrence('every 2 weeks when done')).toMatchObject({ frequency: 'weekly', interval: 2, whenDone: true });
    expect(parseRecurrence('every weekday')).toMatchObject({ weekdays: [1, 2, 3, 4, 5] });
    expect(parseRecurrence('nonsense').parsed).toBe(false);
    expect(parseRecurrence('RRULE:FREQ=WEEKLY;BYDAY=MO,TH')).toMatchObject({ frequency: 'weekly', weekdays: [1, 4] });
  });
  it('round-trips through format', () => {
    for (const s of ['every day', 'every week on monday, thursday', 'every 3 days', 'every month on the 1st, 15th', 'every 2 weeks when done', 'every weekday', 'every year']) {
      expect(formatRecurrence(parseRecurrence(s))).toBe(s);
    }
  });
  it('occurrence', () => {
    const wk = parseRecurrence('every week on monday, thursday');
    expect(occursOn(wk, '2026-08-24')).toBe(true);
    expect(occursOn(wk, '2026-08-26')).toBe(false);
    expect(nextOccurrence(wk, '2026-08-24')).toBe('2026-08-27');
    expect(nextOccurrence(parseRecurrence('every 3 days'), '2026-08-24')).toBe('2026-08-27');
    expect(nextOccurrence(parseRecurrence('every month'), '2026-01-31')).toBe('2026-02-28');
    expect(occursOn(parseRecurrence('every 2 days'), '2026-08-26', '2026-08-24')).toBe(true);
    expect(occursOn(parseRecurrence('every 2 days'), '2026-08-27', '2026-08-24')).toBe(false);
  });
});

describe('quick capture', () => {
  const today = '2026-08-26'; // Wednesday
  it('parses the kitchen sink', () => {
    const c = parseCapture('Call the plumber tomorrow !high #home @Kitchen Remodel ~30m 14:00-15:00 due friday', today);
    expect(c.text).toBe('Call the plumber #home');
    expect(c.scheduled).toBe('2026-08-27');
    expect(c.due).toBe('2026-08-28');
    expect(c.priority).toBe('high');
    expect(c.tags).toEqual(['home']);
    expect(c.project).toBe('Kitchen Remodel');
    expect(c.effortMinutes).toBe(30);
    expect(c.time).toEqual({ start: '14:00', end: '15:00' });
  });
  it('resolves date words', () => {
    expect(resolveDate('friday', today)).toBe('2026-08-28');
    expect(resolveDate('wednesday', today)).toBe('2026-09-02');
    expect(resolveDate('next wednesday', today)).toBe('2026-09-02');
    expect(resolveDate('next mon', today)).toBe('2026-08-31');
    expect(resolveDate('next week', today)).toBe('2026-08-31');
    expect(resolveDate('in 3 days', today)).toBe('2026-08-29');
    expect(resolveDate('eom', today)).toBe('2026-08-31');
    expect(resolveDate('eow', today)).toBe('2026-08-28');
    expect(resolveDate('1/9', today)).toBe('2026-09-01');
    expect(resolveDate('1 sep', today)).toBe('2026-09-01');
    expect(resolveDate('sep 1', today)).toBe('2026-09-01');
    expect(resolveDate('15 jan', today)).toBe('2027-01-15');
  });
  it('leaves plain text alone', () => {
    const c = parseCapture('Buy milk and eggs', today);
    expect(c).toMatchObject({ text: 'Buy milk and eggs', priority: 'normal', tags: [] });
    expect(c.scheduled).toBeUndefined();
  });
  it('recurrence and priorities', () => {
    const c = parseCapture('Water plants every 3 days !!', today);
    expect(c.recurrence?.parsed).toBe(true);
    expect(c.priority).toBe('medium');
    expect(c.text).toBe('Water plants');
    expect(parseCapture('x !!!', today).priority).toBe('high');
    expect(parseCapture('x !low', today).priority).toBe('low');

    // The short forms carry “when done” too, instead of leaving it in the task's text.
    const w = parseCapture('Review the budget weekly when done', today);
    expect(w.text).toBe('Review the budget');
    expect(w.recurrence).toMatchObject({ frequency: 'weekly', whenDone: true });
    const y = parseCapture('File the accounts annually', today);
    expect(y.text).toBe('File the accounts');
    expect(y.recurrence).toMatchObject({ frequency: 'yearly' });
    // And a repeat at the very end of the line is still picked up.
    expect(parseCapture('Water the plants every week', today).recurrence?.parsed).toBe(true);
  });
});
