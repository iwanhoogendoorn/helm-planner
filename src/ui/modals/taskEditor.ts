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
import { linksSection } from '../links';
import { linkLabel, linksIn, textWithoutLinks } from '../../core/links';
import { openFollowUp } from './followUp';
import { conflictWarning, repeatButtons } from '../fields';
import { conflictsFor, describeConflicts, freeSlotOn, partWindow, preferredSlot } from '../../data/conflicts';
import { STATUS_LABELS, projectMenuForTask } from '../menus';
import { DAY_PARTS, PART_LABEL, type DayPart } from '../../core/dailyNote';
import { effortField, linkTimes , wikilinkSuggest } from '../fields';

export function openTaskEditor(ctx: UiContext, task: Task): void {
  const src = task.origin === 'daily-mirror' && task.mirrorOf ? ctx.index.task(task.mirrorOf) ?? task : task;
  const m = new Modal(ctx.app);
  m.titleEl.setText('Edit task');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-task-editor');
  const today = ctx.today();

  // Links are kept out of the Text field and managed in the Links section; Save puts them back on the line.
  let links = linksIn(src.text);
  const text = h('input', { cls: 'helm-input-wide', attr: { type: 'text', value: textWithoutLinks(src.text) } });
  wikilinkSuggest(ctx, text);
  const status = h('select');
  for (const s of Object.keys(STATUS_LABELS) as TaskStatus[]) status.appendChild(h('option', { text: STATUS_LABELS[s].label, attr: { value: s, selected: src.status === s } }));
  const priority = h('select');
  for (const p of PRIORITY_ORDER) priority.appendChild(h('option', { text: p, attr: { value: p, selected: src.priority === p } }));
  const scheduled = h('input', { attr: { type: 'date', value: src.scheduled ?? (src.origin === 'daily' ? src.noteDate : '') ?? '' } });
  const due = h('input', { attr: { type: 'date', value: src.due ?? '' } });
  const start = h('input', { attr: { type: 'date', value: src.start ?? '' } });
  const effort = effortField(src.effortMinutes);
  // How far along: a slider you can drag, a number you can type, and the quick steps.
  const progress = h('input', { cls: 'helm-progress-range', attr: { type: 'range', min: '0', max: '100', step: '5', value: String(src.progress ?? 0) } });
  const progressNum = h('input', { cls: 'helm-progress-num', attr: { type: 'number', min: '0', max: '100', value: src.progress === undefined ? '' : String(src.progress), placeholder: '—' } });
  const progressRow = h('div', { cls: 'helm-row helm-progress-row' }, progress, progressNum, h('span', { cls: 'helm-hint', text: '%' }));
  progress.addEventListener('input', () => { progressNum.value = progress.value === '0' ? '' : progress.value; });
  progressNum.addEventListener('input', () => { progress.value = progressNum.value === '' ? '0' : progressNum.value; });
  const recurrence = h('input', { attr: { type: 'text', placeholder: 'every week on monday', value: src.recurrence ? src.recurrence.raw : '' } });
  // The same buttons Capture offers, writing into the field rather than into a sentence.
  const repeatRow = h('div', { cls: 'helm-capture-tags helm-capture-repeat' });
  const drawRepeat = (): void => repeatButtons(repeatRow, parseRecurrence(recurrence.value.trim()), (phrase) => { recurrence.value = phrase ?? ''; drawRepeat(); }, '');
  recurrence.addEventListener('input', drawRepeat);
  drawRepeat();
  const timeStart = h('input', { attr: { type: 'time', value: src.time?.start ?? '' } });
  const timeEnd = h('input', { attr: { type: 'time', value: src.time?.end ?? '' } });
  linkTimes(timeStart, timeEnd, effort);
  const conflict = h('div', { cls: 'helm-conflict' });
  let conflictText: string | undefined;
  const checkConflicts = (): void => {
    const day = /^\d{4}-\d{2}-\d{2}$/.test(scheduled.value) ? scheduled.value : undefined;
    const time = timeStart.value ? { start: timeStart.value, ...(timeEnd.value ? { end: timeEnd.value } : {}) } : undefined;
    conflictText = day && time ? (describeConflicts(conflictsFor(ctx.index.snapshot, day, time, ctx.settings(), { effortMinutes: effort.get(), excludeKeys: [task.key, src.key, ...(src.id ? [src.id] : []), ...(task.mirrorOf ? [task.mirrorOf] : [])] })) || undefined) : undefined;
    const excl = [task.key, src.key, ...(src.id ? [src.id] : [])];
    const free = conflictText && day ? freeSlotOn(ctx.index.snapshot, day, ctx.settings(), { ...(partSel.value !== 'anytime' ? { part: partSel.value as DayPart } : {}), effortMinutes: effort.get() ?? ctx.settings().defaultEffortMinutes, notBefore: timeStart.value, excludeKeys: excl }) : undefined;
    conflictWarning(conflict, conflictText, free ? { time: free, onPick: () => setStart(free) } : undefined);
  };
  const setStart = (hhmm: string): void => { timeStart.value = hhmm; timeStart.dispatchEvent(new Event('input')); checkConflicts(); };
  for (const el of [timeStart, timeEnd, scheduled]) el.addEventListener('input', checkConflicts);
  scheduled.addEventListener('change', checkConflicts);
  effort.onChange(checkConflicts);
  setTimeout(checkConflicts, 0);
  const blockedBy = h('input', { attr: { type: 'text', placeholder: 'tsk-abc123, tsk-def456', value: src.blockedBy.join(', ') } });
  const onDay = task.noteDate !== undefined && task.section !== 'outside';
  const partSel = h('select');
  for (const p of DAY_PARTS) partSel.appendChild(h('option', { text: PART_LABEL[p], attr: { value: p, selected: (task.part ?? 'anytime') === p } }));
  partSel.disabled = !onDay;
  // Choosing a part moves the block to the first free slot in it (its start time when the day is unknown).
  partSel.addEventListener('change', () => {
    const p = partSel.value as DayPart;
    if (p === 'anytime') { checkConflicts(); return; }
    const day = /^\d{4}-\d{2}-\d{2}$/.test(scheduled.value) ? scheduled.value : undefined;
    const s = ctx.settings();
    const excl = [task.key, src.key, ...(src.id ? [src.id] : [])];
    const notBefore = day === ctx.today() ? ctx.now() : undefined;
    setStart(day ? preferredSlot(ctx.index.snapshot, day, s, { part: p, effortMinutes: effort.get() ?? s.defaultEffortMinutes, excludeKeys: excl, ...(notBefore ? { notBefore } : {}) }) : partWindow(p, s).from);
  });
  const where = h('div', { cls: 'helm-hint', text: locationLabel(ctx, src) });

  const field = (label: string, ...els: HTMLElement[]): HTMLElement => h('label', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: label }), ...els);
  root.append(
    field('Text', text),
    h('div', { cls: 'helm-grid2' }, field('Status', status), field('Priority', priority)),
    h('div', { cls: 'helm-grid3' }, field('Planned for', h('div', { cls: 'helm-row' }, scheduled, partSel)), field('Due', due), field('Start (not before)', start)),
    conflict,
    h('div', { cls: 'helm-grid3' }, field('Effort', effort.el), field('Time block', h('div', { cls: 'helm-row' }, timeStart, timeEnd)), field('Repeat', h('div', {}, recurrence, repeatRow))),
    h('div', { cls: 'helm-grid2' }, field('How far along', progressRow), h('div', {})),
    field('Blocked by (ids)', blockedBy),
    where,
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Notes' }), notesSection(ctx, targetForTask(task))),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Drawings' }), drawingsSection(ctx, targetForTask(task))),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Links' }), linksSection(ctx, { list: () => links, add: (url, label) => { links = [...links.filter((l) => l.url !== url), { url, label: label?.trim() || linkLabel(url), raw: `[${label?.trim() || linkLabel(url)}](${url})` }]; }, remove: (url) => { links = links.filter((l) => l.url !== url); } })),
    h('div', { cls: 'helm-modal-buttons' },
      button('Follow up…', { icon: 'corner-down-right', cls: 'helm-btn-quiet', title: 'Continue this task another day', onClick: () => { m.close(); openFollowUp(ctx, task); } }),
      button('Project…', { icon: 'folder-input', title: 'Move it in, make one from it, or point one at it', onClick: (ev) => projectMenuForTask(ctx, src, ev, { before: () => m.close() }) }),
      button('Open note', { icon: 'file-text', onClick: () => { m.close(); void ctx.openFile(src.path, src.line); } }),
      h('span', { cls: 'helm-spacer' }),
      button('Cancel', { onClick: () => m.close() }),
      button('Save', { primary: true, onClick: () => void save() }),
    ),
  );
  root.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) void save(); });

  async function save(): Promise<void> {
    const patch: Partial<TaskLine> & { scheduled?: IsoDate | undefined } = {};
    // Typed-in links stay where they are; the ones managed in the Links section are appended.
    const typed = linksIn(text.value).map((l) => l.url);
    const t = [text.value.trim(), ...links.filter((l) => !typed.includes(l.url)).map((l) => l.raw)].filter(Boolean).join(' ');
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
    const pv = progressNum.value.trim();
    const pct = pv === '' ? undefined : Math.max(0, Math.min(100, Math.round(Number(pv))));
    if (pct !== src.progress) {
      patch.progress = pct === undefined || pct === 0 ? undefined : pct;
      // A percentage says you are on it: don't leave it sitting at “to do” with 40% against its name.
      if (patch.progress !== undefined && (patch.status ?? src.status) === 'todo') patch.status = 'doing';
    }
    const rv = recurrence.value.trim();
    if (rv === '') { if (src.recurrence) patch.recurrence = undefined; }
    else if (rv !== src.recurrence?.raw) { const r = parseRecurrence(rv); if (!r.parsed) { ctx.notify(`I do not understand “${rv}”. Try “every week on monday”.`); return; } patch.recurrence = { ...r, raw: formatRecurrence(r) }; }
    if (conflictText && !window.confirm(`This overlaps ${conflictText}.\n\nSave anyway?`)) return;
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
