import { describe, expect, it } from 'vitest';
import { findRegion, readRegion, removeLines, writeRegion } from '../../src/core/dailyNote';
import { splitLines } from '../../src/core/frontmatter';
import { newTaskLine } from '../../src/core/taskLine';

const RS = { regionPlacement: 'before-first-heading' as const, regionAnchor: '', planHeading: '## Plan' };

describe('writeRegion', () => {
  it('keeps a child the caller kept when its parent is removed (CD-03)', () => {
    const note = `# Day planner\n\n### A. Morning\n\n- [ ] Parent 🆔 tsk-a\n  - [ ] Child 🆔 tsk-b\n\n### Anytime\n`;
    const { lines } = splitLines(note);
    const cur = readRegion(lines, findRegion(lines, RS).region!);
    expect(cur.morning.map((l) => l.id)).toEqual(['tsk-a', 'tsk-b']);
    const out = writeRegion(note, { ...cur, morning: cur.morning.filter((l) => l.id === 'tsk-b') }, RS)!;
    const text = out.lines.join(out.eol);
    expect(text).not.toContain('Parent');
    expect(text).toContain('Child 🆔 tsk-b');
  });

  it('still takes the subtree of a removed line when the children are not kept', () => {
    const note = `# Day planner\n\n### A. Morning\n\n- [ ] Parent 🆔 tsk-a\n  - [ ] Child 🆔 tsk-b\n  - a note\n- [ ] Other 🆔 tsk-c\n\n### Anytime\n`;
    const { lines } = splitLines(note);
    const cur = readRegion(lines, findRegion(lines, RS).region!);
    const out = writeRegion(note, { ...cur, morning: cur.morning.filter((l) => l.id === 'tsk-c') }, RS)!;
    const text = out.lines.join(out.eol);
    expect(text).not.toMatch(/Parent|Child|a note/);
    expect(text).toContain('Other 🆔 tsk-c');
  });
});

describe('removeLines', () => {
  it('measures the subtree in columns, so a tab-indented child goes with a space-indented parent (CD-14)', () => {
    const parent = newTaskLine('Parent', { id: 'tsk-a' }, '  ');
    const child = newTaskLine('Child', { id: 'tsk-b' }, '\t '); // 3 columns, but only 2 characters, like the parent
    const other = newTaskLine('Other', { id: 'tsk-c' });
    const rc = { habits: [], morning: [parent, child, other], afternoon: [], evening: [], anytime: [], extra: [] };
    const removed = removeLines(rc, (l) => l.id === 'tsk-a');
    expect(removed.map((l) => l.id)).toEqual(['tsk-a', 'tsk-b']);
    expect(rc.morning.map((l) => l.id)).toEqual(['tsk-c']);
  });
});
