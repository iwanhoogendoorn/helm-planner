/**
 * What a task belongs to: its project (and phase), the task it follows up, the task it is a subtask of,
 * and any project that points at it. One definition, so the calendar grid and the API — and through it
 * the iPhone app — say exactly the same thing.
 */
import type { Task } from '../core/types';
import { plainLabel, shortLabel } from '../core/label';
import type { HelmIndex } from './index';
import { followsOf } from './planner';

export type TaskContextKind = 'project' | 'follows' | 'parent' | 'related';

export interface TaskContextItem {
  kind: TaskContextKind;
  /** Short enough for a calendar block. */
  text: string;
  /** Spelled out, for a tooltip. */
  title: string;
  /** The project's id, or the task's ref (its 🆔, else its key). */
  ref: string;
}

const refOf = (t: Task): string => (t.origin === 'daily-mirror' ? t.key : t.id ?? t.key);

export function taskContext(index: HelmIndex, t: Task): TaskContextItem[] {
  const snap = index.snapshot;
  // A copy mirrored onto a day belongs to whatever its source belongs to.
  const src = t.origin === 'daily-mirror' && t.mirrorOf ? index.task(t.mirrorOf) ?? t : t;
  const out: TaskContextItem[] = [];
  if (src.projectTitle && src.projectId) {
    out.push({ kind: 'project', text: src.projectTitle, title: `Project: ${src.projectTitle}${src.phaseTitle ? ` › ${src.phaseTitle}` : ''}`, ref: src.projectId });
  }
  const follows = followsOf(snap, src);
  if (follows) out.push({ kind: 'follows', text: shortLabel(follows.text, 30), title: `Follow-up of: ${plainLabel(follows.text)}`, ref: refOf(follows) });
  const parent = src.parentKey ? index.task(src.parentKey) : undefined;
  if (parent) out.push({ kind: 'parent', text: shortLabel(parent.text, 30), title: `Subtask of: ${plainLabel(parent.text)}`, ref: refOf(parent) });
  if (src.id) {
    for (const p of snap.projects.values()) {
      if (p.id !== src.projectId && p.relatedTaskIds?.includes(src.id)) out.push({ kind: 'related', text: p.title, title: `Linked from project: ${p.title}`, ref: p.id });
    }
  }
  return out;
}
