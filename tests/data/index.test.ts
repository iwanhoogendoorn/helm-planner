import { describe, expect, it } from 'vitest';
import { setup, dailyPath, TODAY } from './fixture';
import { candidates, dayPlan, inboxItems, nextAction, projectHealth, review, weekView } from '../../src/data/planner';
import { habitStats } from '../../src/data/habits';

describe('index', () => {
  it('finds projects, phases, tasks, habits, daily notes', async () => {
    const { index } = await setup();
    const snap = index.snapshot;
    expect([...snap.projects.keys()].sort()).toEqual(['prj-book', 'prj-cert', 'prj-kitchen', 'prj-oracle']);
    const book = snap.projects.get('prj-book')!;
    expect(book.phases.map((p) => p.title)).toEqual(['Outline', 'Writing']);
    expect(book.phases[0]!.taskKeys).toHaveLength(4);
    expect(book.looseTaskKeys).toHaveLength(1);
    expect(book.due).toBe('2026-12-31');
    expect(snap.projects.get('prj-cert')!.parentId).toBe('prj-oracle');
    expect(snap.projects.get('prj-oracle')!.childIds).toEqual(['prj-cert']);
    expect([...snap.habits.keys()].sort()).toEqual(['hab-read', 'hab-workout']);
    expect(snap.dailyNotes.get('2026-08-25')?.hasRegion).toBe(true);
    expect(snap.completions).toEqual([{ habitId: 'hab-workout', date: '2026-08-25', path: dailyPath('2026-08-25'), line: 13, state: 'done' }]);
  });

  it('classifies daily lines', async () => {
    const { index } = await setup();
    const tasks = index.tasksInFile(dailyPath('2026-08-25'));
    expect(tasks.map((t) => [t.text, t.origin, t.section])).toEqual([
      ['Start with OIB', 'daily', 'outside'],
      ['Fix router config', 'daily', 'afternoon'],
      ['Pay invoice', 'daily', 'afternoon'],
      ['Chapter 1', 'daily-mirror', 'anytime'],
    ]);
    const mirror = tasks[3]!;
    expect(mirror.key).toBe('tsk-0003@2026-08-25');
    expect(mirror.mirrorOf).toBe('tsk-0003');
    expect(index.snapshot.diagnostics.some((d) => d.code === 'HELM-M01')).toBe(true); // tsk-0003 does not exist
  });

  it('nests and links children', async () => {
    const { index } = await setup();
    const t = index.task('tsk-0001')!;
    expect(t.childKeys).toHaveLength(1);
    expect(index.task(t.childKeys[0]!)!.parentKey).toBe('tsk-0001');
    const inbox = index.tasksInFile('01 INBOX/Inbox.md');
    expect(inbox.map((t) => t.depth)).toEqual([0, 0, 1]);
  });

  it('updates incrementally', async () => {
    const { index, vault } = await setup();
    const path = '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md';
    const c = (await vault.read(path)) + '- [ ] Pick tiles\n';
    index.update(path, c);
    expect(index.project('prj-kitchen')!.looseTaskKeys).toHaveLength(2);
    expect(index.snapshot.projects.size).toBe(4);
    index.update(path, undefined);
    expect(index.project('prj-kitchen')).toBeUndefined();
    expect(index.update('somewhere/else.md', '- [ ] x')).toBe(false);
  });

  it('daily path round trip', async () => {
    const { index } = await setup();
    expect(index.dailyPath('2026-08-26')).toBe(dailyPath('2026-08-26'));
    expect(index.dateOfPath(dailyPath('2026-08-26'))).toBe('2026-08-26');
    expect(index.dateOfPath('02 PROJECTS/x.md')).toBeUndefined();
  });
});

