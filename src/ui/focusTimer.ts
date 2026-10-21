/**
 * The running clock, on screen.
 *
 * One timer at a time, held here rather than in a view, so it keeps running while you move between
 * tabs. What is left is always worked out from the wall clock — see `core/timer` — so a re-render, a
 * reload of the view or a laptop that went to sleep makes no difference to it.
 */
import type { Task } from '../core/types';
import { clock, isDone, isPaused, pause, remaining, resume, startTimer, type TimerState } from '../core/timer';
import { splitFocus } from '../core/pomodoro';
import { button, h, icon, iconButton } from './dom';
import type { UiContext } from './context';
import { plainLabel } from '../core/label';
import { onDispose } from './lifecycle';

let current: TimerState | undefined;
let announced = false;

export const runningTimer = (): TimerState | undefined => current;

/** Start a stretch of work on a task; a length of `undefined` takes it from the task itself. */
export function startFocus(ctx: UiContext, t: Task, minutes?: number): void {
  const s = ctx.settings();
  const own = t.effortMinutes ?? s.defaultEffortMinutes;
  const length = minutes ?? Math.min(own, splitFocus(own, {
    focusMaxMinutes: s.focusMaxMinutes, focusMinMinutes: s.focusMinMinutes, breakMinutes: s.breakMinutes,
    longBreakMinutes: s.longBreakMinutes, blocksBeforeLongBreak: s.blocksBeforeLongBreak,
  })[0]!);
  current = startTimer(t.key, plainLabel(t.text), length, 'focus', Date.now());
  announced = false;
  ctx.refresh();
}

export function startBreak(ctx: UiContext, long = false): void {
  const s = ctx.settings();
  current = startTimer('', long ? 'Long break' : 'Break', long ? s.longBreakMinutes : s.breakMinutes, 'break', Date.now());
  announced = false;
  ctx.refresh();
}

export function stopTimer(ctx: UiContext): void {
  current = undefined;
  ctx.refresh();
}

/**
 * The bar that shows the running timer. It lives above the day, ticks once a second while something is
 * running, and says what it is counting so a glance is enough.
 */
export function timerBar(ctx: UiContext): HTMLElement | null {
  if (!current) return null;
  const t = current;
  const now = Date.now();
  const left = remaining(t, now);
  const done = isDone(t, now);
  if (done && !announced) {
    announced = true;
    ctx.notify(t.kind === 'focus' ? `${t.label} — time is up.` : 'Break over.');
  }

  const clockEl = h('span', { cls: 'helm-timer-clock', attr: { role: 'timer', 'aria-label': 'Time left' }, text: clock(left) });
  const bar = h('div', { cls: ['helm-timer-bar', `is-${t.kind}`, done && 'is-done'] },
    icon(t.kind === 'focus' ? 'timer' : 'coffee'),
    clockEl,
    h('span', { cls: 'helm-timer-label', text: done ? `${t.label} — time is up` : t.label }),
    h('span', { cls: 'helm-spacer' }),
    done
      ? h('span', { cls: 'helm-row' },
          t.kind === 'focus' ? button('Take a break', { icon: 'coffee', onClick: () => startBreak(ctx) }) : null,
          t.kind === 'focus' && ctx.index.task(t.taskKey)
            ? button('Another stretch', { icon: 'rotate-cw', onClick: () => { const task = ctx.index.task(t.taskKey); if (task) startFocus(ctx, task, Math.round(t.totalSeconds / 60)); } })
            : null,
          button('Done', { primary: true, icon: 'check', onClick: () => stopTimer(ctx) }),
        )
      : h('span', { cls: 'helm-row' },
          iconButton(isPaused(t) ? 'play' : 'pause', isPaused(t) ? 'Carry on' : 'Hold it there', () => { current = isPaused(t) ? resume(t, Date.now()) : pause(t, Date.now()); ctx.refresh(); }),
          iconButton('square', 'Stop', () => stopTimer(ctx)),
        ),
  );

  // One tick a second while it runs; nothing while it is paused or finished. Each bar ticks its own clock
  // (a popout window or a second Helm leaf has its own), and the tick belongs to the render that drew
  // the bar: the view stops it before it redraws and when it closes. A bar that has left the document
  // without that (drawn outside a view) stops itself on its next tick.
  if (!done && !isPaused(t)) {
    const ticking = window.setInterval(() => {
      if (!clockEl.isConnected || !current) { window.clearInterval(ticking); return; }
      const secs = remaining(current, Date.now());
      clockEl.setText(clock(secs));
      if (secs === 0) ctx.refresh();          // finished: redraw for the “what next” buttons
    }, 1000);
    onDispose(() => window.clearInterval(ticking));
  }
  return bar;
}
