/** The cockpit: one day, everything on it, and the two rituals around it. */
import type { IsoDate, Task } from '../../core/types';
import { addDays, humanDate, minutesToHuman } from '../../core/dates';
import { candidates, dayPlan, type Candidate } from '../../data/planner';
import { habitDue, habitStats } from '../../data/habits';
import { button, chip, empty, h, icon, iconButton, progressBar, section } from '../dom';
import type { UiContext } from '../context';
import { taskRow } from '../taskRow';
import { openPlanDay } from '../modals/planDay';
import { openWrapUp } from '../modals/wrapUp';
import { openCapture } from '../modals/capture';
import { openHabitForm } from '../modals/habitForm';

export interface TodayState { date: IsoDate; collapsed: Map<string, boolean> }

export function renderToday(ctx: UiContext, root: HTMLElement, state: TodayState): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const date = state.date;
  const plan = dayPlan(snap, date, settings);
  const isToday = date === today;
  const isPast = date < today;
  const note = snap.dailyNotes.get(date);

  // Header: date nav + capacity + rituals.
  const cap = settings.dailyCapacityMinutes;
  const head = h('div', { cls: 'helm-day-head' },
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
      button('', { icon: 'file-text', title: note ? 'Open daily note' : 'Create and open daily note', onClick: () => void ctx.run('Open note', async () => { const p = await ctx.mutations.ensureDailyNote(date); await ctx.openFile(p); }) }),
    ),
  );
  const capBar = h('div', { cls: 'helm-capacity' },
    h('div', { cls: 'helm-capacity-label' },
      h('span', { text: `${plan.openCount} open · ${plan.doneCount} done` }),
      h('span', { cls: 'helm-spacer' }),
      h('span', { cls: 'helm-hint', text: `${minutesToHuman(plan.plannedMinutes)} planned / ${minutesToHuman(cap)}` }),
    ),
    progressBar(plan.plannedMinutes / cap, plan.plannedMinutes > cap ? 'is-over' : ''),
  );
  root.append(head, capBar);
  if (note?.regionBroken) root.appendChild(h('div', { cls: 'helm-banner is-error' }, icon('alert-triangle'), h('span', { text: 'The Helm region in this daily note has no end marker. Fix the note before Helm writes to it.' }), button('Open', { onClick: () => void ctx.openFile(note.path) })));

  const store = state.collapsed;

  // Needs attention: overdue and carried-over items (only when looking at today or the future).
  if (!isPast) {
    const cands = candidates(snap, date, settings, today).filter((c) => c.reason === 'overdue' || c.reason === 'scheduled-past');
    if (cands.length > 0) {
      root.appendChild(section('Needs attention', { count: cands.length, store, key: 'attention', cls: 'is-attention', actions: [button('Plan day', { icon: 'list-plus', onClick: () => openPlanDay(ctx, date) })] },
        ...cands.slice(0, 12).map((c) => taskRow(ctx, c.task, { reason: reasonLabel(c), quickAction: { icon: 'arrow-down-to-line', title: `Pull onto ${humanDate(date, today)}`, onClick: (t) => void ctx.run('Schedule', () => ctx.mutations.schedule(t.key, date)) } })),
        cands.length > 12 ? h('div', { cls: 'helm-hint', text: `… and ${cands.length - 12} more in Plan day.` }) : null,
      ));
    }
  }

  // Habits.
  const habits = ctx.index.allHabits().filter((hb) => habitDue(hb, date) || snap.completions.some((c) => c.habitId === hb.id && c.date === date));
  if (habits.length > 0 || ctx.index.allHabits().length === 0) {
    const chips = h('div', { cls: 'helm-habit-chips' });
    for (const hb of habits) {
      const done = snap.completions.find((c) => c.habitId === hb.id && c.date === date);
      const st = habitStats(hb, snap.completions, today, settings.weekStartsOn, 14);
      const state = done?.state ?? 'pending';
      chips.appendChild(h('button', {
        cls: ['helm-habit', `is-${state}`],
        title: `${hb.title}: streak ${st.streak} · ${Math.round(st.rate30 * 100)}% last 30 days. Click to toggle, shift-click to skip.`,
        onClick: (ev) => {
          const next = ev.shiftKey ? (state === 'skipped' ? 'missed' : 'skipped') : state === 'done' ? 'missed' : 'done';
          void ctx.run('Habit', () => ctx.mutations.setHabitState(hb.id, date, next));
        },
      }, icon(state === 'done' ? 'check' : state === 'skipped' ? 'minus' : 'circle'), h('span', { text: `${hb.icon ? hb.icon + ' ' : ''}${hb.title}` }), st.streak > 1 ? h('span', { cls: 'helm-streak', text: `🔥${st.streak}` }) : null));
    }
    root.appendChild(section('Habits', { count: `${habits.filter((hb) => snap.completions.some((c) => c.habitId === hb.id && c.date === date && c.state === 'done')).length}/${habits.length}`, store, key: 'habits', actions: [iconButton('plus', 'New habit', () => openHabitForm(ctx))] },
      habits.length === 0 ? empty('No habits yet.', button('Create one', { onClick: () => openHabitForm(ctx) })) : chips));
  }

  // Time blocks from the day planner section of the note.
  if (plan.timeBlocks.length > 0) root.appendChild(section('Day planner', { count: plan.timeBlocks.length, store, key: 'timeblocks' }, ...plan.timeBlocks.map((t) => taskRow(ctx, t, { showProject: false }))));

  // Today's own tasks.
  const todayOpen = plan.today.filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  root.appendChild(section('Today', { count: todayOpen.length, store, key: 'today', actions: [iconButton('plus', 'Add a task to this day', () => openCapture(ctx, { date }))] },
    todayOpen.length === 0 && plan.mirrors.length === 0 && plan.unmirrored.length === 0 && plan.elsewhere.length === 0
      ? empty(isPast ? 'Nothing was planned for this day.' : 'Nothing planned yet.', !isPast ? button('Plan this day', { primary: true, icon: 'list-plus', onClick: () => openPlanDay(ctx, date) }) : null)
      : todayOpen.length === 0 ? h('div', { cls: 'helm-hint', text: 'No standalone tasks.' }) : null,
    ...todayOpen.map((t) => taskRow(ctx, t, { showChildren: true, showDate: 'due' })),
  ));

  // From projects, grouped by project.
  const projectItems: { task: Task; display: Task }[] = [
    ...plan.mirrors.filter((x) => (x.source ?? x.mirror).status !== 'done' && (x.source ?? x.mirror).status !== 'cancelled').map((x) => ({ task: x.mirror, display: x.source ?? x.mirror })),
    ...plan.unmirrored.filter((t) => t.status !== 'done' && t.status !== 'cancelled').map((t) => ({ task: t, display: t })),
    ...plan.elsewhere.filter((t) => t.status !== 'done' && t.status !== 'cancelled').map((t) => ({ task: t, display: t })),
  ];
  if (projectItems.length > 0 || plan.mirrors.length > 0) {
    const groups = new Map<string, { task: Task; display: Task }[]>();
    for (const it of projectItems) {
      const k = it.display.projectTitle ?? it.display.mirrorLink?.replace(/^\[\[|\]\]$/g, '').split('|').pop() ?? (it.display.origin === 'inbox' ? 'Inbox' : it.display.path);
      groups.set(k, [...(groups.get(k) ?? []), it]);
    }
    const body: HTMLElement[] = [];
    for (const [title, items] of groups) {
      const pid = items[0]!.display.projectId;
      body.push(h('div', { cls: 'helm-group' },
        h('div', { cls: 'helm-group-title', onClick: () => { if (pid) ctx.navigate('projects', { projectId: pid }); } }, icon('folder'), h('span', { text: title }), items[0]!.display.phaseTitle ? chip(items[0]!.display.phaseTitle, 'phase') : null),
        ...items.map((it) => taskRow(ctx, it.display, { showProject: false, showDate: 'due', showChildren: true })),
      ));
    }
    if (plan.unmirrored.length > 0 && !isPast) body.push(h('div', { cls: 'helm-hint' }, `${plan.unmirrored.length} planned project task(s) are not in the daily note yet. `, button('Write them', { onClick: () => void ctx.run('Sync', async () => { for (const t of plan.unmirrored) await ctx.mutations.schedule(t.key, date); }) })));
    root.appendChild(section('From projects', { count: projectItems.length, store, key: 'projects' }, ...(body.length ? body : [h('div', { cls: 'helm-hint', text: 'All project work for this day is done.' })])));
  }

  // Done.
  const doneAll = [...plan.today, ...plan.timeBlocks, ...plan.mirrors.map((x) => x.source ?? x.mirror), ...plan.unmirrored, ...plan.elsewhere].filter((t) => t.status === 'done' || t.status === 'cancelled');
  if (doneAll.length > 0) root.appendChild(section('Done', { count: doneAll.length, collapsed: true, store, key: 'done' }, ...doneAll.map((t) => taskRow(ctx, t, { showDate: 'none' }))));
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
