/** Search everything, and act on what you find without leaving the list. */
import { Modal } from 'obsidian';
import { KIND_ICON, KIND_LABEL, SEARCH_KINDS, queryWords, search, startingPoints, toggleToken, type HitGroup, type SearchHit } from '../../data/search';
import { isOpen } from '../../data/planner';
import { h, icon, iconButton } from '../dom';
import type { UiContext } from '../context';
import { openTaskEditor } from './taskEditor';
import { openCapture } from './capture';
import { taskMenu } from '../menus';

const SHOWN = 60;
const HELP = '#tag · @project · is:open/done/blocked/overdue · in:daily/project/inbox/note · due:today/week/2026-09-01 · on:tomorrow · kind:task/project/note/drawing/habit/goal';
const CHIPS: [string, string][] = [['is:open', 'Open'], ['is:overdue', 'Overdue'], ['due:week', 'Due this week'], ['on:today', 'Today'], ['in:daily', 'In daily notes'], ['in:project', 'In projects'], ['in:note', 'In other notes'], ['kind:note', 'Note files'], ['kind:drawing', 'Drawings']];

/** The query survives closing the dialog, so search → act → search again picks up where you were. */
let lastQuery = '';

/** Where a hit lives: the plugin view when it has a home there, else the note. */
export function openHit(ctx: UiContext, hit: SearchHit): void {
  if (hit.kind === 'project' && hit.project) { ctx.navigate('projects', { projectId: hit.project.id }); return; }
  if (hit.kind === 'goal' && hit.goal) { ctx.navigate('horizons', { periodKey: hit.goal.periodKey }); return; }
  void ctx.openFile(hit.path, hit.line);
}

