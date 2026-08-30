/**
 * Quick-capture grammar. One line of text becomes a task:
 *
 *   "Call the plumber tomorrow !high #home @Kitchen ~30m 14:00"
 *
 *   dates    today, tomorrow, tod, tom, mon…sun, next week, next mon, in 3 days,
 *            in 2 weeks, 2026-09-01, 1/9 (day/month), 1 sep, sep 1, eom, eow
 *   due vs   "due friday" → 📅 ; "on friday"/"friday" → ⏳ (scheduled)
 *   priority !!! / !high / !h / !urgent → high ; !! / !medium ; !low / !l ; !!!! highest
 *   project  @Project Name (until next token starting with !,#,~ or a date)
 *   effort   ~30m ~2h ~1h30m
 *   time     14:00 or 14:00-15:00
 *   repeat   every day / every week on monday / weekly / daily
 */
import type { IsoDate, Priority, Recurrence } from './types';
import { addDays, addMonths, endOfMonth, isIsoDate, isoWeekday, MONTH_SHORT, startOfWeek } from './dates';
import { parseRecurrence } from './recurrence';

export interface Capture {
  text: string;
  part?: 'morning' | 'afternoon' | 'evening';
  tags: string[];
  priority: Priority;
  scheduled?: IsoDate;
  due?: IsoDate;
  effortMinutes?: number;
  project?: string;
  time?: { start: string; end?: string };
  recurrence?: Recurrence;
}

const WD: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6, sun: 7, sunday: 7,
};

