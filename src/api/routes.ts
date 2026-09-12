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
import { attachmentsJson, ctxOf, goalJson, healthJson, healthOf, projectJson, refOf, taskDetailJson, taskJson, taskTree, type ApiDeps, type Ctx } from './json';
import { attachmentRoutes, findGoal, handleV2, reportRoute } from './v2';
import { parseProjectLog } from '../core/project';
import { formatRecurrence, parseRecurrence } from '../core/recurrence';
import { normaliseLink } from '../core/links';
import { runBulk } from '../data/bulk';
import { conflictsFor } from '../data/conflicts';
import { nextOccurrenceOf } from '../data/planner';

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

export interface ApiResponse {
  status: number;
  body: unknown;
  /** Bytes instead of JSON (an image); `body` is ignored when set. */
  raw?: { contentType: string; bytes: Uint8Array };
}

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
/** A non-empty string without control characters (a newline in a field would break a task line or inject a frontmatter key). */
export const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' && !/[\u0000-\u001f\u007f]/.test(v) ? v.trim() : undefined);
export const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
export const day = (v: unknown): IsoDate | undefined => { const s = str(v); return s && isIsoDate(s) ? s : undefined; };
export const has = (body: Record<string, unknown>, k: string): boolean => Object.prototype.hasOwnProperty.call(body, k);
/** A real clock time, `HH:MM`. */
export const isHhmm = (v: unknown): boolean => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
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

