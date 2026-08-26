/** Hand-rolled SVG charts. No dependencies, theme colours from CSS variables. */

const NS = 'http://www.w3.org/2000/svg';

export function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, ...children: (SVGElement | string | null)[]): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  for (const c of children) { if (c === null) continue; if (typeof c === 'string') el.appendChild(document.createTextNode(c)); else el.appendChild(c); }
  return el;
}

/**
 * Charts are drawn for a concrete pixel width so text is never stretched.
 * The wrapper re-draws when its width changes (ResizeObserver), and falls
 * back to a fixed width where that API is missing (tests).
 */
export function responsive(draw: (width: number) => SVGSVGElement, minHeight = 0): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'helm-chart-wrap';
  if (minHeight) wrap.style.minHeight = `${minHeight}px`;
  let last = 0;
  const paint = (): void => {
    const w = Math.max(200, Math.floor(wrap.clientWidth || 600));
    if (w === last) return;
    last = w;
    wrap.replaceChildren(draw(w));
  };
  paint();
  if (typeof ResizeObserver !== 'undefined') {
    let raf = 0;
    const ro = new ResizeObserver(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paint); });
    ro.observe(wrap);
  }
  return wrap;
}

export interface Bar { key: string; label: string; value: number; color?: string; title?: string }

export interface BarOptions {
  height?: number;
  onClick?: (key: string) => void;
  selected?: string;
  /** Show every nth label (auto when omitted). */
  labelEvery?: number;
  valueLabels?: boolean;
  color?: string;
  horizontal?: boolean;
}

export function barChart(bars: Bar[], opts: BarOptions = {}): HTMLElement {
  if (opts.horizontal) return responsive((w) => hBarChart(bars, opts, w));
  return responsive((w) => vBarChart(bars, opts, w), opts.height ?? 140);
}

function vBarChart(bars: Bar[], opts: BarOptions, W: number): SVGSVGElement {
  const H = opts.height ?? 140;
  const padB = 20;
  const padT = opts.valueLabels ? 16 : 8;
  const max = Math.max(1, ...bars.map((b) => b.value));
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'helm-chart helm-chart-bars' });
  const n = Math.max(1, bars.length);
  const slot = W / n;
  const bw = Math.min(36, slot * 0.7);
  const every = opts.labelEvery ?? Math.max(1, Math.ceil((n * 34) / W));
  el.appendChild(svg('line', { x1: 0, x2: W, y1: H - padB + 0.5, y2: H - padB + 0.5, class: 'helm-chart-grid' }));
  bars.forEach((b, i) => {
    const h = ((H - padB - padT) * b.value) / max;
    const cx = i * slot + slot / 2;
    const g = svg('g', { class: `helm-bar-group${opts.selected === b.key ? ' is-selected' : ''}${opts.onClick ? ' is-clickable' : ''}` });
    g.appendChild(svg('rect', { x: i * slot, y: 0, width: slot, height: H, class: 'helm-bar-hit' }));
    g.appendChild(svg('rect', { x: cx - bw / 2, y: H - padB - h, width: bw, height: Math.max(h, b.value > 0 ? 2 : 0), rx: 3, class: 'helm-bar', style: b.color ? `fill:${b.color}` : opts.color ? `fill:${opts.color}` : '' }));
    g.appendChild(svg('title', {}, b.title ?? `${b.label}: ${b.value}`));
    if (opts.valueLabels && b.value > 0 && slot >= 18) g.appendChild(svg('text', { x: cx, y: H - padB - h - 4, class: 'helm-chart-value', 'text-anchor': 'middle' }, String(b.value)));
    if (i % every === 0) g.appendChild(svg('text', { x: cx, y: H - 6, class: 'helm-chart-label', 'text-anchor': 'middle' }, b.label));
    if (opts.onClick) g.addEventListener('click', () => opts.onClick!(b.key));
    el.appendChild(g);
  });
  return el;
}

