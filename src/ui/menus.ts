/** Context menus and pickers built on Obsidian's Menu / SuggestModal. */
import { FuzzySuggestModal, Menu } from 'obsidian';
import type { IsoDate, Project, Task, TaskStatus } from '../core/types';
import { addDays, humanDate, startOfWeek } from '../core/dates';
import type { UiContext } from './context';
import { addDrawingItems, targetForTask } from './drawings';
import { addNoteItems } from './notes';
import { addLinkItems } from './links';
import { openFollowUp } from './modals/followUp';
import { openSubtask } from './modals/subtask';
import { openProjectForm } from './modals/projectForm';
import { plainLabel } from '../core/label';
import { isOpen } from '../data/planner';
import { baseName } from '../data/vault';
import { openDatePicker } from './modals/datePicker';
import { openTaskEditor } from './modals/taskEditor';
import { PRIORITY_ORDER } from '../core/taskLine';
import { DAY_PARTS, PART_LABEL, type DayPart } from '../core/dailyNote';

export function scheduleOptions(today: IsoDate, weekStartsOn: 1 | 7): { label: string; date: IsoDate | undefined; icon: string }[] {
  const nextWeek = addDays(startOfWeek(today, weekStartsOn), 7);
  return [
    { label: 'Today', date: today, icon: 'sun' },
    { label: 'Tomorrow', date: addDays(today, 1), icon: 'sunrise' },
    { label: `Next week (${humanDate(nextWeek)})`, date: nextWeek, icon: 'calendar' },
    { label: 'Pick a date…', date: 'pick' as unknown as IsoDate, icon: 'calendar-days' },
    { label: 'Unschedule', date: undefined, icon: 'calendar-x' },
  ];
}

/**
 * Dates to move a task to. Each day opens onto the parts of the day, so “tomorrow morning” is one
 * hover away; the first entry keeps whatever part the task already has.
 */
export function addScheduleItems(menu: Menu, ctx: UiContext, task: Task): void {
  const today = ctx.today();
  const move = (date: IsoDate | undefined, part?: DayPart): void => void ctx.run(date ? 'Schedule' : 'Unschedule', () => ctx.mutations.schedule(task.key, date, part));
  const partIcon = (p: DayPart): string => (p === 'morning' ? 'sunrise' : p === 'afternoon' ? 'sun' : p === 'evening' ? 'moon' : 'clock');
  for (const o of scheduleOptions(today, ctx.settings().weekStartsOn)) {
    if ((o.date as unknown) === 'pick') {
      menu.addItem((i) => i.setTitle(o.label).setIcon(o.icon).onClick(() => openDatePicker(ctx, { title: `Schedule “${task.text}”`, initial: task.scheduled ?? task.noteDate ?? today, parts: true }, (d, part) => move(d, part))));
      continue;
    }
    if (o.date === undefined) { menu.addItem((i) => i.setTitle(o.label).setIcon(o.icon).onClick(() => move(undefined))); continue; }
    const date = o.date;
    menu.addItem((i) => {
      i.setTitle(o.label).setIcon(o.icon);
      const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
      sub.addItem((j) => j.setTitle(task.part && task.part !== 'anytime' ? `Keep the ${task.part}` : 'Just move it').setIcon('check').onClick(() => move(date)));
      sub.addSeparator();
      for (const p of DAY_PARTS) sub.addItem((j) => j.setTitle(PART_LABEL[p]).setIcon(partIcon(p)).setChecked(task.part === p).onClick(() => move(date, p)));
    });
  }
}

export const STATUS_LABELS: Record<TaskStatus, { label: string; icon: string }> = {
  todo: { label: 'To do', icon: 'circle' },
  doing: { label: 'In progress', icon: 'circle-dot' },
  waiting: { label: 'Waiting on someone', icon: 'clock' },
  forwarded: { label: 'Forwarded', icon: 'arrow-right' },
  done: { label: 'Done', icon: 'check-circle' },
  cancelled: { label: 'Cancelled', icon: 'x-circle' },
};

export const PROGRESS_STEPS = [0, 10, 25, 50, 75, 90, 100];

/** Fill a menu with the percentages; 100 finishes the task, 0 takes the percentage off. */
export function addProgressItems(menu: Menu, ctx: UiContext, task: Task): void {
  for (const pct of PROGRESS_STEPS) {
    menu.addItem((i) => i
      .setTitle(pct === 0 ? 'No percentage' : pct === 100 ? '100% — done' : `${pct}%`)
      .setIcon(pct === 100 ? 'check' : 'trending-up')
      .setChecked(task.progress === pct || (pct === 0 && task.progress === undefined))
      .onClick(() => void ctx.run('Progress', () => ctx.mutations.setProgress(task.key, pct === 0 ? undefined : pct))));
  }
}

