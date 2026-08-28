/**
 * Dashboard statistics: pure functions over a Snapshot and a filter.
 * Every number here is meant to lead to an action, and every series can be
 * drilled into (the tasks behind it come back with it).
 */
import type { Goal, Habit, HelmSettings, IsoDate, Project, Snapshot, Task } from '../core/types';
import { addDays, diffDays, isoWeekday, startOfWeek } from '../core/dates';
import { habitStats } from './habits';
import { sourceOf } from './search';
import { goalProgress, isOpen, projectHealth, type DayPart } from './planner';
import { parsePeriod, periodContains } from '../core/periods';

/** Which notes the numbers come from: only what you wrote on a day, that plus project notes, or everything Helm scans. */
export type StatsSource = 'daily' | 'daily-project' | 'all';

export interface StatsFilter {
  from: IsoDate;
  to: IsoDate;
  source?: StatsSource;
  projectId?: string;
  area?: string;
  tag?: string;
  /** Restrict to a horizon (period key) — projects bound within it. */
  periodKey?: string;
}

export interface Series { key: string; label: string; value: number; tasks: Task[] }

export interface DashboardStats {
  filter: StatsFilter;
  days: number;
  totals: { done: number; created: number; open: number; overdue: number; cancelled: number; doneMinutes: number; openMinutes: number; perDay: number };
  perDay: Series[];
  perWeek: { weekStart: IsoDate; done: number; created: number; tasks: Task[] }[];
  cumulative: { date: IsoDate; created: number; done: number }[];
  byPart: Record<DayPart, { done: number; planned: number; tasks: Task[] }>;
  byWeekday: Series[];
  adherence: { planned: number; done: number; carried: number; rate: number; tasks: Task[] };
  byProject: { project: Project; done: number; open: number; total: number; velocity: number; etaWeeks?: number; progress: number; doneTasks: Task[] }[];
  byArea: Series[];
  byTag: Series[];
  ageBuckets: Series[];
  habits: { habit: Habit; rate: number; streak: number; scheduled: number; done: number }[];
  goals: { goal: Goal; progress: number; projects: number }[];
  streak: { current: number; best: number };
}

export function doneDate(t: Task): IsoDate | undefined {
  if (t.status !== 'done') return undefined;
  return t.done ?? t.noteDate;
}

export function createdDate(t: Task): IsoDate | undefined {
  return t.created ?? (t.origin === 'daily' ? t.noteDate : undefined);
}

function inRange(d: IsoDate | undefined, f: StatsFilter): boolean {
  return d !== undefined && d >= f.from && d <= f.to;
}

