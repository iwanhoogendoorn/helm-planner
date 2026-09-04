/**
 * Turning a list of work into a day you could actually do.
 *
 * A task becomes one or more **focus blocks** with **breaks** between them. Not everything fits in
 * twenty-five minutes, so the block length bends to the task: a short task gets one short block, a long
 * one is split into as few equal blocks as will hold it, none longer than the maximum you set. Breaks
 * grow after a few blocks, the way a rest does.
 *
 * This is the arithmetic only — no clock, no files. What the AI proposes and what you adjust by hand
 * both end up in this shape.
 */
export interface FocusSettings {
  /** The longest a single stretch of work should be. */
  focusMaxMinutes: number;
  /** The shortest block worth making; a task under this is left whole. */
  focusMinMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  /** How many focus blocks before a long break. */
  blocksBeforeLongBreak: number;
}

export const DEFAULT_FOCUS: FocusSettings = {
  focusMaxMinutes: 50,
  focusMinMinutes: 15,
  breakMinutes: 5,
  longBreakMinutes: 20,
  blocksBeforeLongBreak: 3,
};

export interface PlanBlock {
  /** The task this block is for; a break carries the key of the task it follows. */
  taskKey: string;
  kind: 'focus' | 'break';
  start: string;
  end: string;
  /** 1 of 2, 2 of 2 … for a task split across blocks. */
  index?: number;
  of?: number;
}

const toMin = (hhmm: string): number => { const [h, m] = hhmm.split(':').map(Number); return (h ?? 0) * 60 + (m ?? 0); };
const toHhmm = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(Math.round(m) % 60).padStart(2, '0')}`;

/**
 * How to cut one task's minutes into stretches: as few as possible, none over the maximum, none under
 * the minimum, and all the same length so the day reads evenly.
 */
export function splitFocus(minutes: number, s: FocusSettings): number[] {
  const total = Math.max(1, Math.round(minutes));
  if (total <= s.focusMaxMinutes) return [total];
  const parts = Math.ceil(total / s.focusMaxMinutes);
  const each = Math.round(total / parts / 5) * 5;                      // to the nearest five minutes
  const blocks = Array.from({ length: parts }, () => each);
  blocks[blocks.length - 1] = total - each * (parts - 1);              // the last one takes the remainder
  return blocks.filter((b) => b > 0);
}

export interface LayOutOptions extends FocusSettings {
  /** Where the working day starts and ends, `HH:MM`. */
  from: string;
  to: string;
  /** Times already taken — meetings and anything else fixed. */
  busy?: { start: string; end: string }[];
}

export interface LaidOut {
  blocks: PlanBlock[];
  /** Tasks that did not fit in the day, in the order they were given. */
  overflow: { key: string; minutes: number }[];
  /** Minutes of focus that fitted, and minutes of break. */
  focusMinutes: number;
  breakMinutes: number;
}

/**
 * Lay work out through the day: each task's blocks in turn, a break after each block, skipping whatever
 * is already booked. What does not fit before the day ends comes back as overflow rather than being
 * squeezed in — the point of the exercise is a day you can actually do.
 */
export function layOutDayPlan(tasks: { key: string; minutes: number }[], opts: LayOutOptions): LaidOut {
  const busy = [...(opts.busy ?? [])].map((b) => ({ start: toMin(b.start), end: toMin(b.end) })).sort((a, b) => a.start - b.start);
  const dayEnd = toMin(opts.to);
  let at = toMin(opts.from);
  const out: LaidOut = { blocks: [], overflow: [], focusMinutes: 0, breakMinutes: 0 };
  let sinceLongBreak = 0;

  /** The first minute from `t` where `length` minutes are free. */
  const free = (t: number, length: number): number | undefined => {
    let start = t;
    for (let guard = 0; guard < 200; guard++) {
      const clash = busy.find((b) => start < b.end && start + length > b.start);
      if (!clash) return start + length <= dayEnd ? start : undefined;
      start = clash.end;
    }
    return undefined;
  };

  for (const task of tasks) {
    const parts = splitFocus(task.minutes, opts);
    const placed: PlanBlock[] = [];
    let fits = true;
    let cursor = at;
    for (const [i, length] of parts.entries()) {
      const start = free(cursor, length);
      if (start === undefined) { fits = false; break; }
      placed.push({ taskKey: task.key, kind: 'focus', start: toHhmm(start), end: toHhmm(start + length), index: i + 1, of: parts.length });
      cursor = start + length;
      // A break after every stretch but the last of the day's work; longer after a few in a row.
      sinceLongBreak++;
      const rest = sinceLongBreak >= opts.blocksBeforeLongBreak ? opts.longBreakMinutes : opts.breakMinutes;
      if (sinceLongBreak >= opts.blocksBeforeLongBreak) sinceLongBreak = 0;
      const bStart = free(cursor, rest);
      if (bStart !== undefined) { placed.push({ taskKey: task.key, kind: 'break', start: toHhmm(bStart), end: toHhmm(bStart + rest) }); cursor = bStart + rest; }
    }
    if (!fits) { out.overflow.push(task); continue; }
    out.blocks.push(...placed);
    at = cursor;
  }
  for (const b of out.blocks) {
    const len = toMin(b.end) - toMin(b.start);
    if (b.kind === 'focus') out.focusMinutes += len; else out.breakMinutes += len;
  }
  return out;
}
