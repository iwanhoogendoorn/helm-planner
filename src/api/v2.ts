/**
 * The v2 routes: everything the iPhone app needs beyond tasks and projects. Each handler is a thin
 * shell around a planner / stats / report / search / habits function or a Mutations method — the
 * rules live there, not here. `handleV2` answers `undefined` for a path it does not know, and
 * routes.ts turns that into a 404 or 405.
 */
import type { ApiRequest, ApiResponse } from './routes';
import { asRecord, bad, day, findTask, has, made, missing, notAllowed, num, ok, PARTS, str, strList } from './routes';
import { candidateJson, dayItemJson, daybookJson, goalJson, habitJson, horizonPeriodJson, layoutJson, periodJson, refOf, taskJson, type Ctx } from './json';
import { addDays, diffDays, isIsoDate } from '../core/dates';
import type { DayPart } from '../core/dailyNote';
import { HABIT_COLORS, HABIT_PARTS, type Goal, type Habit, type HabitColor, type HabitPart, type IsoDate, type Task } from '../core/types';
import { candidates, dayPlan, horizonPeriod, horizons, inboxItems, tasksByDay, weekView, wrapUpItems } from '../data/planner';
import { ghostHabits, habitHistories, habitsOnDay, habitStats } from '../data/habits';
import { layOutDay } from '../data/timegrid';
import { layOutDayPlan } from '../core/pomodoro';
import { bookingsOn } from '../data/conflicts';
import { parsePeriod, periodOf, type PeriodKind } from '../core/periods';
import { parseRecurrence } from '../core/recurrence';
import { baseName } from '../data/vault';
import { review, reviewChecklist } from '../data/planner';
import { computeStats, filterOptions, STATS_SOURCES, type DashboardStats, type StatsFilter, type StatsSource } from '../data/stats';
import { parseQuery, search, startingPoints } from '../data/search';
import { parseCapture } from '../core/nlp';
import { captureDestination, captureFields } from '../data/capture';
import { attachmentsJson, healthOf, hitJson, projectJson } from './json';
import type { DrawingTarget, Priority } from '../core/types';
import { PRIORITIES } from './routes';
import { ALL_SECTIONS, buildReport, REPORT_SCOPES, type Report, type ReportScope, type ReportSections } from '../data/report';

/** Heads v2 owns: an unmatched method on one of these is a 405, anything else a 404. */
const HEADS = new Set(['settings', 'day', 'focus', 'habits', 'inbox', 'week', 'calendar', 'periods', 'horizons', 'goals', 'review', 'stats', 'search', 'capture', 'notes', 'files', 'report', 'report.pdf', 'maintenance']);

export async function handleV2(req: ApiRequest, d: Ctx): Promise<ApiResponse | undefined> {
  const parts = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [head] = parts;
  const method = req.method.toUpperCase();
  const r = await route(parts, method, req, d);
  if (r) return r;
  return head !== undefined && HEADS.has(head) ? notAllowed(method, req.path) : undefined;
}