export function computeStats(snap: Snapshot, f: StatsFilter, today: IsoDate, settings: HelmSettings): DashboardStats {
  const source: StatsSource = f.source ?? 'daily';
  const period = f.periodKey ? parsePeriod(f.periodKey) : undefined;
  const projectMatches = (p: Project | undefined): boolean => {
    if (f.projectId && (!p || (p.id !== f.projectId && p.parentId !== f.projectId))) return false;
    if (f.area && (!p || (p.area ?? '').toLowerCase() !== f.area.toLowerCase())) return false;
    if (period) { const pp = p?.period ? parsePeriod(p.period) : undefined; if (!pp || !periodContains(period, pp.start)) return false; }
    return true;
  };
  // The population: real tasks (no mirrors — the source counts), matching the project/area/tag filters.
  const all: Task[] = [];
  for (const t of snap.tasks.values()) {
    if (t.origin === 'daily-mirror' || t.origin === 'goal') continue;
    if (t.origin === 'daily' && t.section === 'outside' && t.text === '') continue;
    if (source !== 'all') { const src = sourceOf(t); if (src !== 'daily' && !(source === 'daily-project' && src === 'project')) continue; }
    const p = t.projectId ? snap.projects.get(t.projectId) : undefined;
    if ((f.projectId || f.area || period) && !projectMatches(p)) continue;
    if (f.tag && !t.tags.map((x) => x.toLowerCase()).includes(f.tag.toLowerCase())) continue;
    all.push(t);
  }
  const days = diffDays(f.from, f.to) + 1;
  const doneIn = all.filter((t) => inRange(doneDate(t), f));
  const createdIn = all.filter((t) => inRange(createdDate(t), f));
  const open = all.filter(isOpen);
  const overdue = open.filter((t) => t.due !== undefined && t.due < today);
  const cancelled = all.filter((t) => t.status === 'cancelled' && inRange(t.cancelled, f));
  const eff = (t: Task): number => t.effortMinutes ?? settings.defaultEffortMinutes;

  // Per day / per week / cumulative.
  const perDay: Series[] = [];
  const cumulative: DashboardStats['cumulative'] = [];
  let cc = 0;
  let cd = 0;
  for (let i = 0; i < days && i < 400; i++) {
    const d = addDays(f.from, i);
    const dt = doneIn.filter((t) => doneDate(t) === d);
    cc += createdIn.filter((t) => createdDate(t) === d).length;
    cd += dt.length;
    perDay.push({ key: d, label: d, value: dt.length, tasks: dt });
    cumulative.push({ date: d, created: cc, done: cd });
  }
  const weeks = new Map<IsoDate, { done: number; created: number; tasks: Task[] }>();
  for (let d = startOfWeek(f.from, settings.weekStartsOn); d <= f.to; d = addDays(d, 7)) weeks.set(d, { done: 0, created: 0, tasks: [] });
  for (const t of doneIn) { const w = weeks.get(startOfWeek(doneDate(t)!, settings.weekStartsOn)); if (w) { w.done++; w.tasks.push(t); } }
  for (const t of createdIn) { const w = weeks.get(startOfWeek(createdDate(t)!, settings.weekStartsOn)); if (w) w.created++; }
  const perWeek = [...weeks.entries()].map(([weekStart, w]) => ({ weekStart, ...w }));

  // Part of day: what was planned on days in range (daily lines + mirrors) and what of it got done.
  const byPart: DashboardStats['byPart'] = { morning: { done: 0, planned: 0, tasks: [] }, afternoon: { done: 0, planned: 0, tasks: [] }, evening: { done: 0, planned: 0, tasks: [] }, anytime: { done: 0, planned: 0, tasks: [] } };
  const planned: Task[] = [];
  let plannedDone = 0;
  let carried = 0;
  for (const t of snap.tasks.values()) {
    if (!(t.origin === 'daily' || t.origin === 'daily-mirror') || t.depth > 0) continue;
    if (t.origin === 'daily' && t.section === 'outside') continue;
    if (!inRange(t.noteDate, f)) continue;
    const src = t.origin === 'daily-mirror' && t.mirrorOf ? snap.tasks.get(t.mirrorOf) ?? t : t;
    const p = src.projectId ? snap.projects.get(src.projectId) : undefined;
    if ((f.projectId || f.area || period) && !projectMatches(p)) continue;
    if (f.tag && !src.tags.map((x) => x.toLowerCase()).includes(f.tag.toLowerCase())) continue;
    const part = t.part ?? 'anytime';
    byPart[part].planned++;
    planned.push(src);
    if (t.status === 'done' || src.status === 'done') { byPart[part].done++; byPart[part].tasks.push(src); plannedDone++; }
    else if (t.status === 'forwarded') carried++;
  }

  // Weekday.
  const wdNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const byWeekday: Series[] = wdNames.map((label, i) => ({ key: String(i + 1), label, value: 0, tasks: [] }));
  for (const t of doneIn) { const s = byWeekday[isoWeekday(doneDate(t)!) - 1]!; s.value++; s.tasks.push(t); }

  // Projects: velocity over the range, ETA from open tasks.
  const byProject: DashboardStats['byProject'] = [];
  for (const p of snap.projects.values()) {
    if ((f.projectId || f.area || period) && !projectMatches(p)) continue;
    const h = projectHealth(snap, p, today, settings);
    const doneTasks = doneIn.filter((t) => t.projectId === p.id);
    if (h.total === 0 && doneTasks.length === 0) continue;
    const velocity = doneTasks.length / Math.max(1, days / 7);
    const row: DashboardStats['byProject'][number] = { project: p, done: h.done, open: h.open, total: h.total, velocity, progress: h.progress, doneTasks };
    if (velocity > 0 && h.open > 0) row.etaWeeks = h.open / velocity;
    byProject.push(row);
  }
  byProject.sort((a, b) => b.doneTasks.length - a.doneTasks.length || b.open - a.open);

  // Areas and tags.
  const areaMap = new Map<string, Series>();
  const tagMap = new Map<string, Series>();
  for (const t of doneIn) {
    const p = t.projectId ? snap.projects.get(t.projectId) : undefined;
    const area = p?.area ?? (t.origin === 'daily' ? 'Daily' : t.origin === 'inbox' ? 'Inbox' : 'Other');
    const a = areaMap.get(area) ?? { key: area, label: area, value: 0, tasks: [] };
    a.value++; a.tasks.push(t); areaMap.set(area, a);
    for (const tag of t.tags) { const s = tagMap.get(tag) ?? { key: tag, label: `#${tag}`, value: 0, tasks: [] }; s.value++; s.tasks.push(t); tagMap.set(tag, s); }
  }
  const byArea = [...areaMap.values()].sort((a, b) => b.value - a.value);
  const byTag = [...tagMap.values()].sort((a, b) => b.value - a.value).slice(0, 12);

  // Age of open tasks.
  const buckets: [string, number, number][] = [['< 1 week', 0, 6], ['1–4 weeks', 7, 27], ['1–3 months', 28, 89], ['3–12 months', 90, 364], ['> 1 year', 365, 1e9]];
  const ageBuckets: Series[] = buckets.map(([label]) => ({ key: label, label, value: 0, tasks: [] }));
  const unknownAge: Series = { key: 'unknown', label: 'no date', value: 0, tasks: [] };
  for (const t of open) {
    const c = createdDate(t);
    if (!c) { unknownAge.value++; unknownAge.tasks.push(t); continue; }
    const age = diffDays(c, today);
    const i = buckets.findIndex(([, lo, hi]) => age >= lo && age <= hi);
    const b = ageBuckets[Math.max(0, i)]!;
    b.value++; b.tasks.push(t);
  }
  if (unknownAge.value > 0) ageBuckets.push(unknownAge);

  // Habits and goals.
  const habits = [...snap.habits.values()].filter((h) => h.active).map((habit) => {
    const st = habitStats(habit, snap.completions, today, settings.weekStartsOn, Math.max(days, 1));
    let scheduled = 0;
    let done = 0;
    for (const d of st.days) { if (d.date < f.from || d.date > f.to) continue; if (d.state === 'off' || d.state === 'future') continue; scheduled++; if (d.state === 'done') done++; }
    return { habit, rate: scheduled ? done / scheduled : 0, streak: st.streak, scheduled, done };
  });
  const goals = [...snap.goals.values()].filter((g) => !period || g.periodKey === period.key || (parsePeriod(g.periodKey) && periodContains(period, parsePeriod(g.periodKey)!.start))).map((goal) => { const gp = goalProgress(snap, goal, today, settings); return { goal, progress: gp.progress, projects: gp.projects.length }; });

  // Done-streak: consecutive days (ending today) with at least one completion.
  const doneDays = new Set(all.map(doneDate).filter((d): d is IsoDate => d !== undefined));
  let current = 0;
  for (let i = 0; i < 400; i++) { if (doneDays.has(addDays(today, -i))) current++; else if (i > 0) break; }
  let best = 0;
  let run = 0;
  for (let i = 0; i < days; i++) { if (doneDays.has(addDays(f.from, i))) { run++; best = Math.max(best, run); } else run = 0; }

  return {
    filter: f, days,
    totals: { done: doneIn.length, created: createdIn.length, open: open.length, overdue: overdue.length, cancelled: cancelled.length, doneMinutes: doneIn.reduce((s, t) => s + eff(t), 0), openMinutes: open.reduce((s, t) => s + eff(t), 0), perDay: doneIn.length / Math.max(1, days) },
    perDay, perWeek, cumulative, byPart, byWeekday,
    adherence: { planned: planned.length, done: plannedDone, carried, rate: planned.length ? plannedDone / planned.length : 0, tasks: planned },
    byProject, byArea, byTag, ageBuckets, habits, goals,
    streak: { current, best: Math.max(best, current) },
  };
}

/** Distinct areas and tags in the vault, for filter pickers. */
export function filterOptions(snap: Snapshot): { areas: string[]; tags: string[] } {
  const areas = new Set<string>();
  const tags = new Map<string, number>();
  for (const p of snap.projects.values()) if (p.area) areas.add(p.area);
  for (const t of snap.tasks.values()) if (t.origin !== 'daily-mirror') for (const tag of t.tags) tags.set(tag, (tags.get(tag) ?? 0) + 1);
  return { areas: [...areas].sort(), tags: [...tags.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([t]) => t) };
}
