/**
 * Read-only planning intelligence over a Snapshot: what is on a day, what is
 * overdue, what a project's next action is, what needs review.
 */
import type { Goal, HelmSettings, IsoDate, Project, ProjectStatus, Snapshot, Task } from '../core/types';
import { parsePeriod, periodContains, periodsOfYear, periodWithin, type Period } from '../core/periods';
import { addDays, diffDays, startOfWeek } from '../core/dates';
import { isTerminal, priorityRank } from '../core/taskLine';
import { PROJECT_PRIORITY_RANK } from '../core/project';

/** Open = still to be done here. A forwarded `[>]` line is the record of a move, not work. */
export function isOpen(t: Task): boolean {
  return !isTerminal(t.status) && t.status !== 'forwarded';
}

export function isBlocked(t: Task, snap: Snapshot): boolean {
  return t.blockedBy.some((id) => { const b = snap.tasks.get(id); return b !== undefined && isOpen(b); });
}

/**
 * The day a task is planned for: scheduled, else the daily note it lives in —
 * unless the line is dated later than its note (a recurrence spawned in an
 * old note), in which case that later date is the plan.
 */
export function plannedDate(t: Task): IsoDate | undefined {
  if (t.scheduled) return t.scheduled;
  if (t.origin !== 'daily' || !t.noteDate) return undefined;
  return t.due !== undefined && t.due > t.noteDate ? t.due : t.noteDate;
}

/** A daily line that belongs in another day's note (dated later than the note it sits in). */
export function misfiledDate(t: Task): IsoDate | undefined {
  if (t.origin !== 'daily' || !t.noteDate || t.depth > 0 || t.status === 'done' || t.status === 'cancelled') return undefined;
  const d = t.scheduled ?? t.due;
  return d !== undefined && d > t.noteDate ? d : undefined;
}

export function effortOf(t: Task, settings: HelmSettings): number {
  return t.effortMinutes ?? settings.defaultEffortMinutes;
}

