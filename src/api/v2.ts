/**
 * The v2 routes: everything the iPhone app needs beyond tasks and projects. Each handler is a thin
 * shell around a planner / stats / report / search / habits function or a Mutations method — the
 * rules live there, not here. `handleV2` answers `undefined` for a path it does not know, and
 * routes.ts turns that into a 404 or 405.
 */
import type { ApiRequest, ApiResponse } from './routes';
import { asRecord, bad, day, findTask, has, made, missing, notAllowed, num, ok, PARTS, str } from './routes';
import { candidateJson, dayItemJson, daybookJson, layoutJson, taskJson, type Ctx } from './json';
import { addDays, isIsoDate } from '../core/dates';
import type { DayPart } from '../core/dailyNote';
import type { IsoDate, Task } from '../core/types';
import { candidates, dayPlan, wrapUpItems } from '../data/planner';
import { habitsOnDay, habitStats } from '../data/habits';
import { layOutDay } from '../data/timegrid';
import { layOutDayPlan } from '../core/pomodoro';
import { bookingsOn } from '../data/conflicts';

/** Heads v2 owns: an unmatched method on one of these is a 405, anything else a 404. */
const HEADS = new Set(['settings', 'day', 'focus']);

export async function handleV2(req: ApiRequest, d: Ctx): Promise<ApiResponse | undefined> {
  const parts = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [head] = parts;
  const method = req.method.toUpperCase();
  const r = await route(parts, method, req, d);
  if (r) return r;
  return head !== undefined && HEADS.has(head) ? notAllowed(method, req.path) : undefined;
}

async function route(parts: string[], method: string, req: ApiRequest, d: Ctx): Promise<ApiResponse | undefined> {
  const [head, ref, sub, sub2, sub3] = parts;
  const body = asRecord(req.body);
  if (head === 'settings' && method === 'GET' && parts.length === 1) return ok(settingsJson(d));

  if (head === 'day' && ref !== undefined) {
    if (!isIsoDate(ref)) return bad('The day must be a date like 2026-09-11');
    const date = ref;
    if (sub === undefined && method === 'GET') return ok(dayJson(date, d));
    if (sub === 'note' && method === 'POST') { const path = await d.mutations.ensureDailyNote(date); return ok({ path, written: d.written() }); }
    if (sub === 'habits' && method === 'POST') { const added = await d.mutations.syncHabitsForDay(date); return ok({ added, written: d.written() }); }
    if (sub === 'candidates' && method === 'GET') {
      const plan = dayPlan(d.index.snapshot, date, d.settings());
      const list = candidates(d.index.snapshot, date, d.settings(), d.today());
      return ok({ date, capacityMinutes: d.settings().dailyCapacityMinutes, plannedMinutes: plan.plannedMinutes, candidates: list.map((x) => candidateJson(x, d)) });
    }
    if (sub === 'plan' && method === 'POST') return planDay(date, body, d);
    if (sub === 'wrapup' && method === 'GET') {
      const plan = dayPlan(d.index.snapshot, date, d.settings());
      const items = wrapUpItems(d.index.snapshot, plan);
      return ok({
        date, open: items.open.map((it) => dayItemJson(it, d)),
        suggestedDate: addDays(date, 1), rolloverTarget: d.settings().rolloverTarget,
        projectsTouched: items.projectsTouched.map((id) => ({ id, title: d.index.project(id)?.title ?? id })),
        doneCount: plan.doneCount, doneMinutes: plan.doneMinutes,
      });
    }
    if (sub === 'wrapup' && method === 'POST') return wrapUp(date, body, d);
    if (sub === 'rollover' && method === 'POST') {
      if (has(body, 'to') && body['to'] !== null && !day(body['to'])) return bad('to must be a date like 2026-09-12, or null to unschedule');
      const to = has(body, 'to') ? day(body['to']) : addDays(date, 1);
      const r = await d.mutations.rollover(date, to);
      return ok({ ...r, written: d.written() });
    }
    if (sub === 'daybook') return daybook(date, sub2, sub3, method, body, d);
  }

  if (head === 'focus' && ref === 'layout' && method === 'POST') return focusLayout(body, d);
  return undefined;
}

