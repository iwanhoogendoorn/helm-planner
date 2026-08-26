/**
 * The index: a Snapshot built from markdown, kept fresh per file.
 * Never a source of truth — delete it and rebuild at any time.
 */
import type { DailyNoteInfo, Diagnostic, Goal, Habit, HabitCompletion, HelmSettings, IsoDate, Project, Snapshot, Task, TaskOrigin } from '../core/types';
import { DEFAULT_PERIOD_FORMATS, formatPeriod, parsePeriodFromPath, type Period, type PeriodKind } from '../core/periods';
import { sectionRange } from '../core/document';
import { parseDocument } from '../core/document';
import { isProjectNote, parseProject } from '../core/project';
import { parseHabit } from '../core/habit';
import { findRegion, partOfLine, type Section } from '../core/dailyNote';
import { derivedKey } from '../core/ids';
import { formatDate, parseDateFromPath } from '../core/dates';
import { baseName, folderOf, isUnder, type VaultAdapter } from './vault';

export const DAILY_FALLBACK = { folder: 'Daily Notes', format: 'YYYY-MM-DD' };

export type FileKind = 'project' | 'habit' | 'daily' | 'inbox' | 'note' | 'periodic';

export type PeriodicConfig = Record<PeriodKind, { folder: string; format: string }>;
export const PERIODIC_FALLBACK: PeriodicConfig = { year: { folder: 'Yearly Notes', format: 'YYYY' }, quarter: { folder: 'Quarterly Notes', format: 'YYYY-[Q]Q' }, month: { folder: 'Monthly Notes', format: 'YYYY-MM' }, week: { folder: 'Weekly Notes', format: 'gggg-[W]ww' } };

interface FileEntry {
  path: string;
  kind: FileKind;
  tasks: Task[];
  project?: Project;
  habit?: Habit;
  date?: IsoDate;
  period?: Period;
  hasRegion: boolean;
  completions: HabitCompletion[];
  diagnostics: Diagnostic[];
}

export interface IndexOptions {
  settings: () => HelmSettings;
  today: () => IsoDate;
  /** Resolved daily-note config (folder/format), from Obsidian when the settings are empty. */
  dailyConfig: () => { folder: string; format: string };
  /** Resolved periodic-note config, from the Periodic Notes plugin when the settings are empty. */
  periodicConfig?: () => PeriodicConfig;
}

export class HelmIndex {
  snapshot: Snapshot = emptySnapshot();
  private files = new Map<string, FileEntry>();
  private listeners = new Set<() => void>();
  building = false;
  ready = false;

  constructor(private vault: VaultAdapter, private opts: IndexOptions) {}

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  get settings(): HelmSettings { return this.opts.settings(); }
  get today(): IsoDate { return this.opts.today(); }

  dailyFolder(): string {
    const s = this.settings.dailyNoteFolder.trim();
    return (s !== '' ? s : this.opts.dailyConfig().folder).replace(/\/+$/, '');
  }

  dailyFormat(): string {
    const s = this.settings.dailyNoteFormat.trim();
    return s !== '' ? s : this.opts.dailyConfig().format;
  }

  dailyPath(date: IsoDate): string {
    const folder = this.dailyFolder();
    return `${folder ? folder + '/' : ''}${formatDate(date, this.dailyFormat())}.md`;
  }

  dateOfPath(path: string): IsoDate | undefined {
    if (!path.endsWith('.md') || !isUnder(path, this.dailyFolder())) return undefined;
    return parseDateFromPath(path.replace(/\.md$/, ''), this.dailyFormat());
  }

