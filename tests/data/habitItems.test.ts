import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';
import { api } from '../api/v2.test';
import { itemsNeeded, parseHabit, parseItemEntry, renderHabitNote, splitItemCount } from '../../src/core/habit';
import { habitItemStats, suggestedItem } from '../../src/data/habits';

/* eslint-disable @typescript-eslint/no-explicit-any */

const GUITAR = `---
title: Guitar
type: habit
id: hab-guitar
schedule: every day
active: true
grace_days: 0
icon: 🎸
items:
  - Wonderwall 🆔 hsi-wonder
  - Blackbird 🆔 hsi-black
items_retired:
  - Smoke on the Water 🆔 hsi-smoke
items_per_day: 1
---
# Guitar
`;
const PATH = '02 PROJECTS/Habits/Guitar.md';

describe('sub-habits: the note format', () => {
  it('parses items, retired items and the per-day rule; renders them back', () => {
    const h = parseHabit(PATH, GUITAR)!;
    expect(h.items).toEqual([{ id: 'hsi-wonder', title: 'Wonderwall' }, { id: 'hsi-black', title: 'Blackbird' }, { id: 'hsi-smoke', title: 'Smoke on the Water', retired: true }]);
    expect(h.itemsPerDay).toBe(1);
    expect(parseHabit(PATH, GUITAR.replace('items_per_day: 1', 'items_per_day: all'))!.itemsPerDay).toBe(0);
    expect(itemsNeeded(h)).toBe(1);
    expect(itemsNeeded({ ...h, itemsPerDay: 0 })).toBe(2); // retired ones do not count
    expect(itemsNeeded({ ...h, itemsPerDay: 5 })).toBe(2);
    expect(itemsNeeded({ items: [] })).toBe(Infinity);
    expect(parseItemEntry('Hand typed', false)!.id).toMatch(/^hsi-t/);
    expect(splitItemCount('Wonderwall ×3')).toEqual({ text: 'Wonderwall', count: 3 });
    expect(splitItemCount('Wonderwall x2')).toEqual({ text: 'Wonderwall', count: 2 });
    expect(splitItemCount('Wonderwall')).toEqual({ text: 'Wonderwall', count: 1 });
    const out = renderHabitNote({ id: 'hab-x', title: 'Piano', schedule: 'every day', items: [{ id: 'hsi-aaaaaa', title: 'Clair de lune' }], itemsPerDay: 2, today: TODAY });
    expect(parseHabit('x.md', out)!.items).toEqual([{ id: 'hsi-aaaaaa', title: 'Clair de lune' }]);
    expect(parseHabit('x.md', out)!.itemsPerDay).toBe(2);
  });
});

