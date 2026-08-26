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
}

export interface HabitCompletion {
  habitId: string;
  date: IsoDate;
  path: string;
  line: number;
  state: 'done' | 'skipped' | 'missed';
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
