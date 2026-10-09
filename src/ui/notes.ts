/**
 * Notes UI: the twin of drawings — a button with a count, a menu that lists
 * the notes attached to a task / project / day / period (with a search once
 * there are many) and offers to make or link one, and the readable list for
 * detail pages and the manage popup (see attachList).
 */
import { FuzzySuggestModal, Menu, Modal } from 'obsidian';
import type { DrawingTarget, Task } from '../core/types';
import type { NoteRef } from '../core/noteRef';
import { humanDate } from '../core/dates';
import { button, h, iconButton } from './dom';
import { attachList, MENU_RECENT, MENU_SHOWN, searchAttached, wordCount, type AttachItem } from './attachList';
import { askNameAndLocation } from './fields';
import type { UiContext } from './context';
import { targetForTask } from './drawings';

const when = (n: NoteRef, today: string): string => (n.mtime ? humanDate(new Date(n.mtime).toISOString().slice(0, 10), today) : '');

export function newNote(ctx: UiContext, target: DrawingTarget): void {
  askNameAndLocation(ctx, {
    title: `New note for ${target.title}`,
    placeholder: target.kind === 'project' ? 'e.g. Decisions, Meeting 3 Sep' : 'e.g. research, notes from the call',
    defaultFolder: ctx.mutations.defaultFolderFor(target, 'note'),
    preview: (name, folder) => ctx.mutations.notePathFor(target, name, folder),
    onDone: (r) => { if (!r) return; void ctx.run('New note', async () => { const p = await ctx.mutations.createNote(target, r); await ctx.openFile(p); }); },
  });
}

type PickableNote = { path: string; title: string; kind?: string };

class NotePicker extends FuzzySuggestModal<PickableNote> {
  constructor(ctx: UiContext, private items: PickableNote[], private onPick: (n: PickableNote) => void) {
    super(ctx.app);
    this.setPlaceholder('Note to link…');
  }
  getItems(): PickableNote[] { return this.items; }
  getItemText(n: PickableNote): string { return `${n.title}  ·  ${n.kind ? `${n.kind}  ·  ` : ''}${n.path}`; }
  onChooseItem(n: PickableNote): void { this.onPick(n); }
}

/** Choose a linkable note that is not in `exclude`. */
export function pickNote(ctx: UiContext, exclude: Set<string>, onPick: (n: PickableNote) => void): void {
  const items = ctx.index.linkableNotes().filter((n) => !exclude.has(n.path));
  if (items.length === 0) { ctx.notify('No notes left to link.'); return; }
  const m = new NotePicker(ctx, items, onPick);
  m.open();
  ctx.trackModal(m);
}

export function linkExistingNote(ctx: UiContext, target: DrawingTarget): void {
  const attached = new Set(ctx.index.notesFor(target).map((n) => n.path));
  pickNote(ctx, attached, (n) => void ctx.run('Link note', async () => { await ctx.mutations.linkNote(target, n.path); ctx.notify(`Linked “${n.title}” to ${target.title}.`); }));
}

export function addNoteItems(menu: Menu, ctx: UiContext, target: DrawingTarget): void {
  const today = ctx.today();
  const list = ctx.index.notesFor(target);
  // Many notes: a search first, the most recent few, and the whole list one click away.
  const many = list.length > MENU_SHOWN;
  if (many) {
    menu.addItem((i) => i.setTitle(`Search ${list.length} notes…`).setIcon('search').onClick(() => searchAttached(ctx, list.map((n) => noteItem(ctx, n)), `Search the notes of ${target.title}…`)));
    menu.addSeparator();
  }
  for (const n of list.slice(0, many ? MENU_RECENT : MENU_SHOWN)) menu.addItem((i) => i.setTitle(`${n.title}${n.mtime ? ` · ${when(n, today)}` : ''}`).setIcon('sticky-note').onClick(() => void ctx.openFile(n.path)));
  if (many) menu.addItem((i) => i.setTitle(`All ${list.length} notes…`).setIcon('list').onClick(() => manageNotesModal(ctx, target)));
  if (list.length > 0) menu.addSeparator();
  menu.addItem((i) => i.setTitle('New note…').setIcon('file-plus').onClick(() => newNote(ctx, target)));
  menu.addItem((i) => i.setTitle('Link existing note…').setIcon('link').onClick(() => linkExistingNote(ctx, target)));
  if (list.length > 0 && !many) menu.addItem((i) => i.setTitle('Manage notes…').setIcon('settings-2').onClick(() => manageNotesModal(ctx, target)));
}

