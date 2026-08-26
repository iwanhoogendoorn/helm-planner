/**
 * The day plan inside a daily note.
 *
 * Helm adopts the note's own structure: any headings named Morning /
 * Afternoon / Evening (with or without an "A." prefix), Habits, and Anytime
 * (also Today / Tasks / From projects) are the plan's sections, wherever
 * they sit — typically under the user's `# Day planner`. Writes are
 * line-level: a task line is inserted after the last task of its section or
 * removed with its subtree; every other line in the note stays byte for
 * byte where it was. A section that does not exist yet is created next to
 * its siblings.
 *
 * Only when a note has no such headings at all does Helm add its own block
 * under the plan heading (`## Plan`). Legacy `%% helm:start/end %%` regions
 * are read and rewritten into that block form.
 */
import type { HelmSettings, TaskLine } from './types';
import { parseDocument, type Document } from './document';
import { columnWidth, fenceStart, fenceStep, isHeading } from './tree';
import { LIST_ITEM_RE, parseTaskLine, serialiseTaskLine } from './taskLine';

export const REGION_START = '%% helm:start %%';
export const REGION_END = '%% helm:end %%';
export type DayPart = 'morning' | 'afternoon' | 'evening' | 'anytime';
export type Section = 'habits' | DayPart;
export const DAY_PARTS: DayPart[] = ['morning', 'afternoon', 'evening', 'anytime'];
export const SECTION_ORDER: Section[] = ['habits', 'morning', 'afternoon', 'evening', 'anytime'];
export const SECTION_HEADINGS: Record<Section, string> = { habits: '### Habits', morning: '### Morning', afternoon: '### Afternoon', evening: '### Evening', anytime: '### Anytime' };
export const PART_LABEL: Record<DayPart, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', anytime: 'Anytime' };

export type RegionSettings = Pick<HelmSettings, 'regionPlacement' | 'regionAnchor' | 'planHeading'>;

export interface SectionInfo {
  /** Heading line, -1 when the section does not exist. */
  line: number;
  level: number;
  /** Body range [start, end) — up to the next heading of the same or a higher level. */
  start: number;
  end: number;
  taskLines: number[];
}

export interface Region {
  /** First and last line index of the region, inclusive. */
  start: number;
  end: number;
  /** True when delimited by the legacy `%% helm %%` markers. */
  legacy: boolean;
  /** True when the sections are the user's own (found outside Helm's plan block). */
  adopted: boolean;
  /** The heading the part sections live under, when there is one. */
  container?: { line: number; level: number };
  sections: Record<Section, SectionInfo>;
  /** Non-section, non-task lines inside a legacy region (kept verbatim). */
  extra: string[];
}

export interface RegionScan {
  region?: Region;
  broken: boolean;
}

const emptySection = (): SectionInfo => ({ line: -1, level: 3, start: -1, end: -1, taskLines: [] });
function emptySections(): Region['sections'] {
  return { habits: emptySection(), morning: emptySection(), afternoon: emptySection(), evening: emptySection(), anytime: emptySection() };
}

