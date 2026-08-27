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
