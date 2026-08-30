/** Shared form fields: an effort dropdown and start/end/effort linking. */
import { minutesToHuman, parseEffort } from '../core/dates';
import { button, h } from './dom';
import { AbstractInputSuggest, Modal, TFolder, type App } from 'obsidian';
import type { Recurrence } from '../core/types';
import { formatRecurrence, parseRecurrence } from '../core/recurrence';

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
  let previousStart = start.value;
  start.addEventListener('input', () => {
    const from = previousStart;
    previousStart = start.value;
    if (!start.value) return;
    const e = effort.get();
    if (e !== undefined) { end.value = toHhmm(toMin(start.value) + e); return; }
    if (!end.value) return;
    // No estimate: moving the start moves the whole block, so the end can never be left behind it.
    const duration = from && toMin(end.value) > toMin(from) ? toMin(end.value) - toMin(from) : undefined;
    if (duration !== undefined) end.value = toHhmm(toMin(start.value) + duration);
    else if (toMin(end.value) > toMin(start.value)) effort.set(toMin(end.value) - toMin(start.value));
    else end.value = '';
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

/** Folder or note picker on a plain text input. */
export class PathSuggest extends AbstractInputSuggest<string> {
  constructor(app: App, private input: HTMLInputElement, private kind: 'folder' | 'note', private onPick: (v: string) => void) { super(app, input); }
  private candidates(): string[] {
    const vault = this.app.vault as unknown as { getAllLoadedFiles?: () => unknown[]; getMarkdownFiles: () => { path: string }[] };
    if (this.kind === 'note') return vault.getMarkdownFiles().map((f) => f.path);
    const loaded = vault.getAllLoadedFiles?.();
    if (loaded) return loaded.filter((f): f is TFolder => f instanceof TFolder).map((f) => f.path).filter((p) => p !== '/' && p !== '');
    const out = new Set<string>();
    for (const f of vault.getMarkdownFiles()) { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/')); }
    return [...out];
  }
  override getSuggestions(query: string): string[] {
    const q = query.toLowerCase();
    return this.candidates().filter((p) => p.toLowerCase().includes(q)).sort((a, b) => a.length - b.length || a.localeCompare(b)).slice(0, 30);
  }
  override renderSuggestion(value: string, el: HTMLElement): void { el.setText(value); }
  override selectSuggestion(value: string): void { this.input.value = value; this.onPick(value); this.close(); }
}

/** Name + location dialog with a live preview of the resulting path. Resolves undefined on cancel. */
export function askNameAndLocation(ctx: { app: App; trackModal: (m: { close: () => void; onClose?: () => void }) => void }, o: { title: string; placeholder: string; defaultFolder: string; preview: (name: string, folder: string) => string; onDone: (r: { name?: string; folder?: string } | undefined) => void }): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(o.title);
  m.contentEl.addClass('helm-modal', 'helm-name-modal');
  const name = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder: o.placeholder } });
  const folder = h('input', { cls: 'helm-input-wide helm-path-input', attr: { type: 'text', value: o.defaultFolder, placeholder: o.defaultFolder } });
  const preview = h('div', { cls: 'helm-path-preview' });
  const update = (): void => { preview.textContent = o.preview(name.value, folder.value); };
  name.addEventListener('input', update);
  folder.addEventListener('input', update);
  new PathSuggest(ctx.app, folder, 'folder', () => update());
  let accepted = false;
  const accept = (): void => { accepted = true; m.close(); o.onDone({ ...(name.value.trim() ? { name: name.value.trim() } : {}), ...(folder.value.trim() && folder.value.trim() !== o.defaultFolder ? { folder: folder.value.trim() } : {}) }); };
  for (const el of [name, folder]) el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); accept(); } });
  m.contentEl.append(
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Name' }), name, h('div', { cls: 'helm-hint', text: 'Leave empty to name it after the item.' })),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Location' }), folder, h('div', { cls: 'helm-hint', text: 'Start typing to pick a folder.' })),
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: 'Will be created as' }), preview),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), h('button', { cls: 'helm-btn', text: 'Cancel', onClick: () => m.close() }), h('button', { cls: 'helm-btn mod-cta', text: 'Create', onClick: accept })),
  );
  const origClose = m.onClose.bind(m);
  m.onClose = () => { origClose(); if (!accepted) o.onDone(undefined); };
  update();
  m.open();
  ctx.trackModal(m);
  setTimeout(() => name.focus(), 0);
}

