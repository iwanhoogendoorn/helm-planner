import { describe, expect, it } from 'vitest';
import { bundledTemplate } from '../../src/core/periodicTemplates';
import { renderDailyTemplate } from '../../src/data/mutations';
import { setup, TODAY, makeVault, SETTINGS, DAILY_FOLDER, DAILY_FORMAT } from '../data/fixture';
import { HelmIndex } from '../../src/data/index';
import { Mutations } from '../../src/data/mutations';

const CFG = { formats: { year: 'YYYY', quarter: 'YYYY-[Q]Q', month: 'YYYY-MM', week: 'gggg-[W]ww' }, dailyTitleFormat: 'DD, dddd, MMM, YYYY', goalsHeading: '## Goals' };

describe('built-in periodic templates', () => {
  it('weekly: title, year/quarter/month by the ISO Thursday, neighbours, seven day links', () => {
    const out = renderDailyTemplate(bundledTemplate('week', CFG), '2026-08-24', '2026-W35');
    expect(out).toContain('Type: Weekly Note');
    expect(out).toContain('# Week 35, 2026');
    expect(out).toContain('Year: [[2026|2026]] · Quarter: [[2026-Q3|Q3]] · Month: [[2026-08|August]]');
    expect(out).toContain('◀ [[2026-W34|Previous week]] · [[2026-W36|Next week]] ▶');
    expect(out).toContain('[[24, Monday, Aug, 2026|Mon 24]] · [[25, Tuesday, Aug, 2026|Tue 25]]');
    expect(out).toContain('[[30, Sunday, Aug, 2026|Sun 30]]');
    expect(out).toContain('## Goals\n\n## Review');
    expect(out).not.toContain('<%');
  });
  it('monthly: neighbours, quarter, year; the weeks script is left to Templater', () => {
    const out = renderDailyTemplate(bundledTemplate('month', CFG), '2026-08-01', '2026-08');
    expect(out).toContain('# August 2026');
    expect(out).toContain('Year: [[2026|2026]] · Quarter: [[2026-Q3|Q3]] · ◀ [[2026-07|July]] · [[2026-09|September]] ▶');
    expect(out).toContain('Weeks: \n');
    expect(bundledTemplate('month', CFG)).toContain("startOf('isoWeek')");
  });
  it('quarterly: months and neighbours; yearly: quarters and neighbours', () => {
    const q = renderDailyTemplate(bundledTemplate('quarter', CFG), '2026-07-01', '2026-Q3');
    expect(q).toContain('# Q3 2026');
    expect(q).toContain('◀ [[2026-Q2|Previous quarter]] · [[2026-Q4|Next quarter]] ▶');
    expect(q).toContain('Months: [[2026-07|July]] · [[2026-08|August]] · [[2026-09|September]]');
    const y = renderDailyTemplate(bundledTemplate('year', CFG), '2026-01-01', '2026');
    expect(y).toContain('◀ [[2025|Previous year]] · [[2027|Next year]] ▶');
    expect(y).toContain('Quarters: [[2026-Q1|Q1]] · [[2026-Q2|Q2]] · [[2026-Q3|Q3]] · [[2026-Q4|Q4]]');
  });
  it('year boundary: the first ISO week of 2027 belongs to 2027 by its Thursday and links to 2026-W53', () => {
    const out = renderDailyTemplate(bundledTemplate('week', CFG), '2027-01-04', '2027-W01');
    expect(out).toContain('# Week 1, 2027');
    expect(out).toContain('[[2026-W53|Previous week]]');
    expect(out).toContain('Month: [[2027-01|January]]');
  });
});

