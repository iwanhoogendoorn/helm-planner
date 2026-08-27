/** The cockpit: one day, split into parts, and the two rituals around it. */
import type { Habit, HabitPart, IsoDate, Task } from '../../core/types';
import { addDays, humanDate, minutesToHuman } from '../../core/dates';
import { candidates, dayPlan, DAY_PARTS, type Candidate, type DayItem, type DayPart } from '../../data/planner';
import { habitDue, habitStats } from '../../data/habits';
import { PART_LABEL } from '../../core/dailyNote';
import { button, chip, empty, h, icon, iconButton, progressBar, section } from '../dom';
import type { UiContext } from '../context';
import { taskRow } from '../taskRow';
import { openPlanDay } from '../modals/planDay';
import { openWrapUp } from '../modals/wrapUp';
import { openCapture } from '../modals/capture';
import { openHabitForm } from '../modals/habitForm';
import { crumbBar, dateCrumbs } from '../crumbs';
import { habitBadge } from '../fields';
import { habitMenu } from '../habits';
import { habitCard, colourise } from '../habitCard';
import { drawingsButton, targetForDate } from '../drawings';
import { notesButton } from '../notes';

export interface TodayState { date: IsoDate; collapsed: Map<string, boolean> }

const PART_ICON: Record<DayPart, string> = { morning: 'sunrise', afternoon: 'sun', evening: 'moon', anytime: 'clock' };

