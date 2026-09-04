/**
 * Asking Claude to size and shape a day.
 *
 * Helm sends what it already knows — the tasks, their estimates, what is already booked, how long you
 * like to work in one stretch — and asks for minutes per task and a running order. The plan itself is
 * laid out here, by the same arithmetic a hand-made plan uses, so a wrong answer from the model can
 * shift the order and the estimates but never invent a day that does not add up.
 *
 * Nothing is written until you confirm. With no CLI installed, the estimates Helm already has are used
 * and the day is still laid out — the button works, it simply has less to go on.
 */
import type { FocusSettings, LaidOut } from '../core/pomodoro';
import { layOutDayPlan } from '../core/pomodoro';

export interface PlanTask {
  key: string;
  text: string;
  /** What Helm has on the line, when it has anything. */
  effortMinutes?: number;
  priority: string;
  due?: string;
  project?: string;
}

export interface PlanRequest {
  date: string;
  from: string;
  to: string;
  busy: { start: string; end: string; label: string }[];
  tasks: PlanTask[];
  focus: FocusSettings;
  /** Minutes of real work you want in a day, from the settings. */
  capacityMinutes: number;
}

/** What the model is asked for: minutes per task, an order, and a word on anything it moved out. */
export interface PlanAnswer {
  order: string[];
  minutes: Record<string, number>;
  notes?: Record<string, string>;
  /** Keys the model thinks should go to another day, with a reason. */
  defer?: { key: string; reason?: string }[];
}

export interface Proposal extends LaidOut {
  answer: PlanAnswer;
  /** Where the sizes came from — worth saying out loud before anything is written. */
  source: 'claude' | 'helm';
  error?: string;
}

/** Run a command and give back its stdout; the plugin passes Node's spawn, tests pass a stub. */
export type RunCli = (args: string[], stdin: string) => Promise<string>;

/**
 * The model is given short handles — `t1`, `t2` — rather than Helm's own keys. A key is a hash of where
 * a line sits, long and easy to mistype; a week with sixty tasks is a lot of them to echo back without
 * slipping. Both spellings are accepted in the answer, so nothing is lost either way.
 */
const aliasesFor = (tasks: { key: string }[]): { alias: Map<string, string>; real: Map<string, string> } => {
  const alias = new Map<string, string>();
  const real = new Map<string, string>();
  tasks.forEach((t, i) => { const a = `t${i + 1}`; alias.set(t.key, a); real.set(a, t.key); });
  return { alias, real };
};

export function buildPrompt(req: PlanRequest): string {
  const { alias } = aliasesFor(req.tasks);
  const lines = [
    'You are planning one person’s working day. Reply with JSON only — no prose, no code fence.',
    '',
    `Day: ${req.date}. Working window: ${req.from}–${req.to}. Aim for about ${req.capacityMinutes} minutes of real work.`,
    `One stretch of work is at most ${req.focus.focusMaxMinutes} minutes; breaks between stretches are handled for you.`,
    '',
    'Already booked (do not plan over these):',
    ...(req.busy.length ? req.busy.map((b) => `- ${b.start}–${b.end} ${b.label}`) : ['- nothing']),
    '',
    'Tasks to fit, one per line, as `key | text | estimate | priority | due`:',
    ...req.tasks.map((t) => `- ${alias.get(t.key)} | ${t.text} | ${t.effortMinutes ? `${t.effortMinutes}m` : 'no estimate'} | ${t.priority} | ${t.due ?? 'no due date'}`),
    '',
    'Answer with this shape:',
    '{"order":["key",…],"minutes":{"key":45,…},"notes":{"key":"why this long"},"defer":[{"key":"…","reason":"…"}]}',
    '',
    'Rules:',
    '- Every key you were given appears exactly once, in `order` or in `defer`.',
    '- `minutes` is your honest estimate of the work, in whole minutes, for every key in `order`.',
    '- Put what is due soonest and what matters most first.',
    '- If the day cannot hold everything, defer the least pressing rather than shortening estimates.',
  ];
  return lines.join('\n');
}