/** Sort: time block, then priority, then due, then text. */
export function compareTasks(a: Task, b: Task): number {
  if (a.time && b.time) { const c = a.time.start.localeCompare(b.time.start); if (c !== 0) return c; }
  else if (a.time) return -1;
  else if (b.time) return 1;
  const p = priorityRank(a.priority) - priorityRank(b.priority);
  if (p !== 0) return p;
  const ad = a.due ?? '9999';
  const bd = b.due ?? '9999';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.text.localeCompare(b.text);
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'anytime';
export const DAY_PARTS: DayPart[] = ['morning', 'afternoon', 'evening', 'anytime'];

/** One row on a day: the line in the note (or a project task not yet mirrored) and what to display. */
export interface DayItem {
  /** The task to act on (the mirror line when there is one). */
  task: Task;
  /** The task to display (the source for a mirror). */
  display: Task;
  part: DayPart;
  kind: 'daily' | 'mirror' | 'unmirrored' | 'elsewhere' | 'timeblock';
}

export interface DayPlan {
  date: IsoDate;
  /** Every open or done item on the day, by part. */
  byPart: Record<DayPart, DayItem[]>;
  items: DayItem[];
  /** Standalone tasks owned by the daily note (Today section + outside-region lines with text). */
  today: Task[];
  /** Mirror lines in the note, with their sources when resolved. */
  mirrors: { mirror: Task; source?: Task }[];
  /** Project tasks scheduled for this date that have no mirror line in the note yet. */
  unmirrored: Task[];
  /** Inbox/note tasks scheduled for this date (they live elsewhere). */
  elsewhere: Task[];
  timeBlocks: Task[];
  done: Task[];
  openCount: number;
  doneCount: number;
  plannedMinutes: number;
  doneMinutes: number;
}

export function dayPlan(snap: Snapshot, date: IsoDate, settings: HelmSettings): DayPlan {
  const plan: DayPlan = { date, byPart: { morning: [], afternoon: [], evening: [], anytime: [] }, items: [], today: [], mirrors: [], unmirrored: [], elsewhere: [], timeBlocks: [], done: [], openCount: 0, doneCount: 0, plannedMinutes: 0, doneMinutes: 0 };
  const mirroredSources = new Set<string>();
  for (const t of snap.tasks.values()) {
    if (t.depth > 0) continue; // subtasks travel with their parent
    if (t.origin === 'daily-mirror' && t.noteDate === date) {
      const source = t.mirrorOf ? snap.tasks.get(t.mirrorOf) : undefined;
      plan.mirrors.push({ mirror: t, ...(source ? { source } : {}) });
      if (t.mirrorOf) mirroredSources.add(t.mirrorOf);
    }
  }
  for (const t of snap.tasks.values()) {
    if (t.depth > 0) continue;
    if (t.origin === 'daily' && plannedDate(t) === date) {
      if (t.time && settings.showTimeBlocks && t.section === 'outside') plan.timeBlocks.push(t);
      else plan.today.push(t);
    } else if (t.origin === 'project' && t.scheduled === date && !mirroredSources.has(t.key)) plan.unmirrored.push(t);
    else if ((t.origin === 'inbox' || t.origin === 'note') && t.scheduled === date) plan.elsewhere.push(t);
  }
  const all = [...plan.today, ...plan.timeBlocks, ...plan.mirrors.map((m) => m.source ?? m.mirror), ...plan.unmirrored, ...plan.elsewhere];
  for (const t of all) {
    const e = effortOf(t, settings);
    if (isOpen(t)) { plan.openCount++; plan.plannedMinutes += e; }
    else { plan.doneCount++; plan.doneMinutes += e; if (t.status === 'done') plan.done.push(t); }
  }
  plan.today.sort(compareTasks);
  plan.timeBlocks.sort(compareTasks);
  plan.mirrors.sort((a, b) => compareTasks(a.source ?? a.mirror, b.source ?? b.mirror));
  plan.unmirrored.sort(compareTasks);
  const partOf = (t: Task): DayPart => t.part ?? (t.time ? (t.time.start < settings.morningEnds ? 'morning' : t.time.start < settings.afternoonEnds ? 'afternoon' : 'evening') : 'anytime');
  const push = (task: Task, display: Task, kind: DayItem['kind']): void => { const part = partOf(task); const it = { task, display, part, kind }; plan.items.push(it); plan.byPart[part].push(it); };
  for (const t of plan.timeBlocks) push(t, t, 'timeblock');
  for (const t of plan.today) push(t, t, 'daily');
  for (const m of plan.mirrors) push(m.mirror, m.source ?? m.mirror, 'mirror');
  for (const t of plan.unmirrored) push(t, t, 'unmirrored');
  for (const t of plan.elsewhere) push(t, t, 'elsewhere');
  for (const p of DAY_PARTS) plan.byPart[p].sort((a, b) => compareTasks(a.display, b.display));
  return plan;
}

export interface Candidate {
  task: Task;
  reason: 'overdue' | 'due-soon' | 'scheduled-past' | 'next-action' | 'inbox' | 'unblocked' | 'in-progress';
  score: number;
}

/** Everything worth pulling into a day, ranked. Excludes what is already on that day. */
export function candidates(snap: Snapshot, date: IsoDate, settings: HelmSettings, today: IsoDate): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const push = (task: Task, reason: Candidate['reason'], score: number): void => {
    if (seen.has(task.key)) return;
    seen.add(task.key);
    out.push({ task, reason, score });
  };
  const activeProjects = new Set([...snap.projects.values()].filter((p) => p.status === 'active').map((p) => p.id));
  const hasOpenChildren = (t: Task): boolean => t.childKeys.some((k) => { const c = snap.tasks.get(k); return c !== undefined && isOpen(c); });
  const isCandidateTask = (t: Task): boolean => {
    if (!isOpen(t) || t.origin === 'daily-mirror') return false;
    // Lines outside the Helm region of a daily note (the user's own planner slots) are a log, not a backlog.
    if (t.origin === 'daily' && t.section === 'outside') return false;
    // Already on a day that has not passed: today's work is still today's, tomorrow's is tomorrow's.
    const planned = plannedDate(t);
    if (planned !== undefined && planned >= today) return false;
    if (isBlocked(t, snap)) return false;
    if (t.start !== undefined && t.start > date) return false;
    // A parent whose children are still open is not actionable itself — unless it carries its own date.
    if (hasOpenChildren(t) && t.due === undefined && plannedDate(t) === undefined && t.origin !== 'inbox') return false;
    return true;
  };
  for (const t of snap.tasks.values()) {
    if (!isCandidateTask(t)) continue;
    if (t.origin === 'daily' && t.noteDate !== undefined && t.noteDate >= date) continue;
    const prio = 5 - priorityRank(t.priority);
    const projBoost = (t.projectId && activeProjects.has(t.projectId) ? 2 : 0) + horizonBoost(snap, t, date);
    if (t.due !== undefined && t.due < today) push(t, 'overdue', 100 + Math.min(30, diffDays(t.due, today)) + prio);
    else if (t.due !== undefined && diffDays(date, t.due) <= 3) push(t, 'due-soon', 80 + (3 - diffDays(date, t.due)) * 3 + prio);
    else if (plannedDate(t) !== undefined && plannedDate(t)! < today) push(t, 'scheduled-past', 70 + prio + projBoost);
    else if (t.status === 'doing') push(t, 'in-progress', 60 + prio + projBoost);
  }
  // Next actions of active projects.
  for (const p of snap.projects.values()) {
    if (p.status !== 'active') continue;
    const na = nextAction(snap, p);
    if (na && !seen.has(na.key) && isCandidateTask(na) && !(na.origin === 'daily' && na.noteDate !== undefined && na.noteDate >= date)) {
      push(na, 'next-action', 40 + (5 - PROJECT_PRIORITY_RANK[p.priority]) * 2 + (5 - priorityRank(na.priority)) + horizonBoost(snap, na, date));
    }
  }
  for (const t of snap.tasks.values()) {
    if (t.origin === 'inbox' && isCandidateTask(t) && !seen.has(t.key)) push(t, 'inbox', 20 + (5 - priorityRank(t.priority)));
  }
  void settings;
  return out.sort((a, b) => b.score - a.score || compareTasks(a.task, b.task));
}

