/**
 * The Helm region inside a daily note.
 *
 * ```
 * %% helm:start %%
 * ## Plan
 * ### Habits
 * - [ ] Morning workout 🆔 hab-0012
 * ### Today
 * - [ ] Fix router config ⏱️ 30m 🆔 tsk-9001
 * ### From projects
 * - [ ] Draft chapter list 🔗 [[OCI Book]] 📅 2026-09-05 🆔 tsk-8821
 * %% helm:end %%
 * ```
 *
 * Everything outside the markers is untouchable. Inside, the three sections
 * appear in fixed order; an empty one is omitted; unknown content is kept
 * below the recognised sections.
 */
import type { HelmSettings, TaskLine } from './types';
import { parseDocument, type Document } from './document';
import { fenceStart, fenceStep, isHeading } from './tree';
import { parseTaskLine, serialiseTaskLine } from './taskLine';

export const REGION_START = '%% helm:start %%';
export const REGION_END = '%% helm:end %%';
export const REGION_TITLE = '## Plan';
export type Section = 'habits' | 'today' | 'projects';
export const SECTION_HEADINGS: Record<Section, string> = { habits: '### Habits', today: '### Today', projects: '### From projects' };
const SECTION_ORDER: Section[] = ['habits', 'today', 'projects'];

export interface Region {
  /** Line index of the start marker, end marker (exclusive range is start..end). */
  start: number;
  end: number;
  sections: Record<Section, { line: number; taskLines: number[] }>;
  /** Non-section, non-task lines inside the region (kept verbatim). */
  extra: string[];
}

export interface RegionScan {
  region?: Region;
  broken: boolean;
}

export function findRegion(lines: string[]): RegionScan {
  let start = -1;
  let end = -1;
  const fence = fenceStart();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fenceStep(fence, line)) continue;
    const t = line.trim();
    if (t === REGION_START && start === -1) start = i;
    else if (t === REGION_END && start !== -1 && end === -1) { end = i; break; }
  }
  if (start === -1) return { broken: false };
  if (end === -1) return { broken: true };
  const region: Region = {
    start, end, extra: [],
    sections: { habits: { line: -1, taskLines: [] }, today: { line: -1, taskLines: [] }, projects: { line: -1, taskLines: [] } },
  };
  let current: Section | undefined;
  for (let i = start + 1; i < end; i++) {
    const line = lines[i]!;
    const h = isHeading(line);
    if (h) {
      const sec = sectionOf(h.text);
      if (sec) { current = sec; region.sections[sec].line = i; continue; }
      if (h.level === 2 && /^plan$/i.test(h.text.trim())) continue;
      current = undefined;
      region.extra.push(line);
      continue;
    }
    if (current && parseTaskLine(line)) { region.sections[current].taskLines.push(i); continue; }
    if (line.trim() !== '') region.extra.push(line);
  }
  return { region, broken: false };
}

function sectionOf(text: string): Section | undefined {
  const t = text.trim().toLowerCase();
  if (t === 'habits') return 'habits';
  if (t === 'today' || t === 'tasks') return 'today';
  if (t === 'from projects' || t === 'projects' || t === 'project tasks') return 'projects';
  return undefined;
}

export interface RegionContent {
  habits: TaskLine[];
  today: TaskLine[];
  projects: TaskLine[];
  extra: string[];
}

export function renderRegion(c: RegionContent): string[] {
  const out = [REGION_START, REGION_TITLE];
  for (const sec of SECTION_ORDER) {
    const items = c[sec];
    if (items.length === 0) continue;
    out.push(SECTION_HEADINGS[sec]);
    for (const t of items) out.push(serialiseTaskLine({ ...t, raw: { ...t.raw, eol: '' } }));
  }
  if (c.extra.length > 0) out.push(...c.extra);
  out.push(REGION_END);
  return out;
}

/** Read the region's content as TaskLines, ready for editing. */
export function readRegion(lines: string[], region: Region): RegionContent {
  const grab = (sec: Section): TaskLine[] => region.sections[sec].taskLines.map((i) => parseTaskLine(lines[i]!)!);
  return { habits: grab('habits'), today: grab('today'), projects: grab('projects'), extra: [...region.extra] };
}

/** Where a brand-new region goes when the note has none. */
export function insertionPoint(doc: Document, settings: Pick<HelmSettings, 'regionPlacement' | 'regionAnchor'>): number {
  const { lines, frontmatter } = doc;
  if (settings.regionPlacement === 'after-anchor') {
    const anchor = settings.regionAnchor.trim().toLowerCase();
    const h = doc.headings.find((x) => `${'#'.repeat(x.level)} ${x.text}`.trim().toLowerCase() === anchor || x.text.trim().toLowerCase() === anchor.replace(/^#+\s*/, ''));
    if (h) return h.line + 1;
  }
  if (settings.regionPlacement === 'before-first-heading' || settings.regionPlacement === 'after-anchor') {
    const h = doc.headings[0];
    if (h) return h.line;
  }
  let p = lines.length;
  while (p > frontmatter.endLine && lines[p - 1]!.trim() === '') p--;
  return p;
}

/**
 * Replace (or insert) the region with new content. Returns the new lines.
 * A broken region (start without end) is never written.
 */
export function writeRegion(content: string, next: RegionContent, settings: Pick<HelmSettings, 'regionPlacement' | 'regionAnchor'>): { lines: string[]; eol: string } | undefined {
  const doc = parseDocument(content);
  const scan = findRegion(doc.lines);
  if (scan.broken) return undefined;
  const rendered = renderRegion(next);
  const lines = [...doc.lines];
  if (scan.region) {
    lines.splice(scan.region.start, scan.region.end - scan.region.start + 1, ...rendered);
  } else {
    const at = insertionPoint(doc, settings);
    const before = at > 0 && lines[at - 1]!.trim() !== '' ? [''] : [];
    const after = at < lines.length && lines[at]!.trim() !== '' ? [''] : [];
    lines.splice(at, 0, ...before, ...rendered, ...after);
  }
  return { lines, eol: doc.eol };
}

export function isEmptyRegion(c: RegionContent): boolean {
  return c.habits.length === 0 && c.today.length === 0 && c.projects.length === 0 && c.extra.length === 0;
}
