/**
 * Turns a structured summary — the shape an AI (or Helm itself) produces — into
 * Excalidraw elements with a deterministic layout: a title, a one-line summary,
 * theme columns holding item boxes, a highlights strip and a "next" strip.
 * Nothing here talks to a model; it only lays things out.
 */
import type { ExcalidrawElement } from './drawing';

export type DiagramKind = 'columns' | 'hub' | 'flow' | 'matrix' | 'checklist' | 'lesson';

export interface DiagramSpec {
  kind?: DiagramKind;
  title: string;
  summary?: string;
  // columns (overview / research)
  themes: { name: string; color?: string; items: string[] }[];
  highlights?: string[];
  next?: string[];
  // hub: knowledge map
  center?: string;
  spokes?: { name: string; detail?: string }[];
  flow?: string[];
  sources?: string[];
  // flow: roadmap
  steps?: { title: string; effort?: string; verify?: string }[];
  stalls?: string[];
  // matrix: comparison
  options?: string[];
  criteria?: string[];
  cells?: string[][];
  pick?: { option: string; why?: string };
  // checklist board
  before?: string[];
  during?: { step: string; pitfall?: string }[];
  after?: string[];
  mistakes?: string[];
  // lesson
  example?: string[];
  terms?: { term: string; meaning: string }[];
  quiz?: { q: string; a: string }[];
}

/** The JSON shape a model must return for each kind, as text for a prompt. */
export const KIND_SCHEMAS: Record<DiagramKind, string> = {
  columns: '{"kind":"columns","title":string,"summary":string,"themes":[{"name":string,"color":string,"items":[string]}],"highlights":[string],"next":[string]}',
  hub: '{"kind":"hub","title":string (≤ 60),"summary":string (≤ 160),"center":string (the subject, ≤ 40),"spokes":[{"name":string (a key concept, ≤ 30),"detail":string (one line, ≤ 60)}] (5–10),"flow":[string (≤ 40)] (how it works, 3–7 ordered steps),"sources":[string (≤ 60, name + what it is good for)] (3–5),"highlights":[string (≤ 48)] (what people get wrong, 2–4)}',
  flow: '{"kind":"flow","title":string (≤ 60),"summary":string (what done looks like, ≤ 160),"before":[string (≤ 48)] (prerequisites, 1–4),"steps":[{"title":string (≤ 40),"effort":string (≤ 12, e.g. 45m or 2h),"verify":string (≤ 50, how you know it worked)}] (4–10, in order),"stalls":[string (≤ 60, where it stalls → what to do)] (2–4)}',
  matrix: '{"kind":"matrix","title":string (≤ 60),"summary":string (≤ 160),"options":[string (≤ 24)] (3–5),"criteria":[string (≤ 18)] (4–6, e.g. cost, time, risk, fit, reversibility),"cells":[[string (≤ 26)]] (one row per criterion, one cell per option, same order),"pick":{"option":string (exactly one of options),"why":string (≤ 120)},"next":[string (≤ 48)] (what to find out to be sure, 1–3)}',
  checklist: '{"kind":"checklist","title":string (≤ 60),"summary":string (≤ 160),"before":[string (≤ 44)] (3–8),"during":[{"step":string (≤ 44),"pitfall":string (≤ 50, the tell-tale sign or trap)}] (3–8),"after":[string (≤ 44)] (2–6),"mistakes":[string (≤ 56, mistake → how to avoid)] (3)}',
  lesson: '{"kind":"lesson","title":string (≤ 60),"summary":string (the one-paragraph summary, ≤ 200),"example":[string (≤ 56)] (one concrete worked example as 3–7 ordered steps),"terms":[{"term":string (≤ 22),"meaning":string (≤ 60)}] (4–8),"quiz":[{"q":string (≤ 70),"a":string (≤ 60)}] (3–5, easy to hard)}',
};

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

