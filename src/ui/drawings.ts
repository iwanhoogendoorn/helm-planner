/**
 * Drawings UI: a button with a count, a menu that lists what exists and offers
 * to make or link more, a section for detail pages, and a manage popup with
 * open / unlink / delete. One component, used for tasks, projects, days and
 * periods alike.
 */
import { FuzzySuggestModal, Menu, Modal, setIcon } from 'obsidian';
import { askNameAndLocation } from './fields';
import type { DrawingTarget, Task } from '../core/types';
import type { Drawing } from '../core/drawing';
import type { Period } from '../core/periods';
import { humanDate } from '../core/dates';
import { button, h, icon, iconButton } from './dom';
import type { UiContext } from './context';

export const targetForTask = (t: Task): DrawingTarget => ({ kind: 'task', key: t.mirrorOf ?? t.key, ...(t.id ? { id: t.id } : {}), title: t.text.trim() || 'task' });
export const targetForProject = (id: string, title: string): DrawingTarget => ({ kind: 'project', id, title });
export const targetForDate = (date: string): DrawingTarget => ({ kind: 'date', date, title: date });
export const targetForPeriod = (p: Period): DrawingTarget => ({ kind: 'period', key: p.key, title: p.key });
export const targetForHabit = (hb: { id: string; title: string }): DrawingTarget => ({ kind: 'habit', id: hb.id, title: hb.title });

const when = (d: Drawing, today: string): string => (d.mtime ? humanDate(new Date(d.mtime).toISOString().slice(0, 10), today) : '');

export function newDrawing(ctx: UiContext, target: DrawingTarget): void {
  askNameAndLocation(ctx, {
    title: `New drawing for ${target.title}`,
    placeholder: target.kind === 'project' ? 'e.g. Architecture' : 'e.g. flow, mind map, sketch',
    defaultFolder: ctx.mutations.defaultFolderFor(target, 'drawing'),
    preview: (name, folder) => ctx.mutations.drawingPathFor(target, name, folder),
    onDone: (r) => { if (!r) return; void ctx.run('New drawing', async () => { const p = await ctx.mutations.createDrawing(target, r); await ctx.openFile(p); }); },
  });
}

/** Pick any drawing in the vault and attach it to the target. */
class DrawingPicker extends FuzzySuggestModal<Drawing> {
  constructor(ctx: UiContext, private items: Drawing[], private onPick: (d: Drawing) => void) {
    super(ctx.app);
    this.setPlaceholder('Drawing to link…');
  }
  getItems(): Drawing[] { return this.items; }
  getItemText(d: Drawing): string { return `${d.title}  ·  ${d.path}`; }
  onChooseItem(d: Drawing): void { this.onPick(d); }
}

/** Choose an Excalidraw drawing that is not in `exclude`. */
export function pickDrawing(ctx: UiContext, exclude: Set<string>, onPick: (d: Drawing) => void): void {
  const items = ctx.index.allDrawings().filter((d) => !exclude.has(d.path) && d.kind === 'excalidraw');
  if (items.length === 0) { ctx.notify('Every drawing in the vault is already attached here.'); return; }
  const m = new DrawingPicker(ctx, items, onPick);
  m.open();
  ctx.trackModal(m);
}

export function linkExisting(ctx: UiContext, target: DrawingTarget): void {
  const attached = new Set(ctx.index.drawingsFor(target).map((d) => d.path));
  pickDrawing(ctx, attached, (d) => void ctx.run('Link drawing', async () => { await ctx.mutations.linkDrawing(target, d.path); ctx.notify(`Linked “${d.title}” to ${target.title}.`); }));
}

/** Fill a menu with the drawings of a target and the ways to add one. */
export function addDrawingItems(menu: Menu, ctx: UiContext, target: DrawingTarget): void {
  const today = ctx.today();
  const list = ctx.index.drawingsFor(target);
  for (const d of list.slice(0, 12)) menu.addItem((i) => i.setTitle(`${d.title}${d.mtime ? ` · ${when(d, today)}` : ''}`).setIcon(d.kind === 'canvas' ? 'layout-grid' : 'pen-tool').onClick(() => void ctx.openFile(d.path)));
  if (list.length > 12) menu.addItem((i) => i.setTitle(`… ${list.length - 12} more`).setIcon('more-horizontal').setDisabled(true));
  if (list.length > 0) menu.addSeparator();
  menu.addItem((i) => i.setTitle('New drawing…').setIcon('pen-tool').onClick(() => newDrawing(ctx, target)));
  menu.addItem((i) => i.setTitle('Link existing drawing…').setIcon('link').onClick(() => linkExisting(ctx, target)));
  if (list.length > 0) menu.addItem((i) => i.setTitle('Manage drawings…').setIcon('settings-2').onClick(() => manageModal(ctx, target)));
}

export function drawingsMenu(ctx: UiContext, target: DrawingTarget, ev: MouseEvent): void {
  const menu = new Menu();
  addDrawingItems(menu, ctx, target);
  menu.showAtMouseEvent(ev);
}

