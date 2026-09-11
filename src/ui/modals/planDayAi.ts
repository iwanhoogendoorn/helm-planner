/**
 * “Plan my day”: propose, adjust, confirm.
 *
 * Helm asks Claude how long each task really takes and in what order to do them, lays that out as
 * stretches of work with breaks between, and shows you the day before a single character is written.
 * Every number is yours to change — the minutes, the order, what gets left out — and nothing touches
 * the vault until you press Plan the day.
 */
import { Modal } from 'obsidian';
import type { IsoDate, Task } from '../../core/types';
import { humanDate, minutesToHuman } from '../../core/dates';
import { layOutDayPlan, type FocusSettings, type PlanBlock } from '../../core/pomodoro';
import { focusFrom, planRequestFor, proposalChanges, proposePlan, type PlanRequest, type Proposal } from '../../data/ai';
import { button, chip, h, icon } from '../dom';
import type { UiContext } from '../context';
import { plainLabel } from '../../core/label';

/** The focus settings, as the user has them. */
export function focusOf(ctx: UiContext): FocusSettings { return focusFrom(ctx.settings()); }

/** What Helm asks about: the day's open work, and what is already booked in it. */
export function requestFor(ctx: UiContext, date: IsoDate): { req: PlanRequest; tasks: Map<string, Task> } {
  return planRequestFor(ctx.index.snapshot, date, ctx.settings());
}

export function openPlanDayAi(ctx: UiContext, date: IsoDate): void {
  const { req, tasks } = requestFor(ctx, date);
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Plan ${humanDate(date, ctx.today())}`);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-planai');

  if (req.tasks.length === 0) {
    root.appendChild(h('div', { cls: 'helm-hint', text: 'Nothing without a time on this day to plan. Add some tasks first — Helm plans what is already there.' }));
    root.appendChild(h('div', { cls: 'helm-modal-buttons' }, button('Close', { primary: true, onClick: () => m.close() })));
    m.open();
    ctx.trackModal(m);
    return;
  }

  const body = h('div', { cls: 'helm-planai-body' }, h('div', { cls: 'helm-hint' }, icon('loader'), h('span', { text: 'Asking Claude how long this really takes…' })));
  root.append(body);
  m.open();
  ctx.trackModal(m);

  void proposePlan(req, ctx.runClaude).then((proposal) => draw(proposal));

  /** Minutes per task, as they stand — the model's answer to begin with, then whatever you type. */
  let minutes: Record<string, number> = {};
  let order: string[] = [];
  let dropped = new Set<string>();

  const relayout = (): ReturnType<typeof layOutDayPlan> =>
    layOutDayPlan(order.filter((k) => !dropped.has(k)).map((k) => ({ key: k, minutes: minutes[k] ?? 30 })), { ...req.focus, from: req.from, to: req.to, busy: req.busy });

  function draw(p: Proposal): void {
    if (Object.keys(minutes).length === 0) {
      minutes = { ...p.answer.minutes };
      order = [...p.answer.order, ...p.overflow.map((o) => o.key).filter((k) => !p.answer.order.includes(k))];
      dropped = new Set(p.overflow.map((o) => o.key));
    }
    const laid = relayout();
    const rows = h('div', { cls: 'helm-planai-rows' });
    for (const key of order) {
      const task = tasks.get(key);
      if (!task) continue;
      const blocks = laid.blocks.filter((b) => b.taskKey === key && b.kind === 'focus');
      const num = h('input', { cls: 'helm-planai-min', attr: { type: 'number', min: '5', step: '5', value: String(minutes[key] ?? 30) } });
      num.addEventListener('change', () => { minutes[key] = Math.max(5, Math.round(Number(num.value) || 30)); draw(p); });
      const out = dropped.has(key);
      // Four columns and a line of its own for the reasoning: a task's name is worth more room than a
      // truncated tail, and the times line up down the day rather than landing wherever the words end.
      rows.appendChild(h('div', { cls: ['helm-planai-row', out && 'is-out'] },
        h('button', {
          cls: 'helm-planai-toggle', title: out ? 'Bring it back into the day' : 'Leave it out of today',
          onClick: () => { if (out) dropped.delete(key); else dropped.add(key); draw(p); },
        }, icon(out ? 'plus-circle' : 'minus-circle')),
        h('span', { cls: 'helm-planai-text', text: plainLabel(task.text), attr: { title: plainLabel(task.text) } }),
        h('span', { cls: 'helm-planai-mins' }, num, h('span', { cls: 'helm-hint', text: 'min' })),
        h('span', { cls: 'helm-planai-times' },
          ...(out
            ? [chip('another day', 'warn')]
            : blocks.map((b) => chip(`${b.start}–${b.end}${b.of && b.of > 1 ? ` (${b.index}/${b.of})` : ''}`, 'time')))),
        p.answer.notes?.[key] ? h('span', { cls: 'helm-hint helm-planai-note', text: p.answer.notes[key]! }) : null,
      ));
    }

    const capacity = req.capacityMinutes;
    const over = laid.focusMinutes > capacity;
    body.replaceChildren(
      h('div', { cls: 'helm-planai-head' },
        chip(p.source === 'claude' ? 'Claude’s plan' : 'Helm’s own sizing', p.source === 'claude' ? 'project' : 'note'),
        chip(`${minutesToHuman(laid.focusMinutes)} of work`, over ? 'effort is-over' : 'effort', `Your day holds about ${minutesToHuman(capacity)}`),
        chip(`${minutesToHuman(laid.breakMinutes)} of breaks`, 'count'),
        laid.overflow.length + dropped.size > 0 ? chip(`${new Set([...laid.overflow.map((o) => o.key), ...dropped]).size} for another day`, 'warn') : null,
        p.error ? h('span', { cls: 'helm-hint', text: `Claude could not be reached (${p.error}); these are Helm’s own estimates.` }) : null,
      ),
      rows,
      h('div', { cls: 'helm-hint', text: 'Change the minutes, or drop a task out of the day. Nothing is written until you say so.' }),
      h('div', { cls: 'helm-modal-buttons' },
        button('Cancel', { onClick: () => m.close() }),
        button('Plan the day', { primary: true, onClick: () => { m.close(); void write(relayout().blocks); } }),
      ),
    );
  }

  /** Write the agreed times onto the tasks; what was dropped simply loses its time. */
  async function write(blocks: PlanBlock[]): Promise<void> {
    const changes = proposalChanges(blocks, minutes);
    await ctx.run('Plan the day', async () => {
      for (const c of changes) await ctx.mutations.updateTask(c.key, { time: { start: c.start, end: c.end }, effortMinutes: c.effortMinutes });
      ctx.notify(`Planned ${changes.length} task${changes.length === 1 ? '' : 's'}${dropped.size ? `, ${dropped.size} left for another day` : ''}.`);
    });
  }
}