/* ── Day ───────────────────────────────────────────────────────────────── */

export function dayJson(date: IsoDate, d: Ctx): Record<string, unknown> {
  const snap = d.index.snapshot;
  const settings = d.settings();
  const plan = dayPlan(snap, date, settings);
  const seen = new Set<string>();
  const shown: Task[] = [];
  for (const it of plan.items) { const t = it.display; if (!seen.has(t.key)) { seen.add(t.key); shown.push(t); } }
  const habits = habitsOnDay(d.index.allHabits(), snap.completions, date).map((row) => {
    const st = habitStats(row.habit, snap.completions, d.today(), settings.weekStartsOn, 14);
    const h = row.habit;
    return { id: h.id, title: h.title, icon: h.icon ?? null, iconImage: h.iconImage ?? null, color: h.color ?? null, parts: h.parts ?? [], dueToday: row.due, occurrences: row.occurrences.map((o) => ({ part: o.part ?? null, state: o.state, line: o.line ?? null })), streak: st.streak };
  });
  const heading = d.index.daybookHeadingLine(date);
  return {
    date,
    notePath: snap.dailyNotes.get(date)?.path ?? null,
    isToday: date === d.today(),
    byPart: { morning: plan.byPart.morning.map((it) => dayItemJson(it, d)), afternoon: plan.byPart.afternoon.map((it) => dayItemJson(it, d)), evening: plan.byPart.evening.map((it) => dayItemJson(it, d)), anytime: plan.byPart.anytime.map((it) => dayItemJson(it, d)) },
    timeBlocks: plan.timeBlocks.map((t) => taskJson(t, d)),
    done: plan.done.map((t) => taskJson(t, d)),
    openCount: plan.openCount, doneCount: plan.doneCount, plannedMinutes: plan.plannedMinutes, doneMinutes: plan.doneMinutes, capacityMinutes: settings.dailyCapacityMinutes,
    habits,
    daybook: { heading: heading ?? null, entries: daybookJson(d.index.daybook(date)) },
    timeline: layoutJson(layOutDay(date, shown, settings), d),
  };
}

