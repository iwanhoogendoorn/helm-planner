/**
 * The index: a Snapshot built from markdown, kept fresh per file.
 * Never a source of truth — delete it and rebuild at any time.
 */
import type { DrawingTarget } from '../core/types';
import type { DailyNoteInfo, Diagnostic, Goal, Habit, HabitCompletion, HelmSettings, IsoDate, Project, Snapshot, Task, TaskOrigin } from '../core/types';
import { DEFAULT_PERIOD_FORMATS, formatPeriod, parsePeriodFromPath, type Period, type PeriodKind } from '../core/periods';
import { sectionRange } from '../core/document';
import { parseDocument } from '../core/document';
import { isProjectNote, parseProject } from '../core/project';
import { parseHabit } from '../core/habit';
import { findRegion, partOfLine, type Section } from '../core/dailyNote';
import { derivedKey, hash } from '../core/ids';
import { formatDate, parseDateFromPath } from '../core/dates';
import { isDrawingPath, parseDrawing, type Drawing } from '../core/drawing';
import { contentHasHelmKeys, hasHelmKeys, notesSectionLinks, noteTitle, parseNoteRef, wikilinksIn, type NoteRef } from '../core/noteRef';
import { parseDaybook, type DaybookEntry } from '../core/daybook';
import { baseName, folderOf, isUnder, type VaultAdapter } from './vault';

export const DAILY_FALLBACK = { folder: 'Daily Notes', format: 'YYYY-MM-DD' };

export type FileKind = 'project' | 'habit' | 'daily' | 'inbox' | 'note' | 'periodic' | 'drawing';

export type PeriodicConfig = Record<PeriodKind, { folder: string; format: string }>;
export const PERIODIC_FALLBACK: PeriodicConfig = { year: { folder: 'Yearly Notes', format: 'YYYY' }, quarter: { folder: 'Quarterly Notes', format: 'YYYY-[Q]Q' }, month: { folder: 'Monthly Notes', format: 'YYYY-MM' }, week: { folder: 'Weekly Notes', format: 'gggg-[W]ww' } };

interface FileEntry {
  path: string;
  kind: FileKind;
  /** Content hash, so an event that changed nothing is a no-op. */
  hash: string;
  tasks: Task[];
  project?: Project;
  habit?: Habit;
  drawing?: Drawing;
  /** Attachment keys, for any note that carries them. */
  noteRef?: NoteRef;
  /** A daily note's diary entries. */
  daybook?: DaybookEntry[];
  /** Basenames linked under this note's Notes heading. */
  noteLinks?: string[];
  /** Basenames of drawings this note embeds or links (`![[X.excalidraw]]`). */
  drawingLinks?: string[];
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

  inScope(path: string, content?: string): boolean {
    const s = this.settings;
    if (s.excludePaths.some((x) => x.trim() !== '' && isUnder(path, x.trim()))) return false;
    if (isDrawingPath(path)) return true;
    if (!path.endsWith('.md')) return false;
    if (isUnder(path, s.notesFolder)) return true;
    // A note anywhere in the vault that carries helm-* keys is attached to something and belongs in the index.
    if (content !== undefined ? contentHasHelmKeys(content) : hasHelmKeys(this.vault.frontmatter?.(path))) return true;
    if (path === s.inboxNote) return true;
    if (isUnder(path, s.projectsFolder) || isUnder(path, s.habitsFolder)) return true;
    if (this.dateOfPath(path) !== undefined) return true;
    if (this.periodOfPath(path) !== undefined) return true;
    return s.extraFolders.some((f) => f.trim() !== '' && isUnder(path, f.trim()));
  }

