/**
 * Drawings UI: a button with a count, a menu that lists what exists and offers
 * to make more (blank, or an AI overview), and a section for detail pages.
 * One component, used for tasks, projects, days and periods alike.
 */
import { Menu, Modal, setIcon } from 'obsidian';
import type { DrawingTarget, Task } from '../core/types';
import type { Drawing } from '../core/drawing';
import { PROMPT_ANGLES, type Prompt, type PromptAngle } from '../core/prompts';
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

export function aiDiagram(ctx: UiContext, target: DrawingTarget, mode?: 'overview' | 'research'): void {
  const m = mode ?? (target.kind === 'task' ? 'research' : 'overview');
  const skill = ctx.settings().aiEngine === 'skill';
  ctx.notify(m === 'research' ? `Researching “${target.title}” and drawing what it finds… ${skill ? 'this takes several minutes' : 'give it a minute or two'}; Helm will say when it is done.` : skill ? `Asking the excalidraw-diagram skill for ${target.title}… this takes several minutes; Helm will say when it is done.` : `Asking the AI for an overview of ${target.title}…`);
  void ctx.run('AI diagram', async () => { const p = await ctx.mutations.generateDiagram(target, { mode: m }); ctx.notify(`Drew ${p.slice(p.lastIndexOf('/') + 1).replace(/\.excalidraw\.md$/, '')}.`); await ctx.openFile(p); });
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
  menu.addItem((i) => i.setTitle('Manage drawings & prompts…').setIcon('settings-2').onClick(() => manageModal(ctx, target)));
  if (aiOn(ctx)) {
    if (target.kind === 'task') menu.addItem((i) => i.setTitle('AI diagram: research this subject').setIcon('sparkles').onClick(() => aiDiagram(ctx, target, 'research')));
    else {
      menu.addItem((i) => i.setTitle('AI overview diagram').setIcon('sparkles').onClick(() => aiDiagram(ctx, target, 'overview')));
      if (target.kind === 'project') menu.addItem((i) => i.setTitle('AI diagram: research the subject').setIcon('telescope').onClick(() => aiDiagram(ctx, target, 'research')));
    }
  }
}

export function drawingsMenu(ctx: UiContext, target: DrawingTarget, ev: MouseEvent): void {
  const menu = new Menu();
  addDrawingItems(menu, ctx, target);
  menu.addSeparator();
  addPromptItems(menu, ctx, target);
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
    card.appendChild(iconButton('trash', 'Move to trash', (ev) => { ev.stopPropagation(); if (window.confirm(`Move “${d.title}” to the trash?`)) void ctx.run('Delete drawing', () => ctx.mutations.deleteDrawing(d.path)); }, 'helm-drawing-card-delete'));
    cards.appendChild(card);
  }
  if (list.length === 0) cards.appendChild(h('div', { cls: 'helm-hint', text: 'No drawings yet.' }));
  const actions = h('div', { cls: 'helm-drawing-actions' }, button('New drawing', { icon: 'pen-tool', onClick: () => newDrawing(ctx, target) }),
    aiOn(ctx) && target.kind !== 'task' ? button('AI overview', { icon: 'sparkles', onClick: () => aiDiagram(ctx, target, 'overview') }) : null,
    aiOn(ctx) && (target.kind === 'task' || target.kind === 'project') ? button('AI research', { icon: 'telescope', title: 'Research the subject and draw what is true about it', onClick: () => aiDiagram(ctx, target, 'research') }) : null);
  const prompts = ctx.index.promptsFor(target);
  const promptRow = h('div', { cls: 'helm-prompt-chips' },
    ...prompts.map((pr) => h('button', { cls: 'helm-chip helm-prompt-chip', title: `${angleLabel(pr.angle)} — click to copy and view`, onClick: () => { void ctx.copy(pr.text).then(() => ctx.notify(`Prompt ${pr.n} copied to the clipboard.`)); promptModal(ctx, pr, target); } }, icon('clipboard-copy'), h('span', { text: `Prompt ${pr.n}` }))),
    button('New prompt', { icon: 'sparkle', cls: 'helm-btn-quiet', title: 'Build a prompt about this subject and copy it to the clipboard', onClick: () => newPrompt(ctx, target) }),
  );
  return h('div', { cls: 'helm-drawings' }, cards, actions, promptRow);
}
void icon;

/* ── Prompts ───────────────────────────────────────────────────────────── */

const angleLabel = (a: PromptAngle): string => PROMPT_ANGLES.find((x) => x.id === a)?.label ?? a;