export function renderToday(ctx: UiContext, root: HTMLElement, state: TodayState): void {
  const today = ctx.today();
  let habitChipsFor: (part: HabitPart) => HTMLElement | null = () => null;
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const date = state.date;
  const plan = dayPlan(snap, date, settings);
  const isToday = date === today;
  const isPast = date < today;
  const note = snap.dailyNotes.get(date);

  const cap = settings.dailyCapacityMinutes;
  root.appendChild(crumbBar(ctx, 'today', dateCrumbs(ctx, date, 'day', { day: true }), { homeClick: () => ctx.navigate('today', { date: today }), homeTitle: 'Jump to today' }));
  root.append(h('div', { cls: 'helm-day-head' },
    h('div', { cls: 'helm-day-nav' },
      iconButton('chevron-left', 'Previous day', () => ctx.navigate('today', { date: addDays(date, -1) })),
      h('button', { cls: ['helm-day-title', isToday && 'is-today'], onClick: () => ctx.navigate('today', { date: today }), title: isToday ? date : 'Jump to today' },
        h('span', { cls: 'helm-day-title-main', text: humanDate(date, today) }),
        h('span', { cls: 'helm-day-title-sub', text: humanDate(date, undefined, { year: true }) }),
      ),
      iconButton('chevron-right', 'Next day', () => ctx.navigate('today', { date: addDays(date, 1) })),
    ),
    h('div', { cls: 'helm-day-actions' },
      button('Plan day', { icon: 'list-plus', primary: !isPast && plan.openCount === 0, onClick: () => openPlanDay(ctx, date) }),
      button('Wrap up', { icon: 'moon', onClick: () => openWrapUp(ctx, date) }),
      button('', { icon: 'plus', title: 'Capture into this day', onClick: () => openCapture(ctx, { date }) }),
      notesButton(ctx, targetForDate(date)),
      drawingsButton(ctx, targetForDate(date)),
      button('', { icon: 'file-text', title: note ? 'Open daily note' : 'Create and open daily note', onClick: () => void ctx.run('Open note', async () => { const p = await ctx.mutations.ensureDailyNote(date); await ctx.openFile(p); }) }),
    ),
  ), h('div', { cls: 'helm-capacity' },
    h('div', { cls: 'helm-capacity-label' },
      h('span', { text: `${plan.openCount} open · ${plan.doneCount} done` }),
      h('span', { cls: 'helm-spacer' }),
      h('span', { cls: 'helm-hint', text: `${minutesToHuman(plan.plannedMinutes)} planned / ${minutesToHuman(cap)}` }),
    ),
    progressBar(plan.plannedMinutes / cap, plan.plannedMinutes > cap ? 'is-over' : ''),
  ));
  if (note?.regionBroken) root.appendChild(h('div', { cls: 'helm-banner is-error' }, icon('alert-triangle'), h('span', { text: 'The Helm region in this daily note has no end marker. Fix the note before Helm writes to it.' }), button('Open', { onClick: () => void ctx.openFile(note.path) })));

  const store = state.collapsed;

  // Needs attention: overdue and carried-over items (only when looking at today or the future).
  if (!isPast) {
    const cands = candidates(snap, date, settings, today).filter((c) => c.reason === 'overdue' || c.reason === 'scheduled-past');
    if (cands.length > 0) {
      root.appendChild(section('Needs attention', { count: cands.length, store, key: 'attention', cls: 'is-attention', actions: [button('Plan day', { icon: 'list-plus', onClick: () => openPlanDay(ctx, date) })] },
        ...cands.slice(0, 12).map((c) => taskRow(ctx, c.task, { reason: reasonLabel(c), draggable: true, quickAction: { icon: 'arrow-down-to-line', title: `Pull onto ${humanDate(date, today)}`, onClick: (t) => void ctx.run('Schedule', () => ctx.mutations.schedule(t.key, date)) } })),
        cands.length > 12 ? h('div', { cls: 'helm-hint', text: `… and ${cands.length - 12} more in Plan day.` }) : null,
      ));
    }
  }

  // Habits.
  const habits = ctx.index.allHabits().filter((hb) => habitDue(hb, date) || snap.completions.some((c) => c.habitId === hb.id && c.date === date));
  if (habits.length > 0 || ctx.index.allHabits().length === 0) {
    /** A chip for one occurrence of a habit (day-level, or one part of the day). */
    const habitChip = (hb: Habit, part?: HabitPart): HTMLElement => {
      const done = snap.completions.find((c) => c.habitId === hb.id && c.date === date && c.part === part);
      const st = habitStats(hb, snap.completions, today, settings.weekStartsOn, 14);
      const hstate = done?.state ?? 'pending';
      return h('button', {
        cls: ['helm-habit', `is-${hstate}`],
        title: `${hb.title}${part ? ` (${part})` : ''}: streak ${st.streak} · ${Math.round(st.rate30 * 100)}% last 30 days. Click to toggle, shift-click to skip, right-click to edit or delete.`,
        onClick: (ev) => { const next = ev.shiftKey ? (hstate === 'skipped' ? 'missed' : 'skipped') : hstate === 'done' ? 'missed' : 'done'; void ctx.run('Habit', () => ctx.mutations.setHabitState(hb.id, date, next, part)); },
        onContextMenu: (ev) => habitMenu(ctx, hb, ev, { date, ...(part ? { part } : {}), state: hstate }),
      }, icon(hstate === 'done' ? 'check' : hstate === 'skipped' ? 'minus' : 'circle'), habitBadge(ctx, hb), h('span', { text: hb.title }), st.streak > 1 ? h('span', { cls: 'helm-streak', text: `🔥${st.streak}` }) : null);
    };
    const parted = habits.filter((hb) => hb.parts && hb.parts.length > 0);
    const occurrences = habits.reduce((n, hb) => n + (hb.parts?.length || 1), 0);
    const doneOcc = snap.completions.filter((c) => c.date === date && c.state === 'done' && habits.some((hb) => hb.id === c.habitId && ((hb.parts?.length ?? 0) === 0 ? c.part === undefined : c.part !== undefined && hb.parts!.includes(c.part)))).length;
    const board = h('div', { cls: 'helm-habit-board' }, ...habits.map((hb) => habitCard(ctx, hb, date)));
    habitChipsFor = (part) => { const list = parted.filter((hb) => hb.parts!.includes(part)); return list.length === 0 ? null : h('div', { cls: 'helm-habit-chips helm-part-habits' }, ...list.map((hb) => colourise(habitChip(hb, part), hb))); };
    root.appendChild(section('Habits', { count: `${doneOcc}/${occurrences}`, store, key: 'habits', actions: [button('New habit', { icon: 'plus', cls: 'helm-btn-quiet', onClick: () => openHabitForm(ctx) })] },
      habits.length === 0 ? empty('No habits yet.', button('Create one', { onClick: () => openHabitForm(ctx) })) : board));
  }

  // The day, by part. Each part is a drop zone.
  const openItems = plan.items.filter((it) => it.display.status !== 'done' && it.display.status !== 'cancelled');
  if (openItems.length === 0 && !isPast) {
    root.appendChild(empty('Nothing planned yet.', button('Plan this day', { primary: true, icon: 'list-plus', onClick: () => openPlanDay(ctx, date) })));
  }
  for (const part of DAY_PARTS) {
    const items = plan.byPart[part].filter((it) => it.display.status !== 'done' && it.display.status !== 'cancelled');
    // Finished tasks stay in their part as ghosts, so a part you worked through does not read as an empty morning.
    const doneItems = plan.byPart[part].filter((it) => it.display.status === 'done' || it.display.status === 'cancelled');
    const partHabits = part !== 'anytime' ? habitChipsFor(part) : null;
    if (items.length === 0 && doneItems.length === 0 && !partHabits && (isPast || (openItems.length === 0 && part !== 'anytime'))) continue;
    const minutes = items.reduce((s, it) => s + (it.display.effortMinutes ?? settings.defaultEffortMinutes), 0);
    const sec = section(PART_LABEL[part], {
      count: items.length, store, key: `part:${part}`, cls: `part-${part}`,
      actions: [
        doneItems.length > 0 ? chip(`${doneItems.length} done`, 'done', `${doneItems.length} finished in the ${PART_LABEL[part].toLowerCase()}`) : null,
        minutes > 0 ? chip(minutesToHuman(minutes), 'effort') : null,
        iconButton('plus', `Add a task to the ${PART_LABEL[part].toLowerCase()}`, () => openCapture(ctx, { date, part: part === 'anytime' ? undefined : part })),
      ],
    }, partHabits, ...items.map((it) => itemRow(ctx, it)),
      ...doneItems.map((it) => { const row = taskRow(ctx, it.display, { showDate: 'none' }); row.classList.add('helm-ghost'); return row; }),
      items.length === 0 && doneItems.length === 0 ? h('div', { cls: 'helm-dropzone-hint', text: `drop a task here for the ${PART_LABEL[part].toLowerCase()}` }) : null);
    sec.querySelector('.helm-section-head')?.prepend(icon(PART_ICON[part], 'helm-part-icon'));
    makeDropZone(ctx, sec, date, part);
    root.appendChild(sec);
  }
  if (plan.unmirrored.length > 0 && !isPast) root.appendChild(h('div', { cls: 'helm-hint' }, `${plan.unmirrored.length} planned project task(s) are not in the daily note yet. `, button('Write them', { onClick: () => void ctx.run('Sync', async () => { for (const t of plan.unmirrored) await ctx.mutations.schedule(t.key, date); }) })));

}

