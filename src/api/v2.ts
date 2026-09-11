/**
 * The v2 routes: everything the iPhone app needs beyond tasks and projects. Each handler is a thin
 * shell around a planner / stats / report / search / habits function or a Mutations method — the
 * rules live there, not here. `handleV2` answers `undefined` for a path it does not know, and
 * routes.ts turns that into a 404 or 405.
 */
import type { ApiRequest, ApiResponse } from './routes';
import { notAllowed, ok } from './routes';
import type { Ctx } from './json';

/** Heads v2 owns: an unmatched method on one of these is a 405, anything else a 404. */
const HEADS = new Set(['settings']);

export async function handleV2(req: ApiRequest, d: Ctx): Promise<ApiResponse | undefined> {
  const parts = req.path.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  const [head] = parts;
  const method = req.method.toUpperCase();
  const r = await route(parts, method, req, d);
  if (r) return r;
  return head !== undefined && HEADS.has(head) ? notAllowed(method, req.path) : undefined;
}

async function route(parts: string[], method: string, req: ApiRequest, d: Ctx): Promise<ApiResponse | undefined> {
  const [head] = parts;
  void req;
  if (head === 'settings' && method === 'GET' && parts.length === 1) return ok(settingsJson(d));
  return undefined;
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
