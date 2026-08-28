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
import type { Habit, HabitColor, HabitPart, HelmSettings, IsoDate, Project, ProjectPriority, ProjectStatus, Task, TaskLine, TaskStatus } from '../core/types';
import { parseTaskLine, serialiseTaskLine, withStatus, newTaskLine, STATUS_MARKER } from '../core/taskLine';
import { DAY_PARTS, emptyContent, findRegion, isEmptyRegion, readRegion, removeLines, writeRegion, type DayPart, type RegionContent, type Section } from '../core/dailyNote';
import { parseDocument, sectionInsertPoint, type Document } from '../core/document';
import { addDays, addMonths, diffDays, formatDate } from '../core/dates';
import { formatRecurrence, nextOccurrence } from '../core/recurrence';
import { formatHistoryEntry, formatPauseEntry } from '../core/habit';
import { uniqueId } from '../core/ids';
import { setFrontmatter } from '../core/frontmatter';
import { renderProjectNote } from '../core/project';
import { renderHabitNote } from '../core/habit';
import { columnWidth } from '../core/tree';
import type { HelmIndex } from './index';
import { baseName, type VaultAdapter } from './vault';
import { habitDue, habitOccurrences } from './habits';
import { misfiledDate } from './planner';
import { parsePeriod, periodOf, type Period, type PeriodKind } from '../core/periods';
import { bundledTemplate, bundledDailyTemplate, type TemplateConfig } from '../core/periodicTemplates';
import { drawingTitle, renderExcalidrawDocument, type Drawing } from '../core/drawing';
import { noteTitle, renderNewNote, listValues, type NoteRef } from '../core/noteRef';
import type { DrawingTarget } from '../core/types';
import { addLinkToText, removeLinkFromText } from '../core/links';

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
  /** How long a template engine gets to react to a new file before Helm re-asserts a template note's content (ms). */
  templateSettleMs?: number;
  /** The Excalidraw plugin's own folder for new drawings, when it is installed. */
  excalidrawFolder?: () => string | undefined;
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
      // Render everything Helm understands first — the title, dates, moment() chains — so the result
      // never depends on which file Templater thinks it is working on (its on-create trigger and
      // this hand-off can run concurrently). Only what Helm cannot do (scripts, tp.web…) is left.
      await this.createFile(path, renderKnownTags(tpl, date, title));
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
    const label = (h: Habit): string => `${h.icon ? h.icon + ' ' : ''}${h.title}`;
    return this.editRegion(date, (rc) => {
      const next: RegionContent = { ...rc, habits: [...rc.habits], morning: [...rc.morning], afternoon: [...rc.afternoon], evening: [...rc.evening] };
      // Day-level habits live in the Habits section, in title order; parted habits get one line at the top of each of their parts.
      const movedToday = new Set((['morning', 'afternoon', 'evening'] as const).flatMap((p) => rc[p].filter((l) => (l.id ?? '').startsWith('hab-')).map((l) => l.id)));
      const dayLevel = habits.filter((h) => habitOccurrences(h)[0] === undefined && !movedToday.has(h.id)); // moved into a part for this day: leave it there
      const byId = new Map(rc.habits.map((l) => [l.id, l]));
      const lines: TaskLine[] = dayLevel.map((h) => { const ex = byId.get(h.id); return ex ? { ...ex, text: label(h) } : newTaskLine(label(h), { id: h.id }); });
      for (const l of rc.habits) if (!dayLevel.some((h) => h.id === l.id) && (l.status === 'done' || !habits.some((h) => h.id === l.id))) if (!lines.some((x) => x.id === l.id)) lines.push(l);
      next.habits = lines;
      for (const h of habits) {
        for (const part of h.parts ?? []) {
          const sec = next[part];
          const idx = sec.findIndex((l) => l.id === h.id);
          if (idx >= 0) { sec[idx] = { ...sec[idx]!, text: label(h) }; continue; }
          const at = sec.findIndex((l) => !(l.id ?? '').startsWith('hab-'));
          sec.splice(at === -1 ? sec.length : at, 0, newTaskLine(label(h), { id: h.id }));
        }
      }
      return next;
    });
  }

  /**
   * Put a day-level habit's line into a part of the day (or back into the Habits section) for this
   * date only: the line moves, its tick state travels with it, and other days are untouched.
   */
  async moveHabitForDay(habitId: string, date: IsoDate, part: HabitPart | undefined): Promise<void> {
    const h = this.index.snapshot.habits.get(habitId);
    if (h?.parts?.length) throw new Error('This habit already has fixed parts of the day; edit the habit to change them.');
    const label = h ? `${h.icon ? h.icon + ' ' : ''}${h.title}` : habitId;
    await this.ensureDailyNote(date);
    await this.editRegion(date, (rc) => {
      const sections = ['habits', 'morning', 'afternoon', 'evening'] as const;
      let line: TaskLine | undefined;
      const next: RegionContent = { ...rc };
      for (const s of sections) { const found = rc[s].find((l) => l.id === habitId); if (found && !line) line = found; next[s] = rc[s].filter((l) => l.id !== habitId); }
      const moved = line ?? newTaskLine(label, { id: habitId });
      if (part === undefined) next.habits = [...next.habits, moved];
      else { const list = [...next[part]]; const at = list.findIndex((l) => !(l.id ?? '').startsWith('hab-')); list.splice(at === -1 ? list.length : at, 0, moved); next[part] = list; }
      return next;
    });
  }

  /** Trash a habit note and take its lines out of today's note; past notes keep their record. */
  async deleteHabit(id: string): Promise<void> {
    const h = this.index.snapshot.habits.get(id);
    if (!h) throw new Error(`Unknown habit ${id}`);
    if (!this.d.vault.trash) throw new Error('This vault cannot trash files');
    if (await this.d.vault.exists(this.index.dailyPath(this.today))) {
      await this.editRegion(this.today, (rc) => ({ ...rc, habits: rc.habits.filter((l) => l.id !== id), morning: rc.morning.filter((l) => l.id !== id), afternoon: rc.afternoon.filter((l) => l.id !== id), evening: rc.evening.filter((l) => l.id !== id) }));
    }
    await this.d.vault.trash(h.path);
    this.index.update(h.path, undefined);
  }

  /** Tick, skip or untick one occurrence of a habit: the day-level line, or the line in a part of the day. */
  /**
   * Tick, skip or clear a habit for a day. `part` names the occurrence of a habit that has parts;
   * `opts.placeIn` puts a day-level habit's line into that part of the day when it is ticked, so a
   * habit you did this morning shows up — checked — among the morning's work.
   */
  async setHabitState(habitId: string, date: IsoDate, state: 'done' | 'skipped' | 'missed', part?: HabitPart, opts: { placeIn?: HabitPart } = {}): Promise<void> {
    const status: TaskStatus = state === 'done' ? 'done' : state === 'skipped' ? 'cancelled' : 'todo';
    const h = this.index.snapshot.habits.get(habitId);
    const label = h ? `${h.icon ? h.icon + ' ' : ''}${h.title}` : habitId;
    const dayLevel = !(h?.parts?.length);
    await this.editRegion(date, (rc) => {
      const parts = ['morning', 'afternoon', 'evening'] as const;
      // A day-level habit moved into a part of the day for this date is ticked where it sits.
      const moved = part === undefined && dayLevel ? parts.find((p) => rc[p].some((l) => l.id === habitId) && !rc.habits.some((l) => l.id === habitId)) : undefined;
      const placeIn = part === undefined && dayLevel && moved === undefined && state === 'done' ? opts.placeIn : undefined;
      const sec: Section = part ?? moved ?? placeIn ?? 'habits';
      const from = placeIn ? rc.habits.find((l) => l.id === habitId) : undefined;
      const list = [...rc[sec]];
      const idx = list.findIndex((l) => l.id === habitId);
      const base = idx >= 0 ? list[idx]! : from ?? newTaskLine(label, { id: habitId });
      const next = withStatus(base, status, date);
      if (idx >= 0) list[idx] = next;
      else if (part || placeIn) { const at = list.findIndex((l) => !(l.id ?? '').startsWith('hab-')); list.splice(at === -1 ? list.length : at, 0, next); }
      else list.push(next);
      // Placing it in a part takes it out of the general Habits list; it goes back there tomorrow.
      return { ...rc, [sec]: list, ...(placeIn ? { habits: rc.habits.filter((l) => l.id !== habitId) } : {}) };
    });
  }

  /* ── Ids ────────────────────────────────────────────────────────────── */

  private newTaskId(): string {
    return uniqueId('tsk', (id) => this.index.snapshot.tasks.has(id), this.d.rng);
  }

  /** Make sure a source task carries a 🆔; returns the id (never the index key, which may carry a `~n` suffix). */
  async ensureId(key: string): Promise<string> {
    const t = this.fresh(key);
    if (t.id) return t.id;
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
    if (date !== undefined) { const id = await this.ensureId(key); t = this.fresh(this.index.task(id)?.key ?? key); }
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
        // A past day keeps a record of what moved on: the task and its subtasks are marked forwarded,
        // never left open, or they would come back as carried-over work of their own.
        for (let i = start; i < end; i++) {
          const tl = parseTaskLine(lines[i]!);
          if (tl) lines[i] = serialiseTaskLine(withStatus(tl, 'forwarded', t.noteDate), { force: true });
        }
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
      if (spec.date) { id = fields.id ?? this.newTaskId(); fields.id = id; fields.scheduled = spec.date; }
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

  async createHabit(spec: { title: string; schedule: string; targetPerWeek?: number; graceDays?: number; icon?: string; iconImage?: string; parts?: HabitPart[]; color?: HabitColor }): Promise<string> {
    const folder = this.settings.habitsFolder.replace(/\/+$/, '');
    const title = spec.title.trim().replace(/[\\/:*?"<>|]/g, '-');
    const path = `${folder ? folder + '/' : ''}${title}.md`;
    if (await this.d.vault.exists(path)) throw new Error(`A note already exists at ${path}`);
    const id = uniqueId('hab', (x) => this.index.snapshot.habits.has(x), this.d.rng);
    await this.createFile(path, renderHabitNote({ id, title: spec.title.trim(), schedule: spec.schedule, today: this.today, ...(spec.targetPerWeek ? { targetPerWeek: spec.targetPerWeek } : {}), ...(spec.graceDays !== undefined ? { graceDays: spec.graceDays } : {}), ...(spec.icon ? { icon: spec.icon } : {}), ...(spec.iconImage ? { iconImage: spec.iconImage } : {}) , ...(spec.parts && spec.parts.length ? { parts: spec.parts } : {}), ...(spec.color ? { color: spec.color } : {}) }));
    return id;
  }

  /** Store an uploaded icon next to the habit notes: `<habitsFolder>/icons/<name>.png`. Returns the vault path. */
  async saveHabitIcon(name: string, data: ArrayBuffer, ext = 'png'): Promise<string> {
    if (!this.d.vault.writeBinary) throw new Error('This vault cannot store images');
    const folder = `${this.settings.habitsFolder.replace(/\/+$/, '')}/icons`;
    const base = name.trim().replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ') || 'habit';
    let path = `${folder}/${base}.${ext}`;
    for (let i = 2; await this.d.vault.exists(path); i++) path = `${folder}/${base} ${i}.${ext}`;
    await this.d.vault.writeBinary(path, data);
    return path;
  }

  async setHabitFields(id: string, fields: { active?: boolean; schedule?: string; title?: string; targetPerWeek?: number | null; graceDays?: number; icon?: string; iconImage?: string | null; parts?: HabitPart[]; color?: HabitColor | null }): Promise<void> {
    const h = this.index.snapshot.habits.get(id);
    if (!h) throw new Error('Habit not found');
    const u: Record<string, string | null> = {};
    if (fields.active !== undefined) u['active'] = String(fields.active);
    if (fields.schedule) u['schedule'] = fields.schedule;
    if (fields.title) u['title'] = fields.title;
    if (fields.targetPerWeek !== undefined) u['target_per_week'] = fields.targetPerWeek === null ? '' : String(fields.targetPerWeek);
    if (fields.graceDays !== undefined) u['grace_days'] = String(fields.graceDays);
    if (fields.icon !== undefined) u['icon'] = fields.icon;
    if (fields.iconImage !== undefined) u['icon_image'] = fields.iconImage ?? '';
    if (fields.parts !== undefined) (u as Record<string, string | string[] | null | undefined>)['parts'] = fields.parts.length ? fields.parts : undefined;
    // A changed schedule or parts closes the old definition at yesterday, so history is judged by the rules of its day.
    const newSchedule = fields.schedule !== undefined ? fields.schedule : formatRecurrence(h.schedule);
    const newParts = fields.parts !== undefined ? fields.parts : h.parts ?? [];
    const sameParts = newParts.length === (h.parts ?? []).length && newParts.every((x) => (h.parts ?? []).includes(x));
    if ((newSchedule !== formatRecurrence(h.schedule) || !sameParts) && (h.created === undefined || h.created < this.today)) {
      (u as Record<string, string | string[] | null | undefined>)['history'] = [...(h.history ?? []), { until: addDays(this.today, -1), schedule: h.schedule, ...(h.parts && h.parts.length ? { parts: h.parts } : {}) }].map(formatHistoryEntry);
    }
    // Pausing opens a span at today; resuming closes it at yesterday (a same-day flip leaves no span).
    if (fields.active !== undefined && fields.active !== h.active) {
      const spans = [...(h.pauses ?? [])];
      if (!fields.active) spans.push({ from: this.today });
      else { const open = spans.findIndex((s) => s.to === undefined); if (open !== -1) { if (spans[open]!.from >= this.today) spans.splice(open, 1); else spans[open] = { from: spans[open]!.from, to: addDays(this.today, -1) }; } }
      (u as Record<string, string | string[] | null | undefined>)['paused'] = spans.length ? spans.map(formatPauseEntry) : undefined;
    }
    if (fields.color !== undefined) (u as Record<string, string | string[] | null | undefined>)['color'] = fields.color ?? undefined;
    await this.editFile(h.path, (lines) => setFrontmatter(lines, u));
  }

  /* ── Follow-ups ────────────────────────────────────────────────────── */

  /**
   * Continue a task another day: a new task on `date` carrying the follow-up tag and
   * `⛔ <original id>` (blocked until the original is done), in the original's project and
   * phase when it has one, else in the day's note. Optionally ticks the original now.
   */
  async followUp(key: string, opts: { text?: string; date: IsoDate; part?: DayPart; markOriginalDone?: boolean; addTag?: boolean; fields?: Partial<TaskLine> }): Promise<{ id: string; date: IsoDate; followUpId: string }> {
    const id = await this.ensureId(key);
    const orig = this.fresh(this.index.task(id)?.key ?? key);
    const src = orig.mirrorOf ? this.fresh(orig.mirrorOf) : orig;
    // A task with subtasks is moved, never followed up: two copies of the same subtree is a mess nobody can reconcile.
    if (src.childKeys.length > 0) throw new Error('This task has subtasks — move it to another day instead of following it up.');
    const tag = (this.settings.followupTag.trim() || 'followup').replace(/^#/, '');
    let text = (opts.text?.trim() || src.text).trim();
    // The tag is only ever added when asked for; the ⛔ link is what makes it a follow-up.
    if (opts.addTag && !new RegExp(`(^|\\s)#${tag}(\\s|$)`).test(text)) text = `${text} #${tag}`;
    const followUpId = this.newTaskId();
    const fields: Partial<TaskLine> = { ...(opts.fields ?? {}), id: followUpId, blockedBy: [...new Set([...(opts.fields?.blockedBy ?? []), id])], priority: opts.fields?.priority ?? src.priority };
    if (src.projectId && src.origin === 'project') await this.addTask({ text, projectId: src.projectId, ...(src.phaseId ? { phaseId: src.phaseId } : {}), date: opts.date, ...(opts.part ? { part: opts.part } : {}), fields });
    else {
      const part = opts.part ?? (fields.time ? undefined : src.part && src.part !== 'anytime' ? src.part : undefined);
      await this.addTask({ text, date: opts.date, ...(part ? { part } : {}), fields });
    }
    // Whatever was attached to the original travels along: the same notes and drawings, now tied to both tasks.
    const from: DrawingTarget = { kind: 'task', key: src.key, id, title: src.text };
    const created = [...this.index.snapshot.tasks.values()].find((t) => t.id === followUpId && t.origin !== 'daily-mirror');
    if (created) {
      const to: DrawingTarget = { kind: 'task', key: created.key, id: followUpId, title: created.text };
      for (const d of this.index.drawingsFor(from)) if (d.kind === 'excalidraw') await this.linkDrawing(to, d.path);
      for (const n of this.index.notesFor(from)) await this.linkNote(to, n.path);
    }
    if (opts.markOriginalDone) await this.setStatus(src.key, 'done');
    return { id, date: opts.date, followUpId };
  }

  /* ── Links ─────────────────────────────────────────────────────────── */

  /** Add a `[label](url)` to the task text (a bare copy of the URL is upgraded in place). */
  async addLink(key: string, url: string, label?: string): Promise<void> {
    const t = this.fresh(key);
    const src = t.origin === 'daily-mirror' && t.mirrorOf && this.index.task(t.mirrorOf) ? this.fresh(t.mirrorOf) : t;
    await this.updateTask(src.key, { text: addLinkToText(src.text, url, label) });
  }

  async removeLink(key: string, url: string): Promise<void> {
    const t = this.fresh(key);
    const src = t.origin === 'daily-mirror' && t.mirrorOf && this.index.task(t.mirrorOf) ? this.fresh(t.mirrorOf) : t;
    await this.updateTask(src.key, { text: removeLinkFromText(src.text, url) });
  }

  /* ── Drawings ──────────────────────────────────────────────────────── */

  private safeName(s: string): string { return s.replace(/[\\/:*?"<>|#^[\]]/g, '-').replace(/\s+/g, ' ').trim(); }

  /** Frontmatter that ties a drawing to its target. */
  private drawingFrontmatter(target: DrawingTarget, id?: string): Record<string, string | string[] | boolean> {
    switch (target.kind) {
      case 'task': return { 'helm-task': id ?? target.id ?? target.key };
      case 'project': return { 'helm-project': target.id };
      case 'date': return { 'helm-date': target.date };
      case 'period': return { 'helm-period': target.key };
      case 'habit': return { 'helm-habit': target.id };
    }
  }

  /** The note a target is, or lives in, as a wikilink for a `related` property: the daily note, the periodic note, the project note, or the note holding the task. */
  relatedLink(target: DrawingTarget): string | undefined {
    if (target.kind === 'date') return `[[${formatDate(target.date, this.templateConfig().dailyTitleFormat)}]]`;
    if (target.kind === 'period') { const p = parsePeriod(target.key); return p ? `[[${baseName(this.index.periodicPath(p))}]]` : undefined; }
    if (target.kind === 'project') { const p = this.index.project(target.id); return p ? `[[${baseName(p.path)}]]` : undefined; }
    if (target.kind === 'habit') { const hb = this.index.snapshot.habits.get(target.id); return hb ? `[[${baseName(hb.path)}]]` : undefined; }
    const t = this.index.task(target.key) ?? (target.id ? [...this.index.snapshot.tasks.values()].find((x) => x.id === target.id && x.origin !== 'daily-mirror') : undefined);
    return t ? `[[${baseName(t.path)}]]` : undefined;
  }

  /** Frontmatter for a new attachment: the helm-* key plus `related` pointing back at the target's note. */
  private attachmentFrontmatter(target: DrawingTarget, id?: string): Record<string, string> {
    const fm = Object.fromEntries(Object.entries(this.drawingFrontmatter(target, id)).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]));
    const rel = this.relatedLink(target);
    return rel ? { ...fm, related: `"${rel}"` } : fm;
  }

  /** Add or remove a `related` wikilink on a note's frontmatter (a quoted link, or a list of them, as Obsidian expects). */
  private relatedUpdate(lines: string[], doc: Document, link: string | undefined, add: boolean): boolean {
    if (!link) return false;
    // A wikilink starts with `[[`, which must not be read as an inline YAML list.
    const raw = doc.frontmatter.values['related'];
    const cur = (Array.isArray(raw) ? raw.map(String) : typeof raw === 'string' && raw.trim() !== '' ? [raw] : []).map((x) => x.trim().replace(/^"|"$/g, ''));
    const next = add ? (cur.includes(link) ? cur : [...cur, link]) : cur.filter((x) => x !== link);
    if (next.length === cur.length) return false;
    lines.splice(0, lines.length, ...setFrontmatter(lines, { related: next.length === 0 ? undefined : next.length === 1 ? next[0]! : next }));
    return true;
  }

  /** Where an attachment of a target goes by default: the project's folder for a project or a task in one, else the general folder. */
  defaultFolderFor(target: DrawingTarget, kind: 'drawing' | 'note'): string {
    const s = this.settings;
    const general = kind === 'drawing' ? (s.drawingsFolder.trim() || this.d.excalidrawFolder?.() || 'Excalidraw') : (s.notesFolder.trim() || 'Notes');
    const inProject = kind === 'drawing' ? s.projectDrawingsInProjectFolder : s.projectNotesInProjectFolder;
    if (!inProject) return general.replace(/\/+$/, '');
    let project: Project | undefined;
    if (target.kind === 'project') project = this.index.project(target.id);
    if (target.kind === 'task') { const t = this.index.task(target.key) ?? (target.id ? [...this.index.snapshot.tasks.values()].find((x) => x.id === target.id && x.origin !== 'daily-mirror') : undefined); const src = t?.mirrorOf ? this.index.task(t.mirrorOf) : t; if (src?.projectId) project = this.index.project(src.projectId); }
    return (project ? this.index.projectFolderOf(project) || general : general).replace(/\/+$/, '');
  }

  /** The file stem: a name as given, else the target's own title (a task's text cut to 60 characters). */
  defaultStemFor(target: DrawingTarget, name?: string): string {
    if (name?.trim()) return this.safeName(name).slice(0, 120);
    const raw = target.kind === 'date' ? formatDate(target.date, this.templateConfig().dailyTitleFormat) : target.kind === 'period' ? target.key : target.title;
    // `[[Note|label]]` → label, `[[Note]]` → Note, `#tag` stays readable; then squash whitespace.
    const base = raw.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, t: string, l?: string) => (l ?? t).trim()).replace(/\s+/g, ' ').trim();
    const cut = base.length > 60 ? base.slice(0, 57).replace(/\s+\S*$/, '').trim() + '…' : base;
    return this.safeName(cut);
  }

  /** Folder and file name for a new drawing attached to a target; `folder` overrides the default. */
  drawingPathFor(target: DrawingTarget, name?: string, folder?: string): string {
    const dir = (folder?.trim() || this.defaultFolderFor(target, 'drawing')).replace(/\/+$/, '');
    return `${dir ? dir + '/' : ''}${this.defaultStemFor(target, name)}.excalidraw.md`;
  }

  private async uniquePath(path: string): Promise<string> {
    if (!(await this.d.vault.exists(path))) return path;
    const stem = path.replace(/\.excalidraw\.md$/, '');
    for (let i = 2; ; i++) { const p = `${stem} ${i}.excalidraw.md`; if (!(await this.d.vault.exists(p))) return p; }
  }

  /** Create a blank drawing for a target (through Excalidraw when present, else a minimal file) and embed it in the target's note. */
  async createDrawing(target: DrawingTarget, opts: { name?: string; folder?: string } = {}): Promise<string> {
    let id: string | undefined;
    if (target.kind === 'task') id = await this.ensureId(target.key);
    const path = await this.uniquePath(this.drawingPathFor(target, opts.name, opts.folder));
    const frontmatter: Record<string, string> = this.attachmentFrontmatter(target, id);
    const tplPath = this.settings.drawingTemplate.trim();
    let content: string | undefined;
    if (tplPath) {
      const p = tplPath.endsWith('.md') ? tplPath : `${tplPath}.md`;
      const tpl = await this.d.vault.read(p).catch(() => undefined);
      if (tpl !== undefined) content = setFrontmatter(tpl.split('\n'), Object.fromEntries(Object.entries(frontmatter).map(([k, v]) => [k, v.replace(/^"|"$/g, '')]))).join('\n');
    }
    content ??= renderExcalidrawDocument({ frontmatter });
    await this.d.vault.write(path, content);
    this.index.update(path, content);
    await this.embedDrawing(target, path);
    return path;
  }

  /** Put `![[X.excalidraw]]` under a Diagrams heading in the note the target lives in (project, daily or periodic note). */
  async embedDrawing(target: DrawingTarget, drawingPath: string): Promise<void> {
    if (!this.settings.embedDrawings || target.kind === 'task') return;
    let notePath: string | undefined;
    if (target.kind === 'project') notePath = this.index.project(target.id)?.path;
    else if (target.kind === 'habit') notePath = this.index.snapshot.habits.get(target.id)?.path;
    else if (target.kind === 'date') notePath = await this.ensureDailyNote(target.date);
    else { const p = parsePeriod(target.key); if (p) notePath = await this.ensurePeriodicNote(p); }
    if (!notePath) return;
    const embed = `![[${drawingTitle(drawingPath)}.excalidraw]]`;
    await this.editFile(notePath, (lines, doc) => {
      if (lines.some((l) => l.includes(embed))) return false;
      const h = doc.headings.find((x) => /^(diagrams?|drawings?|visuals?)$/i.test(x.text.trim()));
      if (h) { lines.splice(sectionInsertPoint(doc, h), 0, embed); return true; }
      let e = lines.length;
      while (e > 0 && lines[e - 1]!.trim() === '') e--;
      lines.splice(e, lines.length - e, '', '## Diagrams', '', embed, '');
      return true;
    });
  }

  drawingsFor(target: DrawingTarget): Drawing[] { return this.index.drawingsFor(target); }

  /** Take a drawing's embed line (and a Diagrams heading left empty) out of a note. */
  private async removeEmbed(notePath: string, drawingPath: string): Promise<void> {
    const needle = `[[${drawingTitle(drawingPath)}.excalidraw`;
    await this.editFile(notePath, (lines) => {
      let changed = false;
      for (let i = lines.length - 1; i >= 0; i--) { if (lines[i]!.includes(needle)) { lines.splice(i, 1); changed = true; } }
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/^#{1,6}\s+diagrams?\s*$/i.test(lines[i]!)) {
          let j = i + 1; while (j < lines.length && lines[j]!.trim() === '') j++;
          if (j >= lines.length || /^#{1,6}\s/.test(lines[j]!)) { lines.splice(i, j - i); changed = true; }
        }
      }
      return changed;
    });
  }

  /** Trash a drawing and take its embed lines out of the notes that carried them. */
  async deleteDrawing(path: string): Promise<void> {
    if (!this.d.vault.trash) throw new Error('This vault cannot trash files');
    for (const notePath of this.index.filesEmbedding(drawingTitle(path))) await this.removeEmbed(notePath, path);
    await this.d.vault.trash(path);
    this.index.update(path, undefined);
  }

  /** The note a target lives in (project note, daily note, periodic note); tasks have none of their own. */
  private async noteOf(target: DrawingTarget): Promise<string | undefined> {
    if (target.kind === 'project') return this.index.project(target.id)?.path;
    if (target.kind === 'habit') return this.index.snapshot.habits.get(target.id)?.path;
    if (target.kind === 'date') return this.index.dailyPath(target.date);
    if (target.kind === 'period') { const p = parsePeriod(target.key); return p ? this.index.periodicPath(p) : undefined; }
    return undefined;
  }

  /** Attach an existing drawing to a target: a helm-* frontmatter key on the drawing, plus the embed in the target's note. */
  async linkDrawing(target: DrawingTarget, drawingPath: string): Promise<void> {
    if (!drawingPath.endsWith('.md')) throw new Error('Only Excalidraw drawings (.excalidraw.md) can be linked; a canvas is attached by its folder or name');
    let id: string | undefined;
    if (target.kind === 'task') id = await this.ensureId(target.key);
    const [key, value] = Object.entries(this.drawingFrontmatter(target, id))[0]! as [string, string];
    await this.editFile(drawingPath, (lines, doc) => {
      const cur = doc.frontmatter.values[key];
      const have = Array.isArray(cur) ? cur.map(String) : typeof cur === 'string' && cur.trim() !== '' ? cur.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean) : [];
      if (have.includes(value)) return false;
      const next = [...have, value];
      lines.splice(0, lines.length, ...setFrontmatter(lines, { [key]: next.length === 1 ? next[0]! : next }));
      this.relatedUpdate(lines, parseDocument(lines.join('\n')), this.relatedLink(target), true);
      return true;
    });
    await this.embedDrawing(target, drawingPath);
  }

  /** Detach a drawing from a target: drop the helm-* key value and the embed line. Attachments by folder or name stay. */
  async unlinkDrawing(target: DrawingTarget, drawingPath: string): Promise<void> {
    const id = target.kind === 'task' ? (target.id ?? this.index.task(target.key)?.id) : undefined;
    const [key, value] = Object.entries(this.drawingFrontmatter(target, id))[0]! as [string, string];
    if (drawingPath.endsWith('.md')) {
      await this.editFile(drawingPath, (lines, doc) => {
        const cur = doc.frontmatter.values[key];
        const have = Array.isArray(cur) ? cur.map(String) : typeof cur === 'string' && cur.trim() !== '' ? cur.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim()).filter(Boolean) : [];
        const own = 'key' in target ? target.key : '';
        const next = have.filter((x) => x !== value && x !== own);
        if (next.length === have.length) return false;
        lines.splice(0, lines.length, ...setFrontmatter(lines, { [key]: next.length === 0 ? undefined : next.length === 1 ? next[0]! : next }));
        this.relatedUpdate(lines, parseDocument(lines.join('\n')), this.relatedLink(target), false);
        return true;
      });
    }
    const note = await this.noteOf(target);
    if (note && (await this.d.vault.exists(note))) await this.removeEmbed(note, drawingPath);
  }

  /* ── Setup helpers ─────────────────────────────────────────────────── */

  /** Create a folder when it is missing. Returns true when something was created. */
  async ensureFolder(path: string): Promise<boolean> {
    const p = path.replace(/\/+$/, '');
    if (p === '' || (await this.d.vault.exists(p))) return false;
    if (this.d.vault.createFolder) await this.d.vault.createFolder(p);
    else await this.d.vault.write(`${p}/.keep.md`, '');
    return true;
  }

  /** Create the inbox note when it is missing. */
  async ensureInboxNote(): Promise<boolean> {
    const p = this.settings.inboxNote;
    if (await this.d.vault.exists(p)) return false;
    await this.createFile(p, '# Inbox\n\n');
    return true;
  }

  /** Write Helm's daily note template to a path (never over an existing note unless told to). */
  async writeDailyTemplate(path: string, opts: { replace?: boolean } = {}): Promise<'created' | 'replaced' | 'skipped'> {
    const exists = await this.d.vault.exists(path);
    if (exists && !opts.replace) return 'skipped';
    const content = bundledDailyTemplate(this.templateConfig());
    await this.d.vault.write(path, content);
    if (!exists && this.d.processTemplate) {
      const settle = this.d.templateSettleMs ?? 2000;
      for (let i = 0; i < 2; i++) { await new Promise((r) => setTimeout(r, settle)); if ((await this.d.vault.read(path)) === content) break; await this.d.vault.write(path, content); }
    }
    return exists ? 'replaced' : 'created';
  }

  /* ── Notes attached to tasks / projects / days / periods ──────────── */

  notesFor(target: DrawingTarget): NoteRef[] { return this.index.notesFor(target); }

  /** Folder and file name for a new note attached to a target; `folder` overrides the default. */
  notePathFor(target: DrawingTarget, name?: string, folder?: string): string {
    const dir = (folder?.trim() || this.defaultFolderFor(target, 'note')).replace(/\/+$/, '');
    return `${dir ? dir + '/' : ''}${this.defaultStemFor(target, name)}.md`;
  }

  private async uniqueNotePath(path: string): Promise<string> {
    if (!(await this.d.vault.exists(path))) return path;
    const stem = path.replace(/\.md$/, '');
    for (let i = 2; ; i++) { const p = `${stem} ${i}.md`; if (!(await this.d.vault.exists(p))) return p; }
  }

  /** What a note's "For:" line points at. */
  private async forLabel(target: DrawingTarget): Promise<string> {
    if (target.kind === 'task') return target.title;
    const note = await this.noteOf(target);
    return note ? `[[${noteTitle(note)}]]` : target.title;
  }

  /** Create a note for a target, with the attachment key in its frontmatter, and link it from the target's note. */
  async createNote(target: DrawingTarget, opts: { name?: string; folder?: string } = {}): Promise<string> {
    let id: string | undefined;
    if (target.kind === 'task') { id = await this.ensureId(target.key); target = { ...target, key: this.index.task(id)?.key ?? id, id }; }
    const path = await this.uniqueNotePath(this.notePathFor(target, opts.name, opts.folder));
    const fm = this.attachmentFrontmatter(target, id);
    const content = renderNewNote({ title: noteTitle(path), target: fm, forLabel: await this.forLabel(target), today: this.today });
    await this.d.vault.write(path, content);
    this.index.update(path, content);
    await this.linkInTargetNote(target, path);
    return path;
  }

  /** `- [[Note]]` under a Notes heading in the target's own note (project, daily, periodic); tasks keep their line as is. */
  private async linkInTargetNote(target: DrawingTarget, notePath: string): Promise<void> {
    if (!this.settings.linkNotes || target.kind === 'task') return;
    let host: string | undefined;
    if (target.kind === 'project') host = this.index.project(target.id)?.path;
    else if (target.kind === 'habit') host = this.index.snapshot.habits.get(target.id)?.path;
    else if (target.kind === 'date') host = await this.ensureDailyNote(target.date);
    else { const p = parsePeriod(target.key); if (p) host = await this.ensurePeriodicNote(p); }
    if (!host || host === notePath) return;
    const link = `- [[${noteTitle(notePath)}]]`;
    await this.editFile(host, (lines, doc) => {
      if (lines.some((l) => l.includes(`[[${noteTitle(notePath)}]]`) || l.includes(`[[${noteTitle(notePath)}|`))) return false;
      const h = doc.headings.find((x) => /^(notes?|related|links?)$/i.test(x.text.trim()));
      if (h) { lines.splice(sectionInsertPoint(doc, h), 0, link); return true; }
      let e = lines.length;
      while (e > 0 && lines[e - 1]!.trim() === '') e--;
      lines.splice(e, lines.length - e, '', '## Notes', '', link, '');
      return true;
    });
  }

  private async removeNoteLink(host: string, notePath: string): Promise<void> {
    const t = noteTitle(notePath);
    await this.editFile(host, (lines) => {
      let changed = false;
      for (let i = lines.length - 1; i >= 0; i--) { if (/^\s*[-*]\s+!?\[\[/.test(lines[i]!) && (lines[i]!.includes(`[[${t}]]`) || lines[i]!.includes(`[[${t}|`))) { lines.splice(i, 1); changed = true; } }
      for (let i = lines.length - 1; i >= 0; i--) {
        if (/^#{1,6}\s+(notes?|related|links?)\s*$/i.test(lines[i]!)) {
          let j = i + 1; while (j < lines.length && lines[j]!.trim() === '') j++;
          if (j >= lines.length || /^#{1,6}\s/.test(lines[j]!)) { lines.splice(i, j - i); changed = true; }
        }
      }
      return changed;
    });
  }

  /** Attach an existing note: the key on the note's frontmatter (created when missing), plus the link in the target's note. */
  async linkNote(target: DrawingTarget, notePath: string): Promise<void> {
    let id: string | undefined;
    if (target.kind === 'task') { id = await this.ensureId(target.key); target = { ...target, key: this.index.task(id)?.key ?? id, id }; }
    const [key, value] = Object.entries(this.drawingFrontmatter(target, id))[0]! as [string, string];
    await this.editFile(notePath, (lines, doc) => {
      const have = listValues(doc.frontmatter.values[key]);
      if (have.includes(value)) return false;
      const next = [...have, value];
      lines.splice(0, lines.length, ...setFrontmatter(lines, { [key]: next.length === 1 ? next[0]! : next }));
      this.relatedUpdate(lines, parseDocument(lines.join('\n')), this.relatedLink(target), true);
      return true;
    });
    await this.linkInTargetNote(target, notePath);
  }

  /** Detach a note from a target: drop the key value and the link line. A link inside the task's own text is left alone. */
  async unlinkNote(target: DrawingTarget, notePath: string): Promise<void> {
    const id = target.kind === 'task' ? (target.id ?? this.index.task(target.key)?.id) : undefined;
    const [key, value] = Object.entries(this.drawingFrontmatter(target, id))[0]! as [string, string];
    await this.editFile(notePath, (lines, doc) => {
      const have = listValues(doc.frontmatter.values[key]);
      const own = 'key' in target ? target.key : '';
      const next = have.filter((x) => x !== value && x !== own);
      if (next.length === have.length) return false;
      lines.splice(0, lines.length, ...setFrontmatter(lines, { [key]: next.length === 0 ? undefined : next.length === 1 ? next[0]! : next }));
      this.relatedUpdate(lines, parseDocument(lines.join('\n')), this.relatedLink(target), false);
      return true;
    });
    const host = await this.noteOf(target);
    if (host && (await this.d.vault.exists(host))) await this.removeNoteLink(host, notePath);
  }

  /** Trash a note and take its link lines out of the notes that carried them. */
  async deleteNote(path: string): Promise<void> {
    if (!this.d.vault.trash) throw new Error('This vault cannot trash files');
    for (const host of this.index.filesLinkingNote(noteTitle(path))) await this.removeNoteLink(host, path);
    await this.d.vault.trash(path);
    this.index.update(path, undefined);
  }

  /* ── Horizons: goals in yearly / quarterly / monthly notes ───────────── */

  /** What the built-in templates need to know about this vault. */
  templateConfig(): TemplateConfig {
    const df = this.index.dailyFormat();
    return {
      formats: { year: this.index.periodicConfig('year').format, quarter: this.index.periodicConfig('quarter').format, month: this.index.periodicConfig('month').format, week: this.index.periodicConfig('week').format },
      dailyTitleFormat: df.slice(df.lastIndexOf('/') + 1),
      goalsHeading: this.settings.goalsHeading,
    };
  }

  /** The template text used for a kind: the configured one, else Helm's built-in. */
  async periodicTemplate(kind: PeriodKind): Promise<string> {
    const configured = this.d.periodicTemplate ? await this.d.periodicTemplate(kind) : undefined;
    return configured ?? bundledTemplate(kind, this.templateConfig());
  }

  async ensurePeriodicNote(period: Period): Promise<string> {
    const path = this.index.periodicPath(period);
    if (await this.d.vault.exists(path)) return path;
    await this.createFromTemplate(path, await this.periodicTemplate(period.kind), period.start, baseName(path));
    return path;
  }

  /** Make sure the notes for today's week, month, quarter and year exist. Returns the paths created. */
  async ensureCurrentPeriodicNotes(date: IsoDate = this.today): Promise<string[]> {
    const created: string[] = [];
    for (const kind of ['year', 'quarter', 'month', 'week'] as PeriodKind[]) {
      const p = periodOf(date, kind);
      const path = this.index.periodicPath(p);
      if (await this.d.vault.exists(path)) continue;
      await this.ensurePeriodicNote(p);
      created.push(path);
    }
    return created;
  }

  /** Write Helm's built-in template for a kind to a note. Skips an existing note unless told to replace it. */
  async writeTemplateNote(kind: PeriodKind, path: string, opts: { replace?: boolean } = {}): Promise<'created' | 'replaced' | 'skipped'> {
    const exists = await this.d.vault.exists(path);
    if (exists && !opts.replace) return 'skipped';
    const content = bundledTemplate(kind, this.templateConfig());
    await this.d.vault.write(path, content);
    if (!exists && this.d.processTemplate) {
      // Templater's "trigger on new file creation" renders any new file holding <% %> tags — including a
      // template note, which would destroy it. Let it have its go, then put the template back (a modify,
      // which it leaves alone), and check once more.
      const settle = this.d.templateSettleMs ?? 2000;
      for (let i = 0; i < 2; i++) {
        await new Promise((r) => setTimeout(r, settle));
        if ((await this.d.vault.read(path)) === content) break;
        await this.d.vault.write(path, content);
      }
    }
    return exists ? 'replaced' : 'created';
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
  let out = renderKnownTags(template, date, title);
  // Script blocks (<%* … %>) need a real Templater; they are dropped here, as is anything else unknown.
  out = out.replace(/<%\*[\s\S]*?%>/g, '');
  out = out.replace(/<%[\s\S]*?%>/g, '');
  return out;
}

/** Fill in the tags Helm understands and leave the rest for a template engine. */
export function renderKnownTags(template: string, date: IsoDate, title: string): string {
  let out = template;
  out = out.replace(/\{\{\s*date\s*:\s*([^}]+?)\s*\}\}/g, (_, f: string) => formatDate(date, f.trim()));
  out = out.replace(/\{\{\s*date\s*\}\}/g, date);
  out = out.replace(/\{\{\s*title\s*\}\}/g, title);
  out = out.replace(/\{\{\s*time\s*\}\}/g, '');
  out = out.replace(/<%[-*_]?\s*tp\.file\.title\s*%>/g, title);
  // moment(tp.file.title, 'FMT').add(1, 'd').subtract(2, 'weeks').format('FMT') — with or without an assignment in front.
  out = out.replace(/<%[-_]?\s*(?:[\w$]+\s*=\s*)?moment\((?:\s*tp\.file\.title\s*,\s*["'][^"']*["']\s*)?\)((?:\s*\.(?:add|subtract|startOf|endOf)\((?:\s*-?\d+\s*,)?\s*["'][A-Za-z]+["']\s*\))*)\s*\.format\(\s*["']([^"']*)["']\s*\)\s*%>/g, (_, chain: string, fmt: string) => {
    let d = date;
    for (const m of chain.matchAll(/\.(add|subtract|startOf|endOf)\((?:\s*(-?\d+)\s*,)?\s*["']([A-Za-z]+)["']\s*\)/g)) {
      if (m[1] === 'startOf' || m[1] === 'endOf') d = boundaryOf(d, m[3]!, m[1] === 'endOf');
      else { const n = Number(m[2] ?? 0) * (m[1] === 'subtract' ? -1 : 1); d = shiftDate(d, n, m[3]!); }
    }
    return formatDate(d, fmt);
  });
  out = out.replace(/<%[-*_]?\s*tp\.date\.now\(\s*["']([^"']*)["']\s*(?:,\s*(-?\d+)\s*)?[^)]*\)\s*%>/g, (_, f: string, off?: string) => formatDate(off ? addDays(date, Number(off)) : date, f));
  out = out.replace(/<%[-*_]?\s*tp\.date\.tomorrow\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(addDays(date, 1), f));
  out = out.replace(/<%[-*_]?\s*tp\.date\.yesterday\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(addDays(date, -1), f));
  out = out.replace(/<%[-*_]?\s*tp\.file\.last_modified_date\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(date, f));
  out = out.replace(/<%[-*_]?\s*tp\.file\.creation_date\(\s*["']([^"']*)["'][^)]*\)\s*%>/g, (_, f: string) => formatDate(date, f));
  // Any remaining reference to the title (inside scripts, say) becomes a literal, so Templater cannot get it wrong.
  out = out.replace(/\btp\.file\.title\b/g, JSON.stringify(title));
  return out;
}

function shiftDate(d: IsoDate, n: number, unit: string): IsoDate {
  const u = unit.toLowerCase();
  if (u.startsWith('d')) return addDays(d, n);
  if (u.startsWith('w')) return addDays(d, 7 * n);
  if (u === 'q' || u.startsWith('quarter')) return addMonths(d, 3 * n);
  if (u === 'm' || u.startsWith('month')) return addMonths(d, n);
  if (u.startsWith('y')) return addMonths(d, 12 * n);
  return d;
}

/** moment().startOf / endOf for the units the templates use (week = ISO week, Monday first). */
function boundaryOf(d: IsoDate, unit: string, end: boolean): IsoDate {
  const u = unit.toLowerCase();
  const y = Number(d.slice(0, 4));
  const mo = Number(d.slice(5, 7));
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const lastDay = (yy: number, mm: number): string => `${yy}-${p2(mm)}-${p2(new Date(Date.UTC(yy, mm, 0)).getUTCDate())}`;
  if (u.startsWith('isoweek') || u.startsWith('week')) { const monday = addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7)); return end ? addDays(monday, 6) : monday; }
  if (u.startsWith('month')) return end ? lastDay(y, mo) : `${y}-${p2(mo)}-01`;
  if (u.startsWith('quarter')) { const q0 = Math.floor((mo - 1) / 3) * 3 + 1; return end ? lastDay(y, q0 + 2) : `${y}-${p2(q0)}-01`; }
  if (u.startsWith('year')) return end ? `${y}-12-31` : `${y}-01-01`;
  return d;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
