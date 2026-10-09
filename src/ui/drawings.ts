/**
 * Drawings UI: a button with a count, a menu that lists what exists (with a
 * search once there are many) and offers to make or link more, and the
 * readable list for detail pages and the manage popup (see attachList). One
 * component, used for tasks, projects, days and periods alike.
 */
import { FuzzySuggestModal, Menu, Modal } from 'obsidian';
import { askNameAndLocation } from './fields';
import type { DrawingTarget, Task } from '../core/types';
import type { Drawing } from '../core/drawing';
import type { Period } from '../core/periods';
import { humanDate } from '../core/dates';
import { button, h, iconButton } from './dom';
import { attachList, MENU_RECENT, MENU_SHOWN, searchAttached, type AttachItem } from './attachList';
import type { UiContext } from './context';

export const targetForTask = (t: Task): DrawingTarget => ({ kind: 'task', key: t.mirrorOf ?? t.key, ...(t.id ? { id: t.id } : {}), title: t.text.trim() || 'task' });
export const targetForProject = (id: string, title: string): DrawingTarget => ({ kind: 'project', id, title });
export const targetForDate = (date: string): DrawingTarget => ({ kind: 'date', date, title: date });
export const targetForPeriod = (p: Period): DrawingTarget => ({ kind: 'period', key: p.key, title: p.key });
export const targetForHabit = (hb: { id: string; title: string }): DrawingTarget => ({ kind: 'habit', id: hb.id, title: hb.title });
export const targetForPhase = (ph: { id: string; projectId: string; title: string }): DrawingTarget => ({ kind: 'phase', id: ph.id, projectId: ph.projectId, title: ph.title });

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
  getItemText(d: Drawing): string { return `${d.title}${d.legacy ? '  ·  raw .excalidraw — convert it first' : ''}  ·  ${d.path}`; }
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
  pickDrawing(ctx, attached, (d) => {
    // A raw .excalidraw has nowhere to keep the attachment; say so plainly instead of failing at the write.
    if (d.legacy) { ctx.notify(`“${d.title}” is a raw .excalidraw file, so it has no frontmatter to hold the link. Run “Excalidraw: Convert *.excalidraw to *.md files”, then attach it here.`); return; }
    void ctx.run('Link drawing', async () => { await ctx.mutations.linkDrawing(target, d.path); ctx.notify(`Linked “${d.title}” to ${target.title}.`); });
  });
}

/** Fill a menu with the drawings of a target and the ways to add one. */
export function addDrawingItems(menu: Menu, ctx: UiContext, target: DrawingTarget): void {
  const today = ctx.today();
  const list = ctx.index.drawingsFor(target);
  // Many drawings: a search first, the most recent few, and the whole list one click away.
  const many = list.length > MENU_SHOWN;
  if (many) {
    menu.addItem((i) => i.setTitle(`Search ${list.length} drawings…`).setIcon('search').onClick(() => searchAttached(ctx, list.map(drawingItem), `Search the drawings of ${target.title}…`)));
    menu.addSeparator();
  }
  for (const d of list.slice(0, many ? MENU_RECENT : MENU_SHOWN)) menu.addItem((i) => i.setTitle(`${d.title}${d.mtime ? ` · ${when(d, today)}` : ''}`).setIcon(d.kind === 'canvas' ? 'layout-grid' : 'pen-tool').onClick(() => void ctx.openFile(d.path)));
  if (many) menu.addItem((i) => i.setTitle(`All ${list.length} drawings…`).setIcon('list').onClick(() => manageModal(ctx, target)));
  if (list.length > 0) menu.addSeparator();
  menu.addItem((i) => i.setTitle('New drawing…').setIcon('pen-tool').onClick(() => newDrawing(ctx, target)));
  menu.addItem((i) => i.setTitle('Link existing drawing…').setIcon('link').onClick(() => linkExisting(ctx, target)));
  if (list.length > 0 && !many) menu.addItem((i) => i.setTitle('Manage drawings…').setIcon('settings-2').onClick(() => manageModal(ctx, target)));
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

/** A drawing as a list row: the words written in it, what kind it is. */
export function drawingItem(d: Drawing): AttachItem {
  const facts: AttachItem['facts'] = [];
  if (d.kind === 'canvas') facts.push({ text: 'canvas' });
  if (d.labels) facts.push({ text: `${d.labels} label${d.labels === 1 ? '' : 's'}` });
  if (d.legacy) facts.push({ text: 'raw .excalidraw', title: 'A raw .excalidraw file: Helm can show it, but cannot link it until it is converted' });
  return { path: d.path, title: d.title, ...(d.mtime ? { mtime: d.mtime } : {}), icon: d.kind === 'canvas' ? 'layout-grid' : 'pen-tool', ...(d.preview ? { text: d.preview } : {}), facts };
}

/** The drawings on an item, as a list you can read and search. */
export function drawingsSection(ctx: UiContext, target: DrawingTarget): HTMLElement {
  return attachList(ctx, {
    target,
    noun: ['drawing', 'drawings'],
    items: () => ctx.index.drawingsFor(target).map(drawingItem),
    emptyText: 'No drawings yet.',
    actions: [
      button('New drawing', { icon: 'pen-tool', cls: 'helm-btn-quiet', onClick: () => newDrawing(ctx, target) }),
      button('Link existing', { icon: 'link', cls: 'helm-btn-quiet', onClick: () => linkExisting(ctx, target) }),
    ],
    unlink: async (i) => { await ctx.mutations.unlinkDrawing(target, i.path); if (ctx.index.drawingsFor(target).some((x) => x.path === i.path)) ctx.notify(`“${i.title}” is still attached by its folder or name.`); },
    remove: (i) => ctx.mutations.deleteDrawing(i.path),
  });
}

/** Every drawing on an item in a window of its own, the same list. */
export function manageModal(ctx: UiContext, target: DrawingTarget): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Drawings · ${target.title}`);
  m.contentEl.addClass('helm-modal', 'helm-manage-modal');
  m.contentEl.appendChild(drawingsSection(ctx, target));
  m.open();
  ctx.trackModal(m);
  m.contentEl.querySelector<HTMLInputElement>('.helm-note-filter')?.focus();
}