function headingMatches(text: string, wanted: string): boolean {
  return text.trim().toLowerCase() === wanted.replace(/^#+\s*/, '').trim().toLowerCase();
}

export function planHeadingLevel(settings: RegionSettings): number {
  const m = /^(#+)/.exec(settings.planHeading.trim());
  return m ? m[1]!.length : 2;
}

export function sectionOf(text: string): Section | undefined {
  const t = text.trim().toLowerCase().replace(/^[a-e][.)]\s*/, '').replace(/[:.]$/, '');
  if (t === 'habits' || t === 'habit') return 'habits';
  if (t === 'morning') return 'morning';
  if (t === 'afternoon' || t === 'midday') return 'afternoon';
  if (t === 'evening' || t === 'tonight' || t === 'night') return 'evening';
  if (t === 'anytime' || t === 'any time' || t === 'today' || t === 'tasks' || t === 'from projects' || t === 'projects' || t === 'project tasks') return 'anytime';
  return undefined;
}

interface HeadingAt { line: number; level: number; text: string }

function headingsOf(lines: string[]): HeadingAt[] {
  const out: HeadingAt[] = [];
  const fence = fenceStart();
  for (let i = 0; i < lines.length; i++) {
    if (fenceStep(fence, lines[i]!)) continue;
    const h = isHeading(lines[i]!);
    if (h) out.push({ line: i, level: h.level, text: h.text });
  }
  return out;
}

function sectionEnd(headings: HeadingAt[], h: HeadingAt, total: number): number {
  for (const x of headings) if (x.line > h.line && x.level <= h.level) return x.line;
  return total;
}

function taskLinesIn(lines: string[], start: number, end: number): number[] {
  const out: number[] = [];
  const fence = fenceStart();
  for (let i = start; i < end; i++) { if (fenceStep(fence, lines[i]!)) continue; if (parseTaskLine(lines[i]!)) out.push(i); }
  return out;
}

/** Find the plan: legacy markers, else the note's own part sections, else the plan heading's block. */
export function findRegion(lines: string[], settings: RegionSettings): RegionScan {
  // 1. Legacy markers.
  let ms = -1;
  let me = -1;
  const fence = fenceStart();
  for (let i = 0; i < lines.length; i++) {
    if (fenceStep(fence, lines[i]!)) continue;
    const t = lines[i]!.trim();
    if (t === REGION_START && ms === -1) ms = i;
    else if (t === REGION_END && ms !== -1) { me = i; break; }
  }
  if (ms !== -1 && me === -1) return { broken: true };
  const headings = headingsOf(lines);
  if (ms !== -1) {
    const region: Region = { start: ms, end: me, legacy: true, adopted: false, sections: emptySections(), extra: [] };
    let current: Section | undefined;
    for (let i = ms + 1; i < me; i++) {
      const line = lines[i]!;
      const h = isHeading(line);
      if (h) {
        const sec = sectionOf(h.text);
        if (sec) { current = sec; if (region.sections[sec].line < 0) region.sections[sec] = { line: i, level: h.level, start: i + 1, end: me, taskLines: [] }; continue; }
        if (headingMatches(h.text, settings.planHeading)) continue;
        current = undefined;
        region.extra.push(line);
        continue;
      }
      if (current && parseTaskLine(line)) { region.sections[current].taskLines.push(i); continue; }
      if (line.trim() !== '') region.extra.push(line);
    }
    return { region, broken: false };
  }

  // 2. Section headings anywhere in the note. Prefer the user's own over Helm's plan block when both exist.
  const planLevel = planHeadingLevel(settings);
  const planHeading = headings.find((h) => h.level === planLevel && headingMatches(h.text, settings.planHeading));
  const planEnd = planHeading ? sectionEnd(headings, planHeading, lines.length) : -1;
  const candidates = headings.filter((h) => sectionOf(h.text) !== undefined);
  const insidePlan = (h: HeadingAt): boolean => planHeading !== undefined && h.line > planHeading.line && h.line < planEnd;
  const own = candidates.filter((h) => !insidePlan(h));
  // The user's own sections first, then Helm's block: the first heading found for each section wins.
  const chosen = [...own, ...candidates.filter((h) => insidePlan(h))];
  if (chosen.length === 0) {
    if (!planHeading) return { broken: false };
    const region: Region = { start: planHeading.line, end: Math.max(planHeading.line, planEnd - 1), legacy: false, adopted: false, container: { line: planHeading.line, level: planLevel }, sections: emptySections(), extra: [] };
    while (region.end > region.start && lines[region.end]!.trim() === '') region.end--;
    return { region, broken: false };
  }
  const region: Region = { start: Infinity, end: -1, legacy: false, adopted: own.length > 0, sections: emptySections(), extra: [] };
  const seen = new Set<Section>();
  for (const h of chosen) {
    const sec = sectionOf(h.text)!;
    if (seen.has(sec)) continue;
    seen.add(sec);
    const end = sectionEnd(headings, h, lines.length);
    region.sections[sec] = { line: h.line, level: h.level, start: h.line + 1, end, taskLines: taskLinesIn(lines, h.line + 1, end) };
    region.start = Math.min(region.start, h.line);
    region.end = Math.max(region.end, end - 1);
  }
  const first = chosen.find((h) => seen.has(sectionOf(h.text)!))!;
  const container = own.length > 0
    ? [...headings].reverse().find((h) => h.line < first.line && h.level < first.level)
    : planHeading;
  if (container) { region.container = { line: container.line, level: container.level }; region.start = Math.min(region.start, container.line); }
  while (region.end > region.start && lines[region.end]!.trim() === '') region.end--;
  return { region, broken: false };
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

/** Read the region's content as TaskLines, ready for editing. */
export function readRegion(lines: string[], region: Region): RegionContent {
  const grab = (sec: Section): TaskLine[] => region.sections[sec].taskLines.map((i) => parseTaskLine(lines[i]!)!);
  return { habits: grab('habits'), morning: grab('morning'), afternoon: grab('afternoon'), evening: grab('evening'), anytime: grab('anytime'), extra: [...region.extra] };
}

/** Render a fresh plan block (used when a note has no sections of its own). */
export function renderRegion(c: RegionContent, settings: RegionSettings): string[] {
  const out = [settings.planHeading.trim()];
  const level = planHeadingLevel(settings) + 1;
  for (const sec of SECTION_ORDER) {
    const items = c[sec];
    if (items.length === 0) continue;
    out.push(`${'#'.repeat(level)} ${SECTION_HEADINGS[sec].replace(/^#+\s*/, '')}`);
    for (const t of items) out.push(serialiseTaskLine({ ...t, raw: { ...t.raw, eol: '' } }));
  }
  if (c.extra.length > 0) out.push(...c.extra);
  return out;
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

/** Where a brand-new plan block goes when the note has no sections. */
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

const render = (l: TaskLine): string => serialiseTaskLine({ ...l, raw: { ...l.raw, eol: '' } });
/** Identity of a line across a read-modify-write: its id, else its original text, else its rendered text. */
const lineKeys = (l: TaskLine): string[] => [l.id ? `id:${l.id}` : '', l.raw.line !== '' ? `raw:${l.raw.line.trim()}` : '', `text:${render(l).trim()}`].filter(Boolean);

/** Lines [start, end) of a list item and its indented children. */
function subtreeEnd(lines: string[], start: number): number {
  const m0 = /^([ \t]*)/.exec(lines[start]!);
  const w = columnWidth(m0 ? m0[1]! : '');
  let end = start + 1;
  while (end < lines.length) {
    const l = lines[end]!;
    if (l.trim() === '') { end++; continue; }
    const m = /^([ \t]*)\S/.exec(l);
    if (!m || !LIST_ITEM_RE.test(l) || columnWidth(m[1]!) <= w) break;
    end++;
  }
  while (end > start + 1 && lines[end - 1]!.trim() === '') end--;
  return end;
}

/**
 * Replace the plan with `next`, editing in place: unchanged lines stay where
 * they are, changed lines are rewritten on the spot, removed lines go with
 * their subtree, new lines join the end of their section, and a missing
 * section is created beside its siblings. Returns the new lines, or
 * undefined for a broken legacy region.
 */
export function writeRegion(content: string, next: RegionContent, settings: RegionSettings): { lines: string[]; eol: string } | undefined {
  const doc = parseDocument(content);
  const scan = findRegion(doc.lines, settings);
  if (scan.broken) return undefined;
  const lines = [...doc.lines];

  // Legacy markers, or no sections at all: (re)write Helm's own block.
  if (!scan.region || scan.region.legacy) {
    const rendered = renderRegion(next, settings);
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

  const region = scan.region;
  const before = readRegion(lines, region);
  // Identity of every existing line: key → { section, line number }.
  const existing = new Map<string, { sec: Section; index: number }>();
  const allIndexes = new Set<number>();
  for (const sec of SECTION_ORDER) region.sections[sec].taskLines.forEach((idx, i) => { allIndexes.add(idx); for (const k of lineKeys(before[sec][i]!)) if (!existing.has(k)) existing.set(k, { sec, index: idx }); });

  const replacements = new Map<number, string>();
  const removals = new Set<number>();
  const inserts: Record<Section, string[]> = { habits: [], morning: [], afternoon: [], evening: [], anytime: [] };
  const keptIndexes = new Set<number>();
  for (const sec of SECTION_ORDER) {
    for (const l of next[sec]) {
      const prev = lineKeys(l).map((k) => existing.get(k)).find((p) => p !== undefined && !keptIndexes.has(p.index));
      if (prev && prev.sec === sec) {
        keptIndexes.add(prev.index);
        const text = render(l);
        if (text !== lines[prev.index]) replacements.set(prev.index, l.raw.indent === '' && /^[ \t]+/.test(lines[prev.index]!) ? lines[prev.index]!.match(/^[ \t]*/)![0] + text : text);
      } else if (prev) {
        keptIndexes.add(prev.index);
        removals.add(prev.index);
        inserts[sec].push(render(l));
      } else inserts[sec].push(render(l));
    }
  }
  for (const idx of allIndexes) if (!keptIndexes.has(idx)) removals.add(idx);

  for (const [i, text] of replacements) lines[i] = text;
  for (const i of [...removals].sort((a, b) => b - a)) lines.splice(i, subtreeEnd(lines, i) - i);

  // Insert per section, re-scanning after each change.
  for (const sec of SECTION_ORDER) {
    if (inserts[sec].length === 0) continue;
    const r = findRegion(lines, settings).region;
    const info = r?.sections[sec];
    if (info && info.line >= 0) {
      const at = info.taskLines.length > 0 ? subtreeEnd(lines, info.taskLines[info.taskLines.length - 1]!) : firstContentLine(lines, info.start, info.end);
      lines.splice(at, 0, ...inserts[sec]);
    } else {
      const at = newSectionPoint(lines, sec, r ?? region, settings);
      const level = at.level;
      const heading = `${'#'.repeat(level)} ${SECTION_HEADINGS[sec].replace(/^#+\s*/, '')}`;
      // The user's own layout gets breathing room; Helm's own block stays compact.
      const pad = region.adopted;
      const before = pad && at.index > 0 && lines[at.index - 1]!.trim() !== '' ? [''] : [];
      const after = pad && at.index < lines.length && lines[at.index]!.trim() !== '' ? [''] : [];
      lines.splice(at.index, 0, ...before, heading, ...inserts[sec], ...after);
    }
  }

  // Helm's own block: drop sub-sections that are now empty, keep it compact, one blank line after it.
  if (!region.adopted) {
    let r = findRegion(lines, settings).region;
    if (r) {
      const empties = SECTION_ORDER.map((sec) => r!.sections[sec]).filter((info) => info.line >= 0 && info.taskLines.length === 0 && lines.slice(info.start, info.end).every((l) => l.trim() === '')).map((info) => info.line);
      for (const i of empties.sort((a, b) => b - a)) lines.splice(i, 1);
      r = findRegion(lines, settings).region;
      if (r) {
        const top = r.container ? r.container.line : r.start;
        let end = r.end;
        for (let i = end; i > top; i--) if (lines[i]!.trim() === '') { lines.splice(i, 1); end--; }
        if (end + 1 < lines.length && lines[end + 1]!.trim() !== '') lines.splice(end + 1, 0, '');
      }
    }
  }
  return { lines, eol: doc.eol };
}

/** First line after a heading where content can go: after the heading's blank line if it has one. */
function firstContentLine(lines: string[], start: number, end: number): number {
  return start < end && lines[start]!.trim() === '' && start + 1 <= end ? start + 1 : start;
}

/** Where to create a missing section: habits first among the parts, anytime last, parts in order. */
function newSectionPoint(lines: string[], sec: Section, region: Region, settings: RegionSettings): { index: number; level: number } {
  const present = SECTION_ORDER.filter((s) => region.sections[s].line >= 0);
  const level = present.length > 0 ? region.sections[present[0]!].level : region.container ? region.container.level + 1 : planHeadingLevel(settings) + 1;
  const order = SECTION_ORDER.indexOf(sec);
  const after = present.filter((s) => SECTION_ORDER.indexOf(s) < order).pop();
  const beforeSec = present.find((s) => SECTION_ORDER.indexOf(s) > order);
  if (after) { const e = region.sections[after].end; let i = e; while (i > region.sections[after].start && lines[i - 1]!.trim() === '') i--; return { index: i, level }; }
  if (beforeSec) return { index: region.sections[beforeSec].line, level };
  if (region.container) { const i = region.container.line + 1; return { index: i < lines.length && lines[i]!.trim() === '' ? i + 1 : i, level }; }
  return { index: region.end + 1, level };
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
