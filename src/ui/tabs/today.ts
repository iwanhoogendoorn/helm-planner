/** The cockpit: one day, split into parts, and the two rituals around it. */
import type { Habit, HabitPart, HelmSettings, IsoDate, Task } from '../../core/types';
import { addDays, humanDate, minutesToHuman } from '../../core/dates';
import { candidates, dayPlan, DAY_PARTS, type Candidate, type DayItem, type DayPart } from '../../data/planner';
import { habitDue, habitStats } from '../../data/habits';
import { PART_LABEL } from '../../core/dailyNote';
import { button, chip, empty, h, icon, iconButton, progressBar, section } from '../dom';
import type { UiContext } from '../context';
import { taskRow } from '../taskRow';
import { openPlanDay } from '../modals/planDay';
import { openWrapUp } from '../modals/wrapUp';
import { openCapture } from '../modals/capture';
import { openHabitForm } from '../modals/habitForm';
import { crumbBar, dateCrumbs } from '../crumbs';
import { daybookSection } from '../daybook';
import { habitBadge } from '../fields';
import { dayPartOf } from '../../data/habits';
import { plainLabel, shortLabel } from '../../core/label';
import { partWindow, preferredSlot } from '../../data/conflicts';
import { habitMenu } from '../habits';
import { habitCard, colourise } from '../habitCard';
import { drawingsButton, targetForDate } from '../drawings';
import { notesButton } from '../notes';
import { dragKeys, selection } from '../selection';

export interface TodayState { date: IsoDate; collapsed: Map<string, boolean> }

const PART_ICON: Record<DayPart, string> = { morning: 'sunrise', afternoon: 'sun', evening: 'moon', anytime: 'clock' };

