/**
 * What the Capture dialog works out from a typed line before it writes: the fields the task line gets,
 * which project `@Name` meant, and where the task will land. Pure, so the dialog and the API agree.
 */
import type { Capture } from '../core/nlp';
import { formatRecurrence } from '../core/recurrence';
import { minutesToHuman } from '../core/dates';
import { partOfTime } from '../core/dailyNote';
import type { HelmSettings, IsoDate, Project, TaskLine } from '../core/types';
import type { DayPart } from './planner';

export interface CaptureDestination {
  kind: 'inbox' | 'day' | 'project' | 'project+day';
  date?: IsoDate;
  part?: DayPart;
  projectId?: string;
  phaseId?: string;
  /** The sentence the dialog shows: “→ daily note for tomorrow”. */
  sentence: string;
}

/** The line's fields from a parse, with the effort and time the dialog may have adjusted by hand. */
export function captureFields(c: Capture, effort?: number, time?: { start: string; end?: string }): Partial<TaskLine> {
  const fields: Partial<TaskLine> = { priority: c.priority };
  if (c.due) fields.due = c.due;
  const eff = effort ?? c.effortMinutes;
  if (eff) { fields.effortMinutes = eff; fields.effortRaw = minutesToHuman(eff); }
  const t = time ?? c.time;
  if (t) fields.time = t;
  if (c.recurrence) fields.recurrence = { ...c.recurrence, raw: formatRecurrence(c.recurrence) };
  return fields;
}

/** Where a capture goes: a project (and the day's plan when dated), a day, or the inbox. */
export function captureDestination(opts: { project?: Project; phaseId?: string; date?: IsoDate; part?: DayPart; time?: { start: string }; settings: Pick<HelmSettings, 'inboxNote' | 'morningEnds' | 'afternoonEnds'>; dateLabel?: (d: IsoDate) => string }): CaptureDestination {
  const { project, phaseId, date, settings } = opts;
  const label = opts.dateLabel ?? ((d) => d);
  const part = opts.part ?? (opts.time && date ? partOfTime(opts.time.start, settings) : undefined);
  const phase = project && phaseId ? project.phases.find((p) => p.id === phaseId) : undefined;
  if (project) {
    return {
      kind: date ? 'project+day' : 'project', projectId: project.id, ...(phaseId ? { phaseId } : {}), ...(date ? { date } : {}), ...(part ? { part } : {}),
      sentence: `→ project “${project.title}”${phase ? ` › ${phase.title}` : ''}${date ? ` (and the plan for ${label(date)})` : ''}`,
    };
  }
  if (date) return { kind: 'day', date, ...(part ? { part } : {}), sentence: `→ daily note for ${label(date)}` };
  return { kind: 'inbox', sentence: `→ inbox (${settings.inboxNote})` };
}
