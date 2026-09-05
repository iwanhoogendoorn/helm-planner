/**
 * A report, as a printable page.
 *
 * One pure function from the report data to a complete HTML document: no Obsidian, no DOM, no clock.
 * That is what makes it testable, and what lets the same document be printed, saved beside the vault,
 * or handed to `printToPDF` without a second code path.
 */
import type { Task } from '../../core/types';
import type { AheadDay, Report } from '../../data/report';
import { humanDate, minutesToHuman, MONTH_SHORT, WEEKDAY_SHORT, isoWeekday } from '../../core/dates';
import { plainLabel } from '../../core/label';
import { REPORT_CSS } from './style';

export const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const pct = (n: number, of: number): number => (of > 0 ? Math.round((n / of) * 100) : 0);

/** One task as a line: a box, what it says, and the few facts worth carrying onto paper. */
function taskLine(t: Task, today: string, opts: { date?: boolean; project?: boolean } = {}): string {
  const done = t.status === 'done';
  const bits: string[] = [];
  if (t.time) bits.push(`<span class="tag">${esc(t.time.end ? `${t.time.start}–${t.time.end}` : t.time.start)}</span>`);
  if (opts.project !== false && t.projectTitle) bits.push(`<span class="tag">${esc(t.projectTitle)}</span>`);
  if (t.due) bits.push(`<span class="tag ${t.due < today && !done ? 'late' : 'due'}">due ${esc(humanDate(t.due))}</span>`);
  if (opts.date && t.scheduled && t.scheduled !== t.due) bits.push(`<span class="tag">${esc(humanDate(t.scheduled))}</span>`);
  if (t.effortMinutes !== undefined) bits.push(`<span class="tag">${esc(minutesToHuman(t.effortMinutes))}</span>`);
  if (t.progress !== undefined && !done) bits.push(`<span class="tag">${t.progress}%</span>`);
  return `<span class="box${done ? ' done' : ''}"></span><span class="${done ? 'done-text' : ''}">${esc(plainLabel(t.text))}</span>${bits.join('')}`;
}

const emptyNote = (what: string): string => `<p class="empty">${esc(what)}</p>`;

/** A list of tasks, capped so one runaway backlog cannot become forty pages — and it says so. */
const LIST_CAP = 40;
function list(tasks: Task[], today: string, opts: { date?: boolean; project?: boolean } = {}): string {
  const shown = tasks.slice(0, LIST_CAP);
  const rest = tasks.length - shown.length;
  return `<table><tbody>${shown.map((t) => `<tr><td>${taskLine(t, today, opts)}</td></tr>`).join('')}</tbody></table>${rest > 0 ? `<p class="note">and ${rest} more, not printed.</p>` : ''}`;
}

/** A row of bars: magnitude in one hue, the label carrying identity. */
function bars(rows: { label: string; value: number; note?: string }[], format: (n: number) => string): string {
  if (rows.length === 0) return '';
  const max = rows.reduce((m, r) => Math.max(m, r.value), 0) || 1;
  const total = rows.reduce((s, r) => s + r.value, 0) || 1;
  return `<div class="bars">${rows.map((r) => `<div class="bar-row">
<div class="bar-name" title="${esc(r.label)}">${esc(r.label)}</div>
<div class="bar-track"><div class="bar-fill" style="width:${Math.max(1.5, (r.value / max) * 100).toFixed(1)}%"></div></div>
<div class="bar-value">${esc(format(r.value))}<span class="bar-share">${r.note ?? `${pct(r.value, total)}%`}</span></div>
</div>`).join('')}</div>`;
}

