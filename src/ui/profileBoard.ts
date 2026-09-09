/**
 * A profiled project, seen the way that kind of work is actually thought about.
 *
 * For music: one month at a time, and inside it every song with who is doing what to it — Zaara singing,
 * me on piano with chords, the two of us together. The point is the glance: what is she doing this month,
 * what am I doing, and how far has each of us got. A chip is a real subtask, so ticking one here is the
 * same as ticking it anywhere else in Helm.
 */
import type { Project, Task } from '../core/types';
import type { ProjectProfile } from '../core/profiles';
import { describeWork, parseAssignment } from '../core/profiles';
import { isOpen } from '../data/planner';
import { plainLabel } from '../core/label';
import { monthPeriod, parsePeriod } from '../core/periods';
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

interface Item {
  task: Task;
  title: string;
  /** The note this item points at, when it points at one. */
  link?: string;
  work: { task: Task; person?: string; mode: string }[];
  /** Steps that are not assignments — an ordinary subtask someone wrote. */
  other: Task[];
  done: number;
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
    const work: Item['work'] = [];
    const other: Task[] = [];
    for (const ck of t.childKeys) {
      const c = snap.tasks.get(ck);
      if (!c) continue;
      const a = parseAssignment(plainLabel(c.text), profile);
      if (a) work.push({ task: c, ...(a.person ? { person: a.person } : {}), mode: a.mode });
      else other.push(c);
    }
    const link = /\[\[([^\]|#]+)/.exec(t.text)?.[1]?.trim();
    out.push({
      task: t, title: plainLabel(t.text), ...(link ? { link } : {}), work, other,
      done: work.filter((w) => w.task.status === 'done').length,
    });
  }
  return out;
}

/** Every group this project has. */
export function groupsOf(p: Project): string[] {
  return p.phases.map((ph) => ph.title);
}

/**
 * Where the board should open, and where its arrows go.
 *
 * Music happens in months, so a month-based project walks the calendar rather than the phases that
 * happen to exist: this month is one step from last month whether or not anything was written in it
 * yet, and adding the first song is what brings the month into the note.
 */
export function stepGroup(p: Project, profile: ProjectProfile, group: string, by: number): string | undefined {
  if (profile.groupBy === 'month') {
    const period = parsePeriod(group);
    if (period?.month) {
      const total = period.year * 12 + (period.month - 1) + by;
      return monthPeriod(Math.floor(total / 12), (total % 12) + 1).label;
    }
  }
  const groups = groupsOf(p);
  const at = groups.indexOf(group);
  const next = groups[at + by];
  return at === -1 ? groups[0] : next;
}

/** The group a board opens on: the month we are in, or the last thing that was worked on. */
export function openingGroup(p: Project, profile: ProjectProfile, today: string): string {
  const groups = groupsOf(p);
  if (profile.groupBy === 'month') {
    const now = monthPeriod(Number(today.slice(0, 4)), Number(today.slice(5, 7))).label;
    return groups.includes(now) ? now : (groups.length > 0 ? groups[groups.length - 1]! : now);
  }
  return groups[groups.length - 1] ?? '';
}

export function renderProfileBoard(ctx: UiContext, root: HTMLElement, p: Project, profile: ProjectProfile, state: ProfileBoardState): void {
  const groups = groupsOf(p);
  const group = state.group ?? openingGroup(p, profile, ctx.today());
  const items = itemsOf(ctx, p, profile, group);
  const go = (g: string | undefined): void => { if (g === undefined) return; state.group = g; ctx.refresh(); };
  const back = stepGroup(p, profile, group, -1);
  const forward = stepGroup(p, profile, group, 1);
  const thisMonth = profile.groupBy === 'month' ? openingGroup(p, profile, ctx.today()) : undefined;

  // ── The month, with a step either side and what each person has on ──
  const perPerson = new Map<string, { items: Set<string>; done: number; total: number }>();
  for (const it of items) {
    for (const w of it.work) {
      const who = w.person ?? 'This project';
      const e = perPerson.get(who) ?? { items: new Set<string>(), done: 0, total: 0 };
      e.items.add(it.task.key);
      e.total++;
      if (w.task.status === 'done') e.done++;
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
    const card = h('div', { cls: ['helm-profile-item', total > 0 && it.done === total && 'is-done'] },
      h('div', { cls: 'helm-profile-item-head' },
        h('button', { cls: 'helm-profile-item-title', onClick: () => openTaskEditor(ctx, it.task) }, h('span', { text: it.title })),
        it.link ? iconButton('file-text', `Open ${it.link}`, () => ctx.openLink(it.link!, p.path)) : null,
        song?.key ? chip(song.key, 'count', `Key of ${song.key}`) : null,
        song?.tempo ? chip(`♩=${song.tempo}`, 'count', `${song.tempo} bpm${song.time ? ` · ${song.time}` : ''}`) : null,
        song?.status ? chip(song.status, 'note', 'What the song note itself says') : null,
        h('span', { cls: 'helm-spacer' }),
        total > 0 ? h('span', { cls: 'helm-hint', text: `${it.done}/${total}` }) : null,
        iconButton('more-horizontal', 'More…', (ev) => taskMenu(ctx, it.task, ev)),
      ),
      it.work.length > 0 ? h('div', { cls: 'helm-profile-says' }, describeWork(it.work.map((w) => ({ ...(w.person ? { person: w.person } : {}), mode: w.mode })), profile)) : null,
      h('div', { cls: 'helm-profile-item-work' },
        ...it.work.map((w) => modeChip(ctx, profile, w, { withPerson: true })),
        ...it.other.map((o) => chip(plainLabel(o.text), o.status === 'done' ? 'done' : 'count')),
        total === 0 && it.other.length === 0 ? h('span', { cls: 'helm-hint', text: 'nothing assigned yet' }) : null,
      ),
      // The practice steps under each way of working — real task lines, planned and ticked like any other.
      ...it.work.filter((w) => w.task.childKeys.length > 0).map((w) => {
        const steps = w.task.childKeys.map((k) => ctx.index.snapshot.tasks.get(k)).filter((s): s is Task => s !== undefined);
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
function modeChip(ctx: UiContext, profile: ProjectProfile, w: { task: Task; person?: string; mode: string }, opts: { withPerson?: boolean } = {}): HTMLElement {
  const i = profile.modes.indexOf(w.mode);
  const short = profile.short[i] ?? w.mode;
  const state = w.task.status === 'done' ? 'is-done' : w.task.status === 'doing' ? 'is-doing' : isOpen(w.task) ? '' : 'is-off';
  const label = opts.withPerson && w.person ? `${w.person} ${short}` : short;
  return h('button', {
    cls: ['helm-chip', 'helm-profile-chip', state],
    title: `${w.person ? `${w.person} — ` : ''}${w.mode} · ${w.task.status === 'done' ? 'done' : 'click to tick off, shift-click for in progress'}`,
    onClick: (ev) => {
      ev.stopPropagation();
      const next = ev.shiftKey ? (w.task.status === 'doing' ? 'todo' : 'doing') : w.task.status === 'done' ? 'todo' : 'done';
      void ctx.run('Status', () => ctx.mutations.setStatus(w.task.key, next));
    },
  }, h('span', { cls: 'helm-chip-label', text: label }));
}
