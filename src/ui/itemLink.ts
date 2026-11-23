/**
 * A sub-habit's links: the song or exercise it is about, as many as you like: notes in the vault
 * (chords, tabs, what to work on), Excalidraw drawings, web pages (a lesson, a backing track). The Log practice rows show it as a button; the
 * habit form and Plan mode set it.
 */
import { Menu } from 'obsidian';
import type { Habit, HabitItem } from '../core/types';
import { itemLinkTarget } from '../core/habit';
import { askNameAndLocation, askText } from './fields';
import { openExternal } from './links';
import { pickNote } from './notes';
import { pickDrawing } from './drawings';
import { h, icon } from './dom';
import type { UiContext } from './context';

/** What a link points at, for icons and words: a web page, an Excalidraw drawing, or a note. */
export function itemLinkKind(link: string): 'web' | 'drawing' | 'note' {
  const t = itemLinkTarget(link);
  if ('url' in t) return 'web';
  return /\.excalidraw$/i.test(t.note) ? 'drawing' : 'note';
}
const KIND_ICON = { web: 'external-link', drawing: 'pen-tool', note: 'file-text' } as const;
const KIND_WORD = { web: 'web page', drawing: 'drawing', note: 'note' } as const;
export const itemLinkIcon = (link: string): string => KIND_ICON[itemLinkKind(link)];

/** A short name for what the link points at: the note's or drawing's name, or the web site. */
export function itemLinkLabel(link: string): string {
  const t = itemLinkTarget(link);
  if ('note' in t) return t.label.replace(/\.excalidraw$/i, '');
  try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return t.url; }
}

export const isWebLink = (link: string): boolean => itemLinkKind(link) === 'web';

/**
 * What was typed or pasted, as a link: `[[…]]` as is, a web address (with or without `https://`),
 * else the name or path of a note or drawing.
 */
export function typedLink(v: string): string {
  const s = v.trim();
  if (s.startsWith('[[')) return s;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (!/\s/.test(s) && /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(s) && !/\.(md|excalidraw|canvas|pdf|png|jpe?g)$/i.test(s)) return `https://${s}`;
  return `[[${s.replace(/\.md$/i, '')}]]`;
}

/** Open a sub-habit's note or drawing (in a new tab) or its web page. */
export function openItemLink(ctx: UiContext, hb: Habit, link: string, newTab = true): void {
  const t = itemLinkTarget(link);
  if ('url' in t) { openExternal(t.url); return; }
  void ctx.app.workspace.openLinkText(t.note, hb.path, newTab);
}

/** The open buttons for a row, one per link; null when the sub-habit has none. `onNote` runs before a note or drawing opens (a panel closes to show it). */
export function itemLinkButtons(ctx: UiContext, hb: Habit, item: HabitItem, onNote?: () => void): HTMLElement | null {
  const links = item.links ?? [];
  if (links.length === 0) return null;
  return h('span', { cls: 'helm-itemlog-links' }, ...links.map((link) => {
    const kind = itemLinkKind(link);
    return h('button', {
      cls: 'helm-itemlog-link clickable-icon',
      title: `Open the ${KIND_WORD[kind]} ${itemLinkLabel(link)}`,
      attr: { 'aria-label': `Open ${item.title}'s ${KIND_WORD[kind]} ${itemLinkLabel(link)}` },
      onClick: (ev) => { ev.stopPropagation(); if (kind !== 'web') onNote?.(); openItemLink(ctx, hb, link); },
    }, icon(KIND_ICON[kind]));
  }));
}

/** The menu items that open each of a sub-habit's links. */
export function addOpenItems(menu: Menu, ctx: UiContext, hb: Habit, links: string[]): void {
  for (const l of links) menu.addItem((i) => i.setTitle(`Open ${itemLinkLabel(l)}`).setIcon(itemLinkIcon(l)).onClick(() => openItemLink(ctx, hb, l)));
}

/**
 * The links menu: open each link; add a note, a drawing or a typed link; make a new note or
 * drawing; or take one off. A sub-habit keeps as many links as you like.
 */
export function itemLinkMenu(ctx: UiContext, o: { hb: Habit; title: string; links: string[]; ev: MouseEvent; add: (link: string) => void; remove: (link: string) => void; make: (kind: 'note' | 'drawing') => void }): void {
  o.ev.preventDefault(); o.ev.stopPropagation();
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(o.links.length ? `${o.title}: ${o.links.length} link${o.links.length === 1 ? '' : 's'}` : `Link “${o.title}” to…`).setDisabled(true));
  if (o.links.length) { addOpenItems(menu, ctx, o.hb, o.links); menu.addSeparator(); }
  const add = (link: string): void => { if (o.links.includes(link)) { ctx.notify(`${itemLinkLabel(link)} is already linked.`); return; } o.add(link); };
  menu.addItem((i) => i.setTitle('Add a note…').setIcon('file-text').onClick(() => pickNote(ctx, new Set(), (n) => add(`[[${n.path.replace(/\.md$/, '')}]]`))));
  menu.addItem((i) => i.setTitle('Add an Excalidraw drawing…').setIcon('pen-tool').onClick(() => pickDrawing(ctx, new Set(), (d) => add(`[[${d.path.replace(/\.md$/, '')}]]`))));
  menu.addItem((i) => i.setTitle('Add a web page or a [[link]]…').setIcon('link').onClick(() => askText(ctx, {
    title: `Link for ${o.title}`, label: 'Link', placeholder: 'https://…, [[Note]] or a note name', cta: 'Add',
    hint: 'A web page (YouTube, Songsterr, Ultimate Guitar…), a [[wikilink]], or the name of a note or drawing.',
    onDone: (v) => {
      if (!v) return;
      const link = typedLink(v);
      const t = itemLinkTarget(link);
      if ('note' in t && !ctx.index.notePathOfLink(t.note, o.hb.path)) ctx.notify(`No note or drawing “${t.label}” yet: it is made when you open the link.`);
      add(link);
    },
  })));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('New note…').setIcon('file-plus').onClick(() => o.make('note')));
  menu.addItem((i) => i.setTitle('New drawing…').setIcon('pencil').onClick(() => o.make('drawing')));
  if (o.links.length) {
    menu.addSeparator();
    if (o.links.length === 1) menu.addItem((i) => i.setTitle(`Remove ${itemLinkLabel(o.links[0]!)}`).setIcon('unlink').onClick(() => o.remove(o.links[0]!)));
    else menu.addItem((i) => {
      i.setTitle('Remove a link').setIcon('unlink');
      const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
      for (const l of o.links) sub.addItem((j) => j.setTitle(itemLinkLabel(l)).setIcon(itemLinkIcon(l)).onClick(() => o.remove(l)));
    });
  }
  menu.showAtMouseEvent(o.ev);
}

/** Ask where a sub-habit's new note or drawing goes (its habit's folder in the notes folder by default). */
export function askItemNote(ctx: UiContext, habitId: string, title: string, kind: 'note' | 'drawing', onDone: (r: { name?: string; folder?: string }) => void): void {
  askNameAndLocation(ctx, {
    title: `New ${kind} for ${title}`,
    placeholder: title,
    defaultFolder: ctx.mutations.itemNoteFolder(habitId),
    preview: (name, folder) => ctx.mutations.itemNotePathFor(habitId, title, name, folder || undefined, kind),
    onDone: (r) => { if (r) onDone(r); },
  });
}