/** A task whose project is bound to the current month / quarter / year is a little more urgent. */
export function horizonBoost(snap: Snapshot, t: Task, date: IsoDate): number {
  const p = t.projectId ? snap.projects.get(t.projectId) : undefined;
  const per = p?.period ? parsePeriod(p.period) : undefined;
  if (!per || !periodContains(per, date)) return 0;
  return per.kind === 'month' ? 3 : per.kind === 'quarter' ? 2 : 1;
}

/** First open, unblocked, startable task in document order: first phase with open work, else loose. */
export function nextAction(snap: Snapshot, p: Project): Task | undefined {
  const pick = (keys: string[]): Task | undefined => {
    const open = keys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined && isOpen(t) && !isBlocked(t, snap));
    // Prefer in-progress, then leaves (a parent whose children are open is not actionable itself).
    const leaves = open.filter((t) => !t.childKeys.some((c) => { const x = snap.tasks.get(c); return x !== undefined && isOpen(x); }));
    const doing = leaves.find((t) => t.status === 'doing');
    if (doing) return doing;
    return leaves.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.line - b.line)[0];
  };
  for (const ph of p.phases) {
    const t = pick(ph.taskKeys);
    if (t) return t;
  }
  return pick(p.looseTaskKeys);
}

export interface ProjectHealth {
  project: Project;
  total: number;
  done: number;
  open: number;
  overdue: number;
  progress: number; // 0..1
  nextAction?: Task;
  lastTouched?: IsoDate;
  staleDays?: number;
  flags: ('no-next-action' | 'stale' | 'overdue' | 'due-soon' | 'past-due' | 'blocked')[];
  phaseProgress: { phase: Project['phases'][number]; total: number; done: number; state: 'planned' | 'active' | 'done' }[];
}

