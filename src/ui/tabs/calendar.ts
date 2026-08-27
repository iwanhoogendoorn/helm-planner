/**
 * Calendar: one tab, four scopes. Year → Quarter → Month → Week → Day, each
 * clickable into the next, each with the goals and projects of its period.
 */
import type { IsoDate, Task } from '../../core/types';
import { addDays, addMonths, addYears, humanDate, isoWeek, minutesToHuman, MONTH_SHORT, startOfWeek, WEEKDAY_SHORT } from '../../core/dates';
import { monthPeriod, periodOf, quarterPeriod, weekPeriod, yearPeriod, type Period } from '../../core/periods';
import { horizonPeriod, tasksByDay, type DayBucket, type HorizonGoal, type HorizonPeriod, type ProjectHealth } from '../../data/planner';
import { button, chip, h, icon, iconButton, progressBar, richText, section } from '../dom';
import type { UiContext } from '../context';
import { wikilinkSuggest } from '../fields';
import { renderWeek } from './week';
import { openPlanDay } from '../modals/planDay';
import { openProjectForm } from '../modals/projectForm';
import { pickProject } from '../menus';
import { barChart } from '../charts';
import { crumbBar, dateCrumbs } from '../crumbs';
import { drawingsButton, targetForPeriod } from '../drawings';
import { notesButton } from '../notes';

export type CalendarScope = 'week' | 'month' | 'quarter' | 'year';
export interface CalendarState { scope: CalendarScope; anchor: IsoDate; collapsed: Map<string, boolean> }

const SCOPES: { id: CalendarScope; label: string }[] = [{ id: 'week', label: 'Week' }, { id: 'month', label: 'Month' }, { id: 'quarter', label: 'Quarter' }, { id: 'year', label: 'Year' }];

export function renderCalendar(ctx: UiContext, root: HTMLElement, state: CalendarState): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const period = periodOf(state.anchor, state.scope === 'week' ? 'week' : state.scope);
  const step = (n: number): IsoDate => state.scope === 'week' ? addDays(state.anchor, 7 * n) : state.scope === 'month' ? addMonths(period.start, n) : state.scope === 'quarter' ? addMonths(period.start, 3 * n) : addYears(period.start, n);
  const go = (scope: CalendarScope, date: IsoDate): void => ctx.navigate('week', { date, scope });

  root.appendChild(crumbBar(ctx, 'week', [...dateCrumbs(ctx, state.anchor, state.scope, { day: false }), ...(state.anchor !== today ? [{ label: 'today', onClick: () => go(state.scope, today), title: 'Back to today' }] : [])], { homeClick: () => go(state.scope, today), homeTitle: 'Back to today' }));
  root.appendChild(h('div', { cls: 'helm-cal-bar' },
    h('div', { cls: 'helm-segmented' }, ...SCOPES.map((s) => h('button', { cls: ['helm-seg', state.scope === s.id && 'is-active'], text: s.label, onClick: () => go(s.id, state.anchor) }))),
    h('span', { cls: 'helm-spacer' }),
  ));

  if (state.scope === 'week') { renderWeek(ctx, root, { anchor: state.anchor, collapsed: state.collapsed }); return; }

  root.appendChild(h('div', { cls: 'helm-day-head' },
    h('div', { cls: 'helm-day-nav' },
      iconButton('chevron-left', 'Previous', () => go(state.scope, step(-1))),
      h('button', { cls: ['helm-day-title', period.start <= today && today <= period.end && 'is-today'], onClick: () => go(state.scope, today) },
        h('span', { cls: 'helm-day-title-main', text: period.label }),
        h('span', { cls: 'helm-day-title-sub', text: `${humanDate(period.start)} – ${humanDate(period.end, undefined, { year: true })}` }),
      ),
      iconButton('chevron-right', 'Next', () => go(state.scope, step(1))),
    ),
    h('div', { cls: 'helm-day-actions' },
      button('Open note', { icon: 'file-text', onClick: () => void ctx.run('Open note', async () => { const p = await ctx.mutations.ensurePeriodicNote(period); await ctx.openFile(p); }) }),
      button('Horizons', { icon: 'mountain', onClick: () => ctx.navigate('horizons', { periodKey: period.key }) }),
      notesButton(ctx, targetForPeriod(period)),
      drawingsButton(ctx, targetForPeriod(period)),
    ),
  ));

  const days = tasksByDay(ctx.index.snapshot, state.scope === 'month' ? startOfWeek(period.start, settings.weekStartsOn) : period.start, state.scope === 'month' ? addDays(startOfWeek(period.end, settings.weekStartsOn), 6) : period.end, settings);
  const hp = horizonPeriod(ctx.index.snapshot, period, today, settings);
  const inPeriod = [...days.values()].filter((b) => b.date >= period.start && b.date <= period.end);
  const totals = { open: inPeriod.reduce((s, b) => s + b.open.length, 0), done: inPeriod.reduce((s, b) => s + b.done.length, 0), minutes: inPeriod.reduce((s, b) => s + b.minutes, 0), due: inPeriod.reduce((s, b) => s + b.dueUnplanned.length, 0) };
  root.appendChild(h('div', { cls: 'helm-stats helm-cal-kpis' },
    stat(totals.done, 'done', 'is-good'), stat(totals.open, 'planned', ''), stat(minutesToHuman(totals.minutes), 'planned effort', ''),
    stat(totals.due, 'due, not planned', totals.due ? 'is-warn' : ''), stat(hp.goals.length, 'goals', ''), stat(hp.projectsWithin.length, 'projects', ''),
  ));

  if (state.scope === 'month') renderMonth(ctx, root, period, days, today, state);
  else if (state.scope === 'quarter') renderQuarter(ctx, root, period, days, today, state);
  else renderYear(ctx, root, period, days, today, state);

  // Goals and projects of the period.
  root.appendChild(goalsSection(ctx, hp, state));
  root.appendChild(projectsSection(ctx, hp, today, state));
}