/** Pull the JSON out of whatever the model said, and keep only what matches the tasks we asked about. */
export function parseAnswer(raw: string, req: PlanRequest): PlanAnswer {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const at = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (at === -1 || to <= at) throw new Error('Claude did not answer with JSON');
  const parsed = JSON.parse(text.slice(at, to + 1)) as Partial<PlanAnswer>;
  const known = new Set(req.tasks.map((t) => t.key));
  const { alias, real } = aliasesFor(req.tasks);
  const resolve = (k: string): string | undefined => (known.has(k) ? k : real.get(k));
  const order: string[] = [];
  for (const k of parsed.order ?? []) { const r = resolve(k); if (r && !order.includes(r)) order.push(r); }
  const defer = (parsed.defer ?? []).flatMap((d) => { const r = resolve(d.key); return r && !order.includes(r) ? [{ ...d, key: r }] : []; });
  const minutes: Record<string, number> = {};
  for (const k of order) {
    const n = Number(parsed.minutes?.[k] ?? parsed.minutes?.[alias.get(k) ?? '']);
    minutes[k] = Number.isFinite(n) && n > 0 ? Math.round(n) : (req.tasks.find((t) => t.key === k)?.effortMinutes ?? 30);
  }
  // Anything the model forgot is still yours to do: it goes at the end, with what Helm knows.
  for (const t of req.tasks) {
    if (order.includes(t.key) || defer.some((d) => d.key === t.key)) continue;
    order.push(t.key);
    minutes[t.key] = t.effortMinutes ?? 30;
  }
  return { order, minutes, ...(parsed.notes ? { notes: notesByKey(parsed.notes, real) } : {}), defer };
}

/** Notes come back under whichever handle the model used; they are filed under Helm's own key. */
const notesByKey = (notes: Record<string, string>, real: Map<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(notes).map(([k, v]) => [real.get(k) ?? k, v]));

/** What Helm proposes on its own: the estimates it has, in the order the day already has them. */
export function fallbackAnswer(req: PlanRequest): PlanAnswer {
  const order = req.tasks.map((t) => t.key);
  const minutes = Object.fromEntries(req.tasks.map((t) => [t.key, t.effortMinutes ?? 30]));
  return { order, minutes, defer: [] };
}

/** Lay an answer out as blocks, and carry the model's deferrals into the overflow. */
export function proposalFrom(answer: PlanAnswer, req: PlanRequest, source: Proposal['source'], error?: string): Proposal {
  const laid = layOutDayPlan(answer.order.map((k) => ({ key: k, minutes: answer.minutes[k] ?? 30 })), { ...req.focus, from: req.from, to: req.to, busy: req.busy });
  const deferred = (answer.defer ?? []).map((d) => ({ key: d.key, minutes: answer.minutes[d.key] ?? req.tasks.find((t) => t.key === d.key)?.effortMinutes ?? 30 }));
  return { ...laid, overflow: [...laid.overflow, ...deferred], answer, source, ...(error ? { error } : {}) };
}

/**
 * Ask Claude, and fall back to Helm's own sizing when there is no CLI, it fails, or it answers with
 * something that is not a plan. The button always produces a proposal; it says which it is.
 */
export async function proposePlan(req: PlanRequest, run: RunCli | undefined): Promise<Proposal> {
  if (!run) return proposalFrom(fallbackAnswer(req), req, 'helm');
  try {
    const raw = await run(['-p'], buildPrompt(req));
    return proposalFrom(parseAnswer(raw, req), req, 'claude');
  } catch (e) {
    return proposalFrom(fallbackAnswer(req), req, 'helm', (e as Error).message);
  }
}

/* ─── A week at a time ─────────────────────────────────────────────────────────────────────────── */

/** One day of the week as Helm sees it before anything is planned. */
export interface PlanDay {
  date: string;
  from: string;
  to: string;
  busy: { start: string; end: string; label: string }[];
}

