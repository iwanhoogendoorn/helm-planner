import { describe, expect, it } from 'vitest';
import { parseCapture, resolveDate } from '../../src/core/nlp';

const WED = '2026-08-26'; // Wednesday
const MON = '2026-08-24';
const SAT = '2026-08-29';
const SUN = '2026-08-30';

describe('capture grammar · dates', () => {
  it('"next <weekday>" is that weekday of next week, whatever today is, for both week starts', () => {
    // Monday-start weeks: next week is 31 Aug – 6 Sep.
    expect(resolveDate('next friday', MON)).toBe('2026-09-04');   // not this Friday (28th)
    expect(resolveDate('next friday', WED)).toBe('2026-09-04');
    expect(resolveDate('next friday', SAT)).toBe('2026-09-04');   // Friday already past: still next week's
    expect(resolveDate('next monday', WED)).toBe('2026-08-31');
    expect(resolveDate('next wednesday', WED)).toBe('2026-09-02');
    expect(resolveDate('next sunday', SUN)).toBe('2026-09-06');
    // Sunday-start weeks: next week is 30 Aug – 5 Sep for a Wednesday, 6–12 Sep for a Sunday.
    expect(resolveDate('next friday', WED, 7)).toBe('2026-09-04');
    expect(resolveDate('next sunday', WED, 7)).toBe('2026-08-30');
    expect(resolveDate('next friday', SUN, 7)).toBe('2026-09-11');
    // Bare and "this" are unchanged: the coming one, today counting only for "this".
    expect(resolveDate('friday', MON)).toBe('2026-08-28');
    expect(resolveDate('wednesday', WED)).toBe('2026-09-02');
    expect(resolveDate('this wednesday', WED)).toBe(WED);
    expect(resolveDate('this friday', SAT)).toBe('2026-09-04');
  });

  it('"eow" is the coming Friday, the end of the working week, for both week starts — never a day already gone', () => {
    expect(resolveDate('eow', WED)).toBe('2026-08-28');
    expect(resolveDate('eow', WED, 7)).toBe('2026-08-28');
    expect(resolveDate('eow', '2026-08-28')).toBe('2026-08-28'); // on a Friday, eow is today
    expect(resolveDate('eow', SAT)).toBe('2026-09-04');     // Saturday: this week's Friday has gone → the coming one
    expect(resolveDate('eow', SUN, 1)).toBe('2026-09-04');  // Sunday (Monday-start week): likewise
    expect(resolveDate('eow', SAT, 7)).toBe('2026-09-04');  // Saturday (Sunday-start week): likewise
    expect(resolveDate('eow', SUN, 7)).toBe('2026-09-04');  // Sunday starts the new week: its Friday
    expect(resolveDate('eom', '2026-08-31')).toBe('2026-08-31'); // eom on the last day is today, never before
    expect(resolveDate('next week', WED)).toBe('2026-08-31');
    expect(resolveDate('next week', WED, 7)).toBe('2026-08-30');
  });

  it('due and scheduled use the same resolution, so "due next friday" and "next friday" agree', () => {
    const due = parseCapture('Send the draft due next friday', MON);
    const sched = parseCapture('Send the draft next friday', MON);
    expect(due.due).toBe('2026-09-04');
    expect(sched.scheduled).toBe('2026-09-04');
    expect(parseCapture('Send the draft by eow', MON).due).toBe('2026-08-28');
    expect(parseCapture('Send the draft by eow', SAT).due).toBe('2026-09-04');
  });
});

describe('capture grammar · where an @Project name ends', () => {
  const project = (line: string, today = WED): string | undefined => parseCapture(line, today).project;
  it('stops on every word the rest of the grammar reads, and keeps ordinary words', () => {
    expect(project('Fix the tap @Kitchen Remodel by friday')).toBe('Kitchen Remodel');
    expect(parseCapture('Fix the tap @Kitchen Remodel by friday', WED)).toMatchObject({ project: 'Kitchen Remodel', due: '2026-08-28', text: 'Fix the tap' });
    expect(project('x @Kitchen Remodel deadline 2026-09-30')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel at 14:00')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel yesterday')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel this friday')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel next week')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel in the morning')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel tonight')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel evening')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel 1 sep')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel sep 1')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel 1/9')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel eom')).toBe('Kitchen Remodel');
    expect(project('x @Kitchen Remodel due tomorrow !high #home ~30m')).toBe('Kitchen Remodel');
    // A repeat phrase is taken out before the project is read; an unparsed one still stops the name.
    expect(parseCapture('x @Kitchen Remodel every week on friday', WED)).toMatchObject({ project: 'Kitchen Remodel', recurrence: { frequency: 'weekly' } });
    expect(project('x @Kitchen Remodel weekly')).toBe('Kitchen Remodel');
    // Words that only look like stop words are kept: the match is on whole words.
    expect(project('x @Bypass Valve Replacement')).toBe('Bypass Valve Replacement');
    expect(project('x @Mondays Club')).toBe('Mondays Club');
    expect(project('x @Atlas Project')).toBe('Atlas Project');
    expect(project('x @May Fair')).toBe('May Fair'); // the first word of a name is never a stop word
    expect(project('x @Kitchen Remodel')).toBe('Kitchen Remodel');
  });
  it('a month name followed by a day is a date, a month name as a word is part of the name only when it cannot be a date', () => {
    expect(parseCapture('x @Summer Fair 12 jun', WED)).toMatchObject({ project: 'Summer Fair', scheduled: '2027-06-12' });
    expect(parseCapture('x @Summer Fair jun 12', WED)).toMatchObject({ project: 'Summer Fair', scheduled: '2027-06-12' });
  });
});
