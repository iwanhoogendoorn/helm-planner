import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/core/document';
import { parseFrontmatter, setFrontmatter, splitLines } from '../../src/core/frontmatter';
import { parseProject, renderProjectNote } from '../../src/core/project';
import { emptyContent, findRegion, readRegion, writeRegion, renderRegion } from '../../src/core/dailyNote';
import { newTaskLine } from '../../src/core/taskLine';
import { parseHabit } from '../../src/core/habit';

const PROJECT = `---
title: Oracle Book Writing
type: project
status:
  - active
priority:
  - medium
area:
  - Oracle
tags: project
id: prj-mbq6qv
deadline: 2026-12-31
---

# Oracle Book Writing

## Objective

Write the book.

## Phase: Outline 📅 2026-09-15

- [ ] Draft chapter list 🆔 tsk-0001
\t- [ ] Collect diagrams
\t\t- [x] Export from draw.io ✅ 2026-08-01
- [ ] Review with editor

## Phase: Writing

- [ ] Chapter 1
- [ ] Chapter 2

## Tasks

Routing tables:
- [ ] Create routing tables
- [ ] Populate them

\`\`\`markdown
- [ ] not a task, inside a fence
## Phase: Fake
\`\`\`

## Log
`;

describe('frontmatter', () => {
  it('reads scalars, inline lists and block lists', () => {
    const fm = parseFrontmatter(splitLines(PROJECT).lines);
    expect(fm.values['title']).toBe('Oracle Book Writing');
    expect(fm.values['status']).toEqual(['active']);
    expect(fm.values['tags']).toBe('project');
    expect(fm.endLine).toBe(13);
  });
  it('sets keys in place and appends new ones', () => {
    const lines = ['---', 'title: X', 'status:', '  - active', 'tags: [a, b]', '---', '', '# X'];
    const out = setFrontmatter(lines, { status: 'done', id: 'prj-1', tags: ['a', 'b', 'c'] });
    expect(out).toEqual(['---', 'title: X', 'status: done', 'tags:', '  - a', '  - b', '  - c', 'id: prj-1', '---', '', '# X']);
    expect(setFrontmatter(['# no fm'], { type: 'project' })).toEqual(['---', 'type: project', '---', '# no fm']);
  });
});

describe('document', () => {
  it('nests tasks and ignores fences', () => {
    const doc = parseDocument(PROJECT);
    expect(doc.tasks.map((t) => t.depth)).toEqual([0, 1, 2, 0, 0, 0, 0, 0]);
    expect(doc.tasks[1]!.parentLine).toBe(doc.tasks[0]!.line);
    expect(doc.headings.map((h) => h.text)).toEqual(['Oracle Book Writing', 'Objective', 'Phase: Outline 📅 2026-09-15', 'Phase: Writing', 'Tasks', 'Log']);
  });
});

describe('project', () => {
  it('parses frontmatter, phases and loose tasks', () => {
    const p = parseProject('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md', PROJECT);
    expect(p.project.id).toBe('prj-mbq6qv');
    expect(p.project.status).toBe('active');
    expect(p.project.priority).toBe('medium');
    expect(p.project.area).toBe('Oracle');
    expect(p.project.due).toBe('2026-12-31');
    expect(p.project.tags).toEqual([]);
    expect(p.project.phases.map((ph) => [ph.title, ph.due])).toEqual([['Outline', '2026-09-15'], ['Writing', undefined]]);
    expect(p.project.phases[0]!.id).toBe('prj-mbq6qv#outline');
    expect(p.project.tasksHeadingLine).toBe(doc(PROJECT).headings.find((h) => h.text === 'Tasks')!.line);
    expect([...p.phaseOfTask.values()]).toEqual([
      'prj-mbq6qv#outline', 'prj-mbq6qv#outline', 'prj-mbq6qv#outline', 'prj-mbq6qv#outline',
      'prj-mbq6qv#writing', 'prj-mbq6qv#writing', undefined, undefined,
    ]);
  });
  it('renders a new note that parses back', () => {
    const txt = renderProjectNote({ id: 'prj-new', title: 'Kitchen: Remodel', status: 'planned', priority: 'high', area: 'House', today: '2026-08-26', phases: [{ title: 'Design', due: '2026-09-30', tasks: ['Sketch layout'] }], tasks: ['Get quotes'] });
    const p = parseProject('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md', txt);
    expect(p.project.title).toBe('Kitchen: Remodel');
    expect(p.project.phases[0]!.due).toBe('2026-09-30');
    expect(p.doc.tasks).toHaveLength(2);
  });
});

function doc(s: string) { return parseDocument(s); }

