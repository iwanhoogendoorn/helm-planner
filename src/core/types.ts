/**
 * Helm domain model. Pure types — nothing here imports Obsidian.
 *
 * Markdown is the source of truth. Everything in this file is a *reading* of
 * markdown lines; nothing is stored anywhere else.
 */

export type IsoDate = string; // YYYY-MM-DD

export type TaskStatus = 'todo' | 'doing' | 'done' | 'cancelled' | 'forwarded' | 'waiting';

export type Priority = 'highest' | 'high' | 'medium' | 'normal' | 'low' | 'lowest';

export type ProjectStatus = 'idea' | 'planned' | 'active' | 'on-hold' | 'done' | 'cancelled' | 'archived';
export type ProjectPriority = 'low' | 'normal' | 'medium' | 'high' | 'urgent' | 'critical';

export interface Recurrence {
  raw: string;
  parsed: boolean;
  frequency?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval?: number;
  weekdays?: number[]; // ISO 1..7
  monthDays?: number[];
  whenDone?: boolean;
}

export interface TimeBlock {
  start: string; // HH:MM
  end?: string;
}

export interface UnknownToken {
  raw: string;
  offset: number;
}

/** One parsed `- [ ]` line. */
export interface TaskLine {
  marker: string;
  status: TaskStatus;
  text: string; // human text incl. inline #tags, without metadata
  tags: string[];
  id?: string;
  priority: Priority;
  created?: IsoDate;
  start?: IsoDate;
  scheduled?: IsoDate;
  due?: IsoDate;
  done?: IsoDate;
  cancelled?: IsoDate;
  recurrence?: Recurrence;
  blockedBy: string[];
  effortMinutes?: number;
  effortRaw?: string;
  /** `🔗 [[Project]]` — this line mirrors a project task. */
  mirrorLink?: string;
  time?: TimeBlock;
  unknown: UnknownToken[];
  raw: { indent: string; bullet: string; eol: string; line: string };
}

export type TaskOrigin = 'project' | 'daily' | 'daily-mirror' | 'inbox' | 'note' | 'goal';

export interface Task extends TaskLine {
  /** Stable key: the `🆔` when present, else derived from path+line+text. */
  key: string;
  path: string;
  line: number; // 0-based
  depth: number;
  parentKey?: string;
  childKeys: string[];
  origin: TaskOrigin;
  projectId?: string;
  projectTitle?: string;
  phaseId?: string;
  phaseTitle?: string;
  /** For daily-note lines: the note's date. */
  noteDate?: IsoDate;
  /** For daily-note lines: which Helm section the line sits in. */
  section?: 'habits' | 'morning' | 'afternoon' | 'evening' | 'anytime' | 'outside';
  /** For lines on a day: the part of the day (by section, else by time block). */
  part?: 'morning' | 'afternoon' | 'evening' | 'anytime';
  /** For a mirror line: the key of the source task if resolved. */
  mirrorOf?: string;
  /** For a goal line: the period key of the periodic note it lives in. */
  periodKey?: string;
}

/** A goal is a checkbox line under the Goals heading of a yearly, quarterly or monthly note. */
export interface Goal {
  id: string; // 🆔 gol-… or the task's derived key
  key: string; // task key in the snapshot
  text: string;
  periodKey: string;
  status: TaskStatus;
  path: string;
  line: number;
  projectIds: string[];
}

export interface Phase {
  id: string; // `${projectId}#${slug}`
  projectId: string;
  title: string;
  slug: string;
  order: number;
  due?: IsoDate;
  headingLine: number;
  startLine: number; // first body line
  endLine: number; // exclusive
  taskKeys: string[];
}

export interface Project {
  id: string;
  title: string;
  path: string;
  folder: string;
  status: ProjectStatus;
  priority: ProjectPriority;
  area?: string;
  start?: IsoDate;
  due?: IsoDate;
  parentRef?: string;
  parentId?: string;
  childIds: string[];
  /** Horizon this project is bound to: 2026 · 2026-Q3 · 2026-08. */
  period?: string;
  /** Goal this project serves: a goal id, or its text / [[link]] as written. */
  goalRef?: string;
  goalId?: string;
  /** True when the note is `<Folder>/<Folder>.md` — only those can be umbrellas. */
  folderNote: boolean;
  tags: string[];
  /** Addresses listed under `## Links` in the project note. */
  links: { url: string; label: string }[];
  phases: Phase[];
  looseTaskKeys: string[];
  /** Line index of the `## Tasks` heading if present. */
  tasksHeadingLine?: number;
  frontmatterEndLine: number; // exclusive; 0 when absent
  mtime?: number;
}