export function projectHealth(snap: Snapshot, p: Project, today: IsoDate, settings: HelmSettings, depth = 0): ProjectHealth {
  const keys = [...p.phases.flatMap((ph) => ph.taskKeys), ...p.looseTaskKeys];
  // An umbrella's activity is its children's activity.
  const children = depth < 4 ? p.childIds.map((id) => snap.projects.get(id)).filter((c): c is Project => c !== undefined).map((c) => projectHealth(snap, c, today, settings, depth + 1)) : [];
  const tasks = keys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined);
  const done = tasks.filter((t) => t.status === 'done').length;
  const cancelled = tasks.filter((t) => t.status === 'cancelled').length;
  const open = tasks.filter(isOpen);
  const overdue = open.filter((t) => t.due !== undefined && t.due < today).length;
  const denom = tasks.length - cancelled;
  const na = p.status === 'active' || p.status === 'planned' ? nextAction(snap, p) : undefined;
  // Last touched: latest ✅/❌/➕ date, or mirror in a daily note, not in the future.
  let last: IsoDate | undefined;
  const bump = (d?: IsoDate): void => { if (d && d <= today && (last === undefined || d > last)) last = d; };
  for (const t of tasks) { bump(t.done); bump(t.cancelled); bump(t.created); }
  for (const t of snap.tasks.values()) if (t.origin === 'daily-mirror' && t.mirrorOf && keys.includes(t.mirrorOf)) bump(t.noteDate);
  for (const c of children) bump(c.lastTouched);
  if (!last && p.mtime) {
    const d = new Date(p.mtime);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    bump(iso);
  }
  const flags: ProjectHealth['flags'] = [];
  const stale = last ? diffDays(last, today) : undefined;
  const activeChildren = children.filter((c) => c.project.status === 'active');
  if (p.status === 'active') {
    if (!na && open.length > 0 && open.every((t) => isBlocked(t, snap))) flags.push('blocked');
    else if (!na && activeChildren.length === 0) flags.push('no-next-action');
    if (stale !== undefined && stale >= settings.staleProjectDays) flags.push('stale');
    if (overdue > 0) flags.push('overdue');
    if (p.due && p.due < today && open.length > 0) flags.push('past-due');
    else if (p.due && diffDays(today, p.due) <= 14 && open.length > 0) flags.push('due-soon');
  }
  const phaseProgress = p.phases.map((ph) => {
    const pt = ph.taskKeys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined && t.status !== 'cancelled');
    const pd = pt.filter((t) => t.status === 'done').length;
    const state: 'planned' | 'active' | 'done' = pt.length > 0 && pd === pt.length ? 'done' : pd > 0 || pt.some((t) => t.status === 'doing') ? 'active' : 'planned';
    return { phase: ph, total: pt.length, done: pd, state };
  });
  const out: ProjectHealth = { project: p, total: tasks.length, done, open: open.length, overdue, progress: denom === 0 ? 0 : done / denom, flags, phaseProgress };
  if (na) out.nextAction = na;
  if (last) out.lastTouched = last;
  if (stale !== undefined) out.staleDays = stale;
  return out;
}

export const PROJECT_STATUS_ORDER: ProjectStatus[] = ['active', 'planned', 'on-hold', 'idea', 'done', 'cancelled', 'archived'];

export function compareProjects(a: ProjectHealth, b: ProjectHealth): number {
  const s = PROJECT_STATUS_ORDER.indexOf(a.project.status) - PROJECT_STATUS_ORDER.indexOf(b.project.status);
  if (s !== 0) return s;
  const p = PROJECT_PRIORITY_RANK[a.project.priority] - PROJECT_PRIORITY_RANK[b.project.priority];
  if (p !== 0) return p;
  const ad = a.project.due ?? '9999';
  const bd = b.project.due ?? '9999';
  if (ad !== bd) return ad < bd ? -1 : 1;
  return a.project.title.localeCompare(b.project.title);
}

