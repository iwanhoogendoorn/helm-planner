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
import { h, icon } from './dom';
import type { UiContext } from './context';

/** A short name for what the link points at: the note's name, or the web site. */
export function itemLinkLabel(link: string): string {
  const t = itemLinkTarget(link);
  if ('note' in t) return t.label;
  try { return new URL(t.url).hostname.replace(/^www\./, ''); } catch { return t.url; }
}

export const isWebLink = (link: string): boolean => 'url' in itemLinkTarget(link);

/** Open a sub-habit's note (in a new tab with Cmd/Ctrl, or from a panel that closes) or its web page. */
export function openItemLink(ctx: UiContext, hb: Habit, link: string, newTab = true): void {
  const t = itemLinkTarget(link);
  if ('url' in t) { openExternal(t.url); return; }
  void ctx.app.workspace.openLinkText(t.note, hb.path, newTab);
}

/** A button that opens the link, for a row; null when the sub-habit has none. `onNote` runs before a note opens (a panel closes to show it). */
export function itemLinkButton(ctx: UiContext, hb: Habit, item: HabitItem, onNote?: () => void): HTMLElement | null {
  if (!item.link) return null;
  const web = isWebLink(item.link);
  return h('button', {
    cls: 'helm-itemlog-link clickable-icon',
    title: `${web ? 'Open' : 'Open the note'} ${itemLinkLabel(item.link)}`,
    attr: { 'aria-label': `Open ${item.title}'s ${web ? 'link' : 'note'}` },
    onClick: (ev) => { ev.stopPropagation(); if (!web) onNote?.(); openItemLink(ctx, hb, item.link!); },
  }, icon(web ? 'external-link' : 'file-text'));
}

/**
 * The link menu: open what is linked, link a note, paste a web address, make a new note, or take the
 * link off. `set` gets the new link (null = none); `newNote` makes a note for the sub-habit.
 */
export function itemLinkMenu(ctx: UiContext, o: { hb: Habit; title: string; link: string | undefined; ev: MouseEvent; set: (link: string | null) => void; newNote: () => void }): void {
  o.ev.preventDefault(); o.ev.stopPropagation();
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(o.link ? `${o.title} → ${itemLinkLabel(o.link)}` : `Link “${o.title}” to…`).setDisabled(true));
  if (o.link) menu.addItem((i) => i.setTitle(isWebLink(o.link!) ? 'Open the web page' : 'Open the note').setIcon(isWebLink(o.link!) ? 'external-link' : 'file-text').onClick(() => openItemLink(ctx, o.hb, o.link!)));
  menu.addItem((i) => i.setTitle(o.link ? 'Link another note…' : 'A note in the vault…').setIcon('link').onClick(() => pickNote(ctx, new Set(), (n) => o.set(`[[${n.path.replace(/\.md$/, '')}]]`))));
  menu.addItem((i) => i.setTitle('New note…').setIcon('file-plus').onClick(() => o.newNote()));
  menu.addItem((i) => i.setTitle('A web page…').setIcon('globe').onClick(() => askText(ctx, {
    title: `Web page for ${o.title}`, label: 'Address', placeholder: 'https://…', cta: 'Link',
    ...(o.link && isWebLink(o.link) ? { value: o.link } : {}),
    hint: 'A lesson, a tab, a backing track: YouTube, Songsterr, Ultimate Guitar…',
    onDone: (v) => { if (!v) return; o.set(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`); },
  })));
  if (o.link) menu.addItem((i) => i.setTitle('Remove the link').setIcon('unlink').onClick(() => o.set(null)));
  menu.showAtMouseEvent(o.ev);
}

/** Ask where a sub-habit's new note goes (its habit's folder in the notes folder by default). */
export function askItemNote(ctx: UiContext, habitId: string, title: string, onDone: (r: { name?: string; folder?: string }) => void): void {
  askNameAndLocation(ctx, {
    title: `New note for ${title}`,
    placeholder: title,
    defaultFolder: ctx.mutations.itemNoteFolder(habitId),
    preview: (name, folder) => ctx.mutations.itemNotePathFor(habitId, title, name, folder || undefined),
    onDone: (r) => { if (r) onDone(r); },
  });
}