export interface Habit {
  id: string;
  title: string;
  path: string;
  schedule: Recurrence;
  active: boolean;
  targetPerWeek?: number;
  graceDays: number;
  /** Emoji shown before the habit name. */
  icon?: string;
  /** Vault path of an image icon (e.g. a 256×256 PNG). */
  iconImage?: string;
  /** Parts of the day the habit is done in; empty = once a day, tracked in the Habits section. */
  parts?: HabitPart[];
  /** Accent colour (one of HABIT_COLORS); unset → picked from the habit id. */
  color?: HabitColor;
  /** The day the habit started; earlier days are not counted as missed. */
  created?: IsoDate;
  /** Earlier definitions, oldest first: the schedule (and parts) in force up to and including `until`. */
  history?: { until: IsoDate; schedule: Recurrence; parts?: HabitPart[] }[];
  /** Spans the habit was paused; an open span (no `to`) is the current pause. Days inside are not due. */
  pauses?: { from: IsoDate; to?: IsoDate }[];
  /** No habit note any more — reconstructed from the ticks left in daily notes. */
  removed?: boolean;
}

export type HabitColor = 'red' | 'orange' | 'yellow' | 'green' | 'cyan' | 'blue' | 'purple' | 'pink';
export const HABIT_COLORS: HabitColor[] = ['green', 'blue', 'purple', 'orange', 'cyan', 'pink', 'yellow', 'red'];
/** Obsidian's default accent values, for themes that do not define --color-*. */
export const HABIT_COLOR_HEX: Record<HabitColor, string> = { green: '#08b94e', blue: '#086ddd', purple: '#7852ee', orange: '#ec7500', cyan: '#00bfbc', pink: '#d53984', yellow: '#e0ac00', red: '#e93147' };

export type HabitPart = 'morning' | 'afternoon' | 'evening';
export const HABIT_PARTS: HabitPart[] = ['morning', 'afternoon', 'evening'];

export interface HabitCompletion {
  habitId: string;
  date: IsoDate;
  path: string;
  line: number;
  state: 'done' | 'skipped' | 'missed';
  /** Which occurrence of the day this line is; undefined = the day-level line in the Habits section. */
  part?: HabitPart;
  /** The line's text (icon and title as written that day) — the only trace of a habit whose note is gone. */
  text?: string;
}

export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  code: string;
  message: string;
  path: string;
  line?: number;
}

export interface DailyNoteInfo {
  path: string;
  date: IsoDate;
  hasRegion: boolean;
  regionBroken: boolean;
}

/** The whole parsed vault, rebuilt from markdown at any time. */
/** What a drawing can be attached to. */
export type DrawingTarget =
  | { kind: 'task'; key: string; id?: string; title: string }
  | { kind: 'project'; id: string; title: string }
  | { kind: 'date'; date: IsoDate; title: string }
  | { kind: 'period'; key: string; title: string }
  | { kind: 'habit'; id: string; title: string };

export interface Snapshot {
  builtAt: number;
  tasks: Map<string, Task>;
  projects: Map<string, Project>;
  habits: Map<string, Habit>;
  goals: Map<string, Goal>;
  completions: HabitCompletion[];
  dailyNotes: Map<IsoDate, DailyNoteInfo>;
  diagnostics: Diagnostic[];
  /** path -> keys of tasks in that file, in line order. */
  tasksByPath: Map<string, string[]>;
  /** Excalidraw / canvas drawings by path. */
  drawings: Map<string, import('./drawing').Drawing>;
  /** Notes attached to tasks / projects / days / periods, by path. */
  notes: Map<string, import('./noteRef').NoteRef>;
}

