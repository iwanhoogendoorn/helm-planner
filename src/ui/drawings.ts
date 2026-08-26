/**
 * Drawings UI: a button with a count, a menu that lists what exists and offers
 * to make more (blank, or an AI overview), and a section for detail pages.
 * One component, used for tasks, projects, days and periods alike.
 */
import { Menu, Modal, setIcon } from 'obsidian';
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

const aiOn = (ctx: UiContext): boolean => ctx.settings().aiEnabled && ctx.aiAvailable;
const when = (d: Drawing, today: string): string => (d.mtime ? humanDate(new Date(d.mtime).toISOString().slice(0, 10), today) : '');

/** Ask for a name (Enter to accept, blank = the default name). */
function askName(ctx: UiContext, title: string, placeholder: string, onDone: (name: string | undefined) => void): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(title);
  m.contentEl.addClass('helm-modal', 'helm-name-modal');
  const input = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder } });
  let accepted = false;
  const accept = (): void => { accepted = true; m.close(); onDone(input.value.trim() || undefined); };
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); accept(); } });
  m.contentEl.append(
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Name' }), input, h('div', { cls: 'helm-hint', text: 'Leave empty to use the default name.' })),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button('Create', { primary: true, onClick: accept })),
  );
  const origClose = m.onClose.bind(m);
  m.onClose = () => { origClose(); if (!accepted) onDone(undefined); };
  m.open();
  ctx.trackModal(m);
  setTimeout(() => input.focus(), 0);
}

export function newDrawing(ctx: UiContext, target: DrawingTarget): void {
  askName(ctx, `New drawing for ${target.title}`, target.kind === 'project' ? 'e.g. Architecture' : 'e.g. flow, mind map, sketch', (name) => {
    void ctx.run('New drawing', async () => { const p = await ctx.mutations.createDrawing(target, { ...(name ? { name } : {}) }); await ctx.openFile(p); });
  });
}

export function aiDiagram(ctx: UiContext, target: DrawingTarget): void {
  ctx.notify(`Asking the AI for an overview of ${target.title}…`);
  void ctx.run('AI diagram', async () => { const p = await ctx.mutations.generateDiagram(target); ctx.notify(`Drew ${p.slice(p.lastIndexOf('/') + 1).replace(/\.excalidraw\.md$/, '')}.`); await ctx.openFile(p); });
}

export function regenerate(ctx: UiContext, target: DrawingTarget, path: string): void {
  ctx.notify(`Redrawing the overview of ${target.title}…`);
  void ctx.run('AI diagram', async () => { await ctx.mutations.generateDiagram(target, { replacePath: path }); ctx.notify('Overview redrawn.'); await ctx.openFile(path); });
}

/** Fill a menu with the drawings of a target and the ways to add one. */
export function addDrawingItems(menu: Menu, ctx: UiContext, target: DrawingTarget): void {
  const today = ctx.today();
  const list = ctx.index.drawingsFor(target);
  for (const d of list.slice(0, 12)) menu.addItem((i) => i.setTitle(`${d.title}${d.generated ? ' · AI' : ''}${d.mtime ? ` · ${when(d, today)}` : ''}`).setIcon(d.kind === 'canvas' ? 'layout-grid' : 'pen-tool').onClick(() => void ctx.openFile(d.path)));
  const gen = list.filter((d) => d.generated);
  if (aiOn(ctx) && gen.length > 0) menu.addItem((i) => i.setTitle(gen.length === 1 ? `Regenerate “${gen[0]!.title}” (AI)` : 'Regenerate the AI overview').setIcon('refresh-cw').onClick(() => regenerate(ctx, target, gen[0]!.path)));
  if (list.length > 12) menu.addItem((i) => i.setTitle(`… ${list.length - 12} more`).setIcon('more-horizontal').setDisabled(true));
  if (list.length > 0) menu.addSeparator();
  menu.addItem((i) => i.setTitle('New drawing…').setIcon('pen-tool').onClick(() => newDrawing(ctx, target)));
  if (aiOn(ctx)) menu.addItem((i) => i.setTitle('AI overview diagram').setIcon('sparkles').onClick(() => aiDiagram(ctx, target)));
}

export function drawingsMenu(ctx: UiContext, target: DrawingTarget, ev: MouseEvent): void {
  const menu = new Menu();
  addDrawingItems(menu, ctx, target);
  menu.showAtMouseEvent(ev);
}

/** A toolbar button: pen icon, count badge when drawings exist. */
export function drawingsButton(ctx: UiContext, target: DrawingTarget, opts: { label?: string } = {}): HTMLElement {
  const n = ctx.index.drawingsFor(target).length;
  const b = button(opts.label ?? '', { icon: 'pen-tool', title: n === 0 ? 'Drawings: none yet — create one' : `${n} drawing${n === 1 ? '' : 's'}`, onClick: (ev) => drawingsMenu(ctx, target, ev) });
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

/** Cards for a detail page: every drawing, then New and (when on) AI. */
export function drawingsSection(ctx: UiContext, target: DrawingTarget): HTMLElement {
  const today = ctx.today();
  const list = ctx.index.drawingsFor(target);
  const cards = h('div', { cls: 'helm-drawing-cards' });
  for (const d of list) {
    const card = h('button', { cls: 'helm-drawing-card', title: d.path, onClick: () => void ctx.openFile(d.path) },
      h('span', { cls: 'helm-drawing-card-icon' }), h('span', { cls: 'helm-drawing-card-title', text: d.title }),
      h('span', { cls: 'helm-drawing-card-meta', text: [d.generated ? 'AI' : '', d.kind === 'canvas' ? 'canvas' : '', when(d, today)].filter(Boolean).join(' · ') }));
    setIcon(card.querySelector('.helm-drawing-card-icon') as HTMLElement, d.kind === 'canvas' ? 'layout-grid' : 'pen-tool');
    cards.appendChild(card);
  }
  if (list.length === 0) cards.appendChild(h('div', { cls: 'helm-hint', text: 'No drawings yet.' }));
  const actions = h('div', { cls: 'helm-drawing-actions' }, button('New drawing', { icon: 'pen-tool', onClick: () => newDrawing(ctx, target) }), aiOn(ctx) ? button('AI overview', { icon: 'sparkles', onClick: () => aiDiagram(ctx, target) }) : null);
  return h('div', { cls: 'helm-drawings' }, cards, actions);
}
void icon;
