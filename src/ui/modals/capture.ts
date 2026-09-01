/**
 * Quick capture: one line in, a task out. Live preview shows how the line is
 * understood and where it will land.
 */
import { Modal } from 'obsidian';
import type { IsoDate, Project, Recurrence, TaskLine } from '../../core/types';
import { addDays, humanDate, minutesToHuman, startOfWeek } from '../../core/dates';
import { parseCapture, REPEAT_PATTERN } from '../../core/nlp';
import { formatRecurrence } from '../../core/recurrence';
import { append, button, chip, h } from '../dom';
import type { UiContext } from '../context';
import { pickProject } from '../menus';
import { partOfTime } from '../../core/dailyNote';
import { conflictWarning, effortField, linkTimes, repeatButtons, wikilinkSuggest } from '../fields';
import { conflictsFor, describeConflicts, freeSlotOn, partWindow, preferredSlot } from '../../data/conflicts';

export interface CaptureDefaults {
  date?: IsoDate;
  part?: 'morning' | 'afternoon' | 'evening';
  projectId?: string;
  phaseId?: string;
  text?: string;
}

export function openCapture(ctx: UiContext, defaults: CaptureDefaults = {}): void {
  const today = ctx.today();
  const m = new Modal(ctx.app);
  m.titleEl.setText('Capture');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-capture');
  let project: Project | undefined = defaults.projectId ? ctx.index.project(defaults.projectId) : undefined;
  let phaseId = defaults.phaseId;
  let date: IsoDate | undefined = defaults.date;
  let explicitDate = defaults.date !== undefined;
  let part: 'morning' | 'afternoon' | 'evening' | undefined = defaults.part;
  let explicitPart = defaults.part !== undefined;
  const timeStart = h('input', { attr: { type: 'time' }, title: 'Start time' });
  const timeEnd = h('input', { attr: { type: 'time' }, title: 'End time' });
  const timeOf = (c: { time?: { start: string; end?: string } }): { start: string; end?: string } | undefined => timeStart.value ? { start: timeStart.value, ...(timeEnd.value ? { end: timeEnd.value } : {}) } : c.time;
  const effort = effortField();
  let grammarEffort: number | undefined;
  let timeTouched = false;
  let timeAuto = false;
  let programmatic = false;
  const poke = (el: HTMLInputElement): void => { programmatic = true; try { el.dispatchEvent(new Event('input')); } finally { programmatic = false; } };
  timeStart.addEventListener('input', () => { if (programmatic) return; timeTouched = true; timeAuto = false; });
  /** Put the block at `hhmm` (end follows from the effort) without it counting as the user typing. */
  const setStart = (hhmm: string, opts: { fillEnd?: boolean; auto?: boolean } = {}): void => {
    timeStart.value = hhmm;
    timeTouched = !opts.auto;              // a suggestion stays open to being replaced by what you type
    timeAuto = opts.auto ?? false;
    poke(timeStart);
    // A part of the day is a block of time, so give it an end too — after the poke, because moving the
    // start drags the whole block along with it and would carry any end we had just written.
    if (opts.fillEnd) {
      const mins = effort.get() ?? ctx.settings().defaultEffortMinutes;
      const [hh, mm] = hhmm.split(':').map(Number);
      const end = (hh ?? 0) * 60 + (mm ?? 0) + mins;
      timeEnd.value = end >= 24 * 60 ? '23:59' : `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
      poke(timeEnd);
    }
    render();
  };
  /** The first free slot in a part of the day — or its plain start time when the day is unknown. */
  const slotFor = (p: 'morning' | 'afternoon' | 'evening' | 'anytime'): string => {
    const s = ctx.settings();
    if (!date) return partWindow(p === 'anytime' ? undefined : p, s).from;
    const notBefore = date === today ? ctx.now() : undefined;
    return preferredSlot(ctx.index.snapshot, date, s, { ...(p === 'anytime' ? {} : { part: p }), effortMinutes: effort.get() ?? s.defaultEffortMinutes, ...(notBefore ? { notBefore } : {}) });
  };
  timeEnd.addEventListener('input', () => { if (programmatic) return; timeTouched = true; });
  linkTimes(timeStart, timeEnd, effort);
  effort.onChange(() => render());
  /** Today's capture starts at the current hour unless the user or the text says otherwise. */
  const applyDefaultTime = (grammarTime: { start: string } | undefined): void => {
    if (!ctx.settings().defaultCaptureTime || timeTouched || grammarTime) { if (timeAuto && (grammarTime || date !== today)) { timeStart.value = ''; timeEnd.value = ''; timeAuto = false; } return; }
    // A free slot, not simply the next hour: the point of a suggested time is that it is free. When a
    // part of the day is chosen — by the button, or by the + that opened this — the slot comes from it.
    if (date && !timeStart.value && (date === today || part)) { setStart(slotFor(part ?? 'anytime'), { fillEnd: true, auto: true }); }
    else if (date !== today && !part && timeAuto) { timeStart.value = ''; timeEnd.value = ''; timeAuto = false; }
  };

  const input = h('input', { cls: 'helm-input-wide helm-capture-input', attr: { type: 'text', placeholder: 'Call the plumber tomorrow !high #home @Kitchen ~30m', value: defaults.text ?? '' } });
  wikilinkSuggest(ctx, input);
  const preview = h('div', { cls: 'helm-capture-preview' });
  // Day row: quick picks and a date input, overriding anything the text says.
  const dayInput = h('input', { cls: 'helm-capture-date', attr: { type: 'date' }, title: 'Any day' });
  dayInput.addEventListener('change', () => { explicitDate = true; date = /^\d{4}-\d{2}-\d{2}$/.test(dayInput.value) ? dayInput.value : undefined; render(); });
  const dayRow = h('div', { cls: 'helm-capture-day' });
  const conflict = h('div', { cls: 'helm-conflict' });
  let conflictText: string | undefined;
  const drawDay = (): void => {
    const nextWeek = addDays(startOfWeek(today, ctx.settings().weekStartsOn), 7);
    const picks: [string, IsoDate | undefined, string][] = [['Today', today, today], ['Tomorrow', addDays(today, 1), addDays(today, 1)], ['+2', addDays(today, 2), addDays(today, 2)], ['Next week', nextWeek, nextWeek], ['Inbox', undefined, 'No day — the inbox, or the project only']];
    dayRow.replaceChildren(
      h('span', { cls: 'helm-hint', text: 'Day' }),
      h('span', { cls: 'helm-segmented' }, ...picks.map(([label, d, title]) => h('button', { cls: ['helm-seg', date === d && 'is-active'], text: label, title, onClick: () => { explicitDate = true; date = d; render(); } }))),
      dayInput,
      ...(date && ![today, addDays(today, 1), addDays(today, 2), nextWeek].includes(date) ? [chip(humanDate(date, today, { year: true }), 'scheduled')] : []),
    );
    dayInput.value = date ?? '';
  };
  // Quick tags: one click puts `#tag` in front of the text, another takes it out again.
  const tagRow = h('div', { cls: 'helm-capture-tags' });
  const quickTags = (): string[] => [...new Set((ctx.settings().captureTags ?? '').split(/[,\s]+/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean))];
  const hasTag = (tag: string): boolean => new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i').test(input.value);
  const toggleTag = (tag: string): void => {
    const re = new RegExp(`(^|\\s)#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'ig');
    input.value = hasTag(tag) ? input.value.replace(re, '$1').replace(/\s{2,}/g, ' ').trim() : `#${tag} ${input.value.replace(/^\s+/, '')}`;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  const drawTags = (): void => {
    const tags = quickTags();
    tagRow.style.display = tags.length ? '' : 'none';
    tagRow.replaceChildren(h('span', { cls: 'helm-hint', text: 'Tags' }), ...tags.map((t) => h('button', { cls: ['helm-tag-toggle', hasTag(t) && 'is-active'], text: `#${t}`, title: hasTag(t) ? `Remove #${t}` : `Add #${t}`, onClick: () => toggleTag(t) })));
  };
  // Quick repeats: the buttons write the same phrase you would type, so the line stays the one truth.
  const repeatRow = h('div', { cls: 'helm-capture-tags helm-capture-repeat' });
  /** Put this repeat on the line (or take the current one off), keeping everything else the user typed. */
  const setRepeat = (phrase: string | undefined): void => {
    const bare = ` ${input.value.trim()} `.replace(REPEAT_PATTERN, ' ').replace(/\s{2,}/g, ' ').trim();
    input.value = phrase ? `${bare} ${phrase}`.trim() : bare;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  };
  const drawRepeat = (rec: Recurrence | undefined): void => repeatButtons(repeatRow, rec, setRepeat);
  const dest = h('div', { cls: 'helm-capture-dest' });
  const help = h('div', { cls: 'helm-hint', text: 'Dates: today, tomorrow, fri, next week, in 3 days, 1/9, due friday · Part: morning, afternoon, evening, tonight · Priority: !, !!, !!! · Project: @Name · Effort: ~45m · Time: 14:00-15:00 · Repeat: every week' });

  let rendering = false;
  let renderAgain = false;
  const render = (): void => {
    // Setting a time programmatically fires `input`, which can call render again from inside this pass —
    // the chips would then be drawn twice and the last write would be the older one. One pass at a time.
    if (rendering) { renderAgain = true; return; }
    rendering = true;
    try { draw(); } finally { rendering = false; }
    if (renderAgain) { renderAgain = false; render(); }
  };

  const draw = (): void => {
    const c = parseCapture(input.value, today, ctx.settings().weekStartsOn);
    preview.replaceChildren();
    preview.appendChild(h('span', { cls: 'helm-capture-text', text: c.text || '…' }));
    if (c.priority !== 'normal') preview.appendChild(chip(c.priority, `prio prio-${c.priority}`));
    if (c.project && !project) { const p = ctx.index.projectByTitle(c.project); if (p) project = p; else preview.appendChild(chip(`@${c.project} (unknown project)`, 'warn')); }
    if (c.scheduled && !explicitDate) date = c.scheduled;
    if (c.part && !explicitPart) part = c.part;
    applyDefaultTime(c.time);
    const time = timeOf(c);
    const shownPart = part ?? (time ? partOfTime(time.start, ctx.settings()) : undefined);
    if (date) preview.appendChild(chip(`plan ${humanDate(date, today)}${shownPart ? ` · ${shownPart}${!part ? ' (by time)' : ''}` : ''}`, 'scheduled'));
    if (c.due) preview.appendChild(chip(`due ${humanDate(c.due, today)}`, 'due'));
    if (c.effortMinutes !== grammarEffort) { grammarEffort = c.effortMinutes; if (c.effortMinutes) { effort.set(c.effortMinutes); if (timeStart.value) poke(timeStart); } }
    const eff = effort.get();
    if (eff) preview.appendChild(chip(minutesToHuman(eff), 'effort'));
    if (time) preview.appendChild(chip(time.end ? `${time.start}–${time.end}` : time.start, 'time'));
    if (c.recurrence) preview.appendChild(chip(formatRecurrence(c.recurrence), 'recurrence'));
    for (const t of c.tags) preview.appendChild(chip(`#${t}`, 'tag'));
    drawDay();
    drawTags();
    drawRepeat(c.recurrence);
    conflictText = date && time ? (describeConflicts(conflictsFor(ctx.index.snapshot, date, time, ctx.settings(), { effortMinutes: effort.get() })) || undefined) : undefined;
    const free = conflictText && date ? freeSlotOn(ctx.index.snapshot, date, ctx.settings(), { ...(part ? { part } : {}), effortMinutes: effort.get() ?? ctx.settings().defaultEffortMinutes, notBefore: time?.start ?? (date === today ? ctx.now() : undefined) }) : undefined;
    conflictWarning(conflict, conflictText, free ? { time: free, onPick: () => setStart(free) } : undefined);
    dest.replaceChildren();
    const where = project ? `→ project “${project.title}”${phaseId ? ` › ${project.phases.find((p) => p.id === phaseId)?.title ?? ''}` : ''}${date ? ` (and today's plan)` : ''}` : date ? `→ daily note for ${humanDate(date, today)}` : `→ inbox (${ctx.settings().inboxNote})`;
    append(dest, [
      h('span', { cls: 'helm-capture-where', text: where }),
      h('span', { cls: 'helm-spacer' }),
      button(project ? 'Change project' : 'Project…', { icon: 'folder', onClick: () => pickProject(ctx, (p, ph) => { project = p; phaseId = ph; render(); }, { phases: true }) }),
      project ? button('', { icon: 'x', title: 'No project', onClick: () => { project = undefined; phaseId = undefined; render(); } }) : null,
      date ? h('span', { cls: 'helm-segmented' }, ...(['morning', 'afternoon', 'evening'] as const).map((p) => h('button', { cls: ['helm-seg', part === p && 'is-active'], text: p, onClick: () => { explicitPart = true; const on = part !== p; part = on ? p : undefined; if (on) { setStart(slotFor(p), { fillEnd: true }); return; } render(); } }))) : null,
      date ? h('span', { cls: 'helm-capture-time' }, timeStart, h('span', { cls: 'helm-hint', text: '–' }), timeEnd) : null,
      h('span', { cls: 'helm-capture-effort' }, h('span', { cls: 'helm-hint', text: 'effort' }), effort.el),
    ]);
  };
  input.addEventListener('input', render);
  timeStart.addEventListener('input', render);
  timeEnd.addEventListener('input', render);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); void submit(ev.shiftKey); }
  });

  async function submit(keepOpen: boolean): Promise<void> {
    const c = parseCapture(input.value, today, ctx.settings().weekStartsOn);
    if (c.text.trim() === '') return;
    if (conflictText && !window.confirm(`This overlaps ${conflictText}.\n\nAdd it anyway?`)) return;
    const fields: Partial<TaskLine> = { priority: c.priority };
    if (c.due) fields.due = c.due;
    const eff = effort.get() ?? c.effortMinutes;
    if (eff) { fields.effortMinutes = eff; fields.effortRaw = minutesToHuman(eff); }
    const time = timeOf(c);
    if (time) fields.time = time;
    if (c.recurrence) fields.recurrence = { ...c.recurrence, raw: formatRecurrence(c.recurrence) };
    const p = project ?? (c.project ? ctx.index.projectByTitle(c.project) : undefined);
    const d = date;
    const text = c.text;
    if (!keepOpen) m.close();
    const pt = part;
    await ctx.run('Capture', () => ctx.mutations.addTask({ text, fields, ...(p ? { projectId: p.id } : {}), ...(phaseId ? { phaseId } : {}), ...(d ? { date: d } : {}), ...(d && pt ? { part: pt } : {}) }));
    if (keepOpen) { input.value = ''; render(); input.focus(); }
  }

  root.append(input, preview, dayRow, tagRow, repeatRow, conflict, dest, help, h('div', { cls: 'helm-modal-buttons' },
    h('span', { cls: 'helm-hint', text: 'Enter to add · Shift+Enter to add and keep capturing' }),
    h('span', { cls: 'helm-spacer' }),
    button('Cancel', { onClick: () => m.close() }),
    button('Add', { primary: true, onClick: () => void submit(false) }),
  ));
  render();
  m.open();
  ctx.trackModal(m);
  setTimeout(() => input.focus(), 0);
}
