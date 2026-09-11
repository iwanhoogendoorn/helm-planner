/**
 * Helm's HTTP surface, as a pure function: a request in, a JSON response out. Everything goes through
 * the same mutations the views use, so an outside caller cannot skip the bookkeeping (ids, daily-note
 * mirrors, the Helm region, subtasks travelling with their task) that keeps a vault consistent.
 */
import type { DayPart } from '../core/dailyNote';
import type { IsoDate, Priority, Project, ProjectPriority, ProjectStatus, Task, TaskStatus } from '../core/types';
import { isIsoDate } from '../core/dates';
import type { Mutations } from '../data/mutations';
import { compareProjects, isOpen, plannedDate } from '../data/planner';
import { profileFor, parseAssignment, type Assignment } from '../core/profiles';
import { plainLabel } from '../core/label';
import { parsePeriod } from '../core/periods';
import { ctxOf, healthOf, projectJson, taskDetailJson, taskJson, type ApiDeps, type Ctx } from './json';
import { handleV2 } from './v2';

export type { ApiDeps } from './json';

export const API_BASE = '/helm/v1';
/** The contract revision: a client checks it in `GET /health` to tell a newer plugin from an older one. */
export const API_VERSION = 2;

export interface ApiRequest {
  method: string;
  /** Path with the base stripped: `tasks`, `tasks/tsk-abc`, … */
  path: string;
  query: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse { status: number; body: unknown }

export const ok = (body: unknown): ApiResponse => ({ status: 200, body });
export const made = (body: unknown): ApiResponse => ({ status: 201, body });
export const bad = (message: string): ApiResponse => ({ status: 400, body: { error: message } });
export const missing = (message: string): ApiResponse => ({ status: 404, body: { error: message } });
export const notAllowed = (method: string, path: string): ApiResponse => ({ status: 405, body: { error: `Cannot ${method} ${path}` } });

export const STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'cancelled', 'waiting', 'forwarded'];
export const PARTS: DayPart[] = ['morning', 'afternoon', 'evening', 'anytime'];
export const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'normal', 'low', 'lowest'];
export const PROJECT_STATUSES: ProjectStatus[] = ['idea', 'planned', 'not-started', 'active', 'on-hold', 'done', 'cancelled', 'archived'];
export const PROJECT_PRIORITIES: ProjectPriority[] = ['low', 'normal', 'medium', 'high', 'urgent', 'critical'];

