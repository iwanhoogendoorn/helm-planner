/** Follow up: continue a task another day, with its own title, tagged and linked to the original. */
import { Modal } from 'obsidian';
import type { Task } from '../../core/types';
import { addDays, humanDate, startOfWeek } from '../../core/dates';
import { DAY_PARTS, type DayPart } from '../../core/dailyNote';
import { PART_LABEL } from '../../core/dailyNote';
import { button, h } from '../dom';
import { effortField, linkTimes, wikilinkSuggest } from '../fields';
import { minutesToHuman } from '../../core/dates';
import type { UiContext } from '../context';

export function openFollowUp(ctx: UiContext, task: Task): void {
  const today = ctx.today();
  const tag = (ctx.settings().followupTag.trim() || 'followup').replace(/^#/, '');
  const m = new Modal(ctx.app);
  m.titleEl.setText('Follow up');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-followup');
  const text = h('input', { cls: 'helm-input-wide', attr: { type: 'text', value: task.text.replace(new RegExp(`\\s*#${tag}(\\s|$)`), ' ').trim(), placeholder: 'What comes next?' } });
  wikilinkSuggest(ctx, text);
  let date = addDays(today, 1);
  const dateInput = h('input', { attr: { type: 'date', value: date } });
  dateInput.addEventListener('change', () => { if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput.value)) { date = dateInput.value; drawPresets(); } });
  const presets = h('div', { cls: 'helm-presets' });
  const nextMonday = addDays(startOfWeek(today, ctx.settings().weekStartsOn), 7);
  const options: [string, string][] = [['Tomorrow', addDays(today, 1)], ['In 2 days', addDays(today, 2)], ['In 3 days', addDays(today, 3)], ['Next week', nextMonday], ['In a week', addDays(today, 7)]];
  const drawPresets = (): void => { presets.replaceChildren(...options.map(([label, d]) => h('button', { cls: ['helm-seg', date === d && 'is-active'], text: label, title: humanDate(d, today, { year: true }), onClick: () => { date = d; dateInput.value = d; drawPresets(); } }))); };
  drawPresets();
  // No pick = decided by the time, else the original's part.
  let part: DayPart | undefined;
  const parts = h('div', { cls: 'helm-segmented' });
  const drawParts = (): void => { parts.replaceChildren(h('button', { cls: ['helm-seg', part === undefined && 'is-active'], text: 'By time', title: 'Follows the time, else the original’s part', onClick: () => { part = undefined; drawParts(); } }), ...DAY_PARTS.filter((p) => p !== 'anytime').map((p) => h('button', { cls: ['helm-seg', part === p && 'is-active'], text: PART_LABEL[p], onClick: () => { part = p; drawParts(); } }))); };
  drawParts();
  // Time and effort, prefilled from the original and kept consistent (start + effort → end).
  const timeStart = h('input', { attr: { type: 'time', value: task.time?.start ?? '' }, title: 'Start time' });
  const timeEnd = h('input', { attr: { type: 'time', value: task.time?.end ?? '' }, title: 'End time' });
  const effort = effortField(task.effortMinutes);
  linkTimes(timeStart, timeEnd, effort);
  const open = !['done', 'cancelled', 'forwarded'].includes(task.status);
  const markDone = h('input', { attr: { type: 'checkbox', checked: open } });
  const field = (label: string, ...els: HTMLElement[]): HTMLElement => h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: label }), ...els);
  root.append(
    h('div', { cls: 'helm-hint' }, h('span', { text: 'Continues: ' }), h('strong', { text: task.text })),
    field('Next step', text),
    field('When', h('div', { cls: 'helm-row' }, dateInput), presets),
    field('Part of the day', parts),
    h('div', { cls: 'helm-grid2' },
      field('Time', h('span', { cls: 'helm-capture-time' }, timeStart, h('span', { cls: 'helm-hint', text: '–' }), timeEnd)),
      field('Effort', effort.el),
    ),
    ...(open ? [h('label', { cls: 'helm-toggle' }, markDone, h('span', { text: 'Mark the original done now' }))] : []),
    h('div', { cls: 'helm-hint', text: `The follow-up gets #${tag} and waits on the original (⛔), so it shows as “follows …” and unblocks when the original is ticked.` }),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button('Create follow-up', { primary: true, icon: 'corner-down-right', onClick: () => void create() })),
  );
  async function create(): Promise<void> {
    if (text.value.trim() === '') { ctx.notify('Give the follow-up a title.'); text.focus(); return; }
    m.close();
    await ctx.run('Follow up', async () => {
      const time = timeStart.value ? { start: timeStart.value, ...(timeEnd.value ? { end: timeEnd.value } : {}) } : undefined;
      const eff = effort.get();
      const r = await ctx.mutations.followUp(task.key, { text: text.value, date, ...(part ? { part } : {}), markOriginalDone: open && markDone.checked, fields: { ...(time ? { time } : {}), ...(eff ? { effortMinutes: eff, effortRaw: minutesToHuman(eff) } : {}) } });
      ctx.notify(`Follow-up planned for ${humanDate(r.date, today)}.`);
    });
  }
  text.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void create(); } });
  m.open();
  ctx.trackModal(m);
  setTimeout(() => { text.focus(); text.select(); }, 0);
}
