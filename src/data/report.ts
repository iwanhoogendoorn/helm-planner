/**
 * What goes into an exported report.
 *
 * A report is one period — a day, a week, a month, a quarter, a year — looked at from both ends: what
 * happened in it, and what is still coming. The looking-back half is the same arithmetic the Dashboard
 * uses, so a number on paper and a number on screen can never disagree. The looking-forward half is the
 * open work that falls inside the period, with the projects it belongs to.
 *
 * This file builds the data only. Nothing here knows about HTML, paper or Obsidian.
 */
import type { DaybookEntry } from '../core/daybook';
import type { Habit, HelmSettings, IsoDate, Project, Snapshot, Task } from '../core/types';
import { addDays, humanDate, isoWeek, isoWeekday, WEEKDAY_NAMES } from '../core/dates';
import { monthPeriod, quarterPeriod, weekPeriod, yearPeriod, type Period } from '../core/periods';
import { computeStats, doneDate, type DashboardStats } from './stats';
import { compareTasks, dayPlan, effortOf, goalProgress, isOpen, plannedDate, projectHealth, type DayPlan, type HorizonGoal, type ProjectHealth } from './planner';

export type ReportScope = 'day' | 'week' | 'month' | 'quarter' | 'year';

export const REPORT_SCOPES: { id: ReportScope; label: string }[] = [
  { id: 'day', label: 'Day' },
  { id: 'week', label: 'Week' },
  { id: 'month', label: 'Month' },
  { id: 'quarter', label: 'Quarter' },
  { id: 'year', label: 'Year' },
];

export interface ReportSections {
  /** What happened: totals, the shape of the period, adherence. */
  history: boolean;
  /** The day's own plan, or the week's days — only for a day or a week. */
  plan: boolean;
  /** Open work dated inside the period, and what is overdue going in. */
  ahead: boolean;
  projects: boolean;
  goals: boolean;
  habits: boolean;
  /** The diary, for a day or a week. */
  daybook: boolean;
}

export const ALL_SECTIONS: ReportSections = { history: true, plan: true, ahead: true, projects: true, goals: true, habits: true, daybook: true };

export interface ReportOptions {
  scope: ReportScope;
  /** Any date inside the period you want. */
  anchor: IsoDate;
  sections: ReportSections;
  /** One project only: the report becomes that project's story rather than a period's. */
  projectId?: string;
  /** Include projects that are finished, cancelled or archived. */
  includeClosedProjects?: boolean;
}

export interface AheadDay { date: IsoDate; tasks: Task[]; minutes: number }

export interface Report {
  title: string;
  /** “Week 36 · 31 Aug – 6 Sep 2026”. */
  subtitle: string;
  from: IsoDate;
  to: IsoDate;
  scope: ReportScope;
  /** Whether the period is over, running, or still to come — a report reads differently for each. */
  standing: 'past' | 'current' | 'future';
  today: IsoDate;
  sections: ReportSections;
  headline: { label: string; value: string; sub?: string }[];
  stats: DashboardStats;
  /** A day's own plan, when the report is one day. */
  plan?: DayPlan;
  /** The days of a week, when the report is one week. */
  days: { date: IsoDate; done: Task[]; open: Task[]; minutes: number }[];
  ahead: AheadDay[];
  /** Open and overdue before the period starts — what you carry in. */
  overdue: Task[];
  /** Open work inside the period with no day of its own. */
  undated: Task[];
  projects: ProjectHealth[];
  project?: Project;
  goals: HorizonGoal[];
  habits: { habit: Habit; rate: number; streak: number; scheduled: number; done: number }[];
  daybook: { date: IsoDate; entries: DaybookEntry[] }[];
}

/** The period a scope and an anchor land on. `day` has no Period of its own, so it is handled apart. */
export function rangeOf(scope: ReportScope, anchor: IsoDate, weekStartsOn: 1 | 7): { from: IsoDate; to: IsoDate; period?: Period } {
  if (scope === 'day') return { from: anchor, to: anchor };
  if (scope === 'week') {
    const wk = isoWeek(anchor);
    const p = weekPeriod(wk.year, wk.week);
    // Helm's own week can start on Sunday; the ISO week is Monday-based, so shift when it must.
    if (weekStartsOn === 7) return { from: addDays(p.start, -1), to: addDays(p.end, -1), period: p };
    return { from: p.start, to: p.end, period: p };
  }
  const p = scope === 'month' ? monthPeriod(Number(anchor.slice(0, 4)), Number(anchor.slice(5, 7)))
    : scope === 'quarter' ? quarterPeriod(Number(anchor.slice(0, 4)), Math.floor((Number(anchor.slice(5, 7)) - 1) / 3) + 1)
      : yearPeriod(Number(anchor.slice(0, 4)));
  return { from: p.start, to: p.end, period: p };
}

