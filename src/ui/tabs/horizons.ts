/** Horizons: the year, its quarters and months — goals and the projects bound to each. */
import type { Goal, Project } from '../../core/types';
import { humanDate } from '../../core/dates';
import { parsePeriod, periodOf, type Period } from '../../core/periods';
import { horizons, type HorizonGoal, type HorizonPeriod, type ProjectHealth } from '../../data/planner';
import { button, chip, empty, h, icon, iconButton, progressBar, richText, section } from '../dom';
import type { UiContext } from '../context';
import { pickProject } from '../menus';
import { openTaskEditor } from '../modals/taskEditor';
import { openProjectForm } from '../modals/projectForm';
import { Menu } from 'obsidian';
import { crumbBar } from '../crumbs';

export interface HorizonsState { year: number; selected?: string; collapsed: Map<string, boolean> }

export function renderHorizons(ctx: UiContext, root: HTMLElement, state: HorizonsState): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const hz = horizons(snap, state.year, today, settings);
  const thisYear = Number(today.slice(0, 4));

  const selP = state.selected ? parsePeriod(state.selected) : undefined;
  root.appendChild(crumbBar(ctx, 'horizons', [
    { label: String(state.year), onClick: () => { state.selected = undefined; ctx.refresh(); }, active: !selP },
    ...(selP && selP.kind !== 'year' && selP.kind !== 'quarter' ? [{ label: `Q${selP.quarter}`, onClick: () => { state.selected = `${selP.year}-Q${selP.quarter}`; ctx.refresh(); } }] : []),
    ...(selP && selP.kind !== 'year' ? [{ label: selP.kind === 'quarter' ? `Q${selP.quarter}` : selP.label.split(' ')[0]!, active: true }] : []),
  ], { homeClick: () => { state.selected = undefined; state.year = thisYear; ctx.refresh(); }, homeTitle: 'Back to this year' }));
  root.appendChild(h('div', { cls: 'helm-day-head' },
    h('div', { cls: 'helm-day-nav' },
      iconButton('chevron-left', 'Previous year', () => { state.year--; state.selected = undefined; ctx.refresh(); }),
      h('button', { cls: ['helm-day-title', state.year === thisYear && 'is-today'], onClick: () => { state.year = thisYear; state.selected = undefined; ctx.refresh(); } },
        h('span', { cls: 'helm-day-title-main', text: String(state.year) }),
        h('span', { cls: 'helm-day-title-sub', text: `${hz.year.goals.length} goals · ${hz.year.projectsWithin.length} projects · ${hz.year.openTasks} open tasks` }),
      ),
      iconButton('chevron-right', 'Next year', () => { state.year++; state.selected = undefined; ctx.refresh(); }),
    ),
    h('div', { cls: 'helm-day-actions' },
      button('Open year note', { icon: 'file-text', onClick: () => openPeriodNote(ctx, hz.year.period) }),
    ),
  ));

  // Year.
  root.appendChild(periodCard(ctx, hz.year, state, { large: true }));

  // Quarters.
  root.appendChild(h('div', { cls: 'helm-horizon-grid quarters' }, ...hz.quarters.map((q) => periodCard(ctx, q, state, {}))));

  // Months.
  root.appendChild(h('div', { cls: 'helm-horizon-grid months' }, ...hz.months.map((m) => periodCard(ctx, m, state, { compact: true }))));

  // Selected period detail.
  const sel = state.selected ? [hz.year, ...hz.quarters, ...hz.months].find((p) => p.period.key === state.selected) : undefined;
  if (sel) root.appendChild(periodDetail(ctx, sel, state));
  else root.appendChild(h('div', { cls: 'helm-hint helm-week-hint', text: 'Click a quarter or a month to see its goals and projects. Bind a project to a period from its detail page, or with “Bind a project…” below a period.' }));
}

