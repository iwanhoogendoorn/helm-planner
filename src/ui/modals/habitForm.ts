import { Modal } from 'obsidian';
import type { Habit } from '../../core/types';
import { formatRecurrence, parseRecurrence } from '../../core/recurrence';
import { button, h } from '../dom';
import type { UiContext } from '../context';

export function openHabitForm(ctx: UiContext, existing?: Habit): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(existing ? 'Edit habit' : 'New habit');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-habit-form');
  const title = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder: 'Morning workout', value: existing?.title ?? '' } });
  const icon = h('input', { attr: { type: 'text', placeholder: '🏃', value: existing?.icon ?? '', maxlength: 4 } });
  const schedule = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder: 'every day · every weekday · every week on monday, thursday', value: existing ? existing.schedule.raw : 'every day' } });
  const preview = h('div', { cls: 'helm-hint' });
  const target = h('input', { attr: { type: 'number', min: 0, max: 7, placeholder: 'times per week (optional)', value: existing?.targetPerWeek ?? '' } });
  const grace = h('input', { attr: { type: 'number', min: 0, max: 7, value: existing?.graceDays ?? 0 } });
  const active = h('input', { attr: { type: 'checkbox', checked: existing ? existing.active : true } });
  const render = (): void => { const r = parseRecurrence(schedule.value); preview.textContent = r.parsed ? `Understood as: ${formatRecurrence(r)}` : 'Not a schedule I understand'; };
  schedule.addEventListener('input', render);
  render();
  const field = (label: string, ...els: HTMLElement[]): HTMLElement => h('label', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: label }), ...els);
  root.append(
    h('div', { cls: 'helm-row' }, field('Icon', icon), field('Name', title)),
    field('Schedule', schedule), preview,
    h('div', { cls: 'helm-grid3' }, field('Target / week', target), field('Grace days', grace), field('Active', active)),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button(existing ? 'Save' : 'Create habit', { primary: true, onClick: () => void save() })),
  );
  async function save(): Promise<void> {
    const r = parseRecurrence(schedule.value);
    if (title.value.trim() === '' || !r.parsed) { ctx.notify('Name and a valid schedule are required.'); return; }
    m.close();
    const tpw = target.value ? Number(target.value) : undefined;
    await ctx.run(existing ? 'Save habit' : 'Create habit', () => existing
      ? ctx.mutations.setHabitFields(existing.id, { title: title.value.trim(), schedule: formatRecurrence(r), active: active.checked, graceDays: Number(grace.value) || 0, targetPerWeek: tpw ?? null, icon: icon.value.trim() })
      : ctx.mutations.createHabit({ title: title.value.trim(), schedule: formatRecurrence(r), graceDays: Number(grace.value) || 0, ...(tpw ? { targetPerWeek: tpw } : {}), ...(icon.value.trim() ? { icon: icon.value.trim() } : {}) }));
  }
  m.open();
  ctx.trackModal(m);
  setTimeout(() => title.focus(), 0);
}