  async rebuild(): Promise<void> {
    this.building = true;
    try {
      const all = await this.vault.list();
      this.allNoteTitles = new Map(all.filter((p) => p.endsWith('.md') && !isDrawingPath(p)).map((p) => [noteTitle(p).toLowerCase(), p]));
      const paths = [...all, ...(this.vault.listOther ? await this.vault.listOther() : [])].filter((p) => this.inScope(p));
      const next = new Map<string, FileEntry>();
      const contents = await Promise.all(paths.map(async (p) => [p, p.endsWith('.md') ? await this.vault.read(p).catch(() => undefined) : ''] as const));
      for (const [p, c] of contents) if (c !== undefined) next.set(p, this.parseFile(p, c));
      this.files = next;
      this.link();
    } finally {
      this.building = false;
      this.ready = true;
    }
    this.emit();
  }

  /** Re-parse one file (or drop it when content is undefined). Returns false when nothing changed. */
  update(path: string, content?: string): boolean {
    if (!this.applyOne(path, content)) return false;
    this.link();
    this.emit();
    return true;
  }

  /** Re-parse many files with a single re-link and a single change event. Returns how many changed. */
  updateMany(entries: { path: string; content?: string }[]): number {
    let changed = 0;
    for (const e of entries) if (this.applyOne(e.path, e.content)) changed++;
    if (changed > 0) { this.link(); this.emit(); }
    return changed;
  }

  /** Every markdown note in the vault by lower-cased basename (for resolving wikilinks), refreshed on rebuild and on file events. */
  private allNoteTitles = new Map<string, string>();

  /**
   * Remember (or forget) a markdown file's title, whatever else Helm does with it. Every note in the
   * vault can be linked to a task, so this must not depend on the file being in Helm's scanned scope.
   */
  noteSeen(path: string): void {
    if (!path.endsWith('.md') || isDrawingPath(path)) return;
    this.allNoteTitles.set(noteTitle(path).toLowerCase(), path);
  }

  noteGone(path: string): void {
    if (!path.endsWith('.md') || isDrawingPath(path)) return;
    const key = noteTitle(path).toLowerCase();
    if (this.allNoteTitles.get(key) === path) this.allNoteTitles.delete(key);
  }

  private applyOne(path: string, content: string | undefined): boolean {
    const known = this.files.get(path);
    if (content === undefined) this.noteGone(path); else this.noteSeen(path);
    if (!this.inScope(path, content) || content === undefined) {
      if (!known) return false;
      this.files.delete(path);
      return true;
    }
    const h = hash(content);
    if (known && known.hash === h) return false;
    this.files.set(path, this.parseFile(path, content));
    return true;
  }