describe('sub-habits: ticking writes lines under the habit and follows the rule', () => {
  it('a song ticked writes an indented line, ticks Guitar, counts repetitions, and clearing it unticks Guitar again', async () => {
    const { m, vault, index } = await setup({ [PATH]: GUITAR });
    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'done');
    let note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/- \[x\] 🎸 Guitar 🆔 hab-guitar ✅ 2026-08-26\n\t- \[x\] Wonderwall 🆔 hsi-wonder ✅ 2026-08-26/);
    expect(index.snapshot.completions.find((c) => c.habitId === 'hab-guitar')!.state).toBe('done');
    expect(index.snapshot.itemCompletions).toHaveLength(1);
    // The daily task list does not get the song as a task of its own.
    expect([...index.snapshot.tasks.values()].some((t) => t.text.includes('Wonderwall'))).toBe(false);

    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'done', { count: 3 });
    await m.setHabitItemState('hab-guitar', 'hsi-black', TODAY, 'done');
    note = await vault.read(dailyPath(TODAY));
    expect(note).toContain('\t- [x] Wonderwall ×3 🆔 hsi-wonder');
    expect(note).toContain('\t- [x] Blackbird 🆔 hsi-black');
    // Ticking again without a count keeps the count.
    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'done');
    expect(await vault.read(dailyPath(TODAY))).toContain('Wonderwall ×3');

    const h = index.snapshot.habits.get('hab-guitar')!;
    const st = habitItemStats(h, index.snapshot.itemCompletions, TODAY);
    expect(st.find((s) => s.item.id === 'hsi-wonder')).toMatchObject({ todayCount: 3, count7: 3, total: 3, days30: 1, lastDone: TODAY, daysSince: 0, todayState: 'done' });

    await m.setHabitItemState('hab-guitar', 'hsi-black', TODAY, 'missed');
    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'missed');
    note = await vault.read(dailyPath(TODAY));
    expect(note).not.toContain('Wonderwall');
    expect(note).toMatch(/- \[ \] 🎸 Guitar 🆔 hab-guitar/);
    expect(index.snapshot.completions.find((c) => c.habitId === 'hab-guitar')!.state).toBe('missed');
  });

  it('with items_per_day: all, Guitar is done only once every active song is', async () => {
    const { m, index } = await setup({ [PATH]: GUITAR.replace('items_per_day: 1', 'items_per_day: all') });
    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'done');
    expect(index.snapshot.completions.find((c) => c.habitId === 'hab-guitar')!.state).toBe('missed');
    await m.setHabitItemState('hab-guitar', 'hsi-black', TODAY, 'done');
    expect(index.snapshot.completions.find((c) => c.habitId === 'hab-guitar')!.state).toBe('done');
  });

  it('a song ticked by hand in the note (no id, parent left open) still counts', async () => {
    const { m, vault, index } = await setup({ [PATH]: GUITAR });
    await m.syncHabitsForDay(TODAY);
    const note = await vault.read(dailyPath(TODAY));
    const edited = note.replace(/(- \[ \] 🎸 Guitar 🆔 hab-guitar)/, '$1\n\t- [x] blackbird x2');
    await vault.write(dailyPath(TODAY), edited);
    index.update(dailyPath(TODAY), edited);
    expect(index.snapshot.completions.find((c) => c.habitId === 'hab-guitar')!.state).toBe('done');
    const st = habitItemStats(index.snapshot.habits.get('hab-guitar')!, index.snapshot.itemCompletions, TODAY);
    expect(st.find((s) => s.item.id === 'hsi-black')!.todayCount).toBe(2);
    expect(suggestedItem(st)!.id).toBe('hsi-wonder');
  });

  it('add, rename, retire and remove items keep the frontmatter tidy', async () => {
    const { m, vault, index } = await setup({ [PATH]: GUITAR });
    const it1 = await m.addHabitItem('hab-guitar', 'Hotel California');
    expect(it1.id).toMatch(/^hsi-/);
    await expect(m.addHabitItem('hab-guitar', 'wonderwall')).rejects.toThrow(/already/);
    await m.setHabitItem('hab-guitar', 'hsi-black', { title: 'Blackbird (Beatles)', retired: true });
    await m.setHabitItem('hab-guitar', 'hsi-smoke', { retired: false });
    await m.removeHabitItem('hab-guitar', 'hsi-wonder');
    const h = index.snapshot.habits.get('hab-guitar')!;
    expect(h.items!.map((i) => `${i.title}${i.retired ? ' (r)' : ''}`)).toEqual(['Hotel California', 'Smoke on the Water', 'Blackbird (Beatles) (r)']);
    expect(await vault.read(PATH)).toContain(`  - Hotel California 🆔 ${it1.id}`);
  });

  it('a habit with parts gets the song under the named part', async () => {
    const { m, vault } = await setup({ [PATH]: GUITAR.replace('icon: 🎸', 'icon: 🎸\nparts: [morning, evening]') });
    await expect(m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'done')).rejects.toThrow(/part/);
    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'done', { part: 'evening' });
    const note = await vault.read(dailyPath(TODAY));
    const evening = note.split(/\n#+ Evening\n/)[1]!;
    expect(evening).toMatch(/- \[x\] 🎸 Guitar 🆔 hab-guitar ✅ 2026-08-26\n\t- \[x\] Wonderwall/);
    const morning = note.split(/\n#+ Morning\n/)[1]!.split(/\n#+ /)[0]!;
    expect(morning).toMatch(/- \[ \] 🎸 Guitar/);
  });
});

describe('sub-habits: the API', () => {
  it('habit and day JSON carry items, and the routes add, tick and remove them', async () => {
    const { call } = await api({ [PATH]: GUITAR });
    let r = await call('GET', 'habits/hab-guitar');
    expect(r.body.itemsPerDay).toBe(1);
    expect(r.body.items.map((i: any) => i.id)).toEqual(['hsi-wonder', 'hsi-black', 'hsi-smoke']);
    expect(r.body.suggestedItem).toBe('hsi-wonder');
    r = await call('POST', 'habits/hab-guitar/items', { title: 'Layla' });
    expect(r.status).toBe(201);
    const layla = r.body.item.id;
    r = await call('POST', 'habits/hab-guitar/state', { item: layla, state: 'done', count: 2 });
    expect(r.status).toBe(200);
    expect(r.body.occurrences[0]).toMatchObject({ part: null, state: 'done', items: [{ id: layla, title: 'Layla', state: 'done', count: 2 }] });
    r = await call('GET', `day/${TODAY}`);
    const row = r.body.habits.find((x: any) => x.id === 'hab-guitar');
    expect(row.items.map((i: any) => i.title)).toEqual(['Wonderwall', 'Blackbird', 'Layla']);
    expect(row.occurrences[0].items[0].count).toBe(2);
    expect((await call('POST', 'habits/hab-guitar/state', { item: 'hsi-nope', state: 'done' })).status).toBe(400);
    expect((await call('POST', 'habits/hab-guitar/state', { item: layla, state: 'done', count: 0 })).status).toBe(400);
    expect((await call('POST', 'habits/hab-guitar/state', { item: 'hsi-smoke', state: 'done' })).status).toBe(400);
    expect((await call('PATCH', 'habits/hab-guitar/items/hsi-black', { retired: true })).status).toBe(200);
    expect((await call('DELETE', 'habits/hab-guitar/items/hsi-wonder')).status).toBe(200);
    expect((await call('PATCH', 'habits/hab-guitar', { itemsPerDay: 'all' })).body.habit.itemsPerDay).toBe(0);
    expect((await call('PATCH', 'habits/hab-guitar', { itemsPerDay: -1 })).status).toBe(400);
    r = await call('POST', 'habits', { title: 'Piano', schedule: 'every day', items: ['Für Elise', 'Gymnopédie'], itemsPerDay: 1 });
    expect(r.status).toBe(201);
    expect(r.body.habit.items.map((i: any) => i.title)).toEqual(['Für Elise', 'Gymnopédie']);
  });
});