export function renderToday(ctx: UiContext, root: HTMLElement, state: TodayState): void {
  const today = ctx.today();
  let habitChipsFor: (part: HabitPart) => HTMLElement | null = () => null;
  const settings = ctx.settings();
  const snap = ctx.index.snapshot;
  const date = state.date;
  const plan = dayPlan(snap, date, settings);
  const isToday = date === today;
  const isPast = date < today;
  const note = snap.dailyNotes.get(date);

  const cap = settings.dailyCapacityMinutes;
  root.appendChild(crumbBar(ctx, 'today', dateCrumbs(ctx, date, 'day', { day: true }), { homeClick: () => ctx.navigate('today', { date: today }), homeTitle: 'Jump to today' }));
  root.append(h('div', { cls: 'helm-day-head' },
    h('div', { cls: 'helm-day-nav' },
      iconButton('chevron-left', 'Previous day', () => ctx.navigate('today', { date: addDays(date, -1) })),
      h('button', { cls: ['helm-day-title', isToday && 'is-today'], onClick: () => ctx.navigate('today', { date: today }), title: isToday ? date : 'Jump to today' },
        h('span', { cls: 'helm-day-title-main', text: humanDate(date, today) }),
        h('span', { cls: 'helm-day-title-sub', text: humanDate(date, undefined, { year: true }) }),
      ),
      iconButton('chevron-right', 'Next day', () => ctx.navigate('today', { date: addDays(date, 1) })),
    ),
    h('div', { cls: 'helm-day-actions' },
      button('Plan day', { icon: 'list-plus', primary: !isPast && plan.openCount === 0, onClick: () => openPlanDay(ctx, date) }),
      button('Wrap up', { icon: 'moon', onClick: () => openWrapUp(ctx, date) }),
      button('', { icon: 'plus', title: 'Capture into this day', onClick: () => openCapture(ctx, { date }) }),
      notesButton(ctx, targetForDate(date)),
      drawingsButton(ctx, targetForDate(date)),
      button('', { icon: 'file-text', title: note ? 'Open daily note' : 'Create and open daily note', onClick: () => void ctx.run('Open note', async () => { const p = await ctx.mutations.ensureDailyNote(date); await ctx.openFile(p); }) }),
    ),
  ), h('div', { cls: 'helm-capacity' },
    h('div', { cls: 'helm-capacity-label' },
      h('span', { text: `${plan.openCount} open · ${plan.doneCount} done` }),
      h('span', { cls: 'helm-spacer' }),
      h('span', { cls: 'helm-hint', text: `${minutesToHuman(plan.plannedMinutes)} planned / ${minutesToHuman(cap)}` }),
    ),
    progressBar(plan.plannedMinutes / cap, plan.plannedMinutes > cap ? 'is-over' : ''),
  ));
  if (note?.regionBroken) root.appendChild(h('div', { cls: 'helm-banner is-error' }, icon('alert-triangle'), h('span', { text: 'The Helm region in this daily note has no end marker. Fix the note before Helm writes to it.' }), button('Open', { onClick: () => void ctx.openFile(note.path) })));

  const store = state.collapsed;

  // Needs attention: work that is late, overdue or simply carried over. It follows you onto every day
  // you open until you deal with it — planning it onto a day from today onwards, or finishing it.
  if (!isPast) {
    const cands = candidates(snap, date, settings, today).filter((c) => c.reason === 'overdue' || c.reason === 'scheduled-past');
    if (cands.length > 0) {
      root.appendChild(section('Needs attention', { count: cands.length, store, key: 'attention', cls: 'is-attention', actions: [button('Plan day', { icon: 'list-plus', onClick: () => openPlanDay(ctx, date) })] },
        ...cands.slice(0, 12).map((c) => taskRow(ctx, c.task, { reason: reasonLabel(c), draggable: true, quickAction: { icon: 'arrow-down-to-line', title: `Pull onto ${humanDate(date, today)}`, onClick: (t) => void ctx.run('Schedule', () => ctx.mutations.schedule(t.key, date)) } })),
        cands.length > 12 ? h('div', { cls: 'helm-hint', text: `… and ${cands.length - 12} more in Plan day.` }) : null,
      ));
    }
  }

  // Habits.
  const habits = ctx.index.allHabits().filter((hb) => habitDue(hb, date) || snap.completions.some((c) => c.habitId === hb.id && c.date === date));
  if (habits.length > 0 || ctx.index.allHabits().length === 0) {
    /** A chip for one occurrence of a habit (day-level, or one part of the day). */
    const habitChip = (hb: Habit, part?: HabitPart): HTMLElement => {
      const done = snap.completions.find((c) => c.habitId === hb.id && c.date === date && c.part === part);
      const st = habitStats(hb, snap.completions, today, settings.weekStartsOn, 14);
      const hstate = done?.state ?? 'pending';
      return h('button', {
        cls: ['helm-habit', `is-${hstate}`],
        title: `${hb.title}${part ? ` (${part})` : ''}: streak ${st.streak} · ${Math.round(st.rate30 * 100)}% last 30 days. Click to toggle, shift-click to skip, right-click to edit or delete.`,
        onClick: (ev) => { const next = ev.shiftKey ? (hstate === 'skipped' ? 'missed' : 'skipped') : hstate === 'done' ? 'missed' : 'done'; void ctx.run('Habit', () => ctx.mutations.setHabitState(hb.id, date, next, part)); },
        onContextMenu: (ev) => habitMenu(ctx, hb, ev, { date, ...(part ? { part } : {}), state: hstate }),
      }, icon(hstate === 'done' ? 'check' : hstate === 'skipped' ? 'minus' : 'circle'), habitBadge(ctx, hb), h('span', { text: hb.title }), st.streak > 1 ? h('span', { cls: 'helm-streak', text: `🔥${st.streak}` }) : null);
    };
    const parted = habits.filter((hb) => hb.parts && hb.parts.length > 0);
    const occurrences = habits.reduce((n, hb) => n + (hb.parts?.length || 1), 0);
    const doneOcc = habits.reduce((n, hb) => n + (hb.parts?.length ? snap.completions.filter((c) => c.date === date && c.state === 'done' && c.habitId === hb.id && c.part !== undefined && hb.parts!.includes(c.part)).length : snap.completions.some((c) => c.date === date && c.state === 'done' && c.habitId === hb.id) ? 1 : 0), 0);
    const board = h('div', { cls: 'helm-habit-board' }, ...habits.map((hb) => habitCard(ctx, hb, date)));
    habitChipsFor = (part) => { const list = [...parted.filter((hb) => hb.parts!.includes(part)), ...habits.filter((hb) => dayPartOf(hb, snap.completions, date) === part)]; return list.length === 0 ? null : h('div', { cls: 'helm-habit-chips helm-part-habits' }, ...list.map((hb) => colourise(habitChip(hb, part), hb))); };
    root.appendChild(section('Habits', { count: `${doneOcc}/${occurrences}`, store, key: 'habits', actions: [button('New habit', { icon: 'plus', cls: 'helm-btn-quiet', onClick: () => openHabitForm(ctx) })] },
      habits.length === 0 ? empty('No habits yet.', button('Create one', { onClick: () => openHabitForm(ctx) })) : board));
  }

  // The day, by part. Each part is a drop zone.
  const openItems = plan.items.filter((it) => it.display.status !== 'done' && it.display.status !== 'cancelled');
  if (openItems.length === 0 && !isPast) {
    root.appendChild(empty('Nothing planned yet.', button('Plan this day', { primary: true, icon: 'list-plus', onClick: () => openPlanDay(ctx, date) })));
  }
  const spillsInto = spillovers(plan, settings);
  for (const part of DAY_PARTS) {
    const items = plan.byPart[part].filter((it) => it.display.status !== 'done' && it.display.status !== 'cancelled');
    // Work that starts earlier but is still running when this part begins: dinner at 17:00–19:30 eats
    // into the evening, so the evening has to say so rather than read as a free night.
    const spills = spillsInto[part] ?? [];
    // Finished tasks stay in their part as ghosts, so a part you worked through does not read as an empty morning.
    const doneItems = plan.byPart[part].filter((it) => it.display.status === 'done' || it.display.status === 'cancelled');
    // Subtasks that got done still sit under their parent; they also show here, so the day's record is complete.
    const doneSubtasks = plan.byPart[part].flatMap((it) => it.display.childKeys.map((k) => snap.tasks.get(k)).filter((c): c is Task => c !== undefined && (c.status === 'done' || c.status === 'cancelled')).map((c) => ({ child: c, parent: it.display })));
    const partHabits = part !== 'anytime' ? habitChipsFor(part) : null;
    // A past day is a record: parts with nothing in them are left out. A day still ahead is a plan, so
    // every part stands there ready to be dropped into, even when the whole day is empty.
    if (items.length === 0 && doneItems.length === 0 && doneSubtasks.length === 0 && spills.length === 0 && !partHabits && isPast) continue;
    const minutes = items.reduce((s, it) => s + (it.display.effortMinutes ?? settings.defaultEffortMinutes), 0);
    const sec = section(PART_LABEL[part], {
      count: items.length, store, key: `part:${part}`, cls: `part-${part}`,
      actions: [
        doneItems.length + doneSubtasks.length > 0 ? chip(`${doneItems.length + doneSubtasks.length} done`, 'done', `${doneItems.length + doneSubtasks.length} finished in the ${PART_LABEL[part].toLowerCase()}`) : null,
        spills.length > 0 ? chip(`${spills.length} running in`, 'spill', `${spills.length} task(s) started earlier and are still running when the ${PART_LABEL[part].toLowerCase()} begins`) : null,
        minutes > 0 ? chip(minutesToHuman(minutes), 'effort') : null,
        iconButton('plus', `Add a task to the ${PART_LABEL[part].toLowerCase()}`, () => openCapture(ctx, { date, part: part === 'anytime' ? undefined : part })),
      ],
    }, partHabits, ...spills.map((sp) => spillRow(ctx, sp)), ...items.map((it) => itemRow(ctx, it)),
      ...doneItems.map((it) => { const row = taskRow(ctx, it.display, { showDate: 'none' }); row.classList.add('helm-ghost'); return row; }),
      ...doneSubtasks.map(({ child, parent }) => subtaskGhost(ctx, child, parent)),
      items.length === 0 && doneItems.length === 0 && doneSubtasks.length === 0 && spills.length === 0 ? h('div', { cls: 'helm-dropzone-hint', text: `drop a task here for the ${PART_LABEL[part].toLowerCase()}` }) : null);
    sec.querySelector('.helm-section-head')?.prepend(icon(PART_ICON[part], 'helm-part-icon'));
    makeDropZone(ctx, sec, date, part);
    root.appendChild(sec);
  }
  // The day's diary, under the plan: what happened, and a line to add the next thing. A past day that
  // holds none is left alone — there is nothing to read and nothing you are about to write.
  const diary = ctx.index.daybook(date);
  if (diary.length > 0 || !isPast) root.appendChild(daybookSection(ctx, date, store));

  if (plan.unmirrored.length > 0 && !isPast) root.appendChild(h('div', { cls: 'helm-hint' }, `${plan.unmirrored.length} planned project task(s) are not in the daily note yet. `, button('Write them', { onClick: () => void ctx.run('Sync', async () => { for (const t of plan.unmirrored) await ctx.mutations.schedule(t.key, date); }) })));

}