  private parseFile(path: string, content: string): FileEntry {
    const s = this.settings;
    const entry: FileEntry = { path, kind: 'note', hash: hash(content), tasks: [], hasRegion: false, completions: [], diagnostics: [] };
    const mtime = this.vault.mtime(path);
    if (isDrawingPath(path)) { entry.kind = 'drawing'; entry.drawing = parseDrawing(path, content, mtime); return entry; }
    if (contentHasHelmKeys(content)) { const fm = parseDocument(content).frontmatter.values as Record<string, unknown>; entry.noteRef = parseNoteRef(path, fm, mtime); }
    const date = this.dateOfPath(path);
    const dl = [...content.matchAll(/!?\[\[([^\]|#]+?)(?:\.md)?(?:[|#][^\]]*)?\]\]/g)].map((m) => m[1]!.trim()).filter((t) => /\.(excalidraw|canvas)$/i.test(t)).map((t) => t.slice(t.lastIndexOf('/') + 1).replace(/\.(excalidraw|canvas)$/i, ''));
    if (dl.length > 0) entry.drawingLinks = [...new Set(dl)];
    const nlEarly = notesSectionLinks(content);
    if (nlEarly.length > 0) entry.noteLinks = nlEarly;

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
    if (date !== undefined) entry.daybook = parseDaybook(doc, s.daybookHeading).entries;
    const sectionOfLine = new Map<number, Section>();
    if (scan.region) for (const sec of ['habits', 'morning', 'afternoon', 'evening', 'anytime'] as Section[]) for (const l of scan.region.sections[sec].taskLines) sectionOfLine.set(l, sec);

    const keyOfLine = new Map<number, string>();
    for (const dt of doc.tasks) {
      const sec = sectionOfLine.get(dt.line);
      // Habit lines: the Habits section, or a `hab-…` line inside a part of the day (one occurrence per part).
      if (date !== undefined && dt.task.id && (sec === 'habits' || (dt.task.id.startsWith('hab-') && (sec === 'morning' || sec === 'afternoon' || sec === 'evening')))) {
        entry.completions.push({ habitId: dt.task.id, date, path, line: dt.line, state: dt.task.status === 'done' ? 'done' : dt.task.status === 'cancelled' ? 'skipped' : 'missed', ...(dt.task.text.trim() ? { text: dt.task.text.trim() } : {}), ...(sec !== 'habits' ? { part: sec } : {}) });
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
      // A task whose id is already taken gets a key of its own. Its subtasks were keyed to the id back
      // when the file was parsed, so they have to be re-pointed at it — otherwise they hang themselves
      // on the first task carrying that id, in whatever other note it happens to live.
      const renamed = new Map<string, string>();
      for (const t of f.tasks) {
        const copy: Task = { ...t, childKeys: [] };
        if (tasks.has(copy.key)) {
          diagnostics.push({ severity: 'warning', code: 'HELM-T01', message: `Duplicate task id ${copy.key} (also in ${tasks.get(copy.key)!.path})`, path: f.path, line: t.line });
          const next = `${copy.key}~${keys.length}`;
          renamed.set(copy.key, next);
          copy.key = next;
        }
        tasks.set(copy.key, copy);
        keys.push(copy.key);
      }
      if (renamed.size > 0) for (const k of keys) { const t = tasks.get(k); if (t?.parentKey && renamed.has(t.parentKey)) t.parentKey = renamed.get(t.parentKey)!; }
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

    const drawings = new Map<string, Drawing>();
    const notes = new Map<string, NoteRef>();
    for (const e of this.files.values()) { if (e.drawing) drawings.set(e.path, e.drawing); if (e.noteRef) notes.set(e.path, e.noteRef); }
    this.snapshot = { builtAt: Date.now(), tasks, projects, habits, goals, completions, dailyNotes, diagnostics, tasksByPath, drawings, notes };
    this.attachDrawings();
    this.attachNotes();
  }

  /* ── Drawings ↔ tasks / projects / days / periods ───────────────────── */

  private attachments = new Map<string, { taskKeys: Set<string>; projectIds: Set<string>; dates: Set<IsoDate>; periodKeys: Set<string>; habitIds: Set<string>; phaseIds: Set<string> }>();

  private attachDrawings(): void {
    const snap = this.snapshot;
    this.attachments = new Map();
    if (snap.drawings.size === 0) return;
    const byTitle = new Map<string, Drawing[]>();
    for (const d of snap.drawings.values()) byTitle.set(d.title.toLowerCase(), [...(byTitle.get(d.title.toLowerCase()) ?? []), d]);
    const att = (d: Drawing) => { let a = this.attachments.get(d.path); if (!a) { a = { taskKeys: new Set(), projectIds: new Set(), dates: new Set(), periodKeys: new Set(), habitIds: new Set(), phaseIds: new Set() }; this.attachments.set(d.path, a); } return a; };
    const projectsByTitle = new Map<string, Project>();
    for (const p of snap.projects.values()) { projectsByTitle.set(p.title.toLowerCase(), p); projectsByTitle.set(baseName(p.path).toLowerCase(), p); }
    const projectsByFolder = [...snap.projects.values()].filter((p) => p.folder !== '').sort((a, b) => b.folder.length - a.folder.length);
    const dailyTitleFormat = this.dailyFormat().slice(this.dailyFormat().lastIndexOf('/') + 1);
    const dateByTitle = new Map<string, IsoDate>();
    for (const d of snap.dailyNotes.keys()) dateByTitle.set(formatDate(d, dailyTitleFormat).toLowerCase(), d);
    const taskById = new Map<string, string>();
    for (const t of snap.tasks.values()) if (t.id && t.origin !== 'daily-mirror') taskById.set(t.id, t.key);
    const periodOfText = (s: string): string | undefined => { const m = /^(\d{4}(?:-Q[1-4]|-\d{2}|-W\d{2})?)(?![\w-])/i.exec(s.trim()); return m ? m[1]!.toUpperCase() : undefined; };
    const dateOfTitlePrefix = (title: string): IsoDate | undefined => {
      const t = title.toLowerCase();
      for (const [dt, date] of dateByTitle) if (t === dt || t.startsWith(dt + ' ') || t.startsWith(dt + ' —') || t.startsWith(dt + ' -') || t.startsWith(dt + '_')) return date;
      const direct = parseDateFromPath(title, dailyTitleFormat);
      return direct;
    };
    for (const d of snap.drawings.values()) {
      const a = att(d);
      for (const id of [...d.taskIds, ...d.mentionedTaskIds]) { const k = taskById.get(id); if (k) a.taskKeys.add(k); }
      for (const ref of d.projectRefs) { const p = snap.projects.get(ref) ?? projectsByTitle.get(ref.toLowerCase()); if (p) a.projectIds.add(p.id); }
      for (const date of d.dates) a.dates.add(date);
      for (const k of d.periodKeys) { const pk = periodOfText(k); if (pk) a.periodKeys.add(pk); }
      for (const hid of d.habitIds) if (snap.habits.has(hid)) a.habitIds.add(hid);
      for (const pid of d.phaseIds) if ([...snap.projects.values()].some((pr) => pr.phases.some((ph) => ph.id === pid))) a.phaseIds.add(pid);
      // Where it lives.
      const owner = projectsByFolder.find((p) => isUnder(d.path, p.folder));
      if (owner) a.projectIds.add(owner.id);
      // What it is called.
      const byDate = dateOfTitlePrefix(d.title);
      if (byDate) a.dates.add(byDate);
      const byPeriod = periodOfText(d.title);
      if (byPeriod && !byDate) a.periodKeys.add(byPeriod);
      // Tasks whose text links the drawing.
      for (const t of snap.tasks.values()) if (t.origin !== 'daily-mirror' && wikilinksIn(t.text).some((l) => l.toLowerCase() === d.title.toLowerCase() || l.toLowerCase() === `${d.title.toLowerCase()}.excalidraw`)) a.taskKeys.add(t.key);
      // What it says.
      for (const l of d.links) {
        const p = projectsByTitle.get(l.toLowerCase()); if (p) a.projectIds.add(p.id);
        const dt = dateByTitle.get(l.toLowerCase()); if (dt) a.dates.add(dt);
        const pk = periodOfText(l); if (pk && pk.length === l.trim().length) a.periodKeys.add(pk);
      }
    }
    // Who embeds it.
    for (const e of this.files.values()) {
      if (!e.drawingLinks) continue;
      for (const t of e.drawingLinks) for (const d of byTitle.get(t.toLowerCase()) ?? []) {
        const a = att(d);
        if (e.kind === 'daily' && e.date) a.dates.add(e.date);
        else if (e.kind === 'periodic' && e.period) a.periodKeys.add(e.period.key);
        else if (e.kind === 'project' && e.project) a.projectIds.add(e.project.id);
        else if (e.kind === 'habit' && e.habit) a.habitIds.add(e.habit.id);
      }
    }
  }

  /** Paths of notes that embed or link a drawing by title. */
  filesEmbedding(title: string): string[] {
    const t = title.toLowerCase();
    return [...this.files.values()].filter((e) => e.drawingLinks?.some((x) => x.toLowerCase() === t)).map((e) => e.path);
  }

  private noteAttachments = new Map<string, { taskKeys: Set<string>; projectIds: Set<string>; dates: Set<IsoDate>; periodKeys: Set<string>; habitIds: Set<string>; phaseIds: Set<string> }>();

  /** Notes ↔ targets: frontmatter keys, task-text links, and links under a Notes heading of the target's note. */
  private attachNotes(): void {
    const snap = this.snapshot;
    this.noteAttachments = new Map();
    const att = (path: string) => { let a = this.noteAttachments.get(path); if (!a) { a = { taskKeys: new Set(), projectIds: new Set(), dates: new Set(), periodKeys: new Set(), habitIds: new Set(), phaseIds: new Set() }; this.noteAttachments.set(path, a); } return a; };
    const projectsByTitle = new Map<string, Project>();
    for (const p of snap.projects.values()) { projectsByTitle.set(p.title.toLowerCase(), p); projectsByTitle.set(baseName(p.path).toLowerCase(), p); }
    const taskById = new Map<string, string>();
    for (const t of snap.tasks.values()) if (t.id && t.origin !== 'daily-mirror') taskById.set(t.id, t.key);
    const isOwnNote = (path: string): boolean => { const e = this.files.get(path); return !!e && (e.kind === 'project' || e.kind === 'daily' || e.kind === 'periodic' || e.kind === 'habit' || e.kind === 'inbox'); };
    for (const n of snap.notes.values()) {
      const a = att(n.path);
      for (const id of n.taskIds) { const k = taskById.get(id); if (k) a.taskKeys.add(k); }
      for (const ref of n.projectRefs) { const p = snap.projects.get(ref) ?? projectsByTitle.get(ref.toLowerCase()); if (p) a.projectIds.add(p.id); }
      for (const d of n.dates) a.dates.add(d);
      for (const k of n.periodKeys) a.periodKeys.add(k.toUpperCase());
      for (const hid of n.habitIds) if (snap.habits.has(hid)) a.habitIds.add(hid);
      for (const pid of n.phaseIds) if ([...snap.projects.values()].some((pr) => pr.phases.some((ph) => ph.id === pid))) a.phaseIds.add(pid);
    }
    // Task text links a note.
    for (const t of snap.tasks.values()) {
      if (t.origin === 'daily-mirror') continue;
      for (const l of wikilinksIn(t.text)) {
        if (/\.(excalidraw|canvas)$/i.test(l)) continue;
        const path = this.allNoteTitles.get(l.toLowerCase());
        if (path && !isOwnNote(path)) att(path).taskKeys.add(t.key);
      }
    }
    // Links under a Notes heading of a project / daily / periodic note.
    for (const e of this.files.values()) {
      if (!e.noteLinks) continue;
      for (const l of e.noteLinks) {
        const path = this.allNoteTitles.get(l.toLowerCase());
        if (!path || isOwnNote(path)) continue;
        const a = att(path);
        if (e.kind === 'daily' && e.date) a.dates.add(e.date);
        else if (e.kind === 'periodic' && e.period) a.periodKeys.add(e.period.key.toUpperCase());
        else if (e.kind === 'project' && e.project) a.projectIds.add(e.project.id);
        else if (e.kind === 'habit' && e.habit) a.habitIds.add(e.habit.id);
      }
    }
  }

  /** Notes attached to a target, newest first. Unindexed notes reached by links come back with just path and title. */
  notesFor(target: DrawingTarget): NoteRef[] {
    const out: NoteRef[] = [];
    for (const [path, a] of this.noteAttachments) {
      const hit = target.kind === 'task' ? a.taskKeys.has(target.key) || (target.id !== undefined && [...a.taskKeys].some((k) => this.snapshot.tasks.get(k)?.id === target.id))
        : target.kind === 'project' ? a.projectIds.has(target.id)
        : target.kind === 'date' ? a.dates.has(target.date)
        : target.kind === 'habit' ? a.habitIds.has(target.id)
        : target.kind === 'phase' ? a.phaseIds.has(target.id)
        : a.periodKeys.has(target.key.toUpperCase());
      if (!hit) continue;
      out.push(this.snapshot.notes.get(path) ?? { path, title: noteTitle(path), taskIds: [], projectRefs: [], dates: [], periodKeys: [], habitIds: [], phaseIds: [], ...(this.vault.mtime(path) !== undefined ? { mtime: this.vault.mtime(path) } : {}) });
    }
    return out.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  }

  /** Titles of every markdown note in the vault (for `[[` completion), drawings included by their bare title. */
  noteTitles(): string[] {
    const out = new Set<string>();
    for (const p of this.allNoteTitles.values()) out.add(noteTitle(p));
    for (const d of this.snapshot.drawings.values()) out.add(d.kind === 'canvas' ? `${d.title}.canvas` : `${d.title}.excalidraw`);
    return [...out].sort((a, b) => a.localeCompare(b));
  }

  /**
   * Every markdown note that can be attached to something: anything in the vault except drawings and
   * daily notes (a day is attached to as a day). Project, periodic and habit notes count — plenty of
   * people keep real content in them — and carry their kind so a picker can say what they are.
   */
  linkableNotes(): { path: string; title: string; kind?: FileKind }[] {
    const out: { path: string; title: string; kind?: FileKind }[] = [];
    for (const p of this.allNoteTitles.values()) {
      if (isDrawingPath(p)) continue;
      const kind = this.files.get(p)?.kind;
      if (kind === 'daily' || kind === 'drawing' || this.dateOfPath(p) !== undefined) continue; // a day is attached to as a day, parsed or not
      out.push({ path: p, title: noteTitle(p), ...(kind && kind !== 'note' ? { kind } : {}) });
    }
    return out.sort((a, b) => a.title.localeCompare(b.title));
  }

  /** Paths of notes whose Notes heading links a note by title. */
  filesLinkingNote(title: string): string[] {
    const t = title.toLowerCase();
    return [...this.files.values()].filter((e) => e.noteLinks?.some((x) => x.toLowerCase() === t)).map((e) => e.path);
  }

  allDrawings(): Drawing[] { return [...this.snapshot.drawings.values()].sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0)); }

  /** Drawings attached to a task (by key), project (by id), day or period. Newest first. */
  drawingsFor(target: DrawingTarget): Drawing[] {
    const out: Drawing[] = [];
    for (const d of this.snapshot.drawings.values()) {
      const a = this.attachments.get(d.path);
      if (!a) continue;
      const hit = target.kind === 'task' ? a.taskKeys.has(target.key) || (target.id !== undefined && [...a.taskKeys].some((k) => this.snapshot.tasks.get(k)?.id === target.id))
        : target.kind === 'project' ? a.projectIds.has(target.id)
        : target.kind === 'date' ? a.dates.has(target.date)
        : target.kind === 'habit' ? a.habitIds.has(target.id)
        : target.kind === 'phase' ? a.phaseIds.has(target.id)
        : a.periodKeys.has(target.key.toUpperCase());
      if (hit) out.push(d);
    }
    return out.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0));
  }

  /* ── Queries ─────────────────────────────────────────────────────────── */

  task(key: string): Task | undefined { return this.snapshot.tasks.get(key); }
  /** The task carrying this 🆔, ignoring the copy mirrored onto a day. */
  /**
   * The task carrying this id. Two notes can end up holding the same id — a day that was moved on
   * leaves a “forwarded” record behind — so a live line always wins over a closed record, and the
   * record is only returned when there is nothing else.
   */
  /** The diary of a day. Empty when the day has no note, or no daybook heading in it. */
  daybook(date: IsoDate): DaybookEntry[] {
    const path = this.dailyPath(date);
    return (path ? this.files.get(path)?.daybook : undefined) ?? [];
  }

  taskById(id: string): Task | undefined {
    let record: Task | undefined;
    for (const t of this.snapshot.tasks.values()) {
      if (t.id !== id || t.origin === 'daily-mirror') continue;
      if (t.status !== 'forwarded' && t.status !== 'cancelled') return t;
      record ??= t;
    }
    return record;
  }
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
  return { builtAt: 0, tasks: new Map(), projects: new Map(), habits: new Map(), goals: new Map(), completions: [], dailyNotes: new Map(), diagnostics: [], tasksByPath: new Map(), drawings: new Map(), notes: new Map() };
}
