/**
 * Notes UI: the twin of drawings — a button with a count, a menu that lists
 * the notes attached to a task / project / day / period and offers to make or
 * link one, a section for detail pages, and a manage popup with open / unlink
 * / delete.
 */
import { FuzzySuggestModal, Menu, Modal, setIcon } from 'obsidian';
import type { DrawingTarget, Task } from '../core/types';
import type { NoteRef } from '../core/noteRef';
import { humanDate } from '../core/dates';
import { button, h, icon, iconButton } from './dom';
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
  for (const n of list.slice(0, 12)) menu.addItem((i) => i.setTitle(`${n.title}${n.mtime ? ` · ${when(n, today)}` : ''}`).setIcon('sticky-note').onClick(() => void ctx.openFile(n.path)));
  if (list.length > 12) menu.addItem((i) => i.setTitle(`… ${list.length - 12} more`).setIcon('more-horizontal').setDisabled(true));
  if (list.length > 0) menu.addSeparator();
  menu.addItem((i) => i.setTitle('New note…').setIcon('file-plus').onClick(() => newNote(ctx, target)));
  menu.addItem((i) => i.setTitle('Link existing note…').setIcon('link').onClick(() => linkExistingNote(ctx, target)));
  if (list.length > 0) menu.addItem((i) => i.setTitle('Manage notes…').setIcon('settings-2').onClick(() => manageNotesModal(ctx, target)));
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

export function notesSection(ctx: UiContext, target: DrawingTarget): HTMLElement {
  const today = ctx.today();
  const list = ctx.index.notesFor(target);
  const cards = h('div', { cls: 'helm-drawing-cards' });
  for (const n of list) {
    const card = h('button', { cls: 'helm-drawing-card', title: n.path, onClick: () => void ctx.openFile(n.path) },
      h('span', { cls: 'helm-drawing-card-icon' }), h('span', { cls: 'helm-drawing-card-title', text: n.title }), h('span', { cls: 'helm-drawing-card-meta', text: when(n, today) }));
    setIcon(card.querySelector('.helm-drawing-card-icon') as HTMLElement, 'sticky-note');
    card.appendChild(iconButton('trash', 'Move to trash', (ev) => { ev.stopPropagation(); if (window.confirm(`Move “${n.title}” to the trash?`)) void ctx.run('Delete note', () => ctx.mutations.deleteNote(n.path)); }, 'helm-drawing-card-delete'));
    cards.appendChild(card);
  }
  if (list.length === 0) cards.appendChild(h('div', { cls: 'helm-hint', text: 'No notes yet.' }));
  const actions = h('div', { cls: 'helm-drawing-actions' },
    button('New note', { icon: 'file-plus', onClick: () => newNote(ctx, target) }),
    button('Link existing', { icon: 'link', onClick: () => linkExistingNote(ctx, target) }),
    list.length > 0 ? button('Manage', { icon: 'settings-2', cls: 'helm-btn-quiet', onClick: () => manageNotesModal(ctx, target) }) : null);
  return h('div', { cls: 'helm-drawings' }, cards, actions);
}

export function manageNotesModal(ctx: UiContext, target: DrawingTarget): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Notes · ${target.title}`);
  m.contentEl.addClass('helm-modal', 'helm-manage-modal');
  const draw = (): void => {
    m.contentEl.empty();
    const today = ctx.today();
    const notes = ctx.index.notesFor(target);
    const rows = h('div', { cls: 'helm-manage-list' });
    if (notes.length === 0) m.contentEl.appendChild(h('div', { cls: 'helm-hint', text: 'No notes attached.' }));
    for (const n of notes) rows.appendChild(h('div', { cls: 'helm-manage-row' }, icon('sticky-note'), h('span', { cls: 'helm-manage-title', text: n.title }), h('span', { cls: 'helm-hint', text: when(n, today) }), h('span', { cls: 'helm-spacer' }),
      button('Open', { icon: 'external-link', cls: 'helm-btn-quiet', onClick: () => { m.close(); void ctx.openFile(n.path); } }),
      button('Unlink', { icon: 'unlink', cls: 'helm-btn-quiet', title: 'Detach from this item; the note itself stays', onClick: () => void ctx.run('Unlink note', async () => { await ctx.mutations.unlinkNote(target, n.path); if (ctx.index.notesFor(target).some((x) => x.path === n.path)) ctx.notify(`“${n.title}” is still attached — the task’s text or a Notes list links it.`); draw(); }) }),
      iconButton('trash', 'Move to trash', () => { if (window.confirm(`Move “${n.title}” to the trash? Its link lines are removed from the notes that carry them.`)) void ctx.run('Delete note', async () => { await ctx.mutations.deleteNote(n.path); draw(); }); })));
    m.contentEl.appendChild(rows);
    m.contentEl.appendChild(h('div', { cls: 'helm-modal-buttons' }, button('New note…', { icon: 'file-plus', onClick: () => { m.close(); newNote(ctx, target); } }), button('Link existing…', { icon: 'link', onClick: () => { m.close(); linkExistingNote(ctx, target); } }), h('span', { cls: 'helm-spacer' }), button('Close', { onClick: () => m.close() })));
  };
  draw();
  m.open();
  ctx.trackModal(m);
}
