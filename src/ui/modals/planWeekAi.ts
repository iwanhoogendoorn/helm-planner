/**
 * “Fit the week”: propose, adjust, confirm — a week at a time.
 *
 * The same bargain as the day, one step wider. Helm asks Claude how long the week's work really takes
 * and which day each piece belongs on, keeps every day inside the capacity you set, and shows you the
 * whole week before anything is written. Move a task to another day, change its minutes, drop it out —
 * the week re-lays itself as you go, and the vault is only touched when you press Plan the week.
 */
import { Modal } from 'obsidian';
import type { IsoDate, Task } from '../../core/types';
import { humanDate, isoWeek, isoWeekday, minutesToHuman, WEEKDAY_SHORT } from '../../core/dates';
import type { PlanBlock } from '../../core/pomodoro';
import { proposeWeekPlan, weekProposalFrom, type WeekAnswer, type WeekPlanRequest, type WeekProposal } from '../../data/ai';
import { isOpen, weekView } from '../../data/planner';
import { button, chip, h, icon } from '../dom';
import type { UiContext } from '../context';
import { plainLabel, shortLabel } from '../../core/label';
import { focusOf } from './planDayAi';

/** The week Helm will ask about: today onwards, never a day that has already gone. */
export function requestForWeek(ctx: UiContext, anchor: IsoDate): { req: WeekPlanRequest; tasks: Map<string, Task> } {
  const s = ctx.settings();
  const today = ctx.today();
  const w = weekView(ctx.index.snapshot, anchor, s, today);
  const tasks = new Map<string, Task>();
  const days: WeekPlanRequest['days'] = [];
  for (const d of w.days) {
    if (d.date < today) continue;                                   // yesterday cannot be planned
    const busy: WeekPlanRequest['days'][number]['busy'] = [];
    for (const t of d.open) {
      if (!isOpen(t)) continue;
      if (t.time) { busy.push({ start: t.time.start, end: t.time.end ?? t.time.start, label: shortLabel(t.text, 30) }); continue; }
      if (!tasks.has(t.key)) tasks.set(t.key, t);
    }
    days.push({ date: d.date, from: s.dayStarts || '09:00', to: s.dayEnds || '18:00', busy });
  }
  // Due this week and sitting on no day at all: the week is exactly where it should be placed.
  for (const t of w.unscheduledDue) if (!tasks.has(t.key)) tasks.set(t.key, t);

  const dates = new Set(days.map((d) => d.date));
  const req: WeekPlanRequest = {
    days,
    tasks: [...tasks.values()].map((t) => {
      const on = t.noteDate ?? t.scheduled;
      return {
        key: t.key,
        text: plainLabel(t.text),
        ...(t.effortMinutes !== undefined ? { effortMinutes: t.effortMinutes } : {}),
        priority: t.priority,
        ...(t.due ? { due: t.due } : {}),
        ...(t.projectTitle ? { project: t.projectTitle } : {}),
        ...(on && dates.has(on) ? { date: on } : {}),
      };
    }),
    focus: focusOf(ctx),
    capacityMinutes: s.dailyCapacityMinutes,
  };
  return { req, tasks };
}

