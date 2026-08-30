/** Portfolio list → project detail with phases, tasks and inline add. */
import { Menu } from 'obsidian';
import type { IsoDate, Project, ProjectPriority, ProjectStatus, Task } from '../../core/types';
import { addDays, humanDate, relativeDays, startOfWeek } from '../../core/dates';
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '../../core/project';
import { compareProjects, isOpen, projectHealth, type ProjectHealth } from '../../data/planner';
import { parseCapture } from '../../core/nlp';
import { button, chip, empty, h, icon, iconButton, progressBar, richText, section } from '../dom';
import type { UiContext } from '../context';
import { askText, wikilinkSuggest } from '../fields';
import { taskRow } from '../taskRow';
import { openProjectForm } from '../modals/projectForm';
import { openCapture } from '../modals/capture';
import { openDatePicker } from '../modals/datePicker';
import { minutesToHuman } from '../../core/dates';
import { periodChoices, projectPeriodLabel } from './horizons';
import { crumbBar } from '../crumbs';
import { drawingsButton, drawingsSection, targetForProject } from '../drawings';
import { notesButton, notesSection } from '../notes';
import { linksSection, linksButton, type LinkHolder } from '../links';
import { pickTask, taskMenu, STATUS_LABELS } from '../menus';
import { openTaskEditor } from '../modals/taskEditor';
import { plainLabel } from '../../core/label';

export type ProjectView = 'list' | 'board' | 'table' | 'timeline';

export interface ProjectsState { projectId?: string; view?: ProjectView; filter: string; showClosed: boolean; collapsed: Map<string, boolean>; showDone: boolean }

const STATUS_LABEL: Record<ProjectStatus, string> = { active: 'Active', planned: 'Planned', 'on-hold': 'On hold', idea: 'Ideas', done: 'Done', cancelled: 'Cancelled', archived: 'Archived' };
const FLAG_LABEL: Record<ProjectHealth['flags'][number], string> = { 'no-next-action': 'no next action', stale: 'stale', overdue: 'overdue tasks', 'due-soon': 'due soon', 'past-due': 'past due', blocked: 'blocked' };

export function renderProjects(ctx: UiContext, root: HTMLElement, state: ProjectsState): void {
  if (state.projectId) {
    const p = ctx.index.project(state.projectId);
    if (p) { renderDetail(ctx, root, p, state); return; }
    state.projectId = undefined;
  }
  renderList(ctx, root, state);
}

function renderList(ctx: UiContext, root: HTMLElement, state: ProjectsState): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const all = ctx.index.allProjects().map((p) => projectHealth(snap, p, today, settings)).sort(compareProjects);
  const filter = h('input', { attr: { type: 'search', placeholder: 'Filter projects…', value: state.filter }, onInput: (ev) => { state.filter = (ev.target as HTMLInputElement).value; ctx.refresh(); } });
  const q = state.filter.trim().toLowerCase();
  const visible = all.filter((hh) => !q || `${hh.project.title} ${hh.project.area ?? ''} ${hh.project.tags.join(' ')}`.toLowerCase().includes(q));
  root.appendChild(crumbBar(ctx, 'projects', []));
  root.appendChild(h('div', { cls: 'helm-toolbar' },
    filter,
    h('label', { cls: 'helm-toggle' }, h('input', { attr: { type: 'checkbox', checked: state.showClosed }, onChange: (ev) => { state.showClosed = (ev.target as HTMLInputElement).checked; ctx.refresh(); } }), h('span', { text: 'Show closed' })),
    h('span', { cls: 'helm-spacer' }),
    button('New project', { icon: 'folder-plus', primary: true, onClick: () => openProjectForm(ctx, { onCreated: (p) => ctx.navigate('projects', { projectId: p.id }) }) }),
  ));
  if (all.length === 0) {
    root.appendChild(empty(`No projects found under “${settings.projectsFolder}”. A project is a note with “type: project” in its frontmatter.`, button('Create your first project', { primary: true, onClick: () => openProjectForm(ctx) })));
    return;
  }
  const byId = new Map(visible.map((hh) => [hh.project.id, hh]));
  const groups: ProjectStatus[] = ['active', 'planned', 'on-hold', 'idea', ...(state.showClosed ? (['done', 'cancelled', 'archived'] as ProjectStatus[]) : [])];
  for (const st of groups) {
    const roots = visible.filter((hh) => hh.project.status === st && (!hh.project.parentId || !byId.has(hh.project.parentId) || byId.get(hh.project.parentId)!.project.status !== st));
    if (roots.length === 0) continue;
    const rows: HTMLElement[] = [];
    // Reordering happens among the top-level projects of a group; a sub-project sits with its parent.
    const siblings = roots.map((r) => r.project.id);
    const walk = (hh: ProjectHealth, depth: number): void => {
      rows.push(projectCard(ctx, hh, depth, today, depth === 0 ? siblings : []));
      for (const cid of hh.project.childIds) { const c = byId.get(cid); if (c && c.project.status === st) walk(c, depth + 1); }
    };
    for (const r of roots) walk(r, 0);
    root.appendChild(section(STATUS_LABEL[st], { count: rows.length, store: state.collapsed, key: `status:${st}`, collapsed: st === 'idea' || st === 'done' || st === 'cancelled' || st === 'archived' }, ...rows));
  }
}

