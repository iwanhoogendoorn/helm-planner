/** New project: name, umbrella, status, priority, area, dates, horizon, goal — and a click-driven phase/task builder. */
import { Modal } from 'obsidian';
import type { Project, ProjectPriority, ProjectStatus } from '../../core/types';
import { humanDate, isIsoDate, minutesToHuman } from '../../core/dates';
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '../../core/project';
import { parseCapture } from '../../core/nlp';
import { newTaskLine, serialiseTaskLine } from '../../core/taskLine';
import { formatRecurrence } from '../../core/recurrence';
import { button, chip, h, icon, iconButton } from '../dom';
import type { UiContext } from '../context';
import { wikilinkSuggest } from '../fields';
import { periodChoices } from '../tabs/horizons';

export interface DraftTask { text: string }
export interface DraftPhase { title: string; due: string; tasks: DraftTask[] }

/** One capture-grammar line → a serialised project task body ("- [ ] text 📅 … ⏱️ …"). */
export function draftToLine(text: string, today: string, weekStartsOn: 1 | 7 = 1): string {
  const c = parseCapture(text, today, weekStartsOn);
  const line = newTaskLine(c.text, {
    priority: c.priority,
    ...(c.due ? { due: c.due } : {}), ...(c.scheduled ? { scheduled: c.scheduled } : {}),
    ...(c.effortMinutes ? { effortMinutes: c.effortMinutes } : {}),
    ...(c.time ? { time: c.time } : {}), ...(c.recurrence ? { recurrence: c.recurrence } : {}),
  });
  return serialiseTaskLine(line);
}