/** An inline conflict warning; empty when there is nothing to say. Returns the current conflict text for a confirm. */
export function conflictWarning(el: HTMLElement, text: string | undefined, suggest?: { time: string; onPick: () => void }): void {
  el.replaceChildren();
  el.style.display = text ? '' : 'none';
  if (!text) return;
  el.append(h('span', { cls: 'helm-conflict-icon', text: '⚠' }), h('span', { text: ` Overlaps ${text}` }));
  if (suggest) el.append(h('button', { cls: 'helm-btn helm-conflict-fix', text: `Move to ${suggest.time}`, title: 'The first free slot that fits', onClick: (ev) => { ev.preventDefault(); suggest.onPick(); } }));
}

/**
 * Ask for one line of text. Obsidian runs in Electron, where `window.prompt` is disabled and silently
 * returns null — so anything that needs a word from the user asks with this instead.
 */
export function askText(ctx: { app: App; trackModal: (m: { close: () => void; onClose?: () => void }) => void }, o: { title: string; label: string; value?: string; placeholder?: string; hint?: string; cta?: string; onDone: (value: string | undefined) => void }): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(o.title);
  m.contentEl.addClass('helm-modal', 'helm-ask-modal');
  const input = h('input', { cls: 'helm-input-wide', attr: { type: 'text', value: o.value ?? '', placeholder: o.placeholder ?? '' } });
  let accepted = false;
  const accept = (): void => { const v = input.value.trim(); if (v === '') { input.focus(); return; } accepted = true; m.close(); o.onDone(v); };
  input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); accept(); } });
  m.contentEl.append(
    h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label', text: o.label }), input, o.hint ? h('div', { cls: 'helm-hint', text: o.hint }) : null),
    h('div', { cls: 'helm-modal-buttons' }, h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button(o.cta ?? 'Save', { primary: true, onClick: accept })),
  );
  const origClose = m.onClose.bind(m);
  m.onClose = () => { origClose(); if (!accepted) o.onDone(undefined); };
  m.open();
  ctx.trackModal(m);
  setTimeout(() => { input.focus(); input.select(); }, 0);
}

/** The Repeat presets, shared by Capture and the task editor so one control means one thing. */
export const REPEAT_PRESETS: [string, string][] = [['Daily', 'every day'], ['Weekdays', 'every weekday'], ['Weekly', 'every week'], ['Monthly', 'every month'], ['Yearly', 'every year']];

/**
 * Fill `row` with the repeat buttons for `rec`. Clicking one hands `apply` the phrase to write —
 * the same words you would type — or undefined to stop repeating. A repeat typed by hand keeps a
 * button of its own, and “when done” appears once something repeats.
 */
export function repeatButtons(row: HTMLElement, rec: Recurrence | undefined, apply: (phrase: string | undefined) => void, label = 'Repeat'): void {
  const same = (phrase: string): boolean => {
    if (!rec?.parsed) return false;
    const b = parseRecurrence(phrase);
    return rec.frequency === b.frequency && rec.interval === b.interval
      && (rec.weekdays ?? []).join() === (b.weekdays ?? []).join() && (rec.monthDays ?? []).join() === (b.monthDays ?? []).join();
  };
  const known = REPEAT_PRESETS.some(([, phrase]) => same(phrase));
  const kids: (HTMLElement | null)[] = [
    label ? h('span', { cls: 'helm-hint', text: label }) : null,
    ...REPEAT_PRESETS.map(([text, phrase]) => {
      const on = same(phrase);
      return h('button', { cls: ['helm-tag-toggle', 'helm-repeat-toggle', on && 'is-active'], text, title: on ? `Not repeating (${phrase})` : `Repeat ${phrase}`, onClick: () => apply(on ? undefined : rec?.whenDone ? `${phrase} when done` : phrase) });
    }),
  ];
  if (rec?.parsed && !known) kids.push(h('button', { cls: 'helm-tag-toggle helm-repeat-toggle is-active', text: formatRecurrence({ ...rec, whenDone: false }), title: 'Stop repeating', onClick: () => apply(undefined) }));
  if (rec?.parsed) kids.push(h('button', { cls: ['helm-tag-toggle', 'helm-repeat-toggle', rec.whenDone && 'is-active'], text: 'when done', title: rec.whenDone ? 'Count the next one from the due date instead' : 'Count the next one from the day you tick it', onClick: () => apply(formatRecurrence({ ...rec, whenDone: !rec.whenDone })) }));
  row.replaceChildren(...kids.filter((k): k is HTMLElement => k !== null));
}
