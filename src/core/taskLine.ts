/**
 * Parse and serialise one Obsidian-Tasks-style line.
 *
 * Guarantees:
 *  - parsing is total: any line that looks like `- [x] …` yields a TaskLine
 *  - an untouched line serialises back byte-for-byte (we keep `raw.line`)
 *  - unknown metadata is kept and re-emitted
 */
import type { IsoDate, Priority, TaskLine, TaskStatus, TimeBlock, UnknownToken } from './types';
import { isIsoDate, parseEffort } from './dates';
import { formatRecurrence, parseRecurrence } from './recurrence';

export const TASK_LINE_RE = /^([ \t]*)([-*+]|\d+[.)])[ \t]+\[(.)\][ \t]+(.*?)(\r?\n?)$/;
/** A checkbox line with nothing after the marker still counts (empty task). */
const TASK_LINE_EMPTY_RE = /^([ \t]*)([-*+]|\d+[.)])[ \t]+\[(.)\][ \t]*(\r?\n?)$/;
export const LIST_ITEM_RE = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]/;

export const SYMBOLS = {
  id: '🆔',
  blocked: '⛔',
  created: '➕',
  start: '🛫',
  scheduled: '⏳',
  due: '📅',
  done: '✅',
  cancelled: '❌',
  recurrence: '🔁',
  link: '🔗',
  effort: '⏱️',
} as const;

const PRIORITY_SYMBOLS: Record<string, Priority> = { '🔺': 'highest', '⏫': 'high', '🔼': 'medium', '🔽': 'low', '⏬': 'lowest' };
export const PRIORITY_TO_SYMBOL: Record<Priority, string> = { highest: '🔺', high: '⏫', medium: '🔼', normal: '', low: '🔽', lowest: '⏬' };
export const PRIORITY_ORDER: Priority[] = ['highest', 'high', 'medium', 'normal', 'low', 'lowest'];

export function priorityRank(p: Priority): number {
  return PRIORITY_ORDER.indexOf(p);
}

const MARKER_STATUS: Record<string, TaskStatus> = { ' ': 'todo', '/': 'doing', x: 'done', X: 'done', '-': 'cancelled', '>': 'forwarded', '<': 'forwarded', '?': 'waiting' };
export const STATUS_MARKER: Record<TaskStatus, string> = { todo: ' ', doing: '/', done: 'x', cancelled: '-', forwarded: '>', waiting: '?' };

export function markerToStatus(marker: string): TaskStatus {
  return MARKER_STATUS[marker] ?? 'todo';
}

export function isTerminal(status: TaskStatus): boolean {
  return status === 'done' || status === 'cancelled';
}

