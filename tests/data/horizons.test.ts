import { describe, expect, it } from 'vitest';
import { setup, TODAY } from './fixture';
import { candidates, horizons } from '../../src/data/planner';

const YEARLY = `---
title: 2026
---
# 2026

## Goals

- [ ] Publish the OCI networking book 🆔 gol-book26
- [x] Get OCI certified 🆔 gol-cert26 ✅ 2026-06-01
`;
const QUARTERLY = `---
title: 2026-Q3
---
# Q3 2026

## Goals

- [ ] Finish the kitchen design
`;
const EXTRA = {
  'Yearly Notes/2026.md': YEARLY,
  'Quarterly Notes/2026-Q3.md': QUARTERLY,
  '02 PROJECTS/Darknet.md': '---\ntype: project\ntitle: Darknet\nstatus: active\n---\n# Darknet\n\n- [ ] Read the Tor docs\n',
  '02 PROJECTS/ZZZ. Project Archive/Old/Old.md': '---\ntype: project\ntitle: Old\nid: prj-old\n---\n- [ ] forgotten\n',
};
const bind = (s: string, key: string, goal?: string): string => s.replace('---\n\n# ', `period: ${key}\n${goal ? `goal: ${goal}\n` : ''}---\n\n# `);

describe('horizons', () => {
  it('indexes goals from periodic notes and links projects to them', async () => {
    const { index } = await setup({ ...EXTRA, '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md': bind((await setup()).vault.files.get('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')!, '2026-Q3', 'gol-book26') });
    const snap = index.snapshot;
    expect([...snap.goals.values()].map((g) => [g.id, g.periodKey, g.status]).sort((a, b) => String(a[1]).localeCompare(String(b[1])))).toEqual([['gol-book26', '2026', 'todo'], ['gol-cert26', '2026', 'done'], [expect.stringMatching(/^d:/), '2026-Q3', 'todo']]);
    const book = index.project('prj-book')!;
    expect(book.period).toBe('2026-Q3');
    expect(book.goalId).toBe('gol-book26');
    expect(snap.goals.get('gol-book26')!.projectIds).toEqual(['prj-book']);
    expect(index.periodicPath({ kind: 'month', key: '2026-08', start: '2026-08-01', end: '2026-08-31', label: 'August 2026', year: 2026, month: 8, quarter: 3 })).toBe('Monthly Notes/2026-08.md');
  });

  it('a loose project note is not an umbrella; archived paths are skipped', async () => {
    const { index } = await setup(EXTRA);
    const darknet = index.projectByTitle('Darknet')!;
    expect(darknet.folderNote).toBe(false);
    expect(darknet.childIds).toEqual([]);
    expect(index.project('prj-book')!.parentId).toBeUndefined();
    expect(index.project('prj-old')).toBeUndefined();
  });

  it('computes the year, quarters and months', async () => {
    const { index, settings } = await setup({ ...EXTRA, '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md': bind((await setup()).vault.files.get('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')!, '2026-Q3', 'gol-book26'), '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md': bind((await setup()).vault.files.get('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')!, '2026-09') });
    const hz = horizons(index.snapshot, 2026, TODAY, settings);
    expect(hz.year.goals.map((g) => [g.goal.text, g.progress, g.taskTotal])).toEqual([['Publish the OCI networking book', 2 / 7, 7], ['Get OCI certified', 1, 0]]);
    expect(hz.year.projects).toEqual([]);
    expect(hz.year.projectsWithin.map((h) => h.project.title)).toEqual(['Oracle Book Writing', 'Kitchen Remodel']);
    expect(hz.quarters[2]!.projects.map((h) => h.project.title)).toEqual(['Oracle Book Writing']);
    expect(hz.quarters[2]!.projectsWithin.map((h) => h.project.title)).toEqual(['Oracle Book Writing', 'Kitchen Remodel']);
    expect(hz.quarters[2]!.isCurrent).toBe(true);
    expect(hz.months[8]!.projects.map((h) => h.project.title)).toEqual(['Kitchen Remodel']);
    expect(hz.months[0]!.isPast).toBe(true);
    expect(hz.quarters[2]!.goals[0]!.goal.text).toBe('Finish the kitchen design');
  });

  it('boosts next actions of projects bound to the current period', async () => {
    const base = (await setup()).vault.files.get('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')!;
    const plain = candidates((await setup()).index.snapshot, TODAY, (await setup()).settings, TODAY);
    const { index, settings } = await setup({ '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md': bind(base, '2026-08').replace('status: planned', 'status: active') });
    const boosted = candidates(index.snapshot, TODAY, settings, TODAY);
    const q = boosted.find((c) => c.task.text === 'Get three quotes')!;
    expect(q.reason).toBe('next-action');
    expect(plain.some((c) => c.task.text === 'Get three quotes')).toBe(false); // planned, not active
    expect(q.score).toBeGreaterThan(boosted.find((c) => c.task.text === 'Draft chapter list')!.score - 10);
  });
});

