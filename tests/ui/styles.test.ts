/** F14 (and the CSS half of F12) · styles.css stays free of the duplication and specificity fights the review found. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('styles.css', 'utf8');
/** Top-level rules only: what sits outside any @media / @container block. */
const topLevel = (): string[] => {
  const out: string[] = [];
  let depth = 0;
  let buf = '';
  for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
    if (ch === '{') { if (depth === 0) out.push(buf.trim()); depth++; buf = ''; continue; }
    if (ch === '}') { depth--; buf = ''; continue; }
    if (depth === 0) buf += ch;
  }
  return out;
};

describe('F14 · styles.css', () => {
  it('defines each of the previously duplicated selectors once at top level', () => {
    const sels = topLevel();
    for (const s of ['.helm-root', '.helm-check', '.helm-table-wrap', '.helm-stat-label']) expect(sels.filter((x) => x === s), s).toHaveLength(1);
  });

  it('keeps one deliberate !important (the helm-hidden utility) and no window-height maths', () => {
    expect(css.replace(/\/\*[\s\S]*?\*\//g, '').match(/!important/g)).toHaveLength(1);
    expect(css).toMatch(/\.helm-hidden \{ display: none !important; \}/);
    expect(css).not.toMatch(/100vh/);
    expect(css).not.toMatch(/rgba\(0, 0, 0, 0\.08\)/);
  });

  it('F12 · week-view row actions are hidden for a mouse only, so touch keeps them', () => {
    expect(css).toMatch(/@media \(hover: hover\) \{ \.helm-week-day-body \.helm-task \.helm-task-actions \{ display: none; \} \}/);
  });
});
