/**
 * Horizons: year → quarter → month. A period is a string key —
 * `2026`, `2026-Q3`, `2026-08` — with a first and last day.
 */
import type { IsoDate } from './types';
import { MONTH_NAMES, MONTH_SHORT, addDays, daysInMonth, isIsoDate, isoWeek, startOfWeek } from './dates';

export type PeriodKind = 'year' | 'quarter' | 'month' | 'week';

export interface Period {
  kind: PeriodKind;
  key: string;
  start: IsoDate;
  end: IsoDate;
  label: string;
  year: number;
  quarter?: number;
  month?: number;
  week?: number;
}

/** ISO week: Monday to Sunday, numbered per ISO-8601 (`2026-W35`). */
export function weekPeriod(year: number, week: number): Period {
  // Monday of ISO week 1 is the Monday on or before 4 January.
  const jan4 = `${year}-01-04`;
  const monday1 = startOfWeek(jan4, 1);
  const start = addDays(monday1, (week - 1) * 7);
  const end = addDays(start, 6);
  return { kind: 'week', key: `${year}-W${String(week).padStart(2, '0')}`, start, end, label: `Week ${week}, ${year}`, year, week };
}

/** The day that decides which month/quarter/year a week belongs to (ISO: its Thursday). */
export function periodAnchor(p: Period): IsoDate {
  return p.kind === 'week' ? addDays(p.start, 3) : p.start;
}

const p2 = (n: number): string => String(n).padStart(2, '0');

export function yearPeriod(year: number): Period {
  return { kind: 'year', key: String(year), start: `${year}-01-01`, end: `${year}-12-31`, label: String(year), year };
}

export function quarterPeriod(year: number, q: number): Period {
  const m0 = (q - 1) * 3 + 1;
  const m2 = m0 + 2;
  return { kind: 'quarter', key: `${year}-Q${q}`, start: `${year}-${p2(m0)}-01`, end: `${year}-${p2(m2)}-${p2(daysInMonth(year, m2))}`, label: `Q${q} ${year}`, year, quarter: q };
}

export function monthPeriod(year: number, m: number): Period {
  return { kind: 'month', key: `${year}-${p2(m)}`, start: `${year}-${p2(m)}-01`, end: `${year}-${p2(m)}-${p2(daysInMonth(year, m))}`, label: `${MONTH_NAMES[m - 1]} ${year}`, year, quarter: Math.floor((m - 1) / 3) + 1, month: m };
}

/** Accepts 2026 · 2026-Q3 · Q3 2026 · 2026Q3 · 2026-08 · 2026/08 · Aug 2026 · August 2026 · 08-2026. */
export function parsePeriod(raw: string | undefined): Period | undefined {
  if (!raw) return undefined;
  const s = raw.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0]!.trim();
  let m = /^(\d{4})$/.exec(s);
  if (m) return yearPeriod(Number(m[1]));
  m = /^(\d{4})[-\s/]?W(\d{1,2})$/i.exec(s) ?? (() => { const r = /^W(\d{1,2})[-\s/]?(\d{4})$/i.exec(s) ?? /^week\s+(\d{1,2}),?\s+(\d{4})$/i.exec(s); return r ? [r[0], r[2], r[1]] as unknown as RegExpExecArray : null; })();
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 53) return weekPeriod(Number(m[1]), Number(m[2]));
  m = /^(\d{4})[-\s/]?Q([1-4])$/i.exec(s) ?? (() => { const r = /^Q([1-4])[-\s/]?(\d{4})$/i.exec(s); return r ? [r[0], r[2], r[1]] as unknown as RegExpExecArray : null; })();
  if (m) return quarterPeriod(Number(m[1]), Number(m[2]));
  m = /^(\d{4})[-/](\d{1,2})$/.exec(s);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return monthPeriod(Number(m[1]), Number(m[2]));
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return monthPeriod(Number(m[2]), Number(m[1]));
  m = /^([A-Za-z]+)\s+(\d{4})$/.exec(s) ?? (() => { const r = /^(\d{4})\s+([A-Za-z]+)$/.exec(s); return r ? [r[0], r[2], r[1]] as unknown as RegExpExecArray : null; })();
  if (m) {
    const name = m[1]!.toLowerCase();
    const idx = MONTH_SHORT.findIndex((x) => name.startsWith(x.toLowerCase()));
    if (idx >= 0) return monthPeriod(Number(m[2]), idx + 1);
  }
  if (isIsoDate(s)) return monthPeriod(Number(s.slice(0, 4)), Number(s.slice(5, 7)));
  return undefined;
}

