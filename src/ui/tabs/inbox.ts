/** Inbox zero: capture fast, triage to a day or a project. */
import type { Task } from '../../core/types';
import { addDays } from '../../core/dates';
import { parseCapture } from '../../core/nlp';
import { inboxItems } from '../../data/planner';
import { button, empty, h, icon, section } from '../dom';
import type { UiContext } from '../context';
import { taskRow } from '../taskRow';
import { pickProject } from '../menus';
import { minutesToHuman } from '../../core/dates';

export interface InboxState { collapsed: Map<string, boolean> }

export function renderInbox(ctx: UiContext, root: HTMLElement, state: InboxState): void {
  const today = ctx.today();
  const snap = ctx.index.snapshot;
  const items = inboxItems(snap);

  const input = h('input', { cls: 'helm-input-wide helm-capture-input', attr: { type: 'text', placeholder: 'Capture: Call the plumber tomorrow !high #home @Kitchen ~30m' } });
  input.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' || input.value.trim() === '') return;
    const c = parseCapture(input.value, today, ctx.settings().weekStartsOn);
    input.value = '';
    const p = c.project ? ctx.index.projectByTitle(c.project) : undefined;
    void ctx.run('Capture', () => ctx.mutations.addTask({
      text: c.text, ...(p ? { projectId: p.id } : {}), ...(c.scheduled ? { date: c.scheduled } : {}),
      fields: { priority: c.priority, ...(c.due ? { due: c.due } : {}), ...(c.effortMinutes ? { effortMinutes: c.effortMinutes, effortRaw: minutesToHuman(c.effortMinutes) } : {}), ...(c.time ? { time: c.time } : {}), ...(c.recurrence ? { recurrence: c.recurrence } : {}) },
    }));
    setTimeout(() => root.querySelector<HTMLInputElement>('.helm-capture-input')?.focus(), 50);
  });
  root.appendChild(h('div', { cls: 'helm-inbox-capture' }, icon('inbox'), input));

  const triage = (t: Task): Parameters<typeof taskRow>[2] => ({
    showChildren: true,
    quickAction: { icon: 'sun', title: 'Plan for today', onClick: (x) => void ctx.run('Schedule', () => ctx.mutations.schedule(x.key, today)) },
    extraActions: [
      { icon: 'sunrise', title: 'Plan for tomorrow', onClick: (x) => void ctx.run('Schedule', () => ctx.mutations.schedule(x.key, addDays(today, 1))) },
      { icon: 'folder-input', title: 'Move to project…', onClick: (x) => pickProject(ctx, (p, ph) => void ctx.run('Move', () => ctx.mutations.moveToProject(x.key, p.id, ph)), { phases: true }) },
    ],
    ...(t.origin === 'note' ? {} : {}),
  });

  root.appendChild(section('Inbox', { count: items.inbox.length, store: state.collapsed, key: 'inbox', actions: [button('Open note', { icon: 'file-text', onClick: () => void ctx.run('Open', async () => { const p = ctx.settings().inboxNote; if (!(await ctx.app.vault.adapter.exists(p))) await ctx.mutations.addTask({ text: '' }).catch(() => undefined); await ctx.openFile(p); }) })] },
    items.inbox.length === 0 ? empty('Inbox zero. Capture something above, or press the + in the ribbon from anywhere.') : null,
    ...items.inbox.map((t) => taskRow(ctx, t, triage(t))),
  ));

  const looseCount = [...items.loose.values()].reduce((s, l) => s + l.length, 0);
  if (looseCount > 0) {
    const body: HTMLElement[] = [];
    for (const [path, tasks] of [...items.loose.entries()].sort((a, b) => b[1].length - a[1].length)) {
      const name = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
      body.push(section(name, { count: tasks.length, store: state.collapsed, key: `note:${path}`, collapsed: tasks.length > 15, actions: [button('', { icon: 'file-text', title: 'Open note', onClick: () => void ctx.openFile(path) })] },
        ...tasks.slice(0, 200).map((t) => taskRow(ctx, t, { ...triage(t), showProject: false })),
        tasks.length > 200 ? h('div', { cls: 'helm-hint', text: `… ${tasks.length - 200} more in the note.` }) : null,
      ));
    }
    root.appendChild(section('Tasks in other notes', { count: looseCount, store: state.collapsed, key: 'loose' }, h('div', { cls: 'helm-hint', text: 'Open tasks in notes Helm scans that are neither projects nor daily notes. Plan them onto a day (they get mirrored) or move them into a project.' }), ...body));
  }

  if (items.unscheduledProject.length > 0) {
    root.appendChild(section('Project tasks with no date', { count: items.unscheduledProject.length, store: state.collapsed, key: 'undated', collapsed: true },
      ...items.unscheduledProject.slice(0, 100).map((t) => taskRow(ctx, t, { showChildren: false, quickAction: { icon: 'sun', title: 'Plan for today', onClick: (x) => void ctx.run('Schedule', () => ctx.mutations.schedule(x.key, today)) } })),
      items.unscheduledProject.length > 100 ? h('div', { cls: 'helm-hint', text: `… ${items.unscheduledProject.length - 100} more.` }) : null,
    ));
  }
}