/** Drag a project onto another to put it there; the whole group is renumbered so the order sticks. */
function makeProjectDraggable(ctx: UiContext, card: HTMLElement, id: string, siblings: string[]): void {
  card.setAttribute('draggable', 'true');
  card.addEventListener('dragstart', (ev) => { ev.dataTransfer?.setData('text/helm-project', id); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; card.addClass('is-dragging'); ev.stopPropagation(); });
  card.addEventListener('dragend', () => card.removeClass('is-dragging'));
  card.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-project')) { ev.preventDefault(); card.addClass('is-dropping'); } });
  card.addEventListener('dragleave', () => card.removeClass('is-dropping'));
  card.addEventListener('drop', (ev) => {
    ev.preventDefault(); ev.stopPropagation();
    card.removeClass('is-dropping');
    const moved = ev.dataTransfer?.getData('text/helm-project');
    if (!moved || moved === id) return;
    const next = siblings.filter((x) => x !== moved);
    next.splice(Math.max(0, next.indexOf(id)), 0, moved);
    void ctx.run('Reorder', () => ctx.mutations.setProjectOrder(next));
  });
}

function projectCard(ctx: UiContext, hh: ProjectHealth, depth: number, today: IsoDate, siblings: string[] = []): HTMLElement {
  const p = hh.project;
  const card = h('div', { cls: ['helm-project', `depth-${Math.min(depth, 3)}`, p.pinned && 'is-pinned', hh.flags.length > 0 && 'has-flags'], onClick: () => ctx.navigate('projects', { projectId: p.id }), onContextMenu: (ev) => { ev.preventDefault(); projectMenu(ctx, p, ev, { siblings }); } });
  if (siblings.length > 1) makeProjectDraggable(ctx, card, p.id, siblings);
  card.append(
    h('div', { cls: 'helm-project-head' },
      icon(p.childIds.length > 0 ? 'folder-tree' : 'folder'),
      p.pinned ? icon('pin', 'helm-project-pin') : null,
      h('span', { cls: 'helm-project-title', text: p.title }),
      p.priority !== 'normal' ? chip(p.priority, `prio prio-${p.priority}`) : null,
      p.area ? chip(p.area, 'area') : null,
      p.period ? chip(projectPeriodLabel(p) ?? p.period, 'scheduled', 'Horizon') : null,
      h('span', { cls: 'helm-spacer' }),
      p.due ? chip(`due ${humanDate(p.due, today)}`, p.due < today && hh.open > 0 ? 'due is-overdue' : 'due') : null,
      h('span', { cls: 'helm-project-count', text: `${hh.done}/${hh.total}` }),
    ),
    progressBar(hh.progress, 'is-thin'),
    h('div', { cls: 'helm-project-foot' },
      hh.nextAction ? h('span', { cls: 'helm-project-next' }, icon('arrow-right'), h('span', { cls: 'helm-task-text' }, richText(hh.nextAction.text, (t) => ctx.openLink(t, hh.nextAction!.path)))) : h('span', { cls: 'helm-hint', text: hh.open === 0 && hh.total > 0 ? 'All tasks done' : hh.flags.includes('no-next-action') ? 'No next action' : p.childIds.length > 0 ? `${p.childIds.length} sub-project${p.childIds.length === 1 ? '' : 's'}` : '' }),
      h('span', { cls: 'helm-spacer' }),
      ...hh.flags.map((f) => chip(FLAG_LABEL[f], `flag flag-${f}`)),
      hh.lastTouched ? h('span', { cls: 'helm-hint', text: relativeDays(hh.lastTouched, today), title: `Last activity ${hh.lastTouched}` }) : null,
    ),
  );
  return card;
}

