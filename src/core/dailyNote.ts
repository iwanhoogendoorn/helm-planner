/**
 * The plan inside a daily note: a heading (`## Plan` by default) whose
 * section is owned by Helm, split into parts of the day.
 *
 * ```
 * ## Plan
 * ### Habits
 * - [ ] 🏃 Morning workout 🆔 hab-0012
 * ### Morning
 * - [ ] Draft chapter list 🆔 tsk-8821 🔗 [[OCI Book]]
 * ### Afternoon
 * - [ ] Fix router config ⏱️ 30m
 * ### Evening
 * ### Anytime
 * - [ ] Call the plumber
 * ```
 *
 * Everything outside the section is untouchable. Inside, the parts appear in
 * fixed order; an empty part is omitted; unknown content is kept below the
 * parts. Older notes wrapped in `%% helm:start %%` … `%% helm:end %%` are
 * read and, on the next write, rewritten without the markers.
 */
import type { HelmSettings, TaskLine } from './types';
import { parseDocument, type Document } from './document';
import { fenceStart, fenceStep, isHeading } from './tree';
import { parseTaskLine, serialiseTaskLine } from './taskLine';

export const REGION_START = '%% helm:start %%';
export const REGION_END = '%% helm:end %%';
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'anytime';
export type Section = 'habits' | DayPart;
export const DAY_PARTS: DayPart[] = ['morning', 'afternoon', 'evening', 'anytime'];
export const SECTION_ORDER: Section[] = ['habits', 'morning', 'afternoon', 'evening', 'anytime'];
export const SECTION_HEADINGS: Record<Section, string> = { habits: '### Habits', morning: '### Morning', afternoon: '### Afternoon', evening: '### Evening', anytime: '### Anytime' };
export const PART_LABEL: Record<DayPart, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', anytime: 'Anytime' };

export type RegionSettings = Pick<HelmSettings, 'regionPlacement' | 'regionAnchor' | 'planHeading'>;

export interface Region {
  /** First and last line index of the region, inclusive (markers or heading included). */
  start: number;
  end: number;
  /** True when the region is delimited by the legacy `%% helm %%` markers. */
  legacy: boolean;
  sections: Record<Section, { line: number; taskLines: number[] }>;
  /** Non-section, non-task lines inside the region (kept verbatim). */
  extra: string[];
}

export interface RegionScan {
  region?: Region;
  broken: boolean;
}

function emptySections(): Region['sections'] {
  return { habits: { line: -1, taskLines: [] }, morning: { line: -1, taskLines: [] }, afternoon: { line: -1, taskLines: [] }, evening: { line: -1, taskLines: [] }, anytime: { line: -1, taskLines: [] } };
}

function headingMatches(text: string, wanted: string): boolean {
  const w = wanted.replace(/^#+\s*/, '').trim().toLowerCase();
  return text.trim().toLowerCase() === w;
}

export function planHeadingLevel(settings: RegionSettings): number {
  const m = /^(#+)/.exec(settings.planHeading.trim());
  return m ? m[1]!.length : 2;
}

/**
 * Find the plan: legacy markers first, else the plan heading's section
 * (until the next heading of the same or a higher level).
 */
export function findRegion(lines: string[], settings: RegionSettings): RegionScan {
  let start = -1;
  let end = -1;
  let legacy = false;
  const fence = fenceStart();
  const level = planHeadingLevel(settings);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fenceStep(fence, line)) continue;
    const t = line.trim();
    if (t === REGION_START && start === -1) { start = i; legacy = true; continue; }
    if (legacy) { if (t === REGION_END) { end = i; break; } continue; }
    const h = isHeading(line);
    if (!h) continue;
    if (start === -1) { if (h.level === level && headingMatches(h.text, settings.planHeading)) start = i; continue; }
    if (h.level <= level) { end = i - 1; break; }
  }
  if (start === -1) return { broken: false };
  if (legacy && end === -1) return { broken: true };
  if (!legacy && end === -1) end = lines.length - 1;
  const region: Region = { start, end, legacy, sections: emptySections(), extra: [] };
  let current: Section | undefined;
  const bodyStart = start + 1;
  const bodyEnd = legacy ? end : end + 1;
  for (let i = bodyStart; i < bodyEnd; i++) {
    const line = lines[i]!;
    const h = isHeading(line);
    if (h) {
      const sec = sectionOf(h.text);
      if (sec) { current = sec; region.sections[sec].line = i; continue; }
      if (legacy && headingMatches(h.text, settings.planHeading)) continue;
      current = undefined;
      region.extra.push(line);
      continue;
    }
    if (current && parseTaskLine(line)) { region.sections[current].taskLines.push(i); continue; }
    if (line.trim() !== '') region.extra.push(line);
  }
  // Trim trailing blank lines off a heading-delimited region so the next section keeps its spacing.
  if (!legacy) while (region.end > region.start && lines[region.end]!.trim() === '') region.end--;
  return { region, broken: false };
}

