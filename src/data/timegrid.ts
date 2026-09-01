/**
 * Laying a day out as a time grid.
 *
 * A task with a time block is a box between two minutes of the day; everything else planned for that
 * day is an all-day item above the grid. Boxes that overlap share the width of the column, so a busy
 * afternoon reads as three narrow boxes side by side rather than three boxes on top of each other.
 */
import type { HelmSettings, IsoDate, Task } from '../core/types';
import { isOpen } from './planner';

export interface GridEvent {
  task: Task;
  /** Minutes from midnight. */
  start: number;
  end: number;
  /** Which of `columns` side-by-side slots this box takes, 0-based. */
  column: number;
  columns: number;
}

export interface DayLayout {
  date: IsoDate;
  timed: GridEvent[];
  allDay: Task[];
}

export const toMinutes = (hhmm: string): number => {
  const [hh, mm] = hhmm.split(':').map(Number);
  return (hh ?? 0) * 60 + (mm ?? 0);
};

export const toHhmm = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/** How long a task's box is: its end time, else its effort, else half an hour. */
export function windowOf(t: Task, settings: HelmSettings): { start: number; end: number } | undefined {
  if (!t.time) return undefined;
  const start = toMinutes(t.time.start);
  const ended = t.time.end ? toMinutes(t.time.end) : undefined;
  const end = ended !== undefined && ended > start ? ended : start + (t.effortMinutes ?? settings.defaultEffortMinutes);
  return { start, end: Math.min(end, 24 * 60) };
}

/**
 * Give every box a column. Boxes are laid out in clusters: a run of events that overlap, directly or
 * through a neighbour. Within a cluster each box takes the first column free at its start time, and
 * every box in the cluster is drawn at the same width, so the columns line up down the day.
 */
export function layOutDay(date: IsoDate, tasks: Task[], settings: HelmSettings): DayLayout {
  const timed: GridEvent[] = [];
  const allDay: Task[] = [];
  for (const t of tasks) {
    const w = windowOf(t, settings);
    if (w) timed.push({ task: t, start: w.start, end: w.end, column: 0, columns: 1 });
    else allDay.push(t);
  }
  timed.sort((a, b) => a.start - b.start || b.end - a.end || a.task.text.localeCompare(b.task.text));

  let cluster: GridEvent[] = [];
  let clusterEnd = -1;
  const closeCluster = (): void => {
    if (cluster.length === 0) return;
    const width = Math.max(...cluster.map((e) => e.column)) + 1;
    for (const e of cluster) e.columns = width;
    cluster = [];
  };
  for (const e of timed) {
    if (e.start >= clusterEnd) { closeCluster(); clusterEnd = e.end; }
    else clusterEnd = Math.max(clusterEnd, e.end);
    // The first column whose last box has finished.
    const busy = new Set(cluster.filter((o) => o.end > e.start).map((o) => o.column));
    let col = 0;
    while (busy.has(col)) col++;
    e.column = col;
    cluster.push(e);
  }
  closeCluster();
  return { date, timed, allDay };
}

/**
 * The hours a grid has to show: the working day from the settings, stretched to cover anything planned
 * outside it, and never less than three hours tall.
 */
export function gridHours(days: DayLayout[], settings: HelmSettings): { from: number; to: number } {
  let from = toMinutes(settings.dayStarts || '08:00');
  let to = toMinutes(settings.dayEnds || '22:00');
  for (const d of days) {
    for (const e of d.timed) {
      from = Math.min(from, e.start);
      to = Math.max(to, e.end);
    }
  }
  from = Math.max(0, Math.floor(from / 60) * 60 - 60);
  to = Math.min(24 * 60, Math.ceil(to / 60) * 60);
  if (to - from < 180) to = Math.min(24 * 60, from + 180);
  return { from, to };
}

/** What a box is coloured by: where the work comes from, and whether it is still open. */
export function toneOf(t: Task): string {
  if (!isOpen(t)) return 'done';
  if (t.id?.startsWith('hab-')) return 'habit';
  if (t.projectId || t.origin === 'project' || t.origin === 'daily-mirror') return 'project';
  if (/#meeting\b/i.test(t.text)) return 'meeting';
  return 'task';
}

/**
 * The time a drop lands on: where the *top of the box* falls on the grid, snapped to the quarter hour.
 *
 * `y` is measured from the top of the column, which is `from`. The grab offset is how far down the box
 * the pointer was when it was picked up — without it, a box grabbed by its middle jumps half an hour up.
 */
export function snapToSlot(y: number, from: number, to: number, opts: { pxPerHour: number; step?: number; length?: number } = { pxPerHour: 56 }): number {
  const step = opts.step ?? 15;
  const minutes = from + (y / opts.pxPerHour) * 60;
  const snapped = Math.round(minutes / step) * step;
  const last = to - (opts.length ?? step);
  return Math.max(from, Math.min(snapped, Math.max(from, last)));
}
