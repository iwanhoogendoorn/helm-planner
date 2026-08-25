/**
 * Tiny DOM helpers. Plain `document.createElement` so the views render
 * identically under jsdom in tests and inside Obsidian.
 */
import { setIcon } from 'obsidian';

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Attrs {
  cls?: string | (string | false | undefined)[];
  text?: string;
  title?: string;
  attr?: Record<string, string | number | boolean | undefined>;
  style?: Partial<CSSStyleDeclaration>;
  onClick?: (ev: MouseEvent) => void;
  onContextMenu?: (ev: MouseEvent) => void;
  onKeyDown?: (ev: KeyboardEvent) => void;
  onInput?: (ev: Event) => void;
  onChange?: (ev: Event) => void;
  draggable?: boolean;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs.cls) {
    const list = (Array.isArray(attrs.cls) ? attrs.cls : [attrs.cls]).filter((c): c is string => typeof c === 'string' && c !== '').flatMap((c) => c.split(/\s+/)).filter(Boolean);
    for (const c of list) el.classList.add(c);
  }
  if (attrs.text !== undefined) el.textContent = attrs.text;
  if (attrs.title !== undefined) el.title = attrs.title;
  if (attrs.attr) for (const [k, v] of Object.entries(attrs.attr)) if (v !== undefined && v !== false) el.setAttribute(k, String(v));
  if (attrs.style) Object.assign(el.style, attrs.style);
  if (attrs.onClick) el.addEventListener('click', attrs.onClick as EventListener);
  if (attrs.onContextMenu) el.addEventListener('contextmenu', attrs.onContextMenu as EventListener);
  if (attrs.onKeyDown) el.addEventListener('keydown', attrs.onKeyDown as EventListener);
  if (attrs.onInput) el.addEventListener('input', attrs.onInput);
  if (attrs.onChange) el.addEventListener('change', attrs.onChange);
  if (attrs.draggable) el.draggable = true;
  append(el, children);
  return el;
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) { append(el, c); continue; }
    if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function icon(name: string, cls = ''): HTMLElement {
  const el = h('span', { cls: ['helm-icon', cls], attr: { 'data-icon': name } });
  try { setIcon(el, name); } catch { /* jsdom */ }
  return el;
}

export function button(label: string, opts: { icon?: string; cls?: string; primary?: boolean; title?: string; onClick?: (ev: MouseEvent) => void } = {}): HTMLButtonElement {
  const b = h('button', { cls: ['helm-btn', opts.primary && 'mod-cta', opts.cls], title: opts.title ?? '', onClick: opts.onClick }, opts.icon ? icon(opts.icon) : null, label ? h('span', { text: label }) : null);
  return b;
}

export function iconButton(name: string, title: string, onClick: (ev: MouseEvent) => void, cls = ''): HTMLButtonElement {
  return h('button', { cls: ['helm-iconbtn', cls], title, onClick, attr: { 'aria-label': title } }, icon(name));
}

/** Render text with [[wikilinks]], #tags and `code` lightly styled. */
export function richText(text: string, openLink?: (target: string) => void): HTMLElement {
  const span = h('span', { cls: 'helm-richtext' });
  const re = /(\[\[[^\]]+\]\])|(\[[^\]]+\]\([^)]+\))|((?:^|\s)#[\p{L}\p{N}_\-/]+)|(`[^`]+`)|(\*\*[^*]+\*\*)/gu;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) span.appendChild(document.createTextNode(text.slice(last, m.index)));
    const raw = m[0];
    if (m[1]) {
      const inner = raw.slice(2, -2);
      const [target, alias] = inner.split('|');
      span.appendChild(h('a', { cls: 'internal-link helm-link', text: alias ?? target, attr: { href: target ?? '' }, onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); openLink?.(target ?? ''); } }));
    } else if (m[2]) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(raw)!;
      span.appendChild(h('a', { cls: 'external-link helm-link', text: mm[1]!, attr: { href: mm[2]!, target: '_blank', rel: 'noopener' }, onClick: (ev) => ev.stopPropagation() }));
    } else if (m[3]) {
      const lead = raw.startsWith('#') ? '' : raw[0]!;
      if (lead) span.appendChild(document.createTextNode(lead));
      span.appendChild(h('span', { cls: 'helm-tag', text: raw.trim() }));
    } else if (m[4]) span.appendChild(h('code', { text: raw.slice(1, -1) }));
    else if (m[5]) span.appendChild(h('strong', { text: raw.slice(2, -2) }));
    last = m.index + raw.length;
  }
  if (last < text.length) span.appendChild(document.createTextNode(text.slice(last)));
  return span;
}

export function progressBar(fraction: number, cls = ''): HTMLElement {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  return h('div', { cls: ['helm-progress', cls], attr: { 'aria-valuenow': Math.round(pct) } }, h('div', { cls: 'helm-progress-fill', style: { width: `${pct}%` } }));
}

export function section(title: string, opts: { count?: number | string; collapsed?: boolean; actions?: Child[]; cls?: string; key?: string; store?: Map<string, boolean> } = {}, ...body: Child[]): HTMLElement {
  const key = opts.key ?? title;
  const collapsed = opts.store?.has(key) ? opts.store.get(key)! : opts.collapsed ?? false;
  const wrap = h('section', { cls: ['helm-section', opts.cls, collapsed && 'is-collapsed'] });
  const bodyEl = h('div', { cls: 'helm-section-body' }, ...body);
  const head = h('div', {
    cls: 'helm-section-head',
    onClick: (ev) => {
      if ((ev.target as HTMLElement).closest('.helm-section-actions')) return;
      wrap.classList.toggle('is-collapsed');
      opts.store?.set(key, wrap.classList.contains('is-collapsed'));
    },
  },
    icon('chevron-down', 'helm-section-chevron'),
    h('span', { cls: 'helm-section-title', text: title }),
    opts.count !== undefined ? h('span', { cls: 'helm-count', text: String(opts.count) }) : null,
    h('span', { cls: 'helm-spacer' }),
    opts.actions ? h('span', { cls: 'helm-section-actions' }, ...opts.actions) : null,
  );
  wrap.appendChild(head);
  wrap.appendChild(bodyEl);
  return wrap;
}

export function empty(text: string, ...extra: Child[]): HTMLElement {
  return h('div', { cls: 'helm-empty' }, h('p', { text }), ...extra);
}

export function chip(text: string, cls = '', title?: string): HTMLElement {
  return h('span', { cls: ['helm-chip', cls], text, title: title ?? '' });
}