function stat(value: string | number, label: string, cls: string): HTMLElement {
  return h('div', { cls: ['helm-stat', cls] }, h('div', { cls: 'helm-stat-value', text: String(value) }), h('div', { cls: 'helm-stat-label', text: label }));
}



/* ── Month ──────────────────────────────────────────────────────────────── */

function renderMonth(ctx: UiContext, root: HTMLElement, period: Period, days: Map<IsoDate, DayBucket>, today: IsoDate, state: CalendarState): void {
  const settings = ctx.settings();
  const grid = h('div', { cls: 'helm-month' });
  const names = settings.weekStartsOn === 1 ? WEEKDAY_SHORT : [WEEKDAY_SHORT[6]!, ...WEEKDAY_SHORT.slice(0, 6)];
  grid.appendChild(h('div', { cls: 'helm-month-head' }, h('span', { cls: 'helm-month-wk', text: 'wk' }), ...names.map((n) => h('span', { text: n }))));
  const list = [...days.values()];
  for (let i = 0; i < list.length; i += 7) {
    const week = list.slice(i, i + 7);
    const wk = isoWeek(week[3]?.date ?? week[0]!.date);
    const row = h('div', { cls: 'helm-month-row' });
    row.appendChild(h('button', { cls: 'helm-month-wk helm-link', text: String(wk.week), title: `Open week ${wk.week}`, onClick: () => ctx.navigate('week', { date: week[0]!.date, scope: 'week' }) }));
    for (const b of week) {
      const out = b.date < period.start || b.date > period.end;
      const cell = h('div', { cls: ['helm-month-cell', out && 'is-outside', b.date === today && 'is-today', b.date < today && 'is-past'], attr: { 'data-date': b.date }, onClick: () => ctx.navigate('today', { date: b.date }) });
      cell.appendChild(h('div', { cls: 'helm-month-cell-head' },
        h('span', { cls: 'helm-month-dom', text: String(Number(b.date.slice(8, 10))) }),
        b.done.length > 0 ? chip(`✓${b.done.length}`, 'done-count') : null,
        b.dueUnplanned.length > 0 ? chip(`!${b.dueUnplanned.length}`, 'due is-overdue', `${b.dueUnplanned.length} due, not planned`) : null,
        h('span', { cls: 'helm-spacer' }),
        b.date >= today ? iconButton('list-plus', 'Plan this day', (ev) => { ev.stopPropagation(); openPlanDay(ctx, b.date); }, 'helm-month-plan') : null,
      ));
      const items = h('div', { cls: 'helm-month-items' });
      for (const t of b.open.slice(0, 3)) items.appendChild(h('div', { cls: ['helm-month-item', t.projectTitle && 'is-project'], title: `${t.text}${t.projectTitle ? ` · ${t.projectTitle}` : ''}` }, t.time ? h('span', { cls: 'helm-time', text: t.time.start }) : null, richText(t.text)));
      if (b.open.length > 3) items.appendChild(h('div', { cls: 'helm-hint', text: `+${b.open.length - 3} more` }));
      cell.appendChild(items);
      dropZone(ctx, cell, b.date);
      row.appendChild(cell);
    }
    grid.appendChild(row);
  }
  root.appendChild(grid);
  void state;
}

