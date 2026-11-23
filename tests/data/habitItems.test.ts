import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';
import { api } from '../api/v2.test';
import { cleanItemLink, formatItemEntry, itemsNeeded, parseHabit, parseItemEntry, renderHabitNote, splitItemCount } from '../../src/core/habit';
import { habitItemStats, habitsOnDay, habitStats, suggestedItem } from '../../src/data/habits';

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

describe('sub-habits: a once-a-day habit is logged by session', () => {
  it('songs go under the part of the day they are logged in; a second session gets its own line; the day counts once', async () => {
    const { m, vault, index } = await setup({ [PATH]: GUITAR });
    // The test clock says 14:37: the afternoon.
    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'done', { count: 3 });
    // Later, in the evening.
    await m.setHabitItemState('hab-guitar', 'hsi-black', TODAY, 'done', { part: 'evening' });
    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'done', { part: 'evening' });
    const note = await vault.read(dailyPath(TODAY));
    const section = (head: string): string => note.split(new RegExp(`\\n#+ ${head}\\n`))[1]!.split(/\n#+ /)[0]!;
    expect(section('Afternoon')).toMatch(/- \[x\] 🎸 Guitar 🆔 hab-guitar ✅ 2026-08-26\n\t- \[x\] Wonderwall ×3 🆔 hsi-wonder/);
    expect(section('Evening')).toMatch(/- \[x\] 🎸 Guitar 🆔 hab-guitar ✅ 2026-08-26\n\t- \[x\] Blackbird 🆔 hsi-black ✅ 2026-08-26\n\t- \[x\] Wonderwall 🆔 hsi-wonder/);
    expect(section('Evening')).not.toContain('×3'); // a session counts its own rounds
    const h = index.snapshot.habits.get('hab-guitar')!;
    const rows = habitsOnDay([h], index.snapshot.completions, TODAY);
    expect(rows[0]!.occurrences.map((o) => `${o.part}:${o.state}`)).toEqual(['afternoon:done', 'evening:done']);
    const st = habitStats(h, index.snapshot.completions, TODAY);
    expect(st.doneToday).toBe(true);
    expect(st.today).toEqual([{ state: 'done' }]); // still one occurrence a day for the streak
    expect(habitItemStats(h, index.snapshot.itemCompletions, TODAY).find((x) => x.item.id === 'hsi-wonder')!.todayCount).toBe(4);
    // Taking the evening songs off leaves the afternoon session alone, and the day still counts.
    await m.setHabitItemState('hab-guitar', 'hsi-black', TODAY, 'missed', { part: 'evening' });
    await m.setHabitItemState('hab-guitar', 'hsi-wonder', TODAY, 'missed', { part: 'evening' });
    const after = await vault.read(dailyPath(TODAY));
    expect(after).toContain('Wonderwall ×3');
    expect(after).not.toContain('Blackbird');
    expect(after.match(/🆔 hab-guitar/g)).toHaveLength(1); // the emptied evening session is gone
    expect(habitStats(index.snapshot.habits.get('hab-guitar')!, index.snapshot.completions, TODAY).doneToday).toBe(true);
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
    expect(r.body.occurrences[0]).toMatchObject({ part: 'afternoon', state: 'done', items: [{ id: layla, title: 'Layla', state: 'done', count: 2 }] });
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

describe('sub-habit groups and the day plan', () => {
  it('parses groups and a plan; an entry keeps its group through a rename', () => {
    const src = GUITAR.replace('  - Blackbird 🆔 hsi-black', '  - Blackbird 🆔 hsi-black 📂 C major').replace('items_per_day: 1', 'items_per_day: 1\nitem_groups: [G major]\nitems_plan_date: 2026-08-26\nitems_plan: [hsi-black, hsi-gone]');
    const h = parseHabit(PATH, src)!;
    expect(h.items![1]).toEqual({ id: 'hsi-black', title: 'Blackbird', group: 'C major' });
    expect(h.itemGroups).toEqual(['G major', 'C major']); // a group an item names joins the list
    expect(h.itemPlan).toEqual({ date: '2026-08-26', items: ['hsi-black'] }); // unknown ids dropped
    expect(parseItemEntry('Layla 📂 Blues', false)).toMatchObject({ title: 'Layla', group: 'Blues' });
  });

  it('API: groups, moving a song, and the plan', async () => {
    const { call } = await api({ [PATH]: GUITAR });
    let r = await call('POST', 'habits/hab-guitar/groups', { name: 'C major' });
    expect(r.status).toBe(201);
    expect(r.body.habit.itemGroups).toEqual(['C major']);
    expect((await call('POST', 'habits/hab-guitar/groups', { name: 'c major' })).status).toBe(400);
    r = await call('PATCH', 'habits/hab-guitar/items/hsi-black', { group: 'C major' });
    expect(r.body.habit.items.find((i: any) => i.id === 'hsi-black').group).toBe('C major');
    r = await call('PATCH', 'habits/hab-guitar/groups', { from: 'C major', to: 'C scale' });
    expect(r.body.habit.items.find((i: any) => i.id === 'hsi-black').group).toBe('C scale');
    r = await call('PUT', 'habits/hab-guitar/plan', { items: ['hsi-black', 'hsi-wonder'] });
    expect(r.body.planned).toEqual(['hsi-black', 'hsi-wonder']);
    expect((await call('PUT', 'habits/hab-guitar/plan', { items: ['hsi-smoke'] })).status).toBe(400); // retired
    r = await call('GET', `day/${TODAY}`);
    const row = r.body.habits.find((x: any) => x.id === 'hab-guitar');
    expect(row.planned).toEqual(['hsi-black', 'hsi-wonder']);
    expect(row.itemGroups).toEqual(['C scale']);
    expect(row.items.find((i: any) => i.id === 'hsi-black').group).toBe('C scale');
    r = await call('DELETE', 'habits/hab-guitar/groups', undefined, { name: 'C scale' });
    expect(r.body.habit.itemGroups).toEqual([]);
    expect(r.body.habit.items.find((i: any) => i.id === 'hsi-black').group).toBeNull();
    r = await call('PUT', 'habits/hab-guitar/plan', { items: [] });
    expect(r.body.planned).toEqual([]);
    r = await call('PUT', 'habits/hab-guitar/items', { order: ['hsi-black', 'hsi-wonder'] });
    expect(r.body.habit.items.map((i: any) => i.id)).toEqual(['hsi-black', 'hsi-wonder', 'hsi-smoke']);
    expect((await call('PUT', 'habits/hab-guitar/items', { order: ['hsi-nope'] })).status).toBe(400);
  });
});

describe('sub-habit links: the song or exercise it is about', () => {
  it('parses and writes a note link or a web address after the group', () => {
    expect(parseItemEntry('Ode to Joy 🆔 hsi-ode 📂 C major 🔗 [[Songs/Ode to Joy]]', false)).toEqual({ id: 'hsi-ode', title: 'Ode to Joy', group: 'C major', link: '[[Songs/Ode to Joy]]' });
    expect(parseItemEntry('Layla 🆔 hsi-layla 🔗 https://www.songsterr.com/a/wsa/layla', false)).toEqual({ id: 'hsi-layla', title: 'Layla', link: 'https://www.songsterr.com/a/wsa/layla' });
    expect(formatItemEntry({ id: 'hsi-ode', title: 'Ode to Joy', group: 'C major', link: 'Ode to Joy' })).toBe('Ode to Joy 🆔 hsi-ode 📂 C major 🔗 [[Ode to Joy]]');
    expect(cleanItemLink('Songs/Ode to Joy.md')).toBe('[[Songs/Ode to Joy]]');
    expect(cleanItemLink('  ')).toBe('');
    const h = parseHabit(PATH, GUITAR.replace('  - Blackbird 🆔 hsi-black', '  - "Blackbird 🆔 hsi-black 🔗 [[Blackbird tabs]]"'))!;
    expect(h.items![1]).toEqual({ id: 'hsi-black', title: 'Blackbird', link: '[[Blackbird tabs]]' });
  });

  it('a link is set, kept through a rename and a move, made as a new note, and taken off', async () => {
    const s = await setup({ [PATH]: GUITAR, 'Songs/Blackbird tabs.md': '# Blackbird tabs\n' });
    const note = (): Promise<string> => s.vault.read(PATH);
    await s.m.setHabitItem('hab-guitar', 'hsi-black', { link: 'Songs/Blackbird tabs' });
    expect(await note()).toContain('  - Blackbird 🆔 hsi-black 🔗 [[Songs/Blackbird tabs]]\n');
    await s.m.setHabitItem('hab-guitar', 'hsi-black', { title: 'Blackbird (Beatles)', group: 'G major' });
    expect(await note()).toContain('Blackbird (Beatles) 🆔 hsi-black 📂 G major 🔗 [[Songs/Blackbird tabs]]');
    const path = await s.m.createItemNote('hab-guitar', 'hsi-wonder');
    expect(path).toBe('Notes/Guitar/Wonderwall.md');
    expect(await s.vault.read(path)).toContain('habit: "[[Guitar]]"\nsub_habit: hsi-wonder');
    expect(await note()).toContain('Wonderwall 🆔 hsi-wonder 🔗 [[Notes/Guitar/Wonderwall]]');
    expect(await s.m.createItemNote('hab-guitar', 'hsi-wonder')).toBe('Notes/Guitar/Wonderwall 2.md'); // never over an existing note
    const drawing = await s.m.createItemNote('hab-guitar', 'hsi-black', { kind: 'drawing' });
    expect(drawing).toBe('Notes/Guitar/Blackbird (Beatles).excalidraw.md');
    expect(await s.vault.read(drawing)).toContain('excalidraw-plugin: parsed');
    expect(await s.vault.read(drawing)).toContain('sub_habit: hsi-black');
    expect(await note()).toContain('Blackbird (Beatles) 🆔 hsi-black 📂 G major 🔗 [[Notes/Guitar/Blackbird (Beatles).excalidraw]]');
    await s.m.setHabitItem('hab-guitar', 'hsi-black', { link: null });
    expect(await note()).toContain('Blackbird (Beatles) 🆔 hsi-black 📂 G major\n');
  });

  it('API: PATCH sets a link; habit and day JSON carry it with a URL to open', async () => {
    const { call } = await api({ [PATH]: GUITAR, 'Songs/Blackbird tabs.md': '# Blackbird tabs\n' });
    let r = await call('PATCH', 'habits/hab-guitar/items/hsi-black', { link: '[[Songs/Blackbird tabs]]' });
    let it = r.body.habit.items.find((i: any) => i.id === 'hsi-black');
    expect(it).toMatchObject({ link: '[[Songs/Blackbird tabs]]', linkPath: 'Songs/Blackbird tabs.md', linkUrl: 'obsidian://open?vault=Test%20vault&file=Songs%2FBlackbird%20tabs' });
    r = await call('PATCH', 'habits/hab-guitar/items/hsi-wonder', { link: 'https://youtu.be/6hzrDeceEKc' });
    it = r.body.habit.items.find((i: any) => i.id === 'hsi-wonder');
    expect(it).toMatchObject({ link: 'https://youtu.be/6hzrDeceEKc', linkUrl: 'https://youtu.be/6hzrDeceEKc', linkPath: null });
    r = await call('GET', `day/${TODAY}`);
    expect(r.body.habits.find((x: any) => x.id === 'hab-guitar').items.find((i: any) => i.id === 'hsi-wonder').linkUrl).toBe('https://youtu.be/6hzrDeceEKc');
    expect((await call('PATCH', 'habits/hab-guitar/items/hsi-wonder', { link: 3 })).status).toBe(400);
    r = await call('PATCH', 'habits/hab-guitar/items/hsi-wonder', { link: null });
    expect(r.body.habit.items.find((i: any) => i.id === 'hsi-wonder').link).toBeNull();
  });
});

describe('sub-habit links: what is typed', () => {
  it('a web address, a [[link]], or a note or drawing name', async () => {
    const { typedLink, itemLinkKind } = await import('../../src/ui/itemLink');
    expect(typedLink('youtu.be/6hzrDeceEKc')).toBe('https://youtu.be/6hzrDeceEKc');
    expect(typedLink('https://www.songsterr.com/a/x')).toBe('https://www.songsterr.com/a/x');
    expect(typedLink('[[Ode to Joy]]')).toBe('[[Ode to Joy]]');
    expect(typedLink('Ode To Joy - Guitar.excalidraw')).toBe('[[Ode To Joy - Guitar.excalidraw]]');
    expect(typedLink('Tabs.excalidraw')).toBe('[[Tabs.excalidraw]]');
    expect(typedLink('Songs/Blackbird.md')).toBe('[[Songs/Blackbird]]');
    expect(itemLinkKind('[[Ode To Joy - Guitar.excalidraw]]')).toBe('drawing');
    expect(itemLinkKind('[[Ode to Joy]]')).toBe('note');
    expect(itemLinkKind('https://youtu.be/x')).toBe('web');
  });
});