function projectMenu(ctx: UiContext, p: Project, ev: MouseEvent, opts: { siblings?: string[] } = {}): void {
  const menu = new Menu();
  menu.addItem((i) => { i.setTitle('Status').setIcon('activity'); const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu(); for (const s of PROJECT_STATUSES) sub.addItem((j) => j.setTitle(STATUS_LABEL[s]).setChecked(p.status === s).onClick(() => void ctx.run('Status', () => ctx.mutations.setProjectFields(p.id, { status: s })))); });
  menu.addItem((i) => { i.setTitle('Priority').setIcon('flag'); const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu(); for (const s of PROJECT_PRIORITIES) sub.addItem((j) => j.setTitle(s).setChecked(p.priority === s).onClick(() => void ctx.run('Priority', () => ctx.mutations.setProjectFields(p.id, { priority: s })))); });
  menu.addItem((i) => i.setTitle('Set due date…').setIcon('calendar').onClick(() => openDatePicker(ctx, { title: `Due date for ${p.title}`, initial: p.due, allowClear: true }, (d) => void ctx.run('Due', () => ctx.mutations.setProjectFields(p.id, { due: d ?? null })))));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle(p.pinned ? 'Unpin' : 'Pin to the top').setIcon('pin').onClick(() => void ctx.run('Pin', () => ctx.mutations.setProjectPinned(p.id, !p.pinned))));
  if (opts.siblings && opts.siblings.length > 1) {
    const at = opts.siblings.indexOf(p.id);
    if (at > 0) menu.addItem((i) => i.setTitle('Move up').setIcon('arrow-up').onClick(() => void ctx.run('Reorder', () => ctx.mutations.moveProjectBy(p.id, -1, opts.siblings!))));
    if (at < opts.siblings.length - 1) menu.addItem((i) => i.setTitle('Move down').setIcon('arrow-down').onClick(() => void ctx.run('Reorder', () => ctx.mutations.moveProjectBy(p.id, 1, opts.siblings!))));
  }
  menu.addItem((i) => i.setTitle('New sub-project…').setIcon('folder-plus').onClick(() => openProjectForm(ctx, { parentId: p.id, onCreated: (c) => ctx.navigate('projects', { projectId: c.id }) })));
  menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => void ctx.openFile(p.path)));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('Archive project').setIcon('archive').onClick(() => {
    if (window.confirm(`Move “${p.title}”${p.childIds.length ? ` and its ${p.childIds.length} sub-project(s)` : ''} to ${ctx.settings().archiveFolder}?`)) void ctx.run('Archive', async () => { const dest = await ctx.mutations.archiveProject(p.id); ctx.notify(`Archived to ${dest}`); ctx.navigate('projects'); });
  }));
  menu.addItem((i) => i.setTitle('Delete project…').setIcon('trash').setWarning(true).onClick(() => {
    if (window.confirm(`Move “${p.title}”${p.folderNote ? ' (its whole folder)' : ''} to the trash? Obsidian keeps it in .trash, so this can be undone from the file system.`)) void ctx.run('Delete', async () => { await ctx.mutations.deleteProject(p.id); ctx.notify(`Deleted “${p.title}”.`); ctx.navigate('projects'); });
  }));
  menu.showAtMouseEvent(ev);
}

