/**
 * Helm's built-in yearly / quarterly / monthly / weekly note templates.
 *
 * Written in Templater flavour so they come out identical whether Templater
 * renders them (the normal path in a vault that has it), Periodic Notes creates
 * the note from the same file, or Helm's own fallback renderer does the job.
 * Every date is derived from the note title, so a template never depends on
 * when it was rendered. The placeholders in braces are filled in by Helm with
 * the vault's actual formats before the text is used or written to disk.
 */
import type { IsoDate } from './types';
import { addDays, addMonths, formatDate } from './dates';
import type { PeriodKind } from './periods';

export interface TemplateConfig {
  /** Moment formats of the periodic note names, e.g. YYYY · YYYY-[Q]Q · YYYY-MM · gggg-[W]ww. */
  formats: Record<PeriodKind, string>;
  /** Moment format of a daily note's title (the file name, without folders). */
  dailyTitleFormat: string;
  /** The heading goals live under, e.g. "## Goals". */
  goalsHeading: string;
}

const FM = (type: string): string => [
  '---',
  'title: <% tp.file.title %>',
  `Type: ${type}`,
  'period: <% tp.file.title %>',
  'creation_date: <% tp.date.now("YYYY-MM-DD") %>',
  'modification_date: <% tp.file.last_modified_date("YYYY-MM-DD") %>',
  'tags:',
  `  - ${type.toLowerCase().replace(/\s+note$/, '')}notes`,
  '  - horizons',
  '---',
].join('\n');

const M = (fmt: string): string => `moment(tp.file.title, '${fmt}')`;
const link = (expr: string, label: string): string => `[[<% ${expr} %>|${label}]]`;
const linkT = (expr: string, labelExpr: string): string => `[[<% ${expr} %>|<% ${labelExpr} %>]]`;

export const YEARLY_TEMPLATE = `${FM('Yearly Note')}

# <% tp.file.title %>

◀ ${link(`${M('{Y}')}.subtract(1, 'y').format('{Y}')`, 'Previous year')} · ${link(`${M('{Y}')}.add(1, 'y').format('{Y}')`, 'Next year')} ▶
Quarters: ${link(`${M('{Y}')}.format('{Q}')`, 'Q1')} · ${link(`${M('{Y}')}.add(1, 'Q').format('{Q}')`, 'Q2')} · ${link(`${M('{Y}')}.add(2, 'Q').format('{Q}')`, 'Q3')} · ${link(`${M('{Y}')}.add(3, 'Q').format('{Q}')`, 'Q4')}

## Theme

> One sentence on what this year is for.

{GOALS}

## Projects

Projects bound to this year (Horizon “<% tp.file.title %>” in the project form) show up on Helm’s Horizons tab with their progress.

## Review

### What went well

### What I would do differently

`;

export const QUARTERLY_TEMPLATE = `${FM('Quarterly Note')}

# <% ${M('{Q}')}.format('[Q]Q YYYY') %>

Year: ${linkT(`${M('{Q}')}.format('{Y}')`, `${M('{Q}')}.format('YYYY')`)} · ◀ ${link(`${M('{Q}')}.subtract(1, 'Q').format('{Q}')`, 'Previous quarter')} · ${link(`${M('{Q}')}.add(1, 'Q').format('{Q}')`, 'Next quarter')} ▶
Months: ${linkT(`${M('{Q}')}.format('{M}')`, `${M('{Q}')}.format('MMMM')`)} · ${linkT(`${M('{Q}')}.add(1, 'M').format('{M}')`, `${M('{Q}')}.add(1, 'M').format('MMMM')`)} · ${linkT(`${M('{Q}')}.add(2, 'M').format('{M}')`, `${M('{Q}')}.add(2, 'M').format('MMMM')`)}

## Focus

> The one outcome this quarter has to deliver.

{GOALS}

## Projects

Projects bound to this quarter show up on Helm’s Horizons tab.

## Review

### Wins

### Lessons

`;

export const MONTHLY_TEMPLATE = `${FM('Monthly Note')}

# <% ${M('{M}')}.format('MMMM YYYY') %>

Year: ${linkT(`${M('{M}')}.format('{Y}')`, `${M('{M}')}.format('YYYY')`)} · Quarter: ${linkT(`${M('{M}')}.format('{Q}')`, `${M('{M}')}.format('[Q]Q')`)} · ◀ ${linkT(`${M('{M}')}.subtract(1, 'M').format('{M}')`, `${M('{M}')}.subtract(1, 'M').format('MMMM')`)} · ${linkT(`${M('{M}')}.add(1, 'M').format('{M}')`, `${M('{M}')}.add(1, 'M').format('MMMM')`)} ▶
Weeks: <%* const m = ${M('{M}')}; const last = m.clone().endOf('month'); const out = []; for (const d = m.clone().startOf('month').startOf('isoWeek'); d.isSameOrBefore(last); d.add(1, 'week')) out.push('[[' + d.format('{W}') + '|W' + d.format('WW') + ']]'); tR += out.join(' · '); %>

## Focus

> What this month is about.

{GOALS}

## Projects

Projects bound to this month show up on Helm’s Horizons tab.

## Review

### Wins

### Lessons

`;

