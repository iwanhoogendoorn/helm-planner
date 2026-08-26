/**
 * Project note = frontmatter + `## Phase: Name` headings (each owning the
 * tasks beneath it) + any other tasks (loose, usually under `## Tasks`).
 *
 * Phase status is derived from its tasks. A phase heading may carry a target
 * date: `## Phase: Outline 📅 2026-09-15`.
 */
import type { Diagnostic, Phase, Project, ProjectPriority, ProjectStatus } from './types';
import { parseDocument, type DocHeading, type Document } from './document';
import { list, scalar } from './frontmatter';
import { slugify } from './ids';
import { isIsoDate } from './dates';
import { parsePeriod } from './periods';

export const PHASE_HEADING_RE = /^(?:phase|fase|stage|milestone)\s*[:\-–—]\s*(.+?)\s*$/i;
export const PHASE_DATE_RE = /\s*📅\s*(\d{4}-\d{2}-\d{2})\s*$/;

export const PROJECT_STATUSES: ProjectStatus[] = ['idea', 'planned', 'active', 'on-hold', 'done', 'cancelled', 'archived'];
export const PROJECT_PRIORITIES: ProjectPriority[] = ['low', 'normal', 'medium', 'high', 'urgent', 'critical'];

export function normaliseProjectStatus(v: string | undefined): ProjectStatus | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().trim();
  const map: Record<string, ProjectStatus> = {
    idea: 'idea', someday: 'idea', maybe: 'idea', backlog: 'planned', planned: 'planned', planning: 'planned', todo: 'planned',
    active: 'active', 'in-progress': 'active', 'in progress': 'active', doing: 'active', ongoing: 'active',
    'on-hold': 'on-hold', 'on hold': 'on-hold', onhold: 'on-hold', paused: 'on-hold', waiting: 'on-hold', blocked: 'on-hold',
    done: 'done', completed: 'done', complete: 'done', finished: 'done',
    cancelled: 'cancelled', canceled: 'cancelled', dropped: 'cancelled', archived: 'archived', archive: 'archived',
  };
  return map[s];
}

export function normaliseProjectPriority(v: string | undefined): ProjectPriority | undefined {
  if (!v) return undefined;
  const s = v.toLowerCase().trim();
  const map: Record<string, ProjectPriority> = {
    low: 'low', lowest: 'low', normal: 'normal', medium: 'medium', med: 'medium', high: 'high', urgent: 'urgent', highest: 'urgent', critical: 'critical',
  };
  return map[s];
}

export const PROJECT_PRIORITY_RANK: Record<ProjectPriority, number> = { critical: 0, urgent: 1, high: 2, medium: 3, normal: 4, low: 5 };

export interface ParsedProject {
  project: Project;
  doc: Document;
  /** doc.tasks index → phase id or undefined (loose). */
  phaseOfTask: Map<number, string | undefined>;
  diagnostics: Diagnostic[];
}

/** Is this note a project? Frontmatter `type: project` (case-insensitive, list or scalar). */
export function isProjectNote(doc: Document): boolean {
  const t = scalar(doc.frontmatter.values['type'] ?? doc.frontmatter.values['Type']);
  return t !== undefined && /^project(\s*note)?$/i.test(t);
}

