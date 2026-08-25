import type { IsoDate, Recurrence } from './types';
import { addDays, addMonths, addYears, daysInMonth, isoWeekday, WEEKDAY_NAMES } from './dates';

const WD_CODES: Record<string, number> = { MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6, SU: 7 };
const WD_NAMES: Record<string, number> = Object.fromEntries(
  WEEKDAY_NAMES.flatMap((n, i) => [[n, i + 1], [n.slice(0, 3), i + 1], [n.slice(0, 2), i + 1]]),
);

/** Obsidian Tasks style: "every week on monday, thursday", "every 3 days", "every month on the 1st, 15th". */
export function parseRecurrence(raw: string): Recurrence {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const out: Recurrence = { raw: text, parsed: false };
  let m = /^every\s+(?:(\d+)\s+)?(day|days|week|weeks|month|months|year|years)(?:\s+on\s+(.+?))?(\s+when\s+done)?$/.exec(lower);
  if (m) {
    const interval = m[1] ? Number(m[1]) : 1;
    const unit = m[2]!;
    const scope = m[3];
    const whenDone = m[4] !== undefined;
    const frequency = unit.startsWith('day') ? 'daily' : unit.startsWith('week') ? 'weekly' : unit.startsWith('month') ? 'monthly' : 'yearly';
    let weekdays: number[] = [];
    let monthDays: number[] = [];
    if (scope) {
      if (frequency === 'weekly') {
        weekdays = scope.split(/[\s,]+and[\s,]+|[\s,]+/).map((s) => WD_NAMES[s.trim()]).filter((n): n is number => n !== undefined);
        if (weekdays.length === 0) return out;
      } else if (frequency === 'monthly') {
        const s = scope.replace(/^the\s+/, '');
        monthDays = s.split(/[\s,]+and[\s,]+|[\s,]+/).map((p) => Number(p.replace(/(st|nd|rd|th)$/, ''))).filter((n) => Number.isInteger(n) && n >= 1 && n <= 31);
        if (monthDays.length === 0) return out;
      } else return out;
    }
    return { raw: text, parsed: true, frequency, interval, weekdays, monthDays, whenDone };
  }
  // Friendly aliases.
  m = /^(daily|weekly|monthly|yearly|annually|every\s+weekday|every\s+weekend)(\s+when\s+done)?$/.exec(lower);
  if (m) {
    const whenDone = m[2] !== undefined;
    switch (m[1]) {
      case 'daily': return { raw: text, parsed: true, frequency: 'daily', interval: 1, weekdays: [], monthDays: [], whenDone };
      case 'weekly': return { raw: text, parsed: true, frequency: 'weekly', interval: 1, weekdays: [], monthDays: [], whenDone };
      case 'monthly': return { raw: text, parsed: true, frequency: 'monthly', interval: 1, weekdays: [], monthDays: [], whenDone };
      case 'yearly': case 'annually': return { raw: text, parsed: true, frequency: 'yearly', interval: 1, weekdays: [], monthDays: [], whenDone };
      case 'every weekday': return { raw: text, parsed: true, frequency: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5], monthDays: [], whenDone };
      case 'every weekend': return { raw: text, parsed: true, frequency: 'weekly', interval: 1, weekdays: [6, 7], monthDays: [], whenDone };
    }
  }
  // RRULE subset, used by habit frontmatter.
  m = /^RRULE:(.+)$/i.exec(text);
  if (m) {
    const parts = Object.fromEntries(m[1]!.split(';').map((kv) => { const [k, v] = kv.split('='); return [k!.toUpperCase(), v ?? '']; }));
    const freq = String(parts['FREQ'] ?? '').toUpperCase();
    const frequency = freq === 'DAILY' ? 'daily' : freq === 'WEEKLY' ? 'weekly' : freq === 'MONTHLY' ? 'monthly' : freq === 'YEARLY' ? 'yearly' : undefined;
    if (!frequency) return out;
    const interval = parts['INTERVAL'] ? Number(parts['INTERVAL']) : 1;
    const weekdays = parts['BYDAY'] ? String(parts['BYDAY']).split(',').map((c) => WD_CODES[c.toUpperCase()]).filter((n): n is number => n !== undefined) : [];
    const monthDays = parts['BYMONTHDAY'] ? String(parts['BYMONTHDAY']).split(',').map(Number).filter((n) => n >= 1 && n <= 31) : [];
    return { raw: text, parsed: true, frequency, interval: Number.isFinite(interval) && interval > 0 ? interval : 1, weekdays, monthDays, whenDone: false };
  }
  return out;
}