async function route(parts: string[], method: string, req: ApiRequest, d: Ctx): Promise<ApiResponse | undefined> {
  const [head, ref, sub, sub2, sub3] = parts;
  const body = asRecord(req.body);
  if (head === 'settings' && method === 'GET' && parts.length === 1) return ok(settingsJson(d));

  if (head === 'day' && ref !== undefined) {
    if (!isIsoDate(ref)) return bad('The day must be a date like 2026-09-11');
    const date = ref;
    if (sub === undefined && method === 'GET') return ok(dayJson(date, d));
    if (sub === 'note' && method === 'POST') { const path = await d.mutations.ensureDailyNote(date); return ok({ path, written: d.written() }); }
    if (sub === 'habits' && method === 'POST') { const added = await d.mutations.syncHabitsForDay(date); return ok({ added, written: d.written() }); }
    if (sub === 'candidates' && method === 'GET') {
      const plan = dayPlan(d.index.snapshot, date, d.settings());
      const list = candidates(d.index.snapshot, date, d.settings(), d.today());
      return ok({ date, capacityMinutes: d.settings().dailyCapacityMinutes, plannedMinutes: plan.plannedMinutes, candidates: list.map((x) => candidateJson(x, d)) });
    }
    if (sub === 'plan' && method === 'POST') return planDay(date, body, d);
    if (sub === 'wrapup' && method === 'GET') {
      const plan = dayPlan(d.index.snapshot, date, d.settings());
      const items = wrapUpItems(d.index.snapshot, plan);
      return ok({
        date, open: items.open.map((it) => dayItemJson(it, d)),
        suggestedDate: addDays(date, 1), rolloverTarget: d.settings().rolloverTarget,
        projectsTouched: items.projectsTouched.map((id) => ({ id, title: d.index.project(id)?.title ?? id })),
        doneCount: plan.doneCount, doneMinutes: plan.doneMinutes,
      });
    }
    if (sub === 'wrapup' && method === 'POST') return wrapUp(date, body, d);
    if (sub === 'rollover' && method === 'POST') {
      if (has(body, 'to') && body['to'] !== null && !day(body['to'])) return bad('to must be a date like 2026-09-12, or null to unschedule');
      const to = has(body, 'to') ? day(body['to']) : addDays(date, 1);
      const r = await d.mutations.rollover(date, to);
      return ok({ ...r, written: d.written() });
    }
    if (sub === 'daybook') return daybook(date, sub2, sub3, method, body, d);
    if (sub === 'attachments' && method === 'GET') return ok(attachmentsJson({ kind: 'date', date, title: date }, d));
    if (sub === 'notes' && method === 'POST') return createNote({ kind: 'date', date, title: date }, body, d);
  }

  if (head === 'focus' && ref === 'layout' && method === 'POST') return focusLayout(body, d);

  if (head === 'habits') return habitsRoute(ref, sub, method, req.query, body, d);

  if (head === 'inbox' && method === 'GET' && parts.length === 1) {
    const r = inboxItems(d.index.snapshot);
    return ok({
      inbox: r.inbox.map((t) => taskJson(t, d)),
      loose: [...r.loose.entries()].map(([path, tasks]) => ({ path, title: baseName(path), tasks: tasks.map((t) => taskJson(t, d)) })),
      unscheduledProject: r.unscheduledProject.map((t) => taskJson(t, d)),
    });
  }

  if (head === 'week' && method === 'GET' && parts.length === 1) {
    const anchor = req.query['anchor'] ?? req.query['date'] ?? d.today();
    if (!isIsoDate(anchor)) return bad('anchor must be a date like 2026-09-11');
    const w = weekView(d.index.snapshot, anchor, d.settings(), d.today());
    return ok({
      start: w.start, end: addDays(w.start, 6), capacityMinutes: d.settings().dailyCapacityMinutes,
      days: w.days.map((x) => ({ date: x.date, open: x.open.map((t) => taskJson(t, d)), done: x.done.map((t) => taskJson(t, d)), minutes: x.minutes })),
      overdue: w.overdue.map((t) => taskJson(t, d)),
      unscheduledDue: w.unscheduledDue.map((t) => taskJson(t, d)),
    });
  }

  if (head === 'calendar' && method === 'GET' && parts.length === 1) {
    const from = req.query['from'];
    const to = req.query['to'];
    if (!from || !to || !isIsoDate(from) || !isIsoDate(to)) return bad('from and to must be dates like 2026-09-01');
    if (to < from) return bad('to must not be before from');
    if (diffDays(from, to) > 400) return bad('At most 400 days at a time');
    const embed = req.query['tasks'] === 'true';
    const days = tasksByDay(d.index.snapshot, from, to, d.settings());
    const list = embed ? (ts: Task[]) => ts.map((t) => taskJson(t, d)) : (ts: Task[]) => ts.map(refOf);
    return ok({
      from, to,
      days: [...days.values()].map((b) => ({ date: b.date, open: b.open.length, done: b.done.length, dueUnplanned: b.dueUnplanned.length, minutes: b.minutes, ...(embed ? { openTasks: list(b.open), doneTasks: list(b.done), dueUnplannedTasks: list(b.dueUnplanned) } : { openRefs: list(b.open), doneRefs: list(b.done), dueUnplannedRefs: list(b.dueUnplanned) }) })),
    });
  }

  if (head === 'periods' && ref !== undefined) {
    const period = parsePeriod(ref);
    if (!period) return bad(`Not a period: ${ref} (try 2026, 2026-Q3, 2026-09 or 2026-W37)`);
    if (sub === undefined && method === 'GET') return ok(horizonPeriodJson(horizonPeriod(d.index.snapshot, period, d.today(), d.settings(), d.health), d));
    if (sub === 'note' && method === 'POST') { const path = await d.mutations.ensurePeriodicNote(period); return ok({ path, period: periodJson(period, d), written: d.written() }); }
    if (sub === 'attachments' && method === 'GET') return ok(attachmentsJson({ kind: 'period', key: period.key, title: period.key }, d));
    if (sub === 'notes' && method === 'POST') return createNote({ kind: 'period', key: period.key, title: period.key }, body, d);
  }

  if (head === 'horizons' && method === 'GET' && parts.length === 1) {
    const year = Number(req.query['year'] ?? d.today().slice(0, 4));
    if (!Number.isInteger(year) || year < 1970 || year > 2200) return bad('year must be a four-digit year');
    const h = horizons(d.index.snapshot, year, d.today(), d.settings());
    return ok({ year: horizonPeriodJson(h.year, d), quarters: h.quarters.map((q) => horizonPeriodJson(q, d)), months: h.months.map((m) => horizonPeriodJson(m, d)), current: { year: periodOf(d.today(), 'year').key, quarter: periodOf(d.today(), 'quarter').key, month: periodOf(d.today(), 'month').key, week: periodOf(d.today(), 'week').key } });
  }

  if (head === 'goals') {
    if (method === 'GET' && ref === undefined) {
      const key = req.query['period'];
      const goals = d.index.allGoals().filter((g) => !key || g.periodKey === parsePeriod(key)?.key).sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.line - b.line);
      return ok({ goals: goals.map((g) => goalJson(g, d)) });
    }
    if (method === 'POST' && ref === undefined) {
      const periodKey = str(body['periodKey']) ?? str(body['period']);
      const text = str(body['text']);
      if (!periodKey || !parsePeriod(periodKey)) return bad('periodKey must be a period like 2026, 2026-Q3, 2026-09 or 2026-W37');
      if (!text) return bad('A goal needs text');
      const id = await d.mutations.addGoal(parsePeriod(periodKey)!.key, text);
      const g = findGoal(id, d);
      return made({ goal: g ? goalJson(g, d) : { id }, written: d.written() });
    }
    if (ref !== undefined && sub === undefined && (method === 'PATCH' || method === 'PUT')) {
      const g = findGoal(ref, d);
      if (!g) return missing(`No goal ${ref}`);
      let touched = false;
      if (has(body, 'status')) {
        const st = str(body['status']);
        if (!st || !['todo', 'done', 'cancelled'].includes(st)) return bad('status must be one of todo, done, cancelled');
        await d.mutations.setStatus(g.key, st as 'todo' | 'done' | 'cancelled');
        touched = true;
      }
      if (str(body['text'])) { await d.mutations.updateTask(g.key, { text: str(body['text'])! }); touched = true; }
      if (!touched) return bad('Nothing to change');
      const after = findGoal(g.id, d) ?? findGoal(g.key, d);
      return ok({ goal: after ? goalJson(after, d) : null, written: d.written() });
    }
    if (ref !== undefined && sub === undefined && method === 'DELETE') {
      const g = findGoal(ref, d);
      if (!g) return missing(`No goal ${ref}`);
      await d.mutations.deleteTask(g.key);
      return ok({ deleted: g.id, written: d.written() });
    }
  }

  if (head === 'review' && method === 'GET' && parts.length === 1) {
    const r = review(d.index.snapshot, d.today(), d.settings());
    for (const h of r.projects) d.health.set(h.project.id, h);
    const tasks = (ts: Task[]): Record<string, unknown>[] => ts.map((t) => taskJson(t, d));
    return ok({
      weekStart: r.weekStart, completedThisWeek: tasks(r.completedThisWeek), completedByProject: r.completedByProject,
      overdue: tasks(r.overdue), inbox: tasks(r.inbox), waiting: tasks(r.waiting), dueNext14: tasks(r.dueNext14),
      projects: r.projects.map((h) => projectJson(h.project, d, { health: true })),
      attention: r.attention.map((h) => projectJson(h.project, d, { health: true })),
      activeCount: r.activeCount, staleCount: r.staleCount, noNextActionCount: r.noNextActionCount, throughput: r.throughput,
      checklist: reviewChecklist(r),
      goalsInPlay: (['month', 'quarter', 'year'] as const).map((k) => periodOf(d.today(), k)).flatMap((per) => d.index.allGoals().filter((g) => g.periodKey === per.key).map((g) => goalJson(g, d))),
    });
  }

  if (head === 'stats' && method === 'GET') {
    if (ref === 'options' && parts.length === 2) {
      const fo = filterOptions(d.index.snapshot);
      return ok({ ...fo, sources: STATS_SOURCES, projects: d.index.allProjects().map((p) => healthOf(p, d)).sort((a, b) => a.project.title.localeCompare(b.project.title)).map((h) => ({ id: h.project.id, title: h.project.title, status: h.project.status })), periods: { year: periodOf(d.today(), 'year').key, quarter: periodOf(d.today(), 'quarter').key, month: periodOf(d.today(), 'month').key, week: periodOf(d.today(), 'week').key } });
    }
    if (parts.length === 1) return statsRoute(req.query, d);
  }

  if (head === 'search' && method === 'GET') {
    if (ref === 'starting-points' && parts.length === 2) return ok({ groups: startingPoints(d.index.snapshot, d.today()).map((g) => ({ label: g.label, icon: g.icon, hits: g.hits.map((h) => hitJson(h, d)) })) });
    if (parts.length === 1) {
      const q = req.query['q'] ?? '';
      const limit = Math.min(Math.max(1, Number(req.query['limit'] ?? 50) || 50), 500);
      return ok({ query: parseQuery(q, d.today()), hits: search(d.index.snapshot, q, { today: d.today(), limit }).map((h) => hitJson(h, d)) });
    }
  }

  if (head === 'capture' && method === 'POST') {
    if (ref === 'parse' && parts.length === 2) return captureRoute(body, d, false);
    if (parts.length === 1) return captureRoute(body, d, true);
  }

  if (head === 'notes' && method === 'DELETE' && parts.length === 1) {
    const path = str(body['path']) ?? req.query['path'];
    if (!path) return bad('Send the note path');
    if (!d.index.snapshot.notes.has(path)) return missing(`${path} is not a note attached to anything Helm knows`);
    await d.mutations.deleteNote(path);
    return ok({ deleted: path, written: d.written() });
  }

  if (head === 'report' && method === 'GET' && parts.length === 1) return reportRoute(req.query, d);
  if (head === 'report.pdf' && method === 'GET' && parts.length === 1) return { status: 501, body: { error: "PDF export needs Obsidian's window: it renders the report in a hidden Electron webview. Use GET /report and lay it out on the phone, or export from Obsidian." } };

  if (head === 'maintenance' && method === 'POST' && parts.length === 2) {
    if (ref === 'rebuild') { const t0 = Date.now(); await d.index.rebuild(); const snap = d.index.snapshot; return ok({ rebuilt: true, ms: Date.now() - t0, revision: d.index.revision, counts: { tasks: snap.tasks.size, projects: snap.projects.size, habits: snap.habits.size } }); }
    if (ref === 'reconcile') { const fixed = await d.mutations.reconcile(); return ok({ fixed, written: d.written() }); }
    if (ref === 'move-recurring') { const moved = await d.mutations.moveMisfiled({ onlyFuture: body['onlyFuture'] !== false }); return ok({ moved, written: d.written() }); }
    if (ref === 'catch-up-recurring') { const ahead = num(body['aheadDays']); const spawned = await d.mutations.catchUpRecurring(ahead); return ok({ spawned, written: d.written() }); }
  }

  if (head === 'files' && method === 'GET' && parts.length === 1) {
    const path = (req.query['path'] ?? '').replace(/^\/+/, '');
    if (!path) return bad('Send the path of a markdown file the index knows');
    if (path.split('/').some((seg) => seg === '..' || seg === '.') || !path.endsWith('.md')) return missing('Only markdown files inside the vault are served');
    if (!d.index.hasFile(path)) return missing(`${path} is not a file the index knows`);
    try {
      const content = await d.read(path);
      return ok({ path, content, mtime: d.index.snapshot.notes.get(path)?.mtime ?? null, kind: d.index.fileKind(path) ?? null });
    } catch { return missing(`${path} could not be read`); }
  }

  return undefined;
}