const DAY = (i: number): string => linkT(`${M('{W}')}.startOf('isoWeek').add(${i}, 'd').format('{D}')`, `${M('{W}')}.startOf('isoWeek').add(${i}, 'd').format('ddd D')`);

export const WEEKLY_TEMPLATE = `${FM('Weekly Note')}

# Week <% ${M('{W}')}.startOf('isoWeek').format('W, GGGG') %>

Year: ${linkT(`${M('{W}')}.startOf('isoWeek').add(3, 'd').format('{Y}')`, `${M('{W}')}.startOf('isoWeek').add(3, 'd').format('YYYY')`)} · Quarter: ${linkT(`${M('{W}')}.startOf('isoWeek').add(3, 'd').format('{Q}')`, `${M('{W}')}.startOf('isoWeek').add(3, 'd').format('[Q]Q')`)} · Month: ${linkT(`${M('{W}')}.startOf('isoWeek').add(3, 'd').format('{M}')`, `${M('{W}')}.startOf('isoWeek').add(3, 'd').format('MMMM')`)}
◀ ${link(`${M('{W}')}.startOf('isoWeek').subtract(1, 'w').format('{W}')`, 'Previous week')} · ${link(`${M('{W}')}.startOf('isoWeek').add(1, 'w').format('{W}')`, 'Next week')} ▶
Days: ${[0, 1, 2, 3, 4, 5, 6].map(DAY).join(' · ')}

## Focus this week

> The three things that matter most.

{GOALS}

## Review

### Wins

### Lessons

`;

const RAW: Record<PeriodKind, string> = { year: YEARLY_TEMPLATE, quarter: QUARTERLY_TEMPLATE, month: MONTHLY_TEMPLATE, week: WEEKLY_TEMPLATE };

/** The built-in template for a kind, with the vault's formats and goals heading filled in. */
export function bundledTemplate(kind: PeriodKind, cfg: TemplateConfig): string {
  return RAW[kind]
    .replace(/\{Y\}/g, cfg.formats.year).replace(/\{Q\}/g, cfg.formats.quarter).replace(/\{M\}/g, cfg.formats.month).replace(/\{W\}/g, cfg.formats.week)
    .replace(/\{D\}/g, cfg.dailyTitleFormat).replace(/\{GOALS\}/g, cfg.goalsHeading);
}

/** Default file name for a kind's template note. */
export const TEMPLATE_FILE_NAMES: Record<PeriodKind, string> = { year: 'YEARLY NOTE TEMPLATE.md', quarter: 'QUARTERLY NOTE TEMPLATE.md', month: 'MONTHLY NOTE TEMPLATE.md', week: 'WEEKLY NOTE TEMPLATE.md' };

/** A daily note template in Helm's shape: Habits, then Morning / Afternoon / Evening with time slots, Anytime, and a Daybook. */
export const DAILY_TEMPLATE = `---
title: <% tp.file.title %>
Type: Daily Note
week: "[[<% moment(tp.file.title, '{D}').format('{W}') %>]]"
creation_date: <% tp.date.now("YYYY-MM-DD") %>
tags:
  - dailynotes
---

Previous day: [[<% moment(tp.file.title, '{D}').subtract(1, 'd').format('{D}') %>|Yesterday]] · Next day: [[<% moment(tp.file.title, '{D}').add(1, 'd').format('{D}') %>|Tomorrow]]

# Day planner

### Habits

### A. Morning

- [ ] 07:00 - 08:00: 
- [ ] 08:00 - 09:00: 
- [ ] 09:00 - 10:00: 
- [ ] 10:00 - 11:00: 
- [ ] 11:00 - 12:00: 

### B. Afternoon

- [ ] 12:00 - 13:00: 
- [ ] 13:00 - 14:00: 
- [ ] 14:00 - 15:00: 
- [ ] 15:00 - 16:00: 
- [ ] 16:00 - 17:00: 
- [ ] 17:00 - 18:00: 

### C. Evening

- [ ] 18:00 - 19:00: 
- [ ] 19:00 - 20:00: 
- [ ] 20:00 - 21:00: 

### D. Anytime

## Daybook

`;

export function bundledDailyTemplate(cfg: TemplateConfig): string {
  return DAILY_TEMPLATE.replace(/\{D\}/g, cfg.dailyTitleFormat).replace(/\{W\}/g, cfg.formats.week);
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