function itemRow(ctx: UiContext, it: DayItem): HTMLElement {
  const row = taskRow(ctx, it.display, { showDate: 'due', showChildren: true, draggable: it.kind !== 'timeblock', showProject: true });
  if (it.kind === 'mirror' || it.kind === 'unmirrored' || it.kind === 'elsewhere') {
    const el = row.classList.contains('helm-task') ? row : row.querySelector<HTMLElement>('.helm-task');
    el?.setAttribute('data-day-key', it.task.key);
  }
  return row;
}

/** Dropping a task on a part plans it for this day, in that part. */
function makeDropZone(ctx: UiContext, el: HTMLElement, date: IsoDate, part: DayPart): void {
  el.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-task') || (part !== 'anytime' && ev.dataTransfer?.types.includes('text/helm-habit'))) { ev.preventDefault(); el.classList.add('is-dropping'); } });
  el.addEventListener('dragleave', (ev) => { if (!el.contains(ev.relatedTarget as Node | null)) el.classList.remove('is-dropping'); });
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    el.classList.remove('is-dropping');
    const habitId = ev.dataTransfer?.getData('text/helm-habit');
    if (habitId && part !== 'anytime') { void ctx.run('Move habit', () => ctx.mutations.moveHabitForDay(habitId, date, part)); return; }
    const keys = dragKeys(ev);                                  // one row, or the whole selection
    if (keys.length === 0) return;
    // A subtask lives with its task. Dropping one on a part of the day it is already on used to pull it
    // out into a task of its own — easy to do by half an inch while reordering, and it then gets left
    // behind when its parent moves on. Say what to do instead; a drop on another day still takes it out.
    const strays = keys.map((k) => ctx.index.task(k)).filter((t) => t?.parentKey && (ctx.index.task(t.parentKey)?.noteDate === date || ctx.index.task(t.parentKey)?.scheduled === date));
    if (strays.length > 0 && strays.length === keys.length) {
      ctx.notify(`“${plainLabel(strays[0]!.text)}” belongs to ${plainLabel(ctx.index.task(strays[0]!.parentKey!)?.text ?? 'its task')}. Drop it on one of its siblings to reorder it, or on another day to take it out.`);
      return;
    }
    void ctx.run('Move', async () => {
      for (const key of keys) {
        const t = ctx.index.task(key);
        if (!t) continue;
        const onThisDay = t.noteDate === date || t.scheduled === date;
        await (onThisDay ? ctx.mutations.setPart(key, part) : ctx.mutations.schedule(key, date, part));
        // A timed task keeps its length but takes the first free slot in the part it landed in.
        const slot = t.time && part !== 'anytime' ? retimeFor(ctx, t, date, part) : undefined;
        if (slot) await ctx.mutations.updateTask(key, { time: slot });
      }
      selection.clear();
    });
  });
}

