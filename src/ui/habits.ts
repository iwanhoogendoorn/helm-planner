/** Right-click menu for a habit, wherever it is shown. */
import { Menu } from 'obsidian';
import type { Habit, HabitPart, IsoDate } from '../core/types';
import type { UiContext } from './context';
import { openHabitForm } from './modals/habitForm';
import { addDrawingItems, targetForHabit } from './drawings';
import { dayPartOf } from '../data/habits';
import { addNoteItems } from './notes';

export function habitMenu(ctx: UiContext, hb: Habit, ev: MouseEvent, opts: { date?: IsoDate; part?: HabitPart; state?: 'done' | 'skipped' | 'missed' | 'pending' } = {}): void {
  ev.preventDefault();
  ev.stopPropagation();
  const menu = new Menu();
  menu.addItem((i) => i.setTitle('Edit…').setIcon('pencil').onClick(() => openHabitForm(ctx, hb)));
  if (opts.date) {
    const date = opts.date;
    const label = opts.part ? ` (${opts.part})` : '';
    if (opts.state !== 'done') menu.addItem((i) => i.setTitle(`Mark done${label}`).setIcon('check').onClick(() => void ctx.run('Habit', () => ctx.mutations.setHabitState(hb.id, date, 'done', opts.part))));
    if (opts.state !== 'skipped') menu.addItem((i) => i.setTitle(`Skip today${label}`).setIcon('minus').onClick(() => void ctx.run('Habit', () => ctx.mutations.setHabitState(hb.id, date, 'skipped', opts.part))));
    if (opts.state === 'done' || opts.state === 'skipped') menu.addItem((i) => i.setTitle(`Clear${label}`).setIcon('circle').onClick(() => void ctx.run('Habit', () => ctx.mutations.setHabitState(hb.id, date, 'missed', opts.part))));
  }
  if (opts.date && !(hb.parts && hb.parts.length)) {
    const date = opts.date;
    const current = dayPartOf(hb, ctx.index.snapshot.completions, date);
    menu.addItem((i) => {
      i.setTitle('For this day').setIcon('sun-moon');
      const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
      for (const [part, title] of [[undefined, 'General (Habits section)'], ['morning', 'Morning'], ['afternoon', 'Afternoon'], ['evening', 'Evening']] as const) {
        sub.addItem((j) => { j.setTitle(title).setIcon(part === current ? 'check' : 'circle').onClick(() => void ctx.run('Move habit', () => ctx.mutations.moveHabitForDay(hb.id, date, part))); });
      }
    });
  }
  menu.addSeparator();
  menu.addItem((i) => { i.setTitle('Notes').setIcon('sticky-note'); const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu(); addNoteItems(sub, ctx, targetForHabit(hb)); });
  menu.addItem((i) => { i.setTitle('Drawings').setIcon('pen-tool'); const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu(); addDrawingItems(sub, ctx, targetForHabit(hb)); });
  menu.addSeparator();
  menu.addItem((i) => i.setTitle(hb.active ? 'Pause habit' : 'Resume habit').setIcon(hb.active ? 'pause' : 'play').onClick(() => void ctx.run('Habit', () => ctx.mutations.setHabitFields(hb.id, { active: !hb.active }))));
  menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(() => void ctx.openFile(hb.path)));
  menu.addItem((i) => i.setTitle('Delete habit…').setIcon('trash').setWarning(true).onClick(() => { if (window.confirm(`Move the habit “${hb.title}” to the trash? Past daily notes keep their ticks.`)) void ctx.run('Delete habit', () => ctx.mutations.deleteHabit(hb.id)); }));
  menu.showAtMouseEvent(ev);
}