export interface DayBucket { date: IsoDate; open: Task[]; done: Task[]; minutes: number; dueUnplanned: Task[] }

/** Tasks on each day of [from, to]: planned lines (daily + mirrors + ⏳), done-on-that-day, and due-but-unplanned. */
export function tasksByDay(snap: Snapshot, from: IsoDate, to: IsoDate, settings: HelmSettings): Map<IsoDate, DayBucket> {
  const days = new Map<IsoDate, DayBucket>();
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, open: [], done: [], minutes: 0, dueUnplanned: [] });
  for (const t of snap.tasks.values()) {
    if (t.origin === 'goal' || t.depth > 0) continue;
    let d: IsoDate | undefined;
    if (t.origin === 'daily-mirror') { d = t.noteDate; if (t.mirrorOf && snap.tasks.has(t.mirrorOf)) continue; }
    else if (t.origin === 'daily') { if (t.section === 'outside' && (!t.time || !settings.showTimeBlocks)) continue; d = plannedDate(t); }
    else d = t.scheduled;
    const doneOn = t.status === 'done' ? (t.done ?? t.noteDate) : undefined;
    if (doneOn && days.has(doneOn)) days.get(doneOn)!.done.push(t);
    if (d !== undefined && days.has(d) && isOpen(t)) { const b = days.get(d)!; b.open.push(t); b.minutes += effortOf(t, settings); }
    if (isOpen(t) && t.origin !== 'daily-mirror' && t.due !== undefined && days.has(t.due) && plannedDate(t) === undefined) days.get(t.due)!.dueUnplanned.push(t);
  }
  for (const b of days.values()) { b.open.sort(compareTasks); b.done.sort(compareTasks); b.dueUnplanned.sort(compareTasks); }
  return days;
}

export interface WeekSummary {
  start: IsoDate;
  days: { date: IsoDate; open: Task[]; done: Task[]; minutes: number }[];
  overdue: Task[];
  unscheduledDue: Task[];
}

export function weekView(snap: Snapshot, anchor: IsoDate, settings: HelmSettings, today: IsoDate): WeekSummary {
  const start = startOfWeek(anchor, settings.weekStartsOn);
  const days = Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), open: [] as Task[], done: [] as Task[], minutes: 0 }));
  const idx = new Map(days.map((d, i) => [d.date, i]));
  const mirrored = new Set<string>();
  for (const t of snap.tasks.values()) if (t.origin === 'daily-mirror' && t.mirrorOf) mirrored.add(`${t.mirrorOf}@${t.noteDate}`);
  for (const t of snap.tasks.values()) {
    let d: IsoDate | undefined;
    if (t.origin === 'daily-mirror') { d = t.noteDate; if (t.mirrorOf && snap.tasks.has(t.mirrorOf)) continue; }
    else if (t.origin === 'daily') { if (t.section === 'outside' && t.time && !settings.showTimeBlocks) continue; d = plannedDate(t); }
    else d = t.scheduled ?? undefined;
    if (d === undefined) continue;
    const i = idx.get(d);
    if (i === undefined) continue;
    const day = days[i]!;
    if (isOpen(t)) { day.open.push(t); day.minutes += effortOf(t, settings); }
    else if (t.status === 'done') day.done.push(t);
  }
  for (const d of days) { d.open.sort(compareTasks); d.done.sort(compareTasks); }
  const overdue = [...snap.tasks.values()].filter((t) => isOpen(t) && t.origin !== 'daily-mirror' && t.due !== undefined && t.due < today).sort(compareTasks);
  const end = addDays(start, 6);
  const unscheduledDue = [...snap.tasks.values()].filter((t) => isOpen(t) && t.origin !== 'daily-mirror' && t.due !== undefined && t.due >= start && t.due <= end && plannedDate(t) === undefined).sort(compareTasks);
  return { start, days, overdue, unscheduledDue };
}

