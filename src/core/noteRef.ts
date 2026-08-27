/**
 * Notes attached to tasks, projects, days and periods — the same idea as
 * drawings: a plain markdown note carries `helm-task` / `helm-project` /
 * `helm-date` / `helm-period` in its frontmatter (scalar or list), so it can
 * live anywhere in the vault and still be found. A task also owns the notes
 * its own text links (`Call the plumber || [[Plumber quotes]]`), and a
 * project / daily / periodic note owns the notes linked under its `## Notes`
 * heading — which is where Helm puts the links it makes.
 */
import { parseDocument, sectionRange } from './document';
import type { IsoDate } from './types';

export interface NoteRef {
  path: string;
  title: string;
  mtime?: number;
  taskIds: string[];
  projectRefs: string[];
  dates: IsoDate[];
  periodKeys: string[];
  habitIds: string[];
}

export const HELM_KEYS = ['helm-task', 'helm-project', 'helm-date', 'helm-period', 'helm-habit'] as const;

/** True when a frontmatter object (Obsidian's cache or Helm's parse) carries any attachment key. */
export function hasHelmKeys(fm: Record<string, unknown> | null | undefined): boolean {
  if (!fm) return false;
  return HELM_KEYS.some((k) => { const v = fm[k] ?? fm[k.replace('-', '_')]; return v !== undefined && v !== null && String(v).trim() !== ''; });
}

/** Cheap check on raw content: only the frontmatter block is looked at. */
export function contentHasHelmKeys(content: string): boolean {
  if (!content.startsWith('---')) return false;
  const end = content.indexOf('\n---', 3);
  const head = end === -1 ? content.slice(0, 4000) : content.slice(0, end);
  return /^helm[-_](task|project|date|period|habit):\s*\S/m.test(head);
}

export const listValues = (v: unknown): string[] => {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = String(v).trim();
  if (s === '') return [];
  return s.startsWith('[') && s.endsWith(']') ? s.slice(1, -1).split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean) : [s];
};
const unlink = (s: string): string => s.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.split('#')[0]!.replace(/\.md$/, '').trim();

export function noteTitle(path: string): string { return path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, ''); }

/** Attachment keys of a note from its frontmatter values. */
export function parseNoteRef(path: string, fm: Record<string, unknown>, mtime?: number): NoteRef {
  return {
    path, title: noteTitle(path), ...(mtime !== undefined ? { mtime } : {}),
    taskIds: listValues(fm['helm-task'] ?? fm['helm_task']),
    projectRefs: listValues(fm['helm-project'] ?? fm['helm_project']).map(unlink),
    dates: listValues(fm['helm-date'] ?? fm['helm_date']).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x)),
    periodKeys: listValues(fm['helm-period'] ?? fm['helm_period']),
    habitIds: listValues(fm['helm-habit'] ?? fm['helm_habit']),
  };
}

/** Wikilink targets (basenames, no extension) found in a string. */
export function wikilinksIn(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/!?\[\[([^\]|#]+?)(?:\.md)?(?:[|#][^\]]*)?\]\]/g)) { const t = m[1]!.trim(); out.push(t.slice(t.lastIndexOf('/') + 1)); }
  return [...new Set(out)];
}

/** Wikilinks under a note's `## Notes` (or Related / Links) heading. */
export function notesSectionLinks(content: string): string[] {
  const doc = parseDocument(content);
  const h = doc.headings.find((x) => /^(notes?|related|links?)$/i.test(x.text.trim()));
  if (!h) return [];
  const { start, end } = sectionRange(doc, h);
  return wikilinksIn(doc.lines.slice(start, end).join('\n')).filter((t) => !/\.(excalidraw|canvas)$/i.test(t));
}

/** A fresh note for a target. */
export function renderNewNote(o: { title: string; target: Record<string, string>; forLabel: string; today: IsoDate }): string {
  return ['---', ...Object.entries(o.target).map(([k, v]) => `${k}: ${v}`), `created: ${o.today}`, '---', '', `# ${o.title}`, '', `> For: ${o.forLabel}`, '', ''].join('\n');
}
