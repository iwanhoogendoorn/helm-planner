/**
 * Plan my day: pick from ranked candidates on the left, see the day fill up
 * on the right, commit once. Habits due that day are added automatically.
 */
import { Modal } from 'obsidian';
import type { IsoDate, Task } from '../../core/types';
import { humanDate, minutesToHuman } from '../../core/dates';
import { candidates, dayPlan, effortOf, type Candidate, type DayPart } from '../../data/planner';
import { PART_LABEL } from '../../core/dailyNote';
import { habitDue } from '../../data/habits';
import { button, chip, h, icon, progressBar, richText } from '../dom';
import type { UiContext } from '../context';
import { taskLabel } from '../context';

const REASON_LABEL: Record<Candidate['reason'], string> = {
  overdue: 'Overdue', 'due-soon': 'Due soon', 'scheduled-past': 'Carried over', 'in-progress': 'In progress', 'next-action': 'Next actions', inbox: 'Inbox', unblocked: 'Unblocked',
};
const REASON_ORDER: Candidate['reason'][] = ['overdue', 'scheduled-past', 'in-progress', 'due-soon', 'next-action', 'inbox', 'unblocked'];

export function openPlanDay(ctx: UiContext, date: IsoDate): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const plan = dayPlan(snap, date, settings);
  const cands = candidates(snap, date, settings, today);
  const picked = new Set<string>();
  const parts = new Map<string, DayPart>();
  const removed = new Set<string>();
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Plan ${humanDate(date, today, { year: true })}`);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-plan');
  const filter = h('input', { attr: { type: 'search', placeholder: 'Filter candidates…' } });
  const left = h('div', { cls: 'helm-plan-col helm-plan-left' });
  const right = h('div', { cls: 'helm-plan-col helm-plan-right' });
  const foot = h('div', { cls: 'helm-modal-buttons' });

  const existing: Task[] = [...plan.today, ...plan.timeBlocks, ...plan.mirrors.map((x) => x.source ?? x.mirror), ...plan.unmirrored, ...plan.elsewhere].filter((t) => t.status !== 'done' && t.status !== 'cancelled');
  const habits = ctx.index.allHabits().filter((hb) => habitDue(hb, date));

  const minutes = (): number => existing.filter((t) => !removed.has(t.key)).reduce((s, t) => s + effortOf(t, settings), 0) + [...picked].map((k) => snap.tasks.get(k)).filter((t): t is Task => t !== undefined).reduce((s, t) => s + effortOf(t, settings), 0);

  const candRow = (c: Candidate): HTMLElement => {
    const t = c.task;
    const on = picked.has(t.key);
    return h('div', { cls: ['helm-plan-item', on && 'is-picked'], onClick: () => { if (on) { picked.delete(t.key); parts.delete(t.key); } else picked.add(t.key); render(); } },
      icon(on ? 'check-square' : 'square', 'helm-plan-check'),
      h('div', { cls: 'helm-plan-item-main' },
        h('div', { cls: 'helm-plan-item-text' }, richText(taskLabel(t))),
        h('div', { cls: 'helm-task-meta' },
          t.projectTitle ? chip(t.projectTitle, 'project') : t.origin === 'inbox' ? chip('Inbox', 'inbox') : t.origin === 'note' ? chip(t.path.slice(t.path.lastIndexOf('/') + 1).replace(/\.md$/, ''), 'note') : null,
          t.due ? chip(`due ${humanDate(t.due, today)}`, t.due < date ? 'due is-overdue' : 'due') : null,
          t.priority !== 'normal' ? chip(t.priority, `prio prio-${t.priority}`) : null,
          chip(minutesToHuman(effortOf(t, settings)), 'effort'),
        ),
      ),
    );
  };

  const render = (): void => {
    left.replaceChildren();
    const q = filter.value.trim().toLowerCase();
    const groups = new Map<Candidate['reason'], Candidate[]>();
    for (const c of cands) {
      if (q && !`${c.task.text} ${c.task.projectTitle ?? ''}`.toLowerCase().includes(q)) continue;
      groups.set(c.reason, [...(groups.get(c.reason) ?? []), c]);
    }
    if (groups.size === 0) left.appendChild(h('div', { cls: 'helm-empty' }, h('p', { text: cands.length === 0 ? 'Nothing is waiting: no overdue work, no next actions, an empty inbox. Enjoy it.' : 'No match.' })));
    for (const r of REASON_ORDER) {
      const g = groups.get(r);
      if (!g) continue;
      left.appendChild(h('div', { cls: 'helm-plan-group' }, h('div', { cls: 'helm-plan-group-title' }, h('span', { text: REASON_LABEL[r] }), chip(String(g.length), 'count')), ...g.map(candRow)));
    }
    right.replaceChildren();
    const total = minutes();
    const cap = settings.dailyCapacityMinutes;
    right.append(
      h('div', { cls: 'helm-capacity' },
        h('div', { cls: 'helm-capacity-label' }, h('span', { text: `${minutesToHuman(total)} planned` }), h('span', { cls: 'helm-spacer' }), h('span', { cls: 'helm-hint', text: `capacity ${minutesToHuman(cap)}` })),
        progressBar(total / cap, total > cap ? 'is-over' : ''),
      ),
    );
    if (habits.length > 0) right.appendChild(h('div', { cls: 'helm-plan-group' }, h('div', { cls: 'helm-plan-group-title', text: 'Habits' }), h('div', { cls: 'helm-habit-chips' }, ...habits.map((hb) => chip(`${hb.icon ? hb.icon + ' ' : ''}${hb.title}`, 'habit')))));
    const dayItems = h('div', { cls: 'helm-plan-group' }, h('div', { cls: 'helm-plan-group-title', text: 'Already on the day' }));
    if (existing.length === 0) dayItems.appendChild(h('div', { cls: 'helm-hint', text: 'Nothing yet.' }));
    for (const t of existing) {
      const off = removed.has(t.key);
      dayItems.appendChild(h('div', { cls: ['helm-plan-item', off && 'is-removed'] },
        h('div', { cls: 'helm-plan-item-main' }, h('div', { cls: 'helm-plan-item-text' }, richText(taskLabel(t))), h('div', { cls: 'helm-task-meta' }, t.projectTitle ? chip(t.projectTitle, 'project') : null, chip(minutesToHuman(effortOf(t, settings)), 'effort'))),
        button('', { icon: off ? 'undo-2' : 'x', title: off ? 'Keep' : 'Take off the day', onClick: () => { if (off) removed.delete(t.key); else removed.add(t.key); render(); } }),
      ));
    }
    right.appendChild(dayItems);
    const pickedItems = h('div', { cls: 'helm-plan-group' }, h('div', { cls: 'helm-plan-group-title', text: `Adding (${picked.size})` }));
    if (picked.size === 0) pickedItems.appendChild(h('div', { cls: 'helm-hint', text: 'Pick tasks on the left.' }));
    for (const k of picked) {
      const t = snap.tasks.get(k);
      if (!t) continue;
      const cur = parts.get(k) ?? 'anytime';
      pickedItems.appendChild(h('div', { cls: 'helm-plan-item is-picked' },
        h('div', { cls: 'helm-plan-item-main' }, h('div', { cls: 'helm-plan-item-text' }, richText(taskLabel(t))), h('div', { cls: 'helm-task-meta' }, t.projectTitle ? chip(t.projectTitle, 'project') : null, chip(minutesToHuman(effortOf(t, settings)), 'effort')),
          h('div', { cls: 'helm-segmented helm-plan-parts' }, ...(['morning', 'afternoon', 'evening', 'anytime'] as DayPart[]).map((p) => h('button', { cls: ['helm-seg', cur === p && 'is-active'], text: PART_LABEL[p], onClick: (ev) => { ev.stopPropagation(); parts.set(k, p); render(); } })))),
        button('', { icon: 'x', title: 'Remove', onClick: () => { picked.delete(k); parts.delete(k); render(); } }),
      ));
    }
    right.appendChild(pickedItems);
    foot.replaceChildren(
      h('span', { cls: 'helm-hint', text: `${picked.size} to add · ${removed.size} to remove` }),
      h('span', { cls: 'helm-spacer' }),
      button('Cancel', { onClick: () => m.close() }),
      button('Write plan to daily note', { primary: true, icon: 'pen-line', onClick: () => void commit() }),
    );
  };
  filter.addEventListener('input', render);

  async function commit(): Promise<void> {
    m.close();
    const add = [...picked].map((key) => ({ key, ...(parts.get(key) ? { part: parts.get(key)! } : {}) }));
    const rem = [...removed];
    await ctx.run('Plan day', async () => {
      await ctx.mutations.planDay(date, add);
      for (const k of rem) await ctx.mutations.schedule(k, undefined);
    });
  }

  root.append(filter, h('div', { cls: 'helm-plan-cols' }, left, right), foot);
  render();
  m.open();
  setTimeout(() => filter.focus(), 0);
}
