/**
 * Sub-habits on screen. Logging lives in one place, the Log practice panel: a row per song with
 * − count + (+ logs it or adds a round, − takes one off, down to nothing), its name a toggle. The
 * Today tile's pill and the Habits card open it; the card's chips are plain toggles; right-click on
 * a chip still has the full menu. The song practised longest ago is marked “up next”.
 */
import { Menu, Modal } from 'obsidian';
import { HABIT_PARTS, type Habit, type HabitItem, type HabitPart, type IsoDate } from '../core/types';
import { partOfTime } from '../core/dailyNote';
import { dayPartOf, habitItemStats, habitOccurrences, suggestedItem, type HabitItemStats } from '../data/habits';
import { h, icon } from './dom';
import type { UiContext } from './context';

interface ItemToday { count: number; state: 'done' | 'skipped' | 'pending'; part?: HabitPart }

/** A line of the habit that day: a part of the day, or `null` for its line in the Habits list. */
type Where = HabitPart | null;

/** Each item's state on `date`, summed over the habit's lines that day, or on one line (`only`). */
function itemsOn(ctx: UiContext, hb: Habit, date: IsoDate, only?: { at: Where }): Map<string, ItemToday> {
  const out = new Map<string, ItemToday>();
  const items = hb.items ?? [];
  for (const c of ctx.index.snapshot.itemCompletions) {
    if (c.habitId !== hb.id || c.date !== date || (only && (c.part ?? null) !== only.at)) continue;
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

/** `part` undefined lets Helm pick: the part of the day it is now for a new log, the line it is on to take one off. */
function set(ctx: UiContext, hb: Habit, item: HabitItem, date: IsoDate, state: 'done' | 'skipped' | 'missed', part: Where | undefined, count?: number): void {
  void ctx.run('Sub-habit', () => ctx.mutations.setHabitItemState(hb.id, item.id, date, state, { ...(part !== undefined ? { part } : {}), ...(count !== undefined ? { count } : {}) }));
}

/** The line a once-a-day habit's item was last logged on that day, if it was. */
function loggedAt(ctx: UiContext, hb: Habit, item: HabitItem, date: IsoDate): Where | undefined {
  const own = ctx.index.snapshot.itemCompletions.filter((c) => c.habitId === hb.id && c.date === date && (c.itemId === item.id || (!c.itemId && c.text.toLowerCase() === item.title.toLowerCase())));
  return own.length ? own[own.length - 1]!.part ?? null : undefined;
}

/** Right-click on a sub-habit: done, one more, a set number of times, skip, clear. */
export function itemMenu(ctx: UiContext, hb: Habit, item: HabitItem, date: IsoDate, ev: MouseEvent): void {
  ev.preventDefault();
  ev.stopPropagation();
  // A once-a-day habit: work on the line the item sits on (one session), else let Helm pick the session.
  const at = hb.parts?.length ? undefined : loggedAt(ctx, hb, item, date);
  const now = itemsOn(ctx, hb, date, at !== undefined ? { at } : undefined).get(item.id) ?? { count: 0, state: 'pending' as const };
  const part: Where | undefined = hb.parts?.length ? partFor(ctx, hb, date, now.part) : at;
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

/** The habit as the index has it now: a panel outlives the render it was opened from. */
const freshHabit = (ctx: UiContext, hb: Habit): Habit => ctx.index.snapshot.habits.get(hb.id) ?? hb;

/**
 * The Log practice panel for one habit on one day. Every change is written at once, one after the
 * other (a quick run of + clicks lands as the count you ended on, never out of order), and the rows
 * redraw from the note once the writes settle.
 */
export function openItemLog(ctx: UiContext, habit: Habit, date: IsoDate): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Log practice · ${habit.title}`);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-itemlog');
  // A habit with parts logs into one of them; a once-a-day habit into the session (part of the day)
  // it is practised in, today the one it is now, so songs played tonight sit under an Evening line.
  const parted = !!habit.parts?.length;
  let part: Where = parted ? partFor(ctx, habit, date) ?? null : sessionFor(ctx, habit, date);
  /** Counts as shown, ahead of the note while writes are queued. */
  const shown = new Map<string, number>();
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  const noted = (hb: Habit, id: string, only?: { at: Where }): number => { const t = itemsOn(ctx, hb, date, only).get(id); return t?.state === 'done' ? t.count : 0; };
  const countOf = (hb: Habit, id: string): number => shown.get(id) ?? noted(hb, id, { at: part });
  /** Rounds that day over every session, with this session's as shown. */
  const dayCountOf = (hb: Habit, id: string): number => noted(hb, id) - noted(hb, id, { at: part }) + countOf(hb, id);
  const change = (item: HabitItem, to: number): void => {
    const n = Math.max(0, to);
    shown.set(item.id, n);
    draw();
    pending++;
    const forPart = part;
    queue = queue.then(() => ctx.run('Sub-habit', () => ctx.mutations.setHabitItemState(habit.id, item.id, date, n > 0 ? 'done' : 'missed', { part: forPart, ...(n > 0 ? { count: n } : {}) })))
      .finally(() => { if (--pending === 0) { shown.clear(); draw(); } });
  };
  const draw = (): void => {
    const hb = freshHabit(ctx, habit);
    const stats = habitItemStats(hb, ctx.index.snapshot.itemCompletions, ctx.today());
    const next = suggestedItem(stats);
    const active = stats.filter((s) => !s.item.retired);
    const ordered = [...active.filter((s) => s.item.id === next?.id), ...active.filter((s) => s.item.id !== next?.id)];
    const doneN = active.filter((s) => dayCountOf(hb, s.item.id) > 0).length;
    // Sessions to pick from: the habit's parts, or for a once-a-day habit every part of the day, and its
    // line in the Habits list when songs sit there.
    const listHas = !parted && ctx.index.snapshot.itemCompletions.some((c) => c.habitId === hb.id && c.date === date && c.part === undefined);
    const choices: Where[] = parted ? [...(hb.parts ?? [])] : [...(listHas || part === null ? [null] : []), ...HABIT_PARTS];
    const pick = (p: Where): void => { if (pending > 0) return; part = p; draw(); };
    const need = hb.itemsPerDay === 0 ? active.length : Math.min(hb.itemsPerDay ?? 1, active.length);
    const parts: (HTMLElement | null)[] = [
      h('div', { cls: ['helm-itemlog-head', doneN >= need && 'is-met'] },
        h('span', { text: `${doneN} of ${active.length} today` }),
        h('span', { cls: 'helm-hint', text: doneN >= need ? `· ${hb.title} is done for the day` : `· ${need} make the day` })),
      choices.length > 1 ? h('div', { cls: 'helm-segmented', attr: { 'aria-label': 'Session' } }, ...choices.map((p) => {
        const n = active.filter((s) => noted(hb, s.item.id, { at: p }) > 0).length;
        return h('button', { cls: ['helm-seg', part === p && 'is-active'], title: n ? `${n} logged in this session` : 'Nothing logged in this session', text: (p === null ? 'Habits list' : p.charAt(0).toUpperCase() + p.slice(1)) + (n && part !== p ? ` · ${n}` : ''), onClick: () => pick(p) });
      })) : null,
      h('div', { cls: 'helm-itemlog-list' }, ...ordered.map((st) => {
        const n = countOf(hb, st.item.id);
        const isNext = next?.id === st.item.id && n === 0;
        return h('div', { cls: ['helm-itemlog-row', n > 0 && 'is-done'] },
          h('button', { cls: 'helm-itemlog-name', title: n > 0 ? 'Click to take the log off' : 'Click to log it', onClick: () => change(st.item, n > 0 ? 0 : 1) },
            icon(n > 0 ? 'check-circle-2' : 'circle'),
            h('span', { cls: 'helm-itemlog-title' }, h('span', { text: st.item.title }), isNext ? h('span', { cls: 'helm-itemlog-next', text: 'up next' }) : null),
            h('span', { cls: 'helm-itemlog-sub', text: `${since(st)} · ${st.count30}× in 30 days` })),
          h('div', { cls: 'helm-itemlog-stepper' },
            h('button', { cls: 'helm-itemlog-step', title: n > 1 ? 'One round less' : 'Take the log off', attr: { 'aria-label': `One less ${st.item.title}`, ...(n === 0 ? { disabled: 'true' } : {}) }, onClick: () => change(st.item, n - 1) }, icon('minus')),
            h('span', { cls: 'helm-itemlog-count', text: String(n) }),
            h('button', { cls: 'helm-itemlog-step', title: n > 0 ? 'One round more' : 'Log it', attr: { 'aria-label': `One more ${st.item.title}` }, onClick: () => change(st.item, n + 1) }, icon('plus'))));
      })),
      active.length === 0 ? h('p', { cls: 'helm-hint', text: 'No sub-habits yet.' }) : null,
      h('div', { cls: 'helm-modal-buttons' },
        h('button', { cls: 'helm-btn helm-btn-quiet', text: 'Edit sub-habits…', onClick: () => { m.close(); void import('./modals/habitForm').then((mod) => mod.openHabitForm(ctx, freshHabit(ctx, habit))); } }),
        h('span', { cls: 'helm-spacer' }),
        h('button', { cls: 'helm-btn mod-cta', text: 'Done', onClick: () => m.close() })),
    ];
    root.replaceChildren(...parts.filter((x): x is HTMLElement => x !== null));
  };
  draw();
  m.open();
  ctx.trackModal(m);
}

/** A once-a-day habit's session for the panel: today the part of the day it is now; another day the line its songs sit on, else where the habit sits. */
function sessionFor(ctx: UiContext, hb: Habit, date: IsoDate): Where {
  if (date === ctx.today()) return partOfTime(ctx.now(), ctx.settings()) as HabitPart;
  const own = ctx.index.snapshot.itemCompletions.filter((c) => c.habitId === hb.id && c.date === date);
  if (own.length) return own[own.length - 1]!.part ?? null;
  return dayPartOf(hb, ctx.index.snapshot.completions, date) ?? null;
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
  const title = [done.length ? `${done.length} practised today (${need} make the day):` : '', lines.length ? lines.join('\n') : 'Nothing practised yet', next && !done.some((i) => i.id === next.id) ? `Up next: ${next.title}` : '', 'Click to log practice'].filter(Boolean).join('\n');
  const label = done.length > 0 ? String(done.length) : next ? next.title : `${active.length}`;
  return h('button', {
    cls: ['helm-habit-tile-moved', 'helm-subhabit-summary', done.length >= need && 'is-met', done.length === 0 && 'is-next'],
    title,
    onClick: (ev) => { ev.stopPropagation(); openItemLog(ctx, hb, date); },
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
      title: `${item.title} — ${since(st)} · ${st.count30}× in 30 days · ${st.total}× in all${isNext ? ' · up next' : ''}\nClick: log it / take the log off · right-click: more · rounds: Log practice`,
      onClick: (ev) => {
        ev.stopPropagation();
        // Off: from the line it is on. On: the part it is now (a once-a-day habit's session, picked by Helm).
        const part = hb.parts?.length ? partFor(ctx, hb, date, now?.part) : undefined;
        set(ctx, hb, item, date, now?.state === 'done' ? 'missed' : 'done', part, now?.state === 'done' ? undefined : 1);
      },
      onContextMenu: (ev) => itemMenu(ctx, hb, item, date, ev),
    },
      now?.state === 'done' ? icon('check') : now?.state === 'skipped' ? icon('minus') : isNext ? icon('arrow-right') : null,
      h('span', { cls: 'helm-subhabit-name', text: item.title }),
      now?.state === 'done' && now.count > 1 ? h('span', { cls: 'helm-subhabit-count', text: `×${now.count}` }) : null);
  };
  return h('div', { cls: 'helm-subhabits', onClick: (ev) => ev.stopPropagation() }, ...active.map(chip),
    h('button', { cls: 'helm-subhabit helm-subhabit-more', title: 'Log practice: rounds per song', onClick: (ev) => { ev.stopPropagation(); openItemLog(ctx, hb, date); } }, icon('list-plus'), h('span', { text: 'Log practice…' })));
}
