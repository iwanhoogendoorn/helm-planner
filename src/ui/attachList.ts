/**
 * The list of what is attached to an item — notes or drawings — as rows you can read: what each one
 * holds, how big it is, when it changed, where it sits. A project's items are grouped by the subfolder
 * they live in, with the ones linked from elsewhere last. A filter and a sort appear once there are
 * enough to need them, and a long list shows the most recent until asked for the rest.
 *
 * Also the quick search the item's notes / drawings button offers when there are many.
 */
import { FuzzySuggestModal } from 'obsidian';
import { humanDate } from '../core/dates';
import type { DrawingTarget } from '../core/types';
import { folderOf, isUnder } from '../data/vault';
import { h, icon, iconButton } from './dom';
import type { UiContext } from './context';

export interface AttachItem {
  path: string;
  title: string;
  mtime?: number;
  icon: string;
  /** A first line in bold (a note's heading) and the text after it. */
  heading?: string;
  text?: string;
  /** Extra facts for the meta line: “2.5k words”, “canvas”, “3 open tasks”. `accent` draws the eye. */
  facts: { text: string; accent?: boolean; title?: string }[];
}

export interface AttachSpec {
  target: DrawingTarget;
  /** `['note', 'notes']` — how the list talks about its items. */
  noun: [string, string];
  items: () => AttachItem[];
  /** What to say when there is nothing; the folder is added for a project. */
  emptyText: string;
  actions: HTMLElement[];
  unlink: (item: AttachItem) => Promise<void>;
  remove: (item: AttachItem) => Promise<void>;
}

interface View { query: string; sort: 'recent' | 'title'; all: boolean }
const views = new Map<string, View>();
/** Forget every list's filter and sort (tests start clean). */
export function resetAttachViews(): void { views.clear(); }
/** Past this many, the list shows the most recent and offers the rest; past FILTER_AT it gets a filter. */
export const SHOWN = 10;
export const FILTER_AT = 6;
/** A button's menu lists this many; past it, a search comes first and only the most recent few follow. */
export const MENU_SHOWN = 8;
export const MENU_RECENT = 5;
const LINKED = '￿';

export const editedLabel = (mtime: number | undefined, today: string): string | undefined => {
  if (!mtime) return undefined;
  const d = humanDate(new Date(mtime).toISOString().slice(0, 10), today);
  return `edited ${/^(Today|Yesterday)$/.test(d) ? d.toLowerCase() : d}`;
};

