import { describe, expect, it } from 'vitest';
import { setup, TODAY } from './fixture';
import { computeStats, filterOptions, STATS_SOURCES } from '../../src/data/stats';

const ALL_SOURCES = STATS_SOURCES;

describe('dashboard stats', () => {
  it('computes totals, series and drilldowns over the fixture', async () => {
    const { index, settings, m } = await setup();
    await m.schedule('tsk-0001', TODAY, 'morning');
    await m.setStatus('tsk-0001', 'done');
    const s = computeStats(index.snapshot, { sources: ALL_SOURCES, from: '2026-08-20', to: TODAY }, TODAY, settings);
    expect(s.days).toBe(7);
    expect(s.totals.done).toBe(3); // Pay invoice (25th), Collect diagrams (20th), Draft chapter list (today)
    expect(s.perDay.map((d) => d.value)).toEqual([1, 0, 0, 0, 0, 1, 1]);
    expect(s.cumulative[s.cumulative.length - 1]!.done).toBe(3);
    expect(s.byPart.morning.done).toBe(1);
    expect(s.byPart.afternoon).toMatchObject({ planned: 2, done: 1 });
    expect(s.adherence).toMatchObject({ planned: 5, done: 2 });
    expect(s.byWeekday[2]!.value).toBe(1); // Wednesday the 26th
    expect(s.byWeekday[3]!.value).toBe(1); // Thursday the 20th
    expect(s.byProject[0]!.project.title).toBe('Oracle Book Writing');
    expect(s.byProject[0]!.doneTasks).toHaveLength(2);
    expect(s.byProject[0]!.velocity).toBe(2);
    expect(s.ageBuckets.find((b) => b.key === 'unknown')!.value).toBeGreaterThan(0);
    expect(s.habits.map((h) => h.habit.id).sort()).toEqual(['hab-read', 'hab-workout']);
    expect(s.streak.current).toBe(2); // yesterday and today both had completions
    // Filters narrow the population.
    const k = computeStats(index.snapshot, { sources: ALL_SOURCES, from: '2026-08-20', to: TODAY, projectId: 'prj-kitchen' }, TODAY, settings);
    expect(k.totals.done).toBe(0);
    expect(k.byProject.map((p) => p.project.title)).toEqual(['Kitchen Remodel']);
    const a = computeStats(index.snapshot, { sources: ALL_SOURCES, from: '2026-08-20', to: TODAY, area: 'Oracle' }, TODAY, settings);
    expect(a.totals.done).toBe(2);
    expect(filterOptions(index.snapshot).areas).toEqual(['Oracle']);
  });
});

describe('which notes the numbers count', () => {
  it('counts daily-note tasks by default and adds each source you switch on', async () => {
    const { index, settings, m } = await setup();
    await m.setStatus('tsk-0001', 'done'); // a project task
    const range = { from: '2026-08-20' as const, to: TODAY };
    const done = (sources?: ('daily' | 'project' | 'note' | 'inbox')[]): string[] =>
      computeStats(index.snapshot, { ...range, ...(sources ? { sources } : {}) }, TODAY, settings).perDay.flatMap((d) => d.tasks).map((t) => t.text).sort();
    expect(done()).toEqual(['Pay invoice']); // the default: only what was written on a day
    expect(done(['daily'])).toEqual(['Pay invoice']);
    expect(done(['daily', 'project'])).toEqual(['Collect diagrams', 'Draft chapter list', 'Pay invoice']);
    expect(done(['project'])).toEqual(['Collect diagrams', 'Draft chapter list']); // daily notes can be left out entirely
    const inbox = [...index.snapshot.tasks.values()].find((t) => t.origin === 'inbox' && t.text.startsWith('Call the plumber'))!;
    await m.setStatus(inbox.key, 'done');
    expect(done(['daily', 'project'])).not.toContain('Call the plumber');
    expect(done(['daily', 'inbox'])).toContain('Call the plumber');
    expect(done(STATS_SOURCES)).toContain('Call the plumber');
  });
});