export interface HelmSettings {
  projectsFolder: string;
  habitsFolder: string;
  inboxNote: string;
  dailyNoteFolder: string; // empty → read Obsidian's daily-notes config
  dailyNoteFormat: string; // empty → read Obsidian's daily-notes config
  dailyNoteTemplate: string;
  regionPlacement: 'before-first-heading' | 'after-anchor' | 'end';
  regionAnchor: string;
  /** The heading whose section holds the day plan. */
  planHeading: string;
  /** Parts of the day: HH:MM boundaries. */
  /** The day's working window, used for part start times and free-slot suggestions. */
  dayStarts: string;
  dayEnds: string;
  morningEnds: string;
  afternoonEnds: string;
  /** Stamp ➕ created on tasks Helm creates. */
  writeCreatedDate: boolean;
  /** Capture for today starts at the current hour by default. */
  defaultCaptureTime: boolean;
  /** Move a daily task dated later than its note (a spawned recurrence) into that day's note automatically. */
  autoMoveRecurring: boolean;
  /** Weekly notes (Periodic Notes overrides). */
  weeklyFolder: string;
  weeklyFormat: string;
  /** Template notes for periodic notes; empty → Periodic Notes' template, else Helm's built-in one. */
  yearlyTemplate: string;
  quarterlyTemplate: string;
  monthlyTemplate: string;
  weeklyTemplate: string;
  /** Create this week's / month's / quarter's / year's notes when Helm starts. */
  autoCreatePeriodicNotes: boolean;
  /** Drawings: where new ones go (empty → the Excalidraw plugin's folder), template, linking, AI. */
  drawingsFolder: string;
  drawingTemplate: string;
  projectDrawingsInProjectFolder: boolean;
  embedDrawings: boolean;
  /** Tag put on follow-up tasks (without #). */
  /** Local HTTP API for other tools on this machine. Off unless you switch it on. */
  apiEnabled: boolean;
  apiPort: number;
  apiToken: string;
  followupTag: string;
  /** Tags offered as one-click toggles in Capture, comma separated, without the #. */
  captureTags: string;
  /** Notes: where new ones go, and whether links are written into the target's note. */
  notesFolder: string;
  projectNotesInProjectFolder: boolean;
  linkNotes: boolean;
  extraFolders: string[];
  /** Path prefixes never indexed (archives). */
  excludePaths: string[];
  /** Where "Archive project" moves a project folder. */
  archiveFolder: string;
  /** Periodic-note overrides; empty → follow the Periodic Notes plugin. */
  yearlyFolder: string;
  yearlyFormat: string;
  quarterlyFolder: string;
  quarterlyFormat: string;
  monthlyFolder: string;
  monthlyFormat: string;
  /** Heading under which goals live in a periodic note. */
  goalsHeading: string;
  dailyCapacityMinutes: number;
  defaultEffortMinutes: number;
  rolloverTarget: 'tomorrow' | 'unschedule';
  staleProjectDays: number;
  weekStartsOn: 1 | 7;
  defaultTab: 'today' | 'week' | 'projects' | 'inbox' | 'review' | 'horizons' | 'dashboard';
  openOnStartup: boolean;
  showTimeBlocks: boolean;
  indentUnit: string;
  developerActions: boolean;
}

export const DEFAULT_SETTINGS: HelmSettings = {
  projectsFolder: '02 PROJECTS',
  habitsFolder: '02 PROJECTS/Habits',
  inboxNote: '01 INBOX/Inbox.md',
  dailyNoteFolder: '',
  dailyNoteFormat: '',
  dailyNoteTemplate: '',
  regionPlacement: 'before-first-heading',
  regionAnchor: '## Helm',
  planHeading: '## Plan',
  dayStarts: '08:00',
  dayEnds: '22:00',
  morningEnds: '12:00',
  afternoonEnds: '18:00',
  writeCreatedDate: false,
  defaultCaptureTime: true,
  autoMoveRecurring: true,
  weeklyFolder: '',
  weeklyFormat: '',
  yearlyTemplate: '',
  quarterlyTemplate: '',
  monthlyTemplate: '',
  weeklyTemplate: '',
  autoCreatePeriodicNotes: true,
  drawingsFolder: '',
  drawingTemplate: '',
  projectDrawingsInProjectFolder: true,
  embedDrawings: true,
  apiEnabled: false,
  apiPort: 27125,
  apiToken: '',
  followupTag: 'followup',
  captureTags: 'meeting, followup, task',
  notesFolder: 'Notes',
  projectNotesInProjectFolder: true,
  linkNotes: true,
  extraFolders: [],
  excludePaths: ['02 PROJECTS/ZZZ. Project Archive', '02 PROJECTS/999. ARCHIVED TASKS.md', '90 ARCHIVE'],
  archiveFolder: '02 PROJECTS/ZZZ. Project Archive',
  yearlyFolder: '',
  yearlyFormat: '',
  quarterlyFolder: '',
  quarterlyFormat: '',
  monthlyFolder: '',
  monthlyFormat: '',
  goalsHeading: '## Goals',
  dailyCapacityMinutes: 360,
  defaultEffortMinutes: 30,
  rolloverTarget: 'tomorrow',
  staleProjectDays: 14,
  weekStartsOn: 1,
  defaultTab: 'today',
  openOnStartup: false,
  showTimeBlocks: true,
  indentUnit: '\t',
  developerActions: false,
};
