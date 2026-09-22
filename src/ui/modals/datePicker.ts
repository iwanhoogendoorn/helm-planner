import { Modal } from 'obsidian';
import type { IsoDate } from '../../core/types';
import { DAY_PARTS, PART_LABEL, type DayPart } from '../../core/dailyNote';
import { addDays, humanDate, isIsoDate, startOfWeek, WEEKDAY_SHORT, isoWeekday } from '../../core/dates';
import { resolveDate } from '../../core/nlp';
import { button, h } from '../dom';
import type { UiContext } from '../context';
import { effortField, linkTimes } from '../fields';

/** A start and an end for the day picked; either may be left empty. */
export interface PickedTime { start: string; end?: string }

export function openDatePicker(ctx: UiContext, opts: { title: string; initial?: IsoDate; allowClear?: boolean; parts?: boolean; part?: DayPart; times?: { start?: string; end?: string; effortMinutes?: number } }, onPick: (d: IsoDate | undefined, part?: DayPart, time?: PickedTime) => void): void {
  const today = ctx.today();
  const m = new Modal(ctx.app);
  m.titleEl.setText(opts.title);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-datepicker');
  const input = h('input', { attr: { type: 'date', value: opts.initial ?? today } });
  const free = h('input', { attr: { type: 'text', placeholder: 'or type: fri, next week, in 3 days, 12/9…' } });
  const preview = h('div', { cls: 'helm-hint' });
  // Undefined part = leave the task where it is in the day; 'anytime' takes it out of a part.
  let part: DayPart | undefined = opts.part;
  const partRow = h('div', { cls: 'helm-segmented helm-datepicker-parts' });
  const drawParts = (): void => {
    partRow.replaceChildren(
      h('button', { cls: ['helm-seg', part === undefined && 'is-active'], text: 'Keep', title: 'Leave the part of the day as it is', onClick: () => { part = undefined; drawParts(); } }),
      ...DAY_PARTS.map((p) => h('button', { cls: ['helm-seg', part === p && 'is-active'], text: PART_LABEL[p], onClick: () => { part = p; drawParts(); } })),
    );
  };
  if (opts.parts) drawParts();
  // The time, when the caller wants one: start and end kept together, the length carried along.
  const timeStart = h('input', { attr: { type: 'time', value: opts.times?.start ?? '' }, title: 'Start time' });
  const timeEnd = h('input', { attr: { type: 'time', value: opts.times?.end ?? '' }, title: 'End time' });
  const effort = effortField(opts.times?.effortMinutes);
  if (opts.times) linkTimes(timeStart, timeEnd, effort);
  const pickedTime = (): PickedTime | undefined => (opts.times && /^\d{2}:\d{2}$/.test(timeStart.value) ? { start: timeStart.value, ...(/^\d{2}:\d{2}$/.test(timeEnd.value) ? { end: timeEnd.value } : {}) } : undefined);
  const commit = (d: IsoDate | undefined): void => { m.close(); onPick(d, part, pickedTime()); };
  free.addEventListener('input', () => {
    const d = resolveDate(free.value, today, ctx.settings().weekStartsOn);
    preview.textContent = d ? humanDate(d, today, { year: true }) : free.value ? 'Not a date I understand' : '';
    if (d) input.value = d;
  });
  free.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { const d = resolveDate(free.value, today, ctx.settings().weekStartsOn) ?? (isIsoDate(input.value) ? input.value : undefined); if (d) commit(d); } });
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && isIsoDate(input.value)) commit(input.value); });
  const ws = startOfWeek(today, ctx.settings().weekStartsOn);
  // Every preset says what it means. “+1 week” keeps the weekday, the way “+2 weeks” and “+1 month” do;
  // the one that snaps to the start of next week is named after the day it lands on, not after “next
  // week” — from a Sunday those are a day apart, and a wrong guess moves real work to the wrong day.
  const startNext = addDays(ws, 7);
  const presets = [
    ['Today', today], ['Tomorrow', addDays(today, 1)], ['+2 days', addDays(today, 2)], ['Sat', addDays(ws, 5)],
    [`+1 week (${WEEKDAY_SHORT[isoWeekday(addDays(today, 7)) - 1]})`, addDays(today, 7)],
    [`Next ${WEEKDAY_SHORT[isoWeekday(startNext) - 1]}`, startNext],
    ['+2 weeks', addDays(today, 14)], ['+1 month', addDays(today, 30)],
  ] as const;
  root.append(
    h('div', { cls: 'helm-presets' }, ...presets.map(([label, d]) => button(label, { onClick: () => commit(d), title: humanDate(d, today, { year: true }) }))),
    h('div', { cls: 'helm-row' }, input, free),
    preview,
    ...(opts.times ? [h('div', { cls: 'helm-field' },
      h('span', { cls: 'helm-field-label', text: 'Time' }),
      h('div', { cls: 'helm-row helm-datepicker-time' }, timeStart, h('span', { cls: 'helm-hint', text: '–' }), timeEnd, h('span', { cls: 'helm-hint', text: 'effort' }), effort.el),
      h('div', { cls: 'helm-hint', text: 'Leave the start empty to keep it untimed. With a time, “Keep” puts it in the part that time falls in.' }))] : []),
    ...(opts.parts ? [h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Part of the day' }), partRow)] : []),
    h('div', { cls: 'helm-modal-buttons' },
      opts.allowClear ? button('Clear', { onClick: () => commit(undefined) }) : null,
      button('Cancel', { onClick: () => m.close() }),
      button('Pick', { primary: true, onClick: () => { if (isIsoDate(input.value)) commit(input.value); } }),
    ),
  );
  m.open();
  ctx.trackModal(m);
  setTimeout(() => free.focus(), 0);
}
