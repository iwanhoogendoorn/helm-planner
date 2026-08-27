/**
 * The habit board: one coloured card per habit — today's tick(s) on the left,
 * name, streak and 30-day rate in the middle, the current week as seven cells
 * and a 30-day ring on the right. Week cells are clickable to fix a past day.
 */
import { setIcon } from 'obsidian';
import type { Habit, HabitPart, IsoDate } from '../core/types';
import { HABIT_PARTS } from '../core/types';
import { habitColor } from '../core/habit';
import { addDays, startOfWeek, WEEKDAY_SHORT } from '../core/dates';
import { dayPartOf, habitOccurrences, habitStats, type HabitDayState, type HabitStats } from '../data/habits';
import { h, icon } from './dom';
import { habitBadge } from './fields';
import { habitMenu } from './habits';
import { drawingsMenu, targetForHabit } from './drawings';
import { notesMenu } from './notes';
import { iconButton } from './dom';
import type { UiContext } from './context';

const PART_ICON: Record<HabitPart, string> = { morning: 'sunrise', afternoon: 'sun', evening: 'moon' };

/** Apply the habit's colour as CSS variables on an element. */
export function colourise(el: HTMLElement, hb: Habit): HTMLElement {
  const c = habitColor(hb);
  el.style.setProperty('--hc', `var(--color-${c})`);
  el.style.setProperty('--hc-rgb', `var(--color-${c}-rgb)`);
  el.setAttribute('data-color', c);
  return el;
}