export function sectionOf(text: string): Section | undefined {
  const t = text.trim().toLowerCase().replace(/^[a-c]\.\s*/, '');
  if (t === 'habits') return 'habits';
  if (t === 'morning') return 'morning';
  if (t === 'afternoon') return 'afternoon';
  if (t === 'evening' || t === 'tonight') return 'evening';
  if (t === 'anytime' || t === 'today' || t === 'tasks' || t === 'from projects' || t === 'projects' || t === 'project tasks' || t === 'any time') return 'anytime';
  return undefined;
}

export interface RegionContent {
  habits: TaskLine[];
  morning: TaskLine[];
  afternoon: TaskLine[];
  evening: TaskLine[];
  anytime: TaskLine[];
  extra: string[];
}

export function emptyContent(): RegionContent {
  return { habits: [], morning: [], afternoon: [], evening: [], anytime: [], extra: [] };
}

/** Render the region body: heading, parts in order, extra lines. No markers. */
export function renderRegion(c: RegionContent, settings: RegionSettings): string[] {
  const out = [settings.planHeading.trim()];
  for (const sec of SECTION_ORDER) {
    const items = c[sec];
    if (items.length === 0) continue;
    out.push(`${'#'.repeat(planHeadingLevel(settings) + 1)} ${SECTION_HEADINGS[sec].replace(/^#+\s*/, '')}`);
    for (const t of items) out.push(serialiseTaskLine({ ...t, raw: { ...t.raw, eol: '' } }));
  }
  if (c.extra.length > 0) out.push(...c.extra);
  return out;
}

/** Read the region's content as TaskLines, ready for editing. */
export function readRegion(lines: string[], region: Region): RegionContent {
  const grab = (sec: Section): TaskLine[] => region.sections[sec].taskLines.map((i) => parseTaskLine(lines[i]!)!);
  return { habits: grab('habits'), morning: grab('morning'), afternoon: grab('afternoon'), evening: grab('evening'), anytime: grab('anytime'), extra: [...region.extra] };
}

/** Which part a line sits in, by section, else by its time block. */
export function partOfLine(section: Section | undefined, time: { start: string } | undefined, settings: Pick<HelmSettings, 'morningEnds' | 'afternoonEnds'>): DayPart {
  if (section && section !== 'habits') return section;
  if (time) return partOfTime(time.start, settings);
  return 'anytime';
}

export function partOfTime(hhmm: string, settings: Pick<HelmSettings, 'morningEnds' | 'afternoonEnds'>): DayPart {
  if (hhmm < settings.morningEnds) return 'morning';
  if (hhmm < settings.afternoonEnds) return 'afternoon';
  return 'evening';
}

/** Where a brand-new region goes when the note has none. */
export function insertionPoint(doc: Document, settings: RegionSettings): number {
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
 * A broken legacy region (start without end) is never written.
 */
export function writeRegion(content: string, next: RegionContent, settings: RegionSettings): { lines: string[]; eol: string } | undefined {
  const doc = parseDocument(content);
  const scan = findRegion(doc.lines, settings);
  if (scan.broken) return undefined;
  const rendered = renderRegion(next, settings);
  const lines = [...doc.lines];
  if (scan.region) {
    const r = scan.region;
    const after = r.end + 1 < lines.length && lines[r.end + 1]!.trim() !== '' ? [''] : [];
    lines.splice(r.start, r.end - r.start + 1, ...rendered, ...after);
  } else {
    const at = insertionPoint(doc, settings);
    const before = at > 0 && lines[at - 1]!.trim() !== '' ? [''] : [];
    const after = at < lines.length && lines[at]!.trim() !== '' ? [''] : [];
    lines.splice(at, 0, ...before, ...rendered, ...after);
  }
  return { lines, eol: doc.eol };
}

export function isEmptyRegion(c: RegionContent): boolean {
  return SECTION_ORDER.every((s) => c[s].length === 0) && c.extra.length === 0;
}

/** All task lines of a region with their part. */
export function regionLines(c: RegionContent): { line: TaskLine; part: DayPart }[] {
  return DAY_PARTS.flatMap((p) => c[p].map((line) => ({ line, part: p })));
}

/** Remove every line matching `pred` from every part; returns the removed lines. */
export function removeLines(c: RegionContent, pred: (l: TaskLine, part: DayPart) => boolean): TaskLine[] {
  const removed: TaskLine[] = [];
  for (const p of DAY_PARTS) {
    const keep: TaskLine[] = [];
    for (const l of c[p]) { if (pred(l, p)) removed.push(l); else keep.push(l); }
    c[p] = keep;
  }
  return removed;
}