function renderDetail(ctx: UiContext, root: HTMLElement, p: Project, state: ProjectsState): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const hh = projectHealth(snap, p, today, settings);
  const parent = p.parentId ? ctx.index.project(p.parentId) : undefined;

  const statusSel = h('select', { cls: 'helm-select-inline', onChange: (ev) => void ctx.run('Status', () => ctx.mutations.setProjectFields(p.id, { status: (ev.target as HTMLSelectElement).value as ProjectStatus })) });
  for (const s of PROJECT_STATUSES) statusSel.appendChild(h('option', { text: STATUS_LABEL[s], attr: { value: s, selected: p.status === s } }));
  const prioSel = h('select', { cls: 'helm-select-inline', onChange: (ev) => void ctx.run('Priority', () => ctx.mutations.setProjectFields(p.id, { priority: (ev.target as HTMLSelectElement).value as ProjectPriority })) });
  for (const s of PROJECT_PRIORITIES) prioSel.appendChild(h('option', { text: s, attr: { value: s, selected: p.priority === s } }));

  const periodSel = h('select', { cls: 'helm-select-inline', title: 'Horizon: the year, quarter or month this project is bound to', onChange: (ev) => void ctx.run('Period', () => ctx.mutations.setProjectFields(p.id, { period: (ev.target as HTMLSelectElement).value || null })) });
  periodSel.appendChild(h('option', { text: 'no horizon', attr: { value: '' } }));
  const choices = periodChoices(today);
  if (p.period && !choices.some((c) => c.key === p.period)) choices.unshift({ key: p.period, label: projectPeriodLabel(p) ?? p.period });
  for (const c of choices) periodSel.appendChild(h('option', { text: c.label.trim(), attr: { value: c.key, selected: p.period === c.key } }));
  const goalSel = h('select', { cls: 'helm-select-inline', title: 'Goal this project serves', onChange: (ev) => void ctx.run('Goal', () => ctx.mutations.linkProjectToGoal(p.id, (ev.target as HTMLSelectElement).value || null)) });
  goalSel.appendChild(h('option', { text: 'no goal', attr: { value: '' } }));
  const goals = ctx.index.allGoals().sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.line - b.line);
  for (const g of goals) goalSel.appendChild(h('option', { text: `${g.periodKey} · ${g.text}`, attr: { value: g.key, selected: p.goalId === g.key } }));
  if (goals.length === 0) goalSel.disabled = true;

  const chain: Project[] = [];
  for (let cur: Project | undefined = parent, guard = 0; cur && guard < 10; cur = cur.parentId ? ctx.index.project(cur.parentId) : undefined, guard++) chain.unshift(cur);
  root.appendChild(h('div', { cls: 'helm-detail-head' },
    crumbBar(ctx, 'projects', [
      ...chain.map((c) => ({ label: c.title, onClick: () => ctx.navigate('projects', { projectId: c.id }), title: c.path })),
      { label: p.title, active: true, title: p.path },
    ]),
    h('div', { cls: 'helm-detail-title' },
      h('h2', { text: p.title }),
      h('span', { cls: 'helm-spacer' }),
      button('Open note', { icon: 'file-text', onClick: () => void ctx.openFile(p.path) }),
      notesButton(ctx, targetForProject(p.id, p.title)),
      drawingsButton(ctx, targetForProject(p.id, p.title)),
      linksButton(ctx, projectLinks(ctx, p)),
      button('', { icon: 'more-horizontal', title: 'More', onClick: (ev) => projectMenu(ctx, p, ev) }),
    ),
    h('div', { cls: 'helm-detail-meta' },
      statusSel, prioSel,
      p.area ? chip(p.area, 'area') : null,
      button(p.due ? `due ${humanDate(p.due, today)}` : 'no due date', { icon: 'calendar', cls: 'helm-btn-quiet', onClick: () => openDatePicker(ctx, { title: 'Due date', initial: p.due, allowClear: true }, (d) => void ctx.run('Due', () => ctx.mutations.setProjectFields(p.id, { due: d ?? null }))) }),
      h('span', { cls: 'helm-horizon-controls' }, icon('mountain'), periodSel, goalSel, p.period ? button('', { icon: 'external-link', title: 'Open in Horizons', cls: 'helm-btn-quiet', onClick: () => ctx.navigate('horizons', { periodKey: p.period! }) }) : null),
      h('span', { cls: 'helm-spacer' }),
      ...hh.flags.map((f) => chip(FLAG_LABEL[f], `flag flag-${f}`)),
      hh.lastTouched ? h('span', { cls: 'helm-hint', text: `last activity ${relativeDays(hh.lastTouched, today)}` }) : null,
    ),
    h('div', { cls: 'helm-detail-progress' }, progressBar(hh.progress), h('span', { cls: 'helm-hint', text: `${hh.done} of ${hh.total} done · ${hh.open} open${hh.overdue ? ` · ${hh.overdue} overdue` : ''}` })),
  ));

  if (p.childIds.length > 0) {
  root.appendChild(section('Sub-projects', { count: p.childIds.length, store: state.collapsed, key: 'children' },
      ...p.childIds.map((cid) => ctx.index.project(cid)).filter((c): c is Project => c !== undefined).map((c) => projectCard(ctx, projectHealth(snap, c, today, settings), 0, today))));
  }

  const toolbar = h('div', { cls: 'helm-toolbar' },
    h('label', { cls: 'helm-toggle' }, h('input', { attr: { type: 'checkbox', checked: state.showDone }, onChange: (ev) => { state.showDone = (ev.target as HTMLInputElement).checked; ctx.refresh(); } }), h('span', { text: 'Show done' })),
    h('span', { cls: 'helm-spacer' }),
    button('Add phase', { icon: 'milestone', onClick: () => addPhasePrompt(ctx, p) }),
    button('Add task', { icon: 'plus', onClick: () => openCapture(ctx, { projectId: p.id }) }),
    // The mirror of the task side: bring an existing task in, with its notes, drawings and links.
    button('Move a task in…', { icon: 'folder-input', cls: 'helm-btn-quiet', title: 'Take a task from somewhere else and make it this project’s work', onClick: () => pickTask(ctx, (t) => void ctx.run('Move', () => ctx.mutations.moveToProject(t.key, p.id)), { exclude: (t) => t.projectId === p.id }) }),
  );
  root.appendChild(toolbar);

  const renderTasks = (keys: string[]): HTMLElement[] => {
    const tasks = keys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined);
    const roots = tasks.filter((t) => !t.parentKey || !keys.includes(t.parentKey));
    const shown = state.showDone ? roots : roots.filter((t) => isOpen(t) || t.childKeys.some((k) => { const c = snap.tasks.get(k); return c && isOpen(c); }));
    return shown.map((t) => taskRow(ctx, t, { showProject: false, showChildren: true, showDate: 'both', draggable: true }));
  };

  const view: ProjectView = state.view ?? 'list';
  const VIEWS: [ProjectView, string, string][] = [['list', 'List', 'list'], ['board', 'Board', 'columns-3'], ['table', 'Table', 'table'], ['timeline', 'Timeline', 'gantt-chart']];
  root.appendChild(h('div', { cls: 'helm-toolbar helm-project-views' },
    h('span', { cls: 'helm-segmented' }, ...VIEWS.map(([id, label, ic]) => h('button', {
      cls: ['helm-seg', view === id && 'is-active'], title: `${label} view`,
      onClick: () => { state.view = id; ctx.refresh(); },
    }, icon(ic), h('span', { text: label })))),
  ));

  if (view !== 'list') {
    if (view === 'board') renderBoard(ctx, root, p, hh, state, today);
    if (view === 'table') renderTable(ctx, root, p, hh, today);
    if (view === 'timeline') renderTimeline(ctx, root, p, hh, today);
    return;
  }

  for (const pp of hh.phaseProgress) {
    const ph = pp.phase;
    const input = quickAdd(ctx, `Add to ${ph.title}…`, (text) => addQuick(ctx, text, p.id, ph.id));
    root.appendChild(section(ph.title, {
      count: `${pp.done}/${pp.total}`, store: state.collapsed, key: `phase:${ph.id}`, collapsed: pp.state === 'done', cls: `phase-${pp.state}`,
      actions: [ph.due ? chip(`target ${humanDate(ph.due, today)}`, ph.due < today && pp.state !== 'done' ? 'due is-overdue' : 'due') : null, iconButton('pencil', 'Rename phase / target date', () => renamePhasePrompt(ctx, p, ph.id, ph.title, ph.due)), iconButton('trash-2', 'Delete this phase', () => deletePhasePrompt(ctx, p, ph.id, ph.title, pp.total))],
    }, ...renderTasks(ph.taskKeys), input));
  }
  const looseInput = quickAdd(ctx, p.phases.length ? 'Add a loose task…' : 'Add a task…', (text) => addQuick(ctx, text, p.id));
  const loose = renderTasks(p.looseTaskKeys);
  root.appendChild(section(p.phases.length ? 'Other tasks' : 'Tasks', { count: p.looseTaskKeys.filter((k) => { const t = snap.tasks.get(k); return t && isOpen(t); }).length, store: state.collapsed, key: 'loose' }, ...loose, looseInput));

  // Planned effort remaining.
  const openTasks = [...p.phases.flatMap((ph) => ph.taskKeys), ...p.looseTaskKeys].map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined && isOpen(t) && t.childKeys.length === 0);
  const est = openTasks.reduce((s, t) => s + (t.effortMinutes ?? 0), 0);
  const withEst = openTasks.filter((t) => t.effortMinutes !== undefined).length;
  root.appendChild(h('div', { cls: 'helm-hint helm-detail-foot', text: withEst > 0 ? `Remaining estimated effort: ${minutesToHuman(est)} across ${withEst} of ${openTasks.length} open tasks.` : '' }));

  const log = quickAdd(ctx, 'Log a note to this project…', (text) => void ctx.run('Log', () => ctx.mutations.appendLog(p.id, text)), 'message-square-plus');
  root.appendChild(h('div', { cls: 'helm-detail-log' }, log));
  const drawTarget = targetForProject(p.id, p.title);
  root.appendChild(section('Notes', { count: ctx.index.notesFor(drawTarget).length, store: state.collapsed, key: 'notes', collapsed: ctx.index.notesFor(drawTarget).length === 0 }, notesSection(ctx, drawTarget)));
  // Tasks the project points at without owning them: live rows, and they stay out of its counts.
  const related = p.relatedTaskIds.map((id) => ({ id, task: ctx.index.taskById(id) }));
  root.appendChild(section('Related tasks', {
    count: related.length, store: state.collapsed, key: 'related', collapsed: related.length === 0,
    actions: [button('Link a task…', { icon: 'link', cls: 'helm-btn-quiet', onClick: () => pickTask(ctx, (t) => void ctx.run('Link task', () => ctx.mutations.linkTaskToProject(p.id, t.key)), { exclude: (t) => (t.id !== undefined && p.relatedTaskIds.includes(t.id)) || (t.origin === 'project' && t.projectId === p.id) }) })],
  },
    ...related.map(({ id, task }) => task
      ? taskRow(ctx, task, { showDate: 'due', showProject: true, extraActions: [{ icon: 'unlink', title: 'Stop pointing at this task', onClick: () => void ctx.run('Unlink', () => ctx.mutations.unlinkTaskFromProject(p.id, id)) }] })
      : h('div', { cls: 'helm-attach-row' }, h('span', { cls: 'helm-hint', text: `${id} — no longer in the vault` }), h('span', { cls: 'helm-spacer' }), iconButton('unlink', 'Take it off the list', () => void ctx.run('Unlink', () => ctx.mutations.unlinkTaskFromProject(p.id, id))))),
    related.length === 0 ? h('div', { cls: 'helm-hint', text: 'Tasks listed here live somewhere else — a daily note, another project — and are not counted as this project’s work.' }) : null,
  ));
  root.appendChild(section('Links', { count: p.links.length, store: state.collapsed, key: 'links', collapsed: p.links.length === 0 }, linksSection(ctx, projectLinks(ctx, p))));
  root.appendChild(section('Diagrams', { count: ctx.index.drawingsFor(drawTarget).length, store: state.collapsed, key: 'drawings', collapsed: ctx.index.drawingsFor(drawTarget).length === 0 }, drawingsSection(ctx, drawTarget)));
}

