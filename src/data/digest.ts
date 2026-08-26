/**
 * A compact, factual digest of a period / day / project for a model to
 * summarise — goals, projects and their progress, what got done, what is
 * planned or overdue, habits. Plain text, deliberately short.
 */
import type { DrawingTarget, HelmSettings, IsoDate, Snapshot, Task } from '../core/types';
import { parsePeriod, periodWithin, periodOf, type Period } from '../core/periods';
import { projectHealth } from './planner';
import { habitStats } from './habits';
import { isOpen } from './planner';

const clip = (s: string, n = 70): string => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const lines = (title: string, items: string[], max = 25): string[] => (items.length === 0 ? [] : [`## ${title}`, ...items.slice(0, max).map((x) => `- ${x}`), ...(items.length > max ? [`- … and ${items.length - max} more`] : []), '']);

export function digestFor(snap: Snapshot, target: DrawingTarget, today: IsoDate, settings: HelmSettings): string {
  if (target.kind === 'project') return projectDigest(snap, target.id, today, settings);
  const period: Period | undefined = target.kind === 'period' ? parsePeriod(target.key) : target.kind === 'date' ? { kind: 'week', key: target.date, start: target.date, end: target.date, label: target.title, year: Number(target.date.slice(0, 4)) } : undefined;
  if (!period) return `# ${target.title}\n`;
  return periodDigest(snap, period, today, settings);
}

function periodDigest(snap: Snapshot, p: Period, today: IsoDate, settings: HelmSettings): string {
  const inRange = (d: IsoDate | undefined): boolean => d !== undefined && d >= p.start && d <= p.end;
  const out: string[] = [`# ${p.label} (${p.start} → ${p.end}); today is ${today}`, ''];
  const goals = [...snap.goals.values()].filter((g) => g.periodKey === p.key || (p.kind !== 'week' && parsePeriod(g.periodKey) && periodWithin(parsePeriod(g.periodKey)!, p)));
  out.push(...lines('Goals', goals.map((g) => `${g.status === 'done' ? '[done]' : '[open]'} ${clip(g.text)} (${g.periodKey})`)));
  const tasks = [...snap.tasks.values()].filter((t) => t.origin !== 'daily-mirror' && t.origin !== 'goal');
  const done = tasks.filter((t) => t.status === 'done' && inRange(t.done ?? t.noteDate));
  const byProject = new Map<string, Task[]>();
  for (const t of done) { const k = t.projectId ? snap.projects.get(t.projectId)?.title ?? 'Other' : 'Other'; byProject.set(k, [...(byProject.get(k) ?? []), t]); }
  out.push(...lines(`Completed (${done.length})`, [...byProject.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, ts]) => `${k}: ${ts.slice(0, 6).map((t) => clip(t.text, 50)).join('; ')}${ts.length > 6 ? ` (+${ts.length - 6})` : ''}`), 12));
  const planned = tasks.filter((t) => isOpen(t) && (inRange(t.scheduled) || inRange(t.due) || inRange(t.noteDate)));
  out.push(...lines(`Planned or due in the period (${planned.length})`, planned.map((t) => `${clip(t.text, 60)}${t.due ? ` (due ${t.due})` : ''}${t.projectId ? ` [${snap.projects.get(t.projectId)?.title ?? ''}]` : ''}`), 20));
  const overdue = tasks.filter((t) => isOpen(t) && t.due !== undefined && t.due < today && t.due >= p.start);
  out.push(...lines(`Overdue (${overdue.length})`, overdue.map((t) => `${clip(t.text, 60)} (due ${t.due})`), 10));
  const projects = [...snap.projects.values()].filter((pr) => ['active', 'planned', 'on-hold'].includes(pr.status) || pr.period === p.key || (pr.period ? !!parsePeriod(pr.period) && periodWithin(parsePeriod(pr.period)!, p) : false));
  const health = projects.map((pr) => projectHealth(snap, pr, today, settings)).filter((hh) => hh.total > 0 || hh.project.period === p.key).sort((a, b) => b.done - a.done);
  out.push(...lines('Projects', health.map((hh) => `${hh.project.title}: ${Math.round(hh.progress * 100)}% (${hh.done}/${hh.total} done${hh.overdue ? `, ${hh.overdue} overdue` : ''})${hh.project.period ? ` bound to ${hh.project.period}` : ''}${hh.flags.length ? ` flags: ${hh.flags.join(', ')}` : ''}`), 15));
  const habits = [...snap.habits.values()].filter((h) => h.active).map((h) => { const st = habitStats(h, snap.completions, today, settings.weekStartsOn); const dones = snap.completions.filter((c) => c.habitId === h.id && c.state === 'done' && inRange(c.date)).length; return `${h.title}: ${dones} done in period, streak ${st.streak}`; });
  out.push(...lines('Habits', habits, 10));
  return out.join('\n');
}

function projectDigest(snap: Snapshot, id: string, today: IsoDate, settings: HelmSettings): string {
  const p = snap.projects.get(id);
  if (!p) return '';
  const hh = projectHealth(snap, p, today, settings);
  const out: string[] = [`# Project: ${p.title} (${p.status}, ${Math.round(hh.progress * 100)}% done, ${hh.done}/${hh.total}); today is ${today}`, ''];
  if (p.period) out.push(`Bound to ${p.period}${p.goalId ? `, serves goal ${snap.goals.get(p.goalId)?.text ?? ''}` : ''}`, '');
  const tasks = [...snap.tasks.values()].filter((t) => t.projectId === p.id && t.origin === 'project');
  for (const ph of p.phases) {
    const ts = tasks.filter((t) => t.phaseId === ph.id);
    out.push(...lines(`Phase: ${ph.title}${ph.due ? ` (due ${ph.due})` : ''}`, ts.map((t) => `${t.status === 'done' ? '[done]' : '[open]'} ${clip(t.text, 60)}${t.due ? ` due ${t.due}` : ''}`), 15));
  }
  const loose = tasks.filter((t) => !t.phaseId);
  out.push(...lines('Tasks', loose.map((t) => `${t.status === 'done' ? '[done]' : '[open]'} ${clip(t.text, 60)}${t.due ? ` due ${t.due}` : ''}`), 25));
  const children = p.childIds.map((c) => snap.projects.get(c)).filter((c): c is NonNullable<typeof c> => !!c).map((c) => { const ch = projectHealth(snap, c, today, settings); return `${c.title}: ${Math.round(ch.progress * 100)}%`; });
  out.push(...lines('Sub-projects', children));
  if (hh.nextAction) out.push(`Next action: ${hh.nextAction.text}`, '');
  return out.join('\n');
}

export { periodOf };