describe('goal mutations', () => {
  it('adds a goal, creating the periodic note; links a project; binds a project', async () => {
    const { m, vault, index } = await setup();
    const id = await m.addGoal('2026-Q4', 'Ship Helm 1.0');
    expect(id).toMatch(/^gol-/);
    const note = await vault.read('Quarterly Notes/2026-Q4.md');
    expect(note).toContain('title: 2026-Q4\nType: Quarterly Note\nperiod: 2026-Q4');
    expect(note).toContain('# Q4 2026');
    expect(note).toContain(`## Goals\n\n- [ ] Ship Helm 1.0 🆔 ${id} ➕ 2026-08-26\n`);
    await m.addGoal('2026-Q4', 'Second goal');
    expect((await vault.read('Quarterly Notes/2026-Q4.md')).split('\n').filter((l) => l.startsWith('- [ ]'))).toHaveLength(2);
    const goal = index.allGoals().find((g) => g.id === id)!;
    await m.linkProjectToGoal('prj-kitchen', goal.key);
    const k = await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md');
    expect(k).toContain(`goal: ${id}`);
    expect(k).toContain('period: 2026-Q4');
    expect(index.project('prj-kitchen')!.goalId).toBe(goal.key);
    expect(index.goal(goal.key)!.projectIds).toEqual(['prj-kitchen']);
    await m.setProjectFields('prj-kitchen', { period: '2026-11' });
    expect(index.project('prj-kitchen')!.period).toBe('2026-11');
    await m.setStatus(goal.key, 'done');
    expect(await vault.read('Quarterly Notes/2026-Q4.md')).toContain(`- [x] Ship Helm 1.0 🆔 ${id} ➕ 2026-08-26 ✅ 2026-08-26`);
    await m.linkProjectToGoal('prj-kitchen', null);
    expect(index.project('prj-kitchen')!.goalId).toBeUndefined();
  });

  it('a goals heading is added to an existing periodic note that lacks one', async () => {
    const { m, vault } = await setup({ 'Yearly Notes/2026.md': '# 2026\n\nSome prose.\n' });
    await m.addGoal('2026', 'Read 24 books');
    expect(await vault.read('Yearly Notes/2026.md')).toMatch(/# 2026\n\nSome prose\.\n\n## Goals\n\n- \[ \] Read 24 books 🆔 gol-\w+ ➕ 2026-08-26\n/);
  });

  it('new projects can carry a period and a goal', async () => {
    const { m, index } = await setup({ 'Yearly Notes/2026.md': YEARLY });
    const p = await m.createProject({ title: 'Book launch', status: 'planned', priority: 'normal', period: '2026-Q4', goal: 'gol-book26' });
    expect(index.project(p.id)!.period).toBe('2026-Q4');
    expect(index.project(p.id)!.goalId).toBe('gol-book26');
  });
});
