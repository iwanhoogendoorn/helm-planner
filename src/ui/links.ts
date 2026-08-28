/** Links on a task: open, add, remove — from the row pill, the task menu and the editor. */
import { Menu, Modal } from 'obsidian';
import type { Task } from '../core/types';
import { addLinkToText, linkLabel, linksIn, removeLinkFromText } from '../core/links';
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
  const update = (): void => { const u = url.value.trim(); preview.textContent = u ? `[${label.value.trim() || linkLabel(u)}](${u})` : '—'; };
  url.addEventListener('input', update); label.addEventListener('input', update);
  let accepted = false;
  const accept = (): void => {
    const u = url.value.trim();
    if (!/^(https?:\/\/|mailto:|obsidian:\/\/)/i.test(u)) { ctx.notify('Enter a full URL, starting with https://'); return; }
    accepted = true; m.close(); onDone({ url: u, ...(label.value.trim() ? { label: label.value.trim() } : {}) });
  };
  for (const el of [url, label]) el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); accept(); } });
  m.contentEl.append(
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'URL' }), url),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Label' }), label, h('div', { cls: 'helm-hint', text: 'Leave empty to show the address.' })),
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

export function addLinkItems(menu: Menu, ctx: UiContext, task: Task): void {
  const links = linksIn(task.text);
  for (const l of links) menu.addItem((i) => i.setTitle(l.label).setIcon('external-link').onClick(() => openExternal(l.url)));
  if (links.length > 0) menu.addSeparator();
  menu.addItem((i) => i.setTitle('Add link…').setIcon('link').onClick(() => addLink(ctx, task)));
  if (links.length > 0) menu.addItem((i) => {
    i.setTitle('Remove link').setIcon('unlink');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    for (const l of links) sub.addItem((j) => j.setTitle(l.label).setIcon('x').onClick(() => void ctx.run('Remove link', () => ctx.mutations.removeLink(task.key, l.url))));
  });
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
export function linksSection(ctx: UiContext, text: { get: () => string; set: (t: string) => void }): HTMLElement {
  const root = h('div', { cls: 'helm-attach-section' });
  const draw = (): void => {
    const links = linksIn(text.get());
    root.replaceChildren(
      ...links.map((l) => h('div', { cls: 'helm-attach-row' },
        h('a', { cls: 'external-link helm-link', text: l.label, attr: { href: l.url, target: '_blank', rel: 'noopener' }, title: l.url }),
        h('span', { cls: 'helm-spacer' }),
        iconButton('x', 'Remove this link', () => { text.set(removeLinkFromText(text.get(), l.url)); draw(); }),
      )),
      ...(links.length === 0 ? [h('div', { cls: 'helm-hint', text: 'No links yet.' })] : []),
      h('div', { cls: 'helm-drawing-actions' }, button('Add link…', { icon: 'link', cls: 'helm-btn-quiet', onClick: () => askLink(ctx, (r) => { if (r) { text.set(addLinkToText(text.get(), r.url, r.label)); draw(); } }) })),
    );
  };
  draw();
  return root;
}