export function notesMenu(ctx: UiContext, target: DrawingTarget, ev: MouseEvent): void {
  const menu = new Menu();
  addNoteItems(menu, ctx, target);
  menu.showAtMouseEvent(ev);
}

export function notesButton(ctx: UiContext, target: DrawingTarget): HTMLElement {
  const n = ctx.index.notesFor(target).length;
  const b = button('', { icon: 'sticky-note', title: n === 0 ? 'Notes: none yet — create or link one' : `${n} note${n === 1 ? '' : 's'}`, onClick: (ev) => notesMenu(ctx, target, ev) });
  b.addClass('helm-notes-btn');
  if (n > 0) b.appendChild(h('span', { cls: 'helm-badge', text: String(n) }));
  return b;
}

export function notesIndicator(ctx: UiContext, t: Task): HTMLElement | null {
  const target = targetForTask(t);
  const n = ctx.index.notesFor(target).length;
  if (n === 0) return null;
  const el = iconButton('sticky-note', `${n} note${n === 1 ? '' : 's'}`, (ev) => { ev.stopPropagation(); notesMenu(ctx, target, ev); }, 'helm-task-notes');
  el.appendChild(h('span', { cls: 'helm-badge', text: String(n) }));
  return el;
}

/** A note as a list row: its first heading and line, its length, the work still open in it. */
export function noteItem(ctx: UiContext, n: NoteRef): AttachItem {
  const pv = ctx.index.notePreview(n.path);
  const facts: AttachItem['facts'] = [];
  if (pv && pv.words > 0) facts.push({ text: wordCount(pv.words) });
  if (pv && pv.openTasks > 0) facts.push({ text: `${pv.openTasks} open task${pv.openTasks === 1 ? '' : 's'}`, accent: true });
  else if (pv && pv.doneTasks > 0) facts.push({ text: `${pv.doneTasks} done` });
  return { path: n.path, title: n.title, ...(n.mtime ? { mtime: n.mtime } : {}), icon: ctx.index.isSongNote(n.path) ? 'music' : 'file-text', ...(pv?.heading ? { heading: pv.heading } : {}), ...(pv?.text ? { text: pv.text } : {}), facts };
}

/** The notes on an item, as a list you can read and search. */
export function notesSection(ctx: UiContext, target: DrawingTarget): HTMLElement {
  return attachList(ctx, {
    target,
    noun: ['note', 'notes'],
    items: () => ctx.index.notesFor(target).map((n) => noteItem(ctx, n)),
    emptyText: 'No notes yet.',
    actions: [
      button('New note', { icon: 'file-plus', cls: 'helm-btn-quiet', onClick: () => newNote(ctx, target) }),
      button('Link existing', { icon: 'link', cls: 'helm-btn-quiet', onClick: () => linkExistingNote(ctx, target) }),
    ],
    unlink: async (i) => { await ctx.mutations.unlinkNote(target, i.path); if (ctx.index.notesFor(target).some((x) => x.path === i.path)) ctx.notify(`“${i.title}” is still attached — the task’s text or a Notes list links it.`); },
    remove: (i) => ctx.mutations.deleteNote(i.path),
  });
}

/** Every note on an item in a window of its own, the same list — what a day, a period or a habit offers. */
export function manageNotesModal(ctx: UiContext, target: DrawingTarget): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Notes · ${target.title}`);
  m.contentEl.addClass('helm-modal', 'helm-manage-modal');
  m.contentEl.appendChild(notesSection(ctx, target));
  m.open();
  ctx.trackModal(m);
  m.contentEl.querySelector<HTMLInputElement>('.helm-note-filter')?.focus();
}
