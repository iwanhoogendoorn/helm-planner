import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';

const DAY = (body: string): string => `---\ntitle: 26, Wednesday, Aug, 2026\n---\n\n# Day planner\n\n### Anytime\n\n${body}`;

describe('writing the daybook', () => {
  it('starts one when the day has none, then keeps entries in time order', async () => {
    const { m, index, vault } = await setup({ [dailyPath(TODAY)]: DAY('') });
    expect(index.daybook(TODAY)).toEqual([]);

    await m.addDaybookEntry(TODAY, 'Picked up a new SR', { time: '12:49' });
    expect(await vault.read(dailyPath(TODAY))).toContain('## Daybook');
    await m.addDaybookEntry(TODAY, 'Call about heat pumps', { time: '13:42' });
    await m.addDaybookEntry(TODAY, 'Woke up late', { time: '09:05' });     // out of order: it goes first

    expect(index.daybook(TODAY).map((e) => [e.time, e.text])).toEqual([
      ['09:05', 'Woke up late'],
      ['12:49', 'Picked up a new SR'],
      ['13:42', 'Call about heat pumps'],
    ]);
    expect(index.daybook(TODAY).every((e) => e.icon === '⌨️')).toBe(true);
    // The note reads as markdown anyone could have typed.
    expect(await vault.read(dailyPath(TODAY))).toMatch(/- \*\*09:05\*\* ⌨️ Woke up late/);
  });

  it('replies tuck under the entry they answer', async () => {
    const { m, index } = await setup({ [dailyPath(TODAY)]: DAY('') });
    await m.addDaybookEntry(TODAY, 'Picked up a new SR', { time: '12:49' });
    await m.addDaybookEntry(TODAY, 'Call about heat pumps', { time: '13:42' });
    const first = index.daybook(TODAY)[0]!;
    await m.addDaybookReply(TODAY, first.line, 'What is next?');

    const after = index.daybook(TODAY);
    expect(after.map((e) => e.text)).toEqual(['Picked up a new SR', 'Call about heat pumps']);
    expect(after[0]!.replies.map((r) => r.text)).toEqual(['What is next?']);
    expect(after[1]!.replies).toEqual([]);
  });

  it('rewords and removes an entry, replies and all', async () => {
    const { m, index, vault } = await setup({ [dailyPath(TODAY)]: DAY('') });
    await m.addDaybookEntry(TODAY, 'First', { time: '09:00' });
    await m.addDaybookEntry(TODAY, 'Second', { time: '10:00' });
    await m.addDaybookReply(TODAY, index.daybook(TODAY)[0]!.line, 'A note');

    await m.updateDaybookEntry(TODAY, index.daybook(TODAY)[0]!.line, 'First, reworded');
    expect(index.daybook(TODAY)[0]).toMatchObject({ time: '09:00', text: 'First, reworded' });
    expect(index.daybook(TODAY)[0]!.replies).toHaveLength(1);              // the reply stayed with it

    await m.removeDaybookEntry(TODAY, index.daybook(TODAY)[0]!.line);
    expect(index.daybook(TODAY).map((e) => e.text)).toEqual(['Second']);
    expect(await vault.read(dailyPath(TODAY))).not.toContain('A note');    // the reply went with its entry
  });

  it('an existing daybook is added to, not rewritten', async () => {
    const written = '## Daybook\n\n- **11:13** 🔔 A prompt from a bot?\n\t- 💬 *An answer.*\n';
    const { m, index, vault } = await setup({ [dailyPath(TODAY)]: DAY(written) });
    await m.addDaybookEntry(TODAY, 'Mine', { time: '12:00' });
    const note = await vault.read(dailyPath(TODAY));
    expect(note).toContain('- **11:13** 🔔 A prompt from a bot?');
    expect(note).toContain('\t- 💬 *An answer.*');
    expect(index.daybook(TODAY).map((e) => e.time)).toEqual(['11:13', '12:00']);
    expect(index.daybook(TODAY)[0]!.replies).toHaveLength(1);
  });
});