const pct = (n: number, of: number): number => (of > 0 ? Math.round((n / of) * 100) : 0);

/**
 * The diary lives on the index rather than in the snapshot, so a report is handed a way to ask for it
 * rather than reaching for it — which also keeps this file free of the index.
 */
export type DaybookFor = (date: IsoDate) => DaybookEntry[];

export function buildReport(snap: Snapshot, opts: ReportOptions, today: IsoDate, settings: HelmSettings, daybookFor?: DaybookFor): Report {
  const { from, to, period } = rangeOf(opts.scope, opts.anchor, settings.weekStartsOn);
  const standing = to < today ? 'past' : from > today ? 'future' : 'current';
  const project = opts.projectId ? snap.projects.get(opts.projectId) : undefined;

  const stats = computeStats(snap, {
    from, to, sources: ['daily', 'project', 'inbox', 'note'],
    ...(opts.projectId ? { projectId: opts.projectId } : {}),
  }, today, settings);

  // ── Looking forward: open work dated inside the period, by the day it is planned for ──
  const byDate = new Map<IsoDate, Task[]>();
  const undated: Task[] = [];
  const overdue: Task[] = [];
  for (const t of snap.tasks.values()) {
    if (!isOpen(t) || t.origin === 'daily-mirror') continue;
    if (opts.projectId && t.projectId !== opts.projectId) continue;
    const when = plannedDate(t) ?? t.due;
    if (when === undefined) {
      // Undated project work is worth listing for a project report; for a period it is noise.
      if (opts.projectId) undated.push(t);
      continue;
    }
    if (when < from) { if (when < today) overdue.push(t); continue; }
    if (when > to) continue;
    if (when < today) { overdue.push(t); continue; }
    const list = byDate.get(when) ?? [];
    list.push(t);
    byDate.set(when, list);
  }
  const ahead: AheadDay[] = [...byDate.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, tasks]) => ({ date, tasks: [...tasks].sort(compareTasks), minutes: tasks.reduce((s, t) => s + effortOf(t, settings), 0) }));
  overdue.sort(compareTasks);

  // ── The days themselves, for a day or a week ──
  const days: Report['days'] = [];
  if (opts.scope === 'week' || opts.scope === 'day') {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const done: Task[] = [];
      const open: Task[] = [];
      for (const t of snap.tasks.values()) {
        if (t.origin === 'daily-mirror') continue;
        if (doneDate(t) === d) done.push(t);
        else if (isOpen(t) && plannedDate(t) === d) open.push(t);
      }
      days.push({ date: d, done: done.sort(compareTasks), open: open.sort(compareTasks), minutes: open.reduce((s, t) => s + effortOf(t, settings), 0) });
    }
  }

  // ── Projects: the ones this period actually touched, plus anything due inside it ──
  const seen = new Set<string>();
  const projects: ProjectHealth[] = [];
  const wanted = (p: Project): boolean => {
    if (opts.projectId) return p.id === opts.projectId || p.parentId === opts.projectId;
    if (!opts.includeClosedProjects && (p.status === 'archived' || p.status === 'cancelled')) return false;
    if (p.due !== undefined && p.due >= from && p.due <= to) return true;
    if (period && p.period === period.key) return true;
    return stats.byProject.some((bp) => bp.project.id === p.id && bp.done + bp.open > 0);
  };
  for (const p of snap.projects.values()) {
    if (seen.has(p.id) || !wanted(p)) continue;
    seen.add(p.id);
    projects.push(projectHealth(snap, p, today, settings));
  }
  projects.sort((a, b) => b.progress - a.progress || a.project.title.localeCompare(b.project.title));

  // ── Goals bound to this period, or to the periods inside it ──
  const goals: HorizonGoal[] = [];
  for (const g of snap.goals.values()) {
    const gp = g.periodKey;
    const inside = period ? (gp === period.key || withinKey(gp, from, to)) : withinKey(gp, from, to);
    if (inside) goals.push(goalProgress(snap, g, today, settings));
  }

  const daybook: Report['daybook'] = [];
  if (opts.sections.daybook && (opts.scope === 'day' || opts.scope === 'week')) {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const entries = daybookFor?.(d) ?? [];
      if (entries.length > 0) daybook.push({ date: d, entries });
    }
  }

  const plan = opts.scope === 'day' ? dayPlan(snap, from, settings) : undefined;
  const openInPeriod = ahead.reduce((s, a) => s + a.tasks.length, 0);
  const headline = project
    ? [
        { label: 'Progress', value: `${pct(stats.byProject.find((b) => b.project.id === project.id)?.done ?? 0, (stats.byProject.find((b) => b.project.id === project.id)?.total ?? 0) || 1)}%`, sub: project.title },
        { label: 'Done in period', value: String(stats.totals.done) },
        { label: 'Still open', value: String(openInPeriod + undated.length) },
        { label: 'Overdue', value: String(overdue.length) },
      ]
    : [
        { label: standing === 'future' ? 'Planned' : 'Done', value: String(standing === 'future' ? openInPeriod : stats.totals.done), sub: standing === 'future' ? 'tasks in the period' : `of ${stats.totals.done + openInPeriod + overdue.length} in the period` },
        { label: 'Kept to the plan', value: `${Math.round(stats.adherence.rate * 100)}%`, sub: `${stats.adherence.done} of ${stats.adherence.planned} planned` },
        { label: 'Still to do', value: String(openInPeriod), sub: overdue.length > 0 ? `${overdue.length} overdue` : 'nothing overdue' },
        { label: 'Time on task', value: minutes(stats.totals.doneMinutes), sub: `${minutes(stats.totals.openMinutes)} still planned` },
      ];

  return {
    title: project ? project.title : titleOf(opts.scope, from, period),
    subtitle: subtitleOf(opts.scope, from, to, period, project ? titleOf(opts.scope, from, period) : undefined),
    from, to, scope: opts.scope, standing, today,
    sections: opts.sections,
    headline,
    stats,
    ...(plan ? { plan } : {}),
    days,
    ahead,
    overdue,
    undated: undated.sort(compareTasks),
    projects,
    ...(project ? { project } : {}),
    goals,
    habits: stats.habits,
    daybook,
  };
}

