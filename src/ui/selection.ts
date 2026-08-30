/**
 * Picking out several tasks so one action moves them all.
 *
 * Cmd/Ctrl-click a row to add it to the selection, Shift-click to take everything between. What is
 * picked lives here rather than in a view, so it survives a re-render and works the same in the day,
 * the calendar, the inbox, a project and the search. A bulk action runs the ordinary single-task
 * mutations one after another — a selection is a shortcut, never a second code path.
 */
import { Menu } from 'obsidian';
import type { DayPart } from '../core/dailyNote';
import { DAY_PARTS, PART_LABEL } from '../core/dailyNote';
import type { IsoDate, Task } from '../core/types';
import { humanDate } from '../core/dates';
import { button, h, icon } from './dom';
import type { UiContext } from './context';
import { openDatePicker } from './modals/datePicker';
import { pickProject } from './menus';

const picked = new Set<string>();
let anchor: string | undefined;

export const selection = {
  keys: (): string[] => [...picked],
  size: (): number => picked.size,
  has: (key: string): boolean => picked.has(key),
  clear: (): void => { picked.clear(); anchor = undefined; },
  /** Add or remove one row; it becomes the anchor a later Shift-click reaches from. */
  toggle: (key: string): void => {
    if (picked.has(key)) picked.delete(key);
    else picked.add(key);
    anchor = key;
  },
  /** Everything between the anchor and this row, in the order they are on screen. */
  range: (key: string, onScreen: string[]): void => {
    const to = onScreen.indexOf(key);
    const from = anchor ? onScreen.indexOf(anchor) : -1;
    if (to < 0 || from < 0) { selection.toggle(key); return; }
    for (let i = Math.min(from, to); i <= Math.max(from, to); i++) picked.add(onScreen[i]!);
  },
  /** Drop keys that no longer exist — after a move, a key that was a path and line has changed. */
  prune: (exists: (key: string) => boolean): void => { for (const k of [...picked]) if (!exists(k)) picked.delete(k); },
};

export const DRAG_ONE = 'text/helm-task';
export const DRAG_MANY = 'text/helm-tasks';

/** Put the dragged key on the event — and the whole selection with it, when the row is part of one. */
export function setDragKeys(ev: DragEvent, key: string): void {
  ev.dataTransfer?.setData(DRAG_ONE, key);
  if (picked.has(key) && picked.size > 1) ev.dataTransfer?.setData(DRAG_MANY, selection.keys().join('\n'));
}

/** What a drop is carrying: the selection when one was dragged, otherwise the single row. */
export function dragKeys(ev: DragEvent): string[] {
  const many = ev.dataTransfer?.getData(DRAG_MANY);
  if (many) return many.split('\n').filter(Boolean);
  const one = ev.dataTransfer?.getData(DRAG_ONE);
  return one ? [one] : [];
}

/** The keys of every task row on screen, top to bottom — what a Shift-click walks along. */
function rowsOnScreen(from: HTMLElement): string[] {
  const scope = from.closest('.helm-body') ?? from.ownerDocument.body;
  return [...scope.querySelectorAll<HTMLElement>('.helm-task[data-key]')].map((el) => el.dataset['key']!).filter(Boolean);
}

/**
 * Handle a click on a row for the selection. Returns true when the click was about picking, so the
 * caller leaves it at that instead of opening the task.
 */
export function selectionClick(ctx: UiContext, ev: MouseEvent, row: HTMLElement, key: string): boolean {
  if (ev.metaKey || ev.ctrlKey) { selection.toggle(key); ctx.refresh(); return true; }
  if (ev.shiftKey && selection.size() > 0) { selection.range(key, rowsOnScreen(row)); ctx.refresh(); return true; }
  // An ordinary click on a plain row clears a selection that is no longer being worked on.
  if (selection.size() > 0 && !selection.has(key)) { selection.clear(); ctx.refresh(); }
  return false;
}

/**
 * One action over every picked task, one after another.
 *
 * A key is only good until the file changes under it: it is the task's 🆔 when it has one, otherwise a
 * hash of the path, the text and which occurrence of that text this is — so moving the first task can
 * make a later key point at nothing, or at a namesake. Two subtasks worded the same in one list is all
 * it takes. So: every picked task is given a real id *before* anything is written, and each one is
 * looked up again by that id at the moment it is its turn. A task that has already travelled — because
 * it is a subtask of another picked task, and subtasks go with their parent — is left alone.
 */
function bulk(ctx: UiContext, label: string, each: (key: string, t: Task) => Promise<unknown>, describe?: (n: number) => string): void {
  // Where the picked tasks sit, by file and line. Writing an id does not move a line, so these stay
  // true through the pinning below — unlike the keys, which do not.
  const at = selection.keys()
    .map((k) => ctx.index.task(k))
    .filter((t): t is Task => t !== undefined)
    .map((t) => ({ path: t.path, line: t.line }));
  void ctx.run(label, async () => {
    const ids: string[] = [];
    for (const { path, line } of at) {
      const t = taskAt(ctx, path, line);
      if (t) ids.push(await ctx.mutations.ensureId(t.key));
    }
    const done = new Set<string>();
    let moved = 0;
    for (const id of ids) {
      if (done.has(id)) continue;
      const t = byId(ctx, id);
      if (!t) { done.add(id); continue; }
      // Its parent may have taken it along already; the parent's own move covers it.
      const parent = t.parentKey ? ctx.index.task(t.parentKey) : undefined;
      if (parent?.id && ids.includes(parent.id)) { done.add(id); continue; }
      await each(t.key, t);
      done.add(id);
      moved++;
      for (const k of descendants(ctx, t)) { const c = ctx.index.task(k); if (c?.id) done.add(c.id); }
    }
    selection.clear();
    // Say where they went: a bulk move is easy to aim wrong, and silence is how work goes missing.
    if (describe) ctx.notify(describe(moved));
  });
}