function arrow(from: ExcalidrawElement, to: ExcalidrawElement, color = '#868e96'): ExcalidrawElement {
  // From the nearest edge midpoints, so it reads as a connection rather than a diagonal through the boxes.
  const fx = from.x + from.width / 2, fy = from.y + from.height / 2, tx = to.x + to.width / 2, ty = to.y + to.height / 2;
  const horizontal = Math.abs(tx - fx) >= Math.abs(ty - fy);
  // A row wrap (target below and to the left) routes down, across the gap and down again, instead of slashing over the boxes.
  const wrap = ty > from.y + from.height && tx < fx;
  const x1 = wrap ? fx : horizontal ? (tx > fx ? from.x + from.width : from.x) : fx;
  const y1 = wrap ? from.y + from.height : horizontal ? fy : (ty > fy ? from.y + from.height : from.y);
  const x2 = wrap ? tx : horizontal ? (tx > fx ? to.x : to.x + to.width) : tx;
  const y2 = wrap ? to.y : horizontal ? ty : (ty > fy ? to.y : to.y + to.height);
  const midY = (y1 + y2) / 2 - y1;
  const points: [number, number][] = wrap ? [[0, 0], [0, midY], [x2 - x1, midY], [x2 - x1, y2 - y1]] : [[0, 0], [x2 - x1, y2 - y1]];
  const a: ExcalidrawElement = { ...base(), id: nid(), type: 'arrow', x: x1, y: y1, width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), points, strokeColor: color, backgroundColor: 'transparent', roundness: wrap ? null : { type: 2 }, startArrowhead: null, endArrowhead: 'arrow', elbowed: false,
    startBinding: { elementId: from.id, focus: 0, gap: 4 }, endBinding: { elementId: to.id, focus: 0, gap: 4 } } as ExcalidrawElement;
  for (const el of [from, to]) { const b = (el['boundElements'] as { type: string; id: string }[] | null) ?? []; el['boundElements'] = [...b, { type: 'arrow', id: a.id }]; }
  return a;
}

const heading = (x: number, y: number, label: string, color: string): ExcalidrawElement => text(x, y, label, { size: 18, bold: true, color });

/** Lay a spec out in the shape its kind asks for. */
export function layoutDiagram(spec: DiagramSpec): ExcalidrawElement[] {
  switch (spec.kind) {
    case 'hub': return layoutHub(spec);
    case 'flow': return layoutFlow(spec);
    case 'matrix': return layoutMatrix(spec);
    case 'checklist': return layoutChecklist(spec);
    case 'lesson': return layoutLesson(spec);
    default: return layoutColumns(spec);
  }
}

/** Knowledge map: the subject in the middle, concepts around it, how-it-works flow and sources below. */
function layoutHub(spec: DiagramSpec): ExcalidrawElement[] {
  const els: ExcalidrawElement[] = [];
  const spokes = (spec.spokes ?? []).slice(0, 10);
  const R = 300, CX = 460, CY = 340;
  els.push(text(0, 0, spec.title, { size: 28, bold: true, width: 920 }));
  if (spec.summary) els.push(text(0, 44, spec.summary, { size: 16, width: 920, color: '#495057' }));
  const hub = box(CX - 130, CY - 44, 260, 88, spec.center ?? spec.title, PALETTE['blue']!, 18);
  els.push(...hub);
  const spokeEls: ExcalidrawElement[] = [];
  spokes.forEach((sp, i) => {
    const ang = -Math.PI / 2 + (i / spokes.length) * Math.PI * 2;
    const w = 210, hgt = 64;
    const x = CX + Math.cos(ang) * R - w / 2, y = CY + Math.sin(ang) * R - hgt / 2;
    const b = box(x, y, w, hgt, sp.name, { bg: '#ffffff', stroke: PALETTE['blue']!.stroke }, 14);
    spokeEls.push(b[0]!); els.push(...b);
    if (sp.detail) els.push(text(x, y + hgt + 4, sp.detail, { size: 11, width: w, color: '#495057', align: 'center' }));
  });
  for (const sEl of spokeEls) els.push(arrow(hub[0]!, sEl, PALETTE['blue']!.stroke));
  let y = CY + R + 90;
  const flow = (spec.flow ?? []).slice(0, 7);
  if (flow.length) {
    els.push(heading(0, y, 'How it works', PALETTE['green']!.stroke)); y += 32;
    const w = Math.min(200, Math.floor((920 - 20 * (flow.length - 1)) / flow.length));
    const boxes = flow.map((st, i) => { const b = box(i * (w + 20), y, w, 64, `${i + 1}. ${st}`, PALETTE['green']!, 13); els.push(...b); return b[0]!; });
    for (let i = 1; i < boxes.length; i++) els.push(arrow(boxes[i - 1]!, boxes[i]!, PALETTE['green']!.stroke));
    y += 64 + 30;
  }
  const strip = (label: string, items: string[], color: { bg: string; stroke: string }): void => {
    if (!items.length) return;
    els.push(heading(0, y, label, color.stroke)); y += 32;
    const n = Math.min(items.length, 4); const w = Math.floor((920 - 20 * (n - 1)) / n);
    items.slice(0, 8).forEach((it, i) => els.push(...box((i % 4) * (w + 20), y + Math.floor(i / 4) * 70, w, 60, it, color, 12)));
    y += Math.ceil(Math.min(items.length, 8) / 4) * 70 + 20;
  };
  strip('Sources', spec.sources ?? [], PALETTE['grey']!);
  strip('Easy to get wrong', spec.highlights ?? [], PALETTE['yellow']!);
  return els;
}

