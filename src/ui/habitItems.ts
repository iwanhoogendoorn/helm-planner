/**
 * Sub-habits on screen. Logging lives in one place, the Log practice panel: a row per song with
 * − count + (+ logs it or adds a round, − takes one off, down to nothing), its name a toggle. The
 * Today tile's pill and the Habits card open it; the card's chips are plain toggles; right-click on
 * a chip still has the full menu. You pick what to practise yourself: the panel's Plan mode marks the
 * day's songs, and groups (a key, a scale) sort them.
 */
import { Menu, Modal } from 'obsidian';
import { HABIT_PARTS, type Habit, type HabitItem, type HabitPart, type IsoDate } from '../core/types';
import { partOfTime } from '../core/dailyNote';
import { dayPartOf, habitItemStats, habitOccurrences, type HabitItemStats } from '../data/habits';
import { askText } from './fields';
import { askItemNote, itemLinkButton, itemLinkIcon, itemLinkLabel, itemLinkMenu, openItemLink } from './itemLink';
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
  if (item.link) menu.addItem((i) => i.setTitle(`Open ${itemLinkLabel(item.link!)}`).setIcon(itemLinkIcon(item.link!)).onClick(() => openItemLink(ctx, hb, item.link!)));
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

/** A habit's active sub-habits sorted into its groups, in order; the ungrouped come last. */
function grouped<T extends { item: HabitItem }>(hb: Habit, rows: T[]): { group: string | undefined; rows: T[] }[] {
  const groups = hb.itemGroups ?? [];
  const out = groups.map((g) => ({ group: g as string | undefined, rows: rows.filter((r) => r.item.group === g) }));
  const loose = rows.filter((r) => !r.item.group || !groups.includes(r.item.group));
  if (loose.length > 0 || groups.length === 0) out.push({ group: undefined, rows: loose });
  return out;
}

/**
 * The Log practice panel for one habit on one day. Two modes:
 *
 * - **Practice**: the day's plan on top (what you picked, plus anything logged this session), the
 *   rest folded under "Everything else"; with no plan, every sub-habit by group. A row is − count +,
 *   its name a toggle.
 * - **Plan**: tick what you mean to practise, move songs between groups (the folder button), and
 *   add, rename, reorder or remove groups. "Start practising" goes back to Practice with the plan.
 *
 * Every change is written at once, one after the other, and the rows redraw from the notes once the
 * writes settle.
 */
