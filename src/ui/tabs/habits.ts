/** Habits: every habit in one place — today's, the ones resting, the paused ones — and their whole history. */
import type { Habit, IsoDate } from '../../core/types';
import type { PeriodKind } from '../../core/periods';
import { formatRecurrence } from '../../core/recurrence';
import { ghostHabits, habitDue, habitStats } from '../../data/habits';
import { button, empty, h, iconButton, section } from '../dom';
import type { UiContext } from '../context';
import { habitCard } from '../habitCard';
import { openHabitForm } from '../modals/habitForm';
import { habitTracker } from './dashboard';
import { crumbBar } from '../crumbs';

export interface HabitsState { habitScope: PeriodKind; collapsed: Map<string, boolean> }

export function defaultHabitsState(): HabitsState {
  return { habitScope: 'month', collapsed: new Map() };
}

/** Edit, pause / resume and delete on the card itself — the right-click menu holds the rest. */
function cardActions(ctx: UiContext, hb: Habit): HTMLElement[] {
  return [
    iconButton('pencil', 'Edit habit', () => openHabitForm(ctx, hb)),
    iconButton(hb.active ? 'pause' : 'play', hb.active ? 'Pause habit' : 'Resume habit', () => void ctx.run('Habit', () => ctx.mutations.setHabitFields(hb.id, { active: !hb.active }))),
    iconButton('trash', 'Delete habit', () => { if (window.confirm(`Move the habit “${hb.title}” to the trash? Past daily notes keep their ticks.`)) void ctx.run('Delete habit', () => ctx.mutations.deleteHabit(hb.id)); }, 'helm-habit-delete'),
  ];
}

export function renderHabits(ctx: UiContext, root: HTMLElement, state: HabitsState): void {
  const today: IsoDate = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const store = state.collapsed;
  const byTitle = (a: Habit, b: Habit): number => a.title.localeCompare(b.title);
  const all = ctx.index.allHabits().filter((hb) => !hb.removed).sort(byTitle);
  const paused = all.filter((hb) => !hb.active);
  const due = all.filter((hb) => hb.active && habitDue(hb, today));
  const resting = all.filter((hb) => hb.active && !habitDue(hb, today));
  const stats = due.map((hb) => habitStats(hb, snap.completions, today, settings.weekStartsOn, 30));
  const occurrences = stats.reduce((n, st) => n + st.today.length, 0);
  const doneOcc = stats.reduce((n, st) => n + st.today.filter((o) => o.state === 'done').length, 0);
  const bestStreak = all.filter((hb) => hb.active).reduce((m, hb) => Math.max(m, habitStats(hb, snap.completions, today, settings.weekStartsOn, 30).streak), 0);

  root.appendChild(crumbBar(ctx, 'habits', []));
  root.appendChild(h('div', { cls: 'helm-toolbar' },
    h('span', { cls: 'helm-hint', text: 'Click a tick to mark it, shift-click to skip; the week cells fix a past day. Right-click a card for more.' }),
    h('span', { cls: 'helm-spacer' }),
    button('New habit', { icon: 'plus', primary: true, onClick: () => openHabitForm(ctx) })));

  if (all.length === 0) {
    root.appendChild(empty('No habits yet. A habit repeats on a schedule — every day, weekdays, some days of the week — and gets ticked in your daily note.', button('Create your first habit', { icon: 'plus', primary: true, onClick: () => openHabitForm(ctx) })));
  } else {
    const stat = (value: string | number, label: string, cls = ''): HTMLElement => h('div', { cls: ['helm-stat', cls] }, h('div', { cls: 'helm-stat-value', text: String(value) }), h('div', { cls: 'helm-stat-label', text: label }));
    root.appendChild(h('div', { cls: 'helm-stats' },
      stat(`${doneOcc}/${occurrences}`, 'done today', occurrences > 0 && doneOcc === occurrences ? 'is-good' : ''),
      stat(bestStreak > 0 ? `🔥 ${bestStreak}` : '—', 'best running streak'),
      stat(all.length - paused.length, 'active'),
      stat(paused.length, 'paused', paused.length ? 'is-warn' : '')));

    root.appendChild(section('Due today', { count: `${doneOcc}/${occurrences}`, store, key: 'due' },
      due.length === 0 ? h('div', { cls: 'helm-hint', text: 'Nothing due today.' }) : h('div', { cls: 'helm-habit-board' }, ...due.map((hb) => habitCard(ctx, hb, today, { actions: cardActions(ctx, hb) })))));
    if (resting.length > 0) root.appendChild(section('Not due today', { count: resting.length, store, key: 'resting' },
      h('div', { cls: 'helm-habit-board' }, ...resting.map((hb) => withSchedule(habitCard(ctx, hb, today, { actions: cardActions(ctx, hb) }), hb)))));
    if (paused.length > 0) root.appendChild(section('Paused', { count: paused.length, store, key: 'paused' },
      h('div', { cls: 'helm-habit-board' }, ...paused.map((hb) => withSchedule(habitCard(ctx, hb, today, { actions: cardActions(ctx, hb) }), hb)))));
  }

  const tracked = [...all.sort((a, b) => Number(b.active) - Number(a.active) || byTitle(a, b)), ...ghostHabits(snap.habits, snap.completions)];
  if (tracked.length > 0) root.appendChild(habitTracker(ctx, state, tracked, today));
}

/** A habit not on today's board says when it is due. */
function withSchedule(card: HTMLElement, hb: Habit): HTMLElement {
  card.querySelector('.helm-habit-meta')?.appendChild(h('span', { cls: 'helm-hint helm-habit-when', text: formatRecurrence(hb.schedule) }));
  return card;
}
