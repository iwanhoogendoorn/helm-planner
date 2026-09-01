import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';
import { dayPlan } from '../../src/data/planner';

const DAY = `---\ntitle: 26, Wednesday, Aug, 2026\n---\n\n# Day planner\n\n### B. Afternoon\n\n- [ ] Practice the assignments\n\t- [ ] CH-02: Penny Candy\n\t- [ ] CH-02: The Kangarooster\n\t- [ ] CH-02: Morning\n\n### Anytime\n`;

describe('planning one step for another day', () => {
  type Awaited2 = Awaited<ReturnType<typeof setup>>;
  const kid = (index: Awaited2['index'], text: string) =>
    [...index.snapshot.tasks.values()].find((t) => t.text === text)!;

  it('writes the day on the subtask’s own line, leaving it in its task', async () => {
    const { m, index, vault } = await setup({ [dailyPath(TODAY)]: DAY });
    await m.schedule(kid(index, 'CH-02: The Kangarooster').key, '2026-08-27');

    const note = await vault.read(dailyPath(TODAY));
    // Still the second child of the same task, in the same order, in the same note.
    expect(note).toMatch(/- \[ \] Practice the assignments\n\t- \[ \] CH-02: Penny Candy\n\t- \[ \] CH-02: The Kangarooster ⏳ 2026-08-27\n\t- \[ \] CH-02: Morning/);
    const after = kid(index, 'CH-02: The Kangarooster');
    expect(after.parentKey).toBeTruthy();
    expect(after.noteDate).toBe(TODAY);          // it did not move house
    expect(after.scheduled).toBe('2026-08-27');  // it just has a day of its own
  });

  it('shows up on that day, with its parent for context, and stays on its parent’s day too', async () => {
    const { m, index, settings } = await setup({ [dailyPath(TODAY)]: DAY });
    await m.schedule(kid(index, 'CH-02: The Kangarooster').key, '2026-08-27');

    // The day it was planned for: the step is there, marked as borrowed from its task.
    const thu = dayPlan(index.snapshot, '2026-08-27', settings);
    expect(thu.subtasks.map((t) => t.text)).toEqual(['CH-02: The Kangarooster']);
    expect(thu.items.filter((i) => i.kind === 'subtask').map((i) => i.display.text)).toEqual(['CH-02: The Kangarooster']);
    expect(thu.openCount).toBe(1);

    // Its own day still has the task, with every step under it — nothing was taken away.
    const wed = dayPlan(index.snapshot, TODAY, settings);
    const parent = wed.items.find((i) => i.display.text === 'Practice the assignments')!;
    expect(parent.display.childKeys.map((k) => index.task(k)!.text)).toEqual(['CH-02: Penny Candy', 'CH-02: The Kangarooster', 'CH-02: Morning']);
    expect(wed.subtasks).toEqual([]);
  });

  it('a part of the day gives it a time there; unplanning gives the day back', async () => {
    const { m, index } = await setup({ [dailyPath(TODAY)]: DAY });
    const key = () => kid(index, 'CH-02: Morning').key;
    await m.schedule(key(), '2026-08-27', 'evening');
    const planned = kid(index, 'CH-02: Morning');
    expect(planned.scheduled).toBe('2026-08-27');
    expect(planned.time!.start >= '18:00').toBe(true);

    await m.schedule(key(), undefined);
    const back = kid(index, 'CH-02: Morning');
    expect(back.scheduled).toBeUndefined();
    expect(back.time).toBeUndefined();
    expect(back.parentKey).toBeTruthy();          // still a step of the same task
  });
});