/** A project's links: the list in its note, and the ways to change it. */
function projectLinks(ctx: UiContext, p: Project): LinkHolder {
  return {
    list: () => p.links.map((l) => ({ ...l, raw: `[${l.label}](${l.url})` })),
    add: (url, label) => void ctx.run('Add link', () => ctx.mutations.addProjectLink(p.id, url, label)),
    remove: (url) => void ctx.run('Remove link', () => ctx.mutations.removeProjectLink(p.id, url)),
  };
}

/* ── Other ways to look at a project ─────────────────────────────────── */

/** The task lists a project view works from: one per phase, then whatever is loose. */
function projectColumns(ctx: UiContext, p: Project, hh: ProjectHealth): { id: string | undefined; title: string; keys: string[]; due?: IsoDate }[] {
  void ctx;
  return [
    ...hh.phaseProgress.map((pp) => ({ id: pp.phase.id, title: pp.phase.title, keys: pp.phase.taskKeys, ...(pp.phase.due ? { due: pp.phase.due } : {}) })),
    { id: undefined, title: p.phases.length ? 'Other tasks' : 'Tasks', keys: p.looseTaskKeys },
  ];
}

/** Kanban: a column per phase, drag a card to move the task into that phase. */
function renderBoard(ctx: UiContext, root: HTMLElement, p: Project, hh: ProjectHealth, state: ProjectsState, today: IsoDate): void {
  const snap = ctx.index.snapshot;
  const board = h('div', { cls: 'helm-board' });
  for (const col of projectColumns(ctx, p, hh)) {
    const tasks = col.keys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined && (state.showDone || isOpen(t)));
    const cards = h('div', { cls: 'helm-board-cards' });
    for (const t of tasks) {
      const card = h('div', { cls: ['helm-board-card', !isOpen(t) && 'is-done'], attr: { draggable: 'true' }, onClick: () => openTaskEditor(ctx, t), onContextMenu: (ev) => { ev.preventDefault(); taskMenu(ctx, t, ev); } },
        h('div', { cls: 'helm-board-card-text' }, richText(plainLabel(t.text) || t.text, (target) => ctx.openLink(target, t.path))),
        h('div', { cls: 'helm-task-meta' },
          t.due ? chip(`due ${humanDate(t.due, today)}`, t.due < today && isOpen(t) ? 'due is-overdue' : 'due') : null,
          t.effortMinutes !== undefined ? chip(minutesToHuman(t.effortMinutes), 'effort') : null,
          !isOpen(t) ? chip(t.status, 'done-count') : null,
        ),
      );
      card.addEventListener('dragstart', (ev) => { ev.dataTransfer?.setData('text/helm-task', t.key); card.addClass('is-dragging'); });
      card.addEventListener('dragend', () => card.removeClass('is-dragging'));
      cards.appendChild(card);
    }
    const column = h('div', { cls: 'helm-board-col' },
      h('div', { cls: 'helm-board-head' },
        h('span', { cls: 'helm-board-title', text: col.title }),
        h('span', { cls: 'helm-badge-count', text: String(tasks.length) }),
        col.due ? chip(`target ${humanDate(col.due, today)}`, col.due < today ? 'due is-overdue' : 'due') : null,
      ),
      cards,
      quickAdd(ctx, 'Add…', (text) => addQuick(ctx, text, p.id, col.id)),
    );
    column.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-task')) { ev.preventDefault(); column.addClass('is-dropping'); } });
    column.addEventListener('dragleave', () => column.removeClass('is-dropping'));
    column.addEventListener('drop', (ev) => {
      ev.preventDefault();
      column.removeClass('is-dropping');
      const key = ev.dataTransfer?.getData('text/helm-task');
      if (key) void ctx.run('Move', () => ctx.mutations.moveToProject(key, p.id, col.id));
    });
    board.appendChild(column);
  }
  root.appendChild(board);
}