/**
 * The task with this id. A row in the day may be a project task's mirror, which `taskById` passes over
 * on purpose — but it is still a row you can pick, and scheduling it is meaningful, so fall back to it.
 */
function byId(ctx: UiContext, id: string): Task | undefined {
  const own = ctx.index.taskById(id);
  if (own) return own;
  for (const t of ctx.index.snapshot.tasks.values()) if (t.id === id) return t;
  return undefined;
}

/** The task on this line of this file, as the index has it now. */
function taskAt(ctx: UiContext, path: string, line: number): Task | undefined {
  for (const t of ctx.index.snapshot.tasks.values()) if (t.path === path && t.line === line && t.origin !== 'daily-mirror') return t;
  return undefined;
}

/** Every key beneath a task, however deep. */
function descendants(ctx: UiContext, t: Task): string[] {
  const out: string[] = [];
  const walk = (task: Task): void => {
    for (const k of task.childKeys) {
      out.push(k);
      const c = ctx.index.task(k);
      if (c) walk(c);
    }
  };
  walk(t);
  return out;
}

/** The things a selection can have done to it, in one place: the bar and the right-click menu agree. */
function actions(ctx: UiContext): { label: string; icon: string; run: (ev: MouseEvent) => void }[] {
  const n = selection.size();
  const tasks = (k: number): string => `${k} task${k === 1 ? '' : 's'}`;
  const move = (date: IsoDate | undefined, part?: DayPart): void =>
    bulk(ctx, date ? 'Schedule' : 'Unschedule', (key) => ctx.mutations.schedule(key, date, part),
      (k) => (date ? `${tasks(k)} → ${humanDate(date, ctx.today(), { year: true })}${part ? ` · ${PART_LABEL[part]}` : ''}` : `${tasks(k)} taken off the calendar`));
  return [
    { label: 'Plan for…', icon: 'calendar', run: () => openDatePicker(ctx, { title: `Plan ${tasks(n)}`, initial: ctx.today(), parts: true, allowClear: true }, (d, part) => move(d, part)) },
    { label: 'Part of the day', icon: 'sun', run: (ev) => {
      const menu = new Menu();
      for (const p of DAY_PARTS) menu.addItem((i) => i.setTitle(PART_LABEL[p]).setIcon(p === 'morning' ? 'sunrise' : p === 'afternoon' ? 'sun' : p === 'evening' ? 'moon' : 'clock').onClick(() => bulk(ctx, 'Part', (key) => ctx.mutations.setPart(key, p), (k) => `${tasks(k)} → ${PART_LABEL[p]}`)));
      menu.showAtMouseEvent(ev);
    } },
    { label: 'Move to project…', icon: 'folder-input', run: () => pickProject(ctx, (p, phaseId) => bulk(ctx, 'Move', (key) => ctx.mutations.moveToProject(key, p.id, phaseId), (k) => `${tasks(k)} → ${p.title}`), { phases: true }) },
    { label: 'Mark done', icon: 'check', run: () => bulk(ctx, 'Status', (key) => ctx.mutations.setStatus(key, 'done'), (k) => `${tasks(k)} marked done`) },
  ];
}

/** Right-clicking one of the picked rows acts on all of them. */
export function selectionMenu(ctx: UiContext, ev: MouseEvent): void {
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(`${selection.size()} tasks selected`).setIcon('check-square').setDisabled(true));
  for (const a of actions(ctx)) menu.addItem((i) => i.setTitle(a.label).setIcon(a.icon).onClick(() => a.run(ev)));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('Clear the selection').setIcon('x').onClick(() => { selection.clear(); ctx.refresh(); }));
  menu.showAtMouseEvent(ev);
}

/** The bar that appears while tasks are picked: what is selected, and what can be done to all of it. */
export function selectionBar(ctx: UiContext): HTMLElement | null {
  const n = selection.size();
  if (n === 0) return null;
  const acts = actions(ctx);
  const bar = h('div', { cls: 'helm-selection-bar' },
    icon('check-square'),
    h('span', { cls: 'helm-selection-count', text: `${n} selected` }),
    ...acts.map((a, i) => button(a.label, { icon: a.icon, primary: i === 0, onClick: (ev) => a.run(ev) })),
    h('span', { cls: 'helm-spacer' }),
    h('span', { cls: 'helm-hint', text: 'Cmd-click to pick · Shift-click for a run' }),
    button('Clear', { icon: 'x', onClick: () => { selection.clear(); ctx.refresh(); } }),
  );
  return bar;
}
