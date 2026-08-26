/** Shared form fields: an effort dropdown and start/end/effort linking. */
import { minutesToHuman, parseEffort } from '../core/dates';
import { h } from './dom';

export const EFFORT_PRESETS = [5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 480];

export interface EffortField {
  el: HTMLElement;
  get(): number | undefined;
  set(minutes: number | undefined): void;
  onChange(fn: () => void): void;
}

/** A select with common durations, "no estimate", and a custom entry (30m, 2h, 1h30m). */
export function effortField(initial?: number): EffortField {
  const sel = h('select', { cls: 'helm-effort-select', title: 'Effort estimate' });
  const custom = h('input', { cls: 'helm-effort-custom', attr: { type: 'text', placeholder: '1h30m' }, style: { display: 'none' } });
  const listeners: (() => void)[] = [];
  const fire = (): void => { for (const fn of listeners) fn(); };
  const rebuild = (value: number | undefined): void => {
    sel.replaceChildren();
    sel.appendChild(h('option', { text: 'no estimate', attr: { value: '' } }));
    const values = [...EFFORT_PRESETS];
    if (value !== undefined && !values.includes(value)) values.push(value);
    values.sort((a, b) => a - b);
    for (const m of values) sel.appendChild(h('option', { text: minutesToHuman(m), attr: { value: String(m), selected: value === m } }));
    sel.appendChild(h('option', { text: 'custom…', attr: { value: 'custom' } }));
    if (value === undefined) sel.value = '';
  };
  rebuild(initial);
  sel.addEventListener('change', () => {
    if (sel.value === 'custom') { custom.style.display = ''; custom.focus(); return; }
    custom.style.display = 'none';
    fire();
  });
  custom.addEventListener('change', () => {
    const m = parseEffort(custom.value);
    if (m !== undefined && m > 0) { rebuild(m); custom.style.display = 'none'; custom.value = ''; fire(); }
  });
  custom.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); custom.dispatchEvent(new Event('change')); } });
  return {
    el: h('span', { cls: 'helm-effort' }, sel, custom),
    get: () => (sel.value === '' || sel.value === 'custom' ? undefined : Number(sel.value)),
    set: (m) => rebuild(m),
    onChange: (fn) => listeners.push(fn),
  };
}

const toMin = (hhmm: string): number => { const [hh, mm] = hhmm.split(':').map(Number); return (hh ?? 0) * 60 + (mm ?? 0); };
const toHhmm = (min: number): string => `${String(Math.floor(((min % 1440) + 1440) % 1440 / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/**
 * Keep start time, end time and effort consistent:
 *  start changes → end = start + effort (or effort = end − start)
 *  effort changes → end = start + effort
 *  end changes → effort = end − start
 */
export function linkTimes(start: HTMLInputElement, end: HTMLInputElement, effort: EffortField): void {
  start.addEventListener('input', () => {
    if (!start.value) return;
    const e = effort.get();
    if (e !== undefined) end.value = toHhmm(toMin(start.value) + e);
    else if (end.value && toMin(end.value) > toMin(start.value)) effort.set(toMin(end.value) - toMin(start.value));
  });
  effort.onChange(() => {
    const e = effort.get();
    if (start.value && e !== undefined) end.value = toHhmm(toMin(start.value) + e);
  });
  end.addEventListener('input', () => {
    if (start.value && end.value && toMin(end.value) > toMin(start.value)) effort.set(toMin(end.value) - toMin(start.value));
  });
}

export function effortRaw(minutes: number): string { return minutesToHuman(minutes); }