/** Every task in one table, sortable by any column. */
function renderTable(ctx: UiContext, root: HTMLElement, p: Project, hh: ProjectHealth, today: IsoDate): void {
  const snap = ctx.index.snapshot;
  const rows = projectColumns(ctx, p, hh).flatMap((col) => col.keys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined).map((t) => ({ t, phase: col.id ? col.title : '—' })));
  const table = h('table', { cls: 'helm-table helm-project-table' });
  const head = h('tr', {}, ...['Task', 'Phase', 'Status', 'Due', 'Effort'].map((label) => h('th', { text: label })));
  const body = h('tbody', {});
  const draw = (): void => {
    body.replaceChildren(...rows.map(({ t, phase }) => h('tr', { cls: ['is-clickable', !isOpen(t) && 'is-closed'], onClick: () => openTaskEditor(ctx, t), onContextMenu: (ev) => { ev.preventDefault(); taskMenu(ctx, t, ev); } },
      h('td', {}, richText(plainLabel(t.text) || t.text, (target) => ctx.openLink(target, t.path))),
      h('td', { text: phase }),
      h('td', { text: STATUS_LABELS[t.status]?.label ?? t.status }),
      h('td', { cls: t.due && t.due < today && isOpen(t) ? 'is-bad' : '', text: t.due ? humanDate(t.due, today) : '—' }),
      h('td', { text: t.effortMinutes !== undefined ? minutesToHuman(t.effortMinutes) : '—' }),
    )));
  };
  const keys: ((x: { t: Task; phase: string }) => string)[] = [
    (x) => plainLabel(x.t.text).toLowerCase(), (x) => x.phase.toLowerCase(), (x) => x.t.status,
    (x) => x.t.due ?? '9999', (x) => String(x.t.effortMinutes ?? 99999).padStart(6, '0'),
  ];
  let sorted = -1;
  head.querySelectorAll('th').forEach((th, i) => {
    th.addClass('is-clickable');
    th.addEventListener('click', () => {
      const key = keys[i]!;
      const dir = sorted === i ? -1 : 1;
      sorted = sorted === i ? -1 : i;
      rows.sort((a, b) => key(a).localeCompare(key(b)) * dir);
      draw();
    });
  });
  draw();
  table.append(h('thead', {}, head), body);
  root.appendChild(rows.length === 0 ? empty('No tasks in this project yet.') : h('div', { cls: 'helm-table-wrap' }, table));
}

