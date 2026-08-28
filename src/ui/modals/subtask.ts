/** Add a subtask under a task: a line indented beneath it, in the same note. */
import { Modal } from 'obsidian';
import type { Task } from '../../core/types';
import { shortLabel } from '../../core/label';
import { effortField, wikilinkSuggest } from '../fields';
import { button, h } from '../dom';
import type { UiContext } from '../context';

export function openSubtask(ctx: UiContext, parent: Task): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText('Add subtask');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-subtask-modal');
  const text = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder: 'What is the next small piece?' } });
  wikilinkSuggest(ctx, text);
  const effort = effortField();
  const add = (keepOpen: boolean): void => {
    const t = text.value.trim();
    if (t === '') { ctx.notify('Give the subtask a title.'); text.focus(); return; }
    const e = effort.get();
    if (!keepOpen) m.close();
    void ctx.run('Add subtask', () => ctx.mutations.addTask({ text: t, parentKey: parent.key, ...(e ? { fields: { effortMinutes: e, effortRaw: `${e}m` } } : {}) }));
    if (keepOpen) { text.value = ''; text.focus(); }
  };
  text.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); add(ev.shiftKey); } });
  root.append(
    h('div', { cls: 'helm-hint' }, h('span', { text: 'Under: ' }), h('strong', { text: shortLabel(parent.text, 70) })),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Subtask' }), text),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Effort' }), effort.el),
    h('div', { cls: 'helm-hint', text: 'Enter to add · Shift+Enter to add and keep going' }),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button('Add subtask', { primary: true, icon: 'plus', onClick: () => add(false) })),
  );
  m.open();
  ctx.trackModal(m);
  setTimeout(() => text.focus(), 0);
}
