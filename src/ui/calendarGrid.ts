/**
 * The calendar proper: a day drawn as time, not as a list.
 *
 * A run of days — one, three, a week, a working week — with the hours down the side and every timed
 * task as a box where its time is. Everything you can see, you can act on: click a box to open the
 * task, click an empty slot to capture one at that time, drag a box (or a whole selection) onto
 * another day or hour to move it. A month, a quarter and a year are left to the list, which says
 * more about them than a grid of cells can.
 */
import type { HelmSettings, IsoDate, Task } from '../core/types';
import { MONTH_SHORT, WEEKDAY_SHORT, isoWeekday } from '../core/dates';
import { isOpen, type DayBucket } from '../data/planner';
import { gridHours, layOutDay, snapToSlot, toHhmm, toMinutes, toneOf, type DayLayout } from '../data/timegrid';
import { h } from './dom';
import type { UiContext } from './context';
import { openTaskEditor } from './modals/taskEditor';
import { openCapture } from './modals/capture';
import { taskMenu } from './menus';
import { plainLabel } from '../core/label';
import { dragKeys, selection, setDragKeys } from './selection';
import { onDayContext } from './dayMenu';

const PX_PER_HOUR = 56;

/** How far down the dragged box the pointer was when it was picked up, in pixels. */
let grabOffset = 0;

/** Everything that belongs on a day's grid: what is planned for it, plus what was finished on it. */
function tasksOn(bucket: DayBucket | undefined): Task[] {
  if (!bucket) return [];
  const seen = new Set<string>();
  const out: Task[] = [];
  for (const t of [...bucket.open, ...bucket.done]) {
    if (seen.has(t.key) || plainLabel(t.text).trim() === '') continue;   // an empty line is not an event
    seen.add(t.key);
    out.push(t);
  }
  return out;
}

/** Move whatever is being dragged onto this day, keeping its time when the drop is on the grid. */
function dropOnDay(ctx: UiContext, el: HTMLElement, date: IsoDate, timeAt?: (ev: DragEvent) => string | undefined): void {
  el.addEventListener('dragover', (ev) => { if (ev.dataTransfer?.types.includes('text/helm-task')) { ev.preventDefault(); el.classList.add('is-dropping'); } });
  el.addEventListener('dragleave', (ev) => { if (!el.contains(ev.relatedTarget as Node | null)) el.classList.remove('is-dropping'); });
  el.addEventListener('drop', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    el.classList.remove('is-dropping');
    const keys = dragKeys(ev);
    if (keys.length === 0) return;
    const at = timeAt?.(ev);
    void ctx.run('Move', async () => {
      for (const key of keys) {
        const t = ctx.index.task(key);
        if (!t) continue;
        await ctx.mutations.schedule(key, date);
        if (at) {
          const fresh = ctx.index.taskById(t.id ?? '') ?? ctx.index.task(key);
          const length = t.time?.end ? toMinutes(t.time.end) - toMinutes(t.time.start) : t.effortMinutes;
          if (fresh) await ctx.mutations.updateTask(fresh.key, { time: { start: at, ...(length ? { end: toHhmm(toMinutes(at) + length) } : {}) } });
        }
      }
      selection.clear();
    });
  });
}

/** One box on the grid, or one line in a month cell. */
function eventBox(ctx: UiContext, t: Task, opts: { compact?: boolean } = {}): HTMLElement {
  const box = h('div', {
    cls: ['helm-cal-event', `tone-${toneOf(t)}`, !isOpen(t) && 'is-done', selection.has(t.key) && 'is-selected', opts.compact && 'is-compact'],
    attr: { draggable: 'true', 'data-key': t.key },
    title: `${plainLabel(t.text)}${t.time ? ` · ${t.time.start}${t.time.end ? `–${t.time.end}` : ''}` : ''}`,
    onClick: (ev) => { ev.stopPropagation(); openTaskEditor(ctx, t); },
    onContextMenu: (ev) => { ev.preventDefault(); ev.stopPropagation(); taskMenu(ctx, t, ev); },
  },
    t.time ? h('span', { cls: 'helm-cal-event-time', text: t.time.start }) : null,
    h('span', { cls: 'helm-cal-event-title', text: plainLabel(t.text) }),
  );
  box.addEventListener('dragstart', (ev) => {
    ev.stopPropagation();
    setDragKeys(ev, t.key);
    // Remember where in the box it was grabbed, so it lands where it looks like it will.
    grabOffset = Math.max(0, (ev as DragEvent).clientY - box.getBoundingClientRect().top);
    box.classList.add('is-dragging');
  });
  box.addEventListener('dragend', () => { grabOffset = 0; box.classList.remove('is-dragging'); });
  return box;
}