function dropZone(ctx: UiContext, el: HTMLElement, date: IsoDate): void {
  el.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-task')) { ev.preventDefault(); el.classList.add('is-dropping'); } });
  el.addEventListener('dragleave', () => el.classList.remove('is-dropping'));
  el.addEventListener('drop', (ev) => { ev.preventDefault(); el.classList.remove('is-dropping'); const key = ev.dataTransfer?.getData('text/helm-task'); if (key) void ctx.run('Schedule', () => ctx.mutations.schedule(key, date)); });
}

/* ── Quarter ────────────────────────────────────────────────────────────── */

function renderQuarter(ctx: UiContext, root: HTMLElement, period: Period, days: Map<IsoDate, DayBucket>, today: IsoDate, state: CalendarState): void {
  const settings = ctx.settings();
  const months = [0, 1, 2].map((i) => monthPeriod(period.year, (period.quarter! - 1) * 3 + 1 + i));
  const row = h('div', { cls: 'helm-quarter' });
  for (const m of months) {
    const hp = horizonPeriod(ctx.index.snapshot, m, today, settings);
    const inM = [...days.values()].filter((b) => b.date >= m.start && b.date <= m.end);
    const done = inM.reduce((s, b) => s + b.done.length, 0);
    const open = inM.reduce((s, b) => s + b.open.length, 0);
    row.appendChild(h('div', { cls: ['helm-qmonth', m.start <= today && today <= m.end && 'is-current'] },
      h('div', { cls: 'helm-qmonth-head', onClick: () => ctx.navigate('week', { date: m.start, scope: 'month' }) }, h('span', { cls: 'helm-qmonth-title', text: m.label.split(' ')[0]! }), h('span', { cls: 'helm-spacer' }), chip(`✓${done}`, 'done-count'), open ? chip(`${open} planned`, 'scheduled') : null),
      miniMonth(ctx, m, days, today, settings.weekStartsOn),
      hp.goals.length > 0 ? h('div', { cls: 'helm-qmonth-goals' }, ...hp.goals.slice(0, 3).map((g) => goalLine(g))) : null,
      hp.projectsWithin.length > 0 ? h('div', { cls: 'helm-task-meta' }, ...hp.projectsWithin.slice(0, 4).map((p) => projectChip(ctx, p))) : null,
    ));
  }
  root.appendChild(row);
  void state;
}

/* ── Year ───────────────────────────────────────────────────────────────── */