export interface ReviewReport {
  weekStart: IsoDate;
  completedThisWeek: Task[];
  completedByProject: { title: string; count: number }[];
  overdue: Task[];
  inbox: Task[];
  waiting: Task[];
  dueNext14: Task[];
  projects: ProjectHealth[];
  attention: ProjectHealth[];
  activeCount: number;
  staleCount: number;
  noNextActionCount: number;
  throughput: { weekStart: IsoDate; done: number }[];
}

export function review(snap: Snapshot, today: IsoDate, settings: HelmSettings): ReviewReport {
  const weekStart = startOfWeek(today, settings.weekStartsOn);
  const tasks = [...snap.tasks.values()].filter((t) => t.origin !== 'daily-mirror');
  const completedThisWeek = tasks.filter((t) => t.status === 'done' && (t.done ?? t.noteDate ?? '') >= weekStart && (t.done ?? t.noteDate ?? '') <= today);
  const byProj = new Map<string, number>();
  for (const t of completedThisWeek) { const k = t.projectTitle ?? (t.origin === 'daily' ? 'Daily notes' : 'Loose'); byProj.set(k, (byProj.get(k) ?? 0) + 1); }
  const projects = [...snap.projects.values()].map((p) => projectHealth(snap, p, today, settings)).sort(compareProjects);
  const attention = projects.filter((h) => h.flags.length > 0);
  const throughput: ReviewReport['throughput'] = [];
  for (let w = 7; w >= 0; w--) {
    const ws = addDays(weekStart, -7 * w);
    const we = addDays(ws, 6);
    throughput.push({ weekStart: ws, done: tasks.filter((t) => t.status === 'done' && (t.done ?? t.noteDate ?? '') >= ws && (t.done ?? t.noteDate ?? '') <= we).length });
  }
  return {
    weekStart,
    completedThisWeek: completedThisWeek.sort((a, b) => (b.done ?? '').localeCompare(a.done ?? '')),
    completedByProject: [...byProj.entries()].map(([title, count]) => ({ title, count })).sort((a, b) => b.count - a.count),
    overdue: tasks.filter((t) => isOpen(t) && t.due !== undefined && t.due < today).sort(compareTasks),
    inbox: tasks.filter((t) => t.origin === 'inbox' && isOpen(t) && t.depth === 0),
    waiting: tasks.filter((t) => t.status === 'waiting'),
    dueNext14: tasks.filter((t) => isOpen(t) && t.due !== undefined && t.due >= today && diffDays(today, t.due) <= 14).sort((a, b) => a.due!.localeCompare(b.due!)),
    projects,
    attention,
    activeCount: projects.filter((h) => h.project.status === 'active').length,
    staleCount: projects.filter((h) => h.flags.includes('stale')).length,
    noNextActionCount: projects.filter((h) => h.flags.includes('no-next-action')).length,
    throughput,
  };
}

/** Everything that is open and has no date and no project: needs triage. */
export function inboxItems(snap: Snapshot): { inbox: Task[]; loose: Map<string, Task[]>; unscheduledProject: Task[] } {
  const inbox: Task[] = [];
  const loose = new Map<string, Task[]>();
  const unscheduledProject: Task[] = [];
  for (const t of snap.tasks.values()) {
    if (!isOpen(t) || t.depth > 0) continue;
    if (t.origin === 'inbox') inbox.push(t);
    else if (t.origin === 'note') loose.set(t.path, [...(loose.get(t.path) ?? []), t]);
    else if (t.origin === 'project' && t.due === undefined && t.scheduled === undefined) unscheduledProject.push(t);
  }
  return { inbox: inbox.sort((a, b) => a.line - b.line), loose, unscheduledProject };
}

/* ── Horizons: year → quarters → months, goals and the projects bound to them ── */

