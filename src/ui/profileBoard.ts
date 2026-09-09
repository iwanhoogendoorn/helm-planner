/**
 * A profiled project, seen the way that kind of work is actually thought about.
 *
 * For music: one month at a time, and inside it every song with who is doing what to it — Zaara singing,
 * me on piano with chords, the two of us together. The point is the glance: what is she doing this month,
 * what am I doing, and how far has each of us got. A chip is a real subtask, so ticking one here is the
 * same as ticking it anywhere else in Helm.
 */
import type { Phase, Project, Task } from '../core/types';
import type { ProjectProfile } from '../core/profiles';
import { describeWork, parseAssignment } from '../core/profiles';
import { isOpen } from '../data/planner';
import { plainLabel } from '../core/label';
import { monthPeriod, parsePeriod } from '../core/periods';
import type { NoteRef } from '../core/noteRef';
import { button, chip, h, icon, iconButton, progressBar } from './dom';
import type { UiContext } from './context';
import { openProfileItem } from './modals/profileItem';
import { taskMenu } from './menus';
import { openTaskEditor } from './modals/taskEditor';
import { taskList } from './taskRow';

export interface ProfileBoardState {
  /** The group being looked at; empty means the first one. */
  group?: string;
}

/** One way of working on an item: a subtask (line items) or a phase (sub-project items). */
export interface Work { task?: Task; phase?: Phase; person?: string; mode: string; steps: Task[] }
interface Item {
  /** A line on the board … */
  task?: Task;
  /** … or a project of its own under it. */
  project?: Project;
  title: string;
  /** The note this item points at, when it points at one. */
  link?: string;
  work: Work[];
  /** Steps that are not assignments — an ordinary subtask someone wrote. */
  other: Task[];
  done: number;
}

/** Status of a piece of work: the subtask's, or what a phase's steps add up to. */
export function workStatus(w: Work): 'done' | 'doing' | 'todo' | 'off' {
  if (w.task) return w.task.status === 'done' ? 'done' : w.task.status === 'doing' ? 'doing' : isOpen(w.task) ? 'todo' : 'off';
  if (!w.steps.length) return 'todo';
  if (w.steps.every((s) => s.status === 'done')) return 'done';
  if (w.steps.some((s) => s.status === 'doing' || s.status === 'done')) return 'doing';
  return 'todo';
}