export const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const day = (v: unknown): IsoDate | undefined => { const s = str(v); return s && isIsoDate(s) ? s : undefined; };
export const has = (body: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(body, k);
export const strList = (v: unknown): string[] => (Array.isArray(v) ? (v as unknown[]).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : []);

/**
 * A profiled project's items the way its board sees them: the task in a group (phase), the note it
 * links, the assignments (Person · Mode) under it, and the steps under each assignment.
 */
function itemsJson(p: Project, d: Ctx): Record<string, unknown>[] {
  const snap = d.index.snapshot;
  const profile = profileFor(p.profile, { ...(p.profilePeople ? { people: p.profilePeople } : {}), ...(p.profileModes ? { modes: p.profileModes } : {}) });
  const groups: Array<{ title: string | null; keys: string[] }> = [...p.phases.map((ph) => ({ title: ph.title, keys: ph.taskKeys })), { title: null, keys: p.looseTaskKeys }];
  const out: Record<string, unknown>[] = [];
  for (const g of groups) for (const key of g.keys) {
    const t = snap.tasks.get(key);
    if (!t || t.parentKey) continue;
    const link = /\[\[([^\]|#]+)/.exec(t.text)?.[1]?.trim();
    const work: Record<string, unknown>[] = [];
    const other: Record<string, unknown>[] = [];
    for (const ck of t.childKeys) {
      const c = snap.tasks.get(ck);
      if (!c) continue;
      const a = parseAssignment(plainLabel(c.text), profile);
      const steps = c.childKeys.map((sk) => snap.tasks.get(sk)).filter((s): s is Task => s !== undefined).map((s) => taskJson(s, d));
      if (a) work.push({ ...taskJson(c, d), ...(a.person ? { person: a.person } : {}), mode: a.mode, steps });
      else other.push({ ...taskJson(c, d), steps });
    }
    out.push({ ...taskJson(t, d), kind: 'task', title: plainLabel(t.text), note: link ?? null, group: g.title, work, other });
  }
  // Songs that are projects of their own under the board.
  for (const cid of p.childIds) {
    const c = snap.projects.get(cid);
    if (!c || /archived|cancelled/.test(c.status)) continue;
    const work: Record<string, unknown>[] = [];
    for (const ph of c.phases) {
      const a = parseAssignment(ph.title, profile);
      const steps = ph.taskKeys.map((k) => snap.tasks.get(k)).filter((s): s is Task => s !== undefined && !s.parentKey).map((s) => taskJson(s, d));
      const st = !steps.length ? 'todo' : steps.every((s) => s['status'] === 'done') ? 'done' : steps.some((s) => s['status'] === 'doing' || s['status'] === 'done') ? 'doing' : 'todo';
      work.push({ id: ph.id, key: ph.id, kind: 'phase', text: ph.title, status: st, open: st !== 'done', ...(a?.person ? { person: a.person } : {}), mode: a?.mode ?? ph.title, steps });
    }
    const other = c.looseTaskKeys.map((k) => snap.tasks.get(k)).filter((s): s is Task => s !== undefined && !s.parentKey).map((s) => taskJson(s, d));
    const notes = d.index.notesFor({ kind: 'project', id: c.id, title: c.title });
    const note = (notes.find((n) => d.index.song(n.path)) ?? notes[0])?.path.replace(/\.md$/, '') ?? d.index.noteLinksOf(c.path)[0] ?? null;
    out.push({ id: c.id, key: c.id, kind: 'project', text: c.title, title: c.title, status: c.status, open: !/done|archived|cancelled/.test(c.status), path: c.path, note, group: c.period ? parsePeriod(c.period)?.label ?? c.period : null, period: c.period ?? null, people: c.profilePeople ?? [], modes: c.profileModes ?? [], work, other });
  }
  return out;
}

/** A task by its 🆔, or failing that by its index key — a live line wins over a forwarded record. */
export function findTask(ref: string, d: Ctx): Task | undefined {
  return d.index.taskById(ref) ?? d.index.task(ref);
}

export async function handle(req: ApiRequest, deps: ApiDeps): Promise<ApiResponse> {
  const d = ctxOf(deps);
  const parts = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [head, ref, sub] = parts;
  const body = asRecord(req.body);
  const method = req.method.toUpperCase();

  if (head === 'health' && method === 'GET') {
    const snap = d.index.snapshot;
    return ok({ ok: true, api: API_VERSION, version: d.version, ready: d.index.ready, revision: d.index.revision, today: d.today(), vault: d.vaultName ?? null, weekStartsOn: d.settings().weekStartsOn, counts: { tasks: snap.tasks.size, projects: snap.projects.size, habits: snap.habits.size } });
  }

  if (head === 'tasks') {
    if (method === 'GET' && ref === undefined) {
      if (req.query['ids'] !== undefined) {
        const refs = req.query['ids'].split(',').map((x) => x.trim()).filter(Boolean).slice(0, 500);
        return ok({ tasks: refs.map((r) => findTask(r, d)).filter((t): t is Task => t !== undefined).map((t) => taskJson(t, d)) });
      }
      return ok({ tasks: listTasks(req.query, d) });
    }
    if (method === 'GET' && ref !== undefined && sub === undefined) {
      const t = findTask(ref, d);
      return t ? ok(taskDetailJson(t, d)) : missing(`No task ${ref}`);
    }
    if (method === 'POST' && ref === undefined) return createTask(body, d);
    if (ref !== undefined && sub === 'subtasks' && method === 'POST') {
      const parent = findTask(ref, d);
      if (!parent) return missing(`No task ${ref}`);
      const text = str(body['text']);
      if (!text) return bad('A subtask needs text');
      const t = await d.mutations.addTaskReturning({ text, parentKey: parent.key, ...fieldsFrom(body) });
      return made({ task: taskJson(t, d), written: d.written() });
    }
    if (ref !== undefined && sub === 'steps' && method === 'POST') {
      const parent = findTask(ref, d);
      if (!parent) return missing(`No task ${ref}`);
      const steps = Array.isArray(body['steps']) ? (body['steps'] as unknown[]).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : [];
      if (!steps.length) return bad('steps must be a list of texts');
      const made2 = await d.mutations.addSteps(parent.key, steps, num(body['effortMinutes']));
      return made({ tasks: made2.map((t) => taskJson(t, d)), written: d.written() });
    }
    if (ref !== undefined && sub === undefined && (method === 'PATCH' || method === 'PUT')) return patchTask(ref, body, d);
    if (ref !== undefined && sub === undefined && method === 'DELETE') {
      const t = findTask(ref, d);
      if (!t) return missing(`No task ${ref}`);
      await d.mutations.deleteTask(t.key);
      return ok({ deleted: ref, written: d.written() });
    }
    const v2 = await handleV2(req, d);
    return v2 ?? notAllowed(method, req.path);
  }

  if (head === 'projects') {
    if (method === 'GET' && ref === undefined) {
      const wantHealth = req.query['health'] === 'true';
      const area = req.query['area']?.toLowerCase();
      const all = d.index.allProjects().filter((p) => (!req.query['status'] || p.status === req.query['status']) && (!area || (p.area ?? '').toLowerCase() === area));
      const sorted = all.map((p) => healthOf(p, d)).sort(compareProjects).map((h) => h.project);
      return ok({ projects: sorted.map((p) => projectJson(p, d, { health: wantHealth })) });
    }
    if (method === 'GET' && ref !== undefined && sub === 'items') {
      const p = d.index.project(ref);
      return p ? ok({ items: itemsJson(p, d) }) : missing(`No project ${ref}`);
    }
    if (method === 'POST' && ref !== undefined && sub === 'items') {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const profile = profileFor(p.profile, { ...(p.profilePeople ? { people: p.profilePeople } : {}), ...(p.profileModes ? { modes: p.profileModes } : {}) });
      const note = str(body['note']);
      const title = str(body['title']) ?? note;
      if (!title) return bad(`An ${profile.itemNoun} needs a title (or a note)`);
      const rawA = Array.isArray(body['assignments']) ? body['assignments'] as unknown[] : [];
      const assignments: (Assignment & { steps?: string[] })[] = [];
      for (const raw of rawA) {
        const a = asRecord(raw);
        const mode = str(a['mode']);
        if (!mode) return bad('Every assignment needs a mode');
        if (profile.modes.length && !profile.modes.some((m) => m.toLowerCase() === mode.toLowerCase())) return bad(`mode must be one of ${profile.modes.join(', ')}`);
        const person = str(a['person']);
        const steps = Array.isArray(a['steps']) ? (a['steps'] as unknown[]).map((x) => (typeof x === 'string' ? x : '')).filter(Boolean) : [];
        assignments.push({ ...(person ? { person } : {}), mode: profile.modes.find((m) => m.toLowerCase() === mode.toLowerCase()) ?? mode, ...(steps.length ? { steps } : {}) });
      }
      const eff = num(body['stepEffortMinutes']);
      const asProject = body['asProject'] === undefined ? !!profile.itemsAreProjects : body['asProject'] === true;
      if (asProject) {
        const made2 = await d.mutations.addProfileSubproject(p.id, { title, group: str(body['group']) ?? '', ...(note ? { note } : {}), assignments, ...(eff ? { stepEffortMinutes: eff } : {}), ...(str(body['area']) ? { area: str(body['area'])! } : {}) });
        const fresh = d.index.project(p.id) ?? p;
        return made({ item: itemsJson(fresh, d).find((it) => it['id'] === made2.id) ?? projectJson(made2, d), written: d.written() });
      }
      const item = await d.mutations.addProfileItem(p.id, { title, group: str(body['group']) ?? '', ...(note ? { note } : {}), assignments, ...(day(body['due']) ? { due: day(body['due'])! } : {}), ...(eff ? { stepEffortMinutes: eff } : {}) });
      const fresh = d.index.project(p.id) ?? p;
      const itemJson = itemsJson(fresh, d).find((it) => it['id'] === item.id) ?? taskJson(item, d);
      return made({ item: itemJson, written: d.written() });
    }
    if (method === 'POST' && ref !== undefined && sub === 'phases') {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const title = str(body['title']);
      if (!title) return bad('A phase needs a title');
      const tasks = Array.isArray(body['tasks']) ? (body['tasks'] as unknown[]).map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean) : [];
      const r = await d.mutations.addPhaseWithTasks(p.id, title, tasks, num(body['effortMinutes']));
      return made({ phase: { id: r.phaseId, title }, tasks: r.tasks.map((t) => taskJson(t, d)), written: d.written() });
    }
    if (method === 'POST' && ref !== undefined && sub === 'archive') {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const path = await d.mutations.archiveProject(p.id);
      return ok({ archived: p.id, path, written: d.written() });
    }
    if (method === 'GET' && ref !== undefined && sub === undefined) {
      const p = d.index.project(ref);
      return p ? ok(projectJson(p, d, { health: true })) : missing(`No project ${ref}`);
    }
    if (method === 'POST' && ref === undefined) {
      const title = str(body['title']);
      if (!title) return bad('A project needs a title');
      const status = str(body['status']) ?? 'active';
      if (!PROJECT_STATUSES.includes(status as ProjectStatus)) return bad(`status must be one of ${PROJECT_STATUSES.join(', ')}`);
      const priority = str(body['priority']) ?? 'normal';
      if (!PROJECT_PRIORITIES.includes(priority as ProjectPriority)) return bad(`priority must be one of ${PROJECT_PRIORITIES.join(', ')}`);
      const p = await d.mutations.createProject({
        title,
        status: status as ProjectStatus,
        priority: priority as ProjectPriority,
        ...(str(body['area']) ? { area: str(body['area'])! } : {}),
        ...(str(body['parentId']) ? { parentId: str(body['parentId'])! } : {}),
        ...(str(body['profile']) ? { profile: str(body['profile'])! } : {}),
        ...(Array.isArray(body['people']) ? { people: (body['people'] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') } : {}),
        ...(Array.isArray(body['modes']) ? { modes: (body['modes'] as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim() !== '') } : {}),
        ...(str(body['period']) ? { period: str(body['period'])! } : {}),
        ...(day(body['start']) ? { start: day(body['start'])! } : {}),
        ...(day(body['due']) ? { due: day(body['due'])! } : {}),
      });
      return made({ project: projectJson(p, d), written: d.written() });
    }
    if (ref !== undefined && (method === 'PATCH' || method === 'PUT')) {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const fields: Parameters<Mutations['setProjectFields']>[1] = {};
      if (str(body['title'])) fields.title = str(body['title'])!;
      if (str(body['status'])) {
        const v = str(body['status'])!;
        if (!PROJECT_STATUSES.includes(v as ProjectStatus)) return bad(`status must be one of ${PROJECT_STATUSES.join(', ')}`);
        fields.status = v as ProjectStatus;
      }
      if (str(body['priority'])) {
        const v = str(body['priority'])!;
        if (!PROJECT_PRIORITIES.includes(v as ProjectPriority)) return bad(`priority must be one of ${PROJECT_PRIORITIES.join(', ')}`);
        fields.priority = v as ProjectPriority;
      }
      if (has(body, 'area')) fields.area = str(body['area']) ?? '';
      if (has(body, 'period')) fields.period = str(body['period']) ?? '';
      if (has(body, 'due')) fields.due = day(body['due']) ?? null;
      if (has(body, 'start')) fields.start = day(body['start']) ?? null;
      if (Object.keys(fields).length === 0) return bad('Nothing to change');
      await d.mutations.setProjectFields(p.id, fields);
      const after = d.index.project(p.id);
      return ok({ project: after ? projectJson(after, d) : null, written: d.written() });
    }
    if (ref !== undefined && method === 'DELETE') {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      await d.mutations.deleteProject(p.id);
      return ok({ deleted: p.id, written: d.written() });
    }
    const v2 = await handleV2(req, d);
    return v2 ?? notAllowed(method, req.path);
  }

  const v2 = await handleV2(req, d);
  return v2 ?? missing(`No route ${req.path}`);
}

export function listTasks(q: Record<string, string>, d: Ctx): Record<string, unknown>[] {
  const today = d.today();
  const limit = Math.min(Number(q['limit'] ?? 200) || 200, 1000);
  const wanted = (q['status'] ?? 'open').toLowerCase();
  const text = (q['q'] ?? '').toLowerCase();
  const out: Task[] = [];
  for (const t of d.index.snapshot.tasks.values()) {
    if (t.origin === 'daily-mirror') continue;
    if (wanted === 'open' && !isOpen(t)) continue;
    if (wanted === 'done' && t.status !== 'done') continue;
    if (!['open', 'done', 'all'].includes(wanted) && t.status !== wanted) continue;
    if (q['project'] && t.projectId !== q['project']) continue;
    if (q['source'] && t.origin !== q['source']) continue;
    if (q['tag'] && !t.tags.some((x) => x.toLowerCase() === q['tag']!.toLowerCase())) continue;
    if (q['date'] && plannedDate(t) !== q['date']) continue;
    if (q['from'] && (plannedDate(t) ?? '') < q['from']) continue;
    if (q['to'] && (plannedDate(t) ?? '9999') > q['to']) continue;
    if (q['overdue'] === 'true' && !(isOpen(t) && t.due !== undefined && t.due < today)) continue;
    if (text && !t.text.toLowerCase().includes(text)) continue;
    out.push(t);
  }
  return out
    .sort((a, b) => (plannedDate(a) ?? '9999').localeCompare(plannedDate(b) ?? '9999') || a.text.localeCompare(b.text))
    .slice(0, limit)
    .map((t) => taskJson(t, d));
}

/** The task-line fields an API caller may set when writing a task. */
export function fieldsFrom(body: Record<string, unknown>): { fields?: Record<string, unknown> } {
  const fields: Record<string, unknown> = {};
  const eff = num(body['effortMinutes']);
  if (eff !== undefined) { fields['effortMinutes'] = eff; fields['effortRaw'] = `${eff}m`; }
  if (day(body['due'])) fields['due'] = day(body['due']);
  const prio = str(body['priority']);
  if (prio && PRIORITIES.includes(prio as Priority)) fields['priority'] = prio;
  const start = str(body['time']);
  if (start && /^\d{2}:\d{2}$/.test(start)) fields['time'] = { start, ...(str(body['timeEnd']) ? { end: str(body['timeEnd']) } : {}) };
  return Object.keys(fields).length ? { fields } : {};
}

async function createTask(body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const text = str(body['text']);
  if (!text) return bad('A task needs text');
  const raw = body['scheduled'] ?? body['date'];
  const when = day(raw);
  if (raw !== undefined && raw !== null && !when) return bad('scheduled must be a date like 2026-09-01');
  const part = str(body['part']);
  if (part && !PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
  const projectId = str(body['projectId']);
  if (projectId && !d.index.project(projectId)) return missing(`No project ${projectId}`);
  const parentRef = str(body['parentId']);
  const parent = parentRef ? findTask(parentRef, d) : undefined;
  if (parentRef && !parent) return missing(`No task ${parentRef}`);
  const t = await d.mutations.addTaskReturning({
    text,
    ...(projectId ? { projectId } : {}),
    ...(str(body['phaseId']) ? { phaseId: str(body['phaseId'])! } : {}),
    ...(parent ? { parentKey: parent.key } : {}),
    ...(when ? { date: when } : {}),
    ...(part ? { part: part as DayPart } : {}),
    ...fieldsFrom(body),
  });
  return made({ task: taskJson(t, d), written: d.written() });
}

async function patchTask(ref: string, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  if (!findTask(ref, d)) return missing(`No task ${ref}`);
  let touched = false;

  if (has(body, 'status')) {
    const s = str(body['status']);
    if (!s || !STATUSES.includes(s as TaskStatus)) return bad(`status must be one of ${STATUSES.join(', ')}`);
    await d.mutations.setStatus(findTask(ref, d)!.key, s as TaskStatus);
    touched = true;
  }
  if (has(body, 'scheduled') || has(body, 'date')) {
    const raw = has(body, 'scheduled') ? body['scheduled'] : body['date'];
    const when = raw === null ? undefined : day(raw);
    if (raw !== null && !when) return bad('scheduled must be a date like 2026-09-01, or null to unschedule');
    const part = str(body['part']);
    if (part && !PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
    await d.mutations.schedule(findTask(ref, d)!.key, when, part as DayPart | undefined);
    touched = true;
  } else if (str(body['part'])) {
    const part = str(body['part'])!;
    if (!PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
    await d.mutations.setPart(findTask(ref, d)!.key, part as DayPart);
    touched = true;
  }

  if (str(body['projectId'])) {
    const projectId = str(body['projectId'])!;
    if (!d.index.project(projectId)) return missing(`No project ${projectId}`);
    await d.mutations.moveToProject(findTask(ref, d)!.key, projectId, str(body['phaseId']));
    touched = true;
  }
  const patch: Record<string, unknown> = {};
  if (str(body['text'])) patch['text'] = str(body['text']);
  if (has(body, 'due')) patch['due'] = body['due'] === null ? undefined : day(body['due']);
  if (has(body, 'effortMinutes')) {
    const eff = body['effortMinutes'] === null ? undefined : num(body['effortMinutes']);
    patch['effortMinutes'] = eff;
    patch['effortRaw'] = eff === undefined ? undefined : `${eff}m`;
  }
  if (str(body['priority'])) {
    const p = str(body['priority'])!;
    if (!PRIORITIES.includes(p as Priority)) return bad(`priority must be one of ${PRIORITIES.join(', ')}`);
    patch['priority'] = p;
  }
  if (Object.keys(patch).length > 0) { await d.mutations.updateTask(findTask(ref, d)!.key, patch); touched = true; }
  if (!touched) return bad('Nothing to change');
  const after = findTask(ref, d);
  return ok({ task: after ? taskJson(after, d) : null, written: d.written() });
}