export interface HorizonGoal {
  goal: Goal;
  projects: ProjectHealth[];
  /** 0..1 — from linked projects' tasks, else from the goal's own checkbox. */
  progress: number;
  taskTotal: number;
  taskDone: number;
}

export interface HorizonPeriod {
  period: Period;
  goals: HorizonGoal[];
  /** Projects bound exactly to this period. */
  projects: ProjectHealth[];
  /** Everything bound to this period or any period inside it. */
  projectsWithin: ProjectHealth[];
  openTasks: number;
  doneTasks: number;
  isCurrent: boolean;
  isPast: boolean;
}

export interface Horizons { year: HorizonPeriod; quarters: HorizonPeriod[]; months: HorizonPeriod[] }

export function goalProgress(snap: Snapshot, g: Goal, today: IsoDate, settings: HelmSettings): HorizonGoal {
  const projects = g.projectIds.map((id) => snap.projects.get(id)).filter((p): p is Project => p !== undefined).map((p) => projectHealth(snap, p, today, settings));
  const taskTotal = projects.reduce((s, h) => s + h.total, 0);
  const taskDone = projects.reduce((s, h) => s + h.done, 0);
  const progress = g.status === 'done' ? 1 : taskTotal > 0 ? taskDone / taskTotal : 0;
  return { goal: g, projects, progress, taskTotal, taskDone };
}

/** Goals and bound projects of one period. */
export function horizonPeriod(snap: Snapshot, period: Period, today: IsoDate, settings: HelmSettings, cache?: Map<string, ProjectHealth>): HorizonPeriod {
  const health = cache ?? new Map<string, ProjectHealth>();
  const hOf = (p: Project): ProjectHealth => { let h = health.get(p.id); if (!h) { h = projectHealth(snap, p, today, settings); health.set(p.id, h); } return h; };
  const all = [...snap.projects.values()].map((p) => ({ p, per: p.period ? parsePeriod(p.period) : undefined })).filter((x): x is { p: Project; per: Period } => x.per !== undefined);
  const exact = all.filter((x) => x.per.key === period.key).map((x) => hOf(x.p)).sort(compareProjects);
  const within = all.filter((x) => periodWithin(x.per, period)).map((x) => hOf(x.p)).sort(compareProjects);
  const goals = [...snap.goals.values()].filter((g) => g.periodKey === period.key).sort((a, b) => a.line - b.line).map((g) => goalProgress(snap, g, today, settings));
  return {
    period, goals, projects: exact, projectsWithin: within,
    openTasks: within.reduce((s, h) => s + h.open, 0), doneTasks: within.reduce((s, h) => s + h.done, 0),
    isCurrent: periodContains(period, today), isPast: period.end < today,
  };
}

export function horizons(snap: Snapshot, year: number, today: IsoDate, settings: HelmSettings): Horizons {
  const cache = new Map<string, ProjectHealth>();
  const build = (period: Period): HorizonPeriod => horizonPeriod(snap, period, today, settings, cache);
  const py = periodsOfYear(year);
  return { year: build(py.year), quarters: py.quarters.map(build), months: py.months.map(build) };
}

/** The follow-ups spawned from a task (tasks tagged as follow-ups that depend on its id), open first. */
/** The tasks that continue this one: anything waiting on its id (⛔). */
export function followUpsOf(snap: Snapshot, t: Task): Task[] {
  if (!t.id) return [];
  const id = t.id;
  return [...snap.tasks.values()].filter((x) => x.origin !== 'daily-mirror' && x.blockedBy.includes(id)).sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || (a.scheduled ?? a.noteDate ?? '').localeCompare(b.scheduled ?? b.noteDate ?? ''));
}

/** The task a follow-up continues, when it is one. */
export function followsOf(snap: Snapshot, t: Task): Task | undefined {
  for (const id of t.blockedBy) { const src = [...snap.tasks.values()].find((x) => x.id === id && x.origin !== 'daily-mirror'); if (src) return src; }
  return undefined;
}
