/**
 * Drawings: Excalidraw (`*.excalidraw.md`) and Canvas files, and how they attach
 * to the things Helm knows — a task, a project, a day, a week / month / quarter /
 * year. A drawing can belong to several of them, and an entity can have many.
 *
 * Attachment is by evidence, most explicit first:
 *  1. `helm-task` / `helm-project` / `helm-date` / `helm-period` frontmatter keys
 *     (scalar or list) — what Helm writes when it creates a drawing;
 *  2. the note that embeds or links the drawing (`![[X.excalidraw]]` in a daily,
 *     periodic or project note);
 *  3. where it lives: a drawing under a project's folder belongs to that project;
 *  4. its name: “26, Wednesday, Aug, 2026 — flow” starts with a daily-note title,
 *     “2026-W35 map” with a weekly one;
 *  5. what it says: `[[wikilinks]]` to those notes and `tsk-…` ids in its text.
 */
import { parseDocument } from './document';
import { scalar } from './frontmatter';
import type { IsoDate } from './types';

export interface Drawing {
  path: string;
  /** Basename without `.excalidraw` / `.canvas`. */
  title: string;
  kind: 'excalidraw' | 'canvas';
  mtime?: number;
  /** Explicit attachments from frontmatter. */
  taskIds: string[];
  projectRefs: string[];
  dates: IsoDate[];
  periodKeys: string[];
  /** Wikilink targets found in the text elements and frontmatter (basename, no `.md`). */
  links: string[];
  /** Task ids mentioned anywhere in the text. */
  mentionedTaskIds: string[];
  /** Whether the drawing was made by Helm's AI diagram generator. */
  generated: boolean;
}

export const DRAWING_RE = /\.(excalidraw\.md|excalidraw|canvas)$/i;
export function isDrawingPath(path: string): boolean { return DRAWING_RE.test(path); }
export function drawingTitle(path: string): string { return path.slice(path.lastIndexOf('/') + 1).replace(DRAWING_RE, '').trim(); }

const list = (v: unknown): string[] => {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = String(v).trim();
  if (s === '') return [];
  return s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [s];
};
const unlink = (s: string): string => s.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.split('#')[0]!.replace(/\.md$/, '').trim();

/** Parse a drawing. Only the frontmatter and the `## Text Elements` section are read; the scene JSON is skipped. */
export function parseDrawing(path: string, content: string | undefined, mtime?: number): Drawing {
  const kind: Drawing['kind'] = /\.canvas$/i.test(path) ? 'canvas' : 'excalidraw';
  const d: Drawing = { path, title: drawingTitle(path), kind, taskIds: [], projectRefs: [], dates: [], periodKeys: [], links: [], mentionedTaskIds: [], generated: false, ...(mtime !== undefined ? { mtime } : {}) };
  if (!content || kind === 'canvas') return d;
  const doc = parseDocument(content);
  const fm = doc.frontmatter.values;
  d.taskIds = list(fm['helm-task'] ?? fm['helm_task']);
  d.projectRefs = list(fm['helm-project'] ?? fm['helm_project']).map(unlink);
  d.dates = list(fm['helm-date'] ?? fm['helm_date']).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x));
  d.periodKeys = list(fm['helm-period'] ?? fm['helm_period']);
  d.generated = /^(true|yes|1)$/i.test(scalar(fm['helm-generated']) ?? '');
  // Text elements: between "## Text Elements" and the next "## " heading or "%%".
  const m = /## Text Elements\s*\n([\s\S]*?)(?:\n## |\n%%|$)/.exec(content);
  const text = Object.values(fm).map((v) => (typeof v === 'string' ? v : '')).join('\n') + '\n' + (m?.[1] ?? '');
  const links = new Set<string>();
  for (const l of text.matchAll(/\[\[([^\]]+)\]\]/g)) links.add(unlink(l[1]!));
  d.links = [...links];
  d.mentionedTaskIds = [...new Set([...text.matchAll(/\btsk-[a-z0-9]+\b/g)].map((x) => x[0]))];
  return d;
}

/* ── Writing an Excalidraw document ────────────────────────────────────── */

export interface ExcalidrawElement {
  id: string;
  type: 'rectangle' | 'text' | 'arrow' | 'line' | 'ellipse' | 'diamond';
  x: number; y: number; width: number; height: number;
  [k: string]: unknown;
}

/** A minimal, valid Excalidraw markdown file (uncompressed JSON; the plugin re-saves it its own way). */
export function renderExcalidrawDocument(opts: { elements?: ExcalidrawElement[]; frontmatter?: Record<string, string | string[] | boolean>; background?: string; extra?: string }): string {
  const fm: string[] = ['---'];
  for (const [k, v] of Object.entries(opts.frontmatter ?? {})) {
    if (Array.isArray(v)) fm.push(`${k}:`, ...v.map((x) => `  - ${x}`));
    else fm.push(`${k}: ${typeof v === 'boolean' ? String(v) : v}`);
  }
  fm.push('excalidraw-plugin: parsed', 'tags: [excalidraw]', '---');
  const elements = opts.elements ?? [];
  // The plugin reads this section back as the source of text: one entry per element, entries separated by a blank line.
  const texts = elements.filter((e) => e.type === 'text').flatMap((e) => [`${String(e['text'] ?? '')} ^${e.id}`, '']);
  const scene = { type: 'excalidraw', version: 2, source: 'https://github.com/zsviczian/obsidian-excalidraw-plugin', elements, appState: { theme: 'light', viewBackgroundColor: opts.background ?? '#ffffff', currentItemFontFamily: 1, gridSize: null }, files: {} };
  return [
    ...fm, '',
    '==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==', '',
    ...(opts.extra ? [opts.extra, ''] : []),
    '# Excalidraw Data', '',
    '## Text Elements', ...texts, '',
    '%%', '## Drawing', '```json', JSON.stringify(scene), '```', '%%', '',
  ].join('\n');
}
