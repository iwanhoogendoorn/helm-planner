/**
 * Sub-habits on screen: the songs under Guitar as chips under the habit's name. Click a chip to log
 * it for the day (again to add a repetition), shift-click to clear it, right-click for the rest.
 * The song practised longest ago is marked “up next”.
 */
import { Menu } from 'obsidian';
import type { Habit, HabitItem, HabitPart, IsoDate } from '../core/types';
import { partOfTime } from '../core/dailyNote';
import { habitItemStats, habitOccurrences, suggestedItem, type HabitItemStats } from '../data/habits';
import { h, icon } from './dom';
import type { UiContext } from './context';

interface ItemToday { count: number; state: 'done' | 'skipped' | 'pending'; part?: HabitPart }

/** Each item's state on `date`, summed over the habit's occurrences that day. */
function itemsOn(ctx: UiContext, hb: Habit, date: IsoDate): Map<string, ItemToday> {
  const out = new Map<string, ItemToday>();
  const items = hb.items ?? [];
  for (const c of ctx.index.snapshot.itemCompletions) {
    if (c.habitId !== hb.id || c.date !== date) continue;
    const item = c.itemId ? items.find((i) => i.id === c.itemId) : items.find((i) => i.title.toLowerCase() === c.text.toLowerCase());
    if (!item) continue;
    const cur = out.get(item.id) ?? { count: 0, state: 'pending' as const };
    if (c.state === 'done') out.set(item.id, { count: cur.count + c.count, state: 'done', ...(c.part ? { part: c.part } : cur.part ? { part: cur.part } : {}) });
    else if (c.state === 'skipped' && cur.state === 'pending') out.set(item.id, { ...cur, state: 'skipped', ...(c.part ? { part: c.part } : {}) });
  }
  return out;
}

/** Which occurrence a new sub-habit line goes under: the part of the day you are in when the habit has it, else its first part. */
function partFor(ctx: UiContext, hb: Habit, date: IsoDate, known?: HabitPart): HabitPart | undefined {
  if (!hb.parts?.length) return undefined;
  if (known && hb.parts.includes(known)) return known;
  if (date === ctx.today()) {
    const now = partOfTime(ctx.now(), ctx.settings());
    if (now !== 'anytime' && hb.parts.includes(now)) return now;
  }
  const done = ctx.index.snapshot.completions.filter((c) => c.habitId === hb.id && c.date === date && c.state === 'done').map((c) => c.part);
  return habitOccurrences(hb).find((p) => p !== undefined && !done.includes(p)) ?? hb.parts[0];
}

function set(ctx: UiContext, hb: Habit, item: HabitItem, date: IsoDate, state: 'done' | 'skipped' | 'missed', part: HabitPart | undefined, count?: number): void {
  void ctx.run('Sub-habit', () => ctx.mutations.setHabitItemState(hb.id, item.id, date, state, { ...(part ? { part } : {}), ...(count !== undefined ? { count } : {}) }));
}

/** Right-click on a sub-habit: done, one more, a set number of times, skip, clear. */
export function itemMenu(ctx: UiContext, hb: Habit, item: HabitItem, date: IsoDate, ev: MouseEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  const now = itemsOn(ctx, hb, date).get(item.id) ?? { count: 0, state: 'pending' as const };
  const part = partFor(ctx, hb, date, now.part);
  const menu = new Menu();
  menu.addItem((i) => i.setTitle(item.title).setDisabled(true));
  if (now.state !== 'done') menu.addItem((i) => i.setTitle('Practised').setIcon('check').onClick(() => set(ctx, hb, item, date, 'done', part, 1)));
  else menu.addItem((i) => i.setTitle(`One more (×${now.count + 1})`).setIcon('plus').onClick(() => set(ctx, hb, item, date, 'done', part, now.count + 1)));
  menu.addItem((i) => {
    i.setTitle('Times today').setIcon('repeat');
    const sub = (i as unknown as { setSubmenu: () => Menu }).setSubmenu();
    for (const n of [1, 2, 3, 4, 5, 6, 8, 10]) sub.addItem((j) => j.setTitle(`×${n}`).setIcon(now.state === 'done' && now.count === n ? 'check' : 'circle').onClick(() => set(ctx, hb, item, date, 'done', part, n)));
  });
  if (now.state === 'done' && now.count > 1) menu.addItem((i) => i.setTitle(`One less (×${now.count - 1})`).setIcon('minus').onClick(() => set(ctx, hb, item, date, 'done', part, now.count - 1)));
  if (now.state !== 'skipped') menu.addItem((i) => i.setTitle('Skip today').setIcon('minus-circle').onClick(() => set(ctx, hb, item, date, 'skipped', part)));
  if (now.state !== 'pending') menu.addItem((i) => i.setTitle('Clear').setIcon('circle').onClick(() => set(ctx, hb, item, date, 'missed', part)));
  menu.showAtMouseEvent(ev);
}