export function parseProject(path: string, content: string, opts: { fallbackId?: string; mtime?: number } = {}): ParsedProject {
  const doc = parseDocument(content);
  const diagnostics: Diagnostic[] = [];
  const fm = doc.frontmatter.values;
  const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const id = scalar(fm['id']) ?? opts.fallbackId ?? `path:${path}`;
  if (!scalar(fm['id'])) diagnostics.push({ severity: 'info', code: 'HELM-P01', message: 'Project has no id in frontmatter; a derived one is used until the plugin assigns one.', path });
  const statusRaw = scalar(fm['status']);
  const status = normaliseProjectStatus(statusRaw) ?? 'active';
  if (statusRaw && !normaliseProjectStatus(statusRaw)) diagnostics.push({ severity: 'warning', code: 'HELM-P02', message: `Unknown project status "${statusRaw}" — treated as active.`, path });
  const prioRaw = scalar(fm['priority']);
  const priority = normaliseProjectPriority(prioRaw) ?? 'normal';
  const start = firstDate(fm, ['start', 'start_date', 'started']);
  const due = firstDate(fm, ['due', 'due_date', 'deadline', 'target_date', 'target']);
  const parentRef = scalar(fm['parent']);
  const project: Project = {
    id,
    title: scalar(fm['title']) ?? base,
    path,
    folder,
    status,
    priority,
    childIds: [],
    tags: list(fm['tags']).map((t) => t.replace(/^#/, '')).filter((t) => t !== 'project'),
    phases: [],
    looseTaskKeys: [],
    frontmatterEndLine: doc.frontmatter.endLine,
    folderNote: folder !== '' && folder.slice(folder.lastIndexOf('/') + 1) === base,
  };
  const periodRaw = scalar(fm['period']) ?? scalar(fm['horizon']) ?? scalar(fm['quarter']) ?? scalar(fm['month']) ?? scalar(fm['year']);
  const period = parsePeriod(periodRaw);
  if (period) project.period = period.key;
  else if (periodRaw) diagnostics.push({ severity: 'warning', code: 'HELM-P07', message: `Unknown period "${periodRaw}" — use 2026, 2026-Q3 or 2026-08.`, path });
  const goalRef = scalar(fm['goal']) ?? scalar(fm['goals']);
  if (goalRef) project.goalRef = goalRef.replace(/^\[\[|\]\]$/g, '').split('|')[0]!.trim();
  const area = scalar(fm['area']);
  if (area) project.area = area;
  if (start) project.start = start;
  if (due) project.due = due;
  if (parentRef) project.parentRef = parentRef.replace(/^\[\[|\]\]$/g, '').split('|')[0]!;
  if (opts.mtime !== undefined) project.mtime = opts.mtime;

  // Phases.
  const phaseHeadings: { h: DocHeading; title: string; due?: string }[] = [];
  const slugs = new Map<string, number>();
  for (const h of doc.headings) {
    const m = PHASE_HEADING_RE.exec(h.text);
    if (!m) {
      if (/^tasks$/i.test(h.text.trim()) && project.tasksHeadingLine === undefined) project.tasksHeadingLine = h.line;
      continue;
    }
    let title = m[1]!;
    let due: string | undefined;
    const dm = PHASE_DATE_RE.exec(title);
    if (dm && isIsoDate(dm[1]!)) { due = dm[1]!; title = title.slice(0, dm.index).trim(); }
    phaseHeadings.push({ h, title, ...(due ? { due } : {}) });
  }
  phaseHeadings.forEach((ph, order) => {
    let slug = slugify(ph.title);
    const n = (slugs.get(slug) ?? 0) + 1;
    slugs.set(slug, n);
    if (n > 1) { slug = `${slug}-${n}`; diagnostics.push({ severity: 'warning', code: 'HELM-P03', message: `Duplicate phase title "${ph.title}".`, path, line: ph.h.line }); }
    // A phase owns lines until the next heading of the same or higher level.
    let end = doc.lines.length;
    for (const h of doc.headings) if (h.line > ph.h.line && h.level <= ph.h.level) { end = h.line; break; }
    const phase: Phase = {
      id: `${id}#${slug}`, projectId: id, title: ph.title, slug, order,
      headingLine: ph.h.line, startLine: ph.h.line + 1, endLine: end, taskKeys: [],
    };
    if (ph.due) phase.due = ph.due;
    project.phases.push(phase);
  });

  const phaseOfTask = new Map<number, string | undefined>();
  doc.tasks.forEach((dt, i) => {
    const ph = project.phases.find((p) => dt.line > p.headingLine && dt.line < p.endLine);
    phaseOfTask.set(i, ph?.id);
  });
  return { project, doc, phaseOfTask, diagnostics };
}

function firstDate(fm: Record<string, string | string[] | null>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = scalar(fm[k]);
    if (v && isIsoDate(v.slice(0, 10))) return v.slice(0, 10);
  }
  return undefined;
}

/** Render a new project note. */
export function renderProjectNote(p: {
  id: string; title: string; status: ProjectStatus; priority: ProjectPriority; area?: string; parent?: string; period?: string; goal?: string;
  start?: string; due?: string; tags?: string[]; today: string;
  phases?: { title: string; due?: string; tasks?: string[] }[]; tasks?: string[]; objective?: string;
}): string {
  const fm: string[] = ['---', `title: ${quote(p.title)}`, 'type: project', `id: ${p.id}`, `status: ${p.status}`, `priority: ${p.priority}`];
  if (p.area) fm.push(`area: ${quote(p.area)}`);
  if (p.parent) fm.push(`parent: ${quote(p.parent)}`);
  fm.push(`period: ${p.period ?? ''}`, `goal: ${p.goal ? quote(p.goal) : ''}`);
  fm.push(`start_date: ${p.start ?? ''}`, `due_date: ${p.due ?? ''}`, `creation_date: ${p.today}`);
  fm.push('tags:', '  - project', ...(p.tags ?? []).map((t) => `  - ${t}`));
  fm.push('---', '');
  const body: string[] = [`# ${p.title}`, '', '## Objective', '', p.objective ?? 'This project is successful when…', ''];
  for (const ph of p.phases ?? []) {
    body.push(`## Phase: ${ph.title}${ph.due ? ` 📅 ${ph.due}` : ''}`, '');
    for (const t of ph.tasks ?? []) body.push(`- [ ] ${t}`);
    body.push('');
  }
  body.push('## Tasks', '');
  for (const t of p.tasks ?? []) body.push(`- [ ] ${t}`);
  body.push('', '## Log', '');
  return [...fm, ...body].join('\n');
}

function quote(s: string): string {
  return /[:#\[\]{}&*!|>'"%@`,?]/.test(s) || s.trim() !== s ? `"${s.replace(/"/g, '\\"')}"` : s;
}
