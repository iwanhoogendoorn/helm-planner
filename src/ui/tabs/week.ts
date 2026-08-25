/** Seven columns; drag a task onto a day to plan it. */
import type { IsoDate, Task } from '../../core/types';
import { addDays, humanDate, isoWeek, isoWeekday, minutesToHuman, WEEKDAY_SHORT } from '../../core/dates';
import { weekView } from '../../data/planner';
import { button, chip, h, iconButton, section } from '../dom';
import type { UiContext } from '../context';
import { taskRow } from '../taskRow';
import { openPlanDay } from '../modals/planDay';
import { openCapture } from '../modals/capture';

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
      h('div', { cls: 'helm-week-day-body' },
        ...d.open.map((t) => taskRow(ctx, t, { draggable: true, showDate: 'due', showProject: true })),
        d.done.length > 0 ? h('div', { cls: 'helm-week-done', text: `${d.done.length} done` }) : null,
        d.open.length === 0 && d.done.length === 0 ? h('div', { cls: 'helm-week-empty', text: isPast ? '' : 'drop tasks here' }) : null,
      ),
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
