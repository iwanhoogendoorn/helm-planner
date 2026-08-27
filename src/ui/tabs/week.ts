/** Seven columns; drag a task onto a day to plan it. */
import type { IsoDate, Task } from '../../core/types';
import { addDays, humanDate, isoWeek, isoWeekday, minutesToHuman, WEEKDAY_SHORT } from '../../core/dates';
import { weekView, type DayPart, DAY_PARTS } from '../../data/planner';
import { PART_LABEL } from '../../core/dailyNote';
import { button, chip, h, icon, iconButton, section } from '../dom';
import type { UiContext } from '../context';
import { wikilinkSuggest } from '../fields';
import { taskRow } from '../taskRow';
import { openPlanDay } from '../modals/planDay';
import { openCapture } from '../modals/capture';
import { periodOf } from '../../core/periods';
import { goalProgress } from '../../data/planner';
import { progressBar, richText } from '../dom';

export interface WeekState { anchor: IsoDate; collapsed: Map<string, boolean> }

export function renderWeek(ctx: UiContext, root: HTMLElement, state: WeekState): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const w = weekView(snap, state.anchor, settings, today);
  const wk = isoWeek(w.start);
  const totalOpen = w.days.reduce((s, d) => s + d.open.length, 0);
  const totalDone = w.days.reduce((s, d) => s + d.done.length, 0);

  root.appendChild(h('div', { cls: 'helm-day-head' },
    h('div', { cls: 'helm-day-nav' },
      iconButton('chevron-left', 'Previous week', () => ctx.navigate('week', { date: addDays(w.start, -7) })),
      h('button', { cls: ['helm-day-title', w.start <= today && today <= addDays(w.start, 6) && 'is-today'], onClick: () => ctx.navigate('week', { date: today }) },
        h('span', { cls: 'helm-day-title-main', text: `Week ${wk.week}` }),
        h('span', { cls: 'helm-day-title-sub', text: `${humanDate(w.start)} – ${humanDate(addDays(w.start, 6), undefined, { year: true })}` }),
      ),
      iconButton('chevron-right', 'Next week', () => ctx.navigate('week', { date: addDays(w.start, 7) })),
    ),
    h('div', { cls: 'helm-day-actions' },
      h('span', { cls: 'helm-hint', text: `${totalOpen} open · ${totalDone} done` }),
      button('', { icon: 'plus', title: 'Capture', onClick: () => openCapture(ctx) }),
    ),
  ));

  // This week's goals, from the weekly note.
  const wp = periodOf(w.start, 'week');
  const goals = ctx.index.allGoals().filter((g) => g.periodKey === wp.key).map((g) => goalProgress(snap, g, today, settings));
  const goalInput = h('input', { cls: 'helm-quickadd-input', attr: { type: 'text', placeholder: `Add a goal for week ${wk.week}…` } });
  wikilinkSuggest(ctx, goalInput);
  goalInput.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && goalInput.value.trim() !== '') { const v = goalInput.value; goalInput.value = ''; void ctx.run('Add goal', () => ctx.mutations.addGoal(wp.key, v)); } });
  root.appendChild(section(`Goals for week ${wk.week}`, { count: goals.length, store: state.collapsed, key: 'goals', actions: [button('Open week note', { icon: 'file-text', onClick: () => void ctx.run('Open', async () => { const p = await ctx.mutations.ensurePeriodicNote(wp); await ctx.openFile(p); }) })] },
    ...goals.map((g) => h('div', { cls: ['helm-goal', g.goal.status === 'done' && 'is-done'] },
      h('button', { cls: ['helm-check', `mark-${g.goal.status}`], onClick: () => void ctx.run('Goal', () => ctx.mutations.setStatus(g.goal.key, g.goal.status === 'done' ? 'todo' : 'done')) }, g.goal.status === 'done' ? icon('check') : null),
      h('div', { cls: 'helm-goal-main' }, h('div', { cls: 'helm-goal-text' }, richText(g.goal.text)), g.projects.length > 0 ? h('div', { cls: 'helm-goal-progress' }, progressBar(g.progress, 'is-thin'), h('span', { cls: 'helm-hint', text: `${g.taskDone}/${g.taskTotal} tasks` })) : null),
    )),
    h('div', { cls: 'helm-quickadd' }, icon('target'), goalInput),
  ));

  const grid = h('div', { cls: 'helm-week' });
  for (const d of w.days) {
    const isToday = d.date === today;
    const isPast = d.date < today;
    const col = h('div', { cls: ['helm-week-day', isToday && 'is-today', isPast && 'is-past'], attr: { 'data-date': d.date } });
    col.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-task')) { ev.preventDefault(); col.classList.add('is-dropping'); } });
    col.addEventListener('dragleave', () => col.classList.remove('is-dropping'));
    col.addEventListener('drop', (ev) => {
      ev.preventDefault();
      col.classList.remove('is-dropping');
      const key = ev.dataTransfer?.getData('text/helm-task');
      if (key) void ctx.run('Schedule', () => ctx.mutations.schedule(key, d.date));
    });
    col.append(
      h('div', { cls: 'helm-week-day-head', onClick: () => ctx.navigate('today', { date: d.date }) },
        h('span', { cls: 'helm-week-dow', text: WEEKDAY_SHORT[isoWeekday(d.date) - 1] ?? '' }),
        h('span', { cls: 'helm-week-dom', text: String(Number(d.date.slice(8, 10))) }),
        h('span', { cls: 'helm-spacer' }),
        d.minutes > 0 ? chip(minutesToHuman(d.minutes), d.minutes > settings.dailyCapacityMinutes ? 'effort is-over' : 'effort') : null,
        iconButton('list-plus', 'Plan this day', (ev) => { ev.stopPropagation(); openPlanDay(ctx, d.date); }),
      ),
      weekDayBody(ctx, d.date, d.open, d.done.length, isPast),
    );
    grid.appendChild(col);
  }
  root.appendChild(grid);

  const side = h('div', { cls: 'helm-week-side' });
  const dragRow = (t: Task): HTMLElement => taskRow(ctx, t, { draggable: true, showDate: 'due' });
  if (w.overdue.length > 0) side.appendChild(section('Overdue', { count: w.overdue.length, store: state.collapsed, key: 'overdue', cls: 'is-attention' }, ...w.overdue.slice(0, 20).map(dragRow)));
  if (w.unscheduledDue.length > 0) side.appendChild(section('Due this week, not planned', { count: w.unscheduledDue.length, store: state.collapsed, key: 'unscheduled' }, ...w.unscheduledDue.map(dragRow)));
  if (side.childElementCount > 0) root.appendChild(side);
  else root.appendChild(h('div', { cls: 'helm-hint helm-week-hint', text: 'Drag a task from any list onto a day. Nothing is overdue and everything due this week is planned.' }));
}

