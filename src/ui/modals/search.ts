/** Search everything: type, arrow through the hits, Enter opens. */
import { Modal } from 'obsidian';
import { KIND_ICON, KIND_LABEL, SEARCH_KINDS, search, type SearchHit } from '../../data/search';
import { h, icon, iconButton } from '../dom';
import type { UiContext } from '../context';
import { openTaskEditor } from './taskEditor';

const HELP = '#tag · @project · is:open/done/blocked/overdue · due:today/week/2026-09-01 · on:tomorrow · kind:task/project/note/drawing/habit/goal';

/** Where a hit lives: the plugin view when it has a home there, else the note. */
export function openHit(ctx: UiContext, hit: SearchHit): void {
  if (hit.kind === 'project' && hit.project) { ctx.navigate('projects', { projectId: hit.project.id }); return; }
  if (hit.kind === 'goal' && hit.goal) { ctx.navigate('horizons', { periodKey: hit.goal.periodKey }); return; }
  void ctx.openFile(hit.path, hit.line);
}

export function openSearch(ctx: UiContext, initial = ''): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText('Search');
  m.contentEl.addClass('helm-modal', 'helm-search-modal');
  const input = h('input', { cls: 'helm-input-wide helm-search-input', attr: { type: 'text', placeholder: 'Search tasks, projects, notes, drawings…', value: initial } });
  const summary = h('div', { cls: 'helm-hint helm-search-summary' });
  const list = h('div', { cls: 'helm-search-results' });
  let hits: SearchHit[] = [];
  let selected = 0;

  const activate = (hit: SearchHit): void => { m.close(); openHit(ctx, hit); };

  const draw = (): void => {
    list.replaceChildren();
    const q = input.value;
    hits = search(ctx.index.snapshot, q, { today: ctx.today(), limit: 60 });
    if (selected >= hits.length) selected = Math.max(0, hits.length - 1);
    if (q.trim() === '') { summary.textContent = HELP; list.appendChild(h('div', { cls: 'helm-empty' }, h('p', { text: 'Type to search across tasks, projects, goals, habits, notes and drawings.' }))); return; }
    if (hits.length === 0) { summary.textContent = HELP; list.appendChild(h('div', { cls: 'helm-empty' }, h('p', { text: `Nothing matches “${q.trim()}”.` }))); return; }
    summary.textContent = `${hits.length} result${hits.length === 1 ? '' : 's'} · ↑↓ to move, Enter to open`;
    let i = 0;
    for (const kind of SEARCH_KINDS) {
      const group = hits.filter((x) => x.kind === kind);
      if (group.length === 0) continue;
      list.appendChild(h('div', { cls: 'helm-search-group' }, icon(KIND_ICON[kind]), h('span', { text: KIND_LABEL[kind] }), h('span', { cls: 'helm-badge-count', text: String(group.length) })));
      for (const hit of group) {
        const index = i++;
        const row = h('div', { cls: ['helm-search-row', index === selected && 'is-selected'], attr: { 'data-index': String(index) }, onClick: () => activate(hit) },
          icon(KIND_ICON[kind], 'helm-search-icon'),
          h('div', { cls: 'helm-search-main' }, h('div', { cls: 'helm-search-title', text: hit.title }), hit.subtitle ? h('div', { cls: 'helm-search-sub', text: hit.subtitle }) : null),
        );
        row.addEventListener('mousemove', () => { if (selected !== index) { selected = index; paintSelection(); } });
        if (hit.kind === 'task' && hit.task) row.appendChild(iconButton('pencil', 'Edit task', (ev) => { ev.stopPropagation(); m.close(); openTaskEditor(ctx, hit.task!); }));
        list.appendChild(row);
      }
    }
    // The flat order the arrows walk is the order rows were added, not the score order.
    hits = SEARCH_KINDS.flatMap((k) => hits.filter((x) => x.kind === k));
    paintSelection();
  };
  const paintSelection = (): void => {
    for (const el of list.querySelectorAll<HTMLElement>('.helm-search-row')) el.classList.toggle('is-selected', Number(el.dataset['index']) === selected);
    const sel = list.querySelector<HTMLElement>('.helm-search-row.is-selected');
    sel?.scrollIntoView?.({ block: 'nearest' });
  };

  input.addEventListener('input', () => { selected = 0; draw(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || (ev.key === 'n' && ev.ctrlKey)) { ev.preventDefault(); if (hits.length) { selected = (selected + 1) % hits.length; paintSelection(); } return; }
    if (ev.key === 'ArrowUp' || (ev.key === 'p' && ev.ctrlKey)) { ev.preventDefault(); if (hits.length) { selected = (selected - 1 + hits.length) % hits.length; paintSelection(); } return; }
    if (ev.key === 'Enter') { ev.preventDefault(); const hit = hits[selected]; if (hit) activate(hit); }
  });

  m.contentEl.append(input, summary, list);
  draw();
  m.open();
  ctx.trackModal(m);
  setTimeout(() => { input.focus(); input.select(); }, 0);
}
