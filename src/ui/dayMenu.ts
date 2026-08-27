/** Right-click menu for any day cell in the calendar: new task, plan, open. Month blocks get a smaller one. */
import { Menu } from 'obsidian';
import type { IsoDate } from '../core/types';
import type { Period } from '../core/periods';
import { humanDate } from '../core/dates';
import type { UiContext } from './context';
import { openCapture } from './modals/capture';
import { openPlanDay } from './modals/planDay';

export function dayMenu(ctx: UiContext, date: IsoDate, ev: MouseEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  const today = ctx.today();
  const label = humanDate(date, today);
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(`New task on ${label}…`).setIcon('plus').onClick(() => openCapture(ctx, { date })));
  if (date >= today) menu.addItem((i) => i.setTitle('Plan this day…').setIcon('list-plus').onClick(() => openPlanDay(ctx, date)));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('Open day').setIcon('sun').onClick(() => ctx.navigate('today', { date })));
  menu.addItem((i) => i.setTitle('Open daily note').setIcon('file-text').onClick(() => void ctx.run('Open note', async () => { const p = await ctx.mutations.ensureDailyNote(date); await ctx.openFile(p); })));
  menu.showAtMouseEvent(ev);
}

/** For a month / quarter / year block: a task lands on today when inside the period, else on its first day. */
export function firstUsefulDay(p: Period, today: IsoDate): IsoDate {
  return p.start <= today && today <= p.end ? today : p.start;
}

export function periodMenu(ctx: UiContext, p: Period, ev: MouseEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  const today = ctx.today();
  const date = firstUsefulDay(p, today);
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(`New task in ${p.label} (${humanDate(date, today)})…`).setIcon('plus').onClick(() => openCapture(ctx, { date })));
  menu.addSeparator();
  menu.addItem((i) => i.setTitle(`Open ${p.kind}`).setIcon('calendar').onClick(() => ctx.navigate('week', { date: p.start, scope: p.kind })));
  menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => void ctx.run('Open note', async () => { const path = await ctx.mutations.ensurePeriodicNote(p); await ctx.openFile(path); })));
  menu.showAtMouseEvent(ev);
}

/** Attach the right-click menu to a cell. */
export function onDayContext(el: HTMLElement, ctx: UiContext, date: IsoDate): HTMLElement {
  el.addEventListener('contextmenu', (ev) => dayMenu(ctx, date, ev));
  return el;
}