describe('periodic notes from templates', () => {
  it('ensureCurrentPeriodicNotes creates the four missing notes once, and goals land under the heading', async () => {
    const { m, vault, index } = await setup();
    const created = await m.ensureCurrentPeriodicNotes(TODAY);
    expect(created).toEqual(['Yearly Notes/2026.md', 'Quarterly Notes/2026-Q3.md', 'Monthly Notes/2026-08.md', 'Weekly Notes/2026-W35.md']);
    expect(await m.ensureCurrentPeriodicNotes(TODAY)).toEqual([]);
    await m.addGoal('2026-W35', 'Ship the templates');
    const week = await vault.read('Weekly Notes/2026-W35.md');
    expect(week).toMatch(/## Goals\n\n- \[ \] Ship the templates 🆔 gol-\w+/);
    expect(index.allGoals().some((g) => g.text === 'Ship the templates' && g.periodKey === '2026-W35')).toBe(true);
  });
  it('writeTemplateNote skips an existing note unless told to replace it', async () => {
    const { m, vault } = await setup({ 'Templates/WEEKLY NOTE TEMPLATE.md': '# old' });
    expect(await m.writeTemplateNote('week', 'Templates/WEEKLY NOTE TEMPLATE.md')).toBe('skipped');
    expect(await vault.read('Templates/WEEKLY NOTE TEMPLATE.md')).toBe('# old');
    expect(await m.writeTemplateNote('month', 'Templates/MONTHLY NOTE TEMPLATE.md')).toBe('created');
    expect(await vault.read('Templates/MONTHLY NOTE TEMPLATE.md')).toContain("moment(tp.file.title, 'YYYY-MM')");
    expect(await m.writeTemplateNote('week', 'Templates/WEEKLY NOTE TEMPLATE.md', { replace: true })).toBe('replaced');
    expect(await vault.read('Templates/WEEKLY NOTE TEMPLATE.md')).toContain('Type: Weekly Note');
    expect(await vault.read('Templates/WEEKLY NOTE TEMPLATE.md')).toContain("format('DD, dddd, MMM, YYYY')");
  });
});

describe('Templater hand-off', () => {
  it('gets a note whose title, dates and moment chains are already rendered; only the script block is left', async () => {
    const vault = makeVault();
    const index = new HelmIndex(vault, { settings: () => SETTINGS, today: () => TODAY, dailyConfig: () => ({ folder: DAILY_FOLDER, format: DAILY_FORMAT }), periodicConfig: () => ({ year: { folder: 'Yearly Notes', format: 'YYYY' }, quarter: { folder: 'Quarterly Notes', format: 'YYYY-[Q]Q' }, month: { folder: 'Monthly Notes', format: 'YYYY-MM' }, week: { folder: 'Weekly Notes', format: 'gggg-[W]ww' } }) });
    await index.rebuild();
    const seen: string[] = [];
    const m = new Mutations({ vault, index, settings: () => SETTINGS, today: () => TODAY, notify: () => undefined, processTemplate: async (path) => { seen.push(await vault.read(path)); return true; } });
    await m.ensurePeriodicNote({ kind: 'month', key: '2026-08', start: '2026-08-01', end: '2026-08-31', label: 'August 2026', year: 2026, month: 8 });
    expect(seen).toHaveLength(1);
    const handed = seen[0]!;
    expect(handed).toContain('title: 2026-08');
    expect(handed).toContain('# August 2026');
    expect(handed).toContain('[[2026-07|July]]');
    expect(handed).not.toContain('tp.file.title');
    expect(handed).toContain('<%* const m = moment("2026-08", \'YYYY-MM\')');
  });
});

describe('template notes survive a template engine that renders new files', () => {
  it('re-asserts the template after the engine has mangled the fresh file', async () => {
    const vault = makeVault();
    const index = new HelmIndex(vault, { settings: () => SETTINGS, today: () => TODAY, dailyConfig: () => ({ folder: DAILY_FOLDER, format: DAILY_FORMAT }), periodicConfig: () => ({ year: { folder: 'Yearly Notes', format: 'YYYY' }, quarter: { folder: 'Quarterly Notes', format: 'YYYY-[Q]Q' }, month: { folder: 'Monthly Notes', format: 'YYYY-MM' }, week: { folder: 'Weekly Notes', format: 'gggg-[W]ww' } }) });
    await index.rebuild();
    const m = new Mutations({ vault, index, settings: () => SETTINGS, today: () => TODAY, notify: () => undefined, processTemplate: async () => true, templateSettleMs: 5 });
    const origWrite = vault.write.bind(vault);
    let mangled = false;
    vault.write = async (p, c) => { await origWrite(p, c); if (!mangled) { mangled = true; await origWrite(p, '---\ntitle: SOMETHING ELSE\n---\n# Invalid date'); } };
    expect(await m.writeTemplateNote('week', 'Templates/WEEKLY NOTE TEMPLATE.md')).toBe('created');
    const final = await vault.read('Templates/WEEKLY NOTE TEMPLATE.md');
    expect(final).toContain('title: <% tp.file.title %>');
    expect(final).not.toContain('Invalid date');
  });
});