/** Done per day as columns, with the busiest day called out. */
function columns(points: { key: string; label: string; value: number }[]): string {
  if (points.length < 2) return '';
  const w = 720, h = 118, top = 18, bottom = 14;
  const inner = h - top - bottom;
  const max = points.reduce((m, p) => Math.max(m, p.value), 0) || 1;
  const step = w / points.length;
  const bw = Math.max(3, Math.min(34, step - 2));
  const peak = points.reduce((best, p, i) => (p.value > points[best]!.value ? i : best), 0);
  // A label under every column is unreadable past a fortnight; show a handful, evenly spread.
  const every = Math.ceil(points.length / 12);
  // Only the ticks actually drawn decide when the month is worth repeating; a full ISO date will not fit.
  let lastMonth = '';
  const tick = (key: string, label: string): string => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return label;
    const mm = key.slice(5, 7);
    const day = String(Number(key.slice(8, 10)));
    const out = mm === lastMonth ? day : `${day} ${MONTH_SHORT[Number(mm) - 1] ?? ''}`;
    lastMonth = mm;
    return out;
  };
  const cols = points.map((p, i) => {
    const bh = Math.max(1, (p.value / max) * inner);
    const x = i * step + (step - bw) / 2;
    const y = top + inner - bh;
    const r = Math.min(4, bw / 2, bh);
    const path = `M${x.toFixed(1)},${(y + bh).toFixed(1)} V${(y + r).toFixed(1)} Q${x.toFixed(1)},${y.toFixed(1)} ${(x + r).toFixed(1)},${y.toFixed(1)} H${(x + bw - r).toFixed(1)} Q${(x + bw).toFixed(1)},${y.toFixed(1)} ${(x + bw).toFixed(1)},${(y + r).toFixed(1)} V${(y + bh).toFixed(1)} Z`;
    const label = i % every === 0 ? `<text class="tick" x="${(x + bw / 2).toFixed(1)}" y="${h - 3}" text-anchor="middle">${esc(tick(p.key, p.label))}</text>` : '';
    const call = i === peak && p.value > 0 ? `<text class="peak" x="${(x + bw / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle">${p.value}</text>` : '';
    return `<path class="${p.value > 0 ? 'col' : 'col-soft'}" d="${path}"/>${label}${call}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" role="img">
<line class="axis" x1="0" y1="${top + inner + 0.5}" x2="${w}" y2="${top + inner + 0.5}"/>${cols}</svg>`;
}

function aheadSection(r: Report): string {
  const rows: string[] = [];
  if (r.overdue.length > 0) {
    rows.push(`<h3>Carried in — ${r.overdue.length} overdue</h3>${list(r.overdue, r.today, { date: true })}`);
  }
  for (const day of r.ahead) rows.push(aheadDay(day, r.today));
  if (r.undated.length > 0) {
    rows.push(`<h3>No day yet — ${r.undated.length}</h3>${list(r.undated, r.today)}`);
  }
  if (rows.length === 0) return `<section><h2>What is ahead</h2>${emptyNote('Nothing is planned in this period yet.')}</section>`;
  const total = r.ahead.reduce((s, d) => s + d.tasks.length, 0);
  return `<section><h2>What is ahead</h2><p class="note">${total} task${total === 1 ? '' : 's'} planned across ${r.ahead.length} day${r.ahead.length === 1 ? '' : 's'}${r.overdue.length ? `, ${r.overdue.length} carried in overdue` : ''}.</p>${rows.join('')}</section>`;
}

function aheadDay(day: AheadDay, today: string): string {
  return `<h3>${esc(humanDate(day.date, today, { year: false }))}${day.minutes > 0 ? ` <span class="muted">· ${esc(minutesToHuman(day.minutes))}</span>` : ''}</h3>
${list(day.tasks, today)}`;
}

function daysSection(r: Report): string {
  if (r.days.length < 2) return '';
  return `<section><h2>The days</h2><div class="days">${r.days.map((d) => {
    const items = [...d.open, ...d.done].slice(0, 12);
    return `<div class="day"><div class="day-head"><span class="name">${esc(WEEKDAY_SHORT[isoWeekday(d.date) - 1] ?? '')} ${Number(d.date.slice(8, 10))}</span><span class="count">${d.done.length} done · ${d.open.length} open${d.minutes ? ` · ${esc(minutesToHuman(d.minutes))}` : ''}</span></div>
<ul>${items.length === 0 ? `<li class="empty">nothing</li>` : items.map((t) => `<li>${taskLine(t, r.today, { project: false })}</li>`).join('')}</ul>
${d.open.length + d.done.length > items.length ? `<p class="note">and ${d.open.length + d.done.length - items.length} more</p>` : ''}</div>`;
  }).join('')}</div></section>`;
}

function planSection(r: Report): string {
  if (!r.plan) return '';
  const parts: [string, typeof r.plan.byPart[keyof typeof r.plan.byPart]][] = [
    ['Morning', r.plan.byPart.morning], ['Afternoon', r.plan.byPart.afternoon],
    ['Evening', r.plan.byPart.evening], ['Anytime', r.plan.byPart.anytime],
  ];
  const shown = parts.filter(([, items]) => items.length > 0);
  if (shown.length === 0) return `<section><h2>The day</h2>${emptyNote('Nothing was planned on this day.')}</section>`;
  return `<section><h2>The day</h2>${shown.map(([label, items]) => `<h3>${esc(label)}</h3><table><tbody>${items.map((it) => `<tr><td>${taskLine(it.display, r.today)}</td></tr>`).join('')}</tbody></table>`).join('')}</section>`;
}

function projectsSection(r: Report): string {
  if (r.projects.length === 0) return `<section><h2>Projects</h2>${emptyNote('No project moved in this period.')}</section>`;
  const rows = r.projects.map((h) => {
    const flags = h.flags.length > 0 ? `<span class="tag">${esc(h.flags.join(', '))}</span>` : '';
    return `<tr>
<td>${esc(h.project.title)}${h.project.area ? `<span class="tag">${esc(h.project.area)}</span>` : ''}${flags}
${h.nextAction ? `<div class="step">next: ${esc(plainLabel(h.nextAction.text))}</div>` : ''}</td>
<td class="date">${h.project.due ? esc(humanDate(h.project.due)) : '<span class="muted">—</span>'}</td>
<td class="num">${h.done}/${h.total}</td>
<td style="width:120px"><div class="bar-track"><div class="bar-fill" style="width:${Math.round(h.progress * 100)}%"></div></div></td>
<td class="num">${Math.round(h.progress * 100)}%</td></tr>`;
  }).join('');
  return `<section><h2>Projects</h2><table><thead><tr><th>Project</th><th>Due</th><th class="num">Done</th><th></th><th class="num">%</th></tr></thead><tbody>${rows}</tbody></table></section>`;
}

function phasesSection(r: Report): string {
  if (!r.project) return '';
  const hh = r.projects.find((p) => p.project.id === r.project!.id);
  if (!hh || hh.phaseProgress.length === 0) return '';
  return `<section><h2>Phases</h2><table><thead><tr><th>Phase</th><th>State</th><th class="num">Done</th><th></th></tr></thead><tbody>${hh.phaseProgress.map((p) => `<tr>
<td>${esc(p.phase.title)}</td><td>${esc(p.state)}</td><td class="num">${p.done}/${p.total}</td>
<td style="width:140px"><div class="bar-track"><div class="bar-fill" style="width:${pct(p.done, p.total)}%"></div></div></td></tr>`).join('')}</tbody></table></section>`;
}

function goalsSection(r: Report): string {
  if (r.goals.length === 0) return '';
  return `<section><h2>Goals</h2><table><thead><tr><th>Goal</th><th>Horizon</th><th class="num">Tasks</th><th></th><th class="num">%</th></tr></thead><tbody>${r.goals.map((g) => `<tr>
<td>${esc(plainLabel(g.goal.text))}</td><td class="date">${esc(g.goal.periodKey)}</td>
<td class="num">${g.taskDone}/${g.taskTotal}</td>
<td style="width:120px"><div class="bar-track"><div class="bar-fill" style="width:${Math.round(g.progress * 100)}%"></div></div></td>
<td class="num">${Math.round(g.progress * 100)}%</td></tr>`).join('')}</tbody></table></section>`;
}

function habitsSection(r: Report): string {
  if (r.habits.length === 0) return '';
  return `<section><h2>Habits</h2><table><thead><tr><th>Habit</th><th class="num">Done</th><th class="num">Due</th><th></th><th class="num">Rate</th><th class="num">Streak</th></tr></thead><tbody>${r.habits.map((h) => `<tr>
<td>${esc(h.habit.title)}</td><td class="num">${h.done}</td><td class="num">${h.scheduled}</td>
<td style="width:110px"><div class="bar-track"><div class="bar-fill" style="width:${Math.round(h.rate * 100)}%"></div></div></td>
<td class="num">${Math.round(h.rate * 100)}%</td><td class="num">${h.streak}</td></tr>`).join('')}</tbody></table></section>`;
}

function historySection(r: Report): string {
  const s = r.stats;
  const chart = columns(s.perDay.map((p) => ({ key: p.key, label: p.label, value: p.value })));
  const parts = (['morning', 'afternoon', 'evening', 'anytime'] as const)
    .map((p) => ({ label: p[0]!.toUpperCase() + p.slice(1), value: s.byPart[p].done }))
    .filter((x) => x.value > 0);
  const projects = s.byProject.filter((p) => p.done > 0).sort((a, b) => b.done - a.done).slice(0, 10)
    .map((p) => ({ label: p.project.title, value: p.done }));
  const weekdays = s.byWeekday.filter((w) => w.value > 0).map((w) => ({ label: w.label, value: w.value }));
  return `<section><h2>What happened</h2>
<p class="note">${s.totals.done} finished, ${s.totals.created} started, ${s.totals.cancelled} cancelled over ${s.days} day${s.days === 1 ? '' : 's'} — ${s.totals.perDay === 0 ? '0' : s.totals.perDay >= 0.1 ? s.totals.perDay.toFixed(1) : 'under 0.1'} a day. Longest run of days with something finished: ${s.streak.best}.</p>
${chart}
${projects.length > 0 ? `<h3>By project</h3>${bars(projects, (n) => String(n))}` : ''}
${parts.length > 0 ? `<h3>By part of the day</h3>${bars(parts, (n) => String(n))}` : ''}
${weekdays.length > 0 && s.days > 7 ? `<h3>By weekday</h3>${bars(weekdays, (n) => String(n))}` : ''}
${s.adherence.planned > 0 ? `<div class="warn">Of ${s.adherence.planned} tasks planned into these days, ${s.adherence.done} were done and ${s.adherence.carried} moved on — ${Math.round(s.adherence.rate * 100)}% kept.</div>` : ''}
</section>`;
}

function daybookSection(r: Report): string {
  if (r.daybook.length === 0) return '';
  return `<section><h2>Diary</h2>${r.daybook.map((d) => `<div class="diary-day"><h3>${esc(humanDate(d.date, r.today))}</h3>
${d.entries.map((e) => `<div class="diary-entry"><span class="diary-time">${esc(e.time)}</span><span>${esc(e.icon)} ${esc(e.text)}
${e.replies.map((rep) => `<div class="diary-reply">↳ ${esc(rep.text)}</div>`).join('')}</span></div>`).join('')}</div>`).join('')}</section>`;
}

/** The whole document: one string, ready for a webview, a print dialogue or a file. */
export function renderReport(r: Report, generatedAt: string): string {
  const [hero, ...tiles] = r.headline;
  const body = [
    `<div class="masthead"><div><h1>${esc(r.title)}</h1><p class="period">${esc(r.subtitle)}</p></div>
<div class="meta">Helm<br>${esc(generatedAt)}<br>${esc(r.from)} → ${esc(r.to)}</div></div>`,
    `<div class="hero-row">
<div class="hero"><div class="label">${esc(hero?.label ?? '')}</div><div class="value">${esc(hero?.value ?? '')}</div>${hero?.sub ? `<div class="sub">${esc(hero.sub)}</div>` : ''}</div>
<div class="tiles">${tiles.map((t) => `<div class="tile"><div class="label">${esc(t.label)}</div><div class="value">${esc(t.value)}</div>${t.sub ? `<div class="sub">${esc(t.sub)}</div>` : ''}</div>`).join('')}</div></div>`,
    r.sections.history && r.standing !== 'future' ? historySection(r) : '',
    r.sections.plan ? planSection(r) : '',
    r.sections.plan ? daysSection(r) : '',
    r.sections.ahead ? aheadSection(r) : '',
    r.sections.projects ? projectsSection(r) : '',
    r.sections.projects ? phasesSection(r) : '',
    r.sections.goals ? goalsSection(r) : '',
    r.sections.habits ? habitsSection(r) : '',
    r.sections.daybook ? daybookSection(r) : '',
    `<div class="foot"><span>${esc(r.title)} · ${esc(r.subtitle)}</span><span>Exported from Helm on ${esc(generatedAt)}</span></div>`,
  ].filter(Boolean).join('\n');
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)}</title><style>${REPORT_CSS}</style></head><body>${body}</body></html>`;
}

/** A file name that will not upset a filesystem. */
export const reportFileName = (r: Report): string =>
  `${`${r.title} ${r.subtitle}`.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 90)}.pdf`;