/** Read one group's items: the tasks in a phase, each with its assignments. */
export function itemsOf(ctx: UiContext, p: Project, profile: ProjectProfile, group: string): Item[] {
  const snap = ctx.index.snapshot;
  const phase = p.phases.find((ph) => ph.title === group);
  const keys = phase ? phase.taskKeys : p.looseTaskKeys;
  const out: Item[] = [];
  for (const key of keys) {
    const t = snap.tasks.get(key);
    if (!t || t.parentKey) continue;
    const work: Work[] = [];
    const other: Task[] = [];
    for (const ck of t.childKeys) {
      const c = snap.tasks.get(ck);
      if (!c) continue;
      const a = parseAssignment(plainLabel(c.text), profile);
      const steps = c.childKeys.map((k) => snap.tasks.get(k)).filter((s): s is Task => s !== undefined);
      if (a) work.push({ task: c, ...(a.person ? { person: a.person } : {}), mode: a.mode, steps });
      else other.push(c);
    }
    const link = /\[\[([^\]|#]+)/.exec(t.text)?.[1]?.trim();
    out.push({ task: t, title: plainLabel(t.text), ...(link ? { link } : {}), work, other, done: work.filter((w) => workStatus(w) === 'done').length });
  }
  // Songs that are projects of their own under the board: the month is their period.
  const groupKey = parsePeriod(group)?.key;
  for (const cid of p.childIds) {
    const c = snap.projects.get(cid);
    if (!c || /archived|cancelled/.test(c.status)) continue;
    if (groupKey ? c.period !== groupKey : c.period !== undefined) continue;
    const work: Work[] = [];
    for (const ph of c.phases) {
      const a = parseAssignment(ph.title, profile);
      const steps = ph.taskKeys.map((k) => snap.tasks.get(k)).filter((s): s is Task => s !== undefined && !s.parentKey);
      if (a) work.push({ phase: ph, ...(a.person ? { person: a.person } : {}), mode: a.mode, steps });
    }
    const other = c.looseTaskKeys.map((k) => snap.tasks.get(k)).filter((s): s is Task => s !== undefined && !s.parentKey);
    const link = songNoteOf(ctx, c);
    out.push({ project: c, title: c.title, ...(link ? { link } : {}), work, other, done: work.filter((w) => workStatus(w) === 'done').length });
  }
  return out;
}

/** The note a song project owns: the one attached with `helm-project`, or the first under `## Notes` — a song note first. */
export function songNoteOf(ctx: UiContext, c: Project): string | undefined {
  const notes: NoteRef[] = ctx.index.notesFor({ kind: 'project', id: c.id, title: c.title });
  const pick = notes.find((n) => ctx.index.song(n.path)) ?? notes[0];
  return pick ? pick.path.replace(/\.md$/, '') : ctx.index.noteLinksOf(c.path)[0];
}

/** Every group this project has: its phases, and the months its song projects sit in. */
export function groupsOf(p: Project, snap?: { projects: Map<string, Project> }): string[] {
  const out = p.phases.map((ph) => ph.title);
  if (snap) {
    const months = [...new Set(p.childIds.map((id) => snap.projects.get(id)?.period).filter((k): k is string => !!k))].sort();
    for (const k of months) { const label = parsePeriod(k)?.label; if (label && !out.includes(label)) out.push(label); }
  }
  return out;
}

/**
 * Where the board should open, and where its arrows go.
 *
 * Music happens in months, so a month-based project walks the calendar rather than the phases that
 * happen to exist: this month is one step from last month whether or not anything was written in it
 * yet, and adding the first song is what brings the month into the note.
 */
export function stepGroup(p: Project, profile: ProjectProfile, group: string, by: number, snap?: { projects: Map<string, Project> }): string | undefined {
  if (profile.groupBy === 'month') {
    const period = parsePeriod(group);
    if (period?.month) {
      const total = period.year * 12 + (period.month - 1) + by;
      return monthPeriod(Math.floor(total / 12), (total % 12) + 1).label;
    }
  }
  const groups = groupsOf(p, snap);
  const at = groups.indexOf(group);
  const next = groups[at + by];
  return at === -1 ? groups[0] : next;
}

/** The group a board opens on: the month we are in, or the last thing that was worked on. */
export function openingGroup(p: Project, profile: ProjectProfile, today: string, snap?: { projects: Map<string, Project> }): string {
  const groups = groupsOf(p, snap);
  if (profile.groupBy === 'month') {
    const now = monthPeriod(Number(today.slice(0, 4)), Number(today.slice(5, 7))).label;
    return groups.includes(now) ? now : (groups.length > 0 ? groups[groups.length - 1]! : now);
  }
  return groups[groups.length - 1] ?? '';
}

export function renderProfileBoard(ctx: UiContext, root: HTMLElement, p: Project, profile: ProjectProfile, state: ProfileBoardState): void {
  const snap = ctx.index.snapshot;
  const groups = groupsOf(p, snap);
  const group = state.group ?? openingGroup(p, profile, ctx.today(), snap);
  const items = itemsOf(ctx, p, profile, group);
  const go = (g: string | undefined): void => { if (g === undefined) return; state.group = g; ctx.refresh(); };
  const back = stepGroup(p, profile, group, -1, snap);
  const forward = stepGroup(p, profile, group, 1, snap);
  const thisMonth = profile.groupBy === 'month' ? openingGroup(p, profile, ctx.today(), snap) : undefined;

  // ── The month, with a step either side and what each person has on ──
  const perPerson = new Map<string, { items: Set<string>; done: number; total: number }>();
  for (const it of items) {
    for (const w of it.work) {
      const who = w.person ?? 'This project';
      const e = perPerson.get(who) ?? { items: new Set<string>(), done: 0, total: 0 };
      e.items.add(it.task?.key ?? it.project!.id);
      e.total++;
      if (workStatus(w) === 'done') e.done++;
      perPerson.set(who, e);
    }
  }

  root.appendChild(h('div', { cls: 'helm-day-head helm-profile-head' },
    h('div', { cls: 'helm-day-nav' },
      iconButton('chevron-left', `Previous ${profile.groupNoun}`, () => go(back)),
      h('div', { cls: 'helm-day-title' },
        h('span', { cls: 'helm-day-title-main', text: group || `No ${profile.groupNoun} yet` }),
        h('span', { cls: 'helm-day-title-sub', text: `${items.length} ${items.length === 1 ? profile.itemNoun : `${profile.itemNoun}s`}` }),
      ),
      iconButton('chevron-right', `Next ${profile.groupNoun}`, () => go(forward)),
      ...(thisMonth && thisMonth !== group ? [button('This month', { cls: 'helm-btn-quiet', onClick: () => go(thisMonth) })] : []),
    ),
    h('div', { cls: 'helm-day-actions' },
      ...[...perPerson.entries()].map(([who, e]) => chip(`${who}: ${e.items.size}`, 'count', `${e.done} of ${e.total} done`)),
      button(`Add a ${profile.itemNoun}`, { icon: 'plus', primary: true, onClick: () => openProfileItem(ctx, p, profile, { group }) }),
    ),
  ));

  if (groups.length > 1 || (groups.length === 1 && groups[0] !== group)) {
    root.appendChild(h('div', { cls: 'helm-profile-groups' }, ...groups.map((g) => h('button', {
      cls: ['helm-seg', g === group && 'is-active'], text: g, onClick: () => go(g),
    }))));
  }

  if (items.length === 0) {
    root.appendChild(h('div', { cls: 'helm-empty' }, h('p', { text: `Nothing in ${group || 'this project'} yet.` }),
      button(`Add the first ${profile.itemNoun}`, { primary: true, onClick: () => openProfileItem(ctx, p, profile, { group }) })));
    return;
  }

  // ── One lane per person: what they are on this month, and how far along ──
  if (profile.people.length > 0) {
    const lanes = h('div', { cls: 'helm-profile-lanes' });
    const people = [...new Set([...profile.people, ...perPerson.keys()])].filter((who) => perPerson.has(who));
    for (const who of people) {
      const mine = items.filter((it) => it.work.some((w) => (w.person ?? 'This project') === who));
      const e = perPerson.get(who)!;
      lanes.appendChild(h('div', { cls: 'helm-profile-lane' },
        h('div', { cls: 'helm-profile-lane-head' }, icon('user'), h('strong', { text: who }), h('span', { cls: 'helm-spacer' }), h('span', { cls: 'helm-hint', text: `${e.done}/${e.total}` })),
        progressBar(e.total ? e.done / e.total : 0, 'is-thin'),
        ...mine.map((it) => h('div', { cls: 'helm-profile-lane-item' },
          h('span', { cls: 'helm-profile-lane-title', text: it.title, attr: { title: `${it.title} — ${describeWork(it.work.map((w) => ({ ...(w.person ? { person: w.person } : {}), mode: w.mode })), profile)}` } }),
          h('span', { cls: 'helm-profile-lane-chips' }, ...it.work.filter((w) => (w.person ?? 'This project') === who).map((w) => modeChip(ctx, profile, w))),
        )),
      ));
    }
    root.appendChild(lanes);
  }

  // ── And the songs themselves, one card each, with every hand that is on them ──
  const list = h('div', { cls: 'helm-profile-items' });
  for (const it of items) {
    const total = it.work.length;
    // A song that points at a Maestro note brings its own facts along: the key, the tempo, and what
    // Maestro thinks of it — read from the note, never retyped.
    const song = it.link ? ctx.index.song(it.link) : undefined;
    const card = h('div', { cls: ['helm-profile-item', total > 0 && it.done === total && 'is-done', it.project && 'is-project'] },
      h('div', { cls: 'helm-profile-item-head' },
        h('button', { cls: 'helm-profile-item-title', onClick: () => it.task ? openTaskEditor(ctx, it.task) : ctx.navigate('projects', { projectId: it.project!.id }) }, it.project ? icon('folder') : null, h('span', { text: it.title })),
        it.link ? iconButton('file-text', `Open ${it.link}`, () => ctx.openLink(it.link!, p.path)) : null,
        song?.key ? chip(song.key, 'count', `Key of ${song.key}`) : null,
        song?.tempo ? chip(`♩=${song.tempo}`, 'count', `${song.tempo} bpm${song.time ? ` · ${song.time}` : ''}`) : null,
        song?.status ? chip(song.status, 'note', 'What the song note itself says') : null,
        h('span', { cls: 'helm-spacer' }),
        total > 0 ? h('span', { cls: 'helm-hint', text: `${it.done}/${total}` }) : null,
        it.task ? iconButton('more-horizontal', 'More…', (ev) => taskMenu(ctx, it.task!, ev)) : iconButton('external-link', 'Open the project', () => ctx.navigate('projects', { projectId: it.project!.id })),
      ),
      it.work.length > 0 ? h('div', { cls: 'helm-profile-says' }, describeWork(it.work.map((w) => ({ ...(w.person ? { person: w.person } : {}), mode: w.mode })), profile)) : null,
      h('div', { cls: 'helm-profile-item-work' },
        ...it.work.map((w) => modeChip(ctx, profile, w, { withPerson: true })),
        ...it.other.map((o) => chip(plainLabel(o.text), o.status === 'done' ? 'done' : 'count')),
        total === 0 && it.other.length === 0 ? h('span', { cls: 'helm-hint', text: 'nothing assigned yet' }) : null,
      ),
      // The practice steps under each way of working — real task lines, planned and ticked like any other.
      ...it.work.filter((w) => w.steps.length > 0).map((w) => {
        const steps = w.steps;
        const done = steps.filter((s) => s.status === 'done').length;
        return h('div', { cls: ['helm-profile-steps', done === steps.length && 'is-done'] },
          h('div', { cls: 'helm-profile-steps-head' }, icon('list-checks'), h('span', { text: `${w.person ? `${w.person} · ` : ''}${w.mode}` }), h('span', { cls: 'helm-spacer' }), h('span', { cls: 'helm-hint', text: `${done}/${steps.length}` })),
          taskList(ctx, steps, { showDate: 'scheduled', depth: 1 }),
        );
      }),
    );
    list.appendChild(card);
  }
  root.appendChild(list);
}

/** One way of working on one item, as a button: press it and that piece is done. */
function modeChip(ctx: UiContext, profile: ProjectProfile, w: Work, opts: { withPerson?: boolean } = {}): HTMLElement {
  const i = profile.modes.indexOf(w.mode);
  const short = profile.short[i] ?? w.mode;
  const st = workStatus(w);
  const state = st === 'done' ? 'is-done' : st === 'doing' ? 'is-doing' : st === 'off' ? 'is-off' : '';
  const label = opts.withPerson && w.person ? `${w.person} ${short}` : short;
  const stepsDone = w.steps.filter((s) => s.status === 'done').length;
  return h('button', {
    cls: ['helm-chip', 'helm-profile-chip', state],
    title: `${w.person ? `${w.person} — ` : ''}${w.mode}${w.steps.length ? ` · ${stepsDone}/${w.steps.length} steps` : ''} · ${st === 'done' ? 'done' : 'click to tick off, shift-click for in progress'}`,
    onClick: (ev) => {
      ev.stopPropagation();
      if (w.task) {
        const next = ev.shiftKey ? (w.task.status === 'doing' ? 'todo' : 'doing') : w.task.status === 'done' ? 'todo' : 'done';
        void ctx.run('Status', () => ctx.mutations.setStatus(w.task!.key, next));
      } else {
        // A phase has no line of its own: ticking it ticks every step (and untick puts them all back).
        const next = st === 'done' ? 'todo' : 'done';
        void ctx.run('Status', async () => { for (const s of w.steps) if (s.status !== next) await ctx.mutations.setStatus(s.key, next); });
      }
    },
  }, h('span', { cls: 'helm-chip-label', text: label }));
}
