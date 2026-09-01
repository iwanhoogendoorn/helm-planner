/** One task line as a row: checkbox, text, chips, quick actions. */
import type { Task } from '../core/types';
import { humanDate, minutesToHuman } from '../core/dates';
import { formatRecurrence } from '../core/recurrence';
import { chip, h, icon, iconButton, richText } from './dom';
import type { UiContext } from './context';
import { progressMenu, taskMenu } from './menus';
import { openTaskEditor } from './modals/taskEditor';
import { followsOf, followUpsOf, isBlocked, isOpen } from '../data/planner';
import { drawingsIndicator } from './drawings';
import { notesIndicator } from './notes';
import { linksIndicator } from './links';
import { linksIn, textWithoutLinks } from '../core/links';
import { plainLabel, shortLabel } from '../core/label';
import { taskLabel } from './context';
import { selection, selectionClick, selectionMenu, setDragKeys } from './selection';

export interface RowOptions {
  showProject?: boolean;
  /** Name the task this row is a step of — context when a subtask is shown on a day of its own. */
  showParent?: boolean;
  showDate?: 'scheduled' | 'due' | 'both' | 'none';
  showChildren?: boolean;
  depth?: number;
  draggable?: boolean;
  /** Hide the checkbox (e.g. for a summary row). */
  compact?: boolean;
  /** Replaces the default schedule quick action. */
  quickAction?: { icon: string; title: string; onClick: (t: Task) => void };
  extraActions?: { icon: string; title: string; onClick: (t: Task, ev: MouseEvent) => void }[];
  /** Highlight state. */
  reason?: string;
}

const PRIORITY_LABEL: Record<string, string> = { highest: '!!!', high: '!!', medium: '!', low: '↓', lowest: '↓↓' };

