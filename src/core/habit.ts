/**
 * Habit note: frontmatter only. Completions live in daily notes.
 *
 * ```yaml
 * ---
 * type: habit
 * id: hab-0012
 * title: Morning workout
 * schedule: every weekday          # Obsidian Tasks phrasing or RRULE:…
 * active: true
 * target_per_week: 5
 * grace_days: 1
 * icon: 🏃
 * history:                         # earlier definitions: "<until> <schedule> [parts: a, b]"
 *   - 2026-06-30 every day
 * paused:                          # spans not due: "<from>..<to>", open when still paused
 *   - 2026-07-01..2026-07-14
 * ---
 * ```
 */
import { HABIT_COLORS, HABIT_PARTS, type Habit, type HabitColor, type HabitPart, type Recurrence } from './types';
import { parseDocument, type Document } from './document';
import { scalar } from './frontmatter';
import { formatRecurrence, parseRecurrence } from './recurrence';

export function isHabitNote(doc: Document): boolean {
  const t = scalar(doc.frontmatter.values['type'] ?? doc.frontmatter.values['Type']);
  return t !== undefined && /^habit$/i.test(t);
}

export function parseHabit(path: string, content: string, fallbackId?: string): Habit | undefined {
  const doc = parseDocument(content);
  if (!isHabitNote(doc)) return undefined;
  const fm = doc.frontmatter.values;
  const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.md$/, '');
  const schedRaw = scalar(fm['schedule']) ?? scalar(fm['repeat']) ?? 'every day';
  const activeRaw = scalar(fm['active']);
  const tpw = scalar(fm['target_per_week']);
  const grace = scalar(fm['grace_days']) ?? scalar(fm['streak_grace']);
  const habit: Habit = {
    id: scalar(fm['id']) ?? fallbackId ?? `path:${path}`,
    title: scalar(fm['title']) ?? base,
    path,
    schedule: parseRecurrence(schedRaw),
    active: activeRaw === undefined ? true : /^(true|yes|1)$/i.test(activeRaw),
    graceDays: grace ? Number(grace) || 0 : 0,
  };
  if (tpw && Number(tpw) > 0) habit.targetPerWeek = Number(tpw);
  const icon = scalar(fm['icon']);
  if (icon) habit.icon = icon;
  const partsRaw = fm['parts'] ?? fm['part'];
  const parts = (Array.isArray(partsRaw) ? partsRaw : typeof partsRaw === 'string' ? partsRaw.replace(/^\[|\]$/g, '').split(',') : []).map((x) => String(x).trim().toLowerCase()).filter((x): x is HabitPart => (HABIT_PARTS as string[]).includes(x));
  if (parts.length > 0) habit.parts = [...new Set(parts)].sort((a, b) => HABIT_PARTS.indexOf(a) - HABIT_PARTS.indexOf(b));
  const created = scalar(fm['creation_date']) ?? scalar(fm['created']) ?? scalar(fm['start']);
  if (created && /^\d{4}-\d{2}-\d{2}/.test(created)) habit.created = created.slice(0, 10);
  const color = (scalar(fm['color']) ?? '').toLowerCase();
  if ((HABIT_COLORS as string[]).includes(color)) habit.color = color as HabitColor;
  const history = asList(fm['history']).map(parseHistoryEntry).filter((x): x is NonNullable<ReturnType<typeof parseHistoryEntry>> => x !== undefined).sort((a, b) => a.until.localeCompare(b.until));
  if (history.length > 0) habit.history = history;
  const pauses = asList(fm['paused']).map(parsePauseEntry).filter((x): x is NonNullable<ReturnType<typeof parsePauseEntry>> => x !== undefined).sort((a, b) => a.from.localeCompare(b.from));
  if (pauses.length > 0) habit.pauses = pauses;
  const img = scalar(fm['icon_image']) ?? scalar(fm['image']);
  if (img) habit.iconImage = img.replace(/^\[\[|\]\]$/g, '').replace(/^!\[\[|\]\]$/g, '');
  return habit;
}

const asList = (v: unknown): string[] => Array.isArray(v) ? v.map(String) : typeof v === 'string' && v.trim() ? [v] : [];
const PARTS_RE = /\s*\[?parts:\s*([a-z, ]+)\]?\s*$/i;

/** `2026-06-30 every weekday [parts: morning, evening]` → the definition in force up to that day. */
export function parseHistoryEntry(raw: string): { until: string; schedule: Recurrence; parts?: HabitPart[] } | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})\s+(.+)$/.exec(raw.trim());
  if (!m) return undefined;
  let text = m[2]!;
  const pm = PARTS_RE.exec(text);
  const parts = pm ? pm[1]!.split(',').map((x) => x.trim().toLowerCase()).filter((x): x is HabitPart => (HABIT_PARTS as string[]).includes(x)) : [];
  if (pm) text = text.slice(0, pm.index);
  return { until: m[1]!, schedule: parseRecurrence(text.trim()), ...(parts.length ? { parts } : {}) };
}

export function formatHistoryEntry(e: { until: string; schedule: Recurrence; parts?: HabitPart[] }): string {
  return `${e.until} ${formatRecurrence(e.schedule)}${e.parts && e.parts.length ? ` [parts: ${e.parts.join(', ')}]` : ''}`;
}

/** `2026-07-01..2026-07-14`, or `2026-07-01..` while still paused. */
export function parsePauseEntry(raw: string): { from: string; to?: string } | undefined {
  const m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})?$/.exec(raw.trim());
  return m ? { from: m[1]!, ...(m[2] ? { to: m[2] } : {}) } : undefined;
}

export const formatPauseEntry = (p: { from: string; to?: string }): string => `${p.from}..${p.to ?? ''}`;

export function renderHabitNote(h: { id: string; title: string; schedule: string; targetPerWeek?: number; graceDays?: number; icon?: string; iconImage?: string; parts?: HabitPart[]; color?: HabitColor; today: string }): string {
  const fm = ['---', `title: ${h.title}`, 'type: habit', `id: ${h.id}`, `schedule: ${h.schedule}`, 'active: true'];
  if (h.targetPerWeek) fm.push(`target_per_week: ${h.targetPerWeek}`);
  fm.push(`grace_days: ${h.graceDays ?? 0}`);
  if (h.icon) fm.push(`icon: ${h.icon}`);
  if (h.iconImage) fm.push(`icon_image: ${h.iconImage}`);
  if (h.parts && h.parts.length > 0) fm.push(`parts: [${h.parts.join(', ')}]`);
  if (h.color) fm.push(`color: ${h.color}`);
  fm.push(`creation_date: ${h.today}`, '---', '', `# ${h.title}`, '', 'Why this habit matters:', '', '');
  return fm.join('\n');
}

/** The habit's accent colour: its own, else a stable pick from its id. */
export function habitColor(h: { id: string; color?: HabitColor }): HabitColor {
  if (h.color) return h.color;
  let x = 0;
  for (const ch of h.id) x = (x * 31 + ch.charCodeAt(0)) >>> 0;
  return HABIT_COLORS[x % HABIT_COLORS.length]!;
}