export function openProjectForm(ctx: UiContext, opts: { parentId?: string; period?: string; goalKey?: string; onCreated?: (p: Project) => void } = {}): void {
  const today = ctx.today();
  const m = new Modal(ctx.app);
  m.titleEl.setText('New project');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-project-form');
  const title = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder: 'Project name' } });
  const parent = h('select');
  parent.appendChild(h('option', { text: '— none (top level) —', attr: { value: '' } }));
  const projects = ctx.index.allProjects().filter((p) => !['done', 'cancelled', 'archived'].includes(p.status)).sort((a, b) => a.title.localeCompare(b.title));
  for (const p of projects) parent.appendChild(h('option', { text: p.title, attr: { value: p.id, selected: p.id === opts.parentId } }));
  const status = h('select');
  for (const s of PROJECT_STATUSES) status.appendChild(h('option', { text: s, attr: { value: s, selected: s === 'active' } }));
  const priority = h('select');
  for (const p of PROJECT_PRIORITIES) priority.appendChild(h('option', { text: p, attr: { value: p, selected: p === 'normal' } }));
  const areas = [...new Set(ctx.index.allProjects().map((p) => p.area).filter((a): a is string => !!a))].sort();
  const area = h('input', { attr: { type: 'text', placeholder: 'Area (work, house, music…)', list: 'helm-areas' } });
  const areaList = h('datalist', { attr: { id: 'helm-areas' } }, ...areas.map((a) => h('option', { attr: { value: a } })));
  const start = h('input', { attr: { type: 'date' } });
  const due = h('input', { attr: { type: 'date' } });
  const period = h('select');
  period.appendChild(h('option', { text: '— no horizon —', attr: { value: '' } }));
  for (const c of periodChoices(today)) period.appendChild(h('option', { text: c.label.replace(/^\s+/, (mm) => ' '.repeat(mm.length)), attr: { value: c.key, selected: c.key === opts.period } }));
  const goal = h('select');
  goal.appendChild(h('option', { text: '— no goal —', attr: { value: '' } }));
  for (const g of ctx.index.allGoals().sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.line - b.line)) goal.appendChild(h('option', { text: `${g.periodKey} · ${g.text}`, attr: { value: g.key, selected: g.key === opts.goalKey } }));
  goal.addEventListener('change', () => { const g = ctx.index.goal(goal.value); if (g && !period.value) period.value = g.periodKey; });
  const objective = h('textarea', { cls: 'helm-input-wide', attr: { rows: 2, placeholder: 'This project is successful when…' } });

  // ── Phase / task builder ─────────────────────────────────────────────
  const phases: DraftPhase[] = [];
  const loose: DraftTask[] = [];
  const builder = h('div', { cls: 'helm-builder' });
  const taskChips = (text: string): HTMLElement => {
    const c = parseCapture(text, today, ctx.settings().weekStartsOn);
    const meta = h('span', { cls: 'helm-task-meta' });
    if (c.priority !== 'normal') meta.appendChild(chip(c.priority, `prio prio-${c.priority}`));
    if (c.due) meta.appendChild(chip(`due ${humanDate(c.due, today)}`, 'due'));
    if (c.scheduled) meta.appendChild(chip(`plan ${humanDate(c.scheduled, today)}`, 'scheduled'));
    if (c.effortMinutes) meta.appendChild(chip(minutesToHuman(c.effortMinutes), 'effort'));
    if (c.recurrence) meta.appendChild(chip(formatRecurrence(c.recurrence), 'recurrence'));
    return meta;
  };
  const taskRows = (list: DraftTask[], placeholder: string): HTMLElement => {
    const wrap = h('div', { cls: 'helm-builder-tasks' });
    list.forEach((t, i) => wrap.appendChild(h('div', { cls: 'helm-builder-task' },
      icon('circle', 'helm-builder-bullet'),
      h('span', { cls: 'helm-builder-task-text', text: parseCapture(t.text, today).text }), taskChips(t.text),
      h('span', { cls: 'helm-spacer' }),
      iconButton('chevron-up', 'Move up', () => { if (i > 0) { [list[i - 1], list[i]] = [list[i]!, list[i - 1]!]; draw(); } }),
      iconButton('x', 'Remove', () => { list.splice(i, 1); draw(); }),
    )));
    const input = h('input', { cls: 'helm-quickadd-input', attr: { type: 'text', placeholder } });
    wikilinkSuggest(ctx, input);
    const add = (): void => {
      if (input.value.trim() === '') return;
      list.push({ text: input.value.trim() });
      draw();
      setTimeout(() => { const inputs = builder.querySelectorAll<HTMLInputElement>('.helm-quickadd-input'); const idx = [...builder.querySelectorAll('.helm-builder-tasks')].indexOf(wrap); inputs[idx >= 0 ? idx : inputs.length - 1]?.focus(); }, 0);
    };
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); add(); } });
    wrap.appendChild(h('div', { cls: 'helm-quickadd' }, icon('plus'), input, iconButton('corner-down-left', 'Add task', add)));
    return wrap;
  };
  const draw = (): void => {
    builder.replaceChildren();
    phases.forEach((ph, i) => {
      const name = h('input', { cls: 'helm-builder-phase-name', attr: { type: 'text', placeholder: `Phase ${i + 1} name`, value: ph.title } });
      name.addEventListener('input', () => { ph.title = name.value; });
      const dueIn = h('input', { attr: { type: 'date', value: ph.due }, title: 'Target date' });
      dueIn.addEventListener('change', () => { ph.due = dueIn.value; });
      builder.appendChild(h('div', { cls: 'helm-builder-phase' },
        h('div', { cls: 'helm-builder-phase-head' },
          icon('milestone'), name, dueIn,
          iconButton('chevron-up', 'Move phase up', () => { if (i > 0) { [phases[i - 1], phases[i]] = [phases[i]!, phases[i - 1]!]; draw(); } }),
          iconButton('chevron-down', 'Move phase down', () => { if (i < phases.length - 1) { [phases[i + 1], phases[i]] = [phases[i]!, phases[i + 1]!]; draw(); } }),
          iconButton('trash', 'Remove phase', () => { if (ph.tasks.length === 0 || window.confirm(`Remove phase “${ph.title || `Phase ${i + 1}`}” and its ${ph.tasks.length} task(s)?`)) { phases.splice(i, 1); draw(); } }),
        ),
        taskRows(ph.tasks, `Add a task to ${ph.title || 'this phase'}… (dates, !!, ~1h work here too)`),
      ));
    });
    builder.appendChild(h('div', { cls: 'helm-builder-actions' }, button('Add phase', { icon: 'milestone', onClick: () => { phases.push({ title: '', due: '', tasks: [] }); draw(); setTimeout(() => { const inputs = builder.querySelectorAll<HTMLInputElement>('.helm-builder-phase-name'); inputs[inputs.length - 1]?.focus(); }, 0); } })));
    builder.appendChild(h('div', { cls: 'helm-builder-loose' }, h('div', { cls: 'helm-builder-phase-head' }, icon('list'), h('span', { cls: 'helm-field-label', text: phases.length ? 'Tasks outside any phase' : 'Tasks' })), taskRows(loose, 'Add a task… e.g. "Get three quotes due friday !high ~1h"')));
  };
  draw();

  const field = (label: string, ...els: HTMLElement[]): HTMLElement => h('label', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: label }), ...els);
  root.append(
    field('Name', title),
    h('div', { cls: 'helm-grid2' }, field('Part of', parent), field('Area', area), areaList),
    h('div', { cls: 'helm-grid2' }, field('Status', status), field('Priority', priority)),
    h('div', { cls: 'helm-grid2' }, field('Start', start), field('Due', due)),
    h('div', { cls: 'helm-grid2' }, field('Horizon (year · quarter · month · week)', period), field('Serves goal', goal)),
    field('Objective', objective),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Phases and tasks' }), builder),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-hint', text: 'Enter adds a task · phases keep their order' }), h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button('Create project', { primary: true, icon: 'folder-plus', onClick: () => void create() })),
  );

  async function create(): Promise<void> {
    const name = title.value.trim();
    if (name === '') { ctx.notify('Give the project a name.'); title.focus(); return; }
    if (phases.some((p) => p.title.trim() === '')) { ctx.notify('Every phase needs a name.'); return; }
    const wk = ctx.settings().weekStartsOn;
    m.close();
    await ctx.run('Create project', async () => {
      const p = await ctx.mutations.createProject({
        title: name, status: status.value as ProjectStatus, priority: priority.value as ProjectPriority,
        ...(area.value.trim() ? { area: area.value.trim() } : {}), ...(parent.value ? { parentId: parent.value } : {}),
        ...(isIsoDate(start.value) ? { start: start.value } : {}), ...(isIsoDate(due.value) ? { due: due.value } : {}),
        ...(objective.value.trim() ? { objective: objective.value.trim() } : {}),
        ...(period.value ? { period: period.value } : {}), ...(goal.value ? { goal: ctx.index.goal(goal.value)?.id ?? goal.value } : {}),
        phases: phases.map((ph) => ({ title: ph.title.trim(), ...(isIsoDate(ph.due) ? { due: ph.due } : {}), tasks: ph.tasks.map((t) => draftToLine(t.text, today, wk)) })),
        tasks: loose.map((t) => draftToLine(t.text, today, wk)),
      });
      ctx.notify(`Created “${p.title}”.`);
      opts.onCreated?.(p);
    });
  }
  m.open();
  ctx.trackModal(m);
  setTimeout(() => title.focus(), 0);
}

/** Plain-text fallback (one phase or task per line) — still used by the editor command and tests. */
export function parsePhases(text: string): { phases: { title: string; due?: string; tasks: string[] }[]; tasks: string[] } {
  const phases: { title: string; due?: string; tasks: string[] }[] = [];
  const tasks: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const pm = /^(?:phase|fase|stage|milestone)\s*[:\-–—]\s*(.+?)(?:\s*📅\s*(\d{4}-\d{2}-\d{2}))?\s*$/i.exec(line) ?? /^#+\s*(.+?)(?:\s*📅\s*(\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
    if (pm) { phases.push({ title: pm[1]!.trim(), ...(pm[2] ? { due: pm[2] } : {}), tasks: [] }); continue; }
    const t = line.replace(/^(?:[-*+]|\d+[.)])\s*(?:\[.\]\s*)?/, '').trim();
    if (t === '') continue;
    const cur = phases[phases.length - 1];
    if (cur) cur.tasks.push(t); else tasks.push(t);
  }
  return { phases, tasks };
}