/** Roadmap: prerequisites, then steps left to right with effort and verification, then stall points. */
function layoutFlow(spec: DiagramSpec): ExcalidrawElement[] {
  const els: ExcalidrawElement[] = [];
  const W = 960;
  els.push(text(0, 0, spec.title, { size: 28, bold: true, width: W }));
  let y = 44;
  if (spec.summary) { const t = text(0, y, `Done = ${spec.summary}`, { size: 16, width: W, color: '#495057' }); els.push(t); y += t.height + 16; }
  const before = (spec.before ?? []).slice(0, 4);
  if (before.length) {
    els.push(heading(0, y, 'Before you start', PALETTE['grey']!.stroke)); y += 32;
    const w = Math.floor((W - 16 * (before.length - 1)) / before.length);
    before.forEach((b, i) => els.push(...box(i * (w + 16), y, w, 52, b, PALETTE['grey']!, 12)));
    y += 52 + 28;
  }
  els.push(heading(0, y, 'Steps', PALETTE['blue']!.stroke)); y += 32;
  const steps = (spec.steps ?? []).slice(0, 10);
  const per = 4, bw = 216, bh = 96, gx = 32, gy = 40;
  const boxes: ExcalidrawElement[] = [];
  steps.forEach((st, i) => {
    const c = i % per, r = Math.floor(i / per);
    const x = c * (bw + gx), yy = y + r * (bh + gy);
    const b = box(x, yy, bw, bh, `${i + 1}. ${st.title}${st.effort ? `\n⏱ ${st.effort}` : ''}${st.verify ? `\n✓ ${st.verify}` : ''}`, { bg: '#ffffff', stroke: PALETTE['blue']!.stroke }, 12);
    boxes.push(b[0]!); els.push(...b);
  });
  for (let i = 1; i < boxes.length; i++) els.push(arrow(boxes[i - 1]!, boxes[i]!, PALETTE['blue']!.stroke));
  y += Math.ceil(steps.length / per) * (bh + gy) + 8;
  const stalls = (spec.stalls ?? []).slice(0, 4);
  if (stalls.length) {
    els.push(heading(0, y, 'Where it stalls', PALETTE['orange']!.stroke)); y += 32;
    const w = Math.floor((W - 16 * (stalls.length - 1)) / stalls.length);
    stalls.forEach((b, i) => els.push(...box(i * (w + 16), y, w, 60, b, PALETTE['orange']!, 12)));
  }
  return els;
}

/** Comparison matrix: options across, criteria down, the recommended option's column highlighted. */
function layoutMatrix(spec: DiagramSpec): ExcalidrawElement[] {
  const els: ExcalidrawElement[] = [];
  const options = (spec.options ?? []).slice(0, 5);
  const criteria = (spec.criteria ?? []).slice(0, 6);
  const CW = 170, RH = 64, LW = 150, G = 8;
  const W = LW + options.length * (CW + G);
  els.push(text(0, 0, spec.title, { size: 28, bold: true, width: Math.max(W, 600) }));
  let y = 44;
  if (spec.summary) { const t = text(0, y, spec.summary, { size: 16, width: Math.max(W, 600), color: '#495057' }); els.push(t); y += t.height + 16; }
  const pickIdx = spec.pick ? options.findIndex((o) => o.toLowerCase() === spec.pick!.option.toLowerCase()) : -1;
  options.forEach((o, i) => els.push(...box(LW + i * (CW + G), y, CW, 56, o, i === pickIdx ? PALETTE['green']! : PALETTE['blue']!, 14)));
  y += 56 + G;
  criteria.forEach((c, r) => {
    els.push(...box(0, y + r * (RH + G), LW - G, RH, c, PALETTE['grey']!, 13));
    options.forEach((_o, i) => els.push(...box(LW + i * (CW + G), y + r * (RH + G), CW, RH, spec.cells?.[r]?.[i] ?? '—', i === pickIdx ? { bg: '#e6fcf5', stroke: PALETTE['green']!.stroke } : { bg: '#ffffff', stroke: '#adb5bd' }, 12)));
  });
  y += criteria.length * (RH + G) + 16;
  if (spec.pick) { const t = text(0, y, `Pick: ${spec.pick.option}${spec.pick.why ? ` — ${spec.pick.why}` : ''}`, { size: 15, width: Math.max(W, 600), color: PALETTE['green']!.stroke, bold: true }); els.push(t); y += t.height + 16; }
  const next = (spec.next ?? []).slice(0, 3);
  if (next.length) { els.push(heading(0, y, 'To be sure, find out', PALETTE['yellow']!.stroke)); y += 32; const w = Math.floor((Math.max(W, 600) - 16 * (next.length - 1)) / next.length); next.forEach((n, i) => els.push(...box(i * (w + 16), y, w, 56, n, PALETTE['yellow']!, 12))); }
  return els;
}

