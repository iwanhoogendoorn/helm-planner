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
 * items:                           # sub-habits: "<title> 🆔 <id>"
 *   - Wonderwall 🆔 hsi-a1b2c3
 * items_retired:                   # learned / shelved sub-habits, history kept
 *   - Smoke on the Water 🆔 hsi-0f0f0f
 * items_per_day: 1                 # sub-habits that make the day count; 0 or "all" = every active one
 * item_groups: [C major, G major]  # groups the sub-habits sit in, in order ("<title> 🆔 <id> 📂 <group>")
 * items_plan_date: 2026-11-16      # the day of the plan below
 * items_plan: [hsi-a1b2c3]         # sub-habits you mean to practise that day
 * ---
 * ```
 */
import { HABIT_COLORS, HABIT_PARTS, type Habit, type HabitColor, type HabitItem, type HabitPart, type Recurrence } from './types';
import { parseDocument, type Document } from './document';
import { scalar, yamlScalar } from './frontmatter';
import { formatRecurrence, parseRecurrence } from './recurrence';
import { hash } from './ids';

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
  const items = [...asList(fm['items']).map((x) => parseItemEntry(x, false)), ...asList(fm['items_retired']).map((x) => parseItemEntry(x, true))].filter((x): x is HabitItem => x !== undefined);
  const seenItems = new Set<string>();
  const uniq = items.filter((it) => !seenItems.has(it.id) && seenItems.add(it.id));
  if (uniq.length > 0) habit.items = uniq;
  const ipd = scalar(fm['items_per_day']);
  if (ipd !== undefined && ipd.trim() !== '') { const n = /^all$/i.test(ipd.trim()) ? 0 : Number(ipd); if (Number.isInteger(n) && n >= 0) habit.itemsPerDay = n; }
  // Groups: the listed ones in order, then any an item names that the list lacks.
  const groups = [...new Set([...asList(fm['item_groups']).map((g) => cleanGroup(g)).filter(Boolean), ...uniq.map((i) => i.group).filter((g): g is string => !!g)])];
  if (groups.length > 0) habit.itemGroups = groups;
  const planDate = scalar(fm['items_plan_date']);
  if (planDate && /^\d{4}-\d{2}-\d{2}/.test(planDate)) {
    const ids = new Set(uniq.map((i) => i.id));
    habit.itemPlan = { date: planDate.slice(0, 10), items: [...new Set(asList(fm['items_plan']).map((x) => x.trim()).filter((x) => ids.has(x)))] };
  }
  return habit;
}

const ITEM_ID_RE = /\s*🆔\s*(hsi-[a-z0-9]+)\s*$/;
const ITEM_GROUP_RE = /\s*📂\s*([^🆔📂]*)$/u;

/** A group name as stored: trimmed, without the markers the entry format uses. */
export const cleanGroup = (g: string): string => String(g).replace(/[🆔📂]/gu, '').replace(/\s+/g, ' ').trim();

/** `Wonderwall 🆔 hsi-a1b2c3 📂 C major` → a sub-habit. An entry without an id gets one derived from its title, so it stays put. */
export function parseItemEntry(raw: string, retired: boolean): HabitItem | undefined {
  let text = String(raw).trim();
  if (!text) return undefined;
  const g = ITEM_GROUP_RE.exec(text);
  const group = g ? cleanGroup(g[1]!) : '';
  if (g) text = text.slice(0, g.index).trim();
  const m = ITEM_ID_RE.exec(text);
  const title = (m ? text.slice(0, m.index) : text).trim();
  if (!title) return undefined;
  const id = m ? m[1]! : `hsi-t${hash(title.toLowerCase())}`;
  return { id, title, ...(retired ? { retired: true } : {}), ...(group ? { group } : {}) };
}

export const formatItemEntry = (it: { id: string; title: string; group?: string }): string => `${it.title.trim()} 🆔 ${it.id}${it.group ? ` 📂 ${cleanGroup(it.group)}` : ''}`;

/** The frontmatter values for a habit's sub-habits (undefined removes the key). */
export function itemsFrontmatter(items: HabitItem[]): { items: string[] | undefined; items_retired: string[] | undefined } {
  const act = items.filter((i) => !i.retired).map(formatItemEntry);
  const ret = items.filter((i) => i.retired).map(formatItemEntry);
  return { items: act.length ? act : undefined, items_retired: ret.length ? ret : undefined };
}

/** How many distinct sub-habits make an occurrence count: `itemsPerDay`, 0 meaning every active one. */
export function itemsNeeded(h: Pick<Habit, 'items' | 'itemsPerDay'>): number {
  const active = (h.items ?? []).filter((i) => !i.retired).length;
  if (active === 0) return Infinity;
  const n = h.itemsPerDay ?? 1;
  return n === 0 ? active : Math.min(n, active);
}

/** `Wonderwall ×3` → { text: 'Wonderwall', count: 3 }. Also reads `x3`. */
export function splitItemCount(text: string): { text: string; count: number } {
  const m = /\s+[×x](\d{1,3})$/.exec(text.trim());
  if (!m) return { text: text.trim(), count: 1 };
  return { text: text.trim().slice(0, m.index).trim(), count: Math.max(1, Number(m[1])) };
}

export const itemLineText = (title: string, count: number): string => count > 1 ? `${title} ×${count}` : title;

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

export function renderHabitNote(h: { id: string; title: string; schedule: string; targetPerWeek?: number; graceDays?: number; icon?: string; iconImage?: string; parts?: HabitPart[]; color?: HabitColor; items?: HabitItem[]; itemsPerDay?: number; today: string }): string {
  const fm = ['---', `title: ${yamlScalar(h.title)}`, 'type: habit', `id: ${h.id}`, `schedule: ${yamlScalar(h.schedule)}`, 'active: true'];
  if (h.targetPerWeek) fm.push(`target_per_week: ${h.targetPerWeek}`);
  fm.push(`grace_days: ${h.graceDays ?? 0}`);
  if (h.icon) fm.push(`icon: ${yamlScalar(h.icon)}`);
  if (h.iconImage) fm.push(`icon_image: ${yamlScalar(h.iconImage)}`);
  if (h.parts && h.parts.length > 0) fm.push(`parts: [${h.parts.join(', ')}]`);
  if (h.color) fm.push(`color: ${h.color}`);
  if (h.items && h.items.length > 0) fm.push('items:', ...h.items.map((it) => `  - ${yamlScalar(formatItemEntry(it))}`));
  if (h.itemsPerDay !== undefined) fm.push(`items_per_day: ${h.itemsPerDay}`);
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
