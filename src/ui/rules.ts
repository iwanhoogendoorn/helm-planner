/**
 * Small rules the views share, with no DOM in them, so they are written once and tested on their own:
 * how a capture line becomes a task, how a phase title carries its date, which timed tasks run on into
 * a later part of the day, and where a timed task lands when it is dragged to another part.
 */
import type { HelmSettings, IsoDate, Snapshot, Task } from '../core/types';
import type { Capture } from '../core/nlp';
import { minutesToHuman } from '../core/dates';
import { DAY_PARTS, type DayItem, type DayPart, type dayPlan } from '../data/planner';
import { partWindow, preferredSlot } from '../data/conflicts';
import { toHhmm, toMinutes } from '../data/timegrid';
import type { AddTaskSpec } from '../data/mutations';

/** The task a parsed capture line describes; the caller adds where it goes (project, phase). */
export function captureTask(c: Capture): AddTaskSpec {
  return {
    text: c.text,
    ...(c.scheduled ? { date: c.scheduled } : {}),
    fields: { priority: c.priority, ...(c.due ? { due: c.due } : {}), ...(c.effortMinutes ? { effortMinutes: c.effortMinutes, effortRaw: minutesToHuman(c.effortMinutes) } : {}), ...(c.time ? { time: c.time } : {}), ...(c.recurrence ? { recurrence: c.recurrence } : {}) },
  };
}

/** A phase title as typed: `Research 📅 2026-09-30` is the title and its target date. */
export function parsePhaseTitle(v: string): { title: string; due?: IsoDate } {
  const m = /^(.*?)(?:\s*📅\s*(\d{4}-\d{2}-\d{2}))?\s*$/.exec(v.trim())!;
  return { title: m[1]!.trim(), ...(m[2] ? { due: m[2] } : {}) };
}

export interface Spill { item: DayItem; from: DayPart; start: string; end: string }

/**
 * A timed task belongs to the part it starts in, but time does not stop at the boundary: dinner from
 * 17:00 to 19:30 runs on into the evening. Every later part it overlaps gets a ghost of it, so the day
 * reads honestly — an evening with two and a half hours already spoken for is not an empty evening.
 */
export function spillovers(plan: ReturnType<typeof dayPlan>, settings: HelmSettings): Partial<Record<DayPart, Spill[]>> {
  const out: Partial<Record<DayPart, Spill[]>> = {};
  for (const part of DAY_PARTS) {
    if (part === 'anytime') continue;
    for (const it of plan.byPart[part]) {
      const t = it.display;
      if (!t.time || t.status === 'done' || t.status === 'cancelled' || t.status === 'forwarded') continue;
      const start = toMinutes(t.time.start);
      const ended = t.time.end ? toMinutes(t.time.end) : undefined;
      const end = ended !== undefined && ended > start ? ended : start + (t.effortMinutes ?? settings.defaultEffortMinutes);
      for (const later of DAY_PARTS) {
        if (later === 'anytime' || later === part) continue;
        const w = partWindow(later, settings);
        if (toMinutes(w.from) < start || toMinutes(w.from) >= end) continue; // it has to be running when that part opens
        (out[later] ??= []).push({ item: it, from: part, start: t.time.start, end: t.time.end ?? '' });
      }
    }
  }
  return out;
}

/** Where a dragged, timed task should sit in its new part: the first free slot, keeping its length. Undefined when it stays put. */
export function retimeFor(snap: Snapshot, settings: HelmSettings, t: Task, date: IsoDate, part: DayPart, notBefore?: string): { start: string; end?: string } | undefined {
  const length = t.time?.end ? Math.max(5, toMinutes(t.time.end) - toMinutes(t.time.start)) : (t.effortMinutes ?? settings.defaultEffortMinutes);
  const start = preferredSlot(snap, date, settings, { part, effortMinutes: length, excludeKeys: [t.key, ...(t.id ? [t.id] : []), ...(t.mirrorOf ? [t.mirrorOf] : [])], ...(notBefore ? { notBefore } : {}) });
  if (t.time && t.time.start === start) return undefined;
  return { start, ...(t.time?.end ? { end: toHhmm(toMinutes(start) + length) } : {}) };
}
