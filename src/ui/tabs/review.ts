/** Weekly review: numbers, what needs attention, habits, what got done. */
import { humanDate, relativeDays, minutesToHuman } from '../../core/dates';
import { review, type ProjectHealth } from '../../data/planner';
import { habitStats } from '../../data/habits';
import { button, chip, empty, h, icon, section } from '../dom';
import type { UiContext } from '../context';
import { taskRow } from '../taskRow';
import { openHabitForm } from '../modals/habitForm';
import { openCapture } from '../modals/capture';
import { effortOf } from '../../data/planner';

export interface ReviewState { collapsed: Map<string, boolean>; checks: Set<string> }

const FLAG_LABEL: Record<ProjectHealth['flags'][number], string> = { 'no-next-action': 'no next action', stale: 'stale', overdue: 'overdue tasks', 'due-soon': 'due soon', 'past-due': 'past due', blocked: 'blocked' };

export function renderReview(ctx: UiContext, root: HTMLElement, state: ReviewState): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const r = review(snap, today, settings);
  const store = state.collapsed;

  const stat = (value: string | number, label: string, cls = '', onClick?: () => void): HTMLElement => h('button', { cls: ['helm-stat', cls, onClick && 'is-clickable'], onClick }, h('div', { cls: 'helm-stat-value', text: String(value) }), h('div', { cls: 'helm-stat-label', text: label }));
  root.appendChild(h('div', { cls: 'helm-stats' },
    stat(r.completedThisWeek.length, 'done this week', 'is-good'),
    stat(r.overdue.length, 'overdue', r.overdue.length ? 'is-bad' : ''),
    stat(r.inbox.length, 'in inbox', r.inbox.length ? 'is-warn' : '', () => ctx.navigate('inbox')),
    stat(r.activeCount, 'active projects', '', () => ctx.navigate('projects')),
    stat(r.staleCount, `stale (${settings.staleProjectDays}d+)`, r.staleCount ? 'is-warn' : ''),
    stat(r.noNextActionCount, 'no next action', r.noNextActionCount ? 'is-warn' : ''),
  ));

  // Throughput sparkline.
  const max = Math.max(1, ...r.throughput.map((t) => t.done));
  root.appendChild(h('div', { cls: 'helm-spark' },
    h('span', { cls: 'helm-hint', text: 'Done per week, last 8 weeks' }),
    h('div', { cls: 'helm-spark-bars' }, ...r.throughput.map((t) => h('div', { cls: ['helm-spark-bar', t.weekStart === r.weekStart && 'is-current'], style: { height: `${Math.max(6, (t.done / max) * 100)}%` }, title: `Week of ${humanDate(t.weekStart)}: ${t.done} done` }))),
  ));

  // Checklist.
  const checks = [
    ['inbox', 'Inbox to zero', r.inbox.length === 0],
    ['overdue', 'Every overdue task rescheduled or dropped', r.overdue.length === 0],
    ['next', 'Every active project has a next action', r.noNextActionCount === 0],
    ['stale', 'Stale projects put on hold or revived', r.staleCount === 0],
    ['week', 'Next week planned', false],
  ] as const;
  root.appendChild(section('Review checklist', { store, key: 'checklist' }, h('div', { cls: 'helm-checklist' }, ...checks.map(([k, label, auto]) => {
    const on = auto || state.checks.has(k);
    return h('label', { cls: ['helm-checkitem', on && 'is-done'] }, h('input', { attr: { type: 'checkbox', checked: on, disabled: auto }, onChange: (ev) => { if ((ev.target as HTMLInputElement).checked) state.checks.add(k); else state.checks.delete(k); ctx.refresh(); } }), h('span', { text: label }), auto ? chip('auto', 'auto') : null);
  }))));

  // Projects needing attention.
  if (r.attention.length > 0) {
    root.appendChild(section('Projects needing attention', { count: r.attention.length, store, key: 'attention', cls: 'is-attention' }, ...r.attention.map((hh) => h('div', { cls: 'helm-review-project' },
      h('div', { cls: 'helm-review-project-head' },
        h('a', { cls: 'helm-link helm-review-project-title', text: hh.project.title, onClick: () => ctx.navigate('projects', { projectId: hh.project.id }) }),
        ...hh.flags.map((f) => chip(FLAG_LABEL[f], `flag flag-${f}`)),
        h('span', { cls: 'helm-spacer' }),
        hh.lastTouched ? h('span', { cls: 'helm-hint', text: relativeDays(hh.lastTouched, today) }) : null,
      ),
      h('div', { cls: 'helm-review-project-actions' },
        hh.flags.includes('no-next-action') ? button('Add next action', { icon: 'plus', onClick: () => openCapture(ctx, { projectId: hh.project.id }) }) : null,
        hh.nextAction ? button('Plan next action today', { icon: 'sun', onClick: () => void ctx.run('Schedule', () => ctx.mutations.schedule(hh.nextAction!.key, today)) }) : null,
        button('On hold', { icon: 'pause', onClick: () => void ctx.run('Status', () => ctx.mutations.setProjectFields(hh.project.id, { status: 'on-hold' })) }),
        hh.open === 0 ? button('Mark done', { icon: 'check', onClick: () => void ctx.run('Status', () => ctx.mutations.setProjectFields(hh.project.id, { status: 'done' })) }) : null,
      ),
    ))));
  }

  if (r.overdue.length > 0) root.appendChild(section('Overdue', { count: r.overdue.length, store, key: 'overdue', cls: 'is-attention' }, ...r.overdue.slice(0, 50).map((t) => taskRow(ctx, t, { quickAction: { icon: 'sun', title: 'Plan for today', onClick: (x) => void ctx.run('Schedule', () => ctx.mutations.schedule(x.key, today)) } }))));
  if (r.waiting.length > 0) root.appendChild(section('Waiting on someone', { count: r.waiting.length, store, key: 'waiting' }, ...r.waiting.map((t) => taskRow(ctx, t))));
  root.appendChild(section('Due in the next 14 days', { count: r.dueNext14.length, store, key: 'due14' }, r.dueNext14.length === 0 ? h('div', { cls: 'helm-hint', text: 'Nothing due.' }) : null, ...r.dueNext14.map((t) => taskRow(ctx, t, { showDate: 'both' }))));

  // Habits.
  const habits = ctx.index.allHabits().filter((hb) => hb.active);
  root.appendChild(section('Habits', { count: habits.length, store, key: 'habits', actions: [button('New habit', { icon: 'plus', onClick: () => openHabitForm(ctx) })] },
    habits.length === 0 ? empty('No habits. A habit is a note with “type: habit” in your habits folder.', button('Create one', { onClick: () => openHabitForm(ctx) })) : null,
    ...habits.map((hb) => {
      const st = habitStats(hb, snap.completions, today, settings.weekStartsOn, 84);
      return h('div', { cls: 'helm-habit-row', onClick: () => openHabitForm(ctx, hb) },
        h('div', { cls: 'helm-habit-row-head' },
          h('span', { cls: 'helm-habit-name', text: `${hb.icon ? hb.icon + ' ' : ''}${hb.title}` }),
          chip(`🔥 ${st.streak}`, 'streak', `Best ${st.bestStreak}`),
          chip(`${Math.round(st.rate30 * 100)}% / 30d`, st.rate30 >= 0.8 ? 'rate is-good' : st.rate30 >= 0.5 ? 'rate' : 'rate is-bad'),
          chip(`${st.doneThisWeek}/${st.scheduledThisWeek} this week`, 'rate'),
          h('span', { cls: 'helm-spacer' }),
          h('span', { cls: 'helm-hint', text: hb.schedule.raw }),
        ),
        h('div', { cls: 'helm-heat' }, ...st.days.map((d) => h('span', { cls: ['helm-heat-cell', `is-${d.state}`], title: `${d.date}: ${d.state}` }))),
      );
    }),
  ));

  // Completed this week.
  const est = r.completedThisWeek.reduce((s, t) => s + effortOf(t, settings), 0);
  root.appendChild(section('Completed this week', { count: r.completedThisWeek.length, store, key: 'completed', collapsed: true, actions: [h('span', { cls: 'helm-hint', text: `≈ ${minutesToHuman(est)}` })] },
    r.completedByProject.length > 0 ? h('div', { cls: 'helm-bytag' }, ...r.completedByProject.map((b) => chip(`${b.title} · ${b.count}`, 'project'))) : null,
    ...r.completedThisWeek.slice(0, 100).map((t) => taskRow(ctx, t, { showDate: 'none' })),
  ));
  void icon;
}
