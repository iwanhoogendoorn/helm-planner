import { describe, expect, it } from 'vitest';
import { setup, TODAY } from './fixture';

/**
 * A weekly lesson, ticked off last week, with this week's turn still open — the shape that made a
 * deleted occurrence impossible to get rid of: the catch-up handed it straight back.
 */
async function weeklyLesson() {
  const s = await setup();
  await s.m.addTask({ text: 'Piano lesson', date: '2026-08-19', fields: { recurrence: { raw: 'every week', parsed: true, frequency: 'weekly', interval: 1 } } });
  const last = [...s.index.snapshot.tasks.values()].find((t) => t.text === 'Piano lesson' && t.noteDate === '2026-08-19')!;
  await s.m.setStatus(last.key, 'done');
  await s.m.catchUpRecurring(); // the turn on the 26th appears
  const open = [...s.index.snapshot.tasks.values()].find((t) => t.text === 'Piano lesson' && (t.noteDate ?? t.scheduled) === TODAY)!;
  return { ...s, open };
}

const lessonsOn = (s: Awaited<ReturnType<typeof weeklyLesson>>, date: string): number =>
  [...s.index.snapshot.tasks.values()].filter((t) => t.text === 'Piano lesson' && (t.noteDate ?? t.scheduled) === date).length;

describe('deleting a turn of a repeating task', () => {
  it('used to come straight back: a plain delete is undone by the catch-up', async () => {
    const s = await weeklyLesson();
    expect(lessonsOn(s, TODAY)).toBe(1);
    await s.m.deleteTask(s.open.key);
    expect(lessonsOn(s, TODAY)).toBe(0);
    await s.m.catchUpRecurring();
    expect(lessonsOn(s, TODAY)).toBe(1); // the behaviour the choice exists to tame
  });

  it('“just this one” remembers the day, so the catch-up leaves it alone — and the next turn still comes', async () => {
    const s = await weeklyLesson();
    const r = await s.m.deleteOccurrence(s.open.key, 'once');
    expect(r).toEqual({ stopped: 0, skipped: TODAY });
    expect(s.settings.skippedOccurrences).toEqual([{ text: 'Piano lesson', date: TODAY }]);

    await s.m.catchUpRecurring();
    expect(lessonsOn(s, TODAY)).toBe(0); // stays gone, however often the reconcile runs
    await s.m.catchUpRecurring();
    expect(lessonsOn(s, TODAY)).toBe(0);

    // The series itself is untouched: tick a later turn and the one after it appears as always.
    await s.m.addTask({ text: 'Piano lesson', date: '2026-09-02', fields: { recurrence: { raw: 'every week', parsed: true, frequency: 'weekly', interval: 1 } } });
    const sep2 = [...s.index.snapshot.tasks.values()].find((t) => t.text === 'Piano lesson' && t.noteDate === '2026-09-02')!;
    await s.m.setStatus(sep2.key, 'done');
    await s.m.catchUpRecurring();
    expect(lessonsOn(s, '2026-09-09')).toBe(1);
  });

  it('“stop repeating” takes the repeat off what would spawn another turn, and leaves history alone', async () => {
    const s = await weeklyLesson();
    const r = await s.m.deleteOccurrence(s.open.key, 'series');
    expect(r.stopped).toBe(1); // the finished 19 Aug line

    const past = [...s.index.snapshot.tasks.values()].find((t) => t.text === 'Piano lesson' && t.noteDate === '2026-08-19')!;
    expect(past.status).toBe('done'); // still on the record …
    expect(past.recurrence).toBeUndefined(); // … but it no longer spawns anything
    const pastNote = await s.vault.read(past.path);
    expect(pastNote).toMatch(/- \[x\] Piano lesson[^\n]*✅/);
    expect(pastNote).not.toContain('🔁');

    await s.m.catchUpRecurring();
    expect(lessonsOn(s, TODAY)).toBe(0);
    expect(s.settings.skippedOccurrences).toEqual([]); // no skip needed: nothing wants to come back
  });

  it('keeps the skip list small and lets a skip be taken back', async () => {
    const s = await weeklyLesson();
    s.settings.skippedOccurrences = [{ text: 'Old thing', date: '2020-01-01' }];
    await s.m.deleteOccurrence(s.open.key, 'once');
    expect(s.settings.skippedOccurrences).toEqual([{ text: 'Piano lesson', date: TODAY }]); // the ancient one aged out

    await s.m.unskipOccurrence('Piano lesson', TODAY);
    expect(s.settings.skippedOccurrences).toEqual([]);
    await s.m.catchUpRecurring();
    expect(lessonsOn(s, TODAY)).toBe(1); // and it comes back, as asked
  });

  it('a skip only covers that one day and that one line', async () => {
    const s = await weeklyLesson();
    await s.m.deleteOccurrence(s.open.key, 'once');
    // A different repeating line on the same day is not affected.
    await s.m.addTask({ text: 'Swim', date: '2026-08-19', fields: { recurrence: { raw: 'every week', parsed: true, frequency: 'weekly', interval: 1 } } });
    const swim = [...s.index.snapshot.tasks.values()].find((t) => t.text === 'Swim' && t.noteDate === '2026-08-19')!;
    await s.m.setStatus(swim.key, 'done');
    await s.m.catchUpRecurring();
    expect([...s.index.snapshot.tasks.values()].filter((t) => t.text === 'Swim' && (t.noteDate ?? t.scheduled) === TODAY)).toHaveLength(1);
    expect(lessonsOn(s, TODAY)).toBe(0);
  });
});