function renderYear(ctx: UiContext, root: HTMLElement, period: Period, days: Map<IsoDate, DayBucket>, today: IsoDate, state: CalendarState): void {
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  // Done per month bars.
  const perMonth = Array.from({ length: 12 }, (_, i) => { const m = monthPeriod(period.year, i + 1); const inM = [...days.values()].filter((b) => b.date >= m.start && b.date <= m.end); return { m, done: inM.reduce((s, b) => s + b.done.length, 0), open: inM.reduce((s, b) => s + b.open.length, 0) }; });
  root.appendChild(h('div', { cls: 'helm-dash-card' }, barChart(perMonth.map((x) => ({ key: x.m.key, label: MONTH_SHORT[(x.m.month ?? 1) - 1]!, value: x.done, title: `${x.m.label}: ${x.done} done · ${x.open} planned` })), { valueLabels: true, height: 110, onClick: (k) => ctx.navigate('week', { date: `${k}-01`, scope: 'month' }) }), h('div', { cls: 'helm-hint', text: 'Done per month — click a bar to open the month.' })));
  const grid = h('div', { cls: 'helm-year' });
  for (let q = 1; q <= 4; q++) {
    const qp = quarterPeriod(period.year, q);
    const hq = horizonPeriod(snap, qp, today, settings);
    const block = h('div', { cls: ['helm-year-quarter', qp.start <= today && today <= qp.end && 'is-current'] });
    block.appendChild(h('div', { cls: 'helm-year-quarter-head', onClick: () => ctx.navigate('week', { date: qp.start, scope: 'quarter' }) }, h('span', { cls: 'helm-qmonth-title', text: qp.label }), h('span', { cls: 'helm-spacer' }), hq.goals.length ? chip(`${hq.goals.filter((g) => g.goal.status === 'done').length}/${hq.goals.length} goals`, 'count') : null, hq.projectsWithin.length ? chip(`${hq.projectsWithin.length} proj`, 'project') : null));
    const months = h('div', { cls: 'helm-year-months' });
    for (let i = 0; i < 3; i++) {
      const m = monthPeriod(period.year, (q - 1) * 3 + 1 + i);
      const x = perMonth[(m.month ?? 1) - 1]!;
      months.appendChild(h('div', { cls: ['helm-year-month', m.start <= today && today <= m.end && 'is-current'], onClick: () => ctx.navigate('week', { date: m.start, scope: 'month' }) },
        h('div', { cls: 'helm-year-month-head' }, h('span', { text: MONTH_SHORT[(m.month ?? 1) - 1]! }), h('span', { cls: 'helm-hint', text: `✓${x.done}${x.open ? ` · ${x.open}` : ''}` })),
        miniMonth(ctx, m, days, today, settings.weekStartsOn, { compact: true }),
      ));
    }
    block.appendChild(months);
    if (hq.goals.length > 0) block.appendChild(h('div', { cls: 'helm-qmonth-goals' }, ...hq.goals.slice(0, 3).map((g) => goalLine(g))));
    grid.appendChild(block);
  }
  root.appendChild(grid);
  void state;
}

/* ── Shared pieces ──────────────────────────────────────────────────────── */

function miniMonth(ctx: UiContext, m: Period, days: Map<IsoDate, DayBucket>, today: IsoDate, weekStartsOn: 1 | 7, opts: { compact?: boolean } = {}): HTMLElement {
  const grid = h('div', { cls: ['helm-mini', opts.compact && 'is-compact'] });
  const first = startOfWeek(m.start, weekStartsOn);
  const last = addDays(startOfWeek(m.end, weekStartsOn), 6);
  const max = Math.max(1, ...[...days.values()].map((b) => b.done.length));
  for (let d = first; d <= last; d = addDays(d, 1)) {
    const b = days.get(d);
    const out = d < m.start || d > m.end;
    const level = b && !out ? Math.min(4, Math.ceil((b.done.length / max) * 4)) : 0;
    grid.appendChild(h('button', {
      cls: ['helm-mini-day', out && 'is-outside', d === today && 'is-today', `heat-${level}`, b && b.open.length > 0 && !out && 'has-open'],
      title: b && !out ? `${humanDate(d, today)}: ${b.done.length} done · ${b.open.length} planned${b.dueUnplanned.length ? ` · ${b.dueUnplanned.length} due` : ''}` : '',
      onClick: (ev) => { ev.stopPropagation(); if (!out) ctx.navigate('today', { date: d }); },
    }, opts.compact ? null : h('span', { text: String(Number(d.slice(8, 10))) })));
  }
  return grid;
}

function goalLine(g: HorizonGoal): HTMLElement {
  return h('div', { cls: ['helm-horizon-goal', g.goal.status === 'done' && 'is-done'] }, icon(g.goal.status === 'done' ? 'check-circle' : 'target'), h('span', { cls: 'helm-horizon-goal-text' }, richText(g.goal.text)), h('span', { cls: 'helm-hint', text: `${Math.round(g.progress * 100)}%` }));
}

function projectChip(ctx: UiContext, p: ProjectHealth): HTMLElement {
  const c = chip(p.project.title, 'project', `${p.done}/${p.total} done`);
  c.addEventListener('click', (ev) => { ev.stopPropagation(); ctx.navigate('projects', { projectId: p.project.id }); });
  return c;
}