/** A toolbar button: pen icon, count badge when drawings exist. */
export function drawingsButton(ctx: UiContext, target: DrawingTarget, opts: { label?: string } = {}): HTMLElement {
  const n = ctx.index.drawingsFor(target).length;
  const b = button(opts.label ?? '', { icon: 'pen-tool', title: n === 0 ? 'Drawings: none yet — create or link one' : `${n} drawing${n === 1 ? '' : 's'}`, onClick: (ev) => drawingsMenu(ctx, target, ev) });
  b.addClass('helm-drawings-btn');
  if (n > 0) b.appendChild(h('span', { cls: 'helm-badge', text: String(n) }));
  return b;
}

/** A small inline indicator for task rows: only when drawings exist. */
export function drawingsIndicator(ctx: UiContext, t: Task): HTMLElement | null {
  const target = targetForTask(t);
  const n = ctx.index.drawingsFor(target).length;
  if (n === 0) return null;
  const el = iconButton('pen-tool', `${n} drawing${n === 1 ? '' : 's'}`, (ev) => { ev.stopPropagation(); drawingsMenu(ctx, target, ev); }, 'helm-task-drawings');
  el.appendChild(h('span', { cls: 'helm-badge', text: String(n) }));
  return el;
}

/** Cards for a detail page: every drawing, then New and Link. */
export function drawingsSection(ctx: UiContext, target: DrawingTarget): HTMLElement {
  const today = ctx.today();
  const list = ctx.index.drawingsFor(target);
  const cards = h('div', { cls: 'helm-drawing-cards' });
  for (const d of list) {
    const card = h('button', { cls: 'helm-drawing-card', title: d.path, onClick: () => void ctx.openFile(d.path) },
      h('span', { cls: 'helm-drawing-card-icon' }), h('span', { cls: 'helm-drawing-card-title', text: d.title }),
      h('span', { cls: 'helm-drawing-card-meta', text: [d.kind === 'canvas' ? 'canvas' : '', when(d, today)].filter(Boolean).join(' · ') }));
    setIcon(card.querySelector('.helm-drawing-card-icon') as HTMLElement, d.kind === 'canvas' ? 'layout-grid' : 'pen-tool');
    card.appendChild(iconButton('trash', 'Move to trash', (ev) => { ev.stopPropagation(); if (window.confirm(`Move “${d.title}” to the trash?`)) void ctx.run('Delete drawing', () => ctx.mutations.deleteDrawing(d.path)); }, 'helm-drawing-card-delete'));
    cards.appendChild(card);
  }
  if (list.length === 0) cards.appendChild(h('div', { cls: 'helm-hint', text: 'No drawings yet.' }));
  const actions = h('div', { cls: 'helm-drawing-actions' },
    button('New drawing', { icon: 'pen-tool', onClick: () => newDrawing(ctx, target) }),
    button('Link existing', { icon: 'link', onClick: () => linkExisting(ctx, target) }),
    list.length > 0 ? button('Manage', { icon: 'settings-2', cls: 'helm-btn-quiet', onClick: () => manageModal(ctx, target) }) : null);
  return h('div', { cls: 'helm-drawings' }, cards, actions);
}

/* ── Manage: the drawings of a target, with open / unlink / delete ──────── */

export function manageModal(ctx: UiContext, target: DrawingTarget): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Drawings · ${target.title}`);
  m.contentEl.addClass('helm-modal', 'helm-manage-modal');
  const draw = (): void => {
    m.contentEl.empty();
    const today = ctx.today();
    const drawings = ctx.index.drawingsFor(target);
    const rows = h('div', { cls: 'helm-manage-list' });
    if (drawings.length === 0) m.contentEl.appendChild(h('div', { cls: 'helm-hint', text: 'No drawings attached.' }));
    for (const d of drawings) rows.appendChild(h('div', { cls: 'helm-manage-row' }, icon(d.kind === 'canvas' ? 'layout-grid' : 'pen-tool'), h('span', { cls: 'helm-manage-title', text: d.title }), h('span', { cls: 'helm-hint', text: when(d, today) }), h('span', { cls: 'helm-spacer' }),
      button('Open', { icon: 'external-link', cls: 'helm-btn-quiet', onClick: () => { m.close(); void ctx.openFile(d.path); } }),
      button('Unlink', { icon: 'unlink', cls: 'helm-btn-quiet', title: 'Detach from this item; the drawing itself stays', onClick: () => void ctx.run('Unlink drawing', async () => { await ctx.mutations.unlinkDrawing(target, d.path); const still = ctx.index.drawingsFor(target).some((x) => x.path === d.path); if (still) ctx.notify(`“${d.title}” is still attached by its folder or name.`); draw(); }) }),
      iconButton('trash', 'Move to trash', () => { if (window.confirm(`Move “${d.title}” to the trash? Its embed lines are removed from the notes that carry it.`)) void ctx.run('Delete drawing', async () => { await ctx.mutations.deleteDrawing(d.path); draw(); }); })));
    m.contentEl.appendChild(rows);
    m.contentEl.appendChild(h('div', { cls: 'helm-modal-buttons' }, button('New drawing…', { icon: 'pen-tool', onClick: () => { m.close(); newDrawing(ctx, target); } }), button('Link existing…', { icon: 'link', onClick: () => { m.close(); linkExisting(ctx, target); } }), h('span', { cls: 'helm-spacer' }), button('Close', { onClick: () => m.close() })));
  };
  draw();
  m.open();
  ctx.trackModal(m);
}