/** Checklist board: Before / During / After columns of checkbox items, pitfalls in red under the During steps. */
function layoutChecklist(spec: DiagramSpec): ExcalidrawElement[] {
  const els: ExcalidrawElement[] = [];
  const COL = 300, G = 24, W = COL * 3 + G * 2;
  els.push(text(0, 0, spec.title, { size: 28, bold: true, width: W }));
  let y = 44;
  if (spec.summary) { const t = text(0, y, spec.summary, { size: 16, width: W, color: '#495057' }); els.push(t); y += t.height + 16; }
  const cols: { label: string; color: { bg: string; stroke: string }; items: { text: string; pitfall?: string }[] }[] = [
    { label: 'Before', color: PALETTE['blue']!, items: (spec.before ?? []).slice(0, 8).map((t) => ({ text: t })) },
    { label: 'During', color: PALETTE['purple']!, items: (spec.during ?? []).slice(0, 8).map((d) => ({ text: d.step, ...(d.pitfall ? { pitfall: d.pitfall } : {}) })) },
    { label: 'After', color: PALETTE['green']!, items: (spec.after ?? []).slice(0, 8).map((t) => ({ text: t })) },
  ];
  let maxBottom = y;
  cols.forEach((c, ci) => {
    const x = ci * (COL + G);
    let yy = y;
    els.push(heading(x, yy, c.label, c.color.stroke)); yy += 34;
    for (const it of c.items) {
      els.push(...box(x, yy, COL, 52, `☐ ${it.text}`, { bg: '#ffffff', stroke: c.color.stroke }, 12)); yy += 52;
      if (it.pitfall) { const t = text(x + 10, yy + 2, `⚠ ${it.pitfall}`, { size: 11, width: COL - 20, color: PALETTE['red']!.stroke }); els.push(t); yy += t.height + 4; }
      yy += 8;
    }
    maxBottom = Math.max(maxBottom, yy);
  });
  y = maxBottom + 16;
  const mistakes = (spec.mistakes ?? []).slice(0, 4);
  if (mistakes.length) { els.push(heading(0, y, 'Most common mistakes', PALETTE['red']!.stroke)); y += 32; const w = Math.floor((W - 16 * (mistakes.length - 1)) / mistakes.length); mistakes.forEach((m, i) => els.push(...box(i * (w + 16), y, w, 64, m, PALETTE['red']!, 12))); }
  return els;
}

