import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';

describe('a repeating task you did not do', () => {
  const WEEKLY = `---\ntitle: 26, Wednesday, Aug, 2026\n---\n\n# Day planner\n\n### A. Morning\n\n- [ ] 11:00 - 11:45: #meeting Team meeting 🔁 every week on wednesday 📅 ${TODAY}\n\n### Anytime\n`;

  it('cancelling one occurrence skips it and still brings the next', async () => {
    const { m, index, vault } = await setup({ [dailyPath(TODAY)]: WEEKLY });
    const t = [...index.snapshot.tasks.values()].find((x) => x.text.includes('Team meeting'))!;
    await m.setStatus(t.key, 'cancelled');

    const all = [...index.snapshot.tasks.values()].filter((x) => x.text.includes('Team meeting'));
    expect(all.map((x) => x.status).sort()).toEqual(['cancelled', 'todo']);      // this one off, the next one on
    const next = all.find((x) => x.status === 'todo')!;
    expect(next.due).toBe('2026-09-02');                                          // the Wednesday after
    expect(next.recurrence!.raw).toBe('every week on wednesday');                 // and it still repeats
    const note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/- \[-\] .*Team meeting/);                               // cancelled, on the record
  });

  it('stopping the repeat leaves this one and brings no more', async () => {
    const { m, index, vault } = await setup({ [dailyPath(TODAY)]: WEEKLY });
    const t = [...index.snapshot.tasks.values()].find((x) => x.text.includes('Team meeting'))!;
    await m.stopRepeating(t.key);
    const after = [...index.snapshot.tasks.values()].find((x) => x.text.includes('Team meeting'))!;
    expect(after.recurrence).toBeUndefined();
    expect(await vault.read(after.path)).not.toContain('🔁');

    // Now cancelling really is the end of it.
    await m.setStatus(after.key, 'cancelled');
    expect([...index.snapshot.tasks.values()].filter((x) => x.text.includes('Team meeting'))).toHaveLength(1);
  });

  it('finishing one still brings the next, as before', async () => {
    const { m, index } = await setup({ [dailyPath(TODAY)]: WEEKLY });
    const t = [...index.snapshot.tasks.values()].find((x) => x.text.includes('Team meeting'))!;
    await m.setStatus(t.key, 'done');
    const all = [...index.snapshot.tasks.values()].filter((x) => x.text.includes('Team meeting'));
    expect(all.map((x) => x.status).sort()).toEqual(['done', 'todo']);
  });
});

