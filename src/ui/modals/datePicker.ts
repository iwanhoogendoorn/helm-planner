import { Modal } from 'obsidian';
import type { IsoDate } from '../../core/types';
import { addDays, humanDate, isIsoDate, startOfWeek } from '../../core/dates';
import { resolveDate } from '../../core/nlp';
import { button, h } from '../dom';
import type { UiContext } from '../context';

export function openDatePicker(ctx: UiContext, opts: { title: string; initial?: IsoDate; allowClear?: boolean }, onPick: (d: IsoDate | undefined) => void): void {
  const today = ctx.today();
  const m = new Modal(ctx.app);
  m.titleEl.setText(opts.title);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-datepicker');
  const input = h('input', { attr: { type: 'date', value: opts.initial ?? today } });
  const free = h('input', { attr: { type: 'text', placeholder: 'or type: fri, next week, in 3 days, 12/9…' } });
  const preview = h('div', { cls: 'helm-hint' });
  const commit = (d: IsoDate | undefined): void => { m.close(); onPick(d); };
  free.addEventListener('input', () => {
    const d = resolveDate(free.value, today, ctx.settings().weekStartsOn);
    preview.textContent = d ? humanDate(d, today, { year: true }) : free.value ? 'Not a date I understand' : '';
    if (d) input.value = d;
  });
  free.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const d = resolveDate(free.value, today, ctx.settings().weekStartsOn) ?? (isIsoDate(input.value) ? input.value : undefined); if (d) commit(d); } });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && isIsoDate(input.value)) commit(input.value); });
  const ws = startOfWeek(today, ctx.settings().weekStartsOn);
  const presets = [
    ['Today', today], ['Tomorrow', addDays(today, 1)], ['+2 days', addDays(today, 2)], ['Sat', addDays(ws, 5)],
    ['Next week', addDays(ws, 7)], ['+2 weeks', addDays(today, 14)], ['+1 month', addDays(today, 30)],
  ] as const;
  root.append(
    h('div', { cls: 'helm-presets' }, ...presets.map(([label, d]) => button(label, { onClick: () => commit(d), title: humanDate(d, today, { year: true }) }))),
    h('div', { cls: 'helm-row' }, input, free),
    preview,
    h('div', { cls: 'helm-modal-buttons' },
      opts.allowClear ? button('Clear', { onClick: () => commit(undefined) }) : null,
      button('Cancel', { onClick: () => m.close() }),
      button('Pick', { primary: true, onClick: () => { if (isIsoDate(input.value)) commit(input.value); } }),
    ),
  );
  m.open();
  setTimeout(() => free.focus(), 0);
}
