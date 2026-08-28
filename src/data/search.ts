/** One search over everything Helm knows: tasks, projects, goals, habits, notes and drawings. */
import type { Goal, Habit, IsoDate, Project, Snapshot, Task } from '../core/types';
import type { Drawing } from '../core/drawing';
import type { NoteRef } from '../core/noteRef';
import { plainLabel } from '../core/label';
import { addDays } from '../core/dates';
import { isBlocked, isOpen } from './planner';
import { baseName } from './vault';

export type SearchKind = 'task' | 'project' | 'goal' | 'habit' | 'note' | 'drawing';
export const SEARCH_KINDS: SearchKind[] = ['task', 'project', 'goal', 'habit', 'note', 'drawing'];
export const KIND_LABEL: Record<SearchKind, string> = { task: 'Tasks', project: 'Projects', goal: 'Goals', habit: 'Habits', note: 'Notes', drawing: 'Drawings' };
export const KIND_ICON: Record<SearchKind, string> = { task: 'check-square', project: 'folder', goal: 'mountain', habit: 'repeat', note: 'sticky-note', drawing: 'pen-tool' };

export type StatusFilter = 'open' | 'done' | 'blocked' | 'waiting' | 'overdue';
/** Where a task lives: a daily note, a project note, the inbox, a goal, or any other note Helm scans. */
export type SourceFilter = 'daily' | 'project' | 'inbox' | 'note' | 'goal';
const SOURCE_ALIAS: Record<string, SourceFilter> = {
  daily: 'daily', day: 'daily', dailies: 'daily', 'daily-note': 'daily', 'daily-notes': 'daily',
  project: 'project', projects: 'project',
  inbox: 'inbox',
  note: 'note', notes: 'note', other: 'note', elsewhere: 'note',
  goal: 'goal', goals: 'goal',
};
export const SOURCE_LABEL: Record<SourceFilter, string> = { daily: 'Daily note', project: 'Project', inbox: 'Inbox', note: 'Other note', goal: 'Goal' };

export interface Query {
  words: string[];
  tags: string[];
  projects: string[];
  kinds: SearchKind[];
  status?: StatusFilter;
  source?: SourceFilter;
  /** `due:` — on or before this day. */
  dueBy?: IsoDate;
  /** `on:` — planned for exactly this day. */
  on?: IsoDate;
  /** True when nothing at all was typed. */
  empty: boolean;
}

export interface SearchHit {
  kind: SearchKind;
  /** Task key, project/goal/habit id, or the path for notes and drawings. */
  id: string;
  title: string;
  subtitle?: string;
  path: string;
  line?: number;
  score: number;
  task?: Task;
  project?: Project;
  goal?: Goal;
  habit?: Habit;
  note?: NoteRef;
  drawing?: Drawing;
}

const KIND_ALIAS: Record<string, SearchKind> = {
  task: 'task', tasks: 'task', todo: 'task', todos: 'task',
  project: 'project', projects: 'project', proj: 'project',
  goal: 'goal', goals: 'goal',
  habit: 'habit', habits: 'habit',
  note: 'note', notes: 'note',
  drawing: 'drawing', drawings: 'drawing', diagram: 'drawing', diagrams: 'drawing', excalidraw: 'drawing',
};

/** `today`, `tomorrow`, `yesterday`, `week` (six days out) or an ISO date. */
export function resolveDate(word: string, today: IsoDate): IsoDate | undefined {
  const w = word.trim().toLowerCase();
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  if (w === 'today') return today;
  if (w === 'tomorrow') return addDays(today, 1);
  if (w === 'yesterday') return addDays(today, -1);
  if (w === 'week') return addDays(today, 6);
  if (w === 'month') return addDays(today, 30);
  return undefined;
}

export function parseQuery(raw: string, today: IsoDate): Query {
  const q: Query = { words: [], tags: [], projects: [], kinds: [], empty: raw.trim() === '' };
  for (const tokenRaw of raw.trim().split(/\s+/).filter(Boolean)) {
    const token = tokenRaw.trim();
    const lower = token.toLowerCase();
    const colon = /^([a-z]+):(.*)$/i.exec(token);
    if (token.startsWith('#') && token.length > 1) { q.tags.push(token.slice(1).toLowerCase()); continue; }
    if (token.startsWith('@') && token.length > 1) { q.projects.push(token.slice(1).toLowerCase()); continue; }
    if (colon) {
      const [, field, value] = colon as unknown as [string, string, string];
      const f = field.toLowerCase();
      const v = value.toLowerCase();
      if ((f === 'kind' || f === 'type') && KIND_ALIAS[v]) { q.kinds.push(KIND_ALIAS[v]!); continue; }
      if ((f === 'in' || f === 'from' || f === 'source') && SOURCE_ALIAS[v]) { q.source = SOURCE_ALIAS[v]!; continue; }
      if (f === 'is' && ['open', 'done', 'blocked', 'waiting', 'overdue'].includes(v)) { q.status = v as StatusFilter; continue; }
      if (f === 'due') { const d = resolveDate(v, today); if (d) { q.dueBy = d; continue; } }
      if (f === 'on') { const d = resolveDate(v, today); if (d) { q.on = d; continue; } }
    }
    q.words.push(lower);
  }
  return q;
}