/** A goal's period key falls inside the range when the period it names does. */
function withinKey(key: string, from: IsoDate, to: IsoDate): boolean {
  const p = periodOfKey(key);
  return p !== undefined && p.start >= from && p.end <= to;
}

function periodOfKey(key: string): Period | undefined {
  const y = Number(key.slice(0, 4));
  if (!Number.isFinite(y)) return undefined;
  if (/^\d{4}$/.test(key)) return yearPeriod(y);
  if (/^\d{4}-Q[1-4]$/.test(key)) return quarterPeriod(y, Number(key.slice(6)));
  if (/^\d{4}-\d{2}$/.test(key)) return monthPeriod(y, Number(key.slice(5)));
  if (/^\d{4}-W\d{2}$/.test(key)) return weekPeriod(y, Number(key.slice(6)));
  return undefined;
}

const minutes = (m: number): string => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? `${m % 60}m` : ''}` : `${m}m`);

function titleOf(scope: ReportScope, from: IsoDate, period?: Period): string {
  if (scope === 'day') return humanDate(from, undefined, { year: true });
  return period?.label ?? from;
}

function subtitleOf(scope: ReportScope, from: IsoDate, to: IsoDate, period: Period | undefined, prefix?: string): string {
  // A day already says its date in the title, so its subtitle says where the day sits instead.
  const weekday = WEEKDAY_NAMES[isoWeekday(from) - 1] ?? '';
  const range = scope === 'day' ? `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)} · week ${isoWeek(from).week}` : `${humanDate(from)} – ${humanDate(to, undefined, { year: true })}`;
  const name = scope === 'week' && period ? `Week ${period.week}` : scope === 'day' ? '' : period?.label ?? '';
  const head = [prefix, name].filter(Boolean).join(' · ');
  return [head, range].filter(Boolean).join(' · ') || humanDate(from, undefined, { year: true });
}