function periodCard(ctx: UiContext, hp: HorizonPeriod, state: HorizonsState, opts: { large?: boolean; compact?: boolean }): HTMLElement {
  const p = hp.period;
  const selected = state.selected === p.key;
  const done = hp.goals.filter((g) => g.goal.status === 'done').length;
  const avg = hp.goals.length > 0 ? hp.goals.reduce((s, g) => s + g.progress, 0) / hp.goals.length : hp.doneTasks + hp.openTasks > 0 ? hp.doneTasks / (hp.doneTasks + hp.openTasks) : 0;
  const card = h('div', {
    cls: ['helm-horizon', `kind-${p.kind}`, hp.isCurrent && 'is-current', hp.isPast && 'is-past', selected && 'is-selected', opts.large && 'is-large', opts.compact && 'is-compact'],
    onClick: () => { state.selected = selected ? undefined : p.key; ctx.refresh(); },
  });
  card.append(
    h('div', { cls: 'helm-horizon-head' },
      h('span', { cls: 'helm-horizon-label', text: p.kind === 'month' ? p.label.split(' ')[0]! : p.label }),
      hp.isCurrent ? chip('now', 'scheduled') : null,
      h('span', { cls: 'helm-spacer' }),
      hp.goals.length > 0 ? chip(`${done}/${hp.goals.length} goals`, 'count') : null,
      hp.projectsWithin.length > 0 ? chip(`${hp.projectsWithin.length} proj`, 'project') : null,
    ),
    progressBar(avg, 'is-thin'),
  );
  if (!opts.compact) {
    const list = h('div', { cls: 'helm-horizon-goals' });
    for (const g of hp.goals.slice(0, opts.large ? 8 : 4)) list.appendChild(h('div', { cls: ['helm-horizon-goal', g.goal.status === 'done' && 'is-done'] }, icon(g.goal.status === 'done' ? 'check-circle' : 'target'), h('span', { cls: 'helm-horizon-goal-text' }, richText(g.goal.text)), h('span', { cls: 'helm-hint', text: `${Math.round(g.progress * 100)}%` })));
    if (hp.goals.length === 0) list.appendChild(h('div', { cls: 'helm-hint', text: opts.large ? 'No goals for this year yet.' : 'No goals.' }));
    card.appendChild(list);
  } else if (hp.openTasks + hp.doneTasks > 0) card.appendChild(h('div', { cls: 'helm-hint', text: `${hp.openTasks} open` }));
  return card;
}

function periodDetail(ctx: UiContext, hp: HorizonPeriod, state: HorizonsState): HTMLElement {
  const today = ctx.today();
  const p = hp.period;
  const wrap = h('div', { cls: 'helm-horizon-detail' });
  wrap.appendChild(h('div', { cls: 'helm-detail-title' },
    h('h2', { text: p.label }),
    hp.isCurrent ? chip('current', 'scheduled') : null,
    h('span', { cls: 'helm-spacer' }),
    button('Open note', { icon: 'file-text', onClick: () => openPeriodNote(ctx, p) }),
    button('Bind a project…', { icon: 'link', onClick: () => pickProject(ctx, (pr) => void ctx.run('Bind', () => ctx.mutations.setProjectFields(pr.id, { period: p.key })), { includeInactive: false }) }),
    button('New project here', { icon: 'folder-plus', onClick: () => openProjectForm(ctx, { period: p.key, onCreated: (c) => ctx.navigate('projects', { projectId: c.id }) }) }),
  ));

  // Goals.
  const goalsBody: HTMLElement[] = hp.goals.map((g) => goalRow(ctx, g, hp));
  const add = h('input', { cls: 'helm-quickadd-input', attr: { type: 'text', placeholder: `Add a goal for ${p.label}…` } });
  add.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && add.value.trim() !== '') { const v = add.value; add.value = ''; void ctx.run('Add goal', () => ctx.mutations.addGoal(p.key, v)); }
  });
  wrap.appendChild(section('Goals', { count: hp.goals.length, store: state.collapsed, key: `goals:${p.key}` }, ...goalsBody, h('div', { cls: 'helm-quickadd' }, icon('target'), add)));

  // Projects bound here (exact) and within.
  const rows = hp.projectsWithin.map((hh) => projectRow(ctx, hh, p, today));
  wrap.appendChild(section(p.kind === 'year' ? 'Projects this year' : `Projects in ${p.label}`, { count: hp.projectsWithin.length, store: state.collapsed, key: `projects:${p.key}` },
    rows.length === 0 ? empty('No project is bound to this period.', button('Bind a project…', { onClick: () => pickProject(ctx, (pr) => void ctx.run('Bind', () => ctx.mutations.setProjectFields(pr.id, { period: p.key }))) })) : null,
    ...rows,
  ));
  return wrap;
}

function goalRow(ctx: UiContext, g: HorizonGoal, hp: HorizonPeriod): HTMLElement {
  const goal = g.goal;
  const task = ctx.index.task(goal.key);
  const row = h('div', { cls: ['helm-goal', goal.status === 'done' && 'is-done'], onContextMenu: (ev) => { ev.preventDefault(); goalMenu(ctx, goal, ev); } });
  row.append(
    h('button', { cls: ['helm-check', `mark-${goal.status}`], title: goal.status === 'done' ? 'Reopen' : 'Mark achieved', onClick: (ev) => { ev.stopPropagation(); void ctx.run('Goal', () => ctx.mutations.setStatus(goal.key, goal.status === 'done' ? 'todo' : 'done')); } }, goal.status === 'done' ? icon('check') : null),
    h('div', { cls: 'helm-goal-main', onClick: () => { if (task) openTaskEditor(ctx, task); } },
      h('div', { cls: 'helm-goal-text' }, richText(goal.text)),
      h('div', { cls: 'helm-goal-progress' }, progressBar(g.progress, 'is-thin'), h('span', { cls: 'helm-hint', text: g.taskTotal > 0 ? `${g.taskDone}/${g.taskTotal} tasks · ${Math.round(g.progress * 100)}%` : goal.status === 'done' ? 'achieved' : 'no project linked yet' })),
      h('div', { cls: 'helm-task-meta' }, ...g.projects.map((hh) => { const c = chip(hh.project.title, 'project', `${hh.done}/${hh.total} done`); c.addEventListener('click', (ev) => { ev.stopPropagation(); ctx.navigate('projects', { projectId: hh.project.id }); }); return c; })),
    ),
    h('div', { cls: 'helm-task-actions' },
      iconButton('link', 'Link a project to this goal', (ev) => { ev.stopPropagation(); pickProject(ctx, (pr) => void ctx.run('Link', () => ctx.mutations.linkProjectToGoal(pr.id, goal.key))); }),
      iconButton('more-horizontal', 'More…', (ev) => { ev.stopPropagation(); goalMenu(ctx, goal, ev); }),
    ),
  );
  void hp;
  return row;
}

