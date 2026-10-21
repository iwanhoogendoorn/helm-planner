/**
 * Follow-up links between tasks, looked up in maps built once per snapshot. `followsOf` and
 * `followUpsOf` in data/planner scan every task for every row; a list of R rows over N tasks paid
 * R·N on each render. These give the same answers in constant time per row. The index replaces its
 * snapshot object on every change, so a cache keyed on it can never go stale.
 */
import type { Snapshot, Task } from '../core/types';
import { isOpen } from '../data/planner';

interface Links { byId: Map<string, Task>; upsById: Map<string, Task[]> }

const cache = new WeakMap<Snapshot, Links>();

function linksOf(snap: Snapshot): Links {
  let l = cache.get(snap);
  if (l) return l;
  const byId = new Map<string, Task>();
  const upsById = new Map<string, Task[]>();
  for (const x of snap.tasks.values()) {
    if (x.origin === 'daily-mirror') continue;
    // The first line with an id wins, as the linear scan's `find` did.
    if (x.id && !byId.has(x.id)) byId.set(x.id, x);
    for (const id of new Set(x.blockedBy)) {
      const list = upsById.get(id);
      if (list) list.push(x); else upsById.set(id, [x]);
    }
  }
  const order = (a: Task, b: Task): number => Number(isOpen(b)) - Number(isOpen(a)) || (a.scheduled ?? a.noteDate ?? '').localeCompare(b.scheduled ?? b.noteDate ?? '');
  for (const list of upsById.values()) list.sort(order);
  l = { byId, upsById };
  cache.set(snap, l);
  return l;
}

/** The task a follow-up continues, when it is one: the first of its blockers that exists. */
export function followsOf(snap: Snapshot, t: Task): Task | undefined {
  const { byId } = linksOf(snap);
  for (const id of t.blockedBy) { const src = byId.get(id); if (src) return src; }
  return undefined;
}

/** The tasks that continue this one (anything waiting on its id), open first, then by date. */
export function followUpsOf(snap: Snapshot, t: Task): Task[] {
  return t.id ? [...(linksOf(snap).upsById.get(t.id) ?? [])] : [];
}
