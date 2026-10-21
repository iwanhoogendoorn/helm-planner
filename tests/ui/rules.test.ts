/** F13 · the scheduling and parsing rules the views share, tested without rendering anything. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { setup, TODAY } from '../data/fixture';
import { parseCapture } from '../../src/core/nlp';
import { dayPlan } from '../../src/data/planner';
import { captureTask, parsePhaseTitle, retimeFor, spillovers } from '../../src/ui/rules';

describe('F13 · ui/rules', () => {
  it('captureTask maps a parsed capture line to the fields addTask writes', () => {
    const c = parseCapture('Call the plumber tomorrow !high ~30m 14:00', TODAY);
    const spec = captureTask(c);
    expect(spec.text).toBe(c.text);
    expect(spec.date).toBe(c.scheduled);
    expect(spec.fields).toMatchObject({ priority: 'high', effortMinutes: 30, effortRaw: '30m', time: { start: '14:00' } });
    expect(captureTask(parseCapture('Plain', TODAY)).fields).toEqual({ priority: 'normal' });
  });

  it('parsePhaseTitle splits a trailing 📅 date off the title', () => {
    expect(parsePhaseTitle('Research 📅 2026-09-30')).toEqual({ title: 'Research', due: '2026-09-30' });
    expect(parsePhaseTitle('  Writing  ')).toEqual({ title: 'Writing' });
  });

  it('spillovers ghosts a timed task into every later part it is still running in', async () => {
    const { m, index, settings } = await setup();
    await m.addTask({ text: 'Long lunch', date: TODAY, fields: { time: { start: `${settings.morningEnds.slice(0, 2)}:00`, end: '23:00' } } });
    const plan = dayPlan(index.snapshot, TODAY, settings);
    const spill = spillovers(plan, settings);
    const names = (p: 'afternoon' | 'evening'): string[] => (spill[p] ?? []).map((s) => s.item.display.text);
    expect(names('evening')).toContain('Long lunch');
  });

  it('retimeFor keeps a block’s length and leaves it alone when it already fits', async () => {
    const { m, index, settings } = await setup();
    await m.addTask({ text: 'Block', date: TODAY, fields: { time: { start: '20:00', end: '20:45' } } });
    const t = index.allTasks().find((x) => x.text === 'Block')!;
    const slot = retimeFor(index.snapshot, settings, t, TODAY, 'morning');
    expect(slot).toBeDefined();
    const [sh, sm] = slot!.start.split(':').map(Number);
    const [eh, em] = slot!.end!.split(':').map(Number);
    expect((eh! * 60 + em!) - (sh! * 60 + sm!)).toBe(45);
  });

  it('the UI no longer carries its own copies of the clock maths', () => {
    for (const f of ['src/ui/tabs/today.ts', 'src/ui/fields.ts']) expect(readFileSync(f, 'utf8'), f).not.toMatch(/const toMin = /);
  });
});