/** How well `title` answers the words, with other text as a weaker fallback. Undefined when a word is missing everywhere. */
function scoreOf(words: string[], title: string, other: string): number | undefined {
  const t = title.toLowerCase();
  const o = other.toLowerCase();
  let score = 0;
  for (const w of words) {
    const at = t.indexOf(w);
    if (at === 0) score += t.length === w.length ? 140 : 100;
    else if (at > 0) score += /[\s([\-/|]/.test(t[at - 1] ?? '') ? 60 : 35;
    else if (o.includes(w)) score += 12;
    else return undefined;
  }
  return score;
}

/** The typed words with the filter tokens taken out, in the original case — what a capture would use. */
export function queryWords(raw: string): string {
  return raw.trim().split(/\s+/).filter((tok) => {
    if (!tok) return false;
    if (tok.startsWith('#') || tok.startsWith('@')) return false;
    const m = /^([a-z]+):(.*)$/i.exec(tok);
    if (!m) return true;
    const f = m[1]!.toLowerCase();
    const v = m[2]!.toLowerCase();
    if ((f === 'kind' || f === 'type') && KIND_ALIAS[v]) return false;
    if ((f === 'in' || f === 'from' || f === 'source') && v !== '') return false;
    if (f === 'is' && ['open', 'done', 'blocked', 'waiting', 'overdue'].includes(v)) return false;
    if ((f === 'due' || f === 'on') && v !== '') return false;
    return true;
  }).join(' ');
}

/** Add a `field:value` token, or take it out when it is already there; another value of the same field is replaced. */
export function toggleToken(raw: string, token: string): string {
  const tokens = raw.trim().split(/\s+/).filter(Boolean);
  const lower = token.toLowerCase();
  if (tokens.some((t) => t.toLowerCase() === lower)) return tokens.filter((t) => t.toLowerCase() !== lower).join(' ');
  const field = /^([a-z]+):/i.exec(token)?.[1]?.toLowerCase();
  const kept = field === 'is' || field === 'due' || field === 'on' || field === 'in' ? tokens.filter((t) => !new RegExp(`^${field}:`, 'i').test(t)) : tokens;
  return [...kept, token].join(' ');
}

/** Which of the five homes a task sits in (a mirrored copy counts as its source). */
export function sourceOf(t: Task): SourceFilter {
  if (t.origin === 'project') return 'project';
  if (t.origin === 'inbox') return 'inbox';
  if (t.origin === 'goal') return 'goal';
  if (t.origin === 'daily' || t.origin === 'daily-mirror') return 'daily';
  return 'note';
}

function taskSubtitle(t: Task, snap: Snapshot): string {
  const bits: string[] = [];
  const src = sourceOf(t);
  if (src === 'project') { const p = t.projectId ? snap.projects.get(t.projectId) : undefined; bits.push(p ? `Project · ${p.title}` : 'Project'); }
  else if (src === 'note') bits.push(`Other note · ${baseName(t.path)}`);
  else bits.push(SOURCE_LABEL[src]);
  const when = t.scheduled ?? t.noteDate;
  if (when) bits.push(when);
  if (t.due) bits.push(`due ${t.due}`);
  if (!isOpen(t)) bits.push(t.status === 'done' ? 'done' : t.status);
  return bits.join(' · ');
}

function statusOk(t: Task, snap: Snapshot, status: StatusFilter | undefined, today: IsoDate): boolean {
  if (!status) return true;
  if (status === 'open') return isOpen(t);
  if (status === 'done') return t.status === 'done';
  if (status === 'waiting') return t.status === 'waiting';
  if (status === 'blocked') return isBlocked(t, snap);
  return isOpen(t) && t.due !== undefined && t.due < today;
}

/**
 * Rank everything that matches. Words must all appear (title first, other fields as a weak match);
 * `#tag`, `@project`, `is:`, `due:`, `on:` and `kind:` narrow it down.
 */
export function taskHit(t: Task, snap: Snapshot, score = 0): SearchHit {
  const title = plainLabel(t.text) || t.text;
  return { kind: 'task', id: t.key, title, subtitle: taskSubtitle(t, snap), path: t.path, line: t.line, score, task: t };
}

export interface HitGroup { label: string; icon: string; hits: SearchHit[] }

/** What to show before anything is typed: what is late, what is on today, what you touched last. */
export function startingPoints(snap: Snapshot, today: IsoDate): HitGroup[] {
  const open = [...snap.tasks.values()].filter((t) => t.origin !== 'daily-mirror' && isOpen(t));
  const overdue = open.filter((t) => t.due !== undefined && t.due < today).sort((a, b) => (a.due ?? '').localeCompare(b.due ?? '')).slice(0, 6);
  const todays = open.filter((t) => (t.scheduled ?? t.noteDate) === today).sort((a, b) => (a.time?.start ?? '~').localeCompare(b.time?.start ?? '~')).slice(0, 8);
  const recent: SearchHit[] = [
    ...[...snap.notes.values()].map((n) => ({ kind: 'note' as const, id: n.path, title: n.title, subtitle: n.path, path: n.path, score: n.mtime ?? 0, note: n })),
    ...[...snap.drawings.values()].map((d) => ({ kind: 'drawing' as const, id: d.path, title: d.title, subtitle: d.path, path: d.path, score: d.mtime ?? 0, drawing: d })),
  ].sort((a, b) => b.score - a.score).slice(0, 6);
  return [
    { label: 'Overdue', icon: 'alert-triangle', hits: overdue.map((t) => taskHit(t, snap)) },
    { label: 'Today', icon: 'sun', hits: todays.map((t) => taskHit(t, snap)) },
    { label: 'Recently edited', icon: 'history', hits: recent },
  ].filter((g) => g.hits.length > 0);
}

export function search(snap: Snapshot, raw: string, opts: { today: IsoDate; limit?: number }): SearchHit[] {
  const q = parseQuery(raw, opts.today);
  const limit = opts.limit ?? 60;
  if (q.empty && q.kinds.length === 0 && q.tags.length === 0 && q.projects.length === 0 && !q.status && !q.source && !q.dueBy && !q.on) return [];
  const want = (k: SearchKind): boolean => q.kinds.length === 0 || q.kinds.includes(k);
  const taskOnly = q.tags.length > 0 || q.projects.length > 0 || q.source !== undefined || q.status !== undefined || q.dueBy !== undefined || q.on !== undefined;
  const out: SearchHit[] = [];

  if (want('task')) {
    for (const t of snap.tasks.values()) {
      if (t.origin === 'daily-mirror') continue;
      if (q.tags.length > 0 && !q.tags.every((tag) => t.tags.some((x) => x.toLowerCase() === tag))) continue;
      if (q.projects.length > 0) {
        const p = t.projectId ? snap.projects.get(t.projectId) : undefined;
        if (!p || !q.projects.every((needle) => p.title.toLowerCase().includes(needle))) continue;
      }
      if (q.source && sourceOf(t) !== q.source) continue;
      if (!statusOk(t, snap, q.status, opts.today)) continue;
      if (q.dueBy && !(t.due !== undefined && t.due <= q.dueBy)) continue;
      if (q.on && (t.scheduled ?? t.noteDate) !== q.on) continue;
      const title = plainLabel(t.text) || t.text;
      const sub = taskSubtitle(t, snap);
      const s = q.words.length === 0 ? 20 : scoreOf(q.words, title, `${sub} ${t.tags.join(' ')} ${t.path}`);
      if (s === undefined) continue;
      out.push(taskHit(t, snap, s + (isOpen(t) ? 8 : 0)));
    }
  }
  if (want('project') && !taskOnly) {
    for (const p of snap.projects.values()) {
      const sub = [p.area, p.status, p.period].filter(Boolean).join(' · ');
      const s = q.words.length === 0 ? 20 : scoreOf(q.words, p.title, `${sub} ${p.path}`);
      if (s === undefined) continue;
      out.push({ kind: 'project', id: p.id, title: p.title, subtitle: sub, path: p.path, score: s + (p.status === 'active' ? 6 : 0), project: p });
    }
  }
  if (want('goal') && !taskOnly) {
    for (const g of snap.goals.values()) {
      const title = plainLabel(g.text) || g.text;
      const s = q.words.length === 0 ? 20 : scoreOf(q.words, title, `${g.periodKey} ${g.path}`);
      if (s === undefined) continue;
      out.push({ kind: 'goal', id: g.id, title, subtitle: `${g.periodKey}${g.status === 'done' ? ' · done' : ''}`, path: g.path, line: g.line, score: s, goal: g });
    }
  }
  if (want('habit') && !taskOnly) {
    for (const hb of snap.habits.values()) {
      const s = q.words.length === 0 ? 20 : scoreOf(q.words, hb.title, `${hb.schedule.raw} ${hb.path}`);
      if (s === undefined) continue;
      out.push({ kind: 'habit', id: hb.id, title: hb.title, subtitle: `${hb.schedule.raw}${hb.active ? '' : ' · paused'}`, path: hb.path, score: s + (hb.active ? 4 : 0), habit: hb });
    }
  }
  if (want('note') && !taskOnly) {
    for (const n of snap.notes.values()) {
      const s = q.words.length === 0 ? 20 : scoreOf(q.words, n.title, n.path);
      if (s === undefined) continue;
      out.push({ kind: 'note', id: n.path, title: n.title, subtitle: n.path, path: n.path, score: s, note: n });
    }
  }
  if (want('drawing') && !taskOnly) {
    for (const d of snap.drawings.values()) {
      const s = q.words.length === 0 ? 20 : scoreOf(q.words, d.title, d.path);
      if (s === undefined) continue;
      out.push({ kind: 'drawing', id: d.path, title: d.title, subtitle: d.path, path: d.path, score: s, drawing: d });
    }
  }
  return out.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, limit);
}
