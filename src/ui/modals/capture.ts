/**
 * Quick capture: one line in, a task out. Live preview shows how the line is
 * understood and where it will land.
 */
import { Modal } from 'obsidian';
import type { IsoDate, Project, TaskLine } from '../../core/types';
import { humanDate, minutesToHuman } from '../../core/dates';
import { parseCapture } from '../../core/nlp';
import { formatRecurrence } from '../../core/recurrence';
import { append, button, chip, h } from '../dom';
import type { UiContext } from '../context';
import { pickProject } from '../menus';

export interface CaptureDefaults {
  date?: IsoDate;
  projectId?: string;
  phaseId?: string;
  text?: string;
}

export function openCapture(ctx: UiContext, defaults: CaptureDefaults = {}): void {
  const today = ctx.today();
  const m = new Modal(ctx.app);
  m.titleEl.setText('Capture');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-capture');
  let project: Project | undefined = defaults.projectId ? ctx.index.project(defaults.projectId) : undefined;
  let phaseId = defaults.phaseId;
  let date: IsoDate | undefined = defaults.date;
  let explicitDate = defaults.date !== undefined;

  const input = h('input', { cls: 'helm-input-wide helm-capture-input', attr: { type: 'text', placeholder: 'Call the plumber tomorrow !high #home @Kitchen ~30m', value: defaults.text ?? '' } });
  const preview = h('div', { cls: 'helm-capture-preview' });
  const dest = h('div', { cls: 'helm-capture-dest' });
  const help = h('div', { cls: 'helm-hint', text: 'Dates: today, tomorrow, fri, next week, in 3 days, 1/9, due friday · Priority: !, !!, !!! · Project: @Name · Effort: ~45m · Time: 14:00-15:00 · Repeat: every week' });

  const render = (): void => {
    const c = parseCapture(input.value, today, ctx.settings().weekStartsOn);
    preview.replaceChildren();
    preview.appendChild(h('span', { cls: 'helm-capture-text', text: c.text || '…' }));
    if (c.priority !== 'normal') preview.appendChild(chip(c.priority, `prio prio-${c.priority}`));
    if (c.project && !project) { const p = ctx.index.projectByTitle(c.project); if (p) project = p; else preview.appendChild(chip(`@${c.project} (unknown project)`, 'warn')); }
    if (c.scheduled && !explicitDate) date = c.scheduled;
    if (date) preview.appendChild(chip(`plan ${humanDate(date, today)}`, 'scheduled'));
    if (c.due) preview.appendChild(chip(`due ${humanDate(c.due, today)}`, 'due'));
    if (c.effortMinutes) preview.appendChild(chip(minutesToHuman(c.effortMinutes), 'effort'));
    if (c.time) preview.appendChild(chip(c.time.end ? `${c.time.start}–${c.time.end}` : c.time.start, 'time'));
    if (c.recurrence) preview.appendChild(chip(formatRecurrence(c.recurrence), 'recurrence'));
    for (const t of c.tags) preview.appendChild(chip(`#${t}`, 'tag'));
    dest.replaceChildren();
    const where = project ? `→ project “${project.title}”${phaseId ? ` › ${project.phases.find((p) => p.id === phaseId)?.title ?? ''}` : ''}${date ? ` (and today's plan)` : ''}` : date ? `→ daily note for ${humanDate(date, today)}` : `→ inbox (${ctx.settings().inboxNote})`;
    append(dest, [
      h('span', { cls: 'helm-capture-where', text: where }),
      h('span', { cls: 'helm-spacer' }),
      button(project ? 'Change project' : 'Project…', { icon: 'folder', onClick: () => pickProject(ctx, (p, ph) => { project = p; phaseId = ph; render(); }, { phases: true }) }),
      project ? button('', { icon: 'x', title: 'No project', onClick: () => { project = undefined; phaseId = undefined; render(); } }) : null,
      button(date ? 'Not planned' : 'Plan today', { icon: date ? 'calendar-x' : 'sun', onClick: () => { explicitDate = true; date = date ? undefined : today; render(); } }),
    ]);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); void submit(ev.shiftKey); }
  });

  async function submit(keepOpen: boolean): Promise<void> {
    const c = parseCapture(input.value, today, ctx.settings().weekStartsOn);
    if (c.text.trim() === '') return;
    const fields: Partial<TaskLine> = { priority: c.priority };
    if (c.due) fields.due = c.due;
    if (c.effortMinutes) { fields.effortMinutes = c.effortMinutes; fields.effortRaw = minutesToHuman(c.effortMinutes); }
    if (c.time) fields.time = c.time;
    if (c.recurrence) fields.recurrence = { ...c.recurrence, raw: formatRecurrence(c.recurrence) };
    const p = project ?? (c.project ? ctx.index.projectByTitle(c.project) : undefined);
    const d = date;
    const text = c.text;
    if (!keepOpen) m.close();
    await ctx.run('Capture', () => ctx.mutations.addTask({ text, fields, ...(p ? { projectId: p.id } : {}), ...(phaseId ? { phaseId } : {}), ...(d ? { date: d } : {}) }));
    if (keepOpen) { input.value = ''; render(); input.focus(); }
  }

  root.append(input, preview, dest, help, h('div', { cls: 'helm-modal-buttons' },
    h('span', { cls: 'helm-hint', text: 'Enter to add · Shift+Enter to add and keep capturing' }),
    h('span', { cls: 'helm-spacer' }),
    button('Cancel', { onClick: () => m.close() }),
    button('Add', { primary: true, onClick: () => void submit(false) }),
  ));
  render();
  m.open();
  setTimeout(() => input.focus(), 0);
}
