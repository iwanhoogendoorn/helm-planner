/**
 * Doing one thing to many tasks at once, the way the selection bar does it: every task gets a 🆔
 * first (a key is a hash of where a line sits and stops being true the moment a line moves), then
 * each is acted on once — a task whose parent is also picked is left to travel with its parent.
 */
import type { Task } from '../core/types';
import type { HelmIndex } from './index';
import type { Mutations } from './mutations';

export interface BulkResult {
  /** Ids the action ran on. */
  applied: string[];
  /** Ids skipped because a parent in the set covered them. */
  covered: string[];
  failed: { ref: string; error: string }[];
}

/** The task with this id — a mirror line too, which `taskById` passes over on purpose; scheduling one is still meaningful. */
export function taskByAnyId(index: HelmIndex, id: string): Task | undefined {
  const own = index.taskById(id);
  if (own) return own;
  for (const t of index.snapshot.tasks.values()) if (t.id === id) return t;
  return undefined;
}

/** Every key beneath a task, however deep. */
export function descendantsOf(index: HelmIndex, t: Task): string[] {
  const out: string[] = [];
  const walk = (task: Task): void => {
    for (const k of task.childKeys) {
      out.push(k);
      const c = index.task(k);
      if (c) walk(c);
    }
  };
  walk(t);
  return out;
}

/**
 * Run `each` over the tasks. `stopOnError` is what the UI does (one failure aborts the run and is
 * thrown); the API keeps going and reports the failures instead.
 */
export async function runBulk(index: HelmIndex, mutations: Mutations, tasks: Task[], each: (key: string, t: Task) => Promise<unknown>, opts: { stopOnError?: boolean } = {}): Promise<BulkResult> {
  // Where the picked tasks sit, by file and line: writing an id does not move a line, so these stay true through the pinning — unlike the keys.
  const at = tasks.map((t) => ({ path: t.path, line: t.line, ref: t.id ?? t.key }));
  const out: BulkResult = { applied: [], covered: [], failed: [] };
  const ids: string[] = [];
  for (const { path, line, ref } of at) {
    const t = [...index.snapshot.tasks.values()].find((x) => x.path === path && x.line === line && x.origin !== 'daily-mirror') ?? index.task(ref);
    if (!t) { out.failed.push({ ref, error: 'No longer there' }); continue; }
    try { ids.push(await mutations.ensureId(t.key)); } catch (e) { if (opts.stopOnError) throw e; out.failed.push({ ref, error: e instanceof Error ? e.message : String(e) }); }
  }
  const done = new Set<string>();
  for (const id of ids) {
    if (done.has(id)) continue;
    const t = taskByAnyId(index, id);
    if (!t) { done.add(id); out.failed.push({ ref: id, error: 'No longer there' }); continue; }
    // Its parent may have taken it along already; the parent's own move covers it.
    const parent = t.parentKey ? index.task(t.parentKey) : undefined;
    if (parent?.id && ids.includes(parent.id)) { done.add(id); out.covered.push(id); continue; }
    try { await each(t.key, t); out.applied.push(id); }
    catch (e) { if (opts.stopOnError) throw e; out.failed.push({ ref: id, error: e instanceof Error ? e.message : String(e) }); }
    done.add(id);
    // What sits beneath it travelled with it: a picked subtask is covered whether it came before or after its parent.
    for (const k of descendantsOf(index, t)) { const c = index.task(k); if (c?.id) { done.add(c.id); if (ids.includes(c.id) && !out.covered.includes(c.id)) out.covered.push(c.id); } }
  }
  return out;
}