export function formatRecurrence(r: Recurrence): string {
  if (!r.parsed || !r.frequency) return r.raw;
  const unit = r.frequency === 'daily' ? 'day' : r.frequency === 'weekly' ? 'week' : r.frequency === 'monthly' ? 'month' : 'year';
  const iv = r.interval ?? 1;
  let s = iv === 1 ? `every ${unit}` : `every ${iv} ${unit}s`;
  if (r.frequency === 'weekly' && r.weekdays && r.weekdays.length > 0) {
    if (r.weekdays.length === 5 && [1, 2, 3, 4, 5].every((d) => r.weekdays!.includes(d))) s = 'every weekday';
    else s += ' on ' + r.weekdays.map((d) => WEEKDAY_NAMES[d - 1]).join(', ');
  }
  if (r.frequency === 'monthly' && r.monthDays && r.monthDays.length > 0) s += ' on the ' + r.monthDays.map(ordinal).join(', ');
  if (r.whenDone) s += ' when done';
  return s;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]!);
}

/** Does the rule fire on `date`, anchored at `anchor` (the start / first occurrence)? */
export function occursOn(r: Recurrence, date: IsoDate, anchor?: IsoDate): boolean {
  if (!r.parsed || !r.frequency) return false;
  const iv = r.interval ?? 1;
  switch (r.frequency) {
    case 'daily': {
      if (!anchor || iv === 1) return true;
      const diff = Math.round((Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - Date.UTC(+anchor.slice(0, 4), +anchor.slice(5, 7) - 1, +anchor.slice(8, 10))) / 86400000);
      return diff >= 0 && diff % iv === 0;
    }
    case 'weekly': {
      const wd = isoWeekday(date);
      const days = r.weekdays && r.weekdays.length > 0 ? r.weekdays : anchor ? [isoWeekday(anchor)] : [1, 2, 3, 4, 5, 6, 7];
      if (!days.includes(wd)) return false;
      if (iv === 1 || !anchor) return true;
      const weeks = Math.floor(daysBetween(anchor, date) / 7);
      return weeks >= 0 && weeks % iv === 0;
    }
    case 'monthly': {
      const dom = Number(date.slice(8, 10));
      const days = r.monthDays && r.monthDays.length > 0 ? r.monthDays : anchor ? [Number(anchor.slice(8, 10))] : [1];
      const y = Number(date.slice(0, 4));
      const mo = Number(date.slice(5, 7));
      const last = daysInMonth(y, mo);
      const hit = days.some((d) => d === dom || (d > last && dom === last));
      if (!hit) return false;
      if (iv === 1 || !anchor) return true;
      const months = (y - Number(anchor.slice(0, 4))) * 12 + (mo - Number(anchor.slice(5, 7)));
      return months >= 0 && months % iv === 0;
    }
    case 'yearly': {
      if (!anchor) return false;
      return date.slice(5) === anchor.slice(5) && (Number(date.slice(0, 4)) - Number(anchor.slice(0, 4))) % iv === 0;
    }
  }
}

function daysBetween(a: IsoDate, b: IsoDate): number {
  const ta = Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10));
  const tb = Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10));
  return Math.round((tb - ta) / 86400000);
}

/** The next occurrence strictly after `from`. */
export function nextOccurrence(r: Recurrence, from: IsoDate, anchor?: IsoDate): IsoDate | undefined {
  if (!r.parsed || !r.frequency) return undefined;
  const iv = r.interval ?? 1;
  const base = anchor ?? from;
  switch (r.frequency) {
    case 'daily': return addDays(from, iv);
    case 'weekly': {
      if (r.weekdays && r.weekdays.length > 0) {
        for (let i = 1; i <= 7 * Math.max(iv, 1) + 7; i++) {
          const d = addDays(from, i);
          if (occursOn(r, d, base)) return d;
        }
        return undefined;
      }
      return addDays(from, 7 * iv);
    }
    case 'monthly': {
      if (r.monthDays && r.monthDays.length > 0) {
        for (let i = 1; i <= 31 * Math.max(iv, 1) + 31; i++) {
          const d = addDays(from, i);
          if (occursOn(r, d, base)) return d;
        }
        return undefined;
      }
      return addMonths(from, iv);
    }
    case 'yearly': return addYears(from, iv);
  }
}