const SYMBOL_ALT = ['🆔', '⛔', '➕', '🛫', '⏳', '📅', '✅', '❌', '🔁', '🔗', '⏱️', '⏱', '🔺', '⏫', '🔼', '🔽', '⏬']
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const SYMBOL_RE = new RegExp(`(${SYMBOL_ALT})`, 'gu');
const DATE_RE = /^\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/u;
const ID_RE = /^\s*([A-Za-z0-9][\w-]*)(?=\s|$)/u;
const IDS_RE = /^\s*([A-Za-z0-9][\w-]*(?:\s*,\s*[A-Za-z0-9][\w-]*)*)(?=\s|$)/u;
const LINK_RE = /^\s*(\[\[[^\]]+\]\])/u;
const EFFORT_RE = /^\s*((?:\d+h)?(?:\d+m)?)(?=\s|$)/u;
const TAG_RE = /(?:^|[\s(])#([\p{L}\p{N}_\-/]+)/gu;
const TIME_RE = /^(\d{1,2}:\d{2})\s*(?:-\s*(\d{1,2}:\d{2}))?\s*:?\s*(.*)$/u;

interface Token { symbol: string; value: string; start: number; end: number }

/** Returns undefined when the line is not a task line. */
export function parseTaskLine(line: string): TaskLine | undefined {
  let m = TASK_LINE_RE.exec(line);
  let body: string;
  if (m) body = m[4]!;
  else {
    m = TASK_LINE_EMPTY_RE.exec(line);
    if (!m) return undefined;
    body = '';
  }
  const indent = m[1]!;
  const bullet = m[2]!;
  const marker = m[3]!;
  const eol = m[m.length - 1]!;
  const status = markerToStatus(marker);

  // 1. Find candidate symbols and decide which are "usable" metadata.
  const tokens: Token[] = [];
  SYMBOL_RE.lastIndex = 0;
  let sm: RegExpExecArray | null;
  const candidates: { symbol: string; index: number }[] = [];
  while ((sm = SYMBOL_RE.exec(body)) !== null) candidates.push({ symbol: sm[1]!, index: sm.index });

  for (const c of candidates) {
    const after = body.slice(c.index + c.symbol.length);
    const tok = readValue(c.symbol, after, body, c.index);
    if (tok) tokens.push(tok);
  }
  // Recurrence values run until the next usable token: trim them now that we know all tokens.
  tokens.sort((a, b) => a.start - b.start);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t.symbol === '🔁') {
      const next = tokens[i + 1];
      const limit = next ? next.start : body.length;
      t.value = body.slice(t.start + t.symbol.length, limit).trim();
      t.end = limit;
      if (t.value === '') { tokens.splice(i, 1); i--; }
    }
  }

  const firstUsable = tokens[0]?.start ?? body.length;
  let text = body.slice(0, firstUsable).trim();

  // 2. Fields from tokens; gaps between tokens are unknown tokens.
  const out: TaskLine = {
    marker, status, text, tags: [], priority: 'normal', blockedBy: [], unknown: [],
    raw: { indent, bullet, eol, line },
  };
  let cursor = firstUsable;
  let prioritySeen = false;
  for (const t of tokens) {
    const gap = body.slice(cursor, t.start);
    pushUnknown(out.unknown, gap, cursor);
    cursor = t.end;
    switch (t.symbol) {
      case '🆔': if (out.id === undefined) out.id = t.value; else pushUnknown(out.unknown, body.slice(t.start, t.end), t.start); break;
      case '⛔': out.blockedBy.push(...t.value.split(/\s*,\s*/).filter(Boolean)); break;
      case '➕': out.created = t.value; break;
      case '🛫': out.start = t.value; break;
      case '⏳': out.scheduled = t.value; break;
      case '📅': out.due = t.value; break;
      case '✅': out.done = t.value; break;
      case '❌': out.cancelled = t.value; break;
      case '🔁': out.recurrence = parseRecurrence(t.value); break;
      case '🔗': out.mirrorLink = t.value; break;
      case '⏱️': case '⏱': out.effortRaw = t.value; out.effortMinutes = parseEffort(t.value); break;
      default: {
        const p = PRIORITY_SYMBOLS[t.symbol];
        if (p) {
          if (!prioritySeen) { out.priority = p; prioritySeen = true; }
          else pushUnknown(out.unknown, t.symbol, t.start);
        }
      }
    }
  }
  pushUnknown(out.unknown, body.slice(cursor), cursor);

  // 3. Time block prefix.
  const tm = TIME_RE.exec(text);
  if (tm) {
    out.time = { start: normTime(tm[1]!), ...(tm[2] ? { end: normTime(tm[2]) } : {}) };
    text = tm[3]!.trim();
    out.text = text;
  }

  // 4. Tags: from text and from unknown gaps.
  const tags = new Set<string>();
  for (const src of [out.text, ...out.unknown.map((u) => u.raw)]) {
    TAG_RE.lastIndex = 0;
    let tg: RegExpExecArray | null;
    while ((tg = TAG_RE.exec(src)) !== null) tags.add(tg[1]!.replace(/[.,;:!?]+$/u, ''));
  }
  out.tags = [...tags];
  return out;
}

function normTime(t: string): string {
  const [h, mm] = t.split(':');
  return `${String(Number(h)).padStart(2, '0')}:${mm}`;
}

function pushUnknown(list: UnknownToken[], raw: string, offset: number): void {
  const trimmed = raw.trim();
  if (trimmed === '') return;
  const lead = raw.length - raw.trimStart().length;
  list.push({ raw: trimmed, offset: offset + lead });
}