const DAILY = `---
title: 26, Wednesday, Aug, 2026
---

Previous day: [[25, Tuesday, Aug, 2026|Yesterday]]

# Backlog Tasks

# Day planner

### A. Morning

- [ ] 07:00 - 08:00:
- [ ] 08:00 - 09:00: Start with OIB
`;

const RS = { regionPlacement: 'before-first-heading' as const, regionAnchor: '', planHeading: '## Plan' };

describe('daily note region', () => {
  it('never writes a line the section already holds', () => {
    // A rewrite works from a snapshot. If the file moved on and now holds the very line Helm is about
    // to add, adding it again makes a second copy of the task — and of every subtask under it.
    const note = `---\ntitle: 26, Wednesday, Aug, 2026\n---\n\n# Day planner\n\n### A. Morning\n\n- [ ] 08:00 - 09:00: Continue with OIB\n\t- [ ] Verify workflow\n\n### Anytime\n`;
    const { lines } = splitLines(note);
    const cur = readRegion(lines, findRegion(lines, RS).region!);
    // The snapshot says this line is new; the file already has it.
    const stale = { ...cur, morning: [...cur.morning, newTaskLine('08:00 - 09:00: Continue with OIB')] };
    const out = writeRegion(note, stale, RS)!;
    const text = out.lines.join(out.eol);
    expect(text.match(/Continue with OIB/g)).toHaveLength(1);
    expect(text.match(/Verify workflow/g)).toHaveLength(1);
  });

  it('keeps two lines worded the same exactly where they are', () => {
    // A list can repeat itself — “Delete the local copy” once per account — and both lines are real
    // work in their own place. Rewriting the region must not treat the second one as new.
    const note = `---\ntitle: 26, Wednesday, Aug, 2026\n---\n\n# Day planner\n\n### A. Morning\n\n- [ ] Standup\n\n### Anytime\n- [ ] Sort the drive\n\t- [ ] Copy it over\n\t- [ ] Delete the local copy\n\t- [ ] Copy the rest over\n\t- [ ] Delete the local copy\n- [ ] Something else\n`;
    const { lines } = splitLines(note);
    const region = findRegion(lines, RS).region!;
    const cur = readRegion(lines, region);
    expect(cur.anytime.map((l) => l.text)).toEqual(['Sort the drive', 'Copy it over', 'Delete the local copy', 'Copy the rest over', 'Delete the local copy', 'Something else']);

    // Change something else entirely — the morning — and the anytime list must come back untouched.
    const out = writeRegion(note, { ...cur, morning: [] }, RS)!;
    const text = out.lines.join(out.eol);
    expect(text.slice(text.indexOf('### Anytime'))).toBe(`### Anytime\n- [ ] Sort the drive\n\t- [ ] Copy it over\n\t- [ ] Delete the local copy\n\t- [ ] Copy the rest over\n\t- [ ] Delete the local copy\n- [ ] Something else\n`);
    expect(text).not.toMatch(/Something else\n\t?- \[ \] Delete the local copy/); // never re-appended at the end
  });


  it('adopts the note\'s own Day planner sections and edits them in place', () => {
    const { lines: l0 } = splitLines(DAILY);
    const scan0 = findRegion(l0, RS);
    expect(scan0.region?.adopted).toBe(true);
    expect(scan0.region?.sections.morning.taskLines).toHaveLength(2);
    const cur = readRegion(l0, scan0.region!);
    const content = { ...cur, habits: [newTaskLine('Workout', { id: 'hab-1' })], morning: [...cur.morning, newTaskLine('Standup', { id: 'tsk-3' })], afternoon: [newTaskLine('Fix router', { id: 'tsk-1', effortMinutes: 30 })], anytime: [newTaskLine('Draft list', { id: 'tsk-2', mirrorLink: '[[OCI]]', due: '2026-09-05' })] };
    const w = writeRegion(DAILY, content, RS)!;
    const text = w.lines.join(w.eol);
    expect(text).not.toContain('## Plan');
    expect(text).not.toContain('%%');
    expect(text).toBe(`---
title: 26, Wednesday, Aug, 2026
---

Previous day: [[25, Tuesday, Aug, 2026|Yesterday]]

# Backlog Tasks

# Day planner

### Habits
- [ ] Workout 🆔 hab-1

### A. Morning

- [ ] 07:00 - 08:00:
- [ ] 08:00 - 09:00: Start with OIB
- [ ] Standup 🆔 tsk-3

### Afternoon
- [ ] Fix router 🆔 tsk-1 ⏱️ 30m

### Anytime
- [ ] Draft list 🆔 tsk-2 📅 2026-09-05 🔗 [[OCI]]
`);
    const scan = findRegion(w.lines, RS);
    expect(scan.region?.adopted).toBe(true);
    const rc = readRegion(w.lines, scan.region!);
    expect(rc.morning.map((l) => l.text)).toEqual(['', 'Start with OIB', 'Standup']);
    expect(rc.afternoon[0]!.text).toBe('Fix router');
    // Remove one, tick one: only those lines change.
    const rc2 = { ...rc, afternoon: [], morning: rc.morning.map((l) => (l.text === 'Standup' ? { ...l, status: 'done' as const, marker: 'x', done: '2026-08-26' } : l)) };
    const w2 = writeRegion(text, rc2, RS)!;
    expect(w2.lines.join('\n')).toBe(text.replace('- [ ] Standup 🆔 tsk-3', '- [x] Standup 🆔 tsk-3 ✅ 2026-08-26').replace('- [ ] Fix router 🆔 tsk-1 ⏱️ 30m\n', ''));
  });
  it('creates its own plan block only when the note has no sections', () => {
    const note = '---\ntitle: x\n---\n\n# Notes\n\nsome prose\n';
    const w = writeRegion(note, { ...emptyContent(), anytime: [newTaskLine('a')] }, RS)!;
    expect(w.lines.join('\n')).toBe('---\ntitle: x\n---\n\n## Plan\n### Anytime\n- [ ] a\n\n# Notes\n\nsome prose\n');
    const w2 = writeRegion(w.lines.join('\n'), { ...emptyContent(), morning: [newTaskLine('m')], anytime: [newTaskLine('a')] }, RS)!;
    expect(w2.lines.join('\n')).toBe('---\ntitle: x\n---\n\n## Plan\n### Morning\n- [ ] m\n### Anytime\n- [ ] a\n\n# Notes\n\nsome prose\n');
    const w3 = writeRegion(w2.lines.join('\n'), { ...emptyContent(), anytime: [newTaskLine('a')] }, RS)!;
    expect(w3.lines.join('\n')).toBe(w.lines.join('\n'));
  });
  it('reads legacy marker regions and rewrites them without markers', () => {
    const lines = ['%% helm:start %%', '## Plan', 'Some note', '### Today', '- [ ] a', '### From projects', '- [ ] b 🔗 [[P]]', '%% helm:end %%', '', '# Next'];
    const scan = findRegion(lines, RS);
    expect(scan.region!.legacy).toBe(true);
    expect(scan.region!.extra).toEqual(['Some note']);
    const rc = readRegion(lines, scan.region!);
    expect(rc.anytime.map((l) => l.text)).toEqual(['a', 'b']);
    expect(renderRegion(rc, RS)).toEqual(['## Plan', '### Anytime', '- [ ] a', '- [ ] b 🔗 [[P]]', 'Some note']);
    const w = writeRegion(lines.join('\n'), rc, RS)!;
    expect(w.lines.join('\n')).toBe('## Plan\n### Anytime\n- [ ] a\n- [ ] b 🔗 [[P]]\nSome note\n\n# Next');
    expect(findRegion(['%% helm:start %%', '- [ ] a'], RS).broken).toBe(true);
    expect(writeRegion('%% helm:start %%\n- [ ] a', { habits: [], morning: [], afternoon: [], evening: [], anytime: [], extra: [] }, RS)).toBeUndefined();
  });
  it('heading-delimited region ends at the next heading of the same level', () => {
    const lines = ['# Top', '', '## Plan', '### Morning', '- [ ] m', '', '## Other', '- [ ] not ours'];
    const scan = findRegion(lines, RS);
    expect(scan.region).toMatchObject({ start: 2, end: 4, legacy: false });
    expect(readRegion(lines, scan.region!).morning.map((l) => l.text)).toEqual(['m']);
  });
  it('after-anchor placement', () => {
    const w = writeRegion('# Top\n\n## Helm\n\n## Other\n', { ...emptyContent(), anytime: [newTaskLine('x')] }, { ...RS, regionPlacement: 'after-anchor', regionAnchor: '## Helm' })!;
    expect(w.lines.join('\n')).toBe('# Top\n\n## Helm\n\n## Plan\n### Anytime\n- [ ] x\n\n## Other\n');
  });
});

describe('habit', () => {
  it('parses', () => {
    const h = parseHabit('Habits/Workout.md', '---\ntype: habit\nid: hab-1\ntitle: Morning workout\nschedule: every weekday\ntarget_per_week: 4\ngrace_days: 1\n---\n')!;
    expect(h.schedule.weekdays).toEqual([1, 2, 3, 4, 5]);
    expect(h.targetPerWeek).toBe(4);
    expect(h.graceDays).toBe(1);
    expect(h.active).toBe(true);
    expect(parseHabit('x.md', '---\ntype: project\n---\n')).toBeUndefined();
  });
});