export function openSearch(ctx: UiContext, initial?: string): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText('Search');
  m.contentEl.addClass('helm-modal', 'helm-search-modal');
  const input = h('input', { cls: 'helm-input-wide helm-search-input', attr: { type: 'text', placeholder: 'Search, or type something new to capture it…', value: initial ?? lastQuery } });
  const chipRow = h('div', { cls: 'helm-search-chips' });
  const summary = h('div', { cls: 'helm-hint helm-search-summary' });
  const list = h('div', { cls: 'helm-search-results' });
  /** Everything the arrows walk, in the order it is drawn. */
  let rows: { run: () => void; menu?: (ev: MouseEvent) => void }[] = [];
  let selected = 0;

  const setQuery = (q: string): void => { input.value = q; lastQuery = q; selected = 0; draw(); input.focus(); };
  const rerun = (label: string, fn: () => Promise<unknown>): void => { void ctx.run(label, fn).then(() => draw()); };

  const rowEl = (hit: SearchHit, index: number): HTMLElement => {
    const t = hit.task;
    const open = () => { m.close(); openHit(ctx, hit); };
    const menu = t ? (ev: MouseEvent) => taskMenu(ctx, t, ev, { onEdit: () => { m.close(); openTaskEditor(ctx, t); } }) : undefined;
    const row = h('div', { cls: ['helm-search-row', index === selected && 'is-selected'], attr: { 'data-index': String(index) }, onClick: open, ...(menu ? { onContextMenu: (ev: MouseEvent) => { ev.preventDefault(); menu(ev); } } : {}) },
      t ? h('button', { cls: ['helm-check', `mark-${t.status}`], title: isOpen(t) ? 'Mark done' : 'Reopen', onClick: (ev) => { ev.stopPropagation(); rerun('Status', () => ctx.mutations.setStatus(t.key, isOpen(t) ? 'done' : 'todo')); } }, isOpen(t) ? null : icon('check'))
        : icon(KIND_ICON[hit.kind], 'helm-search-icon'),
      h('div', { cls: 'helm-search-main' }, h('div', { cls: 'helm-search-title', text: hit.title }), hit.subtitle ? h('div', { cls: 'helm-search-sub', text: hit.subtitle }) : null),
    );
    row.addEventListener('mousemove', () => { if (selected !== index) { selected = index; paint(); } });
    if (menu) row.appendChild(iconButton('more-horizontal', 'Actions (schedule, follow up, notes…)', (ev) => { ev.stopPropagation(); menu(ev); }));
    rows.push({ run: open, ...(menu ? { menu } : {}) });
    return row;
  };

  const drawGroups = (groups: HitGroup[], clickableHeads: boolean): void => {
    for (const g of groups) {
      const head = h('div', { cls: ['helm-search-group', clickableHeads && 'is-clickable'], ...(clickableHeads ? { onClick: () => setQuery(toggleToken(input.value, `kind:${g.hits[0]!.kind}`)) } : {}) },
        icon(g.icon), h('span', { text: g.label }), h('span', { cls: 'helm-badge-count', text: String(g.hits.length) }));
      list.appendChild(head);
      for (const hit of g.hits) list.appendChild(rowEl(hit, rows.length));
    }
  };

  function draw(): void {
    list.replaceChildren();
    rows = [];
    const q = input.value;
    lastQuery = q;
    chipRow.replaceChildren(...CHIPS.map(([token, label]) => h('button', { cls: ['helm-tag-toggle', new RegExp(`(^|\\s)${token}(\\s|$)`, 'i').test(q) && 'is-active'], text: label, title: token, onClick: () => setQuery(toggleToken(input.value, token)) })));

    if (q.trim() === '') {
      const groups = startingPoints(ctx.index.snapshot, ctx.today());
      summary.textContent = groups.length ? 'Where you left off — or type to search everything.' : HELP;
      if (groups.length === 0) list.appendChild(h('div', { cls: 'helm-empty' }, h('p', { text: 'Type to search across tasks, projects, goals, habits, notes and drawings.' })));
      else drawGroups(groups, false);
      paint();
      return;
    }

    const all = search(ctx.index.snapshot, q, { today: ctx.today(), limit: 500 });
    const hits = all.slice(0, SHOWN);
    summary.textContent = all.length === 0 ? HELP : `${all.length} result${all.length === 1 ? '' : 's'}${all.length > hits.length ? ` · showing the best ${hits.length}` : ''} · ↑↓ move · Enter open · ⌘/Ctrl+Enter actions`;
    drawGroups(SEARCH_KINDS.map((kind) => ({ label: KIND_LABEL[kind], icon: KIND_ICON[kind], hits: hits.filter((x) => x.kind === kind) })).filter((g) => g.hits.length > 0), true);

    // Nothing found, or nothing quite right: make the words into a task instead.
    const words = queryWords(q);
    if (words !== '') {
      const capture = (): void => { m.close(); openCapture(ctx, { text: words }); };
      list.appendChild(h('div', { cls: 'helm-search-group' }, icon('plus'), h('span', { text: 'Create' })));
      const index = rows.length;
      const row = h('div', { cls: ['helm-search-row', 'is-create', index === selected && 'is-selected'], attr: { 'data-index': String(index) }, onClick: capture },
        icon('plus', 'helm-search-icon'),
        h('div', { cls: 'helm-search-main' }, h('div', { cls: 'helm-search-title', text: `Capture “${words}”…` }), h('div', { cls: 'helm-search-sub', text: 'Opens Capture with this text' })),
      );
      row.addEventListener('mousemove', () => { if (selected !== index) { selected = index; paint(); } });
      rows.push({ run: capture });
      list.appendChild(row);
    }
    if (all.length === 0 && words === '') list.appendChild(h('div', { cls: 'helm-empty' }, h('p', { text: `Nothing matches “${q.trim()}”.` })));
    if (selected >= rows.length) selected = Math.max(0, rows.length - 1);
    paint();
  }

  const paint = (): void => {
    for (const el of list.querySelectorAll<HTMLElement>('.helm-search-row')) el.classList.toggle('is-selected', Number(el.dataset['index']) === selected);
    list.querySelector<HTMLElement>('.helm-search-row.is-selected')?.scrollIntoView?.({ block: 'nearest' });
  };

  input.addEventListener('input', () => { selected = 0; draw(); });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown' || (ev.key === 'n' && ev.ctrlKey)) { ev.preventDefault(); if (rows.length) { selected = (selected + 1) % rows.length; paint(); } return; }
    if (ev.key === 'ArrowUp' || (ev.key === 'p' && ev.ctrlKey)) { ev.preventDefault(); if (rows.length) { selected = (selected - 1 + rows.length) % rows.length; paint(); } return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const row = rows[selected];
    if (!row) return;
    if ((ev.metaKey || ev.ctrlKey) && row.menu) {
      // Open the row's action menu where the row sits.
      const el = list.querySelector<HTMLElement>('.helm-search-row.is-selected');
      const r = el?.getBoundingClientRect();
      row.menu(new MouseEvent('contextmenu', { clientX: (r?.left ?? 0) + 40, clientY: (r?.bottom ?? 0), bubbles: true }));
      return;
    }
    row.run();
  });

  m.contentEl.append(input, chipRow, summary, list);
  draw();
  m.open();
  ctx.trackModal(m);
  setTimeout(() => { input.focus(); input.select(); }, 0);
}
