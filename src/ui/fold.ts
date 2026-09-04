/**
 * Which tasks have their steps folded away.
 *
 * Kept in memory rather than on the line: folding is how you are looking at the list right now, not
 * something about the task, and writing it to the note would be a change to your vault for the sake of
 * a chevron. It is remembered by the task's id, or by where it sits and what it says — steadier than a
 * line's key, which changes the moment anything on the line does.
 */
import type { Task } from '../core/types';
import { plainLabel } from '../core/label';

const folded = new Set<string>();

export const foldId = (t: Task): string => t.id ?? `${t.path}:${plainLabel(t.text)}`;

export const isFolded = (t: Task): boolean => folded.has(foldId(t));

export function setFolded(t: Task, fold: boolean): void {
  if (fold) folded.add(foldId(t));
  else folded.delete(foldId(t));
}

export const toggleFold = (t: Task): boolean => { const next = !isFolded(t); setFolded(t, next); return next; };

/** Fold or unfold a whole run of tasks at once — what alt-click does. */
export function foldAll(tasks: Task[], fold: boolean): void {
  for (const t of tasks) setFolded(t, fold);
}

/** Nothing folded anywhere: used to decide which way “fold them all” should go. */
export const anyFolded = (tasks: Task[]): boolean => tasks.some((t) => isFolded(t));

/** Only for tests — the set outlives a render on purpose. */
export const clearFolds = (): void => folded.clear();