export const wordCount = (n: number): string => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1).replace(/\.0$/, '')}k words` : `${n} word${n === 1 ? '' : 's'}`);

/** The project folder that holds an item's own notes and drawings, when the target is a project or one of its phases. */
export function projectFolderFor(ctx: UiContext, target: DrawingTarget): { folder: string; title: string } | undefined {
  return ctx.index.attachmentHome(target);
}

const searchText = (i: AttachItem): string => `${i.title} ${i.path} ${i.heading ?? ''} ${i.text ?? ''}`.toLowerCase();

export function attachList(ctx: UiContext, spec: AttachSpec): HTMLElement {
  const { target } = spec;
  const key = `${spec.noun[1]}:${target.kind}:${'id' in target ? target.id : 'key' in target ? target.key : target.date}`;
  const view = views.get(key) ?? { query: '', sort: 'recent', all: false };
  views.set(key, view);
  const home = projectFolderFor(ctx, target);
  const folder = home?.folder;
  const listEl = h('div', { cls: 'helm-note-list' });
  const [one, many] = spec.noun;

  const open = (item: AttachItem, ev: MouseEvent | KeyboardEvent): void => {
    if ((ev as MouseEvent).metaKey || (ev as MouseEvent).ctrlKey) { void ctx.app.workspace.openLinkText(item.path, '', true); return; }
    void ctx.openFile(item.path);
  };

  const row = (item: AttachItem, subfolder?: string): HTMLElement => {
    const inFolder = folder !== undefined && isUnder(item.path, folder);
    const edited = editedLabel(item.mtime, ctx.today());
    const meta: (HTMLElement | null)[] = [
      edited ? h('span', { text: edited }) : null,
      ...item.facts.map((f) => h('span', { cls: f.accent ? 'helm-note-open' : '', text: f.text, ...(f.title ? { title: f.title } : {}) })),
      folder !== undefined && !inFolder ? h('span', { cls: 'helm-note-linked', text: 'linked', title: `Lives in ${folderOf(item.path) || 'the vault root'}` }) : null,
      subfolder ? h('span', { cls: 'helm-note-folder' }, icon('folder'), h('span', { text: subfolder })) : null,
    ];
    const actions = h('div', { cls: 'helm-note-actions' },
      inFolder ? null : iconButton('unlink', `Unlink — the ${one} itself stays`, (ev) => { ev.stopPropagation(); void ctx.run(`Unlink ${one}`, async () => { await spec.unlink(item); draw(); }); }),
      iconButton('trash', 'Move to trash', (ev) => { ev.stopPropagation(); if (window.confirm(`Move “${item.title}” to the trash?`)) void ctx.run(`Delete ${one}`, async () => { await spec.remove(item); draw(); }); }, 'helm-note-delete'));
    return h('div', {
      cls: 'helm-note-row', title: `${item.path}\nClick to open · ${navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl'}-click for a new tab`, attr: { role: 'button', tabindex: '0' },
      onClick: (ev) => open(item, ev),
      onKeyDown: (ev) => { if (ev.key === 'Enter') open(item, ev); },
    },
      h('div', { cls: 'helm-note-icon' }, icon(item.icon)),
      h('div', { cls: 'helm-note-main' },
        h('div', { cls: 'helm-note-title', text: item.title }),
        item.heading || item.text ? h('div', { cls: 'helm-note-preview' },
          item.heading && item.heading !== item.title ? h('span', { cls: 'helm-note-heading', text: item.heading }) : null,
          item.text ? h('span', { text: item.text }) : null) : null,
        meta.some(Boolean) ? h('div', { cls: 'helm-note-meta' }, ...meta) : null),
      actions);
  };

  const draw = (): void => {
    const all = spec.items();                                 // newest first
    const q = view.query.trim().toLowerCase();
    const list = q ? all.filter((i) => searchText(i).includes(q)) : all;
    listEl.replaceChildren();
    if (all.length === 0) { listEl.appendChild(h('div', { cls: 'helm-hint helm-note-empty', text: folder ? `${spec.emptyText} A ${one} you put in ${folder}/ shows up here by itself.` : spec.emptyText })); return; }
    if (list.length === 0) { listEl.appendChild(h('div', { cls: 'helm-hint helm-note-empty', text: `Nothing matches “${view.query}”.` })); return; }
    // Recent is one list, newest first, each row naming its subfolder. A–Z reads like the folder: its own
    // items, then each subfolder, then the ones linked from elsewhere, alphabetical inside each.
    const groupOf = (i: AttachItem): string => (folder === undefined ? '' : !isUnder(i.path, folder) ? LINKED : folderOf(i.path).slice(folder.length).replace(/^\//, ''));
    const seq: (AttachItem | string)[] = [];
    if (view.sort === 'recent') seq.push(...list);
    else {
      const groups = new Map<string, AttachItem[]>();
      for (const i of list) groups.set(groupOf(i), [...(groups.get(groupOf(i)) ?? []), i]);
      const order = [...groups.keys()].sort((a, b) => a.localeCompare(b));
      for (const g of order) { if (order.length > 1) seq.push(g); seq.push(...groups.get(g)!.sort((a, b) => a.title.localeCompare(b.title))); }
    }
    const cap = q || view.all ? Infinity : SHOWN;
    let shown = 0;
    for (const item of seq) {
      if (shown >= cap) break;
      if (typeof item === 'string') {
        const count = list.filter((i) => groupOf(i) === item).length;
        listEl.appendChild(h('div', { cls: 'helm-note-group' }, icon(item === LINKED ? 'link' : 'folder'), h('span', { cls: 'helm-note-group-name', text: item === LINKED ? 'Linked from elsewhere' : item === '' ? (home?.title ?? 'This folder') : item }), h('span', { cls: 'helm-note-group-count', text: String(count) })));
        continue;
      }
      const g = groupOf(item);
      listEl.appendChild(row(item, view.sort === 'recent' && g !== '' && g !== LINKED ? g : undefined));
      shown++;
    }
    if (list.length > cap) listEl.appendChild(h('button', { cls: 'helm-note-more', text: `Show all ${all.length} ${many}`, onClick: () => { view.all = true; draw(); } }));
    else if (view.all && !q && all.length > SHOWN) listEl.appendChild(h('button', { cls: 'helm-note-more', text: 'Show fewer', onClick: () => { view.all = false; draw(); } }));
  };

  const total = spec.items().length;
  const bar = h('div', { cls: 'helm-note-bar' });
  if (total > FILTER_AT) {
    const input = h('input', { cls: 'helm-note-filter', attr: { type: 'search', placeholder: `Search ${total} ${many}…`, value: view.query } });
    input.addEventListener('input', () => { view.query = input.value; draw(); });
    input.addEventListener('keydown', (ev) => {
      // Enter opens the first match; Escape clears.
      if (ev.key === 'Enter') { const first = listEl.querySelector<HTMLElement>('.helm-note-row'); first?.click(); }
      if (ev.key === 'Escape' && input.value) { ev.stopPropagation(); input.value = ''; view.query = ''; draw(); }
    });
    bar.append(icon('search', 'helm-note-filter-icon'), input);
  }
  if (total > 3) {
    const seg = h('div', { cls: 'helm-segmented helm-note-sort' });
    const paint = (): void => { seg.replaceChildren(...(([['recent', 'Recent'], ['title', 'A–Z']] as const).map(([k, label]) => h('button', { cls: ['helm-seg', view.sort === k && 'is-active'], text: label, onClick: () => { view.sort = k; paint(); draw(); } })))); };
    paint();
    bar.appendChild(seg);
  }
  bar.append(h('span', { cls: 'helm-spacer' }), ...spec.actions);
  draw();
  return h('div', { cls: 'helm-notes' }, bar, listEl);
}

class AttachSearch extends FuzzySuggestModal<AttachItem> {
  constructor(ctx: UiContext, private items: AttachItem[], placeholder: string, private onPick: (i: AttachItem, ev: MouseEvent | KeyboardEvent) => void) {
    super(ctx.app);
    this.setPlaceholder(placeholder);
  }
  getItems(): AttachItem[] { return this.items; }
  getItemText(i: AttachItem): string { return [i.title, i.heading, i.text, folderOf(i.path)].filter(Boolean).join('  ·  '); }
  onChooseItem(i: AttachItem, ev: MouseEvent | KeyboardEvent): void { this.onPick(i, ev); }
}

/** A quick search over what is attached — what the notes / drawings button offers once there are many. */
export function searchAttached(ctx: UiContext, items: AttachItem[], placeholder: string): void {
  const m = new AttachSearch(ctx, items, placeholder, (i, ev) => {
    if ((ev as MouseEvent).metaKey || (ev as MouseEvent).ctrlKey) void ctx.app.workspace.openLinkText(i.path, '', true);
    else void ctx.openFile(i.path);
  });
  m.open();
  ctx.trackModal(m);
}

