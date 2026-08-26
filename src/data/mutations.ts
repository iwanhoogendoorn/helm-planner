/**
 * Every write Helm performs goes through this module.
 *
 * Rules:
 *  - Read the file fresh, change only the lines the operation is about, write.
 *  - After every write, update the index synchronously so the next step in the
 *    same operation sees fresh line numbers.
 *  - Past daily notes are a log: a line is marked `[>]` (forwarded) rather
 *    than removed; mirrors on past days are never rewritten.
 */
import type { HelmSettings, IsoDate, Project, ProjectPriority, ProjectStatus, Task, TaskLine, TaskStatus } from '../core/types';
import { parseTaskLine, serialiseTaskLine, withStatus, newTaskLine, STATUS_MARKER } from '../core/taskLine';
import { DAY_PARTS, emptyContent, findRegion, isEmptyRegion, readRegion, removeLines, writeRegion, type DayPart, type RegionContent } from '../core/dailyNote';
import { parseDocument, sectionInsertPoint, type Document } from '../core/document';
import { addDays, addMonths, diffDays, formatDate } from '../core/dates';
import { nextOccurrence } from '../core/recurrence';
import { uniqueId } from '../core/ids';
import { setFrontmatter } from '../core/frontmatter';
import { renderProjectNote } from '../core/project';
import { renderHabitNote } from '../core/habit';
import { columnWidth } from '../core/tree';
import type { HelmIndex } from './index';
import { baseName, type VaultAdapter } from './vault';
import { habitDue } from './habits';
import { misfiledDate } from './planner';
import { parsePeriod, type Period, type PeriodKind } from '../core/periods';

export interface MutationDeps {
  vault: VaultAdapter;
  index: HelmIndex;
  settings: () => HelmSettings;
  today: () => IsoDate;
  notify: (msg: string) => void;
  /** Daily-note template text, when configured. */
  dailyTemplate?: () => Promise<string | undefined>;
  /** Yearly / quarterly / monthly note template text, when configured. */
  periodicTemplate?: (kind: PeriodKind) => Promise<string | undefined>;
  /**
   * Let a template engine (Templater) process a freshly created note that
   * holds the raw template. Returns true when it did; false to fall back to
   * Helm's own placeholder rendering.
   */
  processTemplate?: (path: string) => Promise<boolean>;
  rng?: () => number;
}

export interface AddTaskSpec {
  text: string;
  fields?: Partial<TaskLine>;
  projectId?: string;
  phaseId?: string;
  date?: IsoDate;
  /** Part of the day when `date` is given. */
  part?: DayPart;
  parentKey?: string;
  /** Force the inbox even when nothing else applies (default anyway). */
  toInbox?: boolean;
}

export const STATUS_RANK: Record<TaskStatus, number> = { todo: 0, doing: 1, waiting: 2, forwarded: 3, cancelled: 4, done: 5 };

export class Mutations {
  constructor(private d: MutationDeps) {}

  private get index(): HelmIndex { return this.d.index; }
  private get settings(): HelmSettings { return this.d.settings(); }
  private get today(): IsoDate { return this.d.today(); }

  /* ── File primitives ────────────────────────────────────────────────── */

  private async editFile(path: string, fn: (lines: string[], doc: Document) => boolean | string[] | undefined): Promise<boolean> {
    const content = await this.d.vault.read(path);
    const doc = parseDocument(content);
    const lines = [...doc.lines];
    const r = fn(lines, doc);
    if (r === undefined || r === false) return false;
    const next = Array.isArray(r) ? r : lines;
    const out = next.join(doc.eol);
    if (out === content) return false;
    await this.d.vault.write(path, out);
    this.index.update(path, out);
    return true;
  }

  private async createFile(path: string, content: string): Promise<void> {
    await this.d.vault.write(path, content);
    this.index.update(path, content);
  }

  private fresh(key: string): Task {
    const t = this.index.task(key);
    if (!t) throw new Error(`Task no longer exists: ${key}`);
    return t;
  }

  /** After rewriting a line, the task's derived key may have changed: find it by position. */
  private freshAt(path: string, line: number, fallbackKey: string): Task {
    return this.index.tasksInFile(path).find((x) => x.line === line) ?? this.fresh(fallbackKey);
  }

  private lineOf(lines: string[], t: Task): TaskLine {
    const parsed = parseTaskLine(lines[t.line] ?? '');
    if (!parsed || (t.id && parsed.id !== t.id) || (!t.id && parsed.text !== t.text)) throw new Error(`Line moved under us: ${t.path}:${t.line + 1}`);
    return parsed;
  }

  /** Line range of a task and its subtree (children by indentation). */
  private subtreeRange(lines: string[], t: Task): { start: number; end: number } {
    const w = columnWidth(t.raw.indent);
    let end = t.line + 1;
    while (end < lines.length) {
      const l = lines[end]!;
      if (l.trim() === '') { end++; continue; }
      const m = /^([ \t]*)\S/.exec(l);
      if (!m || columnWidth(m[1]!) <= w) break;
      end++;
    }
    while (end > t.line + 1 && lines[end - 1]!.trim() === '') end--;
    return { start: t.line, end };
  }

  private mirrorLink(t: Task): string {
    if (t.projectId) {
      const p = this.index.project(t.projectId);
      if (p) { const b = baseName(p.path); return b === p.title ? `[[${b}]]` : `[[${b}|${p.title}]]`; }
    }
    return `[[${baseName(t.path)}]]`;
  }

  /** What a mirror line for `source` on a daily note should look like. */
  mirrorLine(source: Task, existing?: TaskLine): TaskLine {
    const m = newTaskLine(source.text, {
      status: existing?.status ?? source.status,
      marker: existing?.marker ?? source.marker,
      id: source.id,
      priority: source.priority,
      ...(source.due ? { due: source.due } : {}),
      ...(source.recurrence ? { recurrence: source.recurrence } : {}),
      ...(source.effortRaw ? { effortRaw: source.effortRaw } : source.effortMinutes !== undefined ? { effortMinutes: source.effortMinutes } : {}),
      ...(source.time ? { time: source.time } : {}),
      mirrorLink: this.mirrorLink(source),
      ...(existing?.done ? { done: existing.done } : source.done ? { done: source.done } : {}),
      ...(existing?.cancelled ? { cancelled: existing.cancelled } : source.cancelled ? { cancelled: source.cancelled } : {}),
    });
    m.marker = STATUS_MARKER[m.status];
    return m;
  }

