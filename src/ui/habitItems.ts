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
 * The sub-habit chips for a habit on a day. `compact` (the Today tile) shows what was done and what
 * is up next, with a “+” for the rest; the Habits card shows them all. Null for a habit without any.
 */
export function itemChips(ctx: UiContext, hb: Habit, date: IsoDate, opts: { compact?: boolean } = {}): HTMLElement | null {
  const active = (hb.items ?? []).filter((i) => !i.retired);
  if (active.length === 0) return null;
  const today = itemsOn(ctx, hb, date);
  const stats = habitItemStats(hb, ctx.index.snapshot.itemCompletions, ctx.today());
  const statOf = new Map(stats.map((s) => [s.item.id, s]));
  const next = suggestedItem(stats);
  const shown = opts.compact ? active.filter((i) => today.has(i.id) || i.id === next?.id) : active;
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
      h('span', { text: item.title }),
      now?.state === 'done' && now.count > 1 ? h('span', { cls: 'helm-subhabit-count', text: `×${now.count}` }) : null);
  };
  const doneN = active.filter((i) => today.get(i.id)?.state === 'done').length;
  const need = hb.itemsPerDay === 0 ? active.length : Math.min(hb.itemsPerDay ?? 1, active.length);
  return h('div', { cls: ['helm-subhabits', opts.compact && 'is-compact'], onClick: (ev) => ev.stopPropagation() },
    ...shown.map(chip),
    opts.compact ? h('button', { cls: 'helm-subhabit helm-subhabit-more', title: `Log a sub-habit (${doneN}/${need} for today)`, onClick: (ev) => pickItemMenu(ctx, hb, date, ev) }, icon('plus'), h('span', { text: `${doneN}/${need}` })) : null,
  );
}