/** Every active sub-habit in a menu, to log one: the Today tile's “+”. */
export function pickItemMenu(ctx: UiContext, hb: Habit, date: IsoDate, ev: MouseEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  const today = itemsOn(ctx, hb, date);
  const stats = habitItemStats(hb, ctx.index.snapshot.itemCompletions, ctx.today());
  const next = suggestedItem(stats);
  const menu = new Menu();
  for (const st of stats.filter((s) => !s.item.retired)) {
    const now = today.get(st.item.id);
    const label = `${st.item.title}${now?.state === 'done' ? ` ×${now.count}` : ''}${next?.id === st.item.id ? '  · up next' : ''}`;
    menu.addItem((i) => i.setTitle(label).setIcon(now?.state === 'done' ? 'check' : now?.state === 'skipped' ? 'minus' : 'circle')
      .onClick(() => set(ctx, hb, st.item, date, 'done', partFor(ctx, hb, date, now?.part), now?.state === 'done' ? now.count + 1 : 1)));
  }
  menu.addSeparator();
  menu.addItem((i) => i.setTitle('Add a sub-habit…').setIcon('plus').onClick(() => void import('./modals/habitForm').then((mod) => mod.openHabitForm(ctx, hb))));
  menu.showAtMouseEvent(ev);
}

const since = (s: HabitItemStats): string => s.daysSince === undefined ? 'never practised' : s.daysSince === 0 ? 'practised today' : s.daysSince === 1 ? 'last practised yesterday' : `last practised ${s.daysSince} days ago`;

/**
 * The Today tile's one-line summary of a habit's sub-habits: what was practised today (“3 practised”),
 * or the one up next when nothing was. One small pill, the same size as the tile's other chips, so a
 * habit with ten songs is no taller than one without; a click opens the list to log one.
 */
export function itemSummary(ctx: UiContext, hb: Habit, date: IsoDate): HTMLElement | null {
  const active = (hb.items ?? []).filter((i) => !i.retired);
  if (active.length === 0) return null;
  const today = itemsOn(ctx, hb, date);
  const done = active.filter((i) => today.get(i.id)?.state === 'done');
  const need = hb.itemsPerDay === 0 ? active.length : Math.min(hb.itemsPerDay ?? 1, active.length);
  const next = suggestedItem(habitItemStats(hb, ctx.index.snapshot.itemCompletions, ctx.today()));
  const lines = done.map((i) => `✓ ${i.title}${today.get(i.id)!.count > 1 ? ` ×${today.get(i.id)!.count}` : ''}`);
  const title = [done.length ? `${done.length} practised today (${need} make the day):` : '', lines.length ? lines.join('\n') : 'Nothing practised yet', next && !done.some((i) => i.id === next.id) ? `Up next: ${next.title}` : '', 'Click to log one'].filter(Boolean).join('\n');
  const label = done.length > 0 ? String(done.length) : next ? next.title : `${active.length}`;
  return h('button', {
    cls: ['helm-habit-tile-moved', 'helm-subhabit-summary', done.length >= need && 'is-met', done.length === 0 && 'is-next'],
    title,
    onClick: (ev) => pickItemMenu(ctx, hb, date, ev),
  }, icon(done.length > 0 ? 'music' : 'arrow-right'), h('span', { text: label }));
}

/** The sub-habit chips for a habit on a day, every active one (the Habits card). Null for a habit without any. */
export function itemChips(ctx: UiContext, hb: Habit, date: IsoDate): HTMLElement | null {
  const active = (hb.items ?? []).filter((i) => !i.retired);
  if (active.length === 0) return null;
  const today = itemsOn(ctx, hb, date);
  const stats = habitItemStats(hb, ctx.index.snapshot.itemCompletions, ctx.today());
  const statOf = new Map(stats.map((s) => [s.item.id, s]));
  const next = suggestedItem(stats);
  const chip = (item: HabitItem): HTMLElement => {
    const now = today.get(item.id);
    const st = statOf.get(item.id)!;
    const isNext = next?.id === item.id && now?.state !== 'done';
    return h('button', {
      cls: ['helm-subhabit', now && `is-${now.state}`, isNext && 'is-next'],
      title: `${item.title} — ${since(st)} · ${st.count30}× in 30 days · ${st.total}× in all${isNext ? ' · up next' : ''}\nClick: practised (again: one more) · shift-click: clear · right-click: more`,
      onClick: (ev) => {
        ev.stopPropagation();
        const part = partFor(ctx, hb, date, now?.part);
        if (ev.shiftKey) set(ctx, hb, item, date, 'missed', part);
        else set(ctx, hb, item, date, 'done', part, now?.state === 'done' ? now.count + 1 : 1);
      },
      onContextMenu: (ev) => itemMenu(ctx, hb, item, date, ev),
    },
      now?.state === 'done' ? icon('check') : now?.state === 'skipped' ? icon('minus') : isNext ? icon('arrow-right') : null,
      h('span', { cls: 'helm-subhabit-name', text: item.title }),
      now?.state === 'done' && now.count > 1 ? h('span', { cls: 'helm-subhabit-count', text: `×${now.count}` }) : null);
  };
  return h('div', { cls: 'helm-subhabits', onClick: (ev) => ev.stopPropagation() }, ...active.map(chip));
}