export interface WeekPlanRequest {
  days: PlanDay[];
  /** The week's open work; `date` is where a task sits now, absent when it sits nowhere yet. */
  tasks: (PlanTask & { date?: string })[];
  focus: FocusSettings;
  capacityMinutes: number;
}

/** What the model is asked for across a week: which day each task lands on, and how long it takes. */
export interface WeekAnswer {
  /** Keys per day, in the order they should be done. */
  days: Record<string, string[]>;
  minutes: Record<string, number>;
  notes?: Record<string, string>;
  defer?: { key: string; reason?: string }[];
}

export interface WeekProposal {
  answer: WeekAnswer;
  days: { date: string; laid: LaidOut }[];
  /** What no day could hold, from the layout and from the model both. */
  overflow: { key: string; minutes: number }[];
  source: 'claude' | 'helm';
  error?: string;
}

export function buildWeekPrompt(req: WeekPlanRequest): string {
  const dayOf = new Map(req.tasks.map((t) => [t.key, t.date]));
  const { alias } = aliasesFor(req.tasks);
  const lines = [
    'You are spreading one person’s work across a week. Reply with JSON only — no prose, no code fence.',
    '',
    `Aim for about ${req.capacityMinutes} minutes of real work on each day; one stretch of work is at most ${req.focus.focusMaxMinutes} minutes.`,
    '',
    'The days, and what is already booked in each:',
    ...req.days.map((d) => `- ${d.date} ${d.from}–${d.to}${d.busy.length ? `; booked: ${d.busy.map((b) => `${b.start}–${b.end} ${b.label}`).join(', ')}` : ''}`),
    '',
    'Tasks to place, one per line, as `key | text | estimate | priority | due | day it sits on now`:',
    ...req.tasks.map((t) => `- ${alias.get(t.key)} | ${t.text} | ${t.effortMinutes ? `${t.effortMinutes}m` : 'no estimate'} | ${t.priority} | ${t.due ?? 'no due date'} | ${dayOf.get(t.key) ?? 'not planned'}`),
    '',
    'Answer with this shape:',
    '{"days":{"YYYY-MM-DD":["key",…],…},"minutes":{"key":45,…},"notes":{"key":"why"},"defer":[{"key":"…","reason":"…"}]}',
    '',
    'Rules:',
    '- Every key you were given appears exactly once, on one day or in `defer`.',
    '- Never move a task past its due date, and never onto a day that is already in the past.',
    '- Keep each day inside its capacity; move the least pressing work later in the week rather than shortening estimates.',
    '- `minutes` is your honest estimate of the work, in whole minutes, for every key you place.',
  ];
  return lines.join('\n');
}

/** How much a day already holds, by the answer so far. */
const loadOf = (keys: string[], minutes: Record<string, number>): number => keys.reduce((s, k) => s + (minutes[k] ?? 30), 0);

