import { describe, expect, it } from 'vitest';
import { dailyPath, setup, TODAY } from './fixture';

const LESSONS = [
  '- [x] 09:00 - 09:45: Iwan: Pianoles 🔁 every week ⏱️ 45m ✅ 2026-08-26',
  '- [x] 09:45 - 10:25: Zaara/Iwan: Zangles 🔁 every week ⏱️ 40m ✅ 2026-08-26',
  '- [x] 10:35 - 11:10: Zaara: Groepsles 🔁 every week ⏱️ 35m ✅ 2026-08-26',
];
const note = (lines: string[]): string => `---\ntitle: 26\n---\n\n# Day planner\n\n### A. Morning\n\n${lines.join('\n')}\n\n### Anytime\n`;
const NEXT_WEEK = '2026-09-02';

describe('recurring lines ticked outside Helm', () => {
  it('gets their next turn back — all of them, not just one', async () => {
    // Ticked in the note itself: Helm never ran, so nothing was ever spawned.
    const { m, vault } = await setup({ [dailyPath(TODAY)]: note(LESSONS) });
    expect(await m.catchUpRecurring()).toBe(3);
    const next = await vault.read(dailyPath(NEXT_WEEK));
    expect(next).toContain('- [ ] 09:00 - 09:45: Iwan: Pianoles 🔁 every week ⏱️ 45m');
    expect(next).toContain('Zaara/Iwan: Zangles');
    expect(next).toContain('Zaara: Groepsles');
  });

  it('leaves alone the ones that already came back, and never makes a second copy', async () => {
    const { m, vault } = await setup({
      [dailyPath(TODAY)]: note(LESSONS),
      // One of the three already spawned — the one that was ticked in Helm.
      [dailyPath(NEXT_WEEK)]: note(['- [ ] 09:00 - 09:45: Iwan: Pianoles 🔁 every week ⏱️ 45m']),
    });
    expect(await m.catchUpRecurring()).toBe(2);                 // only the two that were missing
    const next = await vault.read(dailyPath(NEXT_WEEK));
    expect(next.match(/Iwan: Pianoles/g)).toHaveLength(1);      // not doubled
    expect(next).toContain('Zaara/Iwan: Zangles');
    // Running it again changes nothing at all.
    expect(await m.catchUpRecurring()).toBe(0);
  });

  it('does not go digging through old history, or land anything in the past', async () => {
    const { m } = await setup({
      // Ticked two months ago: its next turn was due long before today, and is not Helm's to invent now.
      [dailyPath('2026-06-24')]: `---\ntitle: 24\n---\n\n# Day planner\n\n### A. Morning\n\n- [x] 08:00 - 08:30: Old habit 🔁 every week ✅ 2026-06-24\n\n### Anytime\n`,
    });
    expect(await m.catchUpRecurring()).toBe(0);
  });

  it('still spawns the moment a task is ticked in Helm, as it always did', async () => {
    const { index, m, vault } = await setup({
      [dailyPath(TODAY)]: note(['- [ ] 09:00 - 09:45: Iwan: Pianoles 🔁 every week ⏱️ 45m']),
    });
    const key = [...index.snapshot.tasks.values()].find((t) => t.text.includes('Pianoles'))!.key;
    await m.setStatus(key, 'done');
    expect(await vault.read(dailyPath(NEXT_WEEK))).toContain('Iwan: Pianoles');
    expect(await m.catchUpRecurring()).toBe(0);                 // and the catch-up finds nothing to do
  });
});