  /* ── Daily notes ────────────────────────────────────────────────────── */

  async ensureDailyNote(date: IsoDate): Promise<string> {
    const path = this.index.dailyPath(date);
    if (await this.d.vault.exists(path)) return path;
    const tpl = this.d.dailyTemplate ? await this.d.dailyTemplate() : undefined;
    await this.createFromTemplate(path, tpl, date, baseName(path));
    return path;
  }

  /** Create a note from a template: Templater first when available, else Helm's renderer. */
  private async createFromTemplate(path: string, tpl: string | undefined, date: IsoDate, title: string): Promise<void> {
    if (tpl && tpl.includes('<%') && this.d.processTemplate) {
      await this.createFile(path, tpl);
      let ok = false;
      try { ok = await this.d.processTemplate(path); } catch { ok = false; }
      if (ok) { const c = await this.d.vault.read(path); this.index.update(path, c); return; }
    }
    const content = renderDailyTemplate(tpl, date, title);
    if (await this.d.vault.exists(path)) { await this.d.vault.write(path, content); this.index.update(path, content); }
    else await this.createFile(path, content);
  }

  private async editRegion(date: IsoDate, fn: (rc: RegionContent) => RegionContent | undefined): Promise<boolean> {
    const path = await this.ensureDailyNote(date);
    const content = await this.d.vault.read(path);
    const doc = parseDocument(content);
    const scan = findRegion(doc.lines, this.settings);
    if (scan.broken) { this.d.notify(`Helm region in ${baseName(path)} is broken (no end marker) — not writing.`); return false; }
    const current: RegionContent = scan.region ? readRegion(doc.lines, scan.region) : emptyContent();
    const next = fn(current);
    if (!next) return false;
    if (!scan.region && isEmptyRegion(next)) return false;
    const w = writeRegion(content, next, this.settings);
    if (!w) return false;
    const out = w.lines.join(w.eol);
    if (out === content) return false;
    await this.d.vault.write(path, out);
    this.index.update(path, out);
    return true;
  }

  /** Put the habits due on `date` into the note (keeping any existing ticks). */
  async syncHabitsForDay(date: IsoDate, habitIds?: string[]): Promise<boolean> {
    const habits = this.index.allHabits().filter((h) => (habitIds ? habitIds.includes(h.id) : habitDue(h, date))).sort((a, b) => a.title.localeCompare(b.title));
    if (habits.length === 0 && !habitIds) return false;
    return this.editRegion(date, (rc) => {
      const byId = new Map(rc.habits.map((l) => [l.id, l]));
      const lines: TaskLine[] = [];
      for (const h of habits) {
        const ex = byId.get(h.id);
        lines.push(ex ? { ...ex, text: `${h.icon ? h.icon + ' ' : ''}${h.title}` } : newTaskLine(`${h.icon ? h.icon + ' ' : ''}${h.title}`, { id: h.id }));
      }
      // Keep ticked lines for habits no longer scheduled.
      for (const l of rc.habits) if (!habits.some((h) => h.id === l.id) && l.status === 'done') lines.push(l);
      return { ...rc, habits: lines };
    });
  }

  async setHabitState(habitId: string, date: IsoDate, state: 'done' | 'skipped' | 'missed'): Promise<void> {
    const status: TaskStatus = state === 'done' ? 'done' : state === 'skipped' ? 'cancelled' : 'todo';
    const h = this.index.snapshot.habits.get(habitId);
    await this.editRegion(date, (rc) => {
      const idx = rc.habits.findIndex((l) => l.id === habitId);
      const base = idx >= 0 ? rc.habits[idx]! : newTaskLine(h ? `${h.icon ? h.icon + ' ' : ''}${h.title}` : habitId, { id: habitId });
      const next = withStatus(base, status, date);
      const habits = [...rc.habits];
      if (idx >= 0) habits[idx] = next; else habits.push(next);
      return { ...rc, habits };
    });
  }

  /* ── Ids ────────────────────────────────────────────────────────────── */

  private newTaskId(): string {
    return uniqueId('tsk', (id) => this.index.snapshot.tasks.has(id), this.d.rng);
  }

  /** Make sure a source task carries a 🆔; returns the (possibly new) key. */
  async ensureId(key: string): Promise<string> {
    const t = this.fresh(key);
    if (t.id) return key;
    const id = this.newTaskId();
    await this.editFile(t.path, (lines) => {
      const tl = this.lineOf(lines, t);
      lines[t.line] = serialiseTaskLine({ ...tl, id }, { force: true });
      return true;
    });
    return id;
  }

  /* ── Status ─────────────────────────────────────────────────────────── */

  private async writeLineStatus(path: string, line: number, status: TaskStatus, date: IsoDate): Promise<void> {
    await this.editFile(path, (lines) => {
      const tl = parseTaskLine(lines[line] ?? '');
      if (!tl) return false;
      lines[line] = serialiseTaskLine(withStatus(tl, status, date), { force: true });
      return true;
    });
  }

  async setStatus(key: string, status: TaskStatus): Promise<void> {
    let t = this.fresh(key);
    const today = this.today;
    // Habit line?
    if (t.origin === 'daily-mirror' && t.mirrorOf) {
      const src = this.index.task(t.mirrorOf);
      if (src) { await this.setStatus(src.key, status); return; }
    }
    if (t.status === status) return;
    const doneDate = t.origin === 'daily' && t.noteDate ? t.noteDate : today;
    await this.writeLineStatus(t.path, t.line, status, doneDate);
    t = this.fresh(key);
    // Mirrors on today and later follow the source.
    for (const m of this.index.mirrorsOf(t.key)) {
      if (m.noteDate !== undefined && m.noteDate >= today && m.status !== status) await this.writeLineStatus(m.path, m.line, status, doneDate);
    }
    if (status === 'done' && t.recurrence?.parsed) await this.spawnNextOccurrence(t);
  }