/** Seven cells for the week that holds `date`. */
export function weekCells(st: HabitStats, date: IsoDate, weekStartsOn: 1 | 7): { date: IsoDate; state: HabitDayState; label: string }[] {
  const ws = startOfWeek(date, weekStartsOn);
  const byDate = new Map(st.days.map((d) => [d.date, d.state]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(ws, i);
    const wd = (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
    return { date: d, state: byDate.get(d) ?? (d > st.days[st.days.length - 1]!.date ? 'future' : 'off'), label: WEEKDAY_SHORT[wd]!.slice(0, 1) };
  });
}

function ring(fraction: number, size = 30): SVGSVGElement {
  const r = size / 2 - 3, c = 2 * Math.PI * r;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${size} ${size}`); svg.setAttribute('width', String(size)); svg.setAttribute('height', String(size)); svg.classList.add('helm-habit-ring');
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  bg.setAttribute('cx', String(size / 2)); bg.setAttribute('cy', String(size / 2)); bg.setAttribute('r', String(r)); bg.setAttribute('class', 'helm-habit-ring-bg');
  const fg = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  fg.setAttribute('cx', String(size / 2)); fg.setAttribute('cy', String(size / 2)); fg.setAttribute('r', String(r)); fg.setAttribute('class', 'helm-habit-ring-fg');
  fg.setAttribute('stroke-dasharray', `${c * Math.max(0, Math.min(1, fraction))} ${c}`); fg.setAttribute('transform', `rotate(-90 ${size / 2} ${size / 2})`);
  const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  t.setAttribute('x', String(size / 2)); t.setAttribute('y', String(size / 2 + 3.5)); t.setAttribute('text-anchor', 'middle'); t.setAttribute('class', 'helm-habit-ring-text'); t.textContent = String(Math.round(fraction * 100));
  svg.append(bg, fg, t);
  return svg;
}

/** Cycle a whole day: everything done → cleared; otherwise everything done. */
async function toggleDay(ctx: UiContext, hb: Habit, date: IsoDate, state: HabitDayState): Promise<void> {
  const next: 'done' | 'missed' = state === 'done' ? 'missed' : 'done';
  for (const part of habitOccurrences(hb)) await ctx.mutations.setHabitState(hb.id, date, next, part);
}

export function habitCard(ctx: UiContext, hb: Habit, date: IsoDate): HTMLElement {
  const snap = ctx.index.snapshot;
  const settings = ctx.settings();
  const today = ctx.today();
  const st = habitStats(hb, snap.completions, today, settings.weekStartsOn, 84);
  const occ = habitOccurrences(hb);
  const movedTo = dayPartOf(hb, snap.completions, date);
  const stateOf = (part?: HabitPart): 'done' | 'skipped' | 'missed' | 'pending' => { const c = snap.completions.find((x) => x.habitId === hb.id && x.date === date && (x.part === part || (part === undefined && movedTo !== undefined && x.part === movedTo))); return c?.state ?? 'pending'; };
  const toggle = (part: HabitPart | undefined, ev: MouseEvent): void => {
    const s = stateOf(part);
    const next = ev.shiftKey ? (s === 'skipped' ? 'missed' : 'skipped') : s === 'done' ? 'missed' : 'done';
    void ctx.run('Habit', () => ctx.mutations.setHabitState(hb.id, date, next, part));
  };
  const ticks = h('div', { cls: 'helm-habit-ticks' }, ...occ.map((part) => {
    const s = stateOf(part);
    return h('button', { cls: ['helm-habit-tick', `is-${s}`, part && 'is-part'], title: `${part ? part.charAt(0).toUpperCase() + part.slice(1) + ': ' : ''}${s}. Click to toggle, shift-click to skip.`, onClick: (ev) => toggle(part, ev) },
      icon(s === 'done' ? 'check' : s === 'skipped' ? 'minus' : part ? PART_ICON[part] : 'circle'));
  }));
  const dayState = st.days.find((d) => d.date === date)?.state ?? 'pending';
  const week = weekCells(st, date, settings.weekStartsOn);
  const strip = h('div', { cls: 'helm-habit-week' }, ...week.map((c) => h('button', {
    cls: ['helm-habit-cell', `is-${c.state}`, c.date === today && 'is-today', c.date === date && 'is-viewing'],
    title: `${c.date}: ${c.state}${c.state === 'future' ? '' : ' — click to toggle the day'}`,
    onClick: () => { if (c.state !== 'future') void ctx.run('Habit', () => toggleDay(ctx, hb, c.date, c.state)); },
  }, h('span', { cls: 'helm-habit-cell-label', text: c.label }))));
  const target = targetForHabit(hb);
  const nNotes = ctx.index.notesFor(target).length, nDraw = ctx.index.drawingsFor(target).length;
  const pills = h('span', { cls: 'helm-habit-attach' },
    nNotes > 0 ? (() => { const b = iconButton('sticky-note', `${nNotes} note${nNotes === 1 ? '' : 's'}`, (ev) => { ev.stopPropagation(); notesMenu(ctx, target, ev); }, 'helm-task-notes'); b.appendChild(h('span', { cls: 'helm-badge', text: String(nNotes) })); return b; })() : null,
    nDraw > 0 ? (() => { const b = iconButton('pen-tool', `${nDraw} drawing${nDraw === 1 ? '' : 's'}`, (ev) => { ev.stopPropagation(); drawingsMenu(ctx, target, ev); }, 'helm-task-drawings'); b.appendChild(h('span', { cls: 'helm-badge', text: String(nDraw) })); return b; })() : null,
  );
  const meta = h('div', { cls: 'helm-habit-meta' },
    st.streak > 0 ? h('span', { cls: 'helm-habit-streak', text: `🔥 ${st.streak}` }) : h('span', { cls: 'helm-hint', text: 'no streak yet' }),
    h('span', { cls: 'helm-hint', text: `${st.doneThisWeek}/${st.scheduledThisWeek} this week` }),
    hb.parts && hb.parts.length ? h('span', { cls: 'helm-hint', text: hb.parts.join(' · ') }) : movedTo ? h('span', { cls: 'helm-chip helm-habit-moved', text: `${movedTo} today`, title: `Moved to the ${movedTo} for this day only` }) : null,
    pills,
  );
  const card = h('div', { cls: ['helm-habit-card', `is-day-${dayState}`, !hb.active && 'is-paused'], onContextMenu: (ev) => habitMenu(ctx, hb, ev, { date, state: dayState === 'done' ? 'done' : dayState === 'skipped' ? 'skipped' : 'pending' }) },
    ticks,
    h('div', { cls: 'helm-habit-body' }, h('div', { cls: 'helm-habit-title' }, habitBadge(ctx, hb), h('span', { text: hb.title })), meta),
    strip,
    h('div', { cls: 'helm-habit-month', title: `${Math.round(st.rate30 * 100)}% of the last 30 days` }, ring(st.rate30)),
  );
  colourise(card, hb);
  // A day-level habit can be dragged onto a part of the day, for this date only.
  if (!(hb.parts && hb.parts.length)) {
    card.setAttribute('draggable', 'true');
    card.addEventListener('dragstart', (ev) => { ev.dataTransfer?.setData('text/helm-habit', hb.id); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; card.classList.add('is-dragging'); });
    card.addEventListener('dragend', () => card.classList.remove('is-dragging'));
    card.title = 'Drag onto Morning, Afternoon or Evening to do it there today only';
  }
  void setIcon; void HABIT_PARTS;
  return card;
}