export function periodOf(date: IsoDate, kind: PeriodKind): Period {
  const y = Number(date.slice(0, 4));
  const mo = Number(date.slice(5, 7));
  if (kind === 'week') { const w = isoWeek(date); return weekPeriod(w.year, w.week); }
  if (kind === 'year') return yearPeriod(y);
  if (kind === 'quarter') return quarterPeriod(y, Math.floor((mo - 1) / 3) + 1);
  return monthPeriod(y, mo);
}

export function periodContains(p: Period, date: IsoDate): boolean {
  return date >= p.start && date <= p.end;
}

/** Is `inner` inside `outer` (or the same)? A month is inside its quarter and year; a week belongs where its Thursday falls. */
export function periodWithin(inner: Period, outer: Period): boolean {
  if (inner.kind === 'week' && outer.kind !== 'week') return periodContains(outer, periodAnchor(inner));
  return inner.start >= outer.start && inner.end <= outer.end;
}

/** The ISO weeks whose Thursday falls in the period (a month → 4–5 weeks). */
export function weeksWithin(outer: Period): Period[] {
  const out: Period[] = [];
  let d = startOfWeek(outer.start, 1);
  for (let i = 0; i < 60; i++) {
    const w = periodOf(d, 'week');
    if (w.start > outer.end) break;
    if (periodContains(outer, periodAnchor(w))) out.push(w);
    d = addDays(d, 7);
  }
  return out;
}

export const PERIOD_KINDS: PeriodKind[] = ['year', 'quarter', 'month', 'week'];

export function periodsOfYear(year: number): { year: Period; quarters: Period[]; months: Period[] } {
  return {
    year: yearPeriod(year),
    quarters: [1, 2, 3, 4].map((q) => quarterPeriod(year, q)),
    months: Array.from({ length: 12 }, (_, i) => monthPeriod(year, i + 1)),
  };
}

/** Rank for sorting: year < quarter < month, then chronological. */
export function comparePeriods(a: Period, b: Period): number {
  if (a.start !== b.start) return a.start < b.start ? -1 : 1;
  const k = { year: 0, quarter: 1, month: 2, week: 3 };
  return k[a.kind] - k[b.kind];
}

/** The periodic-note file name for a period under a moment-style format (`YYYY`, `YYYY-[Q]Q`, `YYYY-MM`, `gggg-[W]ww` unsupported). */
export function formatPeriod(p: Period, format: string): string {
  let out = '';
  let i = 0;
  while (i < format.length) {
    const ch = format[i]!;
    if (ch === '[') {
      const close = format.indexOf(']', i);
      if (close === -1) { out += format.slice(i); break; }
      out += format.slice(i + 1, close);
      i = close + 1;
      continue;
    }
    if (format.startsWith('YYYY', i) || format.startsWith('gggg', i) || format.startsWith('GGGG', i)) { out += String(p.year); i += 4; continue; }
    if (format.startsWith('YY', i)) { out += String(p.year).slice(2); i += 2; continue; }
    if (format.startsWith('ww', i) || format.startsWith('WW', i)) { out += p2(p.week ?? 1); i += 2; continue; }
    if (format.startsWith('w', i) || format.startsWith('W', i)) { out += String(p.week ?? 1); i += 1; continue; }
    if (format.startsWith('MMMM', i)) { out += MONTH_NAMES[(p.month ?? 1) - 1]; i += 4; continue; }
    if (format.startsWith('MMM', i)) { out += MONTH_SHORT[(p.month ?? 1) - 1]; i += 3; continue; }
    if (format.startsWith('MM', i)) { out += p2(p.month ?? 1); i += 2; continue; }
    if (format.startsWith('M', i)) { out += String(p.month ?? 1); i += 1; continue; }
    if (format.startsWith('Q', i)) { out += String(p.quarter ?? 1); i += 1; continue; }
    out += ch;
    i++;
  }
  return out;
}

