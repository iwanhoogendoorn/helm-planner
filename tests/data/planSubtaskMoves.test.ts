import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';

const DAY = `---\ntitle: 26, Wednesday, Aug, 2026\n---\n\n# Day planner\n\n### B. Afternoon\n\n- [ ] Practice the assignments\n\t- [ ] Step one\n\t- [ ] Step two\n\t- [ ] Step three\n\n### Anytime\n`;

describe('moving things around, with steps planned for their own days', () => {
  type S = Awaited<ReturnType<typeof setup>>;
  const find = (index: S['index'], text: string) => [...index.snapshot.tasks.values()].find((t) => t.text === text)!;

  it('a step dragged to another day is planned there, not taken out of its task', async () => {
    const { m, index, vault } = await setup({ [dailyPath(TODAY)]: DAY });
    await m.schedule(find(index, 'Step two').key, '2026-08-28', 'evening');   // what a drop on a part does

    const note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/- \[ \] Practice the assignments\n\t- \[ \] Step one\n\t- \[ \] \d\d:\d\d - \d\d:\d\d: Step two ⏳ 2026-08-28\n\t- \[ \] Step three/);
    const step = find(index, 'Step two');
    expect(step.parentKey).toBeTruthy();
    expect(step.scheduled).toBe('2026-08-28');
    expect(step.time!.start >= '18:00').toBe(true);                            // a slot in the evening
    expect(await vault.exists(dailyPath('2026-08-28'))).toBe(false);            // and it did not move house
  });

  it('moving the task to another day takes its steps and their own plans with it', async () => {
    const { m, index, vault } = await setup({ [dailyPath(TODAY)]: DAY });
    await m.schedule(find(index, 'Step two').key, '2026-08-28');
    await m.schedule(find(index, 'Step three').key, '2026-08-27');
    await m.schedule(find(index, 'Practice the assignments').key, '2026-08-27');

    const moved = await vault.read(dailyPath('2026-08-27'));
    expect(moved).toMatch(/- \[ \] Practice the assignments\n\t- \[ \] Step one\n\t- \[ \] Step two[^\n]*⏳ 2026-08-28[^\n]*\n\t- \[ \] Step three[^\n]*⏳ 2026-08-27/);
    expect(find(index, 'Practice the assignments').noteDate).toBe('2026-08-27');
    expect(find(index, 'Step two').scheduled).toBe('2026-08-28');    // each step kept its own day
    expect(find(index, 'Step three').scheduled).toBe('2026-08-27');
  });

  it('a step planned for the day its task is on is simply back home', async () => {
    const { m, index } = await setup({ [dailyPath(TODAY)]: DAY });
    await m.schedule(find(index, 'Step one').key, '2026-08-28');
    await m.schedule(find(index, 'Step one').key, TODAY);
    const step = find(index, 'Step one');
    expect(step.scheduled).toBe(TODAY);
    expect(step.noteDate).toBe(TODAY);
    expect(step.parentKey).toBeTruthy();
  });

  it('following up a planned step still makes a task of its own', async () => {
    const { m, index } = await setup({ [dailyPath(TODAY)]: DAY });
    await m.schedule(find(index, 'Step two').key, '2026-08-28');
    await m.followUp(find(index, 'Step two').key, { text: 'Step two, again', date: '2026-08-28' });
    const follow = find(index, 'Step two, again');
    expect(follow.parentKey).toBeUndefined();      // a follow-up is its own task, as before
    expect(find(index, 'Step two').parentKey).toBeTruthy();
  });
});