function hBarChart(bars: Bar[], opts: BarOptions, W: number): SVGSVGElement {
  const rowH = 22;
  const labelW = Math.min(160, Math.max(90, W * 0.3));
  const H = Math.max(rowH, bars.length * rowH);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'helm-chart helm-chart-hbars' });
  bars.forEach((b, i) => {
    const w = ((W - labelW - 40) * b.value) / max;
    const y = i * rowH;
    const g = svg('g', { class: `helm-bar-group${opts.selected === b.key ? ' is-selected' : ''}${opts.onClick ? ' is-clickable' : ''}` });
    g.appendChild(svg('rect', { x: 0, y, width: W, height: rowH, class: 'helm-bar-hit' }));
    g.appendChild(svg('text', { x: labelW - 6, y: y + rowH * 0.68, class: 'helm-chart-label', 'text-anchor': 'end' }, truncate(b.label, Math.floor(labelW / 6.5))));
    g.appendChild(svg('rect', { x: labelW, y: y + 4, width: Math.max(w, b.value > 0 ? 2 : 0), height: rowH - 8, rx: 3, class: 'helm-bar', style: b.color ? `fill:${b.color}` : opts.color ? `fill:${opts.color}` : '' }));
    g.appendChild(svg('text', { x: labelW + w + 6, y: y + rowH * 0.68, class: 'helm-chart-value' }, String(b.value)));
    g.appendChild(svg('title', {}, b.title ?? `${b.label}: ${b.value}`));
    if (opts.onClick) g.addEventListener('click', () => opts.onClick!(b.key));
    el.appendChild(g);
  });
  return el;
}

export interface Line { label: string; points: number[]; color?: string; area?: boolean }

export function lineChart(lines: Line[], labels: string[], opts: { height?: number } = {}): HTMLElement {
  return responsive((w) => lineChartAt(lines, labels, opts, w), opts.height ?? 140);
}

function lineChartAt(lines: Line[], labels: string[], opts: { height?: number }, W: number): SVGSVGElement {
  const H = opts.height ?? 140;
  const padB = 20;
  const padT = 8;
  const padX = 10;
  const n = Math.max(2, labels.length);
  const max = Math.max(1, ...lines.flatMap((l) => l.points));
  const el = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, class: 'helm-chart helm-chart-lines' });
  const x = (i: number): number => padX + (i / (n - 1)) * (W - 2 * padX);
  const y = (v: number): number => H - padB - ((H - padB - padT) * v) / max;
  for (let i = 1; i <= 3; i++) el.appendChild(svg('line', { x1: 0, x2: W, y1: y((max * i) / 4), y2: y((max * i) / 4), class: 'helm-chart-grid' }));
  for (const l of lines) {
    const d = l.points.map((v, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    if (l.area) el.appendChild(svg('path', { d: `${d} L${x(l.points.length - 1).toFixed(1)},${y(0)} L0,${y(0)} Z`, class: 'helm-chart-area', style: l.color ? `fill:${l.color}` : '' }));
    el.appendChild(svg('path', { d, class: 'helm-chart-line', style: l.color ? `stroke:${l.color}` : '' }));
  }
  const every = Math.max(1, Math.ceil((labels.length * 40) / W));
  labels.forEach((lab, i) => { if (i % every === 0 || i === labels.length - 1) el.appendChild(svg('text', { x: Math.min(W - 20, Math.max(16, x(i))), y: H - 5, class: 'helm-chart-label', 'text-anchor': 'middle' }, lab)); });
  el.appendChild(svg('text', { x: 4, y: padT + 9, class: 'helm-chart-value' }, String(max)));
  return el;
}

export interface Slice { key: string; label: string; value: number; color?: string }

const PALETTE = ['var(--color-blue)', 'var(--color-green)', 'var(--color-orange)', 'var(--color-purple)', 'var(--color-cyan)', 'var(--color-yellow)', 'var(--color-red)', 'var(--color-pink)', 'var(--text-faint)'];

export function donut(slices: Slice[], opts: { size?: number; onClick?: (key: string) => void; selected?: string; centre?: string } = {}): SVGSVGElement {
  const S = opts.size ?? 120;
  const r = S / 2 - 6;
  const inner = r * 0.62;
  const total = Math.max(1, slices.reduce((s, x) => s + x.value, 0));
  const el = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: 'helm-chart helm-chart-donut', style: `width:${S}px;height:${S}px` });
  let a0 = -Math.PI / 2;
  slices.forEach((s, i) => {
    if (s.value <= 0) return;
    const a1 = a0 + (2 * Math.PI * s.value) / total;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (a: number, rad: number): string => `${(S / 2 + rad * Math.cos(a)).toFixed(2)},${(S / 2 + rad * Math.sin(a)).toFixed(2)}`;
    const d = slices.length === 1 || s.value === total
      ? `M${p(a0, r)} A${r},${r} 0 1,1 ${p(a0 + Math.PI, r)} A${r},${r} 0 1,1 ${p(a0, r)} M${p(a0, inner)} A${inner},${inner} 0 1,0 ${p(a0 + Math.PI, inner)} A${inner},${inner} 0 1,0 ${p(a0, inner)}`
      : `M${p(a0, r)} A${r},${r} 0 ${big},1 ${p(a1, r)} L${p(a1, inner)} A${inner},${inner} 0 ${big},0 ${p(a0, inner)} Z`;
    const path = svg('path', { d, class: `helm-donut-slice${opts.selected === s.key ? ' is-selected' : ''}${opts.onClick ? ' is-clickable' : ''}`, style: `fill:${s.color ?? PALETTE[i % PALETTE.length]}`, 'fill-rule': 'evenodd' });
    path.appendChild(svg('title', {}, `${s.label}: ${s.value} (${Math.round((100 * s.value) / total)}%)`));
    if (opts.onClick) path.addEventListener('click', () => opts.onClick!(s.key));
    el.appendChild(path);
    a0 = a1;
  });
  if (opts.centre) el.appendChild(svg('text', { x: S / 2, y: S / 2 + 5, class: 'helm-chart-centre', 'text-anchor': 'middle' }, opts.centre));
  return el;
}