export function openItemLog(ctx: UiContext, habit: Habit, date: IsoDate, opts: { mode?: 'practice' | 'plan' } = {}): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(`Log practice · ${habit.title}`);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-itemlog');
  // A habit with parts logs into one of them; a once-a-day habit into the session (part of the day)
  // it is practised in, today the one it is now, so songs played tonight sit under an Evening line.
  const parted = !!habit.parts?.length;
  let part: Where = parted ? partFor(ctx, habit, date) ?? null : sessionFor(ctx, habit, date);
  let mode: 'practice' | 'plan' = opts.mode ?? 'practice';
  let showRest = false;
  const planOf = (hb: Habit): string[] => (hb.itemPlan?.date === date ? hb.itemPlan.items : []);
  /** The plan as picked, ahead of the note while writes are queued. */
  let planned: Set<string> | undefined;
  /** Counts as shown, ahead of the note while writes are queued. */
  const shown = new Map<string, number>();
  let queue: Promise<void> = Promise.resolve();
  let pending = 0;
  const enqueue = (label: string, fn: () => Promise<unknown>): void => {
    pending++;
    queue = queue.then(() => ctx.run(label, fn)).then(() => undefined, () => undefined)
      .finally(() => { if (--pending === 0) { shown.clear(); planned = undefined; draw(); } });
  };
  const noted = (hb: Habit, id: string, only?: { at: Where }): number => { const t = itemsOn(ctx, hb, date, only).get(id); return t?.state === 'done' ? t.count : 0; };
  const countOf = (hb: Habit, id: string): number => shown.get(id) ?? noted(hb, id, { at: part });
  /** Rounds that day over every session, with this session's as shown. */
  const dayCountOf = (hb: Habit, id: string): number => noted(hb, id) - noted(hb, id, { at: part }) + countOf(hb, id);
  const change = (item: HabitItem, to: number): void => {
    const n = Math.max(0, to);
    shown.set(item.id, n);
    draw();
    const forPart = part;
    enqueue('Sub-habit', () => ctx.mutations.setHabitItemState(habit.id, item.id, date, n > 0 ? 'done' : 'missed', { part: forPart, ...(n > 0 ? { count: n } : {}) }));
  };
  const togglePlan = (hb: Habit, item: HabitItem): void => {
    const cur = new Set(planned ?? planOf(hb));
    if (cur.has(item.id)) cur.delete(item.id); else cur.add(item.id);
    planned = cur;
    draw();
    // Written in the order the sub-habits are listed.
    const ids = (hb.items ?? []).filter((i) => cur.has(i.id)).map((i) => i.id);
    enqueue('Plan', () => ctx.mutations.setItemPlan(habit.id, date, ids));
  };
  const clearPlan = (): void => { planned = new Set(); draw(); enqueue('Plan', () => ctx.mutations.setItemPlan(habit.id, date, [])); };
  const linkMenu = (hb: Habit, item: HabitItem, ev: MouseEvent): void => itemLinkMenu(ctx, {
    hb, title: item.title, link: item.link, ev,
    set: (link) => enqueue('Sub-habit link', () => ctx.mutations.setHabitItem(habit.id, item.id, { link })),
    make: (kind) => askItemNote(ctx, habit.id, item.title, kind, (r) => enqueue(`New ${kind}`, () => ctx.mutations.createItemNote(habit.id, item.id, { ...r, kind }))),
  });
  const moveTo = (item: HabitItem, group: string | null): void => enqueue('Sub-habit group', () => ctx.mutations.setHabitItem(habit.id, item.id, { group }));
  const newGroup = (then?: (name: string) => void): void => askText(ctx, {
    title: 'New group', label: 'Name', placeholder: 'C major, Fingerpicking, Morning warm-up…', cta: 'Add',
    hint: 'A group sorts sub-habits: a key, a scale, a technique, a part of the day.',
    onDone: (name) => { if (name) enqueue('Group', async () => { const g = await ctx.mutations.addItemGroup(habit.id, name); then?.(g); }); },
  });
  const moveMenu = (hb: Habit, item: HabitItem, ev: MouseEvent): void => {
    ev.preventDefault(); ev.stopPropagation();
    const menu = new Menu();
    menu.addItem((i) => i.setTitle(`Move “${item.title}” to`).setDisabled(true));
    for (const g of hb.itemGroups ?? []) menu.addItem((i) => i.setTitle(g).setIcon(item.group === g ? 'check' : 'folder').onClick(() => { if (item.group !== g) moveTo(item, g); }));
    if (item.group) menu.addItem((i) => i.setTitle('No group').setIcon('folder-minus').onClick(() => moveTo(item, null)));
    menu.addItem((i) => i.setTitle('New group…').setIcon('folder-plus').onClick(() => newGroup((g) => void ctx.mutations.setHabitItem(habit.id, item.id, { group: g }))));
    menu.showAtMouseEvent(ev);
  };
  const groupMenu = (hb: Habit, g: string, ev: MouseEvent): void => {
    ev.preventDefault(); ev.stopPropagation();
    const groups = hb.itemGroups ?? [];
    const at = groups.indexOf(g);
    const swap = (to: number): void => { const order = [...groups]; [order[at], order[to]] = [order[to]!, order[at]!]; enqueue('Group', () => ctx.mutations.orderItemGroups(habit.id, order)); };
    const menu = new Menu();
    menu.addItem((i) => i.setTitle('Rename…').setIcon('pencil').onClick(() => askText(ctx, { title: 'Rename group', label: 'Name', value: g, onDone: (to) => { if (to && to !== g) enqueue('Group', () => ctx.mutations.renameItemGroup(habit.id, g, to)); } })));
    if (at > 0) menu.addItem((i) => i.setTitle('Move up').setIcon('arrow-up').onClick(() => swap(at - 1)));
    if (at < groups.length - 1) menu.addItem((i) => i.setTitle('Move down').setIcon('arrow-down').onClick(() => swap(at + 1)));
    menu.addItem((i) => i.setTitle('Remove group (its songs stay)').setIcon('trash').onClick(() => enqueue('Group', () => ctx.mutations.removeItemGroup(habit.id, g))));
    menu.showAtMouseEvent(ev);
  };

  const draw = (): void => {
    const hb = freshHabit(ctx, habit);
    const stats = habitItemStats(hb, ctx.index.snapshot.itemCompletions, ctx.today());
    const active = stats.filter((s) => !s.item.retired);
    const plan = planned ?? new Set(planOf(hb));
    const doneN = active.filter((s) => dayCountOf(hb, s.item.id) > 0).length;
    const need = hb.itemsPerDay === 0 ? active.length : Math.min(hb.itemsPerDay ?? 1, active.length);
    const dayWord = date === ctx.today() ? 'today' : 'that day';
    // Sessions to pick from: the habit's parts, or for a once-a-day habit every part of the day, and its
    // line in the Habits list when songs sit there.
    const listHas = !parted && ctx.index.snapshot.itemCompletions.some((c) => c.habitId === hb.id && c.date === date && c.part === undefined);
    const choices: Where[] = parted ? [...(hb.parts ?? [])] : [...(listHas || part === null ? [null] : []), ...HABIT_PARTS];
    const pick = (p: Where): void => { if (pending > 0) return; part = p; draw(); };
    const groupHead = (g: string | undefined, n: number, withMenu: boolean): HTMLElement | null =>
      g === undefined && !(hb.itemGroups ?? []).length ? null
        : h('div', { cls: 'helm-itemlog-group' },
          icon(g === undefined ? 'folder-open' : 'folder'),
          h('span', { cls: 'helm-itemlog-group-name', text: g ?? 'Not in a group' }),
          h('span', { cls: 'helm-itemlog-group-count', text: String(n) }),
          withMenu && g !== undefined ? h('button', { cls: 'helm-itemlog-group-menu clickable-icon', title: 'Rename, reorder or remove this group', attr: { 'aria-label': `Group ${g}` }, onClick: (ev) => groupMenu(hb, g, ev) }, icon('more-horizontal')) : null);

    const practiceRow = (st: HabitItemStats): HTMLElement => {
      const n = countOf(hb, st.item.id);
      return h('div', { cls: ['helm-itemlog-row', n > 0 && 'is-done', plan.has(st.item.id) && 'is-planned'] },
        h('button', { cls: 'helm-itemlog-name', title: n > 0 ? 'Click to take the log off' : 'Click to log it', onClick: () => change(st.item, n > 0 ? 0 : 1) },
          icon(n > 0 ? 'check-circle-2' : 'circle'),
          h('span', { cls: 'helm-itemlog-title' }, h('span', { text: st.item.title })),
          h('span', { cls: 'helm-itemlog-sub', text: `${since(st)} · ${st.count30}× in 30 days` })),
        itemLinkButton(ctx, hb, st.item, () => m.close()),
        h('div', { cls: 'helm-itemlog-stepper' },
          h('button', { cls: 'helm-itemlog-step', title: n > 1 ? 'One round less' : 'Take the log off', attr: { 'aria-label': `One less ${st.item.title}`, ...(n === 0 ? { disabled: 'true' } : {}) }, onClick: () => change(st.item, n - 1) }, icon('minus')),
          h('span', { cls: 'helm-itemlog-count', text: String(n) }),
          h('button', { cls: 'helm-itemlog-step', title: n > 0 ? 'One round more' : 'Log it', attr: { 'aria-label': `One more ${st.item.title}` }, onClick: () => change(st.item, n + 1) }, icon('plus'))));
    };
    const planRow = (st: HabitItemStats): HTMLElement => {
      const on = plan.has(st.item.id);
      return h('div', { cls: ['helm-itemlog-row', 'helm-itemlog-planrow', on && 'is-planned'] },
        h('button', { cls: 'helm-itemlog-name', title: on ? 'Take it off the plan' : 'Put it on the plan', attr: { 'aria-pressed': String(on) }, onClick: () => togglePlan(hb, st.item) },
          icon(on ? 'check-square' : 'square'),
          h('span', { cls: 'helm-itemlog-title' }, h('span', { text: st.item.title })),
          h('span', { cls: 'helm-itemlog-sub', text: `${since(st)} · ${st.count30}× in 30 days` })),
        h('button', { cls: ['helm-itemlog-setlink', 'clickable-icon', !!st.item.link && 'is-linked'], title: st.item.link ? `Linked to ${itemLinkLabel(st.item.link)}: open, change or remove` : 'Link it to a note, a drawing or a web page', attr: { 'aria-label': `Link ${st.item.title}` }, onClick: (ev) => linkMenu(hb, st.item, ev) }, icon(st.item.link ? itemLinkIcon(st.item.link) : 'link')),
        h('button', { cls: 'helm-itemlog-move clickable-icon', title: st.item.group ? `In ${st.item.group}: move to another group` : 'Put it in a group', attr: { 'aria-label': `Move ${st.item.title}` }, onClick: (ev) => moveMenu(hb, st.item, ev) }, icon('folder-input')));
    };
    const byGroup = (rows: HabitItemStats[], row: (st: HabitItemStats) => HTMLElement, withMenu: boolean): HTMLElement[] =>
      grouped(hb, rows).flatMap(({ group, rows: rs }) => [groupHead(group, rs.length, withMenu), ...rs.map(row)].filter((x): x is HTMLElement => x !== null));

    const head = h('div', { cls: ['helm-itemlog-head', doneN >= need && 'is-met'] },
      h('span', { text: `${doneN} of ${active.length} ${dayWord}` }),
      h('span', { cls: 'helm-hint', text: doneN >= need ? `· ${hb.title} is done for the day` : `· ${need} make the day` }),
      h('span', { cls: 'helm-spacer' }),
      h('div', { cls: 'helm-segmented helm-itemlog-mode' },
        h('button', { cls: ['helm-seg', mode === 'practice' && 'is-active'], text: 'Practice', onClick: () => { mode = 'practice'; draw(); } }),
        h('button', { cls: ['helm-seg', mode === 'plan' && 'is-active'], text: plan.size ? `Plan · ${plan.size}` : 'Plan', onClick: () => { mode = 'plan'; draw(); } })));

    const body: (HTMLElement | null)[] = [];
    if (mode === 'plan') {
      body.push(
        h('p', { cls: 'helm-hint helm-itemlog-hint', text: `Tick what you'll practise ${dayWord}. The link button ties a song to its note or a web page; the folder button moves it to another group.` }),
        h('div', { cls: 'helm-itemlog-list' }, ...byGroup(active, planRow, true),
          h('button', { cls: 'helm-btn helm-btn-quiet helm-itemlog-newgroup', onClick: () => newGroup() }, icon('folder-plus'), h('span', { text: 'New group…' }))),
        h('div', { cls: 'helm-modal-buttons' },
          plan.size ? h('button', { cls: 'helm-btn helm-btn-quiet', text: 'Clear plan', onClick: clearPlan }) : null,
          h('span', { cls: 'helm-spacer' }),
          h('button', { cls: 'helm-btn mod-cta', text: plan.size ? `Start practising (${plan.size})` : 'Back to practice', onClick: () => { mode = 'practice'; showRest = false; draw(); } })));
    } else {
      const top = active.filter((s) => plan.has(s.item.id) || countOf(hb, s.item.id) > 0);
      const rest = active.filter((s) => !top.includes(s));
      body.push(choices.length > 1 ? h('div', { cls: 'helm-segmented', attr: { 'aria-label': 'Session' } }, ...choices.map((p) => {
        const n = active.filter((s) => noted(hb, s.item.id, { at: p }) > 0).length;
        return h('button', { cls: ['helm-seg', part === p && 'is-active'], title: n ? `${n} logged in this session` : 'Nothing logged in this session', text: (p === null ? 'Habits list' : p.charAt(0).toUpperCase() + p.slice(1)) + (n && part !== p ? ` · ${n}` : ''), onClick: () => pick(p) });
      })) : null);
      if (plan.size > 0) {
        body.push(h('div', { cls: 'helm-itemlog-list' },
          h('div', { cls: 'helm-itemlog-group is-plan' }, icon('list-checks'), h('span', { cls: 'helm-itemlog-group-name', text: `${dayWord === 'today' ? "Today's" : "That day's"} plan` }), h('span', { cls: 'helm-itemlog-group-count', text: `${active.filter((s) => plan.has(s.item.id) && dayCountOf(hb, s.item.id) > 0).length} of ${plan.size} done` })),
          ...top.map(practiceRow),
          rest.length ? h('button', { cls: 'helm-btn helm-btn-quiet helm-itemlog-rest', attr: { 'aria-expanded': String(showRest) }, onClick: () => { showRest = !showRest; draw(); } }, icon(showRest ? 'chevron-down' : 'chevron-right'), h('span', { text: `Everything else (${rest.length})` })) : null,
          ...(showRest ? byGroup(rest, practiceRow, false) : [])));
      } else {
        body.push(
          h('button', { cls: 'helm-itemlog-plancta', onClick: () => { mode = 'plan'; draw(); } }, icon('list-checks'), h('span', { text: `Plan ${dayWord}: pick what you'll practise` })),
          h('div', { cls: 'helm-itemlog-list' }, ...byGroup(active, practiceRow, false)));
      }
      body.push(active.length === 0 ? h('p', { cls: 'helm-hint', text: 'No sub-habits yet.' }) : null,
        h('div', { cls: 'helm-modal-buttons' },
          h('button', { cls: 'helm-btn helm-btn-quiet', text: 'Edit sub-habits…', onClick: () => { m.close(); void import('./modals/habitForm').then((mod) => mod.openHabitForm(ctx, freshHabit(ctx, habit))); } }),
          h('span', { cls: 'helm-spacer' }),
          h('button', { cls: 'helm-btn mod-cta', text: 'Done', onClick: () => m.close() })));
    }
    root.replaceChildren(...[head, ...body].filter((x): x is HTMLElement => x !== null));
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
 * The Today tile's one-line summary of a habit's sub-habits: how many were practised today, or with a
 * plan for the day how many of the planned ones (“1/3”). One small pill, the same size as the tile's other chips, so a
 * habit with ten songs is no taller than one without; a click opens the list to log one.
 */
export function itemSummary(ctx: UiContext, hb: Habit, date: IsoDate): HTMLElement | null {
  const active = (hb.items ?? []).filter((i) => !i.retired);
  if (active.length === 0) return null;
  const today = itemsOn(ctx, hb, date);
  const done = active.filter((i) => today.get(i.id)?.state === 'done');
  const need = hb.itemsPerDay === 0 ? active.length : Math.min(hb.itemsPerDay ?? 1, active.length);
  const plan = hb.itemPlan?.date === date ? active.filter((i) => hb.itemPlan!.items.includes(i.id)) : [];
  const planDone = plan.filter((i) => today.get(i.id)?.state === 'done').length;
  const lines = done.map((i) => `✓ ${i.title}${today.get(i.id)!.count > 1 ? ` ×${today.get(i.id)!.count}` : ''}`);
  const title = [
    done.length ? `${done.length} practised (${need} make the day):` : '', lines.length ? lines.join('\n') : 'Nothing practised yet',
    plan.length ? `Plan: ${planDone} of ${plan.length} done\n${plan.map((i) => `${today.get(i.id)?.state === 'done' ? '✓' : '○'} ${i.title}`).join('\n')}` : '',
    'Click to log practice',
  ].filter(Boolean).join('\n');
  return h('button', {
    cls: ['helm-habit-tile-moved', 'helm-subhabit-summary', done.length >= need && 'is-met', plan.length > 0 && 'is-planned'],
    title,
    onClick: (ev) => { ev.stopPropagation(); openItemLog(ctx, hb, date); },
  }, icon(plan.length ? 'list-checks' : 'music'), h('span', { text: plan.length ? `${planDone}/${plan.length}` : String(done.length) }));
}

/** The sub-habit chips for a habit on a day, every active one (the Habits card). Null for a habit without any. */
export function itemChips(ctx: UiContext, hb: Habit, date: IsoDate): HTMLElement | null {
  const active = (hb.items ?? []).filter((i) => !i.retired);
  if (active.length === 0) return null;
  const today = itemsOn(ctx, hb, date);
  const stats = habitItemStats(hb, ctx.index.snapshot.itemCompletions, ctx.today());
  const statOf = new Map(stats.map((s) => [s.item.id, s]));
  const plan = new Set(hb.itemPlan?.date === date ? hb.itemPlan.items : []);
  const chip = (item: HabitItem): HTMLElement => {
    const now = today.get(item.id);
    const st = statOf.get(item.id)!;
    const isPlanned = plan.has(item.id) && now?.state !== 'done';
    return h('button', {
      cls: ['helm-subhabit', now && `is-${now.state}`, isPlanned && 'is-planned'],
      title: `${item.title}${item.group ? ` (${item.group})` : ''}${item.link ? ` → ${itemLinkLabel(item.link)}` : ''} — ${since(st)} · ${st.count30}× in 30 days · ${st.total}× in all${isPlanned ? ' · on the plan' : ''}\nClick: log it / take the log off · right-click: more · rounds: Log practice`,
      onClick: (ev) => {
        ev.stopPropagation();
        // Off: from the line it is on. On: the part it is now (a once-a-day habit's session, picked by Helm).
        const part = hb.parts?.length ? partFor(ctx, hb, date, now?.part) : undefined;
        set(ctx, hb, item, date, now?.state === 'done' ? 'missed' : 'done', part, now?.state === 'done' ? undefined : 1);
      },
      onContextMenu: (ev) => itemMenu(ctx, hb, item, date, ev),
    },
      now?.state === 'done' ? icon('check') : now?.state === 'skipped' ? icon('minus') : isPlanned ? icon('circle-dot') : null,
      h('span', { cls: 'helm-subhabit-name', text: item.title }),
      now?.state === 'done' && now.count > 1 ? h('span', { cls: 'helm-subhabit-count', text: `×${now.count}` }) : null);
  };
  return h('div', { cls: 'helm-subhabits', onClick: (ev) => ev.stopPropagation() }, ...active.map(chip),
    h('button', { cls: 'helm-subhabit helm-subhabit-more', title: 'Log practice: rounds per song', onClick: (ev) => { ev.stopPropagation(); openItemLog(ctx, hb, date); } }, icon('list-plus'), h('span', { text: 'Log practice…' })));
}