  private async spawnNextOccurrence(t: Task): Promise<void> {
    const rec = t.recurrence!;
    const base = rec.whenDone ? this.today : (t.due ?? t.scheduled ?? t.noteDate ?? this.today);
    const next = nextOccurrence(rec, base);
    if (!next) return;
    const shift = diffDays(base, next);
    const fields: Partial<TaskLine> = { status: 'todo', priority: t.priority, recurrence: rec, blockedBy: [...t.blockedBy], unknown: [...t.unknown], tags: [...t.tags] };
    if (t.due) fields.due = addDays(t.due, shift);
    if (t.start) fields.start = addDays(t.start, shift);
    if (t.effortRaw) fields.effortRaw = t.effortRaw;
    if (t.effortMinutes !== undefined) fields.effortMinutes = t.effortMinutes;
    if (t.time) fields.time = t.time;
    if (t.id) fields.id = this.newTaskId();
    if (t.origin === 'daily') {
      const part = t.part ?? 'anytime';
      await this.editRegion(next, (rc) => ({ ...rc, [part]: [...rc[part], newTaskLine(t.text, fields)] }));
      return;
    }
    if (t.scheduled) fields.scheduled = addDays(t.scheduled, shift);
    await this.editFile(t.path, (lines) => {
      lines.splice(t.line, 0, serialiseTaskLine(newTaskLine(t.text, fields, t.raw.indent)));
      return true;
    });
  }

  /* ── Scheduling: the heart of "plan my day" ──────────────────────────── */

  /** Plan a task onto a day and, optionally, a part of it (or take it off every day when `date` is undefined). */
  async schedule(key: string, date: IsoDate | undefined, part?: DayPart): Promise<void> {
    let t = this.fresh(key);
    const today = this.today;
    if (t.origin === 'daily-mirror' && t.mirrorOf) {
      const src = this.index.task(t.mirrorOf);
      if (src) { await this.schedule(src.key, date, part ?? (date === t.noteDate ? undefined : t.part)); return; }
      // Orphan mirror: treat as a daily task.
    }
    if (t.origin === 'daily') { await this.moveDailyTask(t, date, part); return; }
    if (t.origin === 'inbox' && date !== undefined) { await this.moveLineToDay(t, date, part); return; }
    if (t.origin === 'inbox' && date === undefined) {
      await this.editFile(t.path, (lines) => { const tl = this.lineOf(lines, t); delete tl.scheduled; lines[t.line] = serialiseTaskLine(tl, { force: true }); return true; });
      return;
    }
    // Project or note task: ⏳ on the source + a mirror line in the day's note.
    if (date !== undefined) { const k = await this.ensureId(key); t = this.fresh(k); }
    await this.editFile(t.path, (lines) => {
      const tl = this.lineOf(lines, t);
      if (date === undefined) delete tl.scheduled; else tl.scheduled = date;
      lines[t.line] = serialiseTaskLine(tl, { force: true });
      return true;
    });
    t = this.fresh(t.key);
    // Remove mirrors on other days (today or later). Past days keep their record; remember the part it sat in.
    const days = new Set<IsoDate>();
    let previousPart: DayPart | undefined;
    for (const m of this.index.mirrorsOf(t.key)) {
      if (m.noteDate && m.noteDate !== date && m.noteDate >= today) { days.add(m.noteDate); previousPart ??= m.part; }
    }
    for (const d of days) await this.editRegion(d, (rc) => { removeLines(rc, (l) => l.id === t.id); return rc; });
    if (date !== undefined) {
      const src = t;
      await this.editRegion(date, (rc) => {
        const existingPart = DAY_PARTS.find((p) => rc[p].some((l) => l.id === src.id));
        const existing = removeLines(rc, (l) => l.id === src.id);
        const line = this.mirrorLine(src, existing[0]);
        const target: DayPart = part ?? existingPart ?? previousPart ?? (src.time ? this.partOfTime(src.time.start) : 'anytime');
        rc[target] = [...rc[target], line];
        return rc;
      });
    }
  }

  private partOfTime(hhmm: string): DayPart {
    const s = this.settings;
    return hhmm < s.morningEnds ? 'morning' : hhmm < s.afternoonEnds ? 'afternoon' : 'evening';
  }

  /** Move a line that already sits on a day to another part of that day. */
  async setPart(key: string, part: DayPart): Promise<void> {
    const t = this.fresh(key);
    if ((t.origin === 'daily' || t.origin === 'daily-mirror') && t.noteDate !== undefined && t.section !== 'outside') {
      const date = t.noteDate;
      await this.editRegion(date, (rc) => {
        const removed = removeLines(rc, (l) => (t.id ? l.id === t.id : l.text === t.text && l.id === undefined));
        if (removed.length === 0) return undefined;
        rc[part] = [...rc[part], ...removed];
        return rc;
      });
      return;
    }
    if (t.origin === 'daily' && t.section === 'outside' && t.noteDate !== undefined) {
      // A stray line elsewhere in the note: pull it (with its subtree) into the section.
      let carried: TaskLine[] = [];
      await this.editFile(t.path, (lines) => {
        const { start, end } = this.subtreeRange(lines, t);
        carried = lines.slice(start, end).map((l) => parseTaskLine(l)).filter((x): x is TaskLine => x !== undefined);
        lines.splice(start, end - start);
        return true;
      });
      const baseIndent = carried[0]?.raw.indent ?? '';
      const rebased = carried.map((l) => ({ ...l, raw: { ...l.raw, indent: l.raw.indent.slice(baseIndent.length), eol: '' } }));
      await this.editRegion(t.noteDate, (rc) => ({ ...rc, [part]: [...rc[part], ...rebased] }));
      return;
    }
    if (t.scheduled) { await this.schedule(t.key, t.scheduled, part); return; }
    const mirror = this.index.mirrorsOf(t.key).find((m) => m.noteDate !== undefined && m.noteDate >= this.today);
    if (mirror) { await this.setPart(mirror.key, part); return; }
    this.d.notify('Plan the task onto a day first, then pick a part of the day.');
  }

