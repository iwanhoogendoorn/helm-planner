/**
 * How Helm's domain objects look on the wire. One place, so a task is the same JSON whether it comes
 * back from a list, a day, a search hit or a report. Everything here is a pure function of the
 * snapshot; the request-scoped `Ctx` carries a project-health cache so a list of eighty projects
 * does not compute the same health eighty times.
 */
import type { DaybookEntry } from '../core/daybook';
import type { Drawing } from '../core/drawing';
import type { NoteRef } from '../core/noteRef';
import { plainLabel } from '../core/label';
import { linksIn } from '../core/links';
import type { Period } from '../core/periods';
import type { DrawingTarget, Goal, Habit, HelmSettings, IsoDate, Project, Task } from '../core/types';
import type { HelmIndex } from '../data/index';
import type { Mutations } from '../data/mutations';
import { habitStats, type HabitStats } from '../data/habits';
import { followsOf, followUpsOf, goalProgress, isBlocked, isOpen, plannedDate, projectHealth, type Candidate, type DayItem, type HorizonGoal, type HorizonPeriod, type ProjectHealth } from '../data/planner';
import { profileFor } from '../core/profiles';
import type { SearchHit } from '../data/search';
import type { DayLayout } from '../data/timegrid';

export interface ApiDeps {
  index: HelmIndex;
  mutations: Mutations;
  settings: () => HelmSettings;
  today: () => IsoDate;
  version: string;
  /** Paths written while handling this request, for the reply. */
  written: () => string[];
  /** The vault's folder name, for `GET /health`. */
  vaultName?: string;
}

/** One request's view of the world: the deps plus a health cache that lives as long as the request. */
export interface Ctx extends ApiDeps {
  health: Map<string, ProjectHealth>;
}

export const ctxOf = (d: ApiDeps): Ctx => ({ ...d, health: new Map() });

/**
 * A task's address on the wire: its 🆔, or its index key when it has none yet. A mirror line on a day
 * is addressed by its own key (`id@date`) — that is the line a day acts on, and the id belongs to the source.
 */
export const refOf = (t: Task): string => (t.origin === 'daily-mirror' ? t.key : t.id ?? t.key);

export function healthOf(p: Project, c: Ctx): ProjectHealth {
  let h = c.health.get(p.id);
  if (!h) { h = projectHealth(c.index.snapshot, p, c.today(), c.settings()); c.health.set(p.id, h); }
  return h;
}

export function taskJson(t: Task, c: Ctx): Record<string, unknown> {
  const p = t.projectId ? c.index.project(t.projectId) : undefined;
  const kids = t.childKeys.map((k) => c.index.task(k)).filter((x): x is Task => x !== undefined);
  const mirrorSrc = t.mirrorOf ? c.index.task(t.mirrorOf) : undefined;
  const { raw: _raw, ...recurrenceParsed } = t.recurrence ?? { raw: undefined };
  void _raw;
  return {
    id: t.id ?? null,
    key: t.key,
    ref: refOf(t),
    text: t.text,
    title: plainLabel(t.text),
    status: t.status,
    open: isOpen(t),
    blocked: isBlocked(t, c.index.snapshot),
    source: t.origin,
    path: t.path,
    line: t.line,
    depth: t.depth,
    ...(p ? { project: { id: p.id, title: p.title } } : {}),
    projectTitle: t.projectTitle ?? p?.title ?? null,
    phaseId: t.phaseId ?? null,
    ...(t.phaseTitle ? { phase: t.phaseTitle } : {}),
    scheduled: plannedDate(t) ?? null,
    due: t.due ?? null,
    created: t.created ?? null,
    start: t.start ?? null,
    done: t.done ?? null,
    cancelled: t.cancelled ?? null,
    noteDate: t.noteDate ?? null,
    section: t.section ?? null,
    part: t.part ?? null,
    time: t.time?.start ?? null,
    timeEnd: t.time?.end ?? null,
    timeBlock: t.time ? { start: t.time.start, ...(t.time.end ? { end: t.time.end } : {}) } : null,
    effortMinutes: t.effortMinutes ?? null,
    effortRaw: t.effortRaw ?? null,
    progress: t.progress ?? null,
    priority: t.priority,
    tags: t.tags,
    links: linksIn(t.text).map((l) => ({ url: l.url, label: l.label })),
    blockedBy: t.blockedBy,
    parentId: t.parentKey ? c.index.task(t.parentKey)?.id ?? null : null,
    parentRef: t.parentKey ? (c.index.task(t.parentKey) ? refOf(c.index.task(t.parentKey)!) : null) : null,
    subtasks: kids.map((k) => ({ id: k.id ?? null, key: k.key, ref: refOf(k), text: k.text, status: k.status })),
    recurrence: t.recurrence?.raw ?? null,
    recurrenceParsed: t.recurrence ? recurrenceParsed : null,
    mirrorOf: mirrorSrc ? refOf(mirrorSrc) : t.mirrorOf ?? null,
    mirrorLink: t.mirrorLink ?? null,
    periodKey: t.periodKey ?? null,
  };
}

