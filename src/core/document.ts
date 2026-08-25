/** Generic note scan: frontmatter, headings, task lines with nesting. */
import type { TaskLine } from './types';
import { parseFrontmatter, splitLines, type Frontmatter } from './frontmatter';
import { parseTaskLine } from './taskLine';
import { fenceStart, fenceStep, isHeading, nest } from './tree';

export interface DocHeading { line: number; level: number; text: string }

export interface DocTask {
  line: number;
  task: TaskLine;
  depth: number;
  parentLine?: number;
  /** Nearest heading above, any level. */
  heading?: DocHeading;
}

export interface Document {
  lines: string[];
  eol: string;
  frontmatter: Frontmatter;
  headings: DocHeading[];
  tasks: DocTask[];
  /** Line indices inside code fences (inert). */
  fenced: Set<number>;
}

export function parseDocument(content: string): Document {
  const { lines, eol } = splitLines(content);
  const frontmatter = parseFrontmatter(lines, eol);
  const headings: DocHeading[] = [];
  const fenced = new Set<number>();
  const fence = fenceStart();
  const parsed = new Map<number, TaskLine>();
  for (let i = frontmatter.endLine; i < lines.length; i++) {
    const line = lines[i]!;
    if (fenceStep(fence, line)) { fenced.add(i); continue; }
    const h = isHeading(line);
    if (h) { headings.push({ line: i, level: h.level, text: h.text }); continue; }
    const t = parseTaskLine(line);
    if (t) parsed.set(i, t);
  }
  const nested = nest(lines, (i) => parsed.has(i), (i) => parsed.get(i)!.raw.indent);
  const tasks: DocTask[] = [];
  let hIdx = -1;
  for (const [i, task] of [...parsed.entries()].sort((a, b) => a[0] - b[0])) {
    while (hIdx + 1 < headings.length && headings[hIdx + 1]!.line < i) hIdx++;
    const n = nested.get(i);
    const dt: DocTask = { line: i, task, depth: n?.depth ?? 0 };
    if (n?.parent !== undefined) dt.parentLine = n.parent;
    if (hIdx >= 0) dt.heading = headings[hIdx]!;
    tasks.push(dt);
  }
  return { lines, eol, frontmatter, headings, tasks, fenced };
}

export function joinLines(lines: string[], eol: string): string {
  return lines.join(eol);
}

/** The line range [start, end) of a heading's section (until next heading of same or higher level). */
export function sectionRange(doc: Document, heading: DocHeading): { start: number; end: number } {
  const start = heading.line + 1;
  let end = doc.lines.length;
  for (const h of doc.headings) {
    if (h.line > heading.line && h.level <= heading.level) { end = h.line; break; }
  }
  return { start, end };
}

/** Where to insert a new line at the end of a section, before trailing blank lines. */
export function sectionInsertPoint(doc: Document, heading: DocHeading): number {
  const { start, end } = sectionRange(doc, heading);
  let p = end;
  while (p > start && doc.lines[p - 1]!.trim() === '') p--;
  // An empty section keeps one blank line under its heading.
  if (p === start && start < end && doc.lines[start]!.trim() === '') p = start + 1;
  return p;
}
