/** Time conflicts: what is already booked on a day at a given time. */
import type { HelmSettings, IsoDate, Snapshot, Task } from '../core/types';
import type { DayPart } from '../core/dailyNote';
import { dayPlan } from './planner';

export interface Booking { key: string; label: string; start: string; end: string; task: Task }

const toMin = (hhmm: string): number => { const [hh, mm] = hhmm.split(':').map(Number); return (hh ?? 0) * 60 + (mm ?? 0); };
const toHhmm = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Everything timed on a day: Helm tasks, mirrored project tasks and the user's own planner slots (only those with text). */
export function bookingsOn(snap: Snapshot, date: IsoDate, settings: HelmSettings): Booking[] {
  const plan = dayPlan(snap, date, settings);
  const seen = new Set<string>();
  const out: Booking[] = [];
  const add = (t: Task): void => {
    if (!t.time || seen.has(t.key) || t.text.trim() === '' || t.status === 'cancelled' || t.status === 'forwarded') return;
    seen.add(t.key);
    const start = toMin(t.time.start);
    const ended = t.time.end ? toMin(t.time.end) : undefined;
    const end = ended !== undefined && ended > start ? ended : start + (t.effortMinutes ?? settings.defaultEffortMinutes);
    out.push({ key: t.key, label: t.text, start: t.time.start, end: toHhmm(end), task: t });
  };
  for (const it of plan.items) add(it.display.time ? it.display : it.task);
  for (const t of plan.timeBlocks) add(t);
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

/** Bookings that overlap [start, end) — end from the effort when not given. Excludes the task being edited. */
export function conflictsFor(snap: Snapshot, date: IsoDate, time: { start: string; end?: string }, settings: HelmSettings, opts: { effortMinutes?: number; excludeKeys?: string[] } = {}): Booking[] {
  const s = toMin(time.start);
  const e = time.end ? toMin(time.end) : s + (opts.effortMinutes ?? settings.defaultEffortMinutes);
  const skip = new Set(opts.excludeKeys ?? []);
  return bookingsOn(snap, date, settings).filter((b) => !skip.has(b.key) && !skip.has(b.task.mirrorOf ?? '') && toMin(b.start) < e && toMin(b.end) > s);
}

export function describeConflicts(cs: Booking[]): string {
  return cs.map((c) => `${c.start}–${c.end} ${c.label.length > 40 ? c.label.slice(0, 39) + '…' : c.label}`).join(' · ');
}

/** The clock window a part of the day covers; `anytime` (or nothing) is the whole working day. */
export function partWindow(part: DayPart | undefined, settings: HelmSettings): { from: string; to: string } {
  const dayStarts = settings.dayStarts || '08:00';
  const dayEnds = settings.dayEnds || '22:00';
  if (part === 'morning') return { from: dayStarts, to: settings.morningEnds };
  if (part === 'afternoon') return { from: settings.morningEnds, to: settings.afternoonEnds };
  if (part === 'evening') return { from: settings.afternoonEnds, to: dayEnds };
  return { from: dayStarts, to: dayEnds };
}

/**
 * The first free start time on a day: inside the part's window (or the whole day), long enough for
 * `effortMinutes`, after everything already booked and never in the past when the day is today.
 * Undefined when the window is full.
 */
export function freeSlotOn(snap: Snapshot, date: IsoDate, settings: HelmSettings, opts: { part?: DayPart; effortMinutes?: number; notBefore?: string; excludeKeys?: string[] } = {}): string | undefined {
  const win = partWindow(opts.part, settings);
  const need = opts.effortMinutes ?? settings.defaultEffortMinutes;
  const skip = new Set(opts.excludeKeys ?? []);
  const booked = bookingsOn(snap, date, settings).filter((b) => !skip.has(b.key) && !skip.has(b.task.mirrorOf ?? ''));
  const end = toMin(win.to);
  let at = Math.max(toMin(win.from), opts.notBefore ? toMin(opts.notBefore) : 0);
  at = Math.ceil(at / 5) * 5;
  for (let guard = 0; guard < 300; guard++) {
    const clash = booked.find((b) => toMin(b.start) < at + need && toMin(b.end) > at);
    if (!clash) return at + need <= end ? toHhmm(at) : undefined;
    at = Math.ceil(toMin(clash.end) / 5) * 5;
    if (at + need > end) return undefined;
  }
  return undefined;
}

/**
 * The slot to offer for a part of the day: the first free one after `notBefore`, else the first free
 * one at all (a part that has already passed is still a deliberate choice), else the part's start.
 */
export function preferredSlot(snap: Snapshot, date: IsoDate, settings: HelmSettings, opts: { part?: DayPart; effortMinutes?: number; notBefore?: string; excludeKeys?: string[] } = {}): string {
  const { notBefore, ...rest } = opts;
  return (notBefore ? freeSlotOn(snap, date, settings, { ...rest, notBefore }) : undefined)
    ?? freeSlotOn(snap, date, settings, rest)
    ?? partWindow(opts.part, settings).from;
}