/** A task by its 🆔, or failing that by its index key — a live line wins over a forwarded record. Ids are looked up in one map built per request, not by scanning. */
export function findTask(ref: string, d: Ctx): Task | undefined {
  if (!d.byId || d.byIdRevision !== d.index.revision) {
    d.byId = new Map();
    for (const t of d.index.snapshot.tasks.values()) {
      if (!t.id || t.origin === 'daily-mirror') continue;
      const cur = d.byId.get(t.id);
      // The same rule as index.taskById: a live line beats a forwarded or cancelled record.
      if (!cur || ((cur.status === 'forwarded' || cur.status === 'cancelled') && t.status !== 'forwarded' && t.status !== 'cancelled')) d.byId.set(t.id, t);
    }
    d.byIdRevision = d.index.revision;
  }
  return d.byId.get(ref) ?? d.index.task(ref);
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
    if (method === 'POST' && ref === 'bulk' && sub === undefined) return bulkTasks(body, d);
    if (ref !== undefined && sub === 'subtasks' && parts[3] === 'reorder' && method === 'POST') {
      const t = findTask(ref, d);
      if (!t) return missing(`No task ${ref}`);
      if (!t.parentKey) return bad('Only a subtask can be reordered among its siblings');
      const beforeRef = has(body, 'beforeRef') ? body['beforeRef'] : body['before'];
      const before = beforeRef === null || beforeRef === undefined ? undefined : findTask(String(beforeRef), d);
      if (beforeRef !== null && beforeRef !== undefined && !before) return missing(`No task ${String(beforeRef)}`);
      await d.mutations.reorderSubtask(t.key, before?.key);
      const parent = d.index.task(t.parentKey);
      return ok({ task: taskJson(findTask(ref, d) ?? t, d), siblings: (parent?.childKeys ?? []).map((k) => d.index.task(k)).filter((x): x is Task => x !== undefined).map(refOf), written: d.written() });
    }
    if (ref !== undefined && sub === 'subtasks' && method === 'POST') {
      const parent = findTask(ref, d);
      if (!parent) return missing(`No task ${ref}`);
      const text = str(body['text']);
      if (!text) return bad('A subtask needs text');
      const fe = fieldsError(body);
      if (fe) return bad(fe);
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
    if (ref !== undefined && (sub === 'attachments' || sub === 'notes' || sub === 'drawings') && sub !== undefined) {
      const t = findTask(ref, d);
      if (!t) return missing(`No task ${ref}`);
      const r = await attachmentRoutes({ kind: 'task', key: t.mirrorOf ?? t.key, ...(t.id ? { id: t.id } : {}), title: t.text.trim() || 'task' }, sub, parts[3], method, body, req.query, d);
      if (r) return r;
    }
    if (ref !== undefined && sub !== undefined && parts.length === 3) {
      const t = findTask(ref, d);
      if (!t) return missing(`No task ${ref}`);
      const r = await taskAction(t, sub, method, method === 'GET' ? req.query : body, d);
      if (r) return r;
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
    if (method === 'POST' && ref !== undefined && sub === 'phases' && parts.length === 3) {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const title = str(body['title']);
      if (!title) return bad('A phase needs a title');
      if (body['due'] !== undefined && body['due'] !== null && !day(body['due'])) return bad('due must be a date like 2026-09-30');
      const tasks = strList(body['tasks']);
      if (tasks.length === 0) {
        await d.mutations.addPhase(p.id, title, day(body['due']));
        const after = d.index.project(p.id);
        const ph = after?.phases.find((x) => x.title === title.trim());
        return made({ phase: ph ? { id: ph.id, slug: ph.slug, title: ph.title, due: ph.due ?? null } : { title }, tasks: [], written: d.written() });
      }
      const r = await d.mutations.addPhaseWithTasks(p.id, title, tasks, num(body['effortMinutes']));
      return made({ phase: { id: r.phaseId, title }, tasks: r.tasks.map((t) => taskJson(t, d)), written: d.written() });
    }
    if (ref !== undefined && sub === 'phases' && parts[3] !== undefined && (parts[4] === 'attachments' || parts[4] === 'notes' || parts[4] === 'drawings')) {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const slug = parts[3];
      const ph = p.phases.find((x) => x.slug === slug || x.id === slug || x.id === `${p.id}#${slug}`);
      if (!ph) return missing(`No phase ${slug} in ${p.id}`);
      const r = await attachmentRoutes({ kind: 'phase', id: ph.id, projectId: p.id, title: ph.title }, parts[4], parts[5], method, body, req.query, d);
      if (r) return r;
    }
    if (ref !== undefined && sub === 'phases' && parts[3] !== undefined && parts[4] === 'links' && (method === 'POST' || method === 'DELETE')) {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const slug = parts[3];
      const ph = p.phases.find((x) => x.slug === slug || x.id === slug || x.id === `${p.id}#${slug}`);
      if (!ph) return missing(`No phase ${slug} in ${p.id}`);
      const url = str(body['url']) ?? req.query['url'];
      if (!url) return bad('Send the url');
      if (method === 'POST') {
        const link = normaliseLink(url, str(body['label']) ?? '');
        if (!link) return bad('url must be a web address');
        await d.mutations.addPhaseLink(ph.id, link.url, link.label);
      } else await d.mutations.removePhaseLink(ph.id, url);
      return ok({ phase: { id: ph.id, slug: ph.slug, title: ph.title }, links: d.index.project(p.id)?.phases.find((x) => x.id === ph.id)?.links ?? [], written: d.written() });
    }
    if (method === 'POST' && ref === 'reorder' && sub === undefined) {
      const ids = strList(body['ids']);
      if (!ids.length) return bad('ids must be a list of project ids');
      const unknown = ids.filter((id) => !d.index.project(id));
      if (unknown.length) return missing(`No project ${unknown[0]}`);
      await d.mutations.setProjectOrder(ids);
      return ok({ order: ids, written: d.written() });
    }
    if (ref !== undefined && sub === 'phases' && parts[3] !== undefined && (method === 'PATCH' || method === 'PUT' || method === 'DELETE')) {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const slug = parts[3];
      const ph = p.phases.find((x) => x.slug === slug || x.id === slug || x.id === `${p.id}#${slug}`);
      if (!ph) return missing(`No phase ${slug} in ${p.id}`);
      if (method === 'DELETE') {
        const carried = await d.mutations.deletePhase(p.id, ph.id);
        return ok({ deleted: ph.id, carried, written: d.written() });
      }
      const title = str(body['title']) ?? ph.title;
      if (has(body, 'due') && body['due'] !== null && !day(body['due'])) return bad('due must be a date like 2026-09-30, or null to clear it');
      if (!str(body['title']) && !has(body, 'due')) return bad('Nothing to change');
      await d.mutations.renamePhase(p.id, ph.id, title, has(body, 'due') ? (body['due'] === null ? null : day(body['due'])) : undefined);
      const after = d.index.project(p.id);
      return ok({ project: after ? projectJson(after, d, { health: true }) : null, written: d.written() });
    }
    if (method === 'POST' && ref !== undefined && sub === 'log') {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const text = str(body['text']);
      if (!text) return bad('A log entry needs text');
      await d.mutations.appendLog(p.id, text);
      return made({ log: parseProjectLog(await d.read(p.path)), written: d.written() });
    }
    if (ref !== undefined && sub === 'links' && (method === 'POST' || method === 'DELETE')) {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const url = str(body['url']) ?? req.query['url'];
      if (!url) return bad('Send the url');
      if (method === 'POST') {
        const link = normaliseLink(url, str(body['label']) ?? '');
        if (!link) return bad('url must be a web address');
        await d.mutations.addProjectLink(p.id, link.url, link.label);
      } else await d.mutations.removeProjectLink(p.id, url);
      return ok({ links: d.index.project(p.id)?.links ?? [], written: d.written() });
    }
    if (method === 'POST' && ref !== undefined && sub === 'related') {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const tref = str(body['ref']) ?? str(body['taskId']);
      if (!tref) return bad('Send the task ref');
      const t = findTask(tref, d);
      if (!t) return missing(`No task ${tref}`);
      const id = await d.mutations.linkTaskToProject(p.id, t.key);
      return ok({ taskId: id, relatedTaskIds: d.index.project(p.id)?.relatedTaskIds ?? [], written: d.written() });
    }
    if (method === 'DELETE' && ref !== undefined && sub === 'related' && parts[3] !== undefined) {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const taskId = parts[3];
      if (!p.relatedTaskIds.includes(taskId)) return missing(`${taskId} is not a related task of ${p.id}`);
      await d.mutations.unlinkTaskFromProject(p.id, taskId);
      return ok({ relatedTaskIds: d.index.project(p.id)?.relatedTaskIds ?? [], written: d.written() });
    }
    if (ref !== undefined && (sub === 'attachments' || sub === 'notes' || sub === 'drawings')) {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const r = await attachmentRoutes({ kind: 'project', id: p.id, title: p.title }, sub, parts[3], method, body, req.query, d);
      if (r) return r;
    }
    if (method === 'GET' && ref !== undefined && sub === 'report') {
      const p = d.index.project(ref);
      return p ? reportRoute(req.query, d, p.id) : missing(`No project ${ref}`);
    }
    if (method === 'POST' && ref !== undefined && sub === 'goal') {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      if (!has(body, 'goalKey') && !has(body, 'goal')) return bad('Send goalKey: "gol-…" to bind, or null to unbind');
      const raw = has(body, 'goalKey') ? body['goalKey'] : body['goal'];
      const key = raw === null ? null : str(raw);
      if (key === undefined) return bad('goalKey must be a goal id or null');
      const g = key === null ? null : findGoal(key, d);
      if (key !== null && !g) return missing(`No goal ${key}`);
      await d.mutations.linkProjectToGoal(p.id, g ? g.key : null);
      const after = d.index.project(p.id);
      return ok({ project: after ? projectJson(after, d, { health: true }) : null, written: d.written() });
    }
    if (method === 'POST' && ref !== undefined && sub === 'archive') {
      const p = d.index.project(ref);
      if (!p) return missing(`No project ${ref}`);
      const path = await d.mutations.archiveProject(p.id);
      return ok({ archived: p.id, path, written: d.written() });
    }
    if (method === 'GET' && ref !== undefined && sub === undefined) {
      const p = d.index.project(ref);
      return p ? ok(await projectDetailJson(p, d)) : missing(`No project ${ref}`);
    }
    if (method === 'POST' && ref === undefined) {
      const title = str(body['title']);
      if (!title) return bad('A project needs a title');
      const status = str(body['status']) ?? 'active';
      if (!PROJECT_STATUSES.includes(status as ProjectStatus)) return bad(`status must be one of ${PROJECT_STATUSES.join(', ')}`);
      const priority = str(body['priority']) ?? 'normal';
      if (!PROJECT_PRIORITIES.includes(priority as ProjectPriority)) return bad(`priority must be one of ${PROJECT_PRIORITIES.join(', ')}`);
      if (str(body['goal']) && !findGoal(str(body['goal'])!, d)) return missing(`No goal ${str(body['goal'])}`);
      const phases: { title: string; due?: IsoDate; tasks?: string[] }[] = [];
      for (const raw of Array.isArray(body['phases']) ? body['phases'] as unknown[] : []) {
        const ph = asRecord(raw);
        const title = str(ph['title']);
        if (!title) return bad('Every phase needs a title');
        if (ph['due'] !== undefined && ph['due'] !== null && !day(ph['due'])) return bad('A phase due must be a date like 2026-09-30');
        phases.push({ title, ...(day(ph['due']) ? { due: day(ph['due'])! } : {}), ...(strList(ph['tasks']).length ? { tasks: strList(ph['tasks']) } : {}) });
      }
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
        ...(str(body['goal']) ? { goal: findGoal(str(body['goal'])!, d)?.id ?? str(body['goal'])! } : {}),
        ...(strList(body['tags']).length ? { tags: strList(body['tags']).map((x) => x.replace(/^#/, '')) } : {}),
        ...(str(body['objective']) ? { objective: str(body['objective'])! } : {}),
        ...(strList(body['notes']).length ? { notes: strList(body['notes']) } : {}),
        ...(phases.length ? { phases } : {}),
        ...(strList(body['tasks']).length ? { tasks: strList(body['tasks']) } : {}),
      });
      return made({ project: projectJson(p, d, { health: true }), written: d.written() });
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
      if (has(body, 'pinned')) { if (typeof body['pinned'] !== 'boolean') return bad('pinned must be true or false'); fields.pinned = body['pinned']; }
      if (has(body, 'order')) { const n = body['order'] === null ? null : num(body['order']); if (n === undefined) return bad('order must be a number or null'); fields.order = n; }
      if (has(body, 'goal')) {
        const g = body['goal'] === null ? null : str(body['goal']);
        if (g === undefined) return bad('goal must be a goal id or null');
        if (g !== null && !findGoal(g, d)) return missing(`No goal ${g}`);
        fields.goal = g === null ? null : findGoal(g, d)!.id;
      }
      if (has(body, 'parentId')) return bad('parentId cannot be changed over the API: Helm derives a project\'s parent from its folder; move the folder instead');
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

/** `POST /tasks/:id/<action>` and the link routes. Undefined when `sub` is not one of them. */
async function taskAction(t: Task, sub: string, method: string, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse | undefined> {
  if (sub === 'skip' && method === 'POST') {
    if (!t.recurrence?.parsed) return bad('Only a repeating task can skip an occurrence; cancel it instead');
    const next = nextOccurrenceOf(t, d.today()) ?? null;
    await d.mutations.setStatus(t.key, 'cancelled');
    return ok({ task: taskJson(findTask(refOf(t), d) ?? t, d), next, written: d.written() });
  }
  if (sub === 'ensure-id' && method === 'POST') {
    const id = await d.mutations.ensureId(t.key);
    return ok({ id, task: taskJson(findTask(id, d) ?? t, d), written: d.written() });
  }
  if (sub === 'conflicts' && method === 'GET') {
    const q = body as Record<string, unknown>; // the query, passed through
    const date = day(q['date']) ?? t.scheduled ?? t.noteDate;
    if (!date) return bad('date is needed for a task that is not on a day');
    const start = str(q['time']) ?? t.time?.start;
    if (!start) return bad('time is needed for a task without a time block');
    if (!isHhmm(start)) return bad('time must be HH:MM');
    const end = str(q['timeEnd']) ?? (str(q['time']) ? undefined : t.time?.end);
    const eff = q['effortMinutes'] !== undefined ? Number(q['effortMinutes']) : t.effortMinutes;
    const cs = conflictsFor(d.index.snapshot, date, { start, ...(end ? { end } : {}) }, d.settings(), { ...(eff ? { effortMinutes: eff } : {}), excludeKeys: [t.key, ...(t.mirrorOf ? [t.mirrorOf] : [])] });
    return ok({ date, time: start, timeEnd: end ?? null, conflicts: cs.map((b) => ({ start: b.start, end: b.end, ref: refOf(b.task), label: b.label })) });
  }
  if (sub === 'stop-repeating' && method === 'POST') {
    if (!t.recurrence) return bad('This task does not repeat');
    await d.mutations.stopRepeating(t.key);
    return ok({ task: taskJson(findTask(refOf(t), d) ?? t, d), written: d.written() });
  }
  if (sub === 'followup' && method === 'POST') {
    const date = day(body['date']);
    if (!date) return bad('A follow-up needs a date like 2026-09-15');
    const part = str(body['part']);
    if (part && !PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
    const fe = fieldsError(body);
    if (fe) return bad(fe);
    const r = await d.mutations.followUp(t.key, { date, ...(str(body['text']) ? { text: str(body['text'])! } : {}), ...(part ? { part: part as DayPart } : {}), markOriginalDone: body['markOriginalDone'] === true, addTag: body['addTag'] === true, ...fieldsFrom(body) });
    const made2 = findTask(r.followUpId, d);
    return made({ followUp: made2 ? taskJson(made2, d) : { id: r.followUpId }, original: taskJson(findTask(r.id, d) ?? t, d), written: d.written() });
  }
  if (sub === 'plan-into' && method === 'POST') {
    const date = day(body['date']);
    if (!date) return bad('plan-into needs a date like 2026-09-15');
    const time = asRecord(body['time']);
    const start = str(time['start']) ?? str(body['time']);
    const end = str(time['end']) ?? str(body['timeEnd']);
    if (!start || !end || !isHhmm(start) || !isHhmm(end)) return bad('time must be { start: "HH:MM", end: "HH:MM" }');
    const eff = num(body['effortMinutes']) ?? t.effortMinutes ?? d.settings().defaultEffortMinutes;
    await d.mutations.planInto(t.key, date, { start, end }, eff);
    return ok({ task: taskJson(findTask(refOf(t), d) ?? t, d), written: d.written() });
  }
  if (sub === 'project' && method === 'POST') {
    const status = str(body['status']) ?? 'active';
    if (!PROJECT_STATUSES.includes(status as ProjectStatus)) return bad(`status must be one of ${PROJECT_STATUSES.join(', ')}`);
    const priority = str(body['priority']) ?? 'normal';
    if (!PROJECT_PRIORITIES.includes(priority as ProjectPriority)) return bad(`priority must be one of ${PROJECT_PRIORITIES.join(', ')}`);
    if (str(body['parentId']) && !d.index.project(str(body['parentId'])!)) return missing(`No project ${str(body['parentId'])}`);
    const r = await d.mutations.projectFromTask(t.key, {
      ...(str(body['title']) ? { title: str(body['title'])! } : {}),
      status: status as ProjectStatus, priority: priority as ProjectPriority,
      ...(str(body['area']) ? { area: str(body['area'])! } : {}),
      ...(str(body['parentId']) ? { parentId: str(body['parentId'])! } : {}),
      ...(str(body['period']) ? { period: str(body['period'])! } : {}),
      ...(day(body['due']) ? { due: day(body['due'])! } : {}),
    });
    const fresh = d.index.project(r.project.id) ?? r.project;
    return made({ project: projectJson(fresh, d, { health: true }), carried: r.carried, written: d.written() });
  }
  if (sub === 'links' && (method === 'POST' || method === 'DELETE')) {
    const url = str(body['url']);
    if (!url) return bad('Send the url');
    if (method === 'POST') {
      const link = normaliseLink(url, str(body['label']) ?? '');
      if (!link) return bad('url must be a web address');
      await d.mutations.addLink(t.key, link.url, link.label);
    } else await d.mutations.removeLink(t.key, url);
    return ok({ task: taskJson(findTask(refOf(t), d) ?? t, d), written: d.written() });
  }
  return undefined;
}

const BULK_ACTIONS = ['schedule', 'part', 'status', 'move', 'delete'] as const;

/** `POST /tasks/bulk`: one action over many refs, the way the selection bar does it. */
async function bulkTasks(body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const refs = strList(body['refs']);
  if (!refs.length) return bad('refs must be a list of task refs');
  if (refs.length > 500) return bad('At most 500 refs at a time');
  const action = str(body['action']);
  if (!action || !BULK_ACTIONS.includes(action as typeof BULK_ACTIONS[number])) return bad(`action must be one of ${BULK_ACTIONS.join(', ')}`);
  const tasks: Task[] = [];
  const failed: { ref: string; error: string }[] = [];
  for (const r of refs) { const t = findTask(r, d); if (t) tasks.push(t); else failed.push({ ref: r, error: `No task ${r}` }); }
  const part = str(body['part']);
  if (part && !PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
  let each: (key: string, t: Task) => Promise<unknown>;
  switch (action) {
    case 'schedule': {
      if (has(body, 'date') && body['date'] !== null && !day(body['date'])) return bad('date must be a date like 2026-09-15, or null to unschedule');
      const when = body['date'] === null || !has(body, 'date') ? undefined : day(body['date']);
      each = (key) => d.mutations.schedule(key, when, part as DayPart | undefined);
      break;
    }
    case 'part': {
      if (!part) return bad('part is needed');
      each = (key) => d.mutations.setPart(key, part as DayPart);
      break;
    }
    case 'status': {
      const st = str(body['status']);
      if (!st || !STATUSES.includes(st as TaskStatus)) return bad(`status must be one of ${STATUSES.join(', ')}`);
      each = (key) => d.mutations.setStatus(key, st as TaskStatus);
      break;
    }
    case 'move': {
      const projectId = str(body['projectId']);
      if (!projectId || !d.index.project(projectId)) return missing(`No project ${projectId ?? ''}`);
      each = (key) => d.mutations.moveToProject(key, projectId, str(body['phaseId']));
      break;
    }
    default: each = (key) => d.mutations.deleteTask(key);
  }
  const r = await runBulk(d.index, d.mutations, tasks, each);
  return ok({ action, applied: r.applied.length, appliedIds: r.applied, covered: r.covered, failed: [...failed, ...r.failed], written: d.written() });
}

/** The whole project, as the project page reads it. */
async function projectDetailJson(p: Project, d: Ctx): Promise<Record<string, unknown>> {
  const snap = d.index.snapshot;
  const h = healthOf(p, d);
  const tops = (keys: string[]): Record<string, unknown>[] => keys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined && !t.parentKey).map((t) => taskTree(t, d));
  const parent = p.parentId ? d.index.project(p.parentId) : undefined;
  const goal = p.goalId ? findGoal(p.goalId, d) : undefined;
  let log: ReturnType<typeof parseProjectLog> = [];
  try { log = parseProjectLog(await d.read(p.path)); } catch { /* the note is gone; the index will catch up */ }
  return {
    ...projectJson(p, d, { health: true }),
    phases: p.phases.map((ph) => { const pp = h.phaseProgress.find((x) => x.phase.id === ph.id); return { id: ph.id, slug: ph.slug, title: ph.title, due: ph.due ?? null, links: ph.links, taskCount: pp?.total ?? ph.taskKeys.length, doneCount: pp?.done ?? 0, state: pp?.state ?? 'planned', tasks: tops(ph.taskKeys) }; }),
    looseTasks: tops(p.looseTaskKeys),
    children: p.childIds.map((id) => d.index.project(id)).filter((c): c is Project => c !== undefined).map((c) => projectJson(c, d, { health: true })),
    parent: parent ? { id: parent.id, title: parent.title } : null,
    goal: goal ? goalJson(goal, d) : null,
    attachments: attachmentsJson({ kind: 'project', id: p.id, title: p.title }, d),
    log,
    nextAction: h.nextAction ? taskJson(h.nextAction, d) : null,
    health: healthJson(h, d),
  };
}

export function listTasks(q: Record<string, string>, d: Ctx): Record<string, unknown>[] {
  const today = d.today();
  const limit = Math.min(Math.max(1, Number(q['limit'] ?? 200) || 200), 1000);
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
/** What is wrong with the task-line fields in a body, or undefined when they are fine. Checked before anything is written. */
export function fieldsError(body: Record<string, unknown>): string | undefined {
  if (has(body, 'effortMinutes') && body['effortMinutes'] !== null && (num(body['effortMinutes']) === undefined || num(body['effortMinutes'])! < 0)) return 'effortMinutes must be a number of minutes, or null to clear it';
  if (has(body, 'due') && body['due'] !== null && !day(body['due'])) return 'due must be a date like 2026-09-20, or null to clear it';
  if (has(body, 'priority') && (!str(body['priority']) || !PRIORITIES.includes(str(body['priority']) as Priority))) return `priority must be one of ${PRIORITIES.join(', ')}`;
  if (has(body, 'time') && body['time'] !== null && (!str(body['time']) || !isHhmm(str(body['time'])!))) return 'time must be HH:MM';
  if (has(body, 'timeEnd') && body['timeEnd'] !== null && (!str(body['timeEnd']) || !isHhmm(str(body['timeEnd'])!))) return 'timeEnd must be HH:MM';
  return undefined;
}

export function fieldsFrom(body: Record<string, unknown>): { fields?: Record<string, unknown> } {
  const fields: Record<string, unknown> = {};
  const eff = num(body['effortMinutes']);
  if (eff !== undefined) { fields['effortMinutes'] = eff; fields['effortRaw'] = `${eff}m`; }
  if (day(body['due'])) fields['due'] = day(body['due']);
  const prio = str(body['priority']);
  if (prio && PRIORITIES.includes(prio as Priority)) fields['priority'] = prio;
  const start = str(body['time']);
  const end = str(body['timeEnd']);
  if (start && isHhmm(start)) fields['time'] = { start, ...(end && isHhmm(end) ? { end } : {}) };
  return Object.keys(fields).length ? { fields } : {};
}

async function createTask(body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const text = str(body['text']);
  if (!text) return bad('A task needs text');
  const fe = fieldsError(body);
  if (fe) return bad(fe);
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
  if (has(body, 'parentId')) return bad('parentId cannot be changed over the API; delete the task and add it under the other one, or move it with projectId');
  if (has(body, 'progress')) {
    const pr = body['progress'] === null ? undefined : num(body['progress']);
    if (body['progress'] !== null && (pr === undefined || pr < 0 || pr > 100)) return bad('progress must be 0–100, or null to clear it');
    await d.mutations.setProgress(findTask(ref, d)!.key, pr);
    touched = true;
  }
  if (has(body, 'recurrence')) {
    if (body['recurrence'] === null) { await d.mutations.stopRepeating(findTask(ref, d)!.key); touched = true; }
    else {
      const raw = str(body['recurrence']);
      const r = raw ? parseRecurrence(raw) : undefined;
      if (!r || !r.parsed) return bad('recurrence must be a rule like "every week on monday", or null to stop repeating');
      await d.mutations.updateTask(findTask(ref, d)!.key, { recurrence: { ...r, raw: formatRecurrence(r) } });
      touched = true;
    }
  }
  const patch: Record<string, unknown> = {};
  if (has(body, 'start')) {
    if (body['start'] !== null && !day(body['start'])) return bad('start must be a date like 2026-09-15, or null to clear it');
    patch['start'] = body['start'] === null ? undefined : day(body['start']);
  }
  if (has(body, 'blockedBy')) {
    if (!Array.isArray(body['blockedBy'])) return bad('blockedBy must be a list of refs ([] clears it)');
    const ids: string[] = [];
    for (const r of strList(body['blockedBy'])) {
      const b = findTask(r, d);
      if (!b) return missing(`No task ${r}`);
      if (b.key === findTask(ref, d)!.key) return bad('A task cannot block itself');
      ids.push(b.id ?? await d.mutations.ensureId(b.key));
    }
    patch['blockedBy'] = [...new Set(ids)];
  }
  if (has(body, 'time')) {
    if (body['time'] === null) patch['time'] = undefined;
    else {
      const start = str(body['time']);
      if (!start || !isHhmm(start)) return bad('time must be HH:MM, or null to clear the block');
      const end = str(body['timeEnd']);
      if (end && !isHhmm(end)) return bad('timeEnd must be HH:MM');
      patch['time'] = { start, ...(end ? { end } : {}) };
    }
  } else if (str(body['timeEnd'])) {
    const cur = findTask(ref, d)!.time;
    if (!cur) return bad('timeEnd needs a time to go with it');
    const end = str(body['timeEnd'])!;
    if (!isHhmm(end)) return bad('timeEnd must be HH:MM');
    patch['time'] = { start: cur.start, end };
  }
  if (has(body, 'text')) { const tx = str(body['text']); if (!tx) return bad('text must be one non-empty line'); patch['text'] = tx; }
  if (has(body, 'due')) {
    if (body['due'] !== null && !day(body['due'])) return bad('due must be a date like 2026-09-20, or null to clear it');
    patch['due'] = body['due'] === null ? undefined : day(body['due']);
  }
  if (has(body, 'effortMinutes')) {
    const eff = body['effortMinutes'] === null ? undefined : num(body['effortMinutes']);
    if (body['effortMinutes'] !== null && (eff === undefined || eff < 0)) return bad('effortMinutes must be a number of minutes, or null to clear it');
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
