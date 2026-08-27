/** Edit every field of a task in one form. */
import { Modal } from 'obsidian';
import type { IsoDate, Priority, Task, TaskLine, TaskStatus } from '../../core/types';
import { isIsoDate, minutesToHuman } from '../../core/dates';
import { formatRecurrence, parseRecurrence } from '../../core/recurrence';
import { PRIORITY_ORDER } from '../../core/taskLine';
import { button, h } from '../dom';
import type { UiContext } from '../context';
import { drawingsSection, targetForTask } from '../drawings';
import { notesSection } from '../notes';
import { openFollowUp } from './followUp';
import { STATUS_LABELS, pickProject } from '../menus';
import { DAY_PARTS, PART_LABEL } from '../../core/dailyNote';
import { effortField, linkTimes , wikilinkSuggest } from '../fields';

export function openTaskEditor(ctx: UiContext, task: Task): void {
  const src = task.origin === 'daily-mirror' && task.mirrorOf ? ctx.index.task(task.mirrorOf) ?? task : task;
  const m = new Modal(ctx.app);
  m.titleEl.setText('Edit task');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-task-editor');
  const today = ctx.today();

  const text = h('input', { cls: 'helm-input-wide', attr: { type: 'text', value: src.text } });
  wikilinkSuggest(ctx, text);
  const status = h('select');
  for (const s of Object.keys(STATUS_LABELS) as TaskStatus[]) status.appendChild(h('option', { text: STATUS_LABELS[s].label, attr: { value: s, selected: src.status === s } }));
  const priority = h('select');
  for (const p of PRIORITY_ORDER) priority.appendChild(h('option', { text: p, attr: { value: p, selected: src.priority === p } }));
  const scheduled = h('input', { attr: { type: 'date', value: src.scheduled ?? (src.origin === 'daily' ? src.noteDate : '') ?? '' } });
  const due = h('input', { attr: { type: 'date', value: src.due ?? '' } });
  const start = h('input', { attr: { type: 'date', value: src.start ?? '' } });
  const effort = effortField(src.effortMinutes);
  const recurrence = h('input', { attr: { type: 'text', placeholder: 'every week on monday', value: src.recurrence ? src.recurrence.raw : '' } });
  const timeStart = h('input', { attr: { type: 'time', value: src.time?.start ?? '' } });
  const timeEnd = h('input', { attr: { type: 'time', value: src.time?.end ?? '' } });
  linkTimes(timeStart, timeEnd, effort);
  const blockedBy = h('input', { attr: { type: 'text', placeholder: 'tsk-abc123, tsk-def456', value: src.blockedBy.join(', ') } });
  const onDay = task.noteDate !== undefined && task.section !== 'outside';
  const partSel = h('select');
  for (const p of DAY_PARTS) partSel.appendChild(h('option', { text: PART_LABEL[p], attr: { value: p, selected: (task.part ?? 'anytime') === p } }));
  partSel.disabled = !onDay;
  const where = h('div', { cls: 'helm-hint', text: locationLabel(ctx, src) });

  const field = (label: string, ...els: HTMLElement[]): HTMLElement => h('label', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: label }), ...els);
  root.append(
    field('Text', text),
    h('div', { cls: 'helm-grid2' }, field('Status', status), field('Priority', priority)),
    h('div', { cls: 'helm-grid3' }, field('Planned for', h('div', { cls: 'helm-row' }, scheduled, partSel)), field('Due', due), field('Start (not before)', start)),
    h('div', { cls: 'helm-grid3' }, field('Effort', effort.el), field('Time block', h('div', { cls: 'helm-row' }, timeStart, timeEnd)), field('Repeat', recurrence)),
    field('Blocked by (ids)', blockedBy),
    where,
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Notes' }), notesSection(ctx, targetForTask(task))),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Drawings' }), drawingsSection(ctx, targetForTask(task))),
    h('div', { cls: 'helm-modal-buttons' },
      button('Follow up…', { icon: 'corner-down-right', cls: 'helm-btn-quiet', title: 'Continue this task another day', onClick: () => { m.close(); openFollowUp(ctx, task); } }),
      button('Move to project…', { icon: 'folder-input', onClick: () => pickProject(ctx, (p, phaseId) => { m.close(); void ctx.run('Move', () => ctx.mutations.moveToProject(src.key, p.id, phaseId)); }, { phases: true }) }),
      button('Open note', { icon: 'file-text', onClick: () => { m.close(); void ctx.openFile(src.path, src.line); } }),
      h('span', { cls: 'helm-spacer' }),
      button('Cancel', { onClick: () => m.close() }),
      button('Save', { primary: true, onClick: () => void save() }),
    ),
  );
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) void save(); });

  async function save(): Promise<void> {
    const patch: Partial<TaskLine> & { scheduled?: IsoDate | undefined } = {};
    const t = text.value.trim();
    if (t !== src.text) patch.text = t;
    if (status.value !== src.status) patch.status = status.value as TaskStatus;
    if (priority.value !== src.priority) patch.priority = priority.value as Priority;
    const dv = due.value && isIsoDate(due.value) ? due.value : undefined;
    if (dv !== src.due) patch.due = dv;
    const sv = start.value && isIsoDate(start.value) ? start.value : undefined;
    if (sv !== src.start) patch.start = sv;
    const min = effort.get();
    if (min === undefined) { if (src.effortMinutes !== undefined) { patch.effortMinutes = undefined; patch.effortRaw = undefined; } }
    else if (min !== src.effortMinutes) { patch.effortMinutes = min; patch.effortRaw = minutesToHuman(min); }
    const rv = recurrence.value.trim();
    if (rv === '') { if (src.recurrence) patch.recurrence = undefined; }
    else if (rv !== src.recurrence?.raw) { const r = parseRecurrence(rv); if (!r.parsed) { ctx.notify(`I do not understand “${rv}”. Try “every week on monday”.`); return; } patch.recurrence = { ...r, raw: formatRecurrence(r) }; }
    const ts = timeStart.value;
    const te = timeEnd.value;
    if (ts === '') { if (src.time) patch.time = undefined; }
    else if (ts !== src.time?.start || (te || undefined) !== src.time?.end) patch.time = { start: ts, ...(te ? { end: te } : {}) };
    const bb = blockedBy.value.split(/\s*,\s*/).map((s) => s.trim()).filter(Boolean);
    if (bb.join(',') !== src.blockedBy.join(',')) patch.blockedBy = bb;
    const sched = scheduled.value && isIsoDate(scheduled.value) ? scheduled.value : undefined;
    const currentSched = src.scheduled ?? (src.origin === 'daily' ? src.noteDate : undefined);
    if (sched !== currentSched) patch.scheduled = sched;
    const newPart = partSel.value as 'morning' | 'afternoon' | 'evening' | 'anytime';
    const partChanged = onDay && newPart !== (task.part ?? 'anytime');
    m.close();
    if (Object.keys(patch).length === 0 && !partChanged) return;
    await ctx.run('Save task', async () => {
      if (Object.keys(patch).length > 0) await ctx.mutations.updateTask(src.key, patch);
      if (partChanged && !patch.scheduled) await ctx.mutations.setPart(task.key, newPart);
    });
    void today;
  }

  m.open();
  ctx.trackModal(m);
  setTimeout(() => { text.focus(); text.select(); }, 0);
}

export function locationLabel(ctx: UiContext, t: Task): string {
  const name = t.path.slice(t.path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  switch (t.origin) {
    case 'project': return `Lives in project “${t.projectTitle ?? name}”${t.phaseTitle ? `, phase “${t.phaseTitle}”` : ''}${t.scheduled ? ` · mirrored into the daily note for ${t.scheduled}` : ''}.`;
    case 'daily': return `Lives in the daily note for ${t.noteDate}.`;
    case 'daily-mirror': return `Mirror line in the daily note for ${t.noteDate}; the source is ${t.mirrorLink ?? 'unknown'}.`;
    case 'inbox': return `In the inbox (${ctx.settings().inboxNote}).`;
    default: return `In note “${name}”.`;
  }
}