export function parseCapture(input: string, today: IsoDate, weekStartsOn: 1 | 7 = 1): Capture {
  let s = ` ${input.trim()} `;
  const out: Capture = { text: '', tags: [], priority: 'normal' };

  // Recurrence first (it may contain weekday names).
  s = s.replace(/\s(every\s+(?:\d+\s+)?(?:day|days|week|weeks|month|months|year|years|weekday|weekend)(?:\s+on\s+(?:the\s+)?[\w, ]+?)?(?:\s+when\s+done)?|(?:daily|weekly|monthly|yearly|annually)(?:\s+when\s+done)?)(?=\s)/i, (_, r: string) => {
    const rec = parseRecurrence(r);
    if (rec.parsed) { out.recurrence = rec; return ' '; }
    return ` ${r}`;
  });

  // Project: "@Name Words" until a token that starts with ! # ~ @ or looks like a date keyword.
  s = s.replace(/\s@([^\s!#~@][^!#~@]*?)(?=\s(?:!|#|~|@|due\b|on\b|today\b|tomorrow\b|tod\b|tom\b|next\b|in\s+\d|\d{4}-\d{2}-\d{2}|\d{1,2}:\d{2}|eom\b|eow\b|mon\b|tue\b|wed\b|thu\b|fri\b|sat\b|sun\b|monday\b|tuesday\b|wednesday\b|thursday\b|friday\b|saturday\b|sunday\b)|\s$)/i, (_, p: string) => {
    out.project = p.trim();
    return ' ';
  });

  // Part of the day.
  s = s.replace(/\s(?:in the\s+|this\s+)?(morning|afternoon|evening|tonight)(?=\s)/i, (_, w: string) => {
    out.part = w.toLowerCase() === 'tonight' ? 'evening' : (w.toLowerCase() as 'morning' | 'afternoon' | 'evening');
    if (w.toLowerCase() === 'tonight' && !out.scheduled) out.scheduled = today;
    return ' ';
  });

  // Effort.
  s = s.replace(/\s~((?:\d+h)?(?:\d+m)?)(?=\s)/i, (_, e: string) => {
    const m = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(e);
    if (m && (m[1] || m[2])) { out.effortMinutes = Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0); return ' '; }
    return ` ~${e}`;
  });

  // Priority.
  s = s.replace(/\s(!{1,4}|!(?:highest|urgent|high|h|medium|med|m|normal|low|l|lowest))(?=\s)/i, (_, p: string) => {
    const v = p.toLowerCase();
    out.priority = v === '!!!!' || v === '!highest' ? 'highest'
      : v === '!!!' || v === '!high' || v === '!h' || v === '!urgent' ? 'high'
      : v === '!!' || v === '!medium' || v === '!med' || v === '!m' ? 'medium'
      : v === '!low' || v === '!l' || v === '!' ? 'low'
      : v === '!lowest' ? 'lowest' : 'normal';
    return ' ';
  });

  // Time block.
  s = s.replace(/\s(\d{1,2}:\d{2})(?:\s*-\s*(\d{1,2}:\d{2}))?(?=\s)/, (_, a: string, b?: string) => {
    out.time = { start: pad(a), ...(b ? { end: pad(b) } : {}) };
    return ' ';
  });

  // Dates: "due X" → due, "on X"/bare X → scheduled.
  const dateWord = '(today|tod|tomorrow|tom|yesterday|next\\s+week|next\\s+month|next\\s+(?:mon|tue|wed|thu|fri|sat|sun)\\w*|this\\s+(?:mon|tue|wed|thu|fri|sat|sun)\\w*|in\\s+\\d+\\s+(?:day|days|week|weeks|month|months)|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}(?:[/-]\\d{2,4})?|\\d{1,2}\\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\\w*|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)\\w*\\s+\\d{1,2}|eom|eow|mon|monday|tue|tues|tuesday|wed|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)';
  const dueRe = new RegExp(`\\s(?:due|by|deadline)\\s+${dateWord}(?=\\s)`, 'i');
  s = s.replace(dueRe, (_, d: string) => {
    const r = resolveDate(d, today, weekStartsOn);
    if (r) { out.due = r; return ' '; }
    return _;
  });
  const schedRe = new RegExp(`\\s(?:on\\s+|at\\s+)?${dateWord}(?=\\s)`, 'i');
  s = s.replace(schedRe, (whole, d: string) => {
    const r = resolveDate(d, today, weekStartsOn);
    if (r) { out.scheduled = r; return ' '; }
    return whole;
  });

  // Tags stay in the text (they are part of the sentence) but are also listed.
  const tags = new Set<string>();
  for (const m of s.matchAll(/(?:^|\s)#([\p{L}\p{N}_\-/]+)/gu)) tags.add(m[1]!);
  out.tags = [...tags];

  out.text = s.replace(/\s+/g, ' ').trim();
  return out;
}

function pad(t: string): string {
  const [h, m] = t.split(':');
  return `${String(Number(h)).padStart(2, '0')}:${m}`;
}

export function resolveDate(word: string, today: IsoDate, weekStartsOn: 1 | 7 = 1): IsoDate | undefined {
  const w = word.toLowerCase().replace(/\s+/g, ' ').trim();
  if (w === 'today' || w === 'tod') return today;
  if (w === 'tomorrow' || w === 'tom') return addDays(today, 1);
  if (w === 'yesterday') return addDays(today, -1);
  if (w === 'next week') return addDays(startOfWeek(today, weekStartsOn), 7);
  if (w === 'next month') return `${addMonths(today, 1).slice(0, 7)}-01`;
  if (w === 'eom') return endOfMonth(today);
  if (w === 'eow') return addDays(startOfWeek(today, weekStartsOn), weekStartsOn === 1 ? 4 : 5);
  if (isIsoDate(w)) return w;
  let m = /^in (\d+) (day|days|week|weeks|month|months)$/.exec(w);
  if (m) {
    const n = Number(m[1]);
    return m[2]!.startsWith('day') ? addDays(today, n) : m[2]!.startsWith('week') ? addDays(today, 7 * n) : addMonths(today, n);
  }
  m = /^(next|this)?\s*([a-z]+)$/.exec(w);
  if (m && WD[m[2]!] !== undefined) {
    const target = WD[m[2]!]!;
    const cur = isoWeekday(today);
    let delta = (target - cur + 7) % 7;
    if (m[1] === 'next') delta = delta === 0 ? 7 : delta + (target > cur ? 7 : 0);
    else if (delta === 0 && !m[1]) delta = 7; // "friday" on a Friday means next Friday
    return addDays(today, delta);
  }
  m = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(w);
  if (m) {
    const d = Number(m[1]);
    const mo = Number(m[2]);
    const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(today.slice(0, 4));
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!isIsoDate(iso)) return undefined;
    return !m[3] && iso < today ? `${y + 1}${iso.slice(4)}` : iso;
  }
  m = /^(\d{1,2}) ([a-z]+)$/.exec(w) ?? (() => { const r = /^([a-z]+) (\d{1,2})$/.exec(w); return r ? [r[0], r[2], r[1]] as unknown as RegExpExecArray : null; })();
  if (m) {
    const d = Number(m[1]);
    const mi = MONTH_SHORT.findIndex((x) => m![2]!.startsWith(x.toLowerCase()));
    if (mi === -1) return undefined;
    const y = Number(today.slice(0, 4));
    let iso = `${y}-${String(mi + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (!isIsoDate(iso)) return undefined;
    if (iso < today) iso = `${y + 1}${iso.slice(4)}`;
    return iso;
  }
  return undefined;
}