/** Show a prompt: the text, Copy, Open note, Delete. */
export function promptModal(ctx: UiContext, prompt: Prompt, target: DrawingTarget): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Prompt ${prompt.n} · ${angleLabel(prompt.angle)}`);
  m.contentEl.addClass('helm-modal', 'helm-prompt-modal');
  const pre = h('pre', { cls: 'helm-prompt-text', text: prompt.text });
  const copyBtn = button('Copy', { icon: 'copy', primary: true, onClick: () => { void ctx.copy(prompt.text).then(() => { copyBtn.querySelector('span')!.textContent = 'Copied'; ctx.notify(`Prompt ${prompt.n} copied to the clipboard.`); }); } });
  m.contentEl.append(
    h('div', { cls: 'helm-hint', text: `For ${target.title} · paste into the Claude app or the CLI` }),
    pre,
    h('div', { cls: 'helm-modal-buttons' },
      button('Delete', { icon: 'trash', cls: 'helm-btn-quiet', onClick: () => { if (window.confirm(`Move prompt ${prompt.n} to the trash?`)) { m.close(); void ctx.run('Delete prompt', () => ctx.mutations.deletePrompt(prompt.path)); } } }),
      button('Open note', { icon: 'file-text', onClick: () => { m.close(); void ctx.openFile(prompt.path); } }),
      h('span', { cls: 'helm-spacer' }), button('Close', { onClick: () => m.close() }), copyBtn),
  );
  m.open();
  ctx.trackModal(m);
}

/** Make the next prompt, copy it straight to the clipboard, and show it. */
export function newPrompt(ctx: UiContext, target: DrawingTarget, angle?: PromptAngle): void {
  void ctx.run('New prompt', async () => {
    const pr = await ctx.mutations.createPrompt(target, angle);
    await ctx.copy(pr.text);
    ctx.notify(`Prompt ${pr.n} (${angleLabel(pr.angle)}) copied to the clipboard.`);
    promptModal(ctx, pr, target);
  });
}

export function addPromptItems(menu: Menu, ctx: UiContext, target: DrawingTarget): void {
  const list = ctx.index.promptsFor(target);
  for (const pr of list) menu.addItem((i) => i.setTitle(`Prompt ${pr.n} · ${angleLabel(pr.angle)}`).setIcon('clipboard-copy').onClick(() => { void ctx.copy(pr.text).then(() => ctx.notify(`Prompt ${pr.n} copied to the clipboard.`)); promptModal(ctx, pr, target); }));
  if (list.length > 0) menu.addSeparator();
  const next = PROMPT_ANGLES[list.length % PROMPT_ANGLES.length]!;
  menu.addItem((i) => i.setTitle(`New prompt (${next.label})`).setIcon('sparkle').onClick(() => newPrompt(ctx, target, next.id)));
  menu.addItem((i) => {
    i.setTitle('New prompt with angle…').setIcon('list');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    for (const a of PROMPT_ANGLES) sub.addItem((j) => j.setTitle(a.label).setIcon(a.icon).onClick(() => newPrompt(ctx, target, a.id)));
  });
}

/* ── Manage: drawings and prompts of a target, with delete ─────────────── */

export function manageModal(ctx: UiContext, target: DrawingTarget): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Drawings & prompts · ${target.title}`);
  m.contentEl.addClass('helm-modal', 'helm-manage-modal');
  const draw = (): void => {
    m.contentEl.empty();
    const today = ctx.today();
    const drawings = ctx.index.drawingsFor(target);
    const prompts = ctx.index.promptsFor(target);
    const rows = h('div', { cls: 'helm-manage-list' });
    m.contentEl.appendChild(h('div', { cls: 'helm-field-label', text: `Drawings (${drawings.length})` }));
    if (drawings.length === 0) m.contentEl.appendChild(h('div', { cls: 'helm-hint', text: 'None.' }));
    for (const d of drawings) rows.appendChild(h('div', { cls: 'helm-manage-row' }, icon(d.kind === 'canvas' ? 'layout-grid' : 'pen-tool'), h('span', { cls: 'helm-manage-title', text: d.title }), h('span', { cls: 'helm-hint', text: [d.generated ? 'AI' : '', when(d, today)].filter(Boolean).join(' · ') }), h('span', { cls: 'helm-spacer' }),
      button('Open', { icon: 'external-link', cls: 'helm-btn-quiet', onClick: () => { m.close(); void ctx.openFile(d.path); } }),
      iconButton('trash', 'Move to trash', () => { if (window.confirm(`Move “${d.title}” to the trash? Its embed lines are removed from the notes that carry it.`)) void ctx.run('Delete drawing', async () => { await ctx.mutations.deleteDrawing(d.path); draw(); }); })));
    m.contentEl.appendChild(rows);
    m.contentEl.appendChild(h('div', { cls: 'helm-field-label helm-manage-head2', text: `Prompts (${prompts.length})` }));
    if (prompts.length === 0) m.contentEl.appendChild(h('div', { cls: 'helm-hint', text: 'None.' }));
    const prow = h('div', { cls: 'helm-manage-list' });
    for (const pr of prompts) prow.appendChild(h('div', { cls: 'helm-manage-row' }, icon('clipboard-copy'), h('span', { cls: 'helm-manage-title', text: `Prompt ${pr.n} · ${angleLabel(pr.angle)}` }), h('span', { cls: 'helm-spacer' }),
      button('Copy', { icon: 'copy', cls: 'helm-btn-quiet', onClick: () => void ctx.copy(pr.text).then(() => ctx.notify(`Prompt ${pr.n} copied.`)) }),
      button('View', { icon: 'eye', cls: 'helm-btn-quiet', onClick: () => promptModal(ctx, pr, target) }),
      iconButton('trash', 'Move to trash', () => { if (window.confirm(`Move prompt ${pr.n} to the trash?`)) void ctx.run('Delete prompt', async () => { await ctx.mutations.deletePrompt(pr.path); draw(); }); })));
    m.contentEl.appendChild(prow);
    m.contentEl.appendChild(h('div', { cls: 'helm-modal-buttons' }, button('New drawing…', { icon: 'pen-tool', onClick: () => { m.close(); newDrawing(ctx, target); } }), button('New prompt', { icon: 'sparkle', onClick: () => { m.close(); newPrompt(ctx, target); } }), h('span', { cls: 'helm-spacer' }), button('Close', { onClick: () => m.close() })));
  };
  draw();
  m.open();
  ctx.trackModal(m);
}