describe('planner', () => {
  it('day plan', async () => {
    const { index, settings } = await setup();
    const plan = dayPlan(index.snapshot, '2026-08-25', settings);
    expect(plan.today.map((t) => t.text)).toEqual(['Fix router config', 'Pay invoice']);
    expect(plan.timeBlocks.map((t) => t.text)).toEqual(['Start with OIB']);
    expect(plan.mirrors).toHaveLength(1);
    expect(plan.openCount).toBe(3);
    expect(plan.doneCount).toBe(1);
  });

  it('day plan lists only top-level items; subtasks travel with their parent', async () => {
    const { index, settings, m } = await setup();
    const t = index.allTasks().find((x) => x.text === 'Renew passport')!;
    await m.schedule(t.key, TODAY);
    const plan = dayPlan(index.snapshot, TODAY, settings);
    expect(plan.today.map((x) => x.text)).toEqual(['Renew passport']);
    expect(plan.openCount).toBe(1);
  });

  it('next action skips blocked and done, prefers phase order', async () => {
    const { index } = await setup();
    const book = index.project('prj-book')!;
    expect(nextAction(index.snapshot, book)!.text).toBe('Draft chapter list');
    const kitchen = index.project('prj-kitchen')!;
    expect(nextAction(index.snapshot, kitchen)!.text).toBe('Get three quotes');
  });

  it('candidates ranked: overdue first', async () => {
    const { index, settings } = await setup();
    const c = candidates(index.snapshot, TODAY, settings, TODAY);
    expect(c[0]!.reason).toBe('overdue');
    expect(c.map((x) => x.task.text)).toContain('Renew passport');
    expect(c.map((x) => x.task.text)).toContain('Chapter 1');
    expect(c.some((x) => x.task.text === 'Fix router config' && x.reason === 'scheduled-past')).toBe(true);
    expect(c.some((x) => x.task.text === 'Draft chapter list' && x.reason === 'next-action')).toBe(true);
    expect(c.some((x) => x.task.text === 'Review with editor')).toBe(false); // blocked
    expect(c.some((x) => x.task.text === 'Renew passport')).toBe(true);
    expect(c.some((x) => x.task.text === 'Call the plumber' && x.reason === 'inbox')).toBe(true);
  });

  it('project health', async () => {
    const { index, settings } = await setup();
    const h = projectHealth(index.snapshot, index.project('prj-book')!, TODAY, settings);
    expect(h.total).toBe(7);
    expect(h.done).toBe(2);
    expect(h.overdue).toBe(1);
    expect(h.lastTouched).toBe('2026-08-20'); // latest ✅ (the yesterday mirror points at an unknown id)
    expect(h.flags).toContain('overdue');
    expect(h.phaseProgress.map((p) => p.state)).toEqual(['active', 'planned']);
    const u = projectHealth(index.snapshot, index.project('prj-oracle')!, TODAY, settings);
    expect(u.flags).not.toContain('no-next-action'); // umbrella with an active child
    const k = projectHealth(index.snapshot, index.project('prj-kitchen')!, TODAY, settings);
    expect(k.nextAction?.text).toBe('Get three quotes');
  });

  it('week and review', async () => {
    const { index, settings } = await setup();
    const w = weekView(index.snapshot, TODAY, settings, TODAY);
    expect(w.start).toBe('2026-08-24');
    expect(w.days[1]!.open.map((t) => t.text)).toEqual(['Start with OIB', 'Chapter 1', 'Fix router config']);
    expect(w.overdue.map((t) => t.text).sort()).toEqual(['Chapter 1', 'Renew passport']);
    const r = review(index.snapshot, TODAY, settings);
    expect(r.completedThisWeek.map((t) => t.text)).toEqual(['Pay invoice']);
    expect(r.inbox).toHaveLength(2);
    expect(r.activeCount).toBe(3);
    expect(r.throughput).toHaveLength(8);
    const ib = inboxItems(index.snapshot);
    expect(ib.inbox.map((t) => t.text)).toEqual(['Call the plumber', 'Renew passport']);
    expect([...ib.loose.keys()]).toEqual(['02 PROJECTS/Backlog Tasks.md']);
  });

  it('habit stats', async () => {
    const { index } = await setup();
    const s = habitStats(index.snapshot.habits.get('hab-workout')!, index.snapshot.completions, TODAY);
    expect(s.dueToday).toBe(true);
    expect(s.doneToday).toBe(false);
    expect(s.streak).toBe(1);
    expect(s.days[s.days.length - 2]!.state).toBe('done');
    expect(s.days[s.days.length - 1]!.state).toBe('pending');
    expect(s.days[s.days.length - 3]!.state).toBe('missed');
  });
});
