/**
 * Wrap up the day: decide the fate of every open item — tomorrow, another
 * day, back off the calendar, done, or cancelled — then apply in one go.
 */
import { Modal } from 'obsidian';
import type { IsoDate, Task } from '../../core/types';
import { addDays, humanDate, minutesToHuman } from '../../core/dates';
import { dayPlan } from '../../data/planner';
import { button, chip, h, richText } from '../dom';
import type { UiContext } from '../context';
import { taskLabel } from '../context';
import { openDatePicker } from './datePicker';

type Fate = { kind: 'move'; date: IsoDate } | { kind: 'unschedule' } | { kind: 'done' } | { kind: 'cancel' } | { kind: 'keep' };

export function openWrapUp(ctx: UiContext, date: IsoDate): void {
  const today = ctx.today();
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const plan = dayPlan(snap, date, settings);
  const open: Task[] = [...plan.today.filter((t) => t.section !== 'outside'), ...plan.mirrors.map((x) => x.mirror), ...plan.unmirrored, ...plan.elsewhere].filter((t) => !['done', 'cancelled', 'forwarded'].includes(t.status));
  const tomorrow = addDays(date, 1);
  const fates = new Map<string, Fate>(open.map((t) => [t.key, settings.rolloverTarget === 'tomorrow' ? { kind: 'move', date: tomorrow } : { kind: 'unschedule' }]));
  let note = '';

  const m = new Modal(ctx.app);
  m.titleEl.setText(`Wrap up ${humanDate(date, today, { year: true })}`);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-wrapup');
  const summary = h('div', { cls: 'helm-wrapup-summary' },
    h('div', { cls: 'helm-stat' }, h('div', { cls: 'helm-stat-value', text: String(plan.doneCount) }), h('div', { cls: 'helm-stat-label', text: 'done' })),
    h('div', { cls: 'helm-stat' }, h('div', { cls: 'helm-stat-value', text: String(open.length) }), h('div', { cls: 'helm-stat-label', text: 'still open' })),
    h('div', { cls: 'helm-stat' }, h('div', { cls: 'helm-stat-value', text: minutesToHuman(plan.doneMinutes) }), h('div', { cls: 'helm-stat-label', text: 'worked (est.)' })),
  );
  const list = h('div', { cls: 'helm-wrapup-list' });
  const noteInput = h('textarea', { cls: 'helm-input-wide', attr: { rows: 2, placeholder: 'One line for the day (optional) — logged to each project you touched' } });
  noteInput.addEventListener('input', () => { note = noteInput.value; });

  const fateLabel = (f: Fate): string => f.kind === 'move' ? (f.date === tomorrow ? 'Tomorrow' : humanDate(f.date, today)) : f.kind === 'unschedule' ? 'Off the calendar' : f.kind === 'done' ? 'Done' : f.kind === 'cancel' ? 'Cancelled' : 'Leave';

  const render = (): void => {
    list.replaceChildren();
    if (open.length === 0) list.appendChild(h('div', { cls: 'helm-empty' }, h('p', { text: 'Everything is closed. Clean sheet.' })));
    for (const t of open) {
      const f = fates.get(t.key)!;
      const seg = (label: string, kind: Fate['kind'], onClick?: () => void): HTMLElement => h('button', { cls: ['helm-seg', f.kind === kind && (kind !== 'move' || (f as { date: IsoDate }).date === tomorrow) && 'is-active'], text: label, onClick: onClick ?? (() => { fates.set(t.key, kind === 'move' ? { kind: 'move', date: tomorrow } : { kind } as Fate); render(); }) });
      list.appendChild(h('div', { cls: 'helm-wrapup-row' },
        h('div', { cls: 'helm-wrapup-task' }, h('div', { cls: 'helm-plan-item-text' }, richText(taskLabel(t))), h('div', { cls: 'helm-task-meta' }, t.projectTitle ? chip(t.projectTitle, 'project') : t.mirrorLink ? chip(t.mirrorLink.replace(/^\[\[|\]\]$/g, '').split('|').pop()!, 'project') : null, t.due ? chip(`due ${humanDate(t.due, today)}`, t.due < today ? 'due is-overdue' : 'due') : null)),
        h('div', { cls: 'helm-segmented' },
          seg('Tomorrow', 'move'),
          h('button', { cls: ['helm-seg', f.kind === 'move' && (f as { date: IsoDate }).date !== tomorrow && 'is-active'], text: f.kind === 'move' && (f as { date: IsoDate }).date !== tomorrow ? fateLabel(f) : 'Date…', onClick: () => openDatePicker(ctx, { title: `Move “${t.text}” to`, initial: tomorrow }, (d) => { if (d) { fates.set(t.key, { kind: 'move', date: d }); render(); } }) }),
          seg('Off calendar', 'unschedule'),
          seg('Done', 'done'),
          seg('Cancel', 'cancel'),
          seg('Leave', 'keep'),
        ),
      ));
    }
  };
  render();

  async function apply(): Promise<void> {
    m.close();
    await ctx.run('Wrap up', async () => {
      const touched = new Set<string>();
      for (const t of open) {
        const f = fates.get(t.key)!;
        if (t.projectId) touched.add(t.projectId);
        else if (t.origin === 'daily-mirror' && t.mirrorOf) { const s = ctx.index.task(t.mirrorOf); if (s?.projectId) touched.add(s.projectId); }
        switch (f.kind) {
          case 'move': {
            if (t.origin === 'daily-mirror' && date < today) {
              await ctx.mutations.setStatus(t.key, 'forwarded').catch(() => undefined);
            }
            await ctx.mutations.schedule(t.key, f.date);
            break;
          }
          case 'unschedule': await ctx.mutations.schedule(t.key, undefined); break;
          case 'done': await ctx.mutations.setStatus(t.key, 'done'); break;
          case 'cancel': await ctx.mutations.setStatus(t.key, 'cancelled'); break;
          case 'keep': break;
        }
      }
      for (const t of plan.done) { if (t.projectId) touched.add(t.projectId); }
      if (note.trim() !== '') for (const pid of touched) await ctx.mutations.appendLog(pid, note.trim());
      const moved = [...fates.values()].filter((f) => f.kind === 'move').length;
      ctx.notify(`Wrapped up: ${plan.doneCount} done, ${moved} carried forward.`);
    });
  }

  root.append(summary, list, noteInput, h('div', { cls: 'helm-modal-buttons' },
    h('span', { cls: 'helm-spacer' }),
    button('Cancel', { onClick: () => m.close() }),
    button('Apply', { primary: true, icon: 'check', onClick: () => void apply() }),
  ));
  m.open();
  ctx.trackModal(m);
}