/** Lesson: a worked example down the left, terms on the right, quiz cards and the summary below. */
function layoutLesson(spec: DiagramSpec): ExcalidrawElement[] {
  const els: ExcalidrawElement[] = [];
  const LW = 420, RW = 440, G = 40, W = LW + G + RW;
  els.push(text(0, 0, spec.title, { size: 28, bold: true, width: W }));
  let y = 52;
  els.push(heading(0, y, 'Worked example', PALETTE['blue']!.stroke));
  els.push(heading(LW + G, y, 'Terms', PALETTE['purple']!.stroke));
  y += 34;
  const steps = (spec.example ?? []).slice(0, 7);
  const boxes: ExcalidrawElement[] = [];
  steps.forEach((st, i) => { const b = box(0, y + i * 84, LW, 60, `${i + 1}. ${st}`, { bg: '#ffffff', stroke: PALETTE['blue']!.stroke }, 13); boxes.push(b[0]!); els.push(...b); });
  for (let i = 1; i < boxes.length; i++) els.push(arrow(boxes[i - 1]!, boxes[i]!, PALETTE['blue']!.stroke));
  const terms = (spec.terms ?? []).slice(0, 8);
  terms.forEach((t, i) => { els.push(...box(LW + G, y + i * 64, RW, 54, `${t.term} — ${t.meaning}`, { bg: PALETTE['purple']!.bg, stroke: PALETTE['purple']!.stroke }, 12)); });
  y += Math.max(steps.length * 84, terms.length * 64) + 16;
  const quiz = (spec.quiz ?? []).slice(0, 5);
  if (quiz.length) {
    els.push(heading(0, y, 'Quiz yourself', PALETTE['yellow']!.stroke)); y += 32;
    const w = Math.floor((W - 16 * (Math.min(quiz.length, 5) - 1)) / Math.min(quiz.length, 5));
    quiz.forEach((q, i) => { els.push(...box(i * (w + 16), y, w, 70, `Q${i + 1}. ${q.q}`, PALETTE['yellow']!, 11)); els.push(text(i * (w + 16) + 6, y + 74, `A: ${q.a}`, { size: 10, width: w - 12, color: '#495057' })); });
    y += 70 + 44;
  }
  if (spec.summary) els.push(...box(0, y, W, 80, spec.summary, PALETTE['green']!, 13));
  return els;
}

/** Overview / research columns: themes side by side, boxes stacked, highlights and next below. */
function layoutColumns(spec: DiagramSpec): ExcalidrawElement[] {
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
  const objs = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []);
  const kindRaw = str(o['kind']);
  const kind: DiagramKind | undefined = (['columns', 'hub', 'flow', 'matrix', 'checklist', 'lesson'] as DiagramKind[]).find((k) => k === kindRaw);
  const spec: DiagramSpec = { ...(kind ? { kind } : {}), title: str(o['title']) || 'Diagram', ...(str(o['summary']) ? { summary: str(o['summary']) } : {}), themes, highlights: strs(o['highlights']), next: strs(o['next']) };
  if (str(o['center'])) spec.center = str(o['center']);
  const spokes = objs(o['spokes']).map((x) => ({ name: str(x['name']), ...(str(x['detail']) ? { detail: str(x['detail']) } : {}) })).filter((x) => x.name); if (spokes.length) spec.spokes = spokes;
  if (strs(o['flow']).length) spec.flow = strs(o['flow']);
  if (strs(o['sources']).length) spec.sources = strs(o['sources']);
  const steps = objs(o['steps']).map((x) => ({ title: str(x['title']), ...(str(x['effort']) ? { effort: str(x['effort']) } : {}), ...(str(x['verify']) ? { verify: str(x['verify']) } : {}) })).filter((x) => x.title); if (steps.length) spec.steps = steps;
  if (strs(o['stalls']).length) spec.stalls = strs(o['stalls']);
  if (strs(o['options']).length) spec.options = strs(o['options']);
  if (strs(o['criteria']).length) spec.criteria = strs(o['criteria']);
  if (Array.isArray(o['cells'])) spec.cells = (o['cells'] as unknown[]).map((row) => strs(row));
  const pick = (o['pick'] ?? null) as Record<string, unknown> | null; if (pick && str(pick['option'])) spec.pick = { option: str(pick['option']), ...(str(pick['why']) ? { why: str(pick['why']) } : {}) };
  if (strs(o['before']).length) spec.before = strs(o['before']);
  const during = objs(o['during']).map((x) => ({ step: str(x['step']), ...(str(x['pitfall']) ? { pitfall: str(x['pitfall']) } : {}) })).filter((x) => x.step); if (during.length) spec.during = during;
  if (strs(o['after']).length) spec.after = strs(o['after']);
  if (strs(o['mistakes']).length) spec.mistakes = strs(o['mistakes']);
  if (strs(o['example']).length) spec.example = strs(o['example']);
  const terms = objs(o['terms']).map((x) => ({ term: str(x['term']), meaning: str(x['meaning']) })).filter((x) => x.term); if (terms.length) spec.terms = terms;
  const quiz = objs(o['quiz']).map((x) => ({ q: str(x['q']), a: str(x['a']) })).filter((x) => x.q); if (quiz.length) spec.quiz = quiz;
  const hasKindContent = !!(spec.spokes || spec.steps || spec.options || spec.before || spec.during || spec.example);
  if (!str(o['title']) && themes.length === 0 && !hasKindContent) return undefined;
  if (themes.length === 0 && !hasKindContent) return undefined;
  return spec;
}
