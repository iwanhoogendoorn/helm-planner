import { describe, expect, it } from 'vitest';
import { columnWidth, fenceStart, fenceStep, isHeading, nest } from '../../src/core/tree';

describe('tree (CD-10)', () => {
  it('measures indents in columns: a tab moves to the next multiple of two', () => {
    expect(columnWidth('')).toBe(0);
    expect(columnWidth('  ')).toBe(2);
    expect(columnWidth('\t')).toBe(2);
    expect(columnWidth(' \t')).toBe(2);
    expect(columnWidth('\t ')).toBe(3);
    expect(columnWidth('\t\t')).toBe(4);
  });

  it('tracks fences: opened and closed by the same marker, at least as long', () => {
    const f = fenceStart();
    const inside = ['text', '```js', '- [ ] not a task', '~~~', '````', 'after'].map((l) => fenceStep(f, l));
    expect(inside).toEqual([false, true, true, true, true, false]);
    const g = fenceStart();
    expect(fenceStep(g, '``` has `ticks` inline')).toBe(false); // an inline code span, not a fence
    expect(fenceStep(g, '~~~')).toBe(true);
    expect(fenceStep(g, '~~')).toBe(true);
    expect(fenceStep(g, '~~~~')).toBe(true);
    expect(g.open).toBe(false);
  });

  it('nests tasks by indent, resets on prose and fences, keeps going over blank lines and bullets', () => {
    const lines = ['- [ ] A', '\t- [ ] A1', '\t\t- [ ] A1a', '', '  - note', '\t- [ ] A2', 'Prose', '\t- [ ] B (after prose: a root)', '```', '- [ ] fenced', '```', '- [ ] C'];
    const isTask = (i: number): boolean => /- \[.\]/.test(lines[i]!) && i !== 9;
    const indentOf = (i: number): string => /^[ \t]*/.exec(lines[i]!)![0];
    const n = nest(lines, isTask, indentOf);
    expect([...n.values()].map((x) => [lines[x.index]!.trim(), x.depth, x.parent])).toEqual([
      ['- [ ] A', 0, undefined],
      ['- [ ] A1', 1, 0],
      ['- [ ] A1a', 2, 1],
      ['- [ ] A2', 1, 0],
      ['- [ ] B (after prose: a root)', 0, undefined],
      ['- [ ] C', 0, undefined],
    ]);
  });

  it('reads ATX headings, with closing hashes trimmed', () => {
    expect(isHeading('## Phase: Outline ##')).toEqual({ level: 2, text: 'Phase: Outline' });
    expect(isHeading('###### Six')).toEqual({ level: 6, text: 'Six' });
    expect(isHeading('####### seven')).toBeUndefined();
    expect(isHeading('#hashtag')).toBeUndefined();
  });
});
