/** Shared form fields: an effort dropdown and start/end/effort linking. */
import { minutesToHuman, parseEffort } from '../core/dates';
import { h } from './dom';
import { AbstractInputSuggest, type App } from 'obsidian';

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

/** A habit's icon: its uploaded image when it has one, else its emoji, else nothing. */
export function habitBadge(ctx: { resourceUrl: (p: string) => string | undefined }, hb: { icon?: string; iconImage?: string }): HTMLElement | null {
  if (hb.iconImage) { const url = ctx.resourceUrl(hb.iconImage); if (url) return h('img', { cls: 'helm-habit-img', attr: { src: url, alt: '' } }); }
  return hb.icon ? h('span', { cls: 'helm-habit-emoji', text: hb.icon }) : null;
}

/**
 * `[[` completion inside a task text input: after `[[` the note titles of the
 * vault are offered (drawings as `Title.excalidraw`); picking one closes the
 * link and moves the caret past it. Only the link being typed is touched.
 */
export class WikilinkSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, private input: HTMLInputElement, private titles: () => string[]) { super(app, input); this.limit = 30; }
  /** The `[[…` being typed at the caret, if any. */
  private linkAtCaret(): { start: number; query: string } | undefined {
    const caret = this.input.selectionStart ?? this.input.value.length;
    const before = this.input.value.slice(0, caret);
    const i = before.lastIndexOf('[[');
    if (i === -1) return undefined;
    const after = before.slice(i + 2);
    if (after.includes(']]') || after.includes('[[')) return undefined;
    return { start: i, query: after };
  }
  override getSuggestions(_query: string): string[] {
    const o = this.linkAtCaret();
    if (!o) return [];
    const q = o.query.toLowerCase();
    const all = this.titles();
    const starts = all.filter((t) => t.toLowerCase().startsWith(q));
    const contains = q === '' ? [] : all.filter((t) => !t.toLowerCase().startsWith(q) && t.toLowerCase().includes(q));
    return [...starts, ...contains].slice(0, 30);
  }
  override renderSuggestion(value: string, el: HTMLElement): void { el.setText(value); }
  override selectSuggestion(value: string): void {
    const o = this.linkAtCaret();
    if (!o) return;
    const caret = this.input.selectionStart ?? this.input.value.length;
    const v = this.input.value;
    const tail = v.slice(caret);
    const closeAlready = tail.startsWith(']]');
    const next = `${v.slice(0, o.start)}[[${value}]]${closeAlready ? tail.slice(2) : tail.startsWith(' ') || tail === '' ? tail : ` ${tail}`}`;
    this.input.value = next;
    const pos = o.start + value.length + 4;
    this.input.setSelectionRange(pos, pos);
    this.input.dispatchEvent(new Event('input', { bubbles: true }));
    this.close();
  }
}

/** Attach `[[` completion to a text input. */
export function wikilinkSuggest(ctx: { app: App; index: { noteTitles: () => string[] } }, input: HTMLInputElement): WikilinkSuggest {
  return new WikilinkSuggest(ctx.app, input, () => ctx.index.noteTitles());
}
