/**
 * The day's pictures, each whole and in its own shape, each in its own place: the quote and the morning
 * comic open the day, the evening comic closes the Daybook. Today says what is still to come; any other
 * day shows only what it has.
 */
import { Modal } from 'obsidian';
import type { DayPictureKind } from '../core/dayPictures';
import { humanDate } from '../core/dates';
import type { IsoDate } from '../core/types';
import type { UiContext } from './context';
import { button, h, iconButton, section } from './dom';

const LABEL: Record<DayPictureKind, string> = { quote: 'Daily quote', morning: 'Morning comic', evening: 'Evening comic' };
const PENDING: Record<DayPictureKind, string> = { quote: 'Arrives when the day starts', morning: 'Arrives when the day starts', evening: 'Arrives when the day is finished' };

/** One picture of the day, or on today what is still to come; nothing otherwise. */
export function dayPictureTile(ctx: UiContext, date: IsoDate, kind: DayPictureKind): HTMLElement | null {
  const path = ctx.index.dayPictures(date).find((p) => p.kind === kind)?.path;
  const url = path ? ctx.resourceUrl(path) : undefined;
  const label = LABEL[kind];
  if (url) return h('button', { cls: 'helm-day-picture', title: `Enlarge the ${label.toLowerCase()}`, attr: { 'aria-label': `Enlarge the ${label.toLowerCase()}` }, onClick: () => openDayPicture(ctx, date, kind) }, h('img', { attr: { src: url, alt: label } }));
  return date === ctx.today() ? h('div', { cls: 'helm-day-picture is-pending' }, h('strong', { text: label }), h('span', { text: PENDING[kind] })) : null;
}

/** A picture with a section of its own: the quote and the morning comic open the day. */
export function dayPictureSection(ctx: UiContext, date: IsoDate, kind: DayPictureKind, store: Map<string, boolean>): HTMLElement | null {
  const tile = dayPictureTile(ctx, date, kind);
  return tile && section(LABEL[kind], { store, key: `picture-${kind}`, cls: 'helm-day-picture-section', collapsed: false }, tile);
}

export const hasComic = (ctx: UiContext, date: IsoDate): boolean => ctx.index.dayPictures(date).some((p) => p.kind === 'evening');

/** The evening comic's mark on a calendar day: says it is there, and opens it without leaving the calendar. */
export function comicBadge(ctx: UiContext, date: IsoDate): HTMLElement | null {
  if (!hasComic(ctx, date)) return null;
  return iconButton('image', `Evening comic of ${humanDate(date, ctx.today())}`, (ev) => { ev.stopPropagation(); openDayPicture(ctx, date, 'evening'); }, 'helm-comic-badge');
}

/** The comics from the calendar: the latest one up to the day in view, or else the first one after it. */
export function comicsButton(ctx: UiContext, around: IsoDate): HTMLElement | null {
  const days = ctx.index.pictureDays('evening');
  if (days.length === 0) return null;
  const start = [...days].reverse().find((d) => d.date <= around) ?? days[0]!;
  return button('Comics', { icon: 'image', title: `Flip through the ${days.length === 1 ? 'evening comic' : `${days.length} evening comics`}`, onClick: () => openDayPicture(ctx, start.date, 'evening') });
}

/** One picture large, with the same picture of the days around it a click or an arrow key away. */
export function openDayPicture(ctx: UiContext, date: IsoDate, kind: DayPictureKind): void {
  const days = ctx.index.pictureDays(kind).flatMap((d) => { const url = ctx.resourceUrl(d.path); return url ? [{ date: d.date, url }] : []; });
  let at = days.findIndex((d) => d.date === date);
  if (at === -1) return;
  const label = LABEL[kind];
  const m = new Modal(ctx.app);
  m.titleEl.setText(label);
  m.modalEl?.addClass('helm-picture-modal');
  const step = (by: number): void => { if (!days[at + by]) return; at += by; show(); };
  const stepButton = (by: number, name: string, title: string): HTMLElement => {
    const b = iconButton(name, title, () => step(by));
    if (!days[at + by]) b.setAttribute('disabled', 'true');
    return b;
  };
  const show = (): void => {
    const day = days[at]!;
    m.contentEl.replaceChildren(
      h('div', { cls: 'helm-picture-bar' },
        stepButton(-1, 'chevron-left', `Previous ${label.toLowerCase()}`),
        h('div', { cls: 'helm-picture-when' },
          h('button', { cls: 'helm-picture-day', title: 'Open this day', onClick: () => { m.close(); ctx.navigate('today', { date: day.date }); } }, h('span', { text: humanDate(day.date, ctx.today(), { year: true }) })),
          h('span', { cls: 'helm-hint', text: `${at + 1} of ${days.length}` }),
        ),
        stepButton(1, 'chevron-right', `Next ${label.toLowerCase()}`),
      ),
      h('img', { cls: 'helm-picture-large', attr: { src: day.url, alt: `${label}, ${day.date}` } }),
    );
  };
  m.scope?.register([], 'ArrowLeft', () => { step(-1); return false; });
  m.scope?.register([], 'ArrowRight', () => { step(1); return false; });
  show();
  ctx.trackModal?.(m);
  m.open();
}
