/** Dashboard: filterable stats with charts you can click into. */
import type { IsoDate, Task } from '../../core/types';
import { addDays, humanDate, minutesToHuman, startOfWeek } from '../../core/dates';
import { periodOf } from '../../core/periods';
import { computeStats, filterOptions, type Series, type StatsFilter } from '../../data/stats';
import { PART_LABEL } from '../../core/dailyNote';
import { barChart, donut, gauge, legend, lineChart } from '../charts';
import { button, chip, h, icon, section } from '../dom';
import type { UiContext } from '../context';
import { openDrilldown } from '../modals/drilldown';

export type RangePreset = '7d' | '14d' | '30d' | '90d' | 'week' | 'month' | 'quarter' | 'year' | 'all' | 'custom';

export interface DashboardState {
  preset: RangePreset;
  from?: IsoDate;
  to?: IsoDate;
  projectId?: string;
  area?: string;
  tag?: string;
  periodKey?: string;
  collapsed: Map<string, boolean>;
}

export function defaultDashboardState(): DashboardState {
  return { preset: '30d', collapsed: new Map() };
}

function rangeFor(state: DashboardState, today: IsoDate, weekStartsOn: 1 | 7): { from: IsoDate; to: IsoDate } {
  switch (state.preset) {
    case '7d': return { from: addDays(today, -6), to: today };
    case '14d': return { from: addDays(today, -13), to: today };
    case '30d': return { from: addDays(today, -29), to: today };
    case '90d': return { from: addDays(today, -89), to: today };
    case 'week': return { from: startOfWeek(today, weekStartsOn), to: addDays(startOfWeek(today, weekStartsOn), 6) };
    case 'month': { const p = periodOf(today, 'month'); return { from: p.start, to: p.end }; }
    case 'quarter': { const p = periodOf(today, 'quarter'); return { from: p.start, to: p.end }; }
    case 'year': { const p = periodOf(today, 'year'); return { from: p.start, to: p.end }; }
    case 'all': return { from: addDays(today, -365), to: today };
    case 'custom': return { from: state.from ?? addDays(today, -29), to: state.to ?? today };
  }
}

const PRESETS: [RangePreset, string][] = [['7d', '7 days'], ['14d', '14 days'], ['30d', '30 days'], ['90d', '90 days'], ['week', 'This week'], ['month', 'This month'], ['quarter', 'This quarter'], ['year', 'This year'], ['all', '12 months'], ['custom', 'Custom…']];

