/** Deleting one turn of a repeating task: is it this week, or is the whole thing over? */
import { Modal } from 'obsidian';
import type { Task } from '../../core/types';
import { formatRecurrence } from '../../core/recurrence';
import { shortLabel } from '../../core/label';
import { humanDate } from '../../core/dates';
import { button, h } from '../dom';
import type { UiContext } from '../context';

export function openRecurringDelete(ctx: UiContext, task: Task, onDone?: () => void): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText('Delete a repeating task');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-recurring-delete');
  const when = task.noteDate ?? task.scheduled;
  const every = task.recurrence ? formatRecurrence(task.recurrence) : 'repeating';
  const run = (mode: 'once' | 'series'): void => {
    m.close();
    void ctx.run('Delete', async () => {
      const r = await ctx.mutations.deleteOccurrence(task.key, mode);
      ctx.notify(mode === 'once'
        ? `${when ? `${humanDate(when, ctx.today())}: ` : ''}skipped — the next turn still comes.`
        : `Stopped repeating${r.stopped ? '' : ''} — no later turn will appear.`);
      onDone?.();
    });
  };
  root.append(
    h('div', { cls: 'helm-hint' }, h('strong', { text: shortLabel(task.text, 70) }), h('span', { text: ` · ${every}` })),
    h('p', { cls: 'helm-hint', text: 'Deleting only this turn would bring it back: Helm fills in turns it thinks went missing. So say which you mean.' }),
    h('div', { cls: 'helm-modal-buttons helm-recurring-choices' },
      button(when ? `Just ${humanDate(when, ctx.today())}` : 'Just this one', { icon: 'calendar-x', title: 'Delete this turn and remember it — later turns carry on', onClick: () => run('once') }),
      button('Stop repeating', { icon: 'trash', cls: 'mod-warning', title: 'Delete this turn and end the series — no later turn appears', onClick: () => run('series') }),
      h('span', { cls: 'helm-spacer' }),
      button('Cancel', { onClick: () => m.close() }),
    ),
  );
  m.open();
  ctx.trackModal(m);
}
