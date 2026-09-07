import { describe, expect, it } from 'vitest';
import { dailyPath, setup, TODAY } from './fixture';

const NOTE = `---\ntitle: 26\n---\n\n# Day planner\n\n### A. Morning\n\n- [ ] 09:00 - 09:45: Piano practice ⏱️ 45m\n\n### B. Afternoon\n\n### C. Evening\n\n### Anytime\n\n- [ ] Ring the plumber ⏱️ 30m\n`;
const OTHER = '2026-08-28';

describe('moving a task to a part of another day', () => {
  it('drops the time when the part is Anytime, so it stays there', async () => {
    const { index, m, vault } = await setup({ [dailyPath(TODAY)]: NOTE });
    const key = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Piano practice'))!.key;
    await m.schedule(key, OTHER, 'anytime');

    const note = await vault.read(dailyPath(OTHER));
    expect(note.split('### Anytime')[1]).toContain('- [ ] Piano practice ⏱️ 45m');
    expect(note).not.toContain('09:00');                        // the time is gone, not carried over
    const moved = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Piano practice') && t.status !== 'forwarded')!;
    expect(moved.noteDate).toBe(OTHER);
    expect(moved.part).toBe('anytime');
    expect(moved.time).toBeUndefined();                         // …so the day cannot draw it back into the morning
  });

  it('gives a free slot in that part of the new day when a part is asked for', async () => {
    const { index, m, vault } = await setup({ [dailyPath(TODAY)]: NOTE });
    const key = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Ring the plumber'))!.key;
    await m.schedule(key, OTHER, 'evening');

    const moved = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Ring the plumber') && t.status !== 'forwarded')!;
    expect(moved.noteDate).toBe(OTHER);
    expect(moved.part).toBe('evening');
    expect(moved.time).toBeDefined();                           // an evening task has an evening time
    expect(moved.time!.start >= '17:00').toBe(true);
    expect(await vault.read(dailyPath(OTHER))).toMatch(/### (C\. )?Evening[\s\S]*Ring the plumber/);
  });

  it('“just move it” keeps the time it had', async () => {
    const { index, m } = await setup({ [dailyPath(TODAY)]: NOTE });
    const key = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Piano practice'))!.key;
    await m.schedule(key, OTHER);                               // no part named
    const moved = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Piano practice') && t.status !== 'forwarded')!;
    expect(moved.time).toEqual({ start: '09:00', end: '09:45' });
    expect(moved.noteDate).toBe(OTHER);
  });

  it('carrying a task into the same part of another day does not invent a time', async () => {
    // Rollover keeps yesterday's afternoon work in the afternoon; that is not a decision about when.
    const { index, m } = await setup({ [dailyPath(TODAY)]: NOTE });
    const key = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Ring the plumber'))!.key;
    await m.schedule(key, OTHER, 'anytime');
    const moved = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Ring the plumber') && t.status !== 'forwarded')!;
    expect(moved.time).toBeUndefined();
  });

  it('still works the same way within one day', async () => {
    const { index, m } = await setup({ [dailyPath(TODAY)]: NOTE });
    const key = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Piano practice'))!.key;
    await m.schedule(key, TODAY, 'anytime');
    const moved = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Piano practice'))!;
    expect(moved.part).toBe('anytime');
    expect(moved.time).toBeUndefined();
  });
});