  /** Folder + format for yearly / quarterly / monthly notes: settings override, else the Periodic Notes plugin, else a fallback. */
  periodicConfig(kind: PeriodKind): { folder: string; format: string } {
    const s = this.settings;
    const ov = kind === 'year' ? { folder: s.yearlyFolder, format: s.yearlyFormat } : kind === 'quarter' ? { folder: s.quarterlyFolder, format: s.quarterlyFormat } : kind === 'month' ? { folder: s.monthlyFolder, format: s.monthlyFormat } : { folder: s.weeklyFolder, format: s.weeklyFormat };
    const ext = this.opts.periodicConfig?.()[kind];
    const folder = (ov.folder.trim() || ext?.folder || PERIODIC_FALLBACK[kind].folder).replace(/\/+$/, '');
    const format = ov.format.trim() || ext?.format || DEFAULT_PERIOD_FORMATS[kind];
    return { folder, format };
  }

  periodicPath(p: Period): string {
    const c = this.periodicConfig(p.kind);
    return `${c.folder ? c.folder + '/' : ''}${formatPeriod(p, c.format)}.md`;
  }

  periodOfPath(path: string): Period | undefined {
    if (!path.endsWith('.md')) return undefined;
    for (const kind of ['week', 'month', 'quarter', 'year'] as PeriodKind[]) {
      const c = this.periodicConfig(kind);
      if (!isUnder(path, c.folder)) continue;
      const p = parsePeriodFromPath(path.replace(/\.md$/, ''), c.format, kind);
      if (p) return p;
    }
    return undefined;
  }

  inScope(path: string): boolean {
    if (!path.endsWith('.md')) return false;
    const s = this.settings;
    if (s.excludePaths.some((x) => x.trim() !== '' && isUnder(path, x.trim()))) return false;
    if (path === s.inboxNote) return true;
    if (isUnder(path, s.projectsFolder) || isUnder(path, s.habitsFolder)) return true;
    if (this.dateOfPath(path) !== undefined) return true;
    if (this.periodOfPath(path) !== undefined) return true;
    return s.extraFolders.some((f) => f.trim() !== '' && isUnder(path, f.trim()));
  }

  async rebuild(): Promise<void> {
    this.building = true;
    try {
      const paths = (await this.vault.list()).filter((p) => this.inScope(p));
      const next = new Map<string, FileEntry>();
      const contents = await Promise.all(paths.map(async (p) => [p, await this.vault.read(p).catch(() => undefined)] as const));
      for (const [p, c] of contents) if (c !== undefined) next.set(p, this.parseFile(p, c));
      this.files = next;
      this.link();
    } finally {
      this.building = false;
      this.ready = true;
    }
    this.emit();
  }

  /** Re-parse one file (or drop it when content is undefined). Returns false when nothing was in scope. */
  update(path: string, content?: string): boolean {
    const wasKnown = this.files.has(path);
    if (!this.inScope(path) || content === undefined) {
      if (!wasKnown) return false;
      this.files.delete(path);
    } else {
      this.files.set(path, this.parseFile(path, content));
    }
    this.link();
    this.emit();
    return true;
  }