/** Inverse of formatPeriod: recover a period of `kind` from a path (without extension). */
export function parsePeriodFromPath(pathNoExt: string, format: string, kind: PeriodKind): Period | undefined {
  let re = '';
  const groups: string[] = [];
  let i = 0;
  while (i < format.length) {
    const ch = format[i]!;
    if (ch === '[') {
      const close = format.indexOf(']', i);
      const lit = close === -1 ? format.slice(i + 1) : format.slice(i + 1, close);
      re += lit.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
      i = close === -1 ? format.length : close + 1;
      continue;
    }
    if (format.startsWith('YYYY', i) || format.startsWith('gggg', i) || format.startsWith('GGGG', i)) { re += '(\\d{4})'; groups.push('Y'); i += 4; continue; }
    if (format.startsWith('YY', i)) { re += '(\\d{2})'; groups.push('y'); i += 2; continue; }
    if (format.startsWith('ww', i) || format.startsWith('WW', i)) { re += '(\\d{2})'; groups.push('W'); i += 2; continue; }
    if (format.startsWith('w', i) || format.startsWith('W', i)) { re += '(\\d{1,2})'; groups.push('W'); i += 1; continue; }
    if (format.startsWith('MMMM', i)) { re += '(' + MONTH_NAMES.join('|') + ')'; groups.push('MN'); i += 4; continue; }
    if (format.startsWith('MMM', i)) { re += '(' + MONTH_SHORT.join('|') + ')'; groups.push('MS'); i += 3; continue; }
    if (format.startsWith('MM', i)) { re += '(\\d{2})'; groups.push('M'); i += 2; continue; }
    if (format.startsWith('M', i)) { re += '(\\d{1,2})'; groups.push('M'); i += 1; continue; }
    if (format.startsWith('Q', i)) { re += '([1-4])'; groups.push('Q'); i += 1; continue; }
    re += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    i++;
  }
  const m = new RegExp(re + '$').exec(pathNoExt);
  if (!m) return undefined;
  let y: number | undefined;
  let mo: number | undefined;
  let q: number | undefined;
  let wk: number | undefined;
  groups.forEach((g, idx) => {
    const v = m[idx + 1]!;
    if (g === 'Y') y = Number(v);
    else if (g === 'y') y = 2000 + Number(v);
    else if (g === 'M') mo = Number(v);
    else if (g === 'MN') mo = MONTH_NAMES.indexOf(v) + 1;
    else if (g === 'MS') mo = MONTH_SHORT.indexOf(v) + 1;
    else if (g === 'Q') q = Number(v);
    else if (g === 'W') wk = Number(v);
  });
  if (y === undefined) return undefined;
  if (kind === 'week') return wk && wk >= 1 && wk <= 53 ? weekPeriod(y, wk) : undefined;
  if (kind === 'year') return yearPeriod(y);
  if (kind === 'quarter') return q ? quarterPeriod(y, q) : undefined;
  return mo && mo >= 1 && mo <= 12 ? monthPeriod(y, mo) : undefined;
}

export const DEFAULT_PERIOD_FORMATS: Record<PeriodKind, string> = { year: 'YYYY', quarter: 'YYYY-[Q]Q', month: 'YYYY-MM', week: 'gggg-[W]ww' };