function itemRow(ctx: UiContext, it: DayItem): HTMLElement {
  const row = taskRow(ctx, it.display, { showDate: 'due', showChildren: true, draggable: it.kind !== 'timeblock', showProject: true });
  if (it.kind === 'mirror' || it.kind === 'unmirrored' || it.kind === 'elsewhere') {
    const el = row.classList.contains('helm-task') ? row : row.querySelector<HTMLElement>('.helm-task');
    el?.setAttribute('data-day-key', it.task.key);
  }
  return row;
}

/** Dropping a task on a part plans it for this day, in that part. */
function makeDropZone(ctx: UiContext, el: HTMLElement, date: IsoDate, part: DayPart): void {
  el.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-task')) { ev.preventDefault(); el.classList.add('is-dropping'); } });
  el.addEventListener('dragleave', (ev) => { if (!el.contains(ev.relatedTarget as Node | null)) el.classList.remove('is-dropping'); });
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    el.classList.remove('is-dropping');
    const key = ev.dataTransfer?.getData('text/helm-task');
    if (!key) return;
    const t = ctx.index.task(key);
    const onThisDay = t && (t.noteDate === date || t.scheduled === date);
    void ctx.run('Move', () => (onThisDay ? ctx.mutations.setPart(key, part) : ctx.mutations.schedule(key, date, part)));
  });
}

function reasonLabel(c: Candidate): string {
  switch (c.reason) {
    case 'overdue': return 'overdue';
    case 'scheduled-past': return 'carried over';
    case 'due-soon': return 'due soon';
    case 'in-progress': return 'in progress';
    case 'next-action': return 'next action';
    case 'inbox': return 'inbox';
    default: return c.reason;
  }
}

export type { Task };