  private parseFile(path: string, content: string): FileEntry {
    const s = this.settings;
    const entry: FileEntry = { path, kind: 'note', tasks: [], hasRegion: false, completions: [], diagnostics: [] };
    const mtime = this.vault.mtime(path);
    const date = this.dateOfPath(path);

    if (isUnder(path, s.habitsFolder)) {
      const h = parseHabit(path, content);
      if (h) { entry.kind = 'habit'; entry.habit = h; return entry; }
    }
    const doc = parseDocument(content);
    const seen = new Map<string, number>();
    const derived = (text: string): string => { const n = seen.get(text.trim()) ?? 0; seen.set(text.trim(), n + 1); return derivedKey(path, n, text); };

    const period = this.periodOfPath(path);
    if (period !== undefined && !isProjectNote(doc)) {
      entry.kind = 'periodic';
      entry.period = period;
      const want = s.goalsHeading.replace(/^#+\s*/, '').trim().toLowerCase();
      const heading = doc.headings.find((h) => h.text.trim().toLowerCase() === want) ?? doc.headings.find((h) => /^(goals?|objectives?|okrs?)$/i.test(h.text.trim()));
      if (heading) {
        const { start, end } = sectionRange(doc, heading);
        for (const dt of doc.tasks) {
          if (dt.line < start || dt.line >= end || dt.depth > 0) continue;
          const key = dt.task.id ?? derived(dt.task.text);
          entry.tasks.push({ ...dt.task, key, path, line: dt.line, depth: 0, childKeys: [], origin: 'goal', periodKey: period.key });
        }
      }
      return entry;
    }

    if (isProjectNote(doc)) {
      const parsed = parseProject(path, content, { ...(mtime !== undefined ? { mtime } : {}) });
      entry.kind = 'project';
      entry.project = parsed.project;
      entry.diagnostics.push(...parsed.diagnostics);
      const keyOfLine = new Map<number, string>();
      parsed.doc.tasks.forEach((dt, i) => {
        const key = dt.task.id ?? derived(dt.task.text);
        keyOfLine.set(dt.line, key);
        const phaseId = parsed.phaseOfTask.get(i);
        const phase = phaseId ? parsed.project.phases.find((p) => p.id === phaseId) : undefined;
        const task: Task = {
          ...dt.task, key, path, line: dt.line, depth: dt.depth, childKeys: [], origin: 'project',
          projectId: parsed.project.id, projectTitle: parsed.project.title,
        };
        if (phase) { task.phaseId = phase.id; task.phaseTitle = phase.title; phase.taskKeys.push(key); }
        else parsed.project.looseTaskKeys.push(key);
        if (dt.parentLine !== undefined) task.parentKey = keyOfLine.get(dt.parentLine);
        entry.tasks.push(task);
      });
      return entry;
    }

    const origin: TaskOrigin = date !== undefined ? 'daily' : path === s.inboxNote ? 'inbox' : 'note';
    entry.kind = date !== undefined ? 'daily' : origin === 'inbox' ? 'inbox' : 'note';
    if (date !== undefined) entry.date = date;
    const scan = date !== undefined ? findRegion(doc.lines, s) : { broken: false };
    if (scan.broken) entry.diagnostics.push({ severity: 'error', code: 'HELM-D01', message: 'Helm region has a start marker without an end marker; the note is read-only until fixed.', path });
    entry.hasRegion = scan.region !== undefined;
    const sectionOfLine = new Map<number, Section>();
    if (scan.region) for (const sec of ['habits', 'morning', 'afternoon', 'evening', 'anytime'] as Section[]) for (const l of scan.region.sections[sec].taskLines) sectionOfLine.set(l, sec);

    const keyOfLine = new Map<number, string>();
    for (const dt of doc.tasks) {
      const sec = sectionOfLine.get(dt.line);
      if (sec === 'habits' && date !== undefined && dt.task.id) {
        entry.completions.push({ habitId: dt.task.id, date, path, line: dt.line, state: dt.task.status === 'done' ? 'done' : dt.task.status === 'cancelled' ? 'skipped' : 'missed' });
        continue;
      }
      if (dt.task.text.trim() === '' && dt.task.unknown.length === 0) continue; // empty planner slot
      const isMirror = date !== undefined && dt.task.mirrorLink !== undefined;
      let key = dt.task.id ?? derived(dt.task.text);
      if (isMirror) key = `${key}@${date}`;
      keyOfLine.set(dt.line, key);
      const task: Task = { ...dt.task, key, path, line: dt.line, depth: dt.depth, childKeys: [], origin: isMirror ? 'daily-mirror' : origin };
      if (date !== undefined) { task.noteDate = date; task.section = sec ?? 'outside'; task.part = partOfLine(sec, dt.task.time, s); }
      if (isMirror && dt.task.id) task.mirrorOf = dt.task.id;
      if (dt.parentLine !== undefined) task.parentKey = keyOfLine.get(dt.parentLine);
      entry.tasks.push(task);
    }
    return entry;
  }

  /** Cross-file relations: children, parents, mirrors, project tree. */
  private link(): void {
    const tasks = new Map<string, Task>();
    const projects = new Map<string, Project>();
    const habits = new Map<string, Habit>();
    const goals = new Map<string, Goal>();
    const completions: HabitCompletion[] = [];
    const dailyNotes = new Map<IsoDate, DailyNoteInfo>();
    const diagnostics: Diagnostic[] = [];
    const tasksByPath = new Map<string, string[]>();

    const files = [...this.files.values()].sort((a, b) => a.path.localeCompare(b.path));
    for (const f of files) {
      diagnostics.push(...f.diagnostics);
      completions.push(...f.completions);
      const keys: string[] = [];
      for (const t of f.tasks) {
        const copy: Task = { ...t, childKeys: [] };
        if (tasks.has(copy.key)) {
          diagnostics.push({ severity: 'warning', code: 'HELM-T01', message: `Duplicate task id ${copy.key} (also in ${tasks.get(copy.key)!.path})`, path: f.path, line: t.line });
          copy.key = `${copy.key}~${keys.length}`;
        }
        tasks.set(copy.key, copy);
        keys.push(copy.key);
      }
      tasksByPath.set(f.path, keys);
      if (f.kind === 'project' && f.project) {
        const p = f.project;
        const fresh: Project = { ...p, childIds: [], phases: p.phases.map((ph) => ({ ...ph, taskKeys: [...ph.taskKeys] })), looseTaskKeys: [...p.looseTaskKeys] };
        delete fresh.parentId;
        if (projects.has(fresh.id)) diagnostics.push({ severity: 'warning', code: 'HELM-P04', message: `Duplicate project id ${fresh.id} (also ${projects.get(fresh.id)!.path})`, path: f.path });
        projects.set(fresh.id, fresh);
      } else if (f.kind === 'habit' && f.habit) {
        habits.set(f.habit.id, f.habit);
      } else if (f.kind === 'daily' && f.date) {
        dailyNotes.set(f.date, { path: f.path, date: f.date, hasRegion: f.hasRegion, regionBroken: f.diagnostics.some((d) => d.code === 'HELM-D01') });
      }
    }

    for (const t of tasks.values()) {
      if (t.origin === 'goal' && t.periodKey) goals.set(t.key, { id: t.id ?? t.key, key: t.key, text: t.text, periodKey: t.periodKey, status: t.status, path: t.path, line: t.line, projectIds: [] });
    }
    for (const t of tasks.values()) {
      if (t.parentKey) tasks.get(t.parentKey)?.childKeys.push(t.key);
      if (t.origin === 'daily-mirror' && t.mirrorOf && !tasks.has(t.mirrorOf)) {
        diagnostics.push({ severity: 'warning', code: 'HELM-M01', message: `Mirror line points at unknown task ${t.mirrorOf}`, path: t.path, line: t.line });
      }
    }

    // Project tree.
    const byTitle = new Map<string, Project[]>();
    for (const p of projects.values()) {
      const k = p.title.toLowerCase();
      byTitle.set(k, [...(byTitle.get(k) ?? []), p]);
    }
    const byPath = new Map([...projects.values()].map((p) => [p.path, p]));
    // Only a folder note (`<Folder>/<Folder>.md`) can be an umbrella; a loose note in the projects folder cannot.
    const sortedByFolderDepth = [...projects.values()].filter((p) => p.folderNote).sort((a, b) => b.folder.length - a.folder.length);
    // Goals ↔ projects.
    const goalByText = new Map<string, Goal>();
    for (const g of goals.values()) goalByText.set(g.text.trim().toLowerCase(), g);
    const goalById = new Map<string, Goal>();
    for (const g of goals.values()) goalById.set(g.id, g);
    for (const p of projects.values()) {
      if (!p.goalRef) continue;
      const g = goalById.get(p.goalRef) ?? goalByText.get(p.goalRef.trim().toLowerCase());
      if (g) { p.goalId = g.key; g.projectIds.push(p.id); }
      else diagnostics.push({ severity: 'info', code: 'HELM-G01', message: `goal "${p.goalRef}" not found in any yearly/quarterly/monthly note`, path: p.path });
    }
    for (const p of projects.values()) {
      let parent: Project | undefined;
      if (p.parentRef) {
        const ref = p.parentRef.replace(/\.md$/, '');
        const cands = byTitle.get(ref.toLowerCase()) ?? byTitle.get(baseName(ref).toLowerCase()) ?? [];
        if (cands.length === 1) parent = cands[0];
        else if (cands.length > 1) diagnostics.push({ severity: 'warning', code: 'HELM-P05', message: `parent "${p.parentRef}" matches ${cands.length} projects`, path: p.path });
        else parent = byPath.get(ref) ?? byPath.get(`${ref}.md`);
        if (!parent) diagnostics.push({ severity: 'info', code: 'HELM-P06', message: `parent "${p.parentRef}" not found`, path: p.path });
      }
      if (!parent && p.folder !== '') {
        for (const q of sortedByFolderDepth) {
          if (q.id !== p.id && q.folder !== '' && p.folder !== q.folder && isUnder(p.folder, q.folder)) { parent = q; break; }
        }
      }
      if (parent && parent.id !== p.id) {
        let cur: Project | undefined = parent;
        let cyc = false;
        const seen = new Set<string>([p.id]);
        while (cur) { if (seen.has(cur.id)) { cyc = true; break; } seen.add(cur.id); cur = cur.parentId ? projects.get(cur.parentId) : undefined; }
        if (!cyc) { p.parentId = parent.id; parent.childIds.push(p.id); }
      }
    }
    for (const p of projects.values()) p.childIds.sort((a, b) => projects.get(a)!.title.localeCompare(projects.get(b)!.title));

    this.snapshot = { builtAt: Date.now(), tasks, projects, habits, goals, completions, dailyNotes, diagnostics, tasksByPath };
  }

  /* ── Queries ─────────────────────────────────────────────────────────── */

  task(key: string): Task | undefined { return this.snapshot.tasks.get(key); }
  project(id: string): Project | undefined { return this.snapshot.projects.get(id); }
  projectByTitle(title: string): Project | undefined {
    const t = title.trim().toLowerCase().replace(/^\[\[|\]\]$/g, '').split('|')[0]!;
    for (const p of this.snapshot.projects.values()) if (p.title.toLowerCase() === t || baseName(p.path).toLowerCase() === t || p.path.toLowerCase() === t || p.path.toLowerCase() === `${t}.md`) return p;
    return undefined;
  }
  allTasks(): Task[] { return [...this.snapshot.tasks.values()]; }
  allProjects(): Project[] { return [...this.snapshot.projects.values()]; }
  allHabits(): Habit[] { return [...this.snapshot.habits.values()]; }
  allGoals(): Goal[] { return [...this.snapshot.goals.values()]; }
  goal(key: string): Goal | undefined { return this.snapshot.goals.get(key); }
  tasksInFile(path: string): Task[] { return (this.snapshot.tasksByPath.get(path) ?? []).map((k) => this.snapshot.tasks.get(k)!).filter(Boolean); }
  mirrorsOf(sourceKey: string): Task[] { return this.allTasks().filter((t) => t.origin === 'daily-mirror' && t.mirrorOf === sourceKey); }
  fileKind(path: string): FileKind | undefined { return this.files.get(path)?.kind; }
  projectFolderOf(p: Project): string { return p.folder || folderOf(p.path); }
  hasFile(path: string): boolean { return this.files.has(path); }
}

export function emptySnapshot(): Snapshot {
  return { builtAt: 0, tasks: new Map(), projects: new Map(), habits: new Map(), goals: new Map(), completions: [], dailyNotes: new Map(), diagnostics: [], tasksByPath: new Map() };
}