/** Right-clicking the checkbox: how far along is this? */
export function progressMenu(ctx: UiContext, task: Task, ev: MouseEvent): void {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(task.progress !== undefined ? `${task.progress}% done` : 'How far along?').setIcon('trending-up').setDisabled(true));
  addProgressItems(menu, ctx, task);
  menu.showAtMouseEvent(ev);
}

export function taskMenu(ctx: UiContext, task: Task, ev: MouseEvent, opts: { onEdit?: () => void } = {}): void {
  const menu = new Menu();
  const today = ctx.today();
  menu.addItem((i) => i.setTitle('Edit…').setIcon('pencil').onClick(() => opts.onEdit ? opts.onEdit() : openTaskEditor(ctx, task)));
  menu.addItem((i) => i.setTitle('Add subtask…').setIcon('list-plus').onClick(() => openSubtask(ctx, task)));
  menu.addItem((i) => { i.setTitle(task.progress !== undefined ? `Progress — ${task.progress}%` : 'Progress').setIcon('trending-up'); const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu(); addProgressItems(sub, ctx, task); });
  const hasSubtasks = task.childKeys.length > 0;
  menu.addItem((i) => hasSubtasks
    ? i.setTitle('Follow up… — move it instead (it has subtasks)').setIcon('corner-down-right').setDisabled(true)
    : i.setTitle('Follow up…').setIcon('corner-down-right').onClick(() => openFollowUp(ctx, task)));
  menu.addSeparator();
  addScheduleItems(menu, ctx, task);
  const onADay = task.noteDate !== undefined || task.scheduled !== undefined;
  if (onADay && !task.parentKey) {   // a subtask sits where its task sits
    // This moves the task *within the day it is already on* — it never changes the date. Say which day
    // that is, or “Afternoon” reads as “this afternoon” and looks like it will drag the task back to today.
    const its = task.scheduled ?? task.noteDate!;
    const dayName = humanDate(its, today);
    menu.addItem((i) => {
      i.setTitle(`Part of ${dayName}`).setIcon('sun');
      const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
      for (const p of DAY_PARTS) sub.addItem((j) => j.setTitle(`${PART_LABEL[p]} of ${dayName}`).setIcon(p === 'morning' ? 'sunrise' : p === 'afternoon' ? 'sun' : p === 'evening' ? 'moon' : 'clock').setChecked(task.part === p).onClick(() => void ctx.run('Part', () => ctx.mutations.setPart(task.key, p))));
    });
  }
  menu.addSeparator();
  menu.addItem((i) => {
    i.setTitle('Status').setIcon('list-checks');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    for (const s of Object.keys(STATUS_LABELS) as TaskStatus[]) {
      sub.addItem((j) => j.setTitle(STATUS_LABELS[s].label).setIcon(STATUS_LABELS[s].icon).setChecked(task.status === s).onClick(() => void ctx.run('Status', () => ctx.mutations.setStatus(task.key, s))));
    }
  });
  menu.addItem((i) => {
    i.setTitle('Priority').setIcon('flag');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    for (const p of PRIORITY_ORDER) {
      sub.addItem((j) => j.setTitle(p.charAt(0).toUpperCase() + p.slice(1)).setChecked(task.priority === p).onClick(() => void ctx.run('Priority', () => ctx.mutations.updateTask(task.key, { priority: p }))));
    }
  });
  menu.addItem((i) => {
    i.setTitle('Notes').setIcon('sticky-note');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    addNoteItems(sub, ctx, targetForTask(task));
  });
  menu.addItem((i) => {
    i.setTitle('Drawings').setIcon('pen-tool');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    addDrawingItems(sub, ctx, targetForTask(task));
  });
  menu.addItem((i) => {
    i.setTitle('Links').setIcon('link');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    addLinkItems(sub, ctx, task);
  });
  addProjectItems(menu, ctx, task);
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('Open in note').setIcon('file-text').onClick(() => void ctx.openFile(task.path, task.line)));
  if (task.origin === 'daily-mirror' && task.mirrorOf) {
    const src = ctx.index.task(task.mirrorOf);
    if (src) menu.addItem((i) => i.setTitle('Open source task').setIcon('file-symlink').onClick(() => void ctx.openFile(src.path, src.line)));
  }
  menu.addItem((i) => i.setTitle('Delete').setIcon('trash').setWarning(true).onClick(() => {
    if (window.confirm(`Delete “${task.text}”${task.childKeys.length ? ` and ${task.childKeys.length} subtask(s)` : ''}?`)) void ctx.run('Delete', () => ctx.mutations.deleteTask(task.key));
  }));
  menu.showAtMouseEvent(ev);
}

