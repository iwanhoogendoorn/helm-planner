/**
 * Turns a structured summary — the shape an AI (or Helm itself) produces — into
 * Excalidraw elements with a deterministic layout: a title, a one-line summary,
 * theme columns holding item boxes, a highlights strip and a "next" strip.
 * Nothing here talks to a model; it only lays things out.
 */
import type { ExcalidrawElement } from './drawing';

export interface DiagramSpec {
  title: string;
  summary?: string;
  themes: { name: string; color?: string; items: string[] }[];
  highlights?: string[];
  next?: string[];
}

export const PALETTE: Record<string, { bg: string; stroke: string }> = {
  blue: { bg: '#a5d8ff', stroke: '#1971c2' }, green: { bg: '#b2f2bb', stroke: '#2f9e44' }, yellow: { bg: '#ffec99', stroke: '#f08c00' },
  red: { bg: '#ffc9c9', stroke: '#e03131' }, purple: { bg: '#d0bfff', stroke: '#7048e8' }, orange: { bg: '#ffd8a8', stroke: '#e8590c' },
  teal: { bg: '#96f2d7', stroke: '#099268' }, grey: { bg: '#e9ecef', stroke: '#495057' }, pink: { bg: '#fcc2d7', stroke: '#c2255c' },
};
const ORDER = ['blue', 'green', 'yellow', 'purple', 'orange', 'teal', 'pink', 'red', 'grey'];

let counter = 0;
const nid = (): string => `h${(++counter % 1679616).toString(36).padStart(4, '0')}${Math.floor(Math.random() * 60466176).toString(36).padStart(5, '0')}`;
const base = (): Record<string, unknown> => ({ angle: 0, fillStyle: 'solid', strokeWidth: 1, strokeStyle: 'solid', roughness: 1, opacity: 100, groupIds: [], frameId: null, seed: Math.floor(Math.random() * 2 ** 31), version: 1, versionNonce: Math.floor(Math.random() * 2 ** 31), isDeleted: false, boundElements: null, updated: Date.now(), link: null, locked: false });

const CHAR_W = 0.6;
function wrap(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const w of para.split(/\s+/)) {
      if (line !== '' && (line + ' ' + w).length > maxChars) { out.push(line); line = w; } else line = line === '' ? w : `${line} ${w}`;
    }
    out.push(line);
  }
  return out;
}

function text(x: number, y: number, str: string, opts: { size?: number; align?: 'left' | 'center'; width?: number; color?: string; bold?: boolean } = {}): ExcalidrawElement {
  const size = opts.size ?? 16;
  const maxChars = opts.width ? Math.max(8, Math.floor(opts.width / (size * CHAR_W))) : 200;
  const lines = wrap(str, maxChars);
  const width = opts.width ?? Math.max(...lines.map((l) => l.length)) * size * CHAR_W;
  const height = lines.length * size * 1.25;
  return { ...base(), id: nid(), type: 'text', x, y, width, height, text: lines.join('\n'), originalText: str, fontSize: size, fontFamily: opts.bold ? 2 : 1, textAlign: opts.align ?? 'left', verticalAlign: 'top', strokeColor: opts.color ?? '#1e1e1e', backgroundColor: 'transparent', containerId: null, autoResize: true, lineHeight: 1.25 } as ExcalidrawElement;
}

function box(x: number, y: number, w: number, h: number, label: string, color: { bg: string; stroke: string }, size = 14): ExcalidrawElement[] {
  const rect: ExcalidrawElement = { ...base(), id: nid(), type: 'rectangle', x, y, width: w, height: h, strokeColor: color.stroke, backgroundColor: color.bg, roundness: { type: 3 } } as ExcalidrawElement;
  const t = text(x + 8, y + 8, label, { size, width: w - 16, align: 'center' });
  t['containerId'] = rect.id; t['verticalAlign'] = 'middle';
  t.x = x + (w - t.width) / 2; t.y = y + (h - t.height) / 2;
  rect['boundElements'] = [{ type: 'text', id: t.id }];
  return [rect, t];
}

