/** A popup listing the tasks behind a chart element. */
import { Modal } from 'obsidian';
import type { Task } from '../../core/types';
import { minutesToHuman } from '../../core/dates';
import { effortOf } from '../../data/planner';
import { button, chip, h } from '../dom';
import type { UiContext } from '../context';
import { taskRow } from '../taskRow';

export function openDrilldown(ctx: UiContext, title: string, tasks: Task[]): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(title);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-drilldown');
  const settings = ctx.settings();
  const minutes = tasks.reduce((s, t) => s + effortOf(t, settings), 0);
  const projects = new Map<string, number>();
  for (const t of tasks) { const k = t.projectTitle ?? (t.origin === 'daily' ? 'Daily notes' : t.origin === 'inbox' ? 'Inbox' : 'Other'); projects.set(k, (projects.get(k) ?? 0) + 1); }
  const filter = h('input', { attr: { type: 'search', placeholder: 'Filter…' } });
  const list = h('div', { cls: 'helm-drilldown-list' });
  const render = (): void => {
    const q = filter.value.trim().toLowerCase();
    list.replaceChildren();
    const shown = tasks.filter((t) => !q || `${t.text} ${t.projectTitle ?? ''} ${t.tags.join(' ')}`.toLowerCase().includes(q));
    for (const t of shown.slice(0, 300)) list.appendChild(taskRow(ctx, t, { showDate: 'both' }));
    if (shown.length > 300) list.appendChild(h('div', { cls: 'helm-hint', text: `… ${shown.length - 300} more` }));
    if (shown.length === 0) list.appendChild(h('div', { cls: 'helm-hint', text: 'Nothing matches.' }));
  };
  filter.addEventListener('input', render);
  root.append(
    h('div', { cls: 'helm-drilldown-summary' },
      chip(`${tasks.length} task${tasks.length === 1 ? '' : 's'}`, 'count'),
      chip(`≈ ${minutesToHuman(minutes)}`, 'effort'),
      ...[...projects.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => chip(`${k} · ${n}`, 'project')),
    ),
    filter, list,
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), button('Close', { onClick: () => m.close() })),
  );
  render();
  m.open();
  setTimeout(() => filter.focus(), 0);
}