/** Phases across the weeks they run through, by the dates their tasks carry. */
function renderTimeline(ctx: UiContext, root: HTMLElement, p: Project, hh: ProjectHealth, today: IsoDate): void {
  const snap = ctx.index.snapshot;
  const weekStart = ctx.settings().weekStartsOn;
  const cols = projectColumns(ctx, p, hh).map((col) => {
    const dates = col.keys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined)
      .flatMap((t) => [t.due, t.scheduled, t.start].filter((d): d is IsoDate => d !== undefined));
    if (col.due) dates.push(col.due);
    return { ...col, from: dates.length ? dates.slice().sort()[0]! : undefined, to: dates.length ? dates.slice().sort().at(-1)! : undefined };
  });
  const dated = cols.filter((c) => c.from !== undefined);
  if (dated.length === 0) { root.appendChild(empty('Nothing here carries a date yet, so there is no timeline to draw. Give a task or a phase a due date and it will appear.')); return; }
  const first = startOfWeek(dated.map((c) => c.from!).sort()[0]!, weekStart);
  const last = startOfWeek(dated.map((c) => c.to!).sort().at(-1)!, weekStart);
  const weeks: IsoDate[] = [];
  for (let d = first; d <= last && weeks.length < 60; d = addDays(d, 7)) weeks.push(d);
  const thisWeek = startOfWeek(today, weekStart);
  const table = h('table', { cls: 'helm-table helm-timeline' },
    h('thead', {}, h('tr', {}, h('th', { cls: 'helm-timeline-name', text: 'Phase' }), ...weeks.map((w) => h('th', { cls: ['helm-timeline-week', w === thisWeek && 'is-now'], text: humanDate(w).replace(/^\w+ /, ''), title: `Week of ${humanDate(w, today, { year: true })}` })))),
    h('tbody', {}, ...cols.map((c) => h('tr', {},
      h('td', { cls: 'helm-timeline-name', text: c.title }),
      ...weeks.map((w) => {
        const end = addDays(w, 6);
        const inRun = c.from !== undefined && c.to !== undefined && c.from <= end && c.to >= w;
        const n = c.keys.map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined && [t.due, t.scheduled].some((d) => d !== undefined && d >= w && d <= end)).length;
        return h('td', { cls: ['helm-timeline-cell', inRun && 'is-run', w === thisWeek && 'is-now'], title: inRun ? `${c.title}: week of ${humanDate(w, today, { year: true })}${n ? ` — ${n} task(s)` : ''}` : '' }, n > 0 ? h('span', { cls: 'helm-timeline-count', text: String(n) }) : null);
      }),
    ))),
  );
  root.appendChild(h('div', { cls: 'helm-table-wrap' }, table));
  root.appendChild(h('div', { cls: 'helm-hint', text: 'A bar runs from the earliest to the latest date in that phase; a number is how many of its tasks fall in that week.' }));
}