function readValue(symbol: string, after: string, body: string, index: number): Token | undefined {
  const start = index;
  const mk = (value: string, consumed: number): Token => ({ symbol, value, start, end: index + symbol.length + consumed });
  switch (symbol) {
    case '➕': case '🛫': case '⏳': case '📅': case '✅': case '❌': {
      const m = DATE_RE.exec(after);
      if (!m || !isIsoDate(m[1]!)) return undefined;
      return mk(m[1]!, m[0].length);
    }
    case '🆔': {
      const m = ID_RE.exec(after);
      return m ? mk(m[1]!, m[0].length) : undefined;
    }
    case '⛔': {
      const m = IDS_RE.exec(after);
      return m ? mk(m[1]!, m[0].length) : undefined;
    }
    case '🔗': {
      const m = LINK_RE.exec(after);
      return m ? mk(m[1]!, m[0].length) : undefined;
    }
    case '⏱️': case '⏱': {
      const m = EFFORT_RE.exec(after);
      if (!m || m[1] === '' || parseEffort(m[1]!) === undefined) return undefined;
      return mk(m[1]!, m[0].length);
    }
    case '🔁': {
      // Provisional: value trimmed later once all tokens are known.
      if (after.trim() === '') return undefined;
      return mk(after.trim(), after.length);
    }
    default:
      if (PRIORITY_SYMBOLS[symbol]) {
        // A priority symbol must stand alone (followed by whitespace or end).
        if (after !== '' && !/^\s/u.test(after)) return undefined;
        return mk('', 0);
      }
      return undefined;
  }
  void body;
}

export interface SerialiseOptions {
  /** Force a rebuild even when nothing changed (used after edits). */
  force?: boolean;
}

/** Canonical order, single spaces, completion dates last. */
export function serialiseTaskLine(t: TaskLine, opts: SerialiseOptions = {}): string {
  if (!opts.force && t.raw.line !== '' && parseEquals(t, parseTaskLine(t.raw.line))) return t.raw.line;
  const parts: string[] = [];
  let text = t.text.trim();
  if (t.time) text = `${t.time.start}${t.time.end ? ` - ${t.time.end}` : ''}: ${text}`;
  if (text !== '') parts.push(text);
  if (t.id) parts.push(`🆔 ${t.id}`);
  if (t.created) parts.push(`➕ ${t.created}`);
  if (t.start) parts.push(`🛫 ${t.start}`);
  if (t.scheduled) parts.push(`⏳ ${t.scheduled}`);
  if (t.due) parts.push(`📅 ${t.due}`);
  if (t.priority !== 'normal') parts.push(PRIORITY_TO_SYMBOL[t.priority]);
  if (t.recurrence) parts.push(`🔁 ${formatRecurrence(t.recurrence)}`);
  if (t.blockedBy.length > 0) parts.push(`⛔ ${t.blockedBy.join(', ')}`);
  if (t.mirrorLink) parts.push(`🔗 ${t.mirrorLink}`);
  if (t.effortRaw) parts.push(`⏱️ ${t.effortRaw}`);
  else if (t.effortMinutes !== undefined) parts.push(`⏱️ ${minutesToEffort(t.effortMinutes)}`);
  for (const u of t.unknown) parts.push(u.raw);
  if (t.done) parts.push(`✅ ${t.done}`);
  if (t.cancelled) parts.push(`❌ ${t.cancelled}`);
  const bullet = t.raw.bullet || '-';
  return `${t.raw.indent}${bullet} [${t.marker}] ${parts.join(' ')}${t.raw.eol}`;
}

export function minutesToEffort(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h > 0 ? `${h}h` : ''}${m > 0 || h === 0 ? `${m}m` : ''}`;
}

function parseEquals(a: TaskLine, b: TaskLine | undefined): boolean {
  if (!b) return false;
  const pick = (t: TaskLine): string => JSON.stringify([
    t.marker, t.text, t.id, t.priority, t.created, t.start, t.scheduled, t.due, t.done, t.cancelled,
    t.recurrence?.raw, t.blockedBy, t.effortRaw ?? t.effortMinutes, t.mirrorLink, t.time, t.unknown.map((u) => u.raw),
  ]);
  return pick(a) === pick(b);
}

/** Build a fresh TaskLine for a line the plugin creates. */
export function newTaskLine(text: string, fields: Partial<TaskLine> = {}, indent = ''): TaskLine {
  const status = fields.status ?? 'todo';
  return {
    marker: STATUS_MARKER[status],
    status,
    text,
    tags: [],
    priority: 'normal',
    blockedBy: [],
    unknown: [],
    ...fields,
    raw: { indent, bullet: '-', eol: '', line: '' },
  };
}

/** Change status and keep the ✅/❌ dates consistent. */
export function withStatus(t: TaskLine, status: TaskStatus, today: IsoDate): TaskLine {
  const next: TaskLine = { ...t, status, marker: STATUS_MARKER[status] };
  delete next.done;
  delete next.cancelled;
  if (status === 'done') next.done = today;
  if (status === 'cancelled') next.cancelled = today;
  return next;
}

export function displayText(t: TaskLine): string {
  return t.text.replace(/\s*#[\p{L}\p{N}_\-/]+/gu, (s) => s).trim();
}

export type { TimeBlock };
