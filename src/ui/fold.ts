/**
 * Which tasks have their steps folded away.
 *
 * Folding is how you are looking at a list, not something about the task, so it is never written to
 * your notes — but it does outlive the moment: a fold you made this morning is still there after a
 * reload, a restart, or a settings change, kept in Helm's own data file.
 *
 * Three states, not two. A task you have folded stays folded, a task you have unfolded stays unfolded,
 * and anything you have never touched follows **Start with steps folded** in the settings. That way the
 * default can change without throwing away a single choice you made by hand.
 *
 * A fold is remembered by the task's id, or by where it sits and what it says — steadier than a line's
 * key, which changes the moment anything on the line does.
 */
import type { Task } from '../core/types';
import { plainLabel } from '../core/label';

export interface FoldMemory {
  folded: string[];
  unfolded: string[];
}

const folded = new Set<string>();
const unfolded = new Set<string>();
let persist: ((m: FoldMemory) => void) | undefined;

/** How many choices are kept: enough for any real vault, bounded so the file cannot grow forever. */
const KEEP = 500;

export const foldId = (t: Task): string => t.id ?? `${t.path}:${plainLabel(t.text)}`;

/** Hand Helm's stored choices to the store, and tell it where to put new ones. */
export function loadFolds(m: Partial<FoldMemory> | undefined, save: (m: FoldMemory) => void): void {
  folded.clear();
  unfolded.clear();
  for (const id of m?.folded ?? []) folded.add(id);
  for (const id of m?.unfolded ?? []) unfolded.add(id);
  persist = save;
}

const trim = (s: Set<string>): string[] => [...s].slice(-KEEP);
const remember = (): void => persist?.({ folded: trim(folded), unfolded: trim(unfolded) });

export const isFolded = (t: Task, byDefault = false): boolean => {
  const id = foldId(t);
  if (folded.has(id)) return true;
  if (unfolded.has(id)) return false;
  return byDefault;
};

export function setFolded(t: Task, fold: boolean): void {
  const id = foldId(t);
  // Both sets are written to, not just one: “I folded this” and “I unfolded this” are different from
  // “I have never said”, and only the third follows the setting.
  folded.delete(id);
  unfolded.delete(id);
  (fold ? folded : unfolded).add(id);
  remember();
}

export const toggleFold = (t: Task, byDefault = false): boolean => {
  const next = !isFolded(t, byDefault);
  setFolded(t, next);
  return next;
};

/** Fold or unfold a whole run of tasks at once — what alt-click does. */
export function foldAll(tasks: Task[], fold: boolean): void {
  for (const t of tasks) {
    const id = foldId(t);
    folded.delete(id);
    unfolded.delete(id);
    (fold ? folded : unfolded).add(id);
  }
  remember();
}

/** Only for tests — the choices outlive a render on purpose. */
export const clearFolds = (): void => { folded.clear(); unfolded.clear(); persist = undefined; };
