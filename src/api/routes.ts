/**
 * Helm's HTTP surface, as a pure function: a request in, a JSON response out. Everything goes through
 * the same mutations the views use, so an outside caller cannot skip the bookkeeping (ids, daily-note
 * mirrors, the Helm region, subtasks travelling with their task) that keeps a vault consistent.
 */
import type { DayPart } from '../core/dailyNote';
import type { HelmSettings, IsoDate, Priority, Project, ProjectPriority, ProjectStatus, Task, TaskStatus } from '../core/types';
import { isIsoDate } from '../core/dates';
import { linksIn } from '../core/links';
import type { HelmIndex } from '../data/index';
import type { Mutations } from '../data/mutations';
import { isBlocked, isOpen, plannedDate } from '../data/planner';

export const API_BASE = '/helm/v1';

export interface ApiRequest {
  method: string;
  /** Path with the base stripped: `tasks`, `tasks/tsk-abc`, … */
  path: string;
  query: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse { status: number; body: unknown }

export interface ApiDeps {
  index: HelmIndex;
  mutations: Mutations;
  settings: () => HelmSettings;
  today: () => IsoDate;
  version: string;
  /** Paths written while handling this request, for the reply. */
  written: () => string[];
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const made = (body: unknown): ApiResponse => ({ status: 201, body });
const bad = (message: string): ApiResponse => ({ status: 400, body: { error: message } });
const missing = (message: string): ApiResponse => ({ status: 404, body: { error: message } });

const STATUSES: TaskStatus[] = ['todo', 'doing', 'done', 'cancelled', 'waiting', 'forwarded'];
const PARTS: DayPart[] = ['morning', 'afternoon', 'evening', 'anytime'];
const PRIORITIES: Priority[] = ['highest', 'high', 'medium', 'normal', 'low', 'lowest'];
const PROJECT_STATUSES: ProjectStatus[] = ['idea', 'planned', 'active', 'on-hold', 'done', 'cancelled', 'archived'];
const PROJECT_PRIORITIES: ProjectPriority[] = ['low', 'normal', 'medium', 'high', 'urgent', 'critical'];

const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {});
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const day = (v: unknown): IsoDate | undefined => { const s = str(v); return s && isIsoDate(s) ? s : undefined; };
const has = (body: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(body, k);

function taskJson(t: Task, d: ApiDeps): Record<string, unknown> {
  const p = t.projectId ? d.index.project(t.projectId) : undefined;
  const kids = t.childKeys.map((k) => d.index.task(k)).filter((x): x is Task => x !== undefined);
  return {
    id: t.id ?? null,
    key: t.key,
    text: t.text,
    status: t.status,
    open: isOpen(t),
    blocked: isBlocked(t, d.index.snapshot),
    source: t.origin,
    path: t.path,
    line: t.line,
    depth: t.depth,
    ...(p ? { project: { id: p.id, title: p.title } } : {}),
    ...(t.phaseTitle ? { phase: t.phaseTitle } : {}),
    scheduled: plannedDate(t) ?? null,
    due: t.due ?? null,
    part: t.part ?? null,
    time: t.time ?? null,
    effortMinutes: t.effortMinutes ?? null,
    priority: t.priority,
    tags: t.tags,
    links: linksIn(t.text).map((l) => ({ url: l.url, label: l.label })),
    blockedBy: t.blockedBy,
    parentId: t.parentKey ? d.index.task(t.parentKey)?.id ?? null : null,
    subtasks: kids.map((c) => ({ id: c.id ?? null, key: c.key, text: c.text, status: c.status })),
    recurrence: t.recurrence?.raw ?? null,
  };
}

function projectJson(p: Project, d: ApiDeps): Record<string, unknown> {
  const tasks = [...d.index.snapshot.tasks.values()].filter((t) => t.projectId === p.id && t.origin === 'project');
  return {
    id: p.id,
    title: p.title,
    status: p.status,
    priority: p.priority,
    area: p.area ?? null,
    parentId: p.parentId ?? null,
    period: p.period ?? null,
    start: p.start ?? null,
    due: p.due ?? null,
    path: p.path,
    tags: p.tags,
    phases: p.phases.map((ph) => ({ id: ph.id, title: ph.title, due: ph.due ?? null })),
    counts: { open: tasks.filter(isOpen).length, total: tasks.length },
  };
}

/** A task by its 🆔, or failing that by its index key. */
function findTask(ref: string, d: ApiDeps): Task | undefined {
  const byId = [...d.index.snapshot.tasks.values()].find((t) => t.id === ref && t.origin !== 'daily-mirror');
  return byId ?? d.index.task(ref);
}

export async function handle(req: ApiRequest, d: ApiDeps): Promise<ApiResponse> {
  const parts = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [head, ref, sub] = parts;
  const body = asRecord(req.body);
  const method = req.method.toUpperCase();

  if (head === 'health' && method === 'GET') {
    const snap = d.index.snapshot;
    return ok({ ok: true, version: d.version, ready: d.index.ready, today: d.today(), counts: { tasks: snap.tasks.size, projects: snap.projects.size, habits: snap.habits.size } });
  }

  if (head === 'tasks') {
    if (method === 'GET' && ref === undefined) return ok({ tasks: listTasks(req.query, d) });
    if (method === 'GET' && ref !== undefined) {
      const t = findTask(ref, d);
      return t ? ok(taskJson(t, d)) : missing(`No task ${ref}`);
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
    if (ref !== undefined && sub === undefined && (method === 'PATCH' || method === 'PUT')) return patchTask(ref, body, d);
    if (ref !== undefined && sub === undefined && method === 'DELETE') {
      const t = findTask(ref, d);
      if (!t) return missing(`No task ${ref}`);
      await d.mutations.deleteTask(t.key);
      return ok({ deleted: ref, written: d.written() });
    }
    return { status: 405, body: { error: `Cannot ${method} ${req.path}` } };
  }

  if (head === 'projects') {
    if (method === 'GET' && ref === undefined) {
      const all = d.index.allProjects().filter((p) => !req.query['status'] || p.status === req.query['status']);
      return ok({ projects: all.map((p) => projectJson(p, d)) });
    }
    if (method === 'GET' && ref !== undefined) {
      const p = d.index.project(ref);
      return p ? ok(projectJson(p, d)) : missing(`No project ${ref}`);
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
    return { status: 405, body: { error: `Cannot ${method} ${req.path}` } };
  }

  return missing(`No route ${req.path}`);
}

function listTasks(q: Record<string, string>, d: ApiDeps): Record<string, unknown>[] {
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
function fieldsFrom(body: Record<string, unknown>): { fields?: Record<string, unknown> } {
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

async function createTask(body: Record<string, unknown>, d: ApiDeps): Promise<ApiResponse> {
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

async function patchTask(ref: string, body: Record<string, unknown>, d: ApiDeps): Promise<ApiResponse> {
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
