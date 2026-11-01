/**
 * The day's pictures, each whole and in its own shape, each in its own place: the quote and the morning
 * comic open the day, the evening comic closes the Daybook. Today says what is still to come; any other
 * day shows only what it has.
 */
import { Modal } from 'obsidian';
import type { DayPictureKind } from '../core/dayPictures';
import type { IsoDate } from '../core/types';
import type { UiContext } from './context';
import { h, section } from './dom';

const LABEL: Record<DayPictureKind, string> = { quote: 'Daily quote', morning: 'Morning comic', evening: 'Evening comic' };
const PENDING: Record<DayPictureKind, string> = { quote: 'Arrives when the day starts', morning: 'Arrives when the day starts', evening: 'Arrives when the day is finished' };

/** One picture of the day, or on today what is still to come; nothing otherwise. */
export function dayPictureTile(ctx: UiContext, date: IsoDate, kind: DayPictureKind): HTMLElement | null {
  const path = ctx.index.dayPictures(date).find((p) => p.kind === kind)?.path;
  const url = path ? ctx.resourceUrl(path) : undefined;
  const label = LABEL[kind];
  if (url) return h('button', { cls: 'helm-day-picture', title: `Enlarge the ${label.toLowerCase()}`, attr: { 'aria-label': `Enlarge the ${label.toLowerCase()}` }, onClick: () => enlarge(ctx, label, url) }, h('img', { attr: { src: url, alt: label } }));
  return date === ctx.today() ? h('div', { cls: 'helm-day-picture is-pending' }, h('strong', { text: label }), h('span', { text: PENDING[kind] })) : null;
}

/** A picture with a section of its own: the quote and the morning comic open the day. */
export function dayPictureSection(ctx: UiContext, date: IsoDate, kind: DayPictureKind, store: Map<string, boolean>): HTMLElement | null {
  const tile = dayPictureTile(ctx, date, kind);
  return tile && section(LABEL[kind], { store, key: `picture-${kind}`, cls: 'helm-day-picture-section', collapsed: false }, tile);
}

function enlarge(ctx: UiContext, label: string, url: string): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(label);
  m.modalEl?.addClass('helm-picture-modal');
  m.contentEl.appendChild(h('img', { cls: 'helm-picture-large', attr: { src: url, alt: label } }));
  ctx.trackModal?.(m);
  m.open();
}