/** A day, three days, a week: hours down the side, days across the top, boxes where the time is. */
export function renderTimeGrid(ctx: UiContext, root: HTMLElement, dates: IsoDate[], buckets: Map<IsoDate, DayBucket>, settings: HelmSettings): void {
  const today = ctx.today();
  const layouts: DayLayout[] = dates.map((d) => layOutDay(d, tasksOn(buckets.get(d)), settings));
  const { from, to } = gridHours(layouts, settings);
  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  const height = ((to - from) / 60) * PX_PER_HOUR;

  const head = h('div', { cls: 'helm-cal-head' }, h('div', { cls: 'helm-cal-gutter-head' }));
  const allDay = h('div', { cls: 'helm-cal-allday' }, h('div', { cls: 'helm-cal-gutter-head', text: 'ALL-DAY' }));
  const body = h('div', { cls: 'helm-cal-body' });
  const gutter = h('div', { cls: 'helm-cal-gutter', style: { height: `${height}px` } });
  for (const m of hours) gutter.appendChild(h('div', { cls: 'helm-cal-hour', style: { height: `${PX_PER_HOUR}px` } }, h('span', { text: toHhmm(m) })));
  body.appendChild(gutter);

  for (const layout of layouts) {
    const d = layout.date;
    const isToday = d === today;
    head.appendChild(onDayContext(h('div', { cls: ['helm-cal-day-head', isToday && 'is-today'], onClick: () => ctx.navigate('today', { date: d }) },
      h('span', { cls: 'helm-cal-dow', text: WEEKDAY_SHORT[isoWeekday(d) - 1] ?? '' }),
      h('span', { cls: 'helm-cal-dom', text: String(Number(d.slice(8, 10))) }),
      h('span', { cls: 'helm-cal-mon', text: MONTH_SHORT[Number(d.slice(5, 7)) - 1] ?? '' }),
    ), ctx, d));

    const cell = h('div', { cls: ['helm-cal-allday-cell', isToday && 'is-today'] }, ...layout.allDay.map((t) => eventBox(ctx, t, { compact: true })));
    dropOnDay(ctx, cell, d);
    allDay.appendChild(cell);

    const col = h('div', { cls: ['helm-cal-col', isToday && 'is-today'], style: { height: `${height}px` } });
    for (const m of hours.slice(0, -1)) {
      const slot = h('div', { cls: 'helm-cal-slot', style: { height: `${PX_PER_HOUR}px` }, title: `Add a task at ${toHhmm(m)}`, onClick: () => openCapture(ctx, { date: d, text: '' }) });
      col.appendChild(slot);
    }
    for (const e of layout.timed) {
      const box = eventBox(ctx, e.task);
      box.classList.add('is-placed');
      box.style.top = `${((e.start - from) / 60) * PX_PER_HOUR}px`;
      box.style.height = `${Math.max(18, ((e.end - e.start) / 60) * PX_PER_HOUR - 2)}px`;
      box.style.left = `calc(${(e.column / e.columns) * 100}% + 2px)`;
      box.style.width = `calc(${(1 / e.columns) * 100}% - 4px)`;
      col.appendChild(box);
    }
    if (isToday) {
      const now = toMinutes(ctx.now());
      if (now >= from && now <= to) col.appendChild(h('div', { cls: 'helm-cal-now', style: { top: `${((now - from) / 60) * PX_PER_HOUR}px` } }));
    }
    // Dropping on a column plans the task for that day at the hour it landed on.
    dropOnDay(ctx, col, d, (ev) => {
      const rect = col.getBoundingClientRect();
      const y = (ev as DragEvent).clientY - rect.top - grabOffset;   // the top of the box, not the pointer
      if (!Number.isFinite(y) || rect.height === 0) return undefined;
      return toHhmm(snapToSlot(y, from, to, { pxPerHour: PX_PER_HOUR }));
    });
    body.appendChild(col);
  }

  const grid = h('div', { cls: 'helm-cal-grid', attr: { 'data-days': String(dates.length) }, style: { '--cal-days': String(dates.length) } as never }, head, allDay, body);
  root.appendChild(grid);
}