class ProjectPicker extends FuzzySuggestModal<{ project: Project; phaseId?: string; label: string }> {
  constructor(ctx: UiContext, private items: { project: Project; phaseId?: string; label: string }[], private onPick: (p: Project, phaseId?: string) => void) {
    super(ctx.app);
    this.setPlaceholder('Project or phase…');
  }
  getItems(): { project: Project; phaseId?: string; label: string }[] { return this.items; }
  getItemText(item: { label: string }): string { return item.label; }
  onChooseItem(item: { project: Project; phaseId?: string }): void { this.onPick(item.project, item.phaseId); }
}

/** Pick any task in the vault. `exclude` keeps the ones already spoken for out of the list. */
class TaskPicker extends FuzzySuggestModal<Task> {
  constructor(ctx: UiContext, private items: Task[], private onPick: (t: Task) => void) { super(ctx.app); this.setPlaceholder('Task to link…'); }
  getItems(): Task[] { return this.items; }
  getItemText(t: Task): string { return `${plainLabel(t.text)}  ·  ${t.projectTitle ?? baseName(t.path)}${isOpen(t) ? '' : '  ·  done'}`; }
  onChooseItem(t: Task): void { this.onPick(t); }
}

export function pickTask(ctx: UiContext, onPick: (t: Task) => void, opts: { exclude?: (t: Task) => boolean } = {}): void {
  const items = [...ctx.index.snapshot.tasks.values()]
    .filter((t) => t.origin !== 'daily-mirror' && t.text.trim() !== '' && !(opts.exclude?.(t) ?? false))
    .sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || plainLabel(a.text).localeCompare(plainLabel(b.text)));
  if (items.length === 0) { ctx.notify('No tasks left to link.'); return; }
  new TaskPicker(ctx, items, onPick).open();
}

/**
 * What a task can do with a project, in one place so the menu, the editor, the inbox and the commands
 * all offer the same three things under the same names: move it in, make one from it, or point one at
 * it without moving it.
 */
export function addProjectItems(menu: Menu, ctx: UiContext, task: Task, opts: { before?: () => void } = {}): void {
  const go = (fn: () => void): void => { opts.before?.(); fn(); };
  menu.addItem((i) => i.setTitle('Move to project…').setIcon('folder-input').onClick(() => go(() => pickProject(ctx, (p, phaseId) => void ctx.run('Move', () => ctx.mutations.moveToProject(task.key, p.id, phaseId)), { phases: true }))));
  if (task.origin !== 'project' && task.origin !== 'daily-mirror') {
    menu.addItem((i) => i.setTitle('Make a project from this…').setIcon('folder-plus').onClick(() => go(() => openProjectForm(ctx, { title: plainLabel(task.text), fromTask: task, onCreated: (p) => ctx.navigate('projects', { projectId: p.id }) }))));
  }
  menu.addItem((i) => i.setTitle('Link to a project…').setIcon('link').onClick(() => go(() => pickProject(ctx, (p) => void ctx.run('Link', () => ctx.mutations.linkTaskToProject(p.id, task.key))))));
}

/** The same three, as a menu at the pointer. */
export function projectMenuForTask(ctx: UiContext, task: Task, ev: MouseEvent, opts: { before?: () => void } = {}): void {
  const menu = new Menu();
  addProjectItems(menu, ctx, task, opts);
  menu.showAtMouseEvent(ev);
}

export function pickProject(ctx: UiContext, onPick: (p: Project, phaseId?: string) => void, opts: { phases?: boolean; includeInactive?: boolean } = {}): void {
  const projects = ctx.index.allProjects().filter((p) => opts.includeInactive || !['done', 'cancelled', 'archived'].includes(p.status)).sort((a, b) => a.title.localeCompare(b.title));
  const items: { project: Project; phaseId?: string; label: string }[] = [];
  for (const p of projects) {
    items.push({ project: p, label: p.title });
    if (opts.phases) for (const ph of p.phases) items.push({ project: p, phaseId: ph.id, label: `${p.title} › ${ph.title}` });
  }
  new ProjectPicker(ctx, items, onPick).open();
}