/** A task with its subtasks as a tree (`children`), note order, up to `depth` levels. */
export function taskTree(t: Task, c: Ctx, depth = 5): Record<string, unknown> {
  const kids = depth > 0 ? t.childKeys.map((k) => c.index.task(k)).filter((x): x is Task => x !== undefined) : [];
  return { ...taskJson(t, c), children: kids.map((k) => taskTree(k, c, depth - 1)) };
}

export function targetOfTask(t: Task): DrawingTarget {
  return { kind: 'task', key: t.key, ...(t.id ? { id: t.id } : {}), title: t.text };
}

/** The whole task, as `GET /tasks/:id` returns it: the tree, what follows it, what it follows, what is attached. */
export function taskDetailJson(t: Task, c: Ctx): Record<string, unknown> {
  const snap = c.index.snapshot;
  const follows = followsOf(snap, t);
  return {
    ...taskTree(t, c),
    followUps: followUpsOf(snap, t).map(refOf),
    follows: follows ? refOf(follows) : null,
    attachments: attachmentsJson(targetOfTask(t), c),
  };
}

export function noteRefJson(n: NoteRef): Record<string, unknown> {
  return { path: n.path, title: n.title, kind: 'note', mtime: n.mtime ?? null };
}

export function drawingJson(d: Drawing): Record<string, unknown> {
  return { path: d.path, title: d.title, kind: d.kind, mtime: d.mtime ?? null };
}

export function attachmentsJson(target: DrawingTarget, c: Ctx): { notes: Record<string, unknown>[]; drawings: Record<string, unknown>[] } {
  return { notes: c.index.notesFor(target).map(noteRefJson), drawings: c.index.drawingsFor(target).map(drawingJson) };
}

export function healthJson(h: ProjectHealth, c: Ctx): Record<string, unknown> {
  return {
    total: h.total, done: h.done, open: h.open, overdue: h.overdue, progress: h.progress,
    nextAction: h.nextAction ? taskJson(h.nextAction, c) : null,
    lastTouched: h.lastTouched ?? null,
    staleDays: h.staleDays ?? null,
    flags: h.flags,
    phaseProgress: h.phaseProgress.map((pp) => ({ id: pp.phase.id, title: pp.phase.title, total: pp.total, done: pp.done, state: pp.state })),
  };
}

export function projectJson(p: Project, c: Ctx, opts: { health?: boolean } = {}): Record<string, unknown> {
  const tasks = [...c.index.snapshot.tasks.values()].filter((t) => t.projectId === p.id && t.origin === 'project');
  const profile = profileFor(p.profile, { ...(p.profilePeople ? { people: p.profilePeople } : {}), ...(p.profileModes ? { modes: p.profileModes } : {}) });
  const h = opts.health ? healthOf(p, c) : undefined;
  const phaseState = (id: string): { total: number; done: number; state: string } | undefined => (h ?? healthOf(p, c)).phaseProgress.find((pp) => pp.phase.id === id);
  return {
    profile: profile.id,
    ...(profile.id !== 'generic' ? { people: profile.people, modes: profile.modes, groupNoun: profile.groupNoun, itemNoun: profile.itemNoun } : {}),
    id: p.id,
    title: p.title,
    status: p.status,
    priority: p.priority,
    area: p.area ?? null,
    parentId: p.parentId ?? null,
    childIds: p.childIds,
    period: p.period ?? null,
    goalId: p.goalId ?? null,
    goalRef: p.goalRef ?? null,
    pinned: p.pinned ?? false,
    order: p.order ?? null,
    folderNote: p.folderNote,
    start: p.start ?? null,
    due: p.due ?? null,
    path: p.path,
    folder: p.folder,
    tags: p.tags,
    links: p.links,
    relatedTaskIds: p.relatedTaskIds,
    phases: p.phases.map((ph) => { const st = phaseState(ph.id); return { id: ph.id, slug: ph.slug, title: ph.title, due: ph.due ?? null, taskCount: st?.total ?? ph.taskKeys.length, doneCount: st?.done ?? 0, state: st?.state ?? 'planned', links: ph.links }; }),
    counts: { open: tasks.filter(isOpen).length, total: tasks.length },
    ...(h ? { health: healthJson(h, c) } : {}),
  };
}