export function renderDashboard(ctx: UiContext, root: HTMLElement, state: DashboardState): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const range = rangeFor(state, today, settings.weekStartsOn);
  const filter: StatsFilter = { from: range.from, to: range.to, ...(state.projectId ? { projectId: state.projectId } : {}), ...(state.area ? { area: state.area } : {}), ...(state.tag ? { tag: state.tag } : {}), ...(state.periodKey ? { periodKey: state.periodKey } : {}) };
  const s = computeStats(snap, filter, today, settings);
  const opts = filterOptions(snap);
  const refresh = (): void => ctx.refresh();
  const drill = (title: string, tasks: Task[]): void => openDrilldown(ctx, title, tasks);

  // Filter bar.
  const presetSel = h('select', { cls: 'helm-select-inline', onChange: (ev) => { state.preset = (ev.target as HTMLSelectElement).value as RangePreset; refresh(); } });
  for (const [k, label] of PRESETS) presetSel.appendChild(h('option', { text: label, attr: { value: k, selected: state.preset === k } }));
  const projSel = h('select', { cls: 'helm-select-inline', onChange: (ev) => { state.projectId = (ev.target as HTMLSelectElement).value || undefined; refresh(); } });
  projSel.appendChild(h('option', { text: 'All projects', attr: { value: '' } }));
  for (const p of ctx.index.allProjects().sort((a, b) => a.title.localeCompare(b.title))) projSel.appendChild(h('option', { text: p.title, attr: { value: p.id, selected: state.projectId === p.id } }));
  const areaSel = h('select', { cls: 'helm-select-inline', onChange: (ev) => { state.area = (ev.target as HTMLSelectElement).value || undefined; refresh(); } });
  areaSel.appendChild(h('option', { text: 'All areas', attr: { value: '' } }));
  for (const a of opts.areas) areaSel.appendChild(h('option', { text: a, attr: { value: a, selected: state.area === a } }));
  const tagSel = h('select', { cls: 'helm-select-inline', onChange: (ev) => { state.tag = (ev.target as HTMLSelectElement).value || undefined; refresh(); } });
  tagSel.appendChild(h('option', { text: 'All tags', attr: { value: '' } }));
  for (const t of opts.tags) tagSel.appendChild(h('option', { text: `#${t}`, attr: { value: t, selected: state.tag === t } }));
  const periodSel = h('select', { cls: 'helm-select-inline', onChange: (ev) => { state.periodKey = (ev.target as HTMLSelectElement).value || undefined; refresh(); } });
  periodSel.appendChild(h('option', { text: 'Any horizon', attr: { value: '' } }));
  for (const key of [periodOf(today, 'year').key, periodOf(today, 'quarter').key, periodOf(today, 'month').key]) periodSel.appendChild(h('option', { text: `Bound to ${key}`, attr: { value: key, selected: state.periodKey === key } }));
  const bar = h('div', { cls: 'helm-toolbar helm-dash-filters' }, icon('filter'), presetSel, projSel, areaSel, tagSel, periodSel);
  if (state.preset === 'custom') {
    bar.append(
      h('input', { attr: { type: 'date', value: range.from }, onChange: (ev) => { state.from = (ev.target as HTMLInputElement).value; refresh(); } }),
      h('input', { attr: { type: 'date', value: range.to }, onChange: (ev) => { state.to = (ev.target as HTMLInputElement).value; refresh(); } }),
    );
  }
  bar.append(h('span', { cls: 'helm-spacer' }), h('span', { cls: 'helm-hint', text: `${humanDate(range.from)} – ${humanDate(range.to, undefined, { year: true })} · ${s.days} days` }));
  if (state.projectId || state.area || state.tag || state.periodKey) bar.appendChild(button('Clear', { icon: 'x', onClick: () => { state.projectId = undefined; state.area = undefined; state.tag = undefined; state.periodKey = undefined; refresh(); } }));
  root.appendChild(bar);

  // KPIs.
  const kpi = (value: string | number, label: string, cls = '', onClick?: () => void): HTMLElement => h('button', { cls: ['helm-stat', cls, onClick && 'is-clickable'], onClick }, h('div', { cls: 'helm-stat-value', text: String(value) }), h('div', { cls: 'helm-stat-label', text: label }));
  root.appendChild(h('div', { cls: 'helm-stats' },
    kpi(s.totals.done, 'done', 'is-good', () => drill('Done in range', s.perDay.flatMap((d) => d.tasks))),
    kpi(s.totals.perDay.toFixed(1), 'per day'),
    kpi(minutesToHuman(s.totals.doneMinutes), 'work done (est.)'),
    kpi(s.totals.created, 'captured'),
    kpi(s.totals.open, 'open now', '', () => drill('Open', s.ageBuckets.flatMap((b) => b.tasks))),
    kpi(s.totals.overdue, 'overdue', s.totals.overdue ? 'is-bad' : '', () => drill('Overdue', s.ageBuckets.flatMap((b) => b.tasks).filter((t) => t.due !== undefined && t.due < today))),
    kpi(`${s.streak.current}d`, `done-streak (best ${s.streak.best})`, s.streak.current >= 3 ? 'is-good' : ''),
    kpi(minutesToHuman(s.totals.openMinutes), 'open backlog (est.)'),
  ));

  const store = state.collapsed;
  const card = (title: string, key: string, hint: string, ...body: (HTMLElement | SVGElement | null)[]): HTMLElement => section(title, { store, key, actions: [h('span', { cls: 'helm-hint', text: hint })] }, h('div', { cls: 'helm-dash-card' }, ...body));

  const grid = h('div', { cls: 'helm-dash-grid' });
  // Done per day / per week.
  const dayBars = s.perDay.map((d) => ({ key: d.key, label: humanDate(d.key).replace(/^\w+ /, ''), value: d.value, title: `${humanDate(d.key, today)}: ${d.value} done` }));
  grid.appendChild(card('Done per day', 'perday', 'click a bar for the tasks', s.days <= 120
    ? barChart(dayBars, { onClick: (k) => { const d = s.perDay.find((x) => x.key === k); if (d) drill(`Done on ${humanDate(k, today)}`, d.tasks); }, valueLabels: s.days <= 31 })
    : barChart(s.perWeek.map((w) => ({ key: w.weekStart, label: humanDate(w.weekStart).replace(/^\w+ /, ''), value: w.done })), { onClick: (k) => { const w = s.perWeek.find((x) => x.weekStart === k); if (w) drill(`Done in week of ${humanDate(k)}`, w.tasks); }, valueLabels: true })));
  // Cumulative flow.
  grid.appendChild(card('Cumulative flow', 'flow', 'captured vs done — a widening gap means the backlog grows', lineChart([
    { label: 'captured', points: s.cumulative.map((c) => c.created), color: 'var(--color-orange)' },
    { label: 'done', points: s.cumulative.map((c) => c.done), color: 'var(--color-green)', area: true },
  ], s.cumulative.map((c) => c.date.slice(5))), legend([{ key: 'c', label: 'captured', value: s.totals.created, color: 'var(--color-orange)' }, { key: 'd', label: 'done', value: s.totals.done, color: 'var(--color-green)' }])));
  // Plan adherence + part of day.
  const partSlices = (['morning', 'afternoon', 'evening', 'anytime'] as const).map((p) => ({ key: p, label: PART_LABEL[p], value: s.byPart[p].done }));
  grid.appendChild(card('Plan adherence', 'adherence', 'of what was put on a day, how much got done', h('div', { cls: 'helm-dash-row' },
    gauge(s.adherence.rate, 'kept'),
    h('div', { cls: 'helm-dash-facts' },
      h('div', {}, h('b', { text: String(s.adherence.planned) }), ' planned onto days'),
      h('div', {}, h('b', { text: String(s.adherence.done) }), ' done'),
      h('div', {}, h('b', { text: String(s.adherence.carried) }), ' carried forward'),
      button('Show planned', { cls: 'helm-btn-quiet', onClick: () => drill('Planned onto days', s.adherence.tasks) }),
    ),
  )));
  const partTotal = partSlices.reduce((a, b) => a + b.value, 0);
  grid.appendChild(card('Done by part of the day', 'parts', 'where your finished work actually happens', partTotal === 0 ? h('div', { cls: 'helm-hint', text: 'Nothing planned onto a day was completed in this range yet — plan work through Helm and this fills up.' }) : h('div', { cls: 'helm-dash-row' },
    donut(partSlices, { centre: String(partTotal), onClick: (k) => drill(`Done in the ${PART_LABEL[k as keyof typeof PART_LABEL].toLowerCase()}`, s.byPart[k as keyof typeof s.byPart].tasks) }),
    h('div', {}, legend(partSlices, (k) => drill(`Done in the ${PART_LABEL[k as keyof typeof PART_LABEL].toLowerCase()}`, s.byPart[k as keyof typeof s.byPart].tasks)),
      h('div', { cls: 'helm-hint', text: (['morning', 'afternoon', 'evening', 'anytime'] as const).map((p) => `${PART_LABEL[p]}: ${s.byPart[p].planned ? Math.round((100 * s.byPart[p].done) / s.byPart[p].planned) : 0}% kept`).join(' · ') })),
  )));
  // Weekday.
  grid.appendChild(card('Done by weekday', 'weekday', 'your productive days', barChart(s.byWeekday.map((w) => ({ key: w.key, label: w.label, value: w.value })), { onClick: (k) => { const w = s.byWeekday.find((x) => x.key === k); if (w) drill(`Done on ${w.label}s`, w.tasks); }, valueLabels: true, height: 120 })));
  // Age.
  grid.appendChild(card('Age of open tasks', 'age', 'old open tasks are decisions you have not made', barChart(s.ageBuckets.map((b) => ({ key: b.key, label: b.label, value: b.value, color: b.key === '> 1 year' || b.key === '3–12 months' ? 'var(--color-red)' : undefined })), { horizontal: true, onClick: (k) => { const b = s.ageBuckets.find((x) => x.key === k); if (b) drill(`Open for ${b.label}`, b.tasks); } })));
  // Areas & tags.
  grid.appendChild(card('Done by area', 'area', 'where the effort went', s.byArea.length === 0 ? h('div', { cls: 'helm-hint', text: 'Nothing done in this range.' }) : h('div', { cls: 'helm-dash-row' }, donut(s.byArea.map((a) => ({ key: a.key, label: a.label, value: a.value })), { centre: String(s.totals.done), onClick: (k) => { const a = s.byArea.find((x) => x.key === k); if (a) drill(`Done in ${a.label}`, a.tasks); } }), legend(s.byArea.map((a) => ({ key: a.key, label: a.label, value: a.value })), (k) => { const a = s.byArea.find((x) => x.key === k); if (a) drill(`Done in ${a.label}`, a.tasks); }))));
  grid.appendChild(card('Done by tag', 'tag', 'top tags on finished work', s.byTag.length ? barChart(s.byTag.map((t) => ({ key: t.key, label: t.label, value: t.value })), { horizontal: true, onClick: (k) => { const t = s.byTag.find((x) => x.key === k); if (t) drill(`Done with ${t.label}`, t.tasks); } }) : h('div', { cls: 'helm-hint', text: 'No tags on finished tasks in this range.' })));
  root.appendChild(grid);

  // Projects table.
  root.appendChild(section('Projects', { store, key: 'projects', count: s.byProject.length, actions: [h('span', { cls: 'helm-hint', text: 'velocity = done per week in range · ETA = open ÷ velocity' })] },
    h('div', { cls: 'helm-table-wrap' }, h('table', { cls: 'helm-table' },
      h('thead', {}, h('tr', {}, ...['Project', 'Progress', 'Done', 'Open', 'Velocity', 'ETA'].map((x) => h('th', { text: x })))),
      h('tbody', {}, ...s.byProject.slice(0, 40).map((r) => h('tr', { cls: 'is-clickable', onClick: () => drill(`Done in ${r.project.title}`, r.doneTasks) },
        h('td', {}, h('a', { cls: 'helm-link', text: r.project.title, onClick: (ev) => { ev.stopPropagation(); ctx.navigate('projects', { projectId: r.project.id }); } }), r.project.period ? chip(r.project.period, 'scheduled') : null),
        h('td', {}, h('div', { cls: 'helm-progress is-thin helm-table-progress' }, h('div', { cls: 'helm-progress-fill', style: { width: `${Math.round(r.progress * 100)}%` } })), h('span', { cls: 'helm-hint', text: ` ${Math.round(r.progress * 100)}%` })),
        h('td', { text: String(r.doneTasks.length) }),
        h('td', { text: String(r.open) }),
        h('td', { text: r.velocity.toFixed(1) + '/wk' }),
        h('td', { text: r.etaWeeks !== undefined ? (r.etaWeeks < 1 ? '< 1 wk' : `${Math.round(r.etaWeeks)} wk`) : r.open === 0 ? '—' : 'stalled', cls: r.etaWeeks === undefined && r.open > 0 ? 'is-bad' : '' }),
      ))),
    )),
  ));

  // Habits and goals.
  if (s.habits.length > 0) root.appendChild(section('Habit consistency', { store, key: 'habits', count: s.habits.length },
    barChart(s.habits.map((hb) => ({ key: hb.habit.id, label: `${hb.habit.icon ? hb.habit.icon + ' ' : ''}${hb.habit.title}`, value: Math.round(hb.rate * 100), title: `${hb.habit.title}: ${hb.done}/${hb.scheduled} (${Math.round(hb.rate * 100)}%) · streak ${hb.streak}`, color: hb.rate >= 0.8 ? 'var(--color-green)' : hb.rate >= 0.5 ? 'var(--color-orange)' : 'var(--color-red)' })), { horizontal: true }),
    h('div', { cls: 'helm-hint', text: 'Percent of scheduled days done in the range.' })));
  if (s.goals.length > 0) root.appendChild(section('Goals', { store, key: 'goals', count: s.goals.length },
    barChart(s.goals.map((g) => ({ key: g.goal.key, label: `${g.goal.periodKey} ${g.goal.text}`, value: Math.round(g.progress * 100), title: `${g.goal.text}: ${Math.round(g.progress * 100)}% · ${g.projects} project(s)`, color: g.goal.status === 'done' ? 'var(--color-green)' : undefined })), { horizontal: true, onClick: (k) => ctx.navigate('horizons', { periodKey: ctx.index.goal(k)?.periodKey ?? '' }) })));

}

export type { Series };
