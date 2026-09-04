/**
 * The running timer, as arithmetic.
 *
 * A timer is a start instant, a length, and whether it is paused — never a countdown variable ticking
 * down somewhere. That way a re-render, a reload or a laptop lid makes no difference: what is left is
 * always worked out from the clock.
 */
export interface TimerState {
  taskKey: string;
  label: string;
  kind: 'focus' | 'break';
  /** Milliseconds since the epoch when this run started. */
  startedAt: number;
  totalSeconds: number;
  /** Seconds already banked before the current pause; undefined while running. */
  pausedAfter?: number;
}

export function startTimer(taskKey: string, label: string, minutes: number, kind: TimerState['kind'], now: number): TimerState {
  return { taskKey, label, kind, startedAt: now, totalSeconds: Math.max(1, Math.round(minutes * 60)) };
}

export const isPaused = (t: TimerState): boolean => t.pausedAfter !== undefined;

/** Seconds counted so far, whether it is running or paused. */
export function elapsed(t: TimerState, now: number): number {
  if (t.pausedAfter !== undefined) return t.pausedAfter;
  return Math.max(0, Math.floor((now - t.startedAt) / 1000));
}

export const remaining = (t: TimerState, now: number): number => Math.max(0, t.totalSeconds - elapsed(t, now));
export const isDone = (t: TimerState, now: number): boolean => remaining(t, now) === 0;

export function pause(t: TimerState, now: number): TimerState {
  return t.pausedAfter !== undefined ? t : { ...t, pausedAfter: elapsed(t, now) };
}

export function resume(t: TimerState, now: number): TimerState {
  if (t.pausedAfter === undefined) return t;
  const { pausedAfter, ...rest } = t;
  return { ...rest, startedAt: now - pausedAfter * 1000 };
}

/** `12:34`, or `1:02:03` once it runs past an hour. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number): string => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${two(m)}:${two(sec)}` : `${m}:${two(sec)}`;
}
