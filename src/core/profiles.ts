/**
 * Project profiles: the same machinery, a different vocabulary.
 *
 * A generic project is a list of phases with tasks in them, which is right for most work and wrong for
 * work that has a shape of its own. A month of music is not “phase 3”: it is September, and inside it a
 * song, and inside that who is doing what to it — Zaara singing, me on piano with chords, the two of us
 * together. A book is parts and chapters. A certification is topics and practice tests.
 *
 * Rather than invent a store for each of those, a profile is a **lens with a vocabulary**. Underneath it
 * is still a Helm project: a phase per group (the month, the part, the topic), a task per item (the song,
 * the chapter), and a subtask per assignment (`Zaara · Singing`). Nothing new is written into your notes
 * that Obsidian Tasks or a human reader would not understand, so every other part of Helm — scheduling,
 * rollups, the daily note, the PDF export — keeps working on the same lines.
 */
export interface ProjectProfile {
  id: string;
  label: string;
  icon: string;
  /** One line in the project form, so it is obvious which to pick. */
  hint: string;
  /** What a phase is called here: “month”, “part”, “topic”. */
  groupNoun: string;
  /** How groups are made: a month picker, or free text. */
  groupBy: 'month' | 'free';
  /** What a task is called here: “song”, “chapter”, “topic”. */
  itemNoun: string;
  /** Whether an item points at a note of its own (lyrics, chapter draft, a customer's request). */
  linksNote: boolean;
  /** Who can be assigned. Empty means the work is not split between people. */
  people: string[];
  /** The ways an item can be worked on — the columns of the board and the chips on a card. */
  modes: string[];
  /** Short forms for the modes, in order — what a chip says when there is no room for the words. */
  short: string[];
}

export const GENERIC_PROFILE: ProjectProfile = {
  id: 'generic', label: 'Plain project', icon: 'folder', hint: 'Phases and tasks — the usual thing.',
  groupNoun: 'phase', groupBy: 'free', itemNoun: 'task', linksNote: false, people: [], modes: [], short: [],
};

export const BUILT_IN_PROFILES: ProjectProfile[] = [
  GENERIC_PROFILE,
  {
    id: 'music', label: 'Music', icon: 'music', hint: 'Songs by month, and who plays or sings what.',
    groupNoun: 'month', groupBy: 'month', itemNoun: 'song', linksNote: true,
    people: ['Iwan', 'Zaara'],
    modes: ['Piano with chords', 'Piano', 'Singing', 'Piano with singing'],
    short: ['P CH', 'P', 'Z', 'PZ'],
  },
  {
    id: 'writing', label: 'Writing', icon: 'pen-line', hint: 'Chapters or articles, and how far each draft has got.',
    groupNoun: 'part', groupBy: 'free', itemNoun: 'chapter', linksNote: true,
    people: [],
    modes: ['Outline', 'Draft', 'Revise', 'Review', 'Final'],
    short: ['Out', 'Dft', 'Rev', 'Rvw', 'Fin'],
  },
  {
    id: 'exam', label: 'Exam or certification', icon: 'graduation-cap', hint: 'Topics, and how each one was studied.',
    groupNoun: 'topic', groupBy: 'free', itemNoun: 'subject', linksNote: true,
    people: [],
    modes: ['Read', 'Notes', 'Lab', 'Practice test', 'Reviewed'],
    short: ['Read', 'Notes', 'Lab', 'Test', 'OK'],
  },
  {
    id: 'client', label: 'Customer request', icon: 'briefcase', hint: 'One request at a time, through the steps you always take.',
    groupNoun: 'customer', groupBy: 'free', itemNoun: 'request', linksNote: true,
    people: [],
    modes: ['Define', 'Build', 'Test', 'Communicate', 'Handover'],
    short: ['Def', 'Build', 'Test', 'Comm', 'Done'],
  },
];

export const profileById = (id: string | undefined): ProjectProfile =>
  BUILT_IN_PROFILES.find((p) => p.id === id) ?? GENERIC_PROFILE;

/**
 * A profile as a project actually uses it: the built-in vocabulary, with whatever that project overrides
 * in its own frontmatter. Renaming a mode or adding a person is editing a note, not editing Helm.
 */
export function profileFor(profileId: string | undefined, overrides: { people?: string[]; modes?: string[] } = {}): ProjectProfile {
  const base = profileById(profileId);
  const modes = overrides.modes && overrides.modes.length > 0 ? overrides.modes : base.modes;
  const short = modes === base.modes ? base.short : modes.map(shortOf);
  return {
    ...base,
    ...(overrides.people && overrides.people.length > 0 ? { people: overrides.people } : {}),
    modes,
    short,
  };
}

/** A short form for a mode nobody gave one for: initials of the words that carry meaning. */
export function shortOf(mode: string): string {
  const words = mode.split(/\s+/).filter((w) => w.length > 0 && !/^(with|and|of|the|a|an|only)$/i.test(w));
  if (words.length === 0) return mode.slice(0, 3);
  if (words.length === 1) return words[0]!.slice(0, 4);
  return words.map((w) => w.slice(0, 1).toUpperCase()).join('');
}

/** One person doing one thing to one item: `Zaara · Singing`, written as an ordinary subtask. */
export interface Assignment {
  person?: string;
  mode: string;
}

export const ASSIGNMENT_SEPARATOR = ' · ';

export const assignmentLine = (a: Assignment): string =>
  (a.person ? `${a.person}${ASSIGNMENT_SEPARATOR}${a.mode}` : a.mode);

/**
 * Read a subtask back as an assignment. Anything that does not name a mode this profile knows is left
 * alone — a step you wrote by hand is still a step, not a broken assignment.
 */
export function parseAssignment(text: string, profile: ProjectProfile): Assignment | undefined {
  const raw = text.trim();
  const at = raw.indexOf(ASSIGNMENT_SEPARATOR);
  const person = at > 0 ? raw.slice(0, at).trim() : undefined;
  const mode = at > 0 ? raw.slice(at + ASSIGNMENT_SEPARATOR.length).trim() : raw;
  const known = profile.modes.find((m) => m.toLowerCase() === mode.toLowerCase());
  if (!known) return undefined;
  if (person && profile.people.length > 0 && !profile.people.some((p) => p.toLowerCase() === person.toLowerCase())) {
    // A name Helm does not know is still a name: the person is kept as written.
    return { person, mode: known };
  }
  return { ...(person ? { person } : {}), mode: known };
}
