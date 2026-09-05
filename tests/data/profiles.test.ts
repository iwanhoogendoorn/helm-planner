import { describe, expect, it } from 'vitest';
import { setup } from './fixture';
import { describePart, describeWork, parseAssignment, profileFor, shortOf, shortsFor } from '../../src/core/profiles';

describe('project profiles', () => {
  it('knows the built-in vocabularies, and lets a project override them', () => {
    const music = profileFor('music');
    expect(music.itemNoun).toBe('song');
    expect(music.groupNoun).toBe('month');
    // Three things you can do to a song, and piano is two of them: the whole piece, or the chords.
    expect(music.modes).toEqual(['Piano solo', 'Piano chords', 'Singing', 'Producing']);
    expect(music.short).toEqual(['Piano', 'Chords', 'Sing', 'Prod']);

    // A project that names its own people and ways of working gets those, with short forms worked out.
    const ours = profileFor('music', { people: ['Iwan', 'Zaara', 'Seralda'], modes: ['Singing', 'Producing'] });
    expect(ours.people).toEqual(['Iwan', 'Zaara', 'Seralda']);
    expect(ours.modes).toEqual(['Singing', 'Producing']);
    expect(ours.short).toEqual(['Singing', 'Produci']);      // words, not initials
    expect(profileFor(undefined).id).toBe('generic');
    expect(profileFor('nonsense').id).toBe('generic');
    // Two modes starting on the same word borrow the next one to tell themselves apart.
    expect(shortsFor(['Piano solo', 'Piano chords', 'Singing'])).toEqual(['Solo', 'Chords', 'Singing']);
    expect(shortOf('Piano with singing')).toBe('Piano');
  });

  it('reads an assignment back off a subtask, and leaves anything else alone', () => {
    const music = profileFor('music', { people: ['Iwan', 'Zaara'] });
    expect(parseAssignment('Zaara · Singing', music)).toEqual({ person: 'Zaara', mode: 'Singing' });
    expect(parseAssignment('Iwan · Piano chords', music)).toEqual({ person: 'Iwan', mode: 'Piano chords' });
    expect(parseAssignment('Piano solo', music)).toEqual({ mode: 'Piano solo' });   // nobody named: the work itself
    expect(parseAssignment('Seralda · Singing', music)?.person).toBe('Seralda'); // a guest is still a person
    expect(parseAssignment('Buy new strings', music)).toBeUndefined();           // an ordinary step stays one
    expect(parseAssignment('Zaara · Trumpet', music)).toBeUndefined();
  });
});

describe('adding an item to a profiled project', () => {
  it('makes the month, links the song, and writes a subtask for each person and way', async () => {
    const { index, m, vault } = await setup();
    const song = await m.addProfileItem('prj-book', {
      title: 'Dit is het leven - Luna',
      group: 'September 2026',
      note: 'Dit is het leven - Luna',
      assignments: [{ person: 'Zaara', mode: 'Singing' }, { person: 'Iwan', mode: 'Piano chords' }],
    });
    const p = index.project('prj-book')!;
    const phase = p.phases.find((ph) => ph.title === 'September 2026');
    expect(phase).toBeDefined();                                        // the month was created
    expect(phase!.taskKeys).toContain(song.key);                        // and the song sits inside it

    const note = await vault.read(p.path);
    expect(note).toContain('## Phase: September 2026');
    expect(note).toContain('- [ ] [[Dit is het leven - Luna]]');        // the song opens as its own note
    expect(note).toContain('Zaara · Singing');
    expect(note).toContain('Iwan · Piano chords');

    const kids = index.task(song.key)!.childKeys.map((k) => index.task(k)!);
    expect(kids.map((k) => k.text)).toEqual(['Zaara · Singing', 'Iwan · Piano chords']);
    expect(song.id).toBeDefined();                                      // stamped, so each step finds its song
    // Four hands on one song: every assignment lands, not just the first.
    const busy = await m.addProfileItem('prj-book', {
      title: 'Still - Karol G & Bruno Mars', group: 'September 2026',
      assignments: [{ person: 'Iwan', mode: 'Piano chords' }, { person: 'Iwan', mode: 'Piano solo' }, { person: 'Iwan', mode: 'Singing' }, { person: 'Iwan', mode: 'Producing' }],
    });
    expect(index.task(busy.key)!.childKeys).toHaveLength(4);

    // Adding a second song to the same month reuses it rather than making another heading.
    await m.addProfileItem('prj-book', { title: 'Schoonzoon - Luna', group: 'September 2026', assignments: [{ person: 'Zaara', mode: 'Singing' }] });
    expect(index.project('prj-book')!.phases.filter((ph) => ph.title === 'September 2026')).toHaveLength(1);
  });
});

describe('saying what the work is, in words', () => {
  const music = profileFor('music');

  it('turns a set of assignments into a sentence anyone can read', () => {
    expect(describeWork([{ person: 'Zaara', mode: 'Singing' }, { person: 'Iwan', mode: 'Piano chords' }], music))
      .toBe('Zaara sings, Iwan plays the chords');
    // One person doing two things is one clause, not two.
    expect(describeWork([{ person: 'Iwan', mode: 'Piano chords' }, { person: 'Iwan', mode: 'Singing' }], music))
      .toBe('Iwan plays the chords and sings');
    expect(describeWork([{ person: 'Zaara', mode: 'Piano solo' }], music)).toBe('Zaara plays it on piano');
    expect(describeWork([{ person: 'Iwan', mode: 'Producing' }], music)).toBe('Iwan produces it');
    expect(describeWork([], music)).toBe('');
  });

  it('says it without names when the work has nobody to name', () => {
    const writing = profileFor('writing');
    expect(describeWork([{ mode: 'Draft' }, { mode: 'Review' }], writing)).toBe('drafts it and reviews it');
    expect(describePart(['Read', 'Lab'])).toBe('reads it and does the lab');
    // A mode Helm has no verb for still reads as English rather than as a code.
    expect(describePart(['Mixing'])).toBe('does the mixing');
  });
});

describe('a profiled note explains its own shape', () => {
  it('tells a reader how the headings and indents are meant to be read', async () => {
    const { m, vault } = await setup();
    const p = await m.createProject({ title: 'Songs', status: 'active', priority: 'normal', profile: 'music', people: ['Iwan', 'Zaara'] });
    const note = await vault.read(p.path);
    expect(note).toContain('## How this works');
    expect(note).toContain('Each **month** is a `## Phase:` heading');
    expect(note).toContain('one line per **song**');
    expect(note).toContain('one sings while the other plays');
    // A plain project says nothing extra.
    const plain = await m.createProject({ title: 'Shed', status: 'active', priority: 'normal' });
    expect(await vault.read(plain.path)).not.toContain('## How this works');
  });
});
