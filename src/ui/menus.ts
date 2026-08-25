/** Context menus and pickers built on Obsidian's Menu / SuggestModal. */
import { FuzzySuggestModal, Menu } from 'obsidian';
import type { IsoDate, Project, Task, TaskStatus } from '../core/types';
import { addDays, humanDate, startOfWeek } from '../core/dates';
import type { UiContext } from './context';
import { openDatePicker } from './modals/datePicker';
import { openTaskEditor } from './modals/taskEditor';
import { PRIORITY_ORDER } from '../core/taskLine';

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

export function addScheduleItems(menu: Menu, ctx: UiContext, task: Task): void {
  const today = ctx.today();
  for (const o of scheduleOptions(today, ctx.settings().weekStartsOn)) {
    menu.addItem((i) => i.setTitle(o.label).setIcon(o.icon).onClick(() => {
      if ((o.date as unknown) === 'pick') {
        openDatePicker(ctx, { title: `Schedule “${task.text}”`, initial: task.scheduled ?? task.noteDate ?? today }, (d) => void ctx.run('Schedule', () => ctx.mutations.schedule(task.key, d)));
        return;
      }
      void ctx.run(o.date ? 'Schedule' : 'Unschedule', () => ctx.mutations.schedule(task.key, o.date));
    }));
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

export function taskMenu(ctx: UiContext, task: Task, ev: MouseEvent, opts: { onEdit?: () => void } = {}): void {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle('Edit…').setIcon('pencil').onClick(() => opts.onEdit ? opts.onEdit() : openTaskEditor(ctx, task)));
  menu.addSeparator();
  addScheduleItems(menu, ctx, task);
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
  menu.addItem((i) => i.setTitle('Move to project…').setIcon('folder-input').onClick(() => pickProject(ctx, (p, phaseId) => void ctx.run('Move', () => ctx.mutations.moveToProject(task.key, p.id, phaseId)), { phases: true })));
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

export function pickProject(ctx: UiContext, onPick: (p: Project, phaseId?: string) => void, opts: { phases?: boolean; includeInactive?: boolean } = {}): void {
  const projects = ctx.index.allProjects().filter((p) => opts.includeInactive || !['done', 'cancelled', 'archived'].includes(p.status)).sort((a, b) => a.title.localeCompare(b.title));
  const items: { project: Project; phaseId?: string; label: string }[] = [];
  for (const p of projects) {
    items.push({ project: p, label: p.title });
    if (opts.phases) for (const ph of p.phases) items.push({ project: p, phaseId: ph.id, label: `${p.title} › ${ph.title}` });
  }
  new ProjectPicker(ctx, items, onPick).open();
}
