// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { lineChart } from '../../src/ui/charts';

describe('line chart x-axis labels', () => {
  it('always shows the last label and never lets a regular one collide with it', () => {
    // 30 days at the default 600px width: every 3rd label plus the last; day 27 (index 27, a multiple of 3) sits 40px before the last and must go.
    const labels = Array.from({ length: 30 }, (_, i) => `08-${String(i + 1).padStart(2, '0')}`);
    const el = lineChart([{ label: 'a', points: labels.map((_, i) => i) }], labels);
    const texts = [...el.querySelectorAll('text.helm-chart-label')].map((t) => ({ label: t.textContent, x: Number(t.getAttribute('x')) }));
    expect(texts.at(-1)!.label).toBe('08-30');
    expect(texts.map((t) => t.label)).not.toContain('08-28');
    for (let i = 1; i < texts.length; i++) expect(texts[i]!.x - texts[i - 1]!.x).toBeGreaterThanOrEqual(44);
  });
});