function quickAdd(ctx: UiContext, placeholder: string, onSubmit: (text: string) => void, iconName = 'plus'): HTMLElement {
  const input = h('input', { cls: 'helm-quickadd-input', attr: { type: 'text', placeholder } });
  wikilinkSuggest(ctx, input);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && input.value.trim() !== '') { const v = input.value; input.value = ''; onSubmit(v); }
    if (ev.key === 'Escape') input.blur();
  });
  void ctx;
  return h('div', { cls: 'helm-quickadd' }, icon(iconName), input);
}

function addQuick(ctx: UiContext, text: string, projectId: string, phaseId?: string): void {
  const c = parseCapture(text, ctx.today(), ctx.settings().weekStartsOn);
  void ctx.run('Add task', () => ctx.mutations.addTask({
    text: c.text, projectId, ...(phaseId ? { phaseId } : {}), ...(c.scheduled ? { date: c.scheduled } : {}),
    fields: { priority: c.priority, ...(c.due ? { due: c.due } : {}), ...(c.effortMinutes ? { effortMinutes: c.effortMinutes, effortRaw: minutesToHuman(c.effortMinutes) } : {}), ...(c.time ? { time: c.time } : {}), ...(c.recurrence ? { recurrence: c.recurrence } : {}) },
  }));
}

const PHASE_HINT = 'Add 📅 2026-09-30 at the end to give the phase a target date.';

function addPhasePrompt(ctx: UiContext, p: Project): void {
  askText(ctx, { title: `New phase in ${p.title}`, label: 'Phase name', placeholder: 'e.g. Research', hint: PHASE_HINT, cta: 'Add phase', onDone: (v) => {
    if (!v) return;
    const m = /^(.*?)(?:\s*📅\s*(\d{4}-\d{2}-\d{2}))?\s*$/.exec(v.trim())!;
    void ctx.run('Add phase', () => ctx.mutations.addPhase(p.id, m[1]!.trim(), m[2]));
  } });
}

function deletePhasePrompt(ctx: UiContext, p: Project, phaseId: string, title: string, tasks: number): void {
  const what = tasks === 0 ? 'It holds nothing.' : `Its ${tasks} task${tasks === 1 ? '' : 's'} move to the project’s own list — nothing is deleted.`;
  if (!window.confirm(`Remove the phase “${title}” from ${p.title}?\n\n${what}`)) return;
  void ctx.run('Delete phase', () => ctx.mutations.deletePhase(p.id, phaseId));
}

function renamePhasePrompt(ctx: UiContext, p: Project, phaseId: string, title: string, due?: IsoDate): void {
  askText(ctx, { title: 'Rename phase', label: 'Phase name', value: `${title}${due ? ` 📅 ${due}` : ''}`, hint: `${PHASE_HINT} Leave the date out to clear it.`, onDone: (v) => {
    if (!v) return;
    const m = /^(.*?)(?:\s*📅\s*(\d{4}-\d{2}-\d{2}))?\s*$/.exec(v.trim())!;
    void ctx.run('Rename phase', () => ctx.mutations.renamePhase(p.id, phaseId, m[1]!.trim(), m[2] ?? null));
  } });
}