function goalMenu(ctx: UiContext, goal: Goal, ev: MouseEvent): void {
  const menu = new Menu();
  const task = ctx.index.task(goal.key);
  if (task) menu.addItem((i) => i.setTitle('Edit…').setIcon('pencil').onClick(() => openTaskEditor(ctx, task)));
  menu.addItem((i) => i.setTitle('Link a project…').setIcon('link').onClick(() => pickProject(ctx, (pr) => void ctx.run('Link', () => ctx.mutations.linkProjectToGoal(pr.id, goal.key)))));
  menu.addItem((i) => i.setTitle('New project for this goal…').setIcon('folder-plus').onClick(() => openProjectForm(ctx, { period: goal.periodKey, goalKey: goal.key, onCreated: (c) => ctx.navigate('projects', { projectId: c.id }) })));
  menu.addItem((i) => i.setTitle(goal.status === 'done' ? 'Reopen' : 'Mark achieved').setIcon('check-circle').onClick(() => void ctx.run('Goal', () => ctx.mutations.setStatus(goal.key, goal.status === 'done' ? 'todo' : 'done'))));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('Open in note').setIcon('file-text').onClick(() => void ctx.openFile(goal.path, goal.line)));
  menu.addItem((i) => i.setTitle('Delete goal').setIcon('trash').setWarning(true).onClick(() => { if (window.confirm(`Delete goal “${goal.text}”?`)) void ctx.run('Delete', () => ctx.mutations.deleteTask(goal.key)); }));
  menu.showAtMouseEvent(ev);
}

function projectRow(ctx: UiContext, hh: ProjectHealth, p: Period, today: string): HTMLElement {
  const pr = hh.project;
  const bound = pr.period ? parsePeriod(pr.period) : undefined;
  const goal = pr.goalId ? ctx.index.goal(pr.goalId) : undefined;
  return h('div', { cls: 'helm-project', onClick: () => ctx.navigate('projects', { projectId: pr.id }) },
    h('div', { cls: 'helm-project-head' },
      icon('folder'), h('span', { cls: 'helm-project-title', text: pr.title }),
      chip(pr.status, 'area'),
      bound && bound.key !== p.key ? chip(bound.label, 'scheduled', 'Bound to a period inside this one') : null,
      goal ? chip(`🎯 ${goal.text}`, 'phase', 'Serves this goal') : null,
      h('span', { cls: 'helm-spacer' }),
      pr.due ? chip(`due ${humanDate(pr.due, today)}`, pr.due < today && hh.open > 0 ? 'due is-overdue' : 'due') : null,
      h('span', { cls: 'helm-project-count', text: `${hh.done}/${hh.total}` }),
    ),
    progressBar(hh.progress, 'is-thin'),
    h('div', { cls: 'helm-project-foot' }, hh.nextAction ? h('span', { cls: 'helm-project-next' }, icon('arrow-right'), h('span', { text: hh.nextAction.text })) : null, h('span', { cls: 'helm-spacer' }), ...hh.flags.map((f) => chip(f.replace(/-/g, ' '), `flag flag-${f}`))),
  );
}

function openPeriodNote(ctx: UiContext, p: Period): void {
  void ctx.run('Open note', async () => { const path = await ctx.mutations.ensurePeriodicNote(p); await ctx.openFile(path); });
}

/** Period choices for pickers: this year and next, each with quarters and months. */
export function periodChoices(today: string): { key: string; label: string }[] {
  const y = Number(today.slice(0, 4));
  const out: { key: string; label: string }[] = [];
  for (const year of [y, y + 1]) {
    out.push({ key: String(year), label: `${year} (year)` });
    for (let q = 1; q <= 4; q++) out.push({ key: `${year}-Q${q}`, label: `  Q${q} ${year}` });
    for (let m = 1; m <= 12; m++) { const p = periodOf(`${year}-${String(m).padStart(2, '0')}-01`, 'month'); out.push({ key: p.key, label: `    ${p.label}` }); }
  }
  return out;
}

export function projectPeriodLabel(project: Project): string | undefined {
  return project.period ? parsePeriod(project.period)?.label : undefined;
}