function goalsSection(ctx: UiContext, hp: HorizonPeriod, state: CalendarState): HTMLElement {
  const p = hp.period;
  const add = h('input', { cls: 'helm-quickadd-input', attr: { type: 'text', placeholder: `Add a goal for ${p.label}…` } });
  wikilinkSuggest(ctx, add);
  add.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && add.value.trim() !== '') { const v = add.value; add.value = ''; void ctx.run('Add goal', () => ctx.mutations.addGoal(p.key, v)); } });
  return section(`Goals for ${p.label}`, { count: hp.goals.length, store: state.collapsed, key: `goals:${p.kind}` },
    ...hp.goals.map((g) => h('div', { cls: ['helm-goal', g.goal.status === 'done' && 'is-done'] },
      h('button', { cls: ['helm-check', `mark-${g.goal.status}`], onClick: () => void ctx.run('Goal', () => ctx.mutations.setStatus(g.goal.key, g.goal.status === 'done' ? 'todo' : 'done')) }, g.goal.status === 'done' ? icon('check') : null),
      h('div', { cls: 'helm-goal-main' }, h('div', { cls: 'helm-goal-text' }, richText(g.goal.text)), h('div', { cls: 'helm-goal-progress' }, progressBar(g.progress, 'is-thin'), h('span', { cls: 'helm-hint', text: g.taskTotal > 0 ? `${g.taskDone}/${g.taskTotal} tasks` : g.goal.status === 'done' ? 'achieved' : 'no project linked' })), h('div', { cls: 'helm-task-meta' }, ...g.projects.map((pr) => projectChip(ctx, pr)))),
      h('div', { cls: 'helm-task-actions' }, iconButton('link', 'Link a project', (ev) => { ev.stopPropagation(); pickProject(ctx, (pr) => void ctx.run('Link', () => ctx.mutations.linkProjectToGoal(pr.id, g.goal.key))); })),
    )),
    h('div', { cls: 'helm-quickadd' }, icon('target'), add),
  );
}

function projectsSection(ctx: UiContext, hp: HorizonPeriod, today: IsoDate, state: CalendarState): HTMLElement {
  const p = hp.period;
  return section(`Projects in ${p.label}`, { count: hp.projectsWithin.length, store: state.collapsed, key: `projects:${p.kind}`, actions: [button('Bind a project…', { icon: 'link', onClick: () => pickProject(ctx, (pr) => void ctx.run('Bind', () => ctx.mutations.setProjectFields(pr.id, { period: p.key }))) }), button('New project', { icon: 'folder-plus', onClick: () => openProjectForm(ctx, { period: p.key, onCreated: (c) => ctx.navigate('projects', { projectId: c.id }) }) })] },
    hp.projectsWithin.length === 0 ? h('div', { cls: 'helm-hint', text: 'No project is bound to this period yet.' }) : null,
    ...hp.projectsWithin.map((hh) => h('div', { cls: 'helm-project', onClick: () => ctx.navigate('projects', { projectId: hh.project.id }) },
      h('div', { cls: 'helm-project-head' }, icon('folder'), h('span', { cls: 'helm-project-title', text: hh.project.title }), chip(hh.project.status, 'area'), hh.project.period && hh.project.period !== p.key ? chip(hh.project.period, 'scheduled') : null, h('span', { cls: 'helm-spacer' }), hh.project.due ? chip(`due ${humanDate(hh.project.due, today)}`, 'due') : null, h('span', { cls: 'helm-project-count', text: `${hh.done}/${hh.total}` })),
      progressBar(hh.progress, 'is-thin'),
      h('div', { cls: 'helm-project-foot' }, hh.nextAction ? h('span', { cls: 'helm-project-next' }, icon('arrow-right'), h('span', { text: hh.nextAction.text })) : null, h('span', { cls: 'helm-spacer' }), ...hh.flags.map((f) => chip(f.replace(/-/g, ' '), `flag flag-${f}`))),
    )),
  );
}

export function scopeOfPeriodKind(kind: Period['kind']): CalendarScope { return kind; }
export type { Task };
export { weekPeriod, yearPeriod };