  /** A daily-owned task moves between notes; leaving a past note marks it forwarded. */
  private async moveDailyTask(t: Task, date: IsoDate | undefined, part?: DayPart): Promise<void> {
    if (t.noteDate === date) { if (part && part !== t.part) await this.setPart(t.key, part); return; }
    const today = this.today;
    let carried: TaskLine[] = [];
    await this.editFile(t.path, (lines) => {
      const { start, end } = this.subtreeRange(lines, t);
      carried = lines.slice(start, end).map((l) => parseTaskLine(l)).filter((x): x is TaskLine => x !== undefined);
      if (t.noteDate !== undefined && t.noteDate < today) {
        lines[start] = serialiseTaskLine(withStatus(this.lineOf(lines, t), 'forwarded', t.noteDate), { force: true });
      } else lines.splice(start, end - start);
      return true;
    });
    if (carried.length === 0) return;
    if (t.noteDate !== undefined && t.noteDate >= today && t.section !== 'outside') await this.editRegion(t.noteDate, (rc) => rc); // drop an emptied section heading
    const baseIndent = carried[0]!.raw.indent;
    const rebased = carried.map((l) => ({ ...l, status: l === carried[0] ? 'todo' as TaskStatus : l.status, marker: l === carried[0] ? ' ' : l.marker, raw: { ...l.raw, indent: l.raw.indent.slice(baseIndent.length), eol: '' } }));
    delete rebased[0]!.done;
    delete rebased[0]!.cancelled;
    if (date !== undefined) {
      const target: DayPart = part ?? (t.section && t.section !== 'outside' && t.section !== 'habits' ? t.section : 'anytime');
      await this.editRegion(date, (rc) => ({ ...rc, [target]: [...rc[target], ...rebased] }));
    } else {
      await this.appendToInbox(rebased);
    }
  }

  /** An inbox line moves into the day's note. */
  private async moveLineToDay(t: Task, date: IsoDate, part: DayPart = 'anytime'): Promise<void> {
    let carried: TaskLine[] = [];
    await this.editFile(t.path, (lines) => {
      const { start, end } = this.subtreeRange(lines, t);
      carried = lines.slice(start, end).map((l) => parseTaskLine(l)).filter((x): x is TaskLine => x !== undefined);
      lines.splice(start, end - start);
      return true;
    });
    const baseIndent = carried[0]?.raw.indent ?? '';
    const rebased = carried.map((l) => ({ ...l, raw: { ...l.raw, indent: l.raw.indent.slice(baseIndent.length), eol: '' } }));
    if (rebased[0]) delete rebased[0].scheduled;
    await this.editRegion(date, (rc) => ({ ...rc, [part]: [...rc[part], ...rebased] }));
  }

  private async appendToInbox(lines: TaskLine[]): Promise<void> {
    const path = this.settings.inboxNote;
    if (!(await this.d.vault.exists(path))) await this.createFile(path, `# Inbox\n\nCapture here, triage in Helm.\n\n`);
    await this.editFile(path, (ls) => {
      let p = ls.length;
      while (p > 0 && ls[p - 1]!.trim() === '') p--;
      ls.splice(p, ls.length - p, ...lines.map((l) => serialiseTaskLine({ ...l, raw: { ...l.raw, eol: '' } })), '');
      return true;
    });
  }

  /* ── Creating tasks ─────────────────────────────────────────────────── */

  async addTask(spec: AddTaskSpec): Promise<void> {
    const fields: Partial<TaskLine> = { ...(this.settings.writeCreatedDate ? { created: this.today } : {}), ...spec.fields };
    const part: DayPart = spec.part ?? (spec.fields?.time ? this.partOfTime(spec.fields.time.start) : 'anytime');
    const unit = this.settings.indentUnit || '\t';
    if (spec.parentKey) {
      const parent = this.fresh(spec.parentKey);
      const line = newTaskLine(spec.text, fields, parent.raw.indent + unit);
      await this.editFile(parent.path, (lines) => {
        const { end } = this.subtreeRange(lines, parent);
        lines.splice(end, 0, serialiseTaskLine(line));
        return true;
      });
      return;
    }
    if (spec.projectId) {
      const p = this.index.project(spec.projectId);
      if (!p) throw new Error('Project not found');
      let id: string | undefined;
      if (spec.date) { id = this.newTaskId(); fields.id = id; fields.scheduled = spec.date; }
      const line = newTaskLine(spec.text, fields);
      await this.editFile(p.path, (lines, doc) => {
        const at = this.projectInsertPoint(lines, doc, p, spec.phaseId);
        lines.splice(at.index, 0, ...at.prefix, serialiseTaskLine(line));
        return true;
      });
      if (spec.date && id) {
        const src = this.index.task(id);
        if (src) await this.editRegion(spec.date, (rc) => ({ ...rc, [part]: [...rc[part], this.mirrorLine(src)] }));
      }
      return;
    }
    if (spec.date) {
      delete fields.scheduled;
      await this.editRegion(spec.date, (rc) => ({ ...rc, [part]: [...rc[part], newTaskLine(spec.text, fields)] }));
      return;
    }
    await this.appendToInbox([newTaskLine(spec.text, fields)]);
  }

  /** Where a new task goes in a project note: end of the phase, else under `## Tasks` (created when missing). */
  private projectInsertPoint(lines: string[], doc: Document, p: Project, phaseId?: string): { index: number; prefix: string[] } {
    const phase = phaseId ? p.phases.find((ph) => ph.id === phaseId) : undefined;
    if (phase) {
      const h = doc.headings.find((x) => x.line === phase.headingLine);
      if (h) return { index: sectionInsertPoint(doc, h), prefix: [] };
    }
    const th = doc.headings.find((h) => /^tasks$/i.test(h.text.trim()));
    if (th) return { index: sectionInsertPoint(doc, th), prefix: [] };
    let p2 = lines.length;
    while (p2 > 0 && lines[p2 - 1]!.trim() === '') p2--;
    return { index: p2, prefix: ['', '## Tasks', ''] };
  }

  /* ── Editing ────────────────────────────────────────────────────────── */

  async updateTask(key: string, patch: Partial<TaskLine> & { scheduled?: IsoDate | undefined }): Promise<void> {
    let t = this.fresh(key);
    if (t.origin === 'daily-mirror' && t.mirrorOf && this.index.task(t.mirrorOf)) { await this.updateTask(t.mirrorOf, patch); return; }
    const { scheduled, ...rest } = patch;
    const hasSched = Object.prototype.hasOwnProperty.call(patch, 'scheduled');
    if (Object.keys(rest).length > 0) {
      await this.editFile(t.path, (lines) => {
        const tl = this.lineOf(lines, t);
        const next: TaskLine = { ...tl, ...rest };
        for (const [k, v] of Object.entries(rest)) if (v === undefined) delete (next as unknown as Record<string, unknown>)[k];
        if (rest.status && rest.status !== tl.status) Object.assign(next, withStatus(next, rest.status, this.today));
        lines[t.line] = serialiseTaskLine(next, { force: true });
        return true;
      });
      t = this.freshAt(t.path, t.line, key);
      await this.refreshMirrors(t);
    }
    if (hasSched && (t.scheduled ?? (t.origin === 'daily' ? t.noteDate : undefined)) !== scheduled) await this.schedule(t.key, scheduled);
  }