const toMin = (hhmm: string): number => { const [hh, mm] = hhmm.split(':').map(Number); return (hh ?? 0) * 60 + (mm ?? 0); };

interface Spill { item: DayItem; from: DayPart; start: string; end: string }

/**
 * A timed task belongs to the part it starts in, but time does not stop at the boundary: dinner from
 * 17:00 to 19:30 runs on into the evening. Every later part it overlaps gets a ghost of it, so the day
 * reads honestly — an evening with two and a half hours already spoken for is not an empty evening.
 */
function spillovers(plan: ReturnType<typeof dayPlan>, settings: HelmSettings): Partial<Record<DayPart, Spill[]>> {
  const out: Partial<Record<DayPart, Spill[]>> = {};
  for (const part of DAY_PARTS) {
    if (part === 'anytime') continue;
    for (const it of plan.byPart[part]) {
      const t = it.display;
      if (!t.time || t.status === 'done' || t.status === 'cancelled' || t.status === 'forwarded') continue;
      const start = toMin(t.time.start);
      const ended = t.time.end ? toMin(t.time.end) : undefined;
      const end = ended !== undefined && ended > start ? ended : start + (t.effortMinutes ?? settings.defaultEffortMinutes);
      for (const later of DAY_PARTS) {
        if (later === 'anytime' || later === part) continue;
        const w = partWindow(later, settings);
        if (toMin(w.from) < start || toMin(w.from) >= end) continue; // it has to be running when that part opens
        (out[later] ??= []).push({ item: it, from: part, start: t.time.start, end: t.time.end ?? '' });
      }
    }
  }
  return out;
}