export function parseWeekAnswer(raw: string, req: WeekPlanRequest): WeekAnswer {
  const text = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const at = text.indexOf('{');
  const to = text.lastIndexOf('}');
  if (at === -1 || to <= at) throw new Error('Claude did not answer with JSON');
  const parsed = JSON.parse(text.slice(at, to + 1)) as Partial<WeekAnswer>;
  const known = new Map(req.tasks.map((t) => [t.key, t]));
  const { alias, real } = aliasesFor(req.tasks);
  const resolve = (k: string): string | undefined => (known.has(k) ? k : real.get(k));
  const dates = new Set(req.days.map((d) => d.date));
  const days: Record<string, string[]> = Object.fromEntries(req.days.map((d) => [d.date, [] as string[]]));
  const seen = new Set<string>();
  const minutes: Record<string, number> = {};
  const take = (given: string, date: string): void => {
    const key = resolve(given);
    if (!key || seen.has(key)) return;
    seen.add(key);
    days[date]!.push(key);
    const n = Number(parsed.minutes?.[key] ?? parsed.minutes?.[alias.get(key) ?? '']);
    minutes[key] = Number.isFinite(n) && n > 0 ? Math.round(n) : (known.get(key)!.effortMinutes ?? 30);
  };
  for (const [date, keys] of Object.entries(parsed.days ?? {})) {
    if (!dates.has(date) || !Array.isArray(keys)) continue;
    for (const k of keys) take(k, date);
  }
  const defer = (parsed.defer ?? []).flatMap((d) => { const r = resolve(d.key); return r && !seen.has(r) ? [{ ...d, key: r }] : []; });
  for (const d of defer) { seen.add(d.key); minutes[d.key] = known.get(d.key)!.effortMinutes ?? 30; }
  // Anything the model forgot still has to happen: it stays where it is, or joins the emptiest day.
  for (const t of req.tasks) {
    if (seen.has(t.key)) continue;
    const home = t.date && dates.has(t.date)
      ? t.date
      : [...req.days].sort((a, b) => loadOf(days[a.date]!, minutes) - loadOf(days[b.date]!, minutes))[0]?.date;
    if (home) take(t.key, home);
  }
  return { days, minutes, ...(parsed.notes ? { notes: notesByKey(parsed.notes, real) } : {}), defer };
}

/**
 * Helm's own spreading, with no model to ask: each task stays on its day while the day has room, and
 * what will not fit rolls on to the next day that does. It is the same rule you would apply by hand.
 */
export function fallbackWeekAnswer(req: WeekPlanRequest): WeekAnswer {
  const days: Record<string, string[]> = Object.fromEntries(req.days.map((d) => [d.date, [] as string[]]));
  const minutes = Object.fromEntries(req.tasks.map((t) => [t.key, t.effortMinutes ?? 30]));
  const defer: { key: string; reason?: string }[] = [];
  const load: Record<string, number> = Object.fromEntries(req.days.map((d) => [d.date, 0]));
  const dates = req.days.map((d) => d.date);
  const order = [...req.tasks].sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'));
  for (const t of order) {
    const start = Math.max(0, t.date ? dates.indexOf(t.date) : 0);
    const mins = minutes[t.key]!;
    let placed = false;
    for (let i = start; i < dates.length; i++) {
      const date = dates[i]!;
      if (load[date]! > 0 && load[date]! + mins > req.capacityMinutes) continue;
      days[date]!.push(t.key);
      load[date] = load[date]! + mins;
      placed = true;
      break;
    }
    if (!placed) defer.push({ key: t.key, reason: 'the week is full' });
  }
  return { days, minutes, defer };
}

export function weekProposalFrom(answer: WeekAnswer, req: WeekPlanRequest, source: WeekProposal['source'], error?: string): WeekProposal {
  const days = req.days.map((d) => ({
    date: d.date,
    laid: layOutDayPlan((answer.days[d.date] ?? []).map((k) => ({ key: k, minutes: answer.minutes[k] ?? 30 })), { ...req.focus, from: d.from, to: d.to, busy: d.busy }),
  }));
  const deferred = (answer.defer ?? []).map((d) => ({ key: d.key, minutes: answer.minutes[d.key] ?? req.tasks.find((t) => t.key === d.key)?.effortMinutes ?? 30 }));
  return { answer, days, overflow: [...days.flatMap((d) => d.laid.overflow), ...deferred], source, ...(error ? { error } : {}) };
}

export async function proposeWeekPlan(req: WeekPlanRequest, run: RunCli | undefined): Promise<WeekProposal> {
  if (!run) return weekProposalFrom(fallbackWeekAnswer(req), req, 'helm');
  try {
    const raw = await run(['-p'], buildWeekPrompt(req));
    return weekProposalFrom(parseWeekAnswer(raw, req), req, 'claude');
  } catch (e) {
    return weekProposalFrom(fallbackWeekAnswer(req), req, 'helm', (e as Error).message);
  }
}