export function habitJson(h: Habit, c: Ctx, stats?: HabitStats): Record<string, unknown> {
  const st = stats ?? habitStats(h, c.index.snapshot.completions, c.today(), c.settings().weekStartsOn);
  const { raw, ...parsed } = h.schedule;
  return {
    id: h.id,
    title: h.title,
    path: h.path,
    schedule: { raw, ...parsed },
    active: h.active,
    targetPerWeek: h.targetPerWeek ?? null,
    graceDays: h.graceDays,
    icon: h.icon ?? null,
    iconImage: h.iconImage ?? null,
    parts: h.parts ?? [],
    color: h.color ?? null,
    created: h.created ?? null,
    pauses: h.pauses ?? [],
    removed: h.removed ?? false,
    stats: {
      dueToday: st.dueToday, doneToday: st.doneToday,
      today: st.today.map((o) => ({ part: o.part ?? null, state: o.state })),
      streak: st.streak, bestStreak: st.bestStreak, rate7: st.rate7, rate30: st.rate30,
      doneThisWeek: st.doneThisWeek, scheduledThisWeek: st.scheduledThisWeek,
      days: st.days,
    },
  };
}

export function goalJson(g: Goal, c: Ctx, hg?: HorizonGoal): Record<string, unknown> {
  const p = hg ?? goalProgress(c.index.snapshot, g, c.today(), c.settings());
  return {
    id: g.id, key: g.key, text: g.text, title: plainLabel(g.text), periodKey: g.periodKey, status: g.status, path: g.path, line: g.line,
    projectIds: g.projectIds, progress: p.progress, taskTotal: p.taskTotal, taskDone: p.taskDone,
  };
}

export function periodJson(p: Period, c: Ctx): Record<string, unknown> {
  const path = c.index.periodicPath(p);
  return { key: p.key, kind: p.kind, label: p.label, from: p.start, to: p.end, year: p.year, ...(p.quarter !== undefined ? { quarter: p.quarter } : {}), ...(p.month !== undefined ? { month: p.month } : {}), ...(p.week !== undefined ? { week: p.week } : {}), notePath: c.index.hasFile(path) ? path : null };
}

export function horizonPeriodJson(hp: HorizonPeriod, c: Ctx): Record<string, unknown> {
  for (const h of [...hp.projects, ...hp.projectsWithin]) c.health.set(h.project.id, h);
  return {
    period: periodJson(hp.period, c),
    goals: hp.goals.map((g) => goalJson(g.goal, c, g)),
    projects: hp.projects.map((h) => projectJson(h.project, c, { health: true })),
    projectsWithin: hp.projectsWithin.map((h) => projectJson(h.project, c, { health: true })),
    openTasks: hp.openTasks, doneTasks: hp.doneTasks, isCurrent: hp.isCurrent, isPast: hp.isPast,
  };
}

export function dayItemJson(it: DayItem, c: Ctx): Record<string, unknown> {
  return { task: taskJson(it.task, c), display: it.task === it.display ? null : taskJson(it.display, c), part: it.part, kind: it.kind };
}

export function candidateJson(x: Candidate, c: Ctx): Record<string, unknown> {
  return { task: taskJson(x.task, c), reason: x.reason, score: x.score, minutes: x.task.effortMinutes ?? c.settings().defaultEffortMinutes };
}

export function daybookJson(entries: DaybookEntry[]): Record<string, unknown>[] {
  return entries.map((e) => ({ time: e.time, icon: e.icon, text: e.text, line: e.line, endLine: e.endLine, replies: e.replies.map((r) => ({ text: r.text, icon: r.icon, line: r.line })) }));
}

export function layoutJson(l: DayLayout, c: Ctx): Record<string, unknown> {
  return { date: l.date, timed: l.timed.map((e) => ({ task: taskJson(e.task, c), start: e.start, end: e.end, column: e.column, columns: e.columns })), allDay: l.allDay.map((t) => taskJson(t, c)) };
}

export function hitJson(h: SearchHit, c: Ctx): Record<string, unknown> {
  return {
    kind: h.kind, id: h.id, title: h.title, subtitle: h.subtitle ?? null, path: h.path, line: h.line ?? null, score: h.score,
    ...(h.task ? { task: taskJson(h.task, c) } : {}),
    ...(h.project ? { project: projectJson(h.project, c) } : {}),
    ...(h.goal ? { goal: goalJson(h.goal, c) } : {}),
    ...(h.habit ? { habit: { id: h.habit.id, title: h.habit.title, icon: h.habit.icon ?? null, color: h.habit.color ?? null } } : {}),
    ...(h.note ? { note: noteRefJson(h.note) } : {}),
    ...(h.drawing ? { drawing: drawingJson(h.drawing) } : {}),
  };
}