export function openPlanWeekAi(ctx: UiContext, anchor: IsoDate): void {
  const { req, tasks } = requestForWeek(ctx, anchor);
  const m = new Modal(ctx.app);
  const wk = isoWeek(req.days[0]?.date ?? anchor);
  m.titleEl.setText(`Plan week ${wk.week}`);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-planai', 'helm-planweek');

  if (req.days.length === 0 || req.tasks.length === 0) {
    root.appendChild(h('div', { cls: 'helm-hint', text: req.days.length === 0 ? 'This week has already been and gone. Move to a week that still has days left in it.' : 'Nothing without a time left in this week. Add some tasks first — Helm plans what is already there.' }));
    root.appendChild(h('div', { cls: 'helm-modal-buttons' }, button('Close', { primary: true, onClick: () => m.close() })));
    m.open();
    ctx.trackModal(m);
    return;
  }

  const body = h('div', { cls: 'helm-planai-body' }, h('div', { cls: 'helm-hint' }, icon('loader'), h('span', { text: 'Asking Claude how this week should fall…' })));
  root.append(body);
  m.open();
  ctx.trackModal(m);

  void proposeWeekPlan(req, ctx.runClaude).then((proposal) => draw(proposal));

  /** The plan as it stands: minutes per task, and the day each one sits on — `''` means another week. */
  let minutes: Record<string, number> = {};
  let dayOf: Record<string, string> = {};
  let order: string[] = [];

  const answerNow = (): WeekAnswer => {
    const days: Record<string, string[]> = Object.fromEntries(req.days.map((d) => [d.date, [] as string[]]));
    const defer: { key: string }[] = [];
    for (const key of order) {
      const date = dayOf[key];
      if (date && days[date]) days[date]!.push(key);
      else defer.push({ key });
    }
    return { days, minutes, defer };
  };

  const relayout = (p: WeekProposal): WeekProposal => weekProposalFrom(answerNow(), req, p.source, p.error);

  function draw(p: WeekProposal): void {
    if (order.length === 0) {
      minutes = { ...p.answer.minutes };
      for (const d of p.days) for (const key of p.answer.days[d.date] ?? []) { order.push(key); dayOf[key] = d.date; }
      for (const d of p.answer.defer ?? []) if (!order.includes(d.key)) { order.push(d.key); dayOf[d.key] = ''; }
      for (const t of req.tasks) if (!order.includes(t.key)) { order.push(t.key); dayOf[t.key] = ''; }
      for (const k of order) if (minutes[k] === undefined) minutes[k] = req.tasks.find((t) => t.key === k)?.effortMinutes ?? 30;
    }
    const laid = relayout(p);
    const capacity = req.capacityMinutes;

    const row = (key: string, blocks: PlanBlock[]): HTMLElement | null => {
      const task = tasks.get(key);
      if (!task) return null;
      const num = h('input', { cls: 'helm-planai-min', attr: { type: 'number', min: '5', step: '5', value: String(minutes[key] ?? 30) } });
      num.addEventListener('change', () => { minutes[key] = Math.max(5, Math.round(Number(num.value) || 30)); draw(p); });
      const pick = h('select', { cls: 'helm-planai-day' }) as HTMLSelectElement;
      for (const d of req.days) pick.appendChild(h('option', { attr: { value: d.date }, text: `${WEEKDAY_SHORT[isoWeekday(d.date) - 1] ?? ''} ${Number(d.date.slice(8, 10))}` }));
      pick.appendChild(h('option', { attr: { value: '' }, text: 'another week' }));
      pick.value = dayOf[key] ?? '';
      pick.addEventListener('change', () => { dayOf[key] = pick.value; draw(p); });
      const out = !dayOf[key];
      // Four columns, so a long task and a short one line up: what it is, how long, which day, when.
      const note = p.answer.notes?.[key];
      return h('div', { cls: ['helm-planai-row', out && 'is-out'], attr: { title: note ? `${plainLabel(task.text)} — ${note}` : plainLabel(task.text) } },
        h('span', { cls: 'helm-planai-text', text: plainLabel(task.text) }),
        h('span', { cls: 'helm-planai-mins' }, num, h('span', { cls: 'helm-hint', text: 'min' })),
        pick,
        h('span', { cls: 'helm-planai-times' },
          ...(out ? [chip('another week', 'warn')] : blocks.map((b) => chip(`${b.start}–${b.end}${b.of && b.of > 1 ? ` (${b.index}/${b.of})` : ''}`, 'time')))),
      );
    };

    const dayBlocks = h('div', { cls: 'helm-planweek-days' });
    for (const d of laid.days) {
      const keys = (laid.answer.days[d.date] ?? []);
      const over = d.laid.focusMinutes > capacity;
      dayBlocks.appendChild(h('div', { cls: 'helm-planweek-day' },
        h('div', { cls: 'helm-planweek-day-head' },
          h('span', { cls: 'helm-planweek-dow', text: humanDate(d.date, ctx.today()) }),
          chip(`${minutesToHuman(d.laid.focusMinutes)} of work`, over ? 'effort is-over' : 'effort', `Your day holds about ${minutesToHuman(capacity)}`),
          d.laid.breakMinutes > 0 ? chip(`${minutesToHuman(d.laid.breakMinutes)} of breaks`, 'count') : null,
          d.laid.overflow.length > 0 ? chip(`${d.laid.overflow.length} will not fit`, 'warn') : null,
        ),
        ...(keys.length === 0
          ? [h('div', { cls: 'helm-hint', text: 'Nothing planned.' })]
          : keys.map((k) => row(k, d.laid.blocks.filter((b) => b.taskKey === k && b.kind === 'focus'))).filter(Boolean) as HTMLElement[]),
      ));
    }
    const left = order.filter((k) => !dayOf[k]);
    if (left.length > 0) {
      dayBlocks.appendChild(h('div', { cls: 'helm-planweek-day is-out' },
        h('div', { cls: 'helm-planweek-day-head' }, h('span', { cls: 'helm-planweek-dow', text: 'Another week' })),
        ...left.map((k) => row(k, [])).filter(Boolean) as HTMLElement[],
      ));
    }

    const work = laid.days.reduce((s, d) => s + d.laid.focusMinutes, 0);
    body.replaceChildren(
      h('div', { cls: 'helm-planai-head' },
        chip(p.source === 'claude' ? 'Claude’s week' : 'Helm’s own spreading', p.source === 'claude' ? 'project' : 'note'),
        chip(`${minutesToHuman(work)} of work over ${laid.days.length} day${laid.days.length === 1 ? '' : 's'}`, 'effort'),
        left.length > 0 ? chip(`${left.length} for another week`, 'warn') : null,
        p.error ? h('span', { cls: 'helm-hint', text: `Claude could not be reached (${p.error}); this is Helm’s own spreading.` }) : null,
      ),
      dayBlocks,
      h('div', { cls: 'helm-hint', text: 'Move a task to another day, change its minutes, or push it to another week. Nothing is written until you say so.' }),
      h('div', { cls: 'helm-modal-buttons' },
        button('Cancel', { onClick: () => m.close() }),
        button('Plan the week', { primary: true, onClick: () => { const final = relayout(p); m.close(); void write(final); } }),
      ),
    );
  }

  /** Write the agreed days and times; what was pushed out of the week is simply left alone. */
  async function write(p: WeekProposal): Promise<void> {
    await ctx.run('Plan the week', async () => {
      let planned = 0;
      const failed: string[] = [];
      for (const d of p.days) {
        const first = new Map<string, PlanBlock>();
        const last = new Map<string, PlanBlock>();
        for (const b of d.laid.blocks) {
          if (b.kind !== 'focus') continue;
          if (!first.has(b.taskKey)) first.set(b.taskKey, b);
          last.set(b.taskKey, b);
        }
        for (const [key, start] of first) {
          const end = last.get(key)!;
          try {
            await ctx.mutations.planInto(key, d.date as IsoDate, { start: start.start, end: end.end }, minutes[key] ?? 30);
            planned++;
          } catch {
            failed.push(shortLabel(tasks.get(key)?.text ?? key, 30));
          }
        }
      }
      const rest = order.filter((k) => !dayOf[k]).length;
      ctx.notify(`Planned ${planned} task${planned === 1 ? '' : 's'} across the week${rest ? `, ${rest} left for another week` : ''}${failed.length ? `. Could not place: ${failed.join(', ')}` : '.'}`);
    });
  }
}