const PART_ICON: Record<DayPart, string> = { morning: 'sunrise', afternoon: 'sun', evening: 'moon', anytime: 'clock' };

/** A day column split into parts; each part is a drop zone for that part of that day. */
function weekDayBody(ctx: UiContext, date: string, open: Task[], doneCount: number, isPast: boolean): HTMLElement {
  const settings = ctx.settings();
  const partOf = (t: Task): DayPart => t.part ?? (t.time ? (t.time.start < settings.morningEnds ? 'morning' : t.time.start < settings.afternoonEnds ? 'afternoon' : 'evening') : 'anytime');
  const groups: Record<DayPart, Task[]> = { morning: [], afternoon: [], evening: [], anytime: [] };
  for (const t of open) groups[partOf(t)].push(t);
  const body = h('div', { cls: 'helm-week-day-body' });
  for (const part of DAY_PARTS) {
    const items = groups[part];
    if (items.length === 0 && (isPast || part === 'anytime')) continue;
    const block = h('div', { cls: ['helm-week-part', `part-${part}`, items.length === 0 && 'is-empty'] },
      h('div', { cls: 'helm-week-part-head' }, icon(PART_ICON[part]), h('span', { text: PART_LABEL[part] }), items.length > 0 ? h('span', { cls: 'helm-count', text: String(items.length) }) : null),
      ...items.map((t) => taskRow(ctx, t, { draggable: true, showDate: 'due', showProject: true })),
    );
    block.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-task')) { ev.preventDefault(); ev.stopPropagation(); block.classList.add('is-dropping'); } });
    block.addEventListener('dragleave', (ev) => { if (!block.contains(ev.relatedTarget as Node | null)) block.classList.remove('is-dropping'); });
    block.addEventListener('drop', (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      block.classList.remove('is-dropping');
      const key = ev.dataTransfer?.getData('text/helm-task');
      if (!key) return;
      const t = ctx.index.task(key);
      const onThisDay = t && (t.noteDate === date || t.scheduled === date);
      void ctx.run('Move', () => (onThisDay ? ctx.mutations.setPart(key, part) : ctx.mutations.schedule(key, date, part)));
    });
    body.appendChild(block);
  }
  if (groups.anytime.length > 0 || (!isPast && open.length === 0)) {
    // (anytime is rendered above when it has items; the column itself accepts drops as "anytime")
  }
  if (doneCount > 0) body.appendChild(h('div', { cls: 'helm-week-done', text: `${doneCount} done` }));
  if (open.length === 0 && doneCount === 0 && isPast) body.appendChild(h('div', { cls: 'helm-week-empty', text: '' }));
  return body;
}
