/** Links on a task: open, add, remove — from the row pill, the task menu and the editor. */
import { Menu, Modal } from 'obsidian';
import type { Task } from '../core/types';
import { linkLabel, linksIn, normaliseLink, type TaskLink } from '../core/links';
import type { UiContext } from './context';
import { button, h, iconButton } from './dom';

export function openExternal(url: string): void {
  window.open(url, '_blank', 'noopener');
}

/** URL + optional label dialog. */
export function askLink(ctx: UiContext, onDone: (r: { url: string; label?: string } | undefined) => void, initial: { url?: string; label?: string } = {}): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText('Add link');
  m.contentEl.addClass('helm-modal', 'helm-link-modal');
  const url = h('input', { cls: 'helm-input-wide', attr: { type: 'url', placeholder: 'https://…', value: initial.url ?? '' } });
  const label = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder: 'e.g. Jira ticket', value: initial.label ?? '' } });
  const preview = h('div', { cls: 'helm-path-preview' });
  const problem = h('div', { cls: 'helm-hint helm-link-problem', style: { display: 'none' } });
  const update = (): void => {
    const r = normaliseLink(url.value, label.value);
    preview.textContent = r ? `[${r.label || linkLabel(r.url)}](${r.url})` : '—';
    const typed = url.value.trim() !== '' || label.value.trim() !== '';
    problem.style.display = !r && typed ? '' : 'none';
    problem.textContent = 'Neither box holds a web address — paste one, e.g. https://example.com/page.';
  };
  url.addEventListener('input', update); label.addEventListener('input', update);
  let accepted = false;
  const accept = (): void => {
    // Forgiving: the boxes swapped round, or an address without its https://, are both fine.
    const r = normaliseLink(url.value, label.value);
    if (!r) { update(); url.focus(); return; }
    accepted = true; m.close(); onDone(r);
  };
  for (const el of [url, label]) el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); accept(); } });
  m.contentEl.append(
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'URL' }), url),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Label' }), label, h('div', { cls: 'helm-hint', text: 'Leave empty to show the address. Swap the two boxes round and Helm sorts it out.' })),
    problem,
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Written as' }), preview),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), h('button', { cls: 'helm-btn', text: 'Cancel', onClick: () => m.close() }), h('button', { cls: 'helm-btn mod-cta', text: 'Add', onClick: accept })),
  );
  const origClose = m.onClose.bind(m);
  m.onClose = () => { origClose(); if (!accepted) onDone(undefined); };
  update();
  m.open();
  ctx.trackModal(m);
  setTimeout(() => url.focus(), 0);
}

export function addLink(ctx: UiContext, task: Task): void {
  askLink(ctx, (r) => { if (r) void ctx.run('Add link', () => ctx.mutations.addLink(task.key, r.url, r.label)); });
}

/** Whatever holds a set of links — a task's text, a project's note — behind one small interface. */
export interface LinkHolder {
  list: () => TaskLink[];
  add: (url: string, label?: string) => void;
  remove: (url: string) => void;
}

/** The links of anything, plus the ways to add and remove one. */
export function addLinkItemsFor(menu: Menu, ctx: UiContext, holder: LinkHolder): void {
  const links = holder.list();
  for (const l of links) menu.addItem((i) => i.setTitle(l.label).setIcon('external-link').onClick(() => openExternal(l.url)));
  if (links.length > 0) menu.addSeparator();
  menu.addItem((i) => i.setTitle('Add link…').setIcon('link').onClick(() => askLink(ctx, (r) => { if (r) holder.add(r.url, r.label); })));
  if (links.length > 0) menu.addItem((i) => {
    i.setTitle('Remove link').setIcon('unlink');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    for (const l of links) sub.addItem((j) => j.setTitle(l.label).setIcon('x').onClick(() => holder.remove(l.url)));
  });
}

/** A button with the link count that opens that menu. */
export function linksButton(ctx: UiContext, holder: LinkHolder, title = 'Links'): HTMLElement {
  const n = holder.list().length;
  const b = button('', { icon: 'link', title: n === 0 ? `${title}: none yet — add one` : `${n} link${n === 1 ? '' : 's'}`, onClick: (ev) => { const menu = new Menu(); addLinkItemsFor(menu, ctx, holder); menu.showAtMouseEvent(ev); } });
  b.addClass('helm-links-btn');
  if (n > 0) b.appendChild(h('span', { cls: 'helm-badge', text: String(n) }));
  return b;
}

/** A task's own links: the same menu, over its text. */
export function taskLinks(ctx: UiContext, task: Task): LinkHolder {
  return {
    list: () => linksIn(task.text),
    add: (url, label) => void ctx.run('Add link', () => ctx.mutations.addLink(task.key, url, label)),
    remove: (url) => void ctx.run('Remove link', () => ctx.mutations.removeLink(task.key, url)),
  };
}

export function addLinkItems(menu: Menu, ctx: UiContext, task: Task): void {
  addLinkItemsFor(menu, ctx, taskLinks(ctx, task));
}

export function linksMenu(ctx: UiContext, task: Task, ev: MouseEvent): void {
  const menu = new Menu();
  addLinkItems(menu, ctx, task);
  menu.showAtMouseEvent(ev);
}

/** Row pill: the count, opening the links menu. */
export function linksIndicator(ctx: UiContext, t: Task): HTMLElement | null {
  const n = linksIn(t.text).length;
  if (n === 0) return null;
  const el = iconButton('link', `${n} link${n === 1 ? '' : 's'}`, (ev) => { ev.stopPropagation(); linksMenu(ctx, t, ev); }, 'helm-task-links');
  el.appendChild(h('span', { cls: 'helm-badge', text: String(n) }));
  return el;
}

/**
 * Editor section, bound to the editor's own Text field: links are read from and written into that
 * text (not the vault), redrawn at once, and land in the note when the editor saves — so a Save
 * can never overwrite a link added a moment earlier.
 */
export function linksSection(ctx: UiContext, links: { list: () => TaskLink[]; add: (url: string, label?: string) => void; remove: (url: string) => void }): HTMLElement {
  const root = h('div', { cls: 'helm-attach-section' });
  const draw = (): void => {
    const list = links.list();
    root.replaceChildren(
      ...list.map((l) => h('div', { cls: 'helm-attach-row' },
        h('a', { cls: 'external-link helm-link', text: l.label, attr: { href: l.url, target: '_blank', rel: 'noopener' }, title: l.url }),
        h('span', { cls: 'helm-spacer' }),
        iconButton('x', 'Remove this link', () => { links.remove(l.url); draw(); }),
      )),
      ...(list.length === 0 ? [h('div', { cls: 'helm-hint', text: 'No links yet.' })] : []),
      h('div', { cls: 'helm-drawing-actions' }, button('Add link…', { icon: 'link', cls: 'helm-btn-quiet', onClick: () => askLink(ctx, (r) => { if (r) { links.add(r.url, r.label); draw(); } }) })),
    );
  };
  draw();
  return root;
}