/** The ghost of a task that is still running when this part begins; it names where it started. */
function spillRow(ctx: UiContext, sp: Spill): HTMLElement {
  const row = taskRow(ctx, sp.item.display, { showDate: 'none' });
  row.classList.add('helm-ghost', 'helm-spill');
  const main = row.querySelector('.helm-task-main') ?? row;
  const meta = main.querySelector('.helm-task-meta') ?? main.appendChild(h('div', { cls: 'helm-task-meta' }));
  const label = sp.end ? `runs on until ${sp.end}` : 'still running';
  meta.appendChild(h('span', { cls: 'helm-chip spill', title: `Started in the ${PART_LABEL[sp.from].toLowerCase()} at ${sp.start} — shown here because it is still running` }, icon('arrow-down-right'), h('span', { cls: 'helm-chip-label', text: `from the ${PART_LABEL[sp.from].toLowerCase()}, ${label}` })));
  return row;
}

/** A finished subtask listed among the day's done work: it names the task it belongs to, so it cannot read as the row above's child. */
function subtaskGhost(ctx: UiContext, child: Task, parent: Task): HTMLElement {
  const row = taskRow(ctx, child, { showDate: 'none' });
  row.classList.add('helm-ghost');
  const main = row.querySelector('.helm-task-main') ?? row;
  const meta = main.querySelector('.helm-task-meta') ?? main.appendChild(h('div', { cls: 'helm-task-meta' }));
  meta.appendChild(h('button', { cls: 'helm-chip subtask-of', title: `Subtask of “${plainLabel(parent.text)}” — click to open`, onClick: (ev) => { ev.stopPropagation(); void ctx.openFile(parent.path, parent.line); } }, icon('corner-down-right'), h('span', { cls: 'helm-chip-label', text: `part of ${shortLabel(parent.text, 40)}` })));
  return row;
}

/** Where a dragged, timed task should sit in its new part: the first free slot, keeping its length. */
function retimeFor(ctx: UiContext, t: Task, date: IsoDate, part: DayPart): { start: string; end?: string } | undefined {
  const s = ctx.settings();
  const toMin = (hhmm: string): number => { const [hh, mm] = hhmm.split(':').map(Number); return (hh ?? 0) * 60 + (mm ?? 0); };
  const toHhmm = (m: number): string => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  const length = t.time?.end ? Math.max(5, toMin(t.time.end) - toMin(t.time.start)) : (t.effortMinutes ?? s.defaultEffortMinutes);
  const notBefore = date === ctx.today() ? ctx.now() : undefined;
  const start = preferredSlot(ctx.index.snapshot, date, s, { part, effortMinutes: length, excludeKeys: [t.key, ...(t.id ? [t.id] : []), ...(t.mirrorOf ? [t.mirrorOf] : [])], ...(notBefore ? { notBefore } : {}) });
  if (t.time && t.time.start === start) return undefined;
  return { start, ...(t.time?.end ? { end: toHhmm(toMin(start) + length) } : {}) };
}

function reasonLabel(c: Candidate): string {
  switch (c.reason) {
    case 'overdue': return 'overdue';
    case 'scheduled-past': return 'carried over';
    case 'due-soon': return 'due soon';
    case 'in-progress': return 'in progress';
    case 'next-action': return 'next action';
    case 'inbox': return 'inbox';
    default: return c.reason;
  }
}

export type { Task };
