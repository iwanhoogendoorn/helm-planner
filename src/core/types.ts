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

export type TaskOrigin = 'project' | 'daily' | 'daily-mirror' | 'inbox' | 'note';

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
  section?: 'habits' | 'today' | 'projects' | 'outside';
  /** For a mirror line: the key of the source task if resolved. */
  mirrorOf?: string;
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
  icon?: string;
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
  extraFolders: string[];
  dailyCapacityMinutes: number;
  defaultEffortMinutes: number;
  rolloverTarget: 'tomorrow' | 'unschedule';
  staleProjectDays: number;
  weekStartsOn: 1 | 7;
  defaultTab: 'today' | 'week' | 'projects' | 'inbox' | 'review';
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
  extraFolders: [],
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
