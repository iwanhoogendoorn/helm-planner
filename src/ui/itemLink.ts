/**
 * A sub-habit's link: the song or exercise it is about, a note in the vault (chords, tabs, what to
 * work on) or a web page (a lesson, a backing track). The Log practice rows show it as a button; the
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

/** A button that opens the link, for a row; null when the sub-habit has none. `onNote` runs before a note or drawing opens (a panel closes to show it). */
export function itemLinkButton(ctx: UiContext, hb: Habit, item: HabitItem, onNote?: () => void): HTMLElement | null {
  if (!item.link) return null;
  const kind = itemLinkKind(item.link);
  return h('button', {
    cls: 'helm-itemlog-link clickable-icon',
    title: `Open the ${KIND_WORD[kind]} ${itemLinkLabel(item.link)}`,
    attr: { 'aria-label': `Open ${item.title}'s ${KIND_WORD[kind]}` },
    onClick: (ev) => { ev.stopPropagation(); if (kind !== 'web') onNote?.(); openItemLink(ctx, hb, item.link!); },
  }, icon(KIND_ICON[kind]));
}

/**
 * The link menu: open what is linked; link a note, a drawing or a typed link; make a new note or
 * drawing; or take the link off. `set` gets the new link (null = none); `make` makes a note or a
 * drawing for the sub-habit.
 */
export function itemLinkMenu(ctx: UiContext, o: { hb: Habit; title: string; link: string | undefined; ev: MouseEvent; set: (link: string | null) => void; make: (kind: 'note' | 'drawing') => void }): void {
  o.ev.preventDefault(); o.ev.stopPropagation();
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(o.link ? `${o.title} → ${itemLinkLabel(o.link)}` : `Link “${o.title}” to…`).setDisabled(true));
  if (o.link) { const k = itemLinkKind(o.link); menu.addItem((i) => i.setTitle(`Open the ${KIND_WORD[k]}`).setIcon(KIND_ICON[k]).onClick(() => openItemLink(ctx, o.hb, o.link!))); menu.addSeparator(); }
  menu.addItem((i) => i.setTitle('A note…').setIcon('file-text').onClick(() => pickNote(ctx, new Set(), (n) => o.set(`[[${n.path.replace(/\.md$/, '')}]]`))));
  menu.addItem((i) => i.setTitle('An Excalidraw drawing…').setIcon('pen-tool').onClick(() => pickDrawing(ctx, new Set(), (d) => o.set(`[[${d.path.replace(/\.md$/, '')}]]`))));
  menu.addItem((i) => i.setTitle('A web page or a [[link]]…').setIcon('link').onClick(() => askText(ctx, {
    title: `Link for ${o.title}`, label: 'Link', placeholder: 'https://…, [[Note]] or a note name', cta: 'Link',
    ...(o.link ? { value: o.link } : {}),
    hint: 'A web page (YouTube, Songsterr, Ultimate Guitar…), a [[wikilink]], or the name of a note or drawing.',
    onDone: (v) => {
      if (!v) return;
      const link = typedLink(v);
      const t = itemLinkTarget(link);
      if ('note' in t && !ctx.index.notePathOfLink(t.note, o.hb.path)) ctx.notify(`No note or drawing “${t.label}” yet: it is made when you open the link.`);
      o.set(link);
    },
  })));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('New note…').setIcon('file-plus').onClick(() => o.make('note')));
  menu.addItem((i) => i.setTitle('New drawing…').setIcon('pencil').onClick(() => o.make('drawing')));
  if (o.link) { menu.addSeparator(); menu.addItem((i) => i.setTitle('Remove the link').setIcon('unlink').onClick(() => o.set(null))); }
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