export function legend(slices: Slice[], onClick?: (key: string) => void, selected?: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'helm-legend';
  slices.forEach((s, i) => {
    const item = document.createElement(onClick ? 'button' : 'span');
    item.className = `helm-legend-item${selected === s.key ? ' is-selected' : ''}`;
    const dot = document.createElement('span');
    dot.className = 'helm-legend-dot';
    dot.style.background = s.color ?? PALETTE[i % PALETTE.length]!;
    item.append(dot, document.createTextNode(`${s.label} · ${s.value}`));
    if (onClick) item.addEventListener('click', () => onClick(s.key));
    wrap.appendChild(item);
  });
  return wrap;
}

/** A big number with a ring showing a 0..1 fraction. */
export function gauge(fraction: number, label: string, opts: { size?: number; good?: number } = {}): SVGSVGElement {
  const S = opts.size ?? 96;
  const r = S / 2 - 8;
  const c = 2 * Math.PI * r;
  const f = Math.max(0, Math.min(1, fraction));
  const cls = f >= (opts.good ?? 0.7) ? 'is-good' : f >= 0.4 ? 'is-warn' : 'is-bad';
  const el = svg('svg', { viewBox: `0 0 ${S} ${S}`, class: `helm-chart helm-gauge ${cls}`, style: `width:${S}px;height:${S}px` });
  el.appendChild(svg('circle', { cx: S / 2, cy: S / 2, r, class: 'helm-gauge-track' }));
  el.appendChild(svg('circle', { cx: S / 2, cy: S / 2, r, class: 'helm-gauge-fill', 'stroke-dasharray': `${(c * f).toFixed(1)} ${c.toFixed(1)}`, transform: `rotate(-90 ${S / 2} ${S / 2})` }));
  el.appendChild(svg('text', { x: S / 2, y: S / 2 + 2, class: 'helm-gauge-value', 'text-anchor': 'middle' }, `${Math.round(f * 100)}%`));
  el.appendChild(svg('text', { x: S / 2, y: S / 2 + 16, class: 'helm-gauge-label', 'text-anchor': 'middle' }, label));
  return el;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