export function taskRow(ctx: UiContext, t: Task, opts: RowOptions = {}): HTMLElement {
  const today = ctx.today();
  const snap = ctx.index.snapshot;
  const open = isOpen(t);
  const blocked = open && isBlocked(t, snap);
  const overdue = open && t.due !== undefined && t.due < today;
  const row = h('div', {
    cls: ['helm-task', `is-${t.status}`, !open && 'is-closed', blocked && 'is-blocked', overdue && 'is-overdue', selection.has(t.key) && 'is-selected', opts.depth ? `depth-${Math.min(opts.depth, 4)}` : ''],
    attr: { 'data-key': t.key, 'data-path': t.path, 'data-line': t.line },
    draggable: opts.draggable ?? false,
    onContextMenu: (ev) => { ev.preventDefault(); if (selection.size() > 1 && selection.has(t.key)) selectionMenu(ctx, ev); else taskMenu(ctx, t, ev); },
  });
  if (opts.draggable) {
    row.addEventListener('dragstart', (ev) => {
      setDragKeys(ev, t.key);                                  // a picked row brings the rest of the selection
      ev.dataTransfer?.setData('text/plain', t.text);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
      row.classList.add('is-dragging');
    });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
  }
  // A subtask dropped on one of its siblings takes that place in the list. Dropping it on its parent
  // sends it to the end. Anything else falls through to the day or project underneath.
  if (t.parentKey) {
    const siblingDrag = (ev: DragEvent): string | undefined => {
      const key = ev.dataTransfer?.getData('text/helm-task') || undefined;
      if (!key || key === t.key) return undefined;
      const dragged = ctx.index.task(key);
      return dragged && dragged.parentKey === t.parentKey && dragged.path === t.path ? key : undefined;
    };
    row.addEventListener('dragover', (ev) => {
      if (!ev.dataTransfer?.types.includes('text/helm-task')) return;
      ev.preventDefault();
      ev.stopPropagation();
      row.classList.add('is-reordering');
    });
    row.addEventListener('dragleave', (ev) => { if (!row.contains(ev.relatedTarget as Node | null)) row.classList.remove('is-reordering'); });
    row.addEventListener('drop', (ev) => {
      row.classList.remove('is-reordering');
      const key = siblingDrag(ev);
      if (!key) return;                                        // not a sibling: let the drop zone below have it
      ev.preventDefault();
      ev.stopPropagation();
      void ctx.run('Reorder', () => ctx.mutations.reorderSubtask(key, t.key));
    });
  }

  // Checkbox: click toggles done; shift-click cycles to in-progress.
  if (!opts.compact) {
    const cb = h('button', {
      cls: ['helm-check', `mark-${markerClass(t.status)}`],
      title: open ? 'Mark done (shift-click: in progress)' : 'Reopen',
      attr: { 'aria-label': 'Toggle done', 'data-status': t.status },
      onClick: (ev) => {
        ev.stopPropagation();
        const next = ev.shiftKey ? (t.status === 'doing' ? 'todo' : 'doing') : open ? 'done' : 'todo';
        void ctx.run('Status', () => ctx.mutations.setStatus(t.key, next));
      },
      onContextMenu: (ev) => { ev.preventDefault(); ev.stopPropagation(); progressMenu(ctx, t, ev); },
    }, t.status === 'done' ? icon('check') : t.status === 'cancelled' ? icon('x')
      : t.status === 'doing' ? h('span', { cls: 'helm-check-half', style: t.progress !== undefined ? { height: `${t.progress}%` } : {} })   // the box fills as you go
      : t.status === 'waiting' ? icon('clock') : t.status === 'forwarded' ? icon('arrow-right') : null);
    row.appendChild(cb);
  }

  const main = h('div', { cls: 'helm-task-main', onClick: (ev) => {
    if ((ev.target as HTMLElement).closest('a')) return;
    if (selectionClick(ctx, ev, row, t.key)) return;           // cmd-click picks, shift-click takes a run
    openTaskEditor(ctx, t);
  } });
  const line1 = h('div', { cls: 'helm-task-line' });
  if (t.time) line1.appendChild(h('span', { cls: 'helm-time', text: t.time.end ? `${t.time.start}–${t.time.end}` : t.time.start }));
  if (t.priority !== 'normal') line1.appendChild(h('span', { cls: ['helm-prio', `prio-${t.priority}`], text: PRIORITY_LABEL[t.priority] ?? '', title: `Priority: ${t.priority}` }));
  const shown = textWithoutLinks(taskLabel(t));
  line1.appendChild(h('span', { cls: 'helm-task-text' }, richText(shown === '' ? taskLabel(t) : shown, (target) => ctx.openLink(target, t.path))));
  main.appendChild(line1);

  const meta = h('div', { cls: 'helm-task-meta' });
  if (opts.reason) meta.appendChild(chip(opts.reason, `reason reason-${opts.reason.replace(/\s+/g, '-')}`));
  if (opts.showProject !== false && (t.projectTitle || t.mirrorLink)) {
    const title = t.projectTitle ?? t.mirrorLink!.replace(/^\[\[|\]\]$/g, '').split('|').pop()!;
    const c = chip(title, 'project', t.phaseTitle ? `${title} › ${t.phaseTitle}` : title);
    c.addEventListener('click', (ev) => { ev.stopPropagation(); if (t.projectId) ctx.navigate('projects', { projectId: t.projectId }); else ctx.openLink(title, t.path); });
    meta.appendChild(c);
    if (t.phaseTitle) meta.appendChild(chip(t.phaseTitle, 'phase'));
  } else if (opts.showProject !== false && t.origin === 'note') {
    const name = t.path.slice(t.path.lastIndexOf('/') + 1).replace(/\.md$/, '');
    const c = chip(name, 'note', t.path);
    c.addEventListener('click', (ev) => { ev.stopPropagation(); void ctx.openFile(t.path, t.line); });
    meta.appendChild(c);
  } else if (opts.showProject !== false && t.origin === 'inbox') meta.appendChild(chip('Inbox', 'inbox'));
  const showDate = opts.showDate ?? 'both';
  if ((showDate === 'due' || showDate === 'both') && t.due) meta.appendChild(chip(`due ${humanDate(t.due, today)}`, overdue ? 'due is-overdue' : 'due', t.due));
  if ((showDate === 'scheduled' || showDate === 'both') && t.scheduled && t.origin !== 'daily') meta.appendChild(chip(humanDate(t.scheduled, today), 'scheduled', `Planned for ${t.scheduled}`));
  // A subtask can be planned for a day of its own while staying in its task's list.
  else if (t.depth > 0 && t.scheduled && t.scheduled !== t.noteDate) meta.appendChild(chip(`→ ${humanDate(t.scheduled, today)}`, 'scheduled', `This step is planned for ${t.scheduled}; its task stays where it is`));
  if (t.origin === 'daily' && t.noteDate && t.due && t.due > t.noteDate && open) meta.appendChild(chip(`in ${humanDate(t.noteDate, today)}'s note`, 'note', 'Dated later than the note it sits in — Helm moves it to the right note'));
  if (t.effortMinutes !== undefined) meta.appendChild(chip(minutesToHuman(t.effortMinutes), 'effort'));
  if (t.progress !== undefined && open) meta.appendChild(chip(`${t.progress}%`, 'progress', `${t.progress}% of the way — right-click the box to change it`));
  if (t.recurrence) meta.appendChild(chip(formatRecurrence(t.recurrence), 'recurrence', t.recurrence.parsed ? '' : 'Unrecognised rule'));
  // Links live in the line but are shown as pills, like notes and drawings.
  for (const l of linksIn(t.text)) meta.appendChild(h('a', { cls: 'helm-chip link', title: l.url, attr: { href: l.url, target: '_blank', rel: 'noopener' }, onClick: (ev) => ev.stopPropagation() }, h('span', { cls: 'helm-chip-label', text: l.label })));
  if (opts.showParent && t.parentKey) {
    const parent = snap.tasks.get(t.parentKey);
    if (parent) meta.appendChild(h('button', {
      cls: 'helm-chip subtask-of',
      title: `Part of “${plainLabel(parent.text)}”${parent.noteDate ? ` on ${parent.noteDate}` : ''} — click to open`,
      onClick: (ev) => { ev.stopPropagation(); void ctx.openFile(parent.path, parent.line); },
    }, icon('corner-down-right'), h('span', { cls: 'helm-chip-label', text: `part of ${shortLabel(parent.text, 40)}` })));
  }
  const follows = followsOf(snap, t);
  if (follows) meta.appendChild(h('button', { cls: 'helm-chip followup', title: `Continues “${plainLabel(follows.text)}” — click to open`, onClick: (ev) => { ev.stopPropagation(); void ctx.openFile(follows.path, follows.line); } }, icon('corner-down-right'), h('span', { cls: 'helm-chip-label', text: `follows: ${shortLabel(follows.text)}${isOpen(follows) ? ' (open)' : ''}` })));
  else if (blocked) meta.appendChild(chip('blocked', 'blocked', `Waiting on ${t.blockedBy.join(', ')}`));
  const ups = followUpsOf(snap, t);
  for (const u of ups.slice(0, 2)) meta.appendChild(h('button', { cls: ['helm-chip', 'followup', !isOpen(u) && 'is-done'], title: `Follow-up: ${plainLabel(u.text)}`, onClick: (ev) => { ev.stopPropagation(); void ctx.openFile(u.path, u.line); } }, icon('corner-down-right'), h('span', { text: `→ ${u.scheduled ?? u.noteDate ? humanDate((u.scheduled ?? u.noteDate)!, today) : 'unplanned'}` })));
  if (t.status === 'waiting') meta.appendChild(chip('waiting', 'waiting'));
  if (t.childKeys.length > 0) {
    const kids = t.childKeys.map((k) => snap.tasks.get(k)).filter((x): x is Task => x !== undefined);
    const done = kids.filter((k) => !isOpen(k)).length;
    meta.appendChild(chip(`${done}/${kids.length}`, 'subtasks', 'Subtasks'));
  }
  if (t.done) {
    // “Today” only means something when the line still sits on the day it was finished. Once it has
    // travelled — a subtask carried along when its task moved on — say the date it actually happened.
    const onItsDay = (t.noteDate ?? t.scheduled) === t.done;
    meta.appendChild(chip(`✓ ${humanDate(t.done, onItsDay ? today : undefined, onItsDay ? {} : { year: t.done.slice(0, 4) !== today.slice(0, 4) })}`, 'done-date', `Finished on ${t.done}`));
  }
  // A cancelled line says so in words — and when it repeats, that it was this one occurrence that went.
  if (t.status === 'cancelled') {
    meta.appendChild(chip(
      `${t.recurrence?.parsed ? 'skipped' : 'cancelled'}${t.cancelled ? ` ${humanDate(t.cancelled, today)}` : ''}`,
      'cancelled',
      t.recurrence?.parsed ? 'This occurrence was skipped; the next one still comes' : 'Cancelled',
    ));
  }
  if (meta.childElementCount > 0) main.appendChild(meta);
  // How far along, as a bar: a number is easy to miss in a long list.
  if (t.progress !== undefined && open) main.appendChild(h('div', { cls: 'helm-task-progress', title: `${t.progress}%` }, h('span', { style: { width: `${t.progress}%` } })));
  row.appendChild(main);

  const actions = h('div', { cls: 'helm-task-actions' });
  const nt = notesIndicator(ctx, t);
  if (nt) actions.appendChild(nt);
  const dr = drawingsIndicator(ctx, t);
  if (dr) actions.appendChild(dr);
  const lk = linksIndicator(ctx, t);
  if (lk) actions.appendChild(lk);
  if (opts.quickAction) actions.appendChild(iconButton(opts.quickAction.icon, opts.quickAction.title, (ev) => { ev.stopPropagation(); opts.quickAction!.onClick(t); }));
  else if (open) actions.appendChild(iconButton('calendar', 'Schedule…', (ev) => { ev.stopPropagation(); taskMenu(ctx, t, ev); }));
  for (const a of opts.extraActions ?? []) actions.appendChild(iconButton(a.icon, a.title, (ev) => { ev.stopPropagation(); a.onClick(t, ev); }));
  actions.appendChild(iconButton('more-horizontal', 'More…', (ev) => { ev.stopPropagation(); taskMenu(ctx, t, ev); }));
  row.appendChild(actions);

  if (opts.showChildren && t.childKeys.length > 0) {
    const kids = h('div', { cls: 'helm-task-children' });
    for (const k of t.childKeys) {
      const c = snap.tasks.get(k);
      if (c) kids.appendChild(taskRow(ctx, c, { ...opts, draggable: true, depth: (opts.depth ?? 0) + 1, showProject: false, reason: undefined as unknown as string }));
    }
    // Below the last one: drop here to send a subtask to the end of the list.
    kids.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-task')) { ev.preventDefault(); } });
    kids.addEventListener('drop', (ev) => {
      const key = ev.dataTransfer?.getData('text/helm-task');
      const dragged = key ? ctx.index.task(key) : undefined;
      if (!dragged || dragged.parentKey !== t.key) return;
      ev.preventDefault();
      ev.stopPropagation();
      void ctx.run('Reorder', () => ctx.mutations.reorderSubtask(dragged.key));
    });
    const wrap = h('div', { cls: 'helm-task-tree' }, row, kids);
    return wrap;
  }
  return row;
}

function markerClass(s: Task['status']): string {
  return s;
}

export function taskList(ctx: UiContext, tasks: Task[], opts: RowOptions = {}): HTMLElement {
  const list = h('div', { cls: 'helm-tasklist' });
  for (const t of tasks) list.appendChild(taskRow(ctx, t, opts));
  return list;
}