/** The Plan-day modal's confirm button: plan the picked items (the daily note and its habits come first), then unschedule the removed ones. */
async function planDay(date: IsoDate, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const rawItems = Array.isArray(body['items']) ? body['items'] as unknown[] : [];
  const items: { key: string; part?: DayPart }[] = [];
  for (const raw of rawItems) {
    const it = asRecord(raw);
    const ref = str(it['ref']) ?? str(it['id']) ?? str(it['key']);
    if (!ref) return bad('Every item needs a ref');
    const t = findTask(ref, d);
    if (!t) return missing(`No task ${ref}`);
    const part = str(it['part']);
    if (part && !PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
    items.push({ key: t.key, ...(part ? { part: part as DayPart } : {}) });
  }
  const removeRefs = Array.isArray(body['remove']) ? (body['remove'] as unknown[]).map((x) => (typeof x === 'string' ? x : '')).filter(Boolean) : [];
  const remove: Task[] = [];
  for (const ref of removeRefs) { const t = findTask(ref, d); if (!t) return missing(`No task ${ref}`); remove.push(t); }
  if (items.length === 0 && remove.length === 0 && body['habits'] !== true) return bad('Nothing to plan: send items, remove, or habits: true');
  // planDay ensures the note and syncs the day's habits itself; with nothing to add, `habits: true` still does that.
  if (items.length > 0 || body['habits'] === true) await d.mutations.planDay(date, items);
  for (const t of remove) await d.mutations.schedule(t.key, undefined);
  return ok({ planned: items.length, removed: remove.length, written: d.written() });
}

const FATES = ['tomorrow', 'date', 'unschedule', 'done', 'cancelled', 'keep'] as const;

/** The Wrap-up modal's Apply button, decision by decision; one failing item does not stop the rest. */
async function wrapUp(date: IsoDate, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const decisions = Array.isArray(body['decisions']) ? body['decisions'] as unknown[] : [];
  const logs = Array.isArray(body['log']) ? body['log'] as unknown[] : [];
  if (decisions.length === 0 && logs.length === 0) return bad('Send decisions and/or log entries');
  // Validate everything first so a bad body changes nothing.
  const todo: { ref: string; fate: typeof FATES[number]; when?: IsoDate; part?: DayPart }[] = [];
  for (const raw of decisions) {
    const dec = asRecord(raw);
    const ref = str(dec['ref']);
    const fate = str(dec['fate']);
    if (!ref) return bad('Every decision needs a ref');
    if (!fate || !FATES.includes(fate as typeof FATES[number])) return bad(`fate must be one of ${FATES.join(', ')}`);
    const when = fate === 'date' ? day(dec['date']) : fate === 'tomorrow' ? addDays(date, 1) : undefined;
    if (fate === 'date' && !when) return bad('A "date" fate needs a date like 2026-09-15');
    const part = str(dec['part']);
    if (part && !PARTS.includes(part as DayPart)) return bad(`part must be one of ${PARTS.join(', ')}`);
    todo.push({ ref, fate: fate as typeof FATES[number], ...(when ? { when } : {}), ...(part ? { part: part as DayPart } : {}) });
  }
  const entries: { projectId: string; text: string }[] = [];
  for (const raw of logs) {
    const e = asRecord(raw);
    const projectId = str(e['projectId']);
    const text = str(e['text']);
    if (!projectId || !text) return bad('Every log entry needs a projectId and text');
    if (!d.index.project(projectId)) return missing(`No project ${projectId}`);
    entries.push({ projectId, text });
  }
  const today = d.today();
  let applied = 0;
  const failed: { ref: string; error: string }[] = [];
  for (const x of todo) {
    try {
      const t = findTask(x.ref, d);
      if (!t) throw new Error(`No task ${x.ref}`);
      switch (x.fate) {
        case 'tomorrow':
        case 'date': {
          // A mirror on a day that has passed keeps a forwarded record, as the modal leaves one.
          if (t.origin === 'daily-mirror' && date < today) await d.mutations.setStatus(t.key, 'forwarded').catch(() => undefined);
          await d.mutations.schedule(t.key, x.when, x.part);
          break;
        }
        case 'unschedule': await d.mutations.schedule(t.key, undefined); break;
        case 'done': await d.mutations.setStatus(t.key, 'done'); break;
        case 'cancelled': await d.mutations.setStatus(t.key, 'cancelled'); break;
        case 'keep': break;
      }
      applied++;
    } catch (e) {
      failed.push({ ref: x.ref, error: e instanceof Error ? e.message : String(e) });
    }
  }
  for (const e of entries) {
    try { await d.mutations.appendLog(e.projectId, e.text); } catch (err) { failed.push({ ref: e.projectId, error: err instanceof Error ? err.message : String(err) }); }
  }
  return ok({ applied, logged: entries.length - failed.filter((f) => entries.some((e) => e.projectId === f.ref)).length, failed, written: d.written() });
}

async function daybook(date: IsoDate, lineRef: string | undefined, tail: string | undefined, method: string, body: Record<string, unknown>, d: Ctx): Promise<ApiResponse | undefined> {
  if (lineRef === undefined) {
    if (method === 'GET') return ok({ date, heading: d.index.daybookHeadingLine(date) ?? null, entries: daybookJson(d.index.daybook(date)) });
    if (method === 'POST') {
      const text = str(body['text']);
      if (!text) return bad('An entry needs text');
      const time = str(body['time']);
      if (time && !/^\d{2}:\d{2}$/.test(time)) return bad('time must be HH:MM');
      await d.mutations.addDaybookEntry(date, text, { ...(time ? { time } : {}), ...(str(body['icon']) ? { icon: str(body['icon'])! } : {}) });
      return made({ date, entries: daybookJson(d.index.daybook(date)), written: d.written() });
    }
    return undefined;
  }
  const line = Number(lineRef);
  if (!Number.isInteger(line) || line < 0) return bad('The entry is addressed by its line number');
  const entry = d.index.daybook(date).find((e) => e.line === line);
  if (!entry) return missing(`No daybook entry at line ${line} on ${date}`);
  if (tail === undefined && (method === 'PATCH' || method === 'PUT')) {
    const text = str(body['text']);
    if (!text) return bad('An entry needs text');
    await d.mutations.updateDaybookEntry(date, line, text);
    return ok({ date, entries: daybookJson(d.index.daybook(date)), written: d.written() });
  }
  if (tail === undefined && method === 'DELETE') {
    await d.mutations.removeDaybookEntry(date, line);
    return ok({ date, removed: line, entries: daybookJson(d.index.daybook(date)), written: d.written() });
  }
  if (tail === 'replies' && method === 'POST') {
    const text = str(body['text']);
    if (!text) return bad('A reply needs text');
    await d.mutations.addDaybookReply(date, line, text, str(body['icon']));
    return made({ date, entries: daybookJson(d.index.daybook(date)), written: d.written() });
  }
  return undefined;
}

/** The Plan-day "lay out the day" helper: focus blocks and breaks from a start time, around what is already booked. */
async function focusLayout(body: Record<string, unknown>, d: Ctx): Promise<ApiResponse> {
  const s = d.settings();
  const start = str(body['start']) ?? (s.dayStarts || '09:00');
  if (!/^\d{2}:\d{2}$/.test(start)) return bad('start must be HH:MM');
  const end = str(body['end']) ?? (s.dayEnds || '18:00');
  if (!/^\d{2}:\d{2}$/.test(end)) return bad('end must be HH:MM');
  const rawTasks = Array.isArray(body['tasks']) ? body['tasks'] as unknown[] : [];
  if (rawTasks.length === 0) return bad('tasks must be a list of { ref, minutes }');
  const tasks: { key: string; minutes: number }[] = [];
  for (const raw of rawTasks) {
    const it = asRecord(raw);
    const ref = str(it['ref']) ?? str(it['key']);
    if (!ref) return bad('Every task needs a ref');
    const t = findTask(ref, d);
    const minutes = num(it['minutes']) ?? t?.effortMinutes ?? s.defaultEffortMinutes;
    tasks.push({ key: t ? (t.id ?? t.key) : ref, minutes });
  }
  const date = day(body['date']);
  if (has(body, 'date') && !date) return bad('date must be a date like 2026-09-11');
  const busy = date ? bookingsOn(d.index.snapshot, date, s).filter((b) => !tasks.some((t) => t.key === b.key || t.key === b.task.id)).map((b) => ({ start: b.start, end: b.end })) : [];
  const laid = layOutDayPlan(tasks, { focusMaxMinutes: s.focusMaxMinutes, focusMinMinutes: s.focusMinMinutes, breakMinutes: s.breakMinutes, longBreakMinutes: s.longBreakMinutes, blocksBeforeLongBreak: s.blocksBeforeLongBreak, from: start, to: end, busy });
  return ok({ from: start, to: end, busy, ...laid });
}

/** The client-relevant subset of the settings: what a phone needs to draw a day and size its captures. */
export function settingsJson(d: Ctx): Record<string, unknown> {
  const s = d.settings();
  return {
    dayStarts: s.dayStarts, dayEnds: s.dayEnds, morningEnds: s.morningEnds, afternoonEnds: s.afternoonEnds,
    dailyCapacityMinutes: s.dailyCapacityMinutes, defaultEffortMinutes: s.defaultEffortMinutes, weekStartsOn: s.weekStartsOn,
    captureTags: s.captureTags.split(',').map((x) => x.trim().replace(/^#/, '')).filter(Boolean),
    followupTag: s.followupTag, staleProjectDays: s.staleProjectDays, rolloverTarget: s.rolloverTarget, showTimeBlocks: s.showTimeBlocks,
    focus: { focusMaxMinutes: s.focusMaxMinutes, focusMinMinutes: s.focusMinMinutes, breakMinutes: s.breakMinutes, longBreakMinutes: s.longBreakMinutes, blocksBeforeLongBreak: s.blocksBeforeLongBreak },
    daybookHeading: s.daybookHeading, projectsFolder: s.projectsFolder, habitsFolder: s.habitsFolder, inboxNote: s.inboxNote, goalsHeading: s.goalsHeading,
    defaultCaptureTime: s.defaultCaptureTime, foldStepsByDefault: s.foldStepsByDefault, defaultTab: s.defaultTab,
    dailyNoteFolder: d.index.dailyFolder(), dailyNoteFormat: d.index.dailyFormat(),
  };
}