async function createNote(target: DrawingTarget, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const path = await d.mutations.createNote(target, { ...(str(body['name']) ? { name: str(body['name'])! } : {}), ...(str(body['folder']) ? { folder: str(body['folder'])! } : {}) });
  return made({ path, attachments: attachmentsJson(target, d), written: d.written() });
}

/* ── Report ────────────────────────────────────────────────────────────── */

export function reportRoute(q: Record<string, string>, d: Ctx, projectId?: string): ApiResponse {
  const scope = (q['scope'] ?? d.settings().reportScope) as ReportScope;
  if (!REPORT_SCOPES.some((x) => x.id === scope)) return bad(`scope must be one of ${REPORT_SCOPES.map((x) => x.id).join(', ')}`);
  const anchor = q['anchor'] ?? d.today();
  if (!isIsoDate(anchor)) return bad('anchor must be a date like 2026-09-11');
  const names = Object.keys(ALL_SECTIONS) as (keyof ReportSections)[];
  const wanted = (q['sections'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const unknown = wanted.filter((x) => !names.includes(x as keyof ReportSections));
  if (unknown.length) return bad(`sections must be from ${names.join(', ')}`);
  const sections: ReportSections = wanted.length ? Object.fromEntries(names.map((n) => [n, wanted.includes(n)])) as unknown as ReportSections : { ...ALL_SECTIONS };
  const pid = projectId ?? q['project'];
  if (pid && !d.index.project(pid)) return missing(`No project ${pid}`);
  const report = buildReport(d.index.snapshot, { scope, anchor, sections, ...(pid ? { projectId: pid } : {}), includeClosedProjects: q['includeClosed'] === 'true' }, d.today(), d.settings(), (date) => d.index.daybook(date));
  return ok(reportJson(report, d));
}

/** A Report on the wire: Maps become objects keyed by project id, tasks are embedded (it is a print view). */
export function reportJson(r: Report, d: Ctx): Record<string, unknown> {
  for (const h of r.projects) d.health.set(h.project.id, h);
  const tasks = (ts: Task[]): Record<string, unknown>[] => ts.map((t) => taskJson(t, d));
  const plan = r.plan;
  return {
    title: r.title, subtitle: r.subtitle, from: r.from, to: r.to, scope: r.scope, standing: r.standing, today: r.today, sections: r.sections,
    headline: r.headline,
    stats: statsJson(r.stats, d),
    plan: plan ? {
      date: plan.date,
      byPart: Object.fromEntries((Object.keys(plan.byPart) as (keyof typeof plan.byPart)[]).map((k) => [k, plan.byPart[k].map((it) => dayItemJson(it, d))])),
      timeBlocks: tasks(plan.timeBlocks), done: tasks(plan.done),
      openCount: plan.openCount, doneCount: plan.doneCount, plannedMinutes: plan.plannedMinutes, doneMinutes: plan.doneMinutes,
    } : null,
    days: r.days.map((x) => ({ date: x.date, done: tasks(x.done), open: tasks(x.open), minutes: x.minutes })),
    ahead: r.ahead.map((a) => ({ date: a.date, tasks: tasks(a.tasks), minutes: a.minutes })),
    overdue: tasks(r.overdue),
    leftBehind: r.leftBehind,
    undated: tasks(r.undated),
    projects: r.projects.map((h) => projectJson(h.project, d, { health: true })),
    projectDepths: Object.fromEntries(r.projectDepths),
    projectWork: Object.fromEntries([...r.projectWork.entries()].map(([id, w]) => [id, { groups: w.groups.map((g) => ({ title: g.title ?? null, tasks: g.tasks.map((pt) => ({ task: taskJson(pt.task, d), depth: pt.depth })) })), more: w.more }])),
    project: r.project ? projectJson(r.project, d, { health: true }) : null,
    goals: r.goals.map((g) => goalJson(g.goal, d, g)),
    habits: r.habits.map((h) => ({ id: h.habit.id, title: h.habit.title, icon: h.habit.icon ?? null, color: h.habit.color ?? null, rate: h.rate, streak: h.streak, scheduled: h.scheduled, done: h.done })),
    daybook: r.daybook.map((x) => ({ date: x.date, entries: daybookJson(x.entries) })),
  };
}

/* ── Stats ─────────────────────────────────────────────────────────────── */

function statsRoute(q: Record<string, string>, d: Ctx): ApiResponse {
  const today = d.today();
  const to = q['to'] ?? today;
  const from = q['from'] ?? addDays(to, -29);
  if (!isIsoDate(from) || !isIsoDate(to)) return bad('from and to must be dates like 2026-09-01');
  if (to < from) return bad('to must not be before from');
  if (diffDays(from, to) > 400) return bad('At most 400 days at a time');
  const sources = (q['sources'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const unknown = sources.filter((x) => !STATS_SOURCES.includes(x as StatsSource));
  if (unknown.length) return bad(`sources must be from ${STATS_SOURCES.join(', ')}`);
  if (q['project'] && !d.index.project(q['project'])) return missing(`No project ${q['project']}`);
  if (q['period'] && !parsePeriod(q['period'])) return bad(`Not a period: ${q['period']}`);
  const filter: StatsFilter = { from, to, ...(sources.length ? { sources: sources as StatsSource[] } : {}), ...(q['project'] ? { projectId: q['project'] } : {}), ...(q['area'] ? { area: q['area'] } : {}), ...(q['tag'] ? { tag: q['tag'].replace(/^#/, '') } : {}), ...(q['period'] ? { periodKey: parsePeriod(q['period'])!.key } : {}) };
  return ok(statsJson(computeStats(d.index.snapshot, filter, today, d.settings()), d));
}

/** DashboardStats on the wire: every task list becomes refs, projects/habits/goals become summaries. */
export function statsJson(st: DashboardStats, d: Ctx): Record<string, unknown> {
  const refs = (ts: Task[]): string[] => ts.map(refOf);
  const series = (xs: { key: string; label: string; value: number; tasks: Task[] }[]): Record<string, unknown>[] => xs.map((x) => ({ key: x.key, label: x.label, value: x.value, taskRefs: refs(x.tasks) }));
  return {
    filter: st.filter, days: st.days, totals: st.totals,
    perDay: series(st.perDay),
    perWeek: st.perWeek.map((w) => ({ weekStart: w.weekStart, done: w.done, created: w.created, taskRefs: refs(w.tasks) })),
    cumulative: st.cumulative,
    byPart: Object.fromEntries(Object.entries(st.byPart).map(([k, v]) => [k, { done: v.done, planned: v.planned, taskRefs: refs(v.tasks) }])),
    byWeekday: series(st.byWeekday),
    adherence: { planned: st.adherence.planned, done: st.adherence.done, carried: st.adherence.carried, rate: st.adherence.rate, taskRefs: refs(st.adherence.tasks) },
    byProject: st.byProject.map((p) => ({ project: { id: p.project.id, title: p.project.title, status: p.project.status, area: p.project.area ?? null }, done: p.done, open: p.open, total: p.total, velocity: p.velocity, etaWeeks: p.etaWeeks ?? null, progress: p.progress, doneTaskRefs: refs(p.doneTasks) })),
    byArea: series(st.byArea), byTag: series(st.byTag), ageBuckets: series(st.ageBuckets),
    habits: st.habits.map((h) => ({ id: h.habit.id, title: h.habit.title, icon: h.habit.icon ?? null, color: h.habit.color ?? null, rate: h.rate, streak: h.streak, scheduled: h.scheduled, done: h.done })),
    goals: st.goals.map((g) => ({ id: g.goal.id, text: g.goal.text, periodKey: g.goal.periodKey, status: g.goal.status, progress: g.progress, projects: g.projects })),
    streak: st.streak,
    ...(d.index.ready ? {} : { partial: true }),
  };
}

/* ── Capture ───────────────────────────────────────────────────────────── */

/** Parse a line the way the Capture dialog does, apply explicit overrides, and (when `write`) add the task the way its Enter does. */
async function captureRoute(body: Record<string, unknown>, d: Ctx, write: boolean): Promise<ApiResponse> {
  const text = typeof body['text'] === 'string' ? body['text'] : '';
  if (text.trim() === '') return bad('Send the text to capture');
  const s = d.settings();
  const c = parseCapture(text, d.today(), s.weekStartsOn);
  // Overrides on top of the grammar, exactly the dialog's controls.
  const scheduled = has(body, 'scheduled') || has(body, 'date') ? (body['scheduled'] ?? body['date']) : undefined;
  if (scheduled !== undefined && scheduled !== null && !day(scheduled)) return bad('scheduled must be a date like 2026-09-11, or null');
  const date = scheduled === null ? undefined : day(scheduled) ?? c.scheduled;
  const partRaw = str(body['part']);
  if (partRaw && !PARTS.includes(partRaw as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
  const part = (partRaw as DayPart | undefined) ?? c.part;
  const projectId = str(body['projectId']);
  if (projectId && !d.index.project(projectId)) return missing(`No project ${projectId}`);
  const project = projectId ? d.index.project(projectId) : c.project ? d.index.projectByTitle(c.project) : undefined;
  const phaseId = str(body['phaseId']);
  if (phaseId && !project?.phases.some((p) => p.id === phaseId)) return bad(`No phase ${phaseId} in that project`);
  if (has(body, 'due') && body['due'] !== null && !day(body['due'])) return bad('due must be a date like 2026-09-20');
  if (has(body, 'due')) c.due = body['due'] === null ? undefined : day(body['due']);
  if (str(body['priority'])) { const p = str(body['priority'])!; if (!PRIORITIES.includes(p as Priority)) return bad(`priority must be one of ${PRIORITIES.join(', ')}`); c.priority = p as Priority; }
  const effort = num(body['effortMinutes']);
  let time = c.time;
  if (has(body, 'time')) {
    if (body['time'] === null) time = undefined;
    else { const st = str(body['time']); if (!st || !/^\d{2}:\d{2}$/.test(st)) return bad('time must be HH:MM'); const en = str(body['timeEnd']); if (en && !/^\d{2}:\d{2}$/.test(en)) return bad('timeEnd must be HH:MM'); time = { start: st, ...(en ? { end: en } : {}) }; }
  } else if (str(body['timeEnd']) && time) time = { ...time, end: str(body['timeEnd'])! };
  if (has(body, 'recurrence')) {
    if (body['recurrence'] === null) c.recurrence = undefined;
    else { const r = parseRecurrence(str(body['recurrence']) ?? ''); if (!r.parsed) return bad('recurrence must be a rule like "every week on monday"'); c.recurrence = r; }
  }
  let finalText = c.text;
  const tags = new Set(c.tags);
  for (const tag of strList(body['tags']).map((x) => x.replace(/^#/, ''))) { if (!tags.has(tag)) { finalText = `${finalText} #${tag}`; tags.add(tag); } }
  const fields = captureFields(c, effort, time);
  const dest = captureDestination({ ...(project ? { project } : {}), ...(phaseId ? { phaseId } : {}), ...(date ? { date } : {}), ...(part ? { part } : {}), ...(time ? { time } : {}), settings: s });
  const parsed = {
    text: finalText, tags: [...tags], priority: c.priority, scheduled: date ?? null, due: c.due ?? null,
    // The part shown is the chosen one, else the one the time implies (the dialog says “(by time)” for that).
    part: part ?? dest.part ?? null, partByTime: !part && dest.part !== undefined,
    effortMinutes: fields.effortMinutes ?? null, time: time?.start ?? null, timeEnd: time?.end ?? null,
    recurrence: fields.recurrence?.raw ?? null,
    project: project ? { id: project.id, title: project.title } : null,
    unknownProject: !project && c.project ? c.project : null,
    destination: dest,
  };
  if (!write) return ok(parsed);
  if (c.project && !project && !projectId) return bad(`@${c.project} is not a project Helm knows; send projectId, or drop the @`);
  const t = await d.mutations.addTaskReturning({ text: finalText, fields, ...(project ? { projectId: project.id } : {}), ...(phaseId ? { phaseId } : {}), ...(date ? { date } : {}), ...(date && part ? { part } : {}) });
  return made({ task: taskJson(t, d), parsed, destination: dest, written: d.written() });
}

export function findGoal(ref: string, d: Ctx): Goal | undefined {
  return d.index.goal(ref) ?? d.index.allGoals().find((g) => g.id === ref);
}

/* ── Habits ────────────────────────────────────────────────────────────── */

function findHabit(ref: string, d: Ctx): Habit | undefined {
  return d.index.snapshot.habits.get(ref) ?? ghostHabits(d.index.snapshot.habits, d.index.snapshot.completions).find((h) => h.id === ref);
}

const HABIT_STATES = ['done', 'skipped', 'missed', 'pending'] as const;

async function habitsRoute(ref: string | undefined, sub: string | undefined, method: string, query: Record<string, string>, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse | undefined> {
  const snap = d.index.snapshot;
  if (ref === undefined && method === 'GET') {
    const all = query['all'] === 'true';
    const habits = [...d.index.allHabits().filter((h) => all || h.active), ...(all ? ghostHabits(snap.habits, snap.completions) : [])];
    return ok({ habits: habits.map((h) => habitJson(h, d)) });
  }
  if (ref === undefined && method === 'POST') {
    const title = str(body['title']);
    const schedule = str(body['schedule']);
    if (!title) return bad('A habit needs a title');
    if (!schedule || !parseRecurrence(schedule).parsed) return bad('schedule must be a rule Helm understands, like "every weekday" or "every week on monday, thursday"');
    const parts = strList(body['parts']);
    if (parts.some((p) => !HABIT_PARTS.includes(p as HabitPart))) return bad(`parts must be from ${HABIT_PARTS.join(', ')}`);
    const color = str(body['color']);
    if (color && !HABIT_COLORS.includes(color as HabitColor)) return bad(`color must be one of ${HABIT_COLORS.join(', ')}`);
    const id = await d.mutations.createHabit({ title, schedule, ...(num(body['targetPerWeek']) !== undefined ? { targetPerWeek: num(body['targetPerWeek'])! } : {}), ...(num(body['graceDays']) !== undefined ? { graceDays: num(body['graceDays'])! } : {}), ...(str(body['icon']) ? { icon: str(body['icon'])! } : {}), ...(parts.length ? { parts: parts as HabitPart[] } : {}), ...(color ? { color: color as HabitColor } : {}) });
    const h = findHabit(id, d);
    return made({ habit: h ? habitJson(h, d) : { id }, written: d.written() });
  }
  if (ref === undefined) return undefined;
  const h = findHabit(ref, d);
  if (!h) return missing(`No habit ${ref}`);
  if (sub === undefined && method === 'GET') {
    const kind = query['history'];
    if (kind !== undefined && !['week', 'month', 'quarter', 'year'].includes(kind)) return bad('history must be week, month, quarter or year');
    const out = habitJson(h, d);
    if (kind) {
      const hist = habitHistories([h], snap.completions, kind as PeriodKind, d.today());
      const row = hist.rows[0]!;
      out['history'] = { kind, periods: hist.periods.map((p) => periodJson(p, d)), cells: row.cells.map((c) => ({ period: c.period.key, due: c.due, done: c.done, rate: c.rate, state: c.state })), due: row.due, done: row.done, rate: row.rate, streak: row.streak, bestStreak: row.bestStreak, from: row.from };
    }
    return ok(out);
  }
  if (sub === undefined && (method === 'PATCH' || method === 'PUT')) {
    if (h.removed) return bad('This habit has no note any more; recreate it first');
    const fields: Parameters<typeof d.mutations.setHabitFields>[1] = {};
    if (has(body, 'active')) { if (typeof body['active'] !== 'boolean') return bad('active must be true or false'); fields.active = body['active']; }
    if (has(body, 'schedule')) { const sch = str(body['schedule']); if (!sch || !parseRecurrence(sch).parsed) return bad('schedule must be a rule Helm understands'); fields.schedule = sch; }
    if (str(body['title'])) fields.title = str(body['title'])!;
    if (has(body, 'targetPerWeek')) { const n = body['targetPerWeek'] === null ? null : num(body['targetPerWeek']); if (n === undefined) return bad('targetPerWeek must be a number or null'); fields.targetPerWeek = n; }
    if (has(body, 'graceDays')) { const n = num(body['graceDays']); if (n === undefined || n < 0) return bad('graceDays must be a number'); fields.graceDays = n; }
    if (has(body, 'icon')) fields.icon = str(body['icon']) ?? '';
    if (has(body, 'iconImage')) fields.iconImage = body['iconImage'] === null ? null : str(body['iconImage']) ?? null;
    if (has(body, 'parts')) { const parts = strList(body['parts']); if (parts.some((p) => !HABIT_PARTS.includes(p as HabitPart))) return bad(`parts must be from ${HABIT_PARTS.join(', ')}`); fields.parts = parts as HabitPart[]; }
    if (has(body, 'color')) { const c = body['color'] === null ? null : str(body['color']); if (c && !HABIT_COLORS.includes(c as HabitColor)) return bad(`color must be one of ${HABIT_COLORS.join(', ')}`); fields.color = (c ?? null) as HabitColor | null; }
    if (Object.keys(fields).length === 0) return bad('Nothing to change');
    await d.mutations.setHabitFields(h.id, fields);
    const after = findHabit(h.id, d);
    return ok({ habit: after ? habitJson(after, d) : null, written: d.written() });
  }
  if (sub === undefined && method === 'DELETE') {
    if (h.removed) return bad('This habit has no note any more');
    await d.mutations.deleteHabit(h.id);
    return ok({ deleted: h.id, written: d.written() });
  }
  if (sub === 'state' && method === 'POST') {
    const date = day(body['date']) ?? d.today();
    const state = str(body['state']);
    if (!state || !HABIT_STATES.includes(state as typeof HABIT_STATES[number])) return bad(`state must be one of ${HABIT_STATES.join(', ')}`);
    const part = str(body['part']);
    if (part && !HABIT_PARTS.includes(part as HabitPart)) return bad(`part must be one of ${HABIT_PARTS.join(', ')}`);
    if (h.parts?.length && !part) return bad(`This habit is done per part of the day; send part: ${h.parts.join(' | ')}`);
    const placeIn = str(body['placeIn']);
    if (placeIn && !HABIT_PARTS.includes(placeIn as HabitPart)) return bad(`placeIn must be one of ${HABIT_PARTS.join(', ')}`);
    // "pending" undoes a tick the way the Today tab does: the line goes back to `[ ]`.
    await d.mutations.setHabitState(h.id, date, state === 'pending' ? 'missed' : state as 'done' | 'skipped' | 'missed', part as HabitPart | undefined, placeIn ? { placeIn: placeIn as HabitPart } : {});
    const row = habitsOnDay([findHabit(h.id, d) ?? h], d.index.snapshot.completions, date)[0];
    return ok({ id: h.id, date, occurrences: (row?.occurrences ?? []).map((o) => ({ part: o.part ?? null, state: o.state, line: o.line ?? null })), written: d.written() });
  }
  if (sub === 'move' && method === 'POST') {
    const date = day(body['date']) ?? d.today();
    const part = body['part'] === null ? undefined : str(body['part']);
    if (part && !HABIT_PARTS.includes(part as HabitPart)) return bad(`part must be one of ${HABIT_PARTS.join(', ')}, or null for the Habits list`);
    if (h.parts?.length) return bad('A habit with fixed parts of the day cannot be moved for a day');
    await d.mutations.moveHabitForDay(h.id, date, part as HabitPart | undefined);
    return ok({ id: h.id, date, part: part ?? null, written: d.written() });
  }
  if (sub === 'attachments' && method === 'GET') return ok(attachmentsJson({ kind: 'habit', id: h.id, title: h.title }, d));
  if (sub === 'notes' && method === 'POST') return createNote({ kind: 'habit', id: h.id, title: h.title }, body, d);
  if (sub === 'pause' && method === 'POST') {
    if (h.removed) return bad('This habit has no note any more');
    if (!h.active) return bad('Already paused');
    await d.mutations.setHabitFields(h.id, { active: false });
    return ok({ habit: habitJson(findHabit(h.id, d) ?? h, d), written: d.written() });
  }
  if (sub === 'resume' && method === 'POST') {
    if (h.removed) return bad('This habit has no note any more');
    if (h.active) return bad('Not paused');
    await d.mutations.setHabitFields(h.id, { active: true });
    return ok({ habit: habitJson(findHabit(h.id, d) ?? h, d), written: d.written() });
  }
  return undefined;
}

/* ── Day ───────────────────────────────────────────────────────────────── */

export function dayJson(date: IsoDate, d: Ctx): Record<string, unknown> {
  const snap = d.index.snapshot;
  const settings = d.settings();
  const plan = dayPlan(snap, date, settings);
  const seen = new Set<string>();
  const shown: Task[] = [];
  for (const it of plan.items) { const t = it.display; if (!seen.has(t.key)) { seen.add(t.key); shown.push(t); } }
  const habits = habitsOnDay(d.index.allHabits(), snap.completions, date).map((row) => {
    const st = habitStats(row.habit, snap.completions, d.today(), settings.weekStartsOn, 14);
    const h = row.habit;
    return { id: h.id, title: h.title, icon: h.icon ?? null, iconImage: h.iconImage ?? null, color: h.color ?? null, parts: h.parts ?? [], dueToday: row.due, occurrences: row.occurrences.map((o) => ({ part: o.part ?? null, state: o.state, line: o.line ?? null })), streak: st.streak };
  });
  const heading = d.index.daybookHeadingLine(date);
  return {
    date,
    notePath: snap.dailyNotes.get(date)?.path ?? null,
    isToday: date === d.today(),
    byPart: { morning: plan.byPart.morning.map((it) => dayItemJson(it, d)), afternoon: plan.byPart.afternoon.map((it) => dayItemJson(it, d)), evening: plan.byPart.evening.map((it) => dayItemJson(it, d)), anytime: plan.byPart.anytime.map((it) => dayItemJson(it, d)) },
    timeBlocks: plan.timeBlocks.map((t) => taskJson(t, d)),
    done: plan.done.map((t) => taskJson(t, d)),
    openCount: plan.openCount, doneCount: plan.doneCount, plannedMinutes: plan.plannedMinutes, doneMinutes: plan.doneMinutes, capacityMinutes: settings.dailyCapacityMinutes,
    habits,
    daybook: { heading: heading ?? null, entries: daybookJson(d.index.daybook(date)) },
    timeline: layoutJson(layOutDay(date, shown, settings), d),
  };
}

/** The Plan-day modal's confirm button: plan the picked items (the daily note and its habits come first), then unschedule the removed ones. */
async function planDay(date: IsoDate, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const rawItems = Array.isArray(body['items']) ? body['items'] as unknown[] : [];
  const items: { key: string; part?: DayPart }[] = [];
  for (const raw of rawItems) {
    const it = asRecord(raw);
    const ref = str(it['ref']) ?? str(it['id']) ?? str(it['key']);
    if (!ref) return bad('Every item needs a ref');
    const t = findTask(ref, d);
    if (!t) return missing(`No task ${ref}`);
    const part = str(it['part']);
    if (part && !PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
    items.push({ key: t.key, ...(part ? { part: part as DayPart } : {}) });
  }
  const removeRefs = Array.isArray(body['remove']) ? (body['remove'] as unknown[]).map((x) => (typeof x === 'string' ? x : '')).filter(Boolean) : [];
  const remove: Task[] = [];
  for (const ref of removeRefs) { const t = findTask(ref, d); if (!t) return missing(`No task ${ref}`); remove.push(t); }
  if (items.length === 0 && remove.length === 0 && body['habits'] !== true) return bad('Nothing to plan: send items, remove, or habits: true');
  // planDay ensures the note and syncs the day's habits itself; with nothing to add, `habits: true` still does that.
  if (items.length > 0 || body['habits'] === true) await d.mutations.planDay(date, items);
  for (const t of remove) await d.mutations.schedule(t.key, undefined);
  return ok({ planned: items.length, removed: remove.length, written: d.written() });
}

const FATES = ['tomorrow', 'date', 'unschedule', 'done', 'cancelled', 'keep'] as const;

/** The Wrap-up modal's Apply button, decision by decision; one failing item does not stop the rest. */
async function wrapUp(date: IsoDate, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const decisions = Array.isArray(body['decisions']) ? body['decisions'] as unknown[] : [];
  const logs = Array.isArray(body['log']) ? body['log'] as unknown[] : [];
  if (decisions.length === 0 && logs.length === 0) return bad('Send decisions and/or log entries');
  // Validate everything first so a bad body changes nothing.
  const todo: { ref: string; fate: typeof FATES[number]; when?: IsoDate; part?: DayPart }[] = [];
  for (const raw of decisions) {
    const dec = asRecord(raw);
    const ref = str(dec['ref']);
    const fate = str(dec['fate']);
    if (!ref) return bad('Every decision needs a ref');
    if (!fate || !FATES.includes(fate as typeof FATES[number])) return bad(`fate must be one of ${FATES.join(', ')}`);
    const when = fate === 'date' ? day(dec['date']) : fate === 'tomorrow' ? addDays(date, 1) : undefined;
    if (fate === 'date' && !when) return bad('A "date" fate needs a date like 2026-09-15');
    const part = str(dec['part']);
    if (part && !PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
    todo.push({ ref, fate: fate as typeof FATES[number], ...(when ? { when } : {}), ...(part ? { part: part as DayPart } : {}) });
  }
  const entries: { projectId: string; text: string }[] = [];
  for (const raw of logs) {
    const e = asRecord(raw);
    const projectId = str(e['projectId']);
    const text = str(e['text']);
    if (!projectId || !text) return bad('Every log entry needs a projectId and text');
    if (!d.index.project(projectId)) return missing(`No project ${projectId}`);
    entries.push({ projectId, text });
  }
  const today = d.today();
  let applied = 0;
  const failed: { ref: string; error: string }[] = [];
  for (const x of todo) {
    try {
      const t = findTask(x.ref, d);
      if (!t) throw new Error(`No task ${x.ref}`);
      switch (x.fate) {
        case 'tomorrow':
        case 'date': {
          // A mirror on a day that has passed keeps a forwarded record, as the modal leaves one.
          if (t.origin === 'daily-mirror' && date < today) await d.mutations.setStatus(t.key, 'forwarded').catch(() => undefined);
          await d.mutations.schedule(t.key, x.when, x.part);
          break;
        }
        case 'unschedule': await d.mutations.schedule(t.key, undefined); break;
        case 'done': await d.mutations.setStatus(t.key, 'done'); break;
        case 'cancelled': await d.mutations.setStatus(t.key, 'cancelled'); break;
        case 'keep': break;
      }
      applied++;
    } catch (e) {
      failed.push({ ref: x.ref, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const e of entries) {
    try { await d.mutations.appendLog(e.projectId, e.text); } catch (err) { failed.push({ ref: e.projectId, error: err instanceof Error ? err.message : String(err) }); }
  }
  return ok({ applied, logged: entries.length - failed.filter((f) => entries.some((e) => e.projectId === f.ref)).length, failed, written: d.written() });
}

async function daybook(date: IsoDate, lineRef: string | undefined, tail: string | undefined, method: string, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse | undefined> {
  if (lineRef === undefined) {
    if (method === 'GET') return ok({ date, heading: d.index.daybookHeadingLine(date) ?? null, entries: daybookJson(d.index.daybook(date)) });
    if (method === 'POST') {
      const text = str(body['text']);
      if (!text) return bad('An entry needs text');
      const time = str(body['time']);
      if (time && !/^\d{2}:\d{2}$/.test(time)) return bad('time must be HH:MM');
      await d.mutations.addDaybookEntry(date, text, { ...(time ? { time } : {}), ...(str(body['icon']) ? { icon: str(body['icon'])! } : {}) });
      return made({ date, entries: daybookJson(d.index.daybook(date)), written: d.written() });
    }
    return undefined;
  }
  const line = Number(lineRef);
  if (!Number.isInteger(line) || line < 0) return bad('The entry is addressed by its line number');
  const entry = d.index.daybook(date).find((e) => e.line === line);
  if (!entry) return missing(`No daybook entry at line ${line} on ${date}`);
  if (tail === undefined && (method === 'PATCH' || method === 'PUT')) {
    const text = str(body['text']);
    if (!text) return bad('An entry needs text');
    await d.mutations.updateDaybookEntry(date, line, text);
    return ok({ date, entries: daybookJson(d.index.daybook(date)), written: d.written() });
  }
  if (tail === undefined && method === 'DELETE') {
    await d.mutations.removeDaybookEntry(date, line);
    return ok({ date, removed: line, entries: daybookJson(d.index.daybook(date)), written: d.written() });
  }
  if (tail === 'replies' && method === 'POST') {
    const text = str(body['text']);
    if (!text) return bad('A reply needs text');
    await d.mutations.addDaybookReply(date, line, text, str(body['icon']));
    return made({ date, entries: daybookJson(d.index.daybook(date)), written: d.written() });
  }
  return undefined;
}

/** The Plan-day "lay out the day" helper: focus blocks and breaks from a start time, around what is already booked. */
async function focusLayout(body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const s = d.settings();
  const start = str(body['start']) ?? (s.dayStarts || '09:00');
  if (!/^\d{2}:\d{2}$/.test(start)) return bad('start must be HH:MM');
  const end = str(body['end']) ?? (s.dayEnds || '18:00');
  if (!/^\d{2}:\d{2}$/.test(end)) return bad('end must be HH:MM');
  const rawTasks = Array.isArray(body['tasks']) ? body['tasks'] as unknown[] : [];
  if (rawTasks.length === 0) return bad('tasks must be a list of { ref, minutes }');
  const tasks: { key: string; minutes: number }[] = [];
  for (const raw of rawTasks) {
    const it = asRecord(raw);
    const ref = str(it['ref']) ?? str(it['key']);
    if (!ref) return bad('Every task needs a ref');
    const t = findTask(ref, d);
    const minutes = num(it['minutes']) ?? t?.effortMinutes ?? s.defaultEffortMinutes;
    tasks.push({ key: t ? (t.id ?? t.key) : ref, minutes });
  }
  const date = day(body['date']);
  if (has(body, 'date') && !date) return bad('date must be a date like 2026-09-11');
  const busy = date ? bookingsOn(d.index.snapshot, date, s).filter((b) => !tasks.some((t) => t.key === b.key || t.key === b.task.id)).map((b) => ({ start: b.start, end: b.end })) : [];
  const laid = layOutDayPlan(tasks, { focusMaxMinutes: s.focusMaxMinutes, focusMinMinutes: s.focusMinMinutes, breakMinutes: s.breakMinutes, longBreakMinutes: s.longBreakMinutes, blocksBeforeLongBreak: s.blocksBeforeLongBreak, from: start, to: end, busy });
  return ok({ from: start, to: end, busy, ...laid });
}

/** The client-relevant subset of the settings: what a phone needs to draw a day and size its captures. */
export function settingsJson(d: Ctx): Record<string, unknown> {
  const s = d.settings();
  return {
    dayStarts: s.dayStarts, dayEnds: s.dayEnds, morningEnds: s.morningEnds, afternoonEnds: s.afternoonEnds,
    dailyCapacityMinutes: s.dailyCapacityMinutes, defaultEffortMinutes: s.defaultEffortMinutes, weekStartsOn: s.weekStartsOn,
    captureTags: s.captureTags.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean),
    followupTag: s.followupTag, staleProjectDays: s.staleProjectDays, rolloverTarget: s.rolloverTarget, showTimeBlocks: s.showTimeBlocks,
    focus: { focusMaxMinutes: s.focusMaxMinutes, focusMinMinutes: s.focusMinMinutes, breakMinutes: s.breakMinutes, longBreakMinutes: s.longBreakMinutes, blocksBeforeLongBreak: s.blocksBeforeLongBreak },
    daybookHeading: s.daybookHeading, projectsFolder: s.projectsFolder, habitsFolder: s.habitsFolder, inboxNote: s.inboxNote, goalsHeading: s.goalsHeading,
    defaultCaptureTime: s.defaultCaptureTime, foldStepsByDefault: s.foldStepsByDefault, defaultTab: s.defaultTab,
    dailyNoteFolder: d.index.dailyFolder(), dailyNoteFormat: d.index.dailyFormat(),
  };
}
