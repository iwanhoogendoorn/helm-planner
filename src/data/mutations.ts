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
import { findRegion, isEmptyRegion, readRegion, writeRegion, type RegionContent } from '../core/dailyNote';
import { parseDocument, sectionInsertPoint, type Document } from '../core/document';
import { addDays, diffDays, formatDate } from '../core/dates';
import { nextOccurrence } from '../core/recurrence';
import { uniqueId } from '../core/ids';
import { setFrontmatter } from '../core/frontmatter';
import { renderProjectNote } from '../core/project';
import { renderHabitNote } from '../core/habit';
import { columnWidth } from '../core/tree';
import type { HelmIndex } from './index';
import { baseName, type VaultAdapter } from './vault';
import { habitDue } from './habits';

export interface MutationDeps {
  vault: VaultAdapter;
  index: HelmIndex;
  settings: () => HelmSettings;
  today: () => IsoDate;
  notify: (msg: string) => void;
  /** Daily-note template text, when configured. */
  dailyTemplate?: () => Promise<string | undefined>;
  rng?: () => number;
}

export interface AddTaskSpec {
  text: string;
  fields?: Partial<TaskLine>;
  projectId?: string;
  phaseId?: string;
  date?: IsoDate;
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
    const content = renderDailyTemplate(tpl, date, baseName(path));
    await this.createFile(path, content);
    return path;
  }

  private async editRegion(date: IsoDate, fn: (rc: RegionContent) => RegionContent | undefined): Promise<boolean> {
    const path = await this.ensureDailyNote(date);
    const content = await this.d.vault.read(path);
    const doc = parseDocument(content);
    const scan = findRegion(doc.lines);
    if (scan.broken) { this.d.notify(`Helm region in ${baseName(path)} is broken (no end marker) — not writing.`); return false; }
    const current: RegionContent = scan.region ? readRegion(doc.lines, scan.region) : { habits: [], today: [], projects: [], extra: [] };
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
      await this.editRegion(next, (rc) => ({ ...rc, today: [...rc.today, newTaskLine(t.text, fields)] }));
      return;
    }
    if (t.scheduled) fields.scheduled = addDays(t.scheduled, shift);
    await this.editFile(t.path, (lines) => {
      lines.splice(t.line, 0, serialiseTaskLine(newTaskLine(t.text, fields, t.raw.indent)));
      return true;
    });
  }

  /* ── Scheduling: the heart of "plan my day" ──────────────────────────── */

  /** Plan a task onto a day (or take it off every day when `date` is undefined). */
  async schedule(key: string, date: IsoDate | undefined): Promise<void> {
    let t = this.fresh(key);
    const today = this.today;
    if (t.origin === 'daily-mirror' && t.mirrorOf) {
      const src = this.index.task(t.mirrorOf);
      if (src) { await this.schedule(src.key, date); return; }
      // Orphan mirror: treat as a daily task.
    }
    if (t.origin === 'daily') { await this.moveDailyTask(t, date); return; }
    if (t.origin === 'inbox' && date !== undefined) { await this.moveLineToDay(t, date); return; }
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
    // Remove mirrors on other days (today or later). Past days keep their record.
    const days = new Set<IsoDate>();
    for (const m of this.index.mirrorsOf(t.key)) if (m.noteDate && m.noteDate !== date && m.noteDate >= today) days.add(m.noteDate);
    for (const d of days) await this.editRegion(d, (rc) => ({ ...rc, projects: rc.projects.filter((l) => l.id !== t.id) }));
    if (date !== undefined) {
      const src = t;
      await this.editRegion(date, (rc) => {
        const idx = rc.projects.findIndex((l) => l.id === src.id);
        const projects = [...rc.projects];
        const line = this.mirrorLine(src, idx >= 0 ? projects[idx] : undefined);
        if (idx >= 0) projects[idx] = line; else projects.push(line);
        return { ...rc, projects };
      });
    }
  }

  /** A daily-owned task moves between notes; leaving a past note marks it forwarded. */
  private async moveDailyTask(t: Task, date: IsoDate | undefined): Promise<void> {
    if (t.noteDate === date) return;
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
    const baseIndent = carried[0]!.raw.indent;
    const rebased = carried.map((l) => ({ ...l, status: l === carried[0] ? 'todo' as TaskStatus : l.status, marker: l === carried[0] ? ' ' : l.marker, raw: { ...l.raw, indent: l.raw.indent.slice(baseIndent.length), eol: '' } }));
    delete rebased[0]!.done;
    delete rebased[0]!.cancelled;
    if (date !== undefined) {
      await this.editRegion(date, (rc) => ({ ...rc, today: [...rc.today, ...rebased] }));
    } else {
      await this.appendToInbox(rebased);
    }
  }

  /** An inbox line moves into the day's note. */
  private async moveLineToDay(t: Task, date: IsoDate): Promise<void> {
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
    await this.editRegion(date, (rc) => ({ ...rc, today: [...rc.today, ...rebased] }));
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
    const fields: Partial<TaskLine> = { created: this.today, ...spec.fields };
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
        if (src) await this.editRegion(spec.date, (rc) => ({ ...rc, projects: [...rc.projects, this.mirrorLine(src)] }));
      }
      return;
    }
    if (spec.date) {
      delete fields.scheduled;
      await this.editRegion(spec.date, (rc) => ({ ...rc, today: [...rc.today, newTaskLine(spec.text, fields)] }));
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
      t = this.fresh(key);
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
    if (t.origin === 'daily-mirror') {
      await this.editFile(t.path, (lines) => { const r = this.subtreeRange(lines, t); lines.splice(r.start, r.end - r.start); return true; });
      return;
    }
    const days = new Set<IsoDate>();
    for (const m of this.index.mirrorsOf(t.key)) if (m.noteDate && m.noteDate >= this.today) days.add(m.noteDate);
    await this.editFile(t.path, (lines) => { const r = this.subtreeRange(lines, t); lines.splice(r.start, r.end - r.start); return true; });
    for (const d of days) await this.editRegion(d, (rc) => ({ ...rc, projects: rc.projects.filter((l) => l.id !== t.id) }));
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
        const projects = rc.projects.filter((l) => l.id !== head.id);
        return { ...rc, today: rc.today.filter((l) => !(l.id && l.id === head.id) && l.text !== head.text), projects: [...projects, this.mirrorLine(src)] };
      });
    }
  }

  /* ── Day rituals ────────────────────────────────────────────────────── */

  /** Pull a set of tasks onto a day and sync the habits. */
  async planDay(date: IsoDate, taskKeys: string[]): Promise<void> {
    await this.ensureDailyNote(date);
    await this.syncHabitsForDay(date);
    for (const k of taskKeys) await this.schedule(k, date);
  }

  /** Carry unfinished work from `from` to `to` (or off the calendar). */
  async rollover(from: IsoDate, to: IsoDate | undefined): Promise<{ moved: number; unscheduled: number }> {
    const snap = this.index.snapshot;
    const open = [...snap.tasks.values()].filter((t) => (t.origin === 'daily' || t.origin === 'daily-mirror') && t.noteDate === from && !['done', 'cancelled', 'forwarded'].includes(t.status) && t.depth === 0 && !(t.section === 'outside' && t.time && t.text === ''));
    let moved = 0;
    let unscheduled = 0;
    for (const t of open) {
      const cur = this.index.task(t.key);
      if (!cur) continue;
      if (cur.origin === 'daily-mirror') {
        const src = cur.mirrorOf ? this.index.task(cur.mirrorOf) : undefined;
        if (from < this.today) await this.writeLineStatus(cur.path, cur.line, 'forwarded', from);
        if (src) await this.schedule(src.key, to); else if (to) await this.moveDailyTask(this.fresh(cur.key), to);
      } else {
        await this.moveDailyTask(cur, to);
      }
      if (to) moved++; else unscheduled++;
    }
    return { moved, unscheduled };
  }

  /* ── Projects ───────────────────────────────────────────────────────── */

  async createProject(spec: { title: string; status: ProjectStatus; priority: ProjectPriority; area?: string; parentId?: string; start?: IsoDate; due?: IsoDate; tags?: string[]; phases?: { title: string; due?: IsoDate; tasks?: string[] }[]; tasks?: string[]; objective?: string }): Promise<Project> {
    const title = spec.title.trim().replace(/[\\/:*?"<>|]/g, '-');
    if (title === '') throw new Error('A project needs a name');
    const parent = spec.parentId ? this.index.project(spec.parentId) : undefined;
    const root = parent ? this.index.projectFolderOf(parent) : this.settings.projectsFolder.replace(/\/+$/, '');
    const folder = `${root ? root + '/' : ''}${title}`;
    const path = `${folder}/${title}.md`;
    if (await this.d.vault.exists(path)) throw new Error(`A project note already exists at ${path}`);
    const id = uniqueId('prj', (x) => this.index.snapshot.projects.has(x), this.d.rng);
    const content = renderProjectNote({ id, title: spec.title.trim(), status: spec.status, priority: spec.priority, today: this.today, ...(spec.area ? { area: spec.area } : {}), ...(parent ? { parent: parent.title } : {}), ...(spec.start ? { start: spec.start } : {}), ...(spec.due ? { due: spec.due } : {}), ...(spec.tags ? { tags: spec.tags } : {}), ...(spec.phases ? { phases: spec.phases } : {}), ...(spec.tasks ? { tasks: spec.tasks } : {}), ...(spec.objective ? { objective: spec.objective } : {}) });
    await this.createFile(path, content);
    // Assign ids to the created tasks so they can be planned right away.
    const p = this.index.project(id);
    if (!p) throw new Error('Project did not index');
    return p;
  }

  async setProjectFields(id: string, fields: { status?: ProjectStatus; priority?: ProjectPriority; area?: string; due?: IsoDate | null; start?: IsoDate | null; title?: string }): Promise<void> {
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

  /* ── Reconcile: mirrors vs sources after outside edits ──────────────── */

  /**
   * Bring mirrors and sources back in line. Status: the more advanced wins.
   * Everything else flows source → mirror, for today and later only.
   * Returns the number of lines written.
   */
  async reconcile(): Promise<number> {
    const today = this.today;
    let writes = 0;
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
  out = out.replace(/<%[-*_]?\s*tp\.date\.now\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(date, f));
  out = out.replace(/<%[-*_]?\s*tp\.file\.last_modified_date\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(date, f));
  out = out.replace(/<%[-*_]?\s*tp\.file\.creation_date\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(date, f));
  out = out.replace(/<%[\s\S]*?%>/g, '');
  return out;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
