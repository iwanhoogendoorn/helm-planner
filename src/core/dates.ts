/**
 * Civil date arithmetic on `YYYY-MM-DD` strings. No timezones, no Date objects
 * escaping this module. Every function is pure.
 */
import type { IsoDate } from './types';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoDate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  return d >= 1 && d <= daysInMonth(y, mo);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function toUtc(d: IsoDate): Date {
  const m = ISO_RE.exec(d);
  if (!m) throw new Error(`Not an ISO date: ${d}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export function fromUtc(d: Date): IsoDate {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

export function addDays(d: IsoDate, n: number): IsoDate {
  const u = toUtc(d);
  u.setUTCDate(u.getUTCDate() + n);
  return fromUtc(u);
}

export function addMonths(d: IsoDate, n: number): IsoDate {
  const u = toUtc(d);
  const day = u.getUTCDate();
  u.setUTCDate(1);
  u.setUTCMonth(u.getUTCMonth() + n);
  const max = daysInMonth(u.getUTCFullYear(), u.getUTCMonth() + 1);
  u.setUTCDate(Math.min(day, max));
  return fromUtc(u);
}

export function addYears(d: IsoDate, n: number): IsoDate {
  return addMonths(d, n * 12);
}

/** Days from a to b (b - a). */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return Math.round((toUtc(b).getTime() - toUtc(a).getTime()) / 86400000);
}

export function compareDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(d: IsoDate): number {
  const w = toUtc(d).getUTCDay();
  return w === 0 ? 7 : w;
}

/** Start of the week containing d. */
export function startOfWeek(d: IsoDate, weekStartsOn: 1 | 7 = 1): IsoDate {
  const wd = isoWeekday(d);
  const offset = weekStartsOn === 1 ? wd - 1 : wd % 7;
  return addDays(d, -offset);
}

export function startOfMonth(d: IsoDate): IsoDate {
  return `${d.slice(0, 7)}-01`;
}

export function endOfMonth(d: IsoDate): IsoDate {
  const y = Number(d.slice(0, 4));
  const m = Number(d.slice(5, 7));
  return `${d.slice(0, 7)}-${String(daysInMonth(y, m)).padStart(2, '0')}`;
}

/** ISO-8601 week number and week-year. */
export function isoWeek(d: IsoDate): { year: number; week: number } {
  const u = toUtc(d);
  const day = (u.getUTCDay() + 6) % 7; // Mon=0
  u.setUTCDate(u.getUTCDate() - day + 3); // Thursday of this week
  const year = u.getUTCFullYear();
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const week = 1 + Math.round(((u.getTime() - jan4.getTime()) / 86400000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return { year, week };
}

export function todayLocal(now: Date = new Date()): IsoDate {
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export const WEEKDAY_NAMES = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** Human label: "Wed 26 Aug" or "Today"/"Tomorrow"/"Yesterday" relative to `today`. */
export function humanDate(d: IsoDate, today?: IsoDate, opts: { year?: boolean } = {}): string {
  if (today) {
    const diff = diffDays(today, d);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Tomorrow';
    if (diff === -1) return 'Yesterday';
  }
  const u = toUtc(d);
  const wd = WEEKDAY_SHORT[(u.getUTCDay() + 6) % 7];
  const base = `${wd} ${u.getUTCDate()} ${MONTH_SHORT[u.getUTCMonth()]}`;
  return opts.year || (today && d.slice(0, 4) !== today.slice(0, 4)) ? `${base} ${u.getUTCFullYear()}` : base;
}

/** "in 3 days", "2 days ago", "today". */
export function relativeDays(d: IsoDate, today: IsoDate): string {
  const n = diffDays(today, d);
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  if (n > 0) return n < 14 ? `in ${n} days` : n < 60 ? `in ${Math.round(n / 7)} weeks` : `in ${Math.round(n / 30)} months`;
  const a = -n;
  return a < 14 ? `${a} days ago` : a < 60 ? `${Math.round(a / 7)} weeks ago` : `${Math.round(a / 30)} months ago`;
}

/**
 * Format a date with a moment-like pattern. Supports the tokens the Daily
 * Notes / Periodic Notes plugins commonly use: YYYY YY MM M MMMM MMM DD D
 * dddd ddd ww w gggg, plus `[literal]` escapes.
 */
export function formatDate(d: IsoDate, pattern: string): string {
  const u = toUtc(d);
  const y = u.getUTCFullYear();
  const mo = u.getUTCMonth();
  const day = u.getUTCDate();
  const wdIdx = (u.getUTCDay() + 6) % 7;
  const wk = isoWeek(d);
  const p2 = (n: number): string => String(n).padStart(2, '0');
  const tokens: Record<string, string> = {
    YYYY: String(y),
    YY: String(y).slice(2),
    MMMM: MONTH_NAMES[mo] ?? '',
    MMM: MONTH_SHORT[mo] ?? '',
    MM: p2(mo + 1),
    M: String(mo + 1),
    DD: p2(day),
    D: String(day),
    dddd: WEEKDAY_NAMES[wdIdx] ? capitalize(WEEKDAY_NAMES[wdIdx]!) : '',
    ddd: WEEKDAY_SHORT[wdIdx] ?? '',
    gggg: String(wk.year),
    GGGG: String(wk.year),
    ww: p2(wk.week),
    WW: p2(wk.week),
    w: String(wk.week),
    W: String(wk.week),
  };
  let out = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '[') {
      const close = pattern.indexOf(']', i);
      if (close === -1) { out += pattern.slice(i); break; }
      out += pattern.slice(i + 1, close);
      i = close + 1;
      continue;
    }
    let matched = false;
    for (const tok of ['YYYY', 'MMMM', 'dddd', 'gggg', 'GGGG', 'MMM', 'ddd', 'YY', 'MM', 'DD', 'ww', 'WW', 'M', 'D', 'w', 'W']) {
      if (pattern.startsWith(tok, i)) {
        out += tokens[tok];
        i += tok.length;
        matched = true;
        break;
      }
    }
    if (!matched) { out += ch; i++; }
  }
  return out;
}

/**
 * Parse a date out of a path using the same pattern. Returns undefined when
 * the pattern cannot be matched. Works by turning the pattern into a regex
 * with capture groups for the year/month/day tokens.
 */
export function parseDateFromPath(pathWithoutExt: string, pattern: string): IsoDate | undefined {
  let re = '';
  const groups: string[] = [];
  let i = 0;
  const tokenOrder = ['YYYY', 'MMMM', 'dddd', 'gggg', 'GGGG', 'MMM', 'ddd', 'YY', 'MM', 'DD', 'ww', 'WW', 'M', 'D', 'w', 'W'];
  while (i < pattern.length) {
    const ch = pattern[i]!;
    if (ch === '[') {
      const close = pattern.indexOf(']', i);
      const lit = close === -1 ? pattern.slice(i + 1) : pattern.slice(i + 1, close);
      re += escapeRe(lit);
      i = close === -1 ? pattern.length : close + 1;
      continue;
    }
    let matched = false;
    for (const tok of tokenOrder) {
      if (pattern.startsWith(tok, i)) {
        matched = true;
        i += tok.length;
        switch (tok) {
          case 'YYYY': re += '(\\d{4})'; groups.push('Y'); break;
          case 'YY': re += '(\\d{2})'; groups.push('y'); break;
          case 'MM': re += '(\\d{2})'; groups.push('M'); break;
          case 'M': re += '(\\d{1,2})'; groups.push('M'); break;
          case 'DD': re += '(\\d{2})'; groups.push('D'); break;
          case 'D': re += '(\\d{1,2})'; groups.push('D'); break;
          case 'MMMM': re += '(' + MONTH_NAMES.join('|') + ')'; groups.push('MN'); break;
          case 'MMM': re += '(' + MONTH_SHORT.join('|') + ')'; groups.push('MS'); break;
          case 'dddd': re += '(?:' + WEEKDAY_NAMES.map(capitalize).join('|') + ')'; break;
          case 'ddd': re += '(?:' + WEEKDAY_SHORT.join('|') + ')'; break;
          default: re += '\\d{1,4}'; break;
        }
        break;
      }
    }
    if (!matched) { re += escapeRe(ch); i++; }
  }
  const m = new RegExp(re + '$').exec(pathWithoutExt);
  if (!m) return undefined;
  let y: number | undefined;
  let mo: number | undefined;
  let d: number | undefined;
  groups.forEach((g, idx) => {
    const v = m[idx + 1]!;
    if (g === 'Y') y = Number(v);
    else if (g === 'y') y = 2000 + Number(v);
    else if (g === 'M') mo = Number(v);
    else if (g === 'D') d = Number(v);
    else if (g === 'MN') mo = MONTH_NAMES.indexOf(v) + 1;
    else if (g === 'MS') mo = MONTH_SHORT.indexOf(v) + 1;
  });
  if (y === undefined || mo === undefined || d === undefined) return undefined;
  const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : undefined;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function minutesToHuman(min: number): string {
  if (min <= 0) return '0m';
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h${m}m`;
}

export function parseEffort(raw: string): number | undefined {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(raw.trim());
  if (!m || (m[1] === undefined && m[2] === undefined)) return undefined;
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0);
}