  /** Rewrite the mirrors of a source on today and later from the source. */
  async refreshMirrors(src: Task): Promise<void> {
    const today = this.today;
    for (const m of this.index.mirrorsOf(src.key)) {
      if (!m.noteDate || m.noteDate < today) continue;
      const want = serialiseTaskLine(this.mirrorLine(src, m));
      if (want === serialiseTaskLine({ ...m, raw: { ...m.raw, eol: '' } }, { force: true })) continue;
      await this.editFile(m.path, (lines) => { lines[m.line] = m.raw.indent + want + m.raw.eol.replace(/\r?\n$/, ''); return true; });
    }
  }

  async deleteTask(key: string): Promise<void> {
    const t = this.fresh(key);
    if (t.origin === 'daily-mirror' || (t.origin === 'daily' && t.section !== 'outside')) {
      await this.editFile(t.path, (lines) => { const r = this.subtreeRange(lines, t); lines.splice(r.start, r.end - r.start); return true; });
      if (t.noteDate !== undefined && t.noteDate >= this.today) await this.editRegion(t.noteDate, (rc) => rc);
      return;
    }
    const days = new Set<IsoDate>();
    for (const m of this.index.mirrorsOf(t.key)) if (m.noteDate && m.noteDate >= this.today) days.add(m.noteDate);
    await this.editFile(t.path, (lines) => { const r = this.subtreeRange(lines, t); lines.splice(r.start, r.end - r.start); return true; });
    for (const d of days) await this.editRegion(d, (rc) => { removeLines(rc, (l) => l.id === t.id); return rc; });
  }

  /** Move a task (with subtree) into a project phase. Keeps its plan date, adding a mirror. */
  async moveToProject(key: string, projectId: string, phaseId?: string): Promise<void> {
    let t = this.fresh(key);
    if (t.origin === 'daily-mirror' && t.mirrorOf && this.index.task(t.mirrorOf)) t = this.fresh(t.mirrorOf);
    const p = this.index.project(projectId);
    if (!p) throw new Error('Project not found');
    const planned = t.scheduled ?? (t.origin === 'daily' ? t.noteDate : undefined);
    if (t.origin === 'project' && t.projectId === projectId) {
      // Same project, different phase: cut the block, then paste it at the phase's end.
      await this.editFile(t.path, (lines, doc) => {
        const r = this.subtreeRange(lines, t);
        const block = lines.slice(r.start, r.end).map((l) => l.replace(/^[ \t]*/, (m) => m.slice(t.raw.indent.length)));
        lines.splice(r.start, r.end - r.start);
        const doc2 = parseDocument(lines.join(doc.eol));
        const ph = phaseId ? p.phases.find((x) => x.id === phaseId) : undefined;
        const heading = ph ? doc2.headings.find((h) => new RegExp(`^(phase|fase|stage|milestone)\\s*[:\\-–—]\\s*${escapeRe(ph.title)}`, 'i').test(h.text)) : undefined;
        const at = heading ? { index: sectionInsertPoint(doc2, heading), prefix: [] as string[] } : this.projectInsertPoint(lines, doc2, p, undefined);
        lines.splice(at.index, 0, ...at.prefix, ...block);
        return true;
      });
      return;
    }
    let carried: TaskLine[] = [];
    await this.editFile(t.path, (lines) => {
      const r = this.subtreeRange(lines, t);
      carried = lines.slice(r.start, r.end).map((l) => parseTaskLine(l)).filter((x): x is TaskLine => x !== undefined);
      if (t.origin === 'daily' && t.noteDate !== undefined && t.noteDate < this.today) {
        lines[r.start] = serialiseTaskLine(withStatus(this.lineOf(lines, t), 'forwarded', t.noteDate), { force: true });
      } else lines.splice(r.start, r.end - r.start);
      return true;
    });
    if (carried.length === 0) return;
    const baseIndent = carried[0]!.raw.indent;
    const head = carried[0]!;
    if (planned) { head.scheduled = planned; head.id = head.id ?? this.newTaskId(); }
    delete head.mirrorLink;
    const rebased = carried.map((l) => ({ ...l, raw: { ...l.raw, indent: l.raw.indent.slice(baseIndent.length), eol: '' } }));
    await this.editFile(p.path, (lines, doc) => {
      const at = this.projectInsertPoint(lines, doc, p, phaseId);
      lines.splice(at.index, 0, ...at.prefix, ...rebased.map((l) => serialiseTaskLine(l, { force: true })));
      return true;
    });
    if (planned && head.id) {
      const src = this.index.task(head.id);
      if (src) await this.editRegion(planned, (rc) => {
        const wasIn = DAY_PARTS.find((p) => rc[p].some((l) => (l.id && l.id === head.id) || l.text === head.text));
        removeLines(rc, (l) => (l.id !== undefined && l.id === head.id) || l.text === head.text);
        const target = wasIn ?? 'anytime';
        rc[target] = [...rc[target], this.mirrorLine(src)];
        return rc;
      });
    }
  }

  /* ── Day rituals ────────────────────────────────────────────────────── */

  /** Pull a set of tasks onto a day (each into a part of it) and sync the habits. */
  async planDay(date: IsoDate, items: (string | { key: string; part?: DayPart })[]): Promise<void> {
    await this.ensureDailyNote(date);
    await this.syncHabitsForDay(date);
    for (const it of items) {
      const key = typeof it === 'string' ? it : it.key;
      const part = typeof it === 'string' ? undefined : it.part;
      await this.schedule(key, date, part);
    }
  }

