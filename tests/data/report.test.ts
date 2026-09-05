import { describe, expect, it } from 'vitest';
import { dailyPath, setup, TODAY } from './fixture';
import { ALL_SECTIONS, buildReport, rangeOf, type ReportOptions } from '../../src/data/report';
import { renderReport, reportFileName, esc } from '../../src/ui/report/html';

const opts = (over: Partial<ReportOptions> = {}): ReportOptions => ({ scope: 'week', anchor: TODAY, sections: { ...ALL_SECTIONS }, ...over });

describe('the range a report covers', () => {
  it('takes a day, a week, a month, a quarter and a year from one date', () => {
    expect(rangeOf('day', '2026-08-26', 1)).toMatchObject({ from: '2026-08-26', to: '2026-08-26' });
    expect(rangeOf('week', '2026-08-26', 1)).toMatchObject({ from: '2026-08-24', to: '2026-08-30' });   // Mon–Sun
    expect(rangeOf('week', '2026-08-26', 7)).toMatchObject({ from: '2026-08-23', to: '2026-08-29' });   // a week that starts on Sunday
    expect(rangeOf('month', '2026-08-26', 1)).toMatchObject({ from: '2026-08-01', to: '2026-08-31' });
    expect(rangeOf('quarter', '2026-08-26', 1)).toMatchObject({ from: '2026-07-01', to: '2026-09-30' });
    expect(rangeOf('year', '2026-08-26', 1)).toMatchObject({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('building a report', () => {
  it('looks back and forward at once, and says which period it is', async () => {
    const { index, settings } = await setup();
    const r = buildReport(index.snapshot, opts(), TODAY, settings);
    expect(r.scope).toBe('week');
    expect(r.title).toBe('Week 35, 2026');
    expect(r.subtitle).toContain('Week 35');
    expect(r.standing).toBe('current');
    expect(r.from <= TODAY && TODAY <= r.to).toBe(true);
    // The four headline figures, and the same numbers the Dashboard would give.
    expect(r.headline).toHaveLength(4);
    expect(r.headline[0]!.value).toBe(String(r.stats.totals.done));
    // Seven day cards for a week.
    expect(r.days).toHaveLength(7);
  });

  it('carries what is overdue into the period rather than losing it', async () => {
    const { index, settings, m } = await setup();
    await m.updateTask('tsk-0001', { due: '2026-08-01' });          // long past
    const r = buildReport(index.snapshot, opts(), TODAY, settings);
    expect(r.overdue.some((t) => t.id === 'tsk-0001' || t.text.includes('OIB'))).toBe(true);
    expect(r.ahead.every((d) => d.date >= TODAY)).toBe(true);        // nothing behind today is “ahead”
  });

  it('overdue means past its due date — an old task with no due date is left behind, not late', async () => {
    const day = '2026-07-14';
    const { index, settings } = await setup({
      [dailyPath(day)]: `---\ntitle: 14\n---\n\n# Day planner\n\n### A. Morning\n\n- [ ] Sat in an old note, never due\n- [ ] 12:00 - 13:00: \n\n### Anytime\n`,
    });
    const r = buildReport(index.snapshot, opts(), TODAY, settings);
    expect(r.overdue.every((t) => t.due !== undefined && t.due < TODAY)).toBe(true);
    expect(r.overdue.map((t) => t.text)).not.toContain('Sat in an old note, never due');
    expect(r.leftBehind).toBeGreaterThan(0);                        // counted, not dumped into the list
    // Helm's own empty time blocks are scaffolding and never reach the page.
    const all = [...r.overdue, ...r.undated, ...r.ahead.flatMap((d) => d.tasks), ...r.days.flatMap((d) => [...d.open, ...d.done])];
    expect(all.every((t) => t.text.trim() !== '')).toBe(true);
    expect(renderReport(r, 'now')).toContain('still open, not late');
  });

  it('a day report brings the day’s own plan, a year report does not', async () => {
    const { index, settings } = await setup();
    expect(buildReport(index.snapshot, opts({ scope: 'day', anchor: TODAY }), TODAY, settings).plan).toBeDefined();
    expect(buildReport(index.snapshot, opts({ scope: 'year' }), TODAY, settings).plan).toBeUndefined();
    expect(buildReport(index.snapshot, opts({ scope: 'year' }), TODAY, settings).days).toEqual([]);
  });

  it('a project report is that project’s story, not the period’s', async () => {
    const { index, settings } = await setup();
    const r = buildReport(index.snapshot, opts({ scope: 'quarter', projectId: 'prj-book' }), TODAY, settings);
    expect(r.title).toBe(index.project('prj-book')!.title);
    expect(r.project?.id).toBe('prj-book');
    expect(r.projects.every((p) => p.project.id === 'prj-book' || p.project.parentId === 'prj-book')).toBe(true);
    // Its own open work is listed even when no day has been picked for it.
    expect(r.undated.every((t) => t.projectId === 'prj-book')).toBe(true);
  });

  it('a period still to come has nothing to look back on', async () => {
    const { index, settings } = await setup();
    const r = buildReport(index.snapshot, opts({ scope: 'month', anchor: '2026-12-15' }), TODAY, settings);
    expect(r.standing).toBe('future');
    expect(r.stats.totals.done).toBe(0);
    expect(r.headline[0]!.label).toBe('Planned');
  });

  it('picks up the diary of a day, and the days of a week', async () => {
    const { index, settings } = await setup();
    const r = buildReport(index.snapshot, opts({ scope: 'day', anchor: TODAY }), TODAY, settings, (d) => (d === TODAY ? [{ time: '09:00', icon: '⌨️', text: 'Wrote the thing', line: 1, endLine: 2, replies: [] }] : []));
    expect(r.daybook).toEqual([{ date: TODAY, entries: [expect.objectContaining({ text: 'Wrote the thing' })] }]);
  });
});

describe('the printed page', () => {
  it('is one HTML document with the period, the figures and the sections in it', async () => {
    const { index, settings } = await setup();
    const r = buildReport(index.snapshot, opts(), TODAY, settings);
    const html = renderReport(r, '2026-08-26 14:37');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('@page { size: A4; margin: 0; }');        // the house page setup
    expect(html).toContain('<h1>');
    expect(html).toContain(r.title);
    expect(html).toContain('What is ahead');
    expect(html).toContain('Projects');
    expect(html).toContain('Exported from Helm on 2026-08-26 14:37');
  });

  it('leaves out what you unticked', async () => {
    const { index, settings } = await setup();
    const bare = buildReport(index.snapshot, opts({ sections: { ...ALL_SECTIONS, projects: false, habits: false, goals: false } }), TODAY, settings);
    const html = renderReport(bare, 'now');
    expect(html).not.toContain('<h2>Projects</h2>');
    expect(html).not.toContain('<h2>Habits</h2>');
    expect(html).toContain('What is ahead');
  });

  it('escapes what people write, so a task cannot break the page', () => {
    expect(esc('<script>alert("x")</script> & co')).toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co');
  });

  it('names the file after the period, without characters a filesystem hates', async () => {
    const { index, settings } = await setup();
    const r = buildReport(index.snapshot, opts(), TODAY, settings);
    const name = reportFileName(r);
    expect(name.endsWith('.pdf')).toBe(true);
    expect(name).not.toMatch(/[\\/:*?"<>|]/);
  });
});
