import { describe, expect, it } from 'vitest';
import { parseFrontmatter, splitLines } from '../../src/core/frontmatter';
import { renderHabitNote } from '../../src/core/habit';
import { renderProjectNote } from '../../src/core/project';

/**
 * A strict-enough check of the YAML Helm writes: every line is `key: value`, `key:` or `  - item`, and no
 * plain (unquoted) value holds something a YAML parser reads differently — `: `, ` #`, a leading indicator,
 * a backslash escape that only means something inside quotes.
 */
function strictYaml(content: string): void {
  const { lines } = splitLines(content);
  const fm = parseFrontmatter(lines);
  expect(fm.present).toBe(true);
  for (const line of fm.lines) {
    const m = /^(?:([A-Za-z_][\w-]*):|\s+-)(?: (.*))?$/.exec(line);
    expect(m, line).not.toBeNull();
    const v = m![2];
    if (v === undefined || v === '' || /^".*"$/.test(v) || /^\[.*\]$/.test(v)) continue;
    expect(v, line).not.toMatch(/^[#&*!|>'"%@`{}[\],?:-]|: | #/);
  }
}

const NASTY = ['Read: 20 pages', '#1 habit', 'C:\\temp', 'say "hi"', 'x # y', 'two\nlines'];

describe('renderers write valid YAML (CD-07)', () => {
  it('habit notes', () => {
    for (const title of NASTY) {
      const note = renderHabitNote({ id: 'hab-1', title, schedule: 'every day', icon: '📖', today: '2026-10-21' });
      strictYaml(note);
      expect(parseFrontmatter(splitLines(note).lines).values['title']).toBe(title);
    }
  });
  it('project notes', () => {
    for (const s of NASTY) {
      const note = renderProjectNote({ id: 'prj-1', title: s, status: 'active', priority: 'medium', area: s, parent: `[[${s.replace(/\n/g, ' ')}]]`, goal: s, tags: [s], people: [s], modes: [s], today: '2026-10-21' });
      strictYaml(note);
      const v = parseFrontmatter(splitLines(note).lines).values;
      expect(v['title']).toBe(s);
      expect(v['area']).toBe(s);
      expect(v['goal']).toBe(s);
      expect(v['tags']).toEqual(['project', s]);
      expect(v['people']).toEqual([s]);
    }
  });
});
