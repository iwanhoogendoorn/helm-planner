/** New project wizard: name, umbrella, status, priority, area, dates, phases with tasks. */
import { Modal } from 'obsidian';
import type { Project, ProjectPriority, ProjectStatus } from '../../core/types';
import { isIsoDate } from '../../core/dates';
import { PROJECT_PRIORITIES, PROJECT_STATUSES } from '../../core/project';
import { button, h } from '../dom';
import type { UiContext } from '../context';
import { periodChoices } from '../tabs/horizons';

export function openProjectForm(ctx: UiContext, opts: { parentId?: string; period?: string; goalKey?: string; onCreated?: (p: Project) => void } = {}): void {
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
  for (const c of periodChoices(ctx.today())) period.appendChild(h('option', { text: c.label.replace(/^\s+/, (m) => '\u00a0'.repeat(m.length)), attr: { value: c.key, selected: c.key === opts.period } }));
  const goal = h('select');
  goal.appendChild(h('option', { text: '— no goal —', attr: { value: '' } }));
  for (const g of ctx.index.allGoals().sort((a, b) => a.periodKey.localeCompare(b.periodKey) || a.line - b.line)) goal.appendChild(h('option', { text: `${g.periodKey} · ${g.text}`, attr: { value: g.key, selected: g.key === opts.goalKey } }));
  goal.addEventListener('change', () => { const g = ctx.index.goal(goal.value); if (g && !period.value) period.value = g.periodKey; });
  const objective = h('textarea', { cls: 'helm-input-wide', attr: { rows: 2, placeholder: 'This project is successful when…' } });
  const phases = h('textarea', { cls: 'helm-input-wide helm-mono', attr: { rows: 8, placeholder: 'Phase: Design 📅 2026-09-30\n- Sketch layout\n- Pick tiles\nPhase: Build\n- Demolition\n\nLines without a phase above them become loose tasks.' } });
  const field = (label: string, ...els: HTMLElement[]): HTMLElement => h('label', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: label }), ...els);
  root.append(
    field('Name', title),
    h('div', { cls: 'helm-grid2' }, field('Part of', parent), field('Area', area), areaList),
    h('div', { cls: 'helm-grid2' }, field('Status', status), field('Priority', priority)),
    h('div', { cls: 'helm-grid2' }, field('Start', start), field('Due', due)),
    h('div', { cls: 'helm-grid2' }, field('Horizon (year · quarter · month)', period), field('Serves goal', goal)),
    field('Objective', objective),
    field('Phases and tasks', phases),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button('Create project', { primary: true, icon: 'folder-plus', onClick: () => void create() })),
  );
  async function create(): Promise<void> {
    const name = title.value.trim();
    if (name === '') { ctx.notify('Give the project a name.'); title.focus(); return; }
    const parsed = parsePhases(phases.value);
    m.close();
    await ctx.run('Create project', async () => {
      const p = await ctx.mutations.createProject({
        title: name, status: status.value as ProjectStatus, priority: priority.value as ProjectPriority,
        ...(area.value.trim() ? { area: area.value.trim() } : {}), ...(parent.value ? { parentId: parent.value } : {}),
        ...(isIsoDate(start.value) ? { start: start.value } : {}), ...(isIsoDate(due.value) ? { due: due.value } : {}),
        ...(objective.value.trim() ? { objective: objective.value.trim() } : {}),
        ...(period.value ? { period: period.value } : {}), ...(goal.value ? { goal: ctx.index.goal(goal.value)?.id ?? goal.value } : {}),
        phases: parsed.phases, tasks: parsed.tasks,
      });
      ctx.notify(`Created “${p.title}”.`);
      opts.onCreated?.(p);
    });
  }
  m.open();
  ctx.trackModal(m);
  setTimeout(() => title.focus(), 0);
}

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