/** Lay a spec out. Columns per theme; boxes stack inside; strips below. */
export function layoutDiagram(spec: DiagramSpec): ExcalidrawElement[] {
  const els: ExcalidrawElement[] = [];
  const COL_W = 260, GAP = 30, BOX_H = 56, PAD = 16;
  const themes = spec.themes.slice(0, 6);
  const cols = Math.max(1, Math.min(themes.length, 4));
  const rowHeights: number[] = [];
  const totalW = cols * COL_W + (cols - 1) * GAP;
  let y = 0;
  els.push(text(0, y, spec.title, { size: 28, bold: true, width: totalW }));
  y += 28 * 1.25 + 8;
  if (spec.summary) { const s = text(0, y, spec.summary, { size: 16, width: totalW, color: '#495057' }); els.push(s); y += s.height + 24; } else y += 16;
  const colTop = y;
  let maxBottom = colTop;
  themes.forEach((theme, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = c * (COL_W + GAP);
    const items = theme.items.slice(0, 8);
    const height = PAD + 24 + PAD + items.length * (BOX_H + 10) + PAD;
    const yTop = colTop + (r > 0 ? rowHeights.slice(0, r).reduce((a, b) => a + b + GAP, 0) : 0);
    const color = PALETTE[theme.color ?? ''] ?? PALETTE[ORDER[i % ORDER.length]!]!;
    els.push({ ...base(), id: nid(), type: 'rectangle', x, y: yTop, width: COL_W, height, strokeColor: color.stroke, backgroundColor: color.bg, opacity: 35, roundness: { type: 3 } } as ExcalidrawElement);
    els.push(text(x + PAD, yTop + PAD, theme.name, { size: 18, bold: true, width: COL_W - 2 * PAD, color: color.stroke }));
    items.forEach((it, j) => els.push(...box(x + PAD, yTop + PAD + 24 + PAD + j * (BOX_H + 10), COL_W - 2 * PAD, BOX_H, it, { bg: '#ffffff', stroke: color.stroke })));
    rowHeights[r] = Math.max(rowHeights[r] ?? 0, height);
    maxBottom = Math.max(maxBottom, yTop + height);
  });
  y = maxBottom + GAP;
  const strip = (label: string, items: string[], color: { bg: string; stroke: string }): void => {
    if (items.length === 0) return;
    els.push(text(0, y, label, { size: 18, bold: true, color: color.stroke }));
    y += 30;
    const w = Math.floor((totalW - GAP * (Math.min(items.length, 4) - 1)) / Math.min(items.length, 4));
    items.slice(0, 8).forEach((it, i) => { const c = i % 4, r = Math.floor(i / 4); els.push(...box(c * (w + GAP), y + r * (BOX_H + 10), w, BOX_H, it, color)); });
    y += Math.ceil(Math.min(items.length, 8) / 4) * (BOX_H + 10) + GAP;
  };
  strip('Highlights', spec.highlights ?? [], PALETTE['yellow']!);
  strip('Next', spec.next ?? [], PALETTE['green']!);
  return els;
}
/** Parse a model's reply into a spec: tolerant of fences and prose around the JSON. */
export function parseDiagramSpec(raw: string): DiagramSpec | undefined {
  const m = /\{[\s\S]*\}/.exec(raw.replace(/```(?:json)?/g, ''));
  if (!m) return undefined;
  let obj: unknown;
  try { obj = JSON.parse(m[0]); } catch { return undefined; }
  if (!obj || typeof obj !== 'object') return undefined;
  const o = obj as Record<string, unknown>;
  const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
  const strs = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
  const themes = Array.isArray(o['themes']) ? (o['themes'] as unknown[]).map((t) => { const tt = (t ?? {}) as Record<string, unknown>; return { name: str(tt['name']) || 'Theme', ...(str(tt['color']) ? { color: str(tt['color']) } : {}), items: strs(tt['items']) }; }).filter((t) => t.items.length > 0 || t.name) : [];
  if (!str(o['title']) && themes.length === 0) return undefined;
  return { title: str(o['title']) || 'Diagram', ...(str(o['summary']) ? { summary: str(o['summary']) } : {}), themes, highlights: strs(o['highlights']), next: strs(o['next']) };
}