  /** Carry unfinished work from `from` to `to` (or off the calendar). */
  async rollover(from: IsoDate, to: IsoDate | undefined): Promise<{ moved: number; unscheduled: number }> {
    const snap = this.index.snapshot;
    const open = [...snap.tasks.values()].filter((t) => (t.origin === 'daily' || t.origin === 'daily-mirror') && t.noteDate === from && !['done', 'cancelled', 'forwarded'].includes(t.status) && t.depth === 0 && t.section !== 'outside' && misfiledDate(t) === undefined);
    let moved = 0;
    let unscheduled = 0;
    for (const t of open) {
      const cur = this.index.task(t.key);
      if (!cur) continue;
      if (cur.origin === 'daily-mirror') {
        const src = cur.mirrorOf ? this.index.task(cur.mirrorOf) : undefined;
        if (from < this.today) await this.writeLineStatus(cur.path, cur.line, 'forwarded', from);
        if (src) await this.schedule(src.key, to, cur.part); else if (to) await this.moveDailyTask(this.fresh(cur.key), to, cur.part);
      } else {
        await this.moveDailyTask(cur, to, cur.part);
      }
      if (to) moved++; else unscheduled++;
    }
    return { moved, unscheduled };
  }

  /* ── Projects ───────────────────────────────────────────────────────── */

  async createProject(spec: { title: string; status: ProjectStatus; priority: ProjectPriority; area?: string; parentId?: string; period?: string; goal?: string; start?: IsoDate; due?: IsoDate; tags?: string[]; phases?: { title: string; due?: IsoDate; tasks?: string[] }[]; tasks?: string[]; objective?: string }): Promise<Project> {
    const title = spec.title.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (title === '') throw new Error('A project needs a name');
    const parent = spec.parentId ? this.index.project(spec.parentId) : undefined;
    const root = parent ? this.index.projectFolderOf(parent) : this.settings.projectsFolder.replace(/\/+$/, '');
    const folder = `${root ? root + '/' : ''}${title}`;
    const path = `${folder}/${title}.md`;
    if (await this.d.vault.exists(path)) throw new Error(`A project note already exists at ${path}`);
    const id = uniqueId('prj', (x) => this.index.snapshot.projects.has(x), this.d.rng);
    const content = renderProjectNote({ id, title: spec.title.trim(), status: spec.status, priority: spec.priority, today: this.today, ...(spec.area ? { area: spec.area } : {}), ...(parent ? { parent: parent.title } : {}), ...(spec.period ? { period: spec.period } : {}), ...(spec.goal ? { goal: spec.goal } : {}), ...(spec.start ? { start: spec.start } : {}), ...(spec.due ? { due: spec.due } : {}), ...(spec.tags ? { tags: spec.tags } : {}), ...(spec.phases ? { phases: spec.phases } : {}), ...(spec.tasks ? { tasks: spec.tasks } : {}), ...(spec.objective ? { objective: spec.objective } : {}) });
    await this.createFile(path, content);
    // Assign ids to the created tasks so they can be planned right away.
    const p = this.index.project(id);
    if (!p) throw new Error('Project did not index');
    return p;
  }

  /** Drop every future mirror of the project's tasks (past notes stay as a record). */
  private async dropFutureMirrors(p: Project): Promise<void> {
    const keys = new Set([...p.phases.flatMap((ph) => ph.taskKeys), ...p.looseTaskKeys]);
    const days = new Map<IsoDate, Set<string>>();
    for (const m of this.index.allTasks()) if (m.origin === 'daily-mirror' && m.mirrorOf && keys.has(m.mirrorOf) && m.noteDate && m.noteDate >= this.today && m.id) days.set(m.noteDate, new Set([...(days.get(m.noteDate) ?? []), m.id]));
    for (const [d, ids] of days) await this.editRegion(d, (rc) => { removeLines(rc, (l) => l.id !== undefined && ids.has(l.id)); return rc; });
  }

  /** Move the project (its folder when it has one) into the archive folder; it leaves the index. */
  async archiveProject(id: string): Promise<string> {
    const p = this.index.project(id);
    if (!p) throw new Error('Project not found');
    if (!this.d.vault.rename) throw new Error('This vault cannot move files');
    await this.dropFutureMirrors(p);
    const src = p.folderNote ? p.folder : p.path;
    const dest = `${this.settings.archiveFolder.replace(/\/+$/, '')}/${baseName(src.endsWith('.md') ? src : src + '.md')}${src.endsWith('.md') ? '.md' : ''}`;
    if (await this.d.vault.exists(dest)) throw new Error(`Already in the archive: ${dest}`);
    await this.d.vault.rename(src, dest);
    for (const path of [...this.index.snapshot.tasksByPath.keys()]) if (path === src || path.startsWith(src + '/')) this.index.update(path, undefined);
    await this.index.rebuild();
    return dest;
  }

  /** Move the project (its folder when it has one) to the trash. */
  async deleteProject(id: string): Promise<void> {
    const p = this.index.project(id);
    if (!p) throw new Error('Project not found');
    if (!this.d.vault.trash) throw new Error('This vault cannot delete files');
    await this.dropFutureMirrors(p);
    const target = p.folderNote ? p.folder : p.path;
    await this.d.vault.trash(target);
    await this.index.rebuild();
  }

  async setProjectFields(id: string, fields: { status?: ProjectStatus; priority?: ProjectPriority; area?: string; due?: IsoDate | null; start?: IsoDate | null; title?: string; period?: string | null; goal?: string | null }): Promise<void> {
    const p = this.index.project(id);
    if (!p) throw new Error('Project not found');
    await this.editFile(p.path, (lines, doc) => {
      const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(doc.frontmatter.values, k);
      const pick = (cands: string[]): string => cands.find(has) ?? cands[0]!;
      const updates: Record<string, string | null> = {};
      if (fields.status) updates['status'] = fields.status;
      if (fields.priority) updates['priority'] = fields.priority;
      if (fields.area !== undefined) updates['area'] = fields.area;
      if (fields.title !== undefined) updates['title'] = fields.title;
      if (fields.due !== undefined) updates[pick(['due_date', 'due', 'deadline', 'target_date'])] = fields.due ?? '';
      if (fields.start !== undefined) updates[pick(['start_date', 'start'])] = fields.start ?? '';
      if (fields.period !== undefined) updates[pick(['period', 'horizon', 'quarter', 'month', 'year'])] = fields.period ?? '';
      if (fields.goal !== undefined) updates[pick(['goal', 'goals'])] = fields.goal ?? '';
      return setFrontmatter(lines, updates);
    });
  }

  async addPhase(projectId: string, title: string, due?: IsoDate): Promise<void> {
    const p = this.index.project(projectId);
    if (!p) throw new Error('Project not found');
    const heading = `## Phase: ${title.trim()}${due ? ` 📅 ${due}` : ''}`;
    await this.editFile(p.path, (lines, doc) => {
      // After the last phase, else before `## Tasks`, else at end.
      const last = p.phases[p.phases.length - 1];
      let at: number;
      if (last) at = last.endLine;
      else {
        const th = doc.headings.find((h) => /^tasks$/i.test(h.text.trim()));
        at = th ? th.line : lines.length;
      }
      while (at > 0 && at <= lines.length && lines[at - 1]!.trim() === '') at--;
      const after = at < lines.length && lines[at]!.trim() !== '' ? [''] : [];
      lines.splice(at, 0, '', heading, ...after);
      return true;
    });
  }

  async renamePhase(projectId: string, phaseId: string, title: string, due?: IsoDate | null): Promise<void> {
    const p = this.index.project(projectId);
    const ph = p?.phases.find((x) => x.id === phaseId);
    if (!p || !ph) throw new Error('Phase not found');
    await this.editFile(p.path, (lines) => {
      const m = /^(#+)\s+(phase|fase|stage|milestone)\s*[:\-–—]\s*/i.exec(lines[ph.headingLine] ?? '');
      const hashes = m ? m[1] : '##';
      const word = m ? m[2] : 'Phase';
      const d = due === null ? undefined : due ?? ph.due;
      lines[ph.headingLine] = `${hashes} ${word}: ${title.trim()}${d ? ` 📅 ${d}` : ''}`;
      return true;
    });
  }

  async appendLog(projectId: string, text: string): Promise<void> {
    const p = this.index.project(projectId);
    if (!p) throw new Error('Project not found');
    const entry = `- ${this.today} — ${text.trim()}`;
    await this.editFile(p.path, (lines, doc) => {
      const h = doc.headings.find((x) => /^(log|journal|notes)$/i.test(x.text.trim()));
      if (h) { lines.splice(sectionInsertPoint(doc, h), 0, entry); return true; }
      let e = lines.length;
      while (e > 0 && lines[e - 1]!.trim() === '') e--;
      lines.splice(e, lines.length - e, '', '## Log', '', entry, '');
      return true;
    });
  }

  async createHabit(spec: { title: string; schedule: string; targetPerWeek?: number; graceDays?: number; icon?: string }): Promise<void> {
    const folder = this.settings.habitsFolder.replace(/\/+$/, '');
    const title = spec.title.trim().replace(/[\\/:*?"<>|]/g, '-');
    const path = `${folder ? folder + '/' : ''}${title}.md`;
    if (await this.d.vault.exists(path)) throw new Error(`A note already exists at ${path}`);
    const id = uniqueId('hab', (x) => this.index.snapshot.habits.has(x), this.d.rng);
    await this.createFile(path, renderHabitNote({ id, title: spec.title.trim(), schedule: spec.schedule, today: this.today, ...(spec.targetPerWeek ? { targetPerWeek: spec.targetPerWeek } : {}), ...(spec.graceDays !== undefined ? { graceDays: spec.graceDays } : {}), ...(spec.icon ? { icon: spec.icon } : {}) }));
  }

  async setHabitFields(id: string, fields: { active?: boolean; schedule?: string; title?: string; targetPerWeek?: number | null; graceDays?: number; icon?: string }): Promise<void> {
    const h = this.index.snapshot.habits.get(id);
    if (!h) throw new Error('Habit not found');
    const u: Record<string, string | null> = {};
    if (fields.active !== undefined) u['active'] = String(fields.active);
    if (fields.schedule) u['schedule'] = fields.schedule;
    if (fields.title) u['title'] = fields.title;
    if (fields.targetPerWeek !== undefined) u['target_per_week'] = fields.targetPerWeek === null ? '' : String(fields.targetPerWeek);
    if (fields.graceDays !== undefined) u['grace_days'] = String(fields.graceDays);
    if (fields.icon !== undefined) u['icon'] = fields.icon;
    await this.editFile(h.path, (lines) => setFrontmatter(lines, u));
  }

  /* ── Horizons: goals in yearly / quarterly / monthly notes ───────────── */

  async ensurePeriodicNote(period: Period): Promise<string> {
    const path = this.index.periodicPath(period);
    if (await this.d.vault.exists(path)) return path;
    const tpl = this.d.periodicTemplate ? await this.d.periodicTemplate(period.kind) : undefined;
    const title = baseName(path);
    if (!tpl) { await this.createFile(path, `---\ntitle: ${title}\nperiod: ${period.key}\n---\n\n# ${period.label}\n\n${this.settings.goalsHeading}\n\n`); return path; }
    await this.createFromTemplate(path, tpl, period.start, title);
    return path;
  }

  /** Append a goal line under the Goals heading of the period's note (created when missing). */
  async addGoal(periodKey: string, text: string): Promise<string> {
    const period = parsePeriod(periodKey);
    if (!period) throw new Error(`Not a period: ${periodKey}`);
    const path = await this.ensurePeriodicNote(period);
    const id = uniqueId('gol', (x) => this.index.snapshot.tasks.has(x), this.d.rng);
    const want = this.settings.goalsHeading.replace(/^#+\s*/, '').trim().toLowerCase();
    await this.editFile(path, (lines, doc) => {
      const h = doc.headings.find((x) => x.text.trim().toLowerCase() === want) ?? doc.headings.find((x) => /^(goals?|objectives?|okrs?)$/i.test(x.text.trim()));
      const line = serialiseTaskLine(newTaskLine(text.trim(), { id, created: this.today }));
      if (h) { lines.splice(sectionInsertPoint(doc, h), 0, line); return true; }
      let e = lines.length;
      while (e > 0 && lines[e - 1]!.trim() === '') e--;
      lines.splice(e, lines.length - e, '', this.settings.goalsHeading, '', line, '');
      return true;
    });
    return id;
  }

  /** Bind a project to a goal (and to the goal's period when the project has none). */
  async linkProjectToGoal(projectId: string, goalKey: string | null): Promise<void> {
    const p = this.index.project(projectId);
    if (!p) throw new Error('Project not found');
    if (goalKey === null) { await this.setProjectFields(projectId, { goal: null }); return; }
    const g = this.index.goal(goalKey);
    if (!g) throw new Error('Goal not found');
    await this.setProjectFields(projectId, { goal: g.id, ...(p.period ? {} : { period: g.periodKey }) });
  }

  /**
   * Move every daily line that is dated later than its note — the next
   * occurrence Obsidian Tasks spawns when a recurring task is ticked — into
   * the note of that date, same part of the day, text untouched. Returns the
   * number of lines moved.
   */
  async moveMisfiled(opts: { onlyFuture?: boolean } = {}): Promise<number> {
    let moved = 0;
    for (const t0 of this.index.allTasks()) {
      const target = misfiledDate(t0);
      if (!target) continue;
      if (opts.onlyFuture && target < this.today) continue;
      const t = this.index.task(t0.key);
      if (!t || misfiledDate(t) !== target) continue;
      const part: DayPart = t.part ?? (t.time ? this.partOfTime(t.time.start) : 'anytime');
      let carried: TaskLine[] = [];
      await this.editFile(t.path, (lines) => {
        const { start, end } = this.subtreeRange(lines, t);
        carried = lines.slice(start, end).map((l) => parseTaskLine(l)).filter((x): x is TaskLine => x !== undefined);
        lines.splice(start, end - start);
        return true;
      });
      if (carried.length === 0) continue;
      const baseIndent = carried[0]!.raw.indent;
      const rebased = carried.map((l) => ({ ...l, raw: { ...l.raw, indent: l.raw.indent.slice(baseIndent.length), eol: '' } }));
      await this.editRegion(target, (rc) => ({ ...rc, [part]: [...rc[part], ...rebased] }));
      moved++;
    }
    return moved;
  }

  /* ── Reconcile: mirrors vs sources after outside edits ──────────────── */

  /**
   * Bring mirrors and sources back in line. Status: the more advanced wins.
   * Everything else flows source → mirror, for today and later only.
   * Returns the number of lines written.
   */
  async reconcile(): Promise<number> {
    const today = this.today;
    let writes = 0;
    if (this.settings.autoMoveRecurring) writes += await this.moveMisfiled({ onlyFuture: true });
    const mirrors = this.index.allTasks().filter((t) => t.origin === 'daily-mirror' && t.mirrorOf);
    for (const m0 of mirrors) {
      const m = this.index.task(m0.key);
      const src = m?.mirrorOf ? this.index.task(m.mirrorOf) : undefined;
      if (!m || !src || !m.noteDate) continue;
      if (m.status !== src.status) {
        const mr = STATUS_RANK[m.status];
        const sr = STATUS_RANK[src.status];
        if (mr > sr && m.status !== 'forwarded') { await this.writeLineStatus(src.path, src.line, m.status, m.done ?? m.cancelled ?? m.noteDate); writes++; if (m.status === 'done' && src.recurrence?.parsed) await this.spawnNextOccurrence(this.fresh(src.key)); }
        else if (sr > mr && m.noteDate >= today) { await this.writeLineStatus(m.path, m.line, src.status, src.done ?? src.cancelled ?? today); writes++; }
        continue;
      }
      if (m.noteDate < today) continue;
      const want = serialiseTaskLine(this.mirrorLine(this.fresh(src.key), m));
      const have = serialiseTaskLine({ ...m, raw: { ...m.raw, indent: '', eol: '' } }, { force: true });
      if (want !== have) {
        await this.editFile(m.path, (lines) => { lines[m.line] = m.raw.indent + want; return true; });
        writes++;
      }
    }
    return writes;
  }
}

/**
 * Daily-note template rendering: supports the core Daily Notes placeholders
 * (`{{date}}`, `{{date:FORMAT}}`, `{{title}}`, `{{time}}`) and the common
 * Templater tags (`<% tp.file.title %>`, `<% tp.date.now("FMT") %>`); any
 * other `<% … %>` block is removed rather than left as raw code.
 */
export function renderDailyTemplate(template: string | undefined, date: IsoDate, title: string): string {
  if (!template || template.trim() === '') return `---\ntitle: ${title}\ndate: ${date}\n---\n\n# ${title}\n\n`;
  let out = template;
  out = out.replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_, f: string) => formatDate(date, f.trim()));
  out = out.replace(/\{\{\s*date\s*\}\}/g, date);
  out = out.replace(/\{\{\s*title\s*\}\}/g, title);
  out = out.replace(/\{\{\s*time\s*\}\}/g, '');
  out = out.replace(/<%[-*_]?\s*tp\.file\.title\s*%>/g, title);
  // moment(tp.file.title, 'FMT').add(1, 'd').subtract(2, 'weeks').format('FMT') — with or without an assignment in front.
  out = out.replace(/<%[-*_]?\s*(?:[\w$]+\s*=\s*)?moment\((?:\s*tp\.file\.title\s*,\s*["'][^"']*["']\s*)?\)((?:\s*\.(?:add|subtract)\(\s*-?\d+\s*,\s*["'][A-Za-z]+["']\s*\))*)\s*\.format\(\s*["']([^"']*)["']\s*\)\s*%>/g, (_, chain: string, fmt: string) => {
    let d = date;
    for (const m of chain.matchAll(/\.(add|subtract)\(\s*(-?\d+)\s*,\s*["']([A-Za-z]+)["']\s*\)/g)) { const n = Number(m[2]) * (m[1] === 'subtract' ? -1 : 1); d = shiftDate(d, n, m[3]!); }
    return formatDate(d, fmt);
  });
  out = out.replace(/<%[-*_]?\s*tp\.date\.now\(\s*["']([^"']*)["']\s*(?:,\s*(-?\d+)\s*)?[^)]*\)\s*%>/g, (_, f: string, off?: string) => formatDate(off ? addDays(date, Number(off)) : date, f));
  out = out.replace(/<%[-*_]?\s*tp\.date\.tomorrow\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(addDays(date, 1), f));
  out = out.replace(/<%[-*_]?\s*tp\.date\.yesterday\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(addDays(date, -1), f));
  out = out.replace(/<%[-*_]?\s*tp\.file\.last_modified_date\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(date, f));
  out = out.replace(/<%[-*_]?\s*tp\.file\.creation_date\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(date, f));
  out = out.replace(/<%[\s\S]*?%>/g, '');
  return out;
}

function shiftDate(d: IsoDate, n: number, unit: string): IsoDate {
  const u = unit.toLowerCase();
  if (u.startsWith('d')) return addDays(d, n);
  if (u.startsWith('w')) return addDays(d, 7 * n);
  if (u === 'm' || u.startsWith('month')) return addMonths(d, n);
  if (u.startsWith('y')) return addMonths(d, 12 * n);
  return d;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
