/**
 * Adding one item to a profiled project: a song to a month, a chapter to a part, a topic to a subject.
 *
 * The dialogue speaks the profile's own words — “Add a song to September 2026”, not “Add a task to a
 * phase” — and the only real work it asks of you is ticking who is doing what. Everything it writes is
 * an ordinary task line underneath.
 */
import { Modal } from 'obsidian';
import type { IsoDate, Project } from '../../core/types';
import { describeWork, type Assignment, type ProjectProfile } from '../../core/profiles';
import { monthPeriod, parsePeriod } from '../../core/periods';
import { button, h } from '../dom';
import type { UiContext } from '../context';
import { wikilinkSuggest } from '../fields';

/** The months a picker offers: a year either side of where you are, so last month is one click away. */
export function monthChoices(today: IsoDate): { key: string; label: string }[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const out: { key: string; label: string }[] = [];
  for (let i = -6; i <= 12; i++) {
    const total = (y * 12 + (m - 1)) + i;
    const p = monthPeriod(Math.floor(total / 12), (total % 12) + 1);
    out.push({ key: p.label, label: p.label });
  }
  return out;
}

export function openProfileItem(ctx: UiContext, p: Project, profile: ProjectProfile, opts: { group?: string } = {}): void {
  const m = new Modal(ctx.app);
  const group0 = opts.group ?? (profile.groupBy === 'month' ? monthPeriod(Number(ctx.today().slice(0, 4)), Number(ctx.today().slice(5, 7))).label : (p.phases[0]?.title ?? ''));
  m.titleEl.setText(`Add a ${profile.itemNoun}${group0 ? ` to ${group0}` : ''}`);
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-profile-item');

  const title = h('input', { cls: 'helm-input', attr: { type: 'text', placeholder: profile.id === 'music' ? 'Song — Artist' : `Name of the ${profile.itemNoun}` } }) as HTMLInputElement;
  const note = h('input', { cls: 'helm-input', attr: { type: 'text', placeholder: 'Note to link (type [[ to search)…' } }) as HTMLInputElement;
  wikilinkSuggest(ctx, note);
  // Typing a note name and leaving the title empty is the common case: the note *is* the name.
  note.addEventListener('change', () => { if (title.value.trim() === '') title.value = plain(note.value); });

  const groupSel = h('select', { cls: 'helm-select-inline' }) as HTMLSelectElement;
  if (profile.groupBy === 'month') {
    const seen = new Set<string>();
    for (const c of monthChoices(ctx.today())) { seen.add(c.key); groupSel.appendChild(h('option', { text: c.label, attr: { value: c.key, selected: c.key === group0 } })); }
    for (const ph of p.phases) if (!seen.has(ph.title)) groupSel.appendChild(h('option', { text: ph.title, attr: { value: ph.title, selected: ph.title === group0 } }));
  } else {
    groupSel.appendChild(h('option', { text: `— no ${profile.groupNoun} —`, attr: { value: '' } }));
    for (const ph of p.phases) groupSel.appendChild(h('option', { text: ph.title, attr: { value: ph.title, selected: ph.title === group0 } }));
    const custom = h('option', { text: `+ a new ${profile.groupNoun}…`, attr: { value: '__new' } });
    groupSel.appendChild(custom);
  }
  const newGroup = h('input', { cls: 'helm-input', attr: { type: 'text', placeholder: `Name of the new ${profile.groupNoun}` } }) as HTMLInputElement;
  newGroup.style.display = 'none';
  groupSel.addEventListener('change', () => { newGroup.style.display = groupSel.value === '__new' ? '' : 'none'; if (groupSel.value === '__new') newGroup.focus(); });

  // Who does what. A row of named buttons per person rather than a grid of initials: “Chords” says what
  // it is, “PC” makes you remember. Pressing one turns it on, and the row says what it adds up to.
  const picked = new Set<string>();
  const grid = h('div', { cls: 'helm-profile-picker' });
  const rows = profile.people.length > 0 ? profile.people : [''];
  for (const person of rows) {
    const sum = h('span', { cls: 'helm-hint helm-profile-pick-sum', text: summarise([]) });
    const row = h('div', { cls: 'helm-profile-pick-row' },
      h('span', { cls: 'helm-profile-person', text: person || `This ${profile.itemNoun}` }),
      h('span', { cls: 'helm-profile-pick-modes' }, ...profile.modes.map((mode) => {
        const key = `${person}|${mode}`;
        // Toggled in place rather than redrawn: the button you pressed stays the button you pressed.
        const b = h('button', {
          cls: ['helm-chip', 'helm-profile-pick'],
          attr: { type: 'button', title: person ? `${person} — ${mode}` : mode, 'aria-pressed': 'false' },
        }, h('span', { cls: 'helm-chip-label', text: mode }));
        b.addEventListener('click', () => {
          const on = !picked.has(key);
          if (on) picked.add(key); else picked.delete(key);
          b.classList.toggle('is-on', on);
          b.setAttribute('aria-pressed', String(on));
          const mine = profile.modes.filter((m) => picked.has(`${person}|${m}`));
          sum.setText(summarise(mine));
          row.classList.toggle('is-on', mine.length > 0);
        });
        return b;
      })),
      sum,
    );
    grid.appendChild(row);
  }

  // What the ticks add up to, in the words the board will use — so the dialogue and the card agree.
  const says = h('div', { cls: 'helm-profile-says helm-profile-says-preview', text: 'Nobody is doing anything to it yet.' });
  const refreshSays = (): void => {
    const all: Assignment[] = [];
    for (const person of rows) for (const mode of profile.modes) if (picked.has(`${person}|${mode}`)) all.push({ ...(person ? { person } : {}), mode });
    const sentence = describeWork(all, profile);
    says.setText(sentence === '' ? 'Nobody is doing anything to it yet.' : `${title.value.trim() || `This ${profile.itemNoun}`}: ${sentence}.`);
  };
  grid.addEventListener('click', () => window.setTimeout(refreshSays, 0));
  title.addEventListener('input', refreshSays);

  const field = (label: string, el: HTMLElement): HTMLElement => h('div', { cls: 'helm-field' }, h('label', { text: label }), el);
  root.append(
    field('Name', title),
    ...(profile.linksNote ? [field('Note', note)] : []),
    field(profile.groupNoun[0]!.toUpperCase() + profile.groupNoun.slice(1), h('div', {}, groupSel, newGroup)),
    h('div', { cls: 'helm-hint', text: profile.people.length > 0 ? 'Who is doing what:' : 'What has to happen:' }),
    grid,
    says,
    h('div', { cls: 'helm-modal-buttons' },
      button('Cancel', { onClick: () => m.close() }),
      button(`Add the ${profile.itemNoun}`, { primary: true, icon: 'plus', onClick: () => void create() }),
    ),
  );

  async function create(): Promise<void> {
    const name = title.value.trim() || plain(note.value);
    if (name === '') { ctx.notify(`Give the ${profile.itemNoun} a name.`); return; }
    const group = groupSel.value === '__new' ? newGroup.value.trim() : groupSel.value;
    const assignments: Assignment[] = [];
    for (const person of rows) for (const mode of profile.modes) if (picked.has(`${person}|${mode}`)) assignments.push({ ...(person ? { person } : {}), mode });
    m.close();
    await ctx.run(`Add ${profile.itemNoun}`, async () => {
      await ctx.mutations.addProfileItem(p.id, {
        title: name, group,
        ...(profile.linksNote && plain(note.value) ? { note: plain(note.value) } : {}),
        assignments,
      });
      ctx.notify(`${name} added${group ? ` to ${group}` : ''}${assignments.length ? ` — ${assignments.length} to do` : ''}.`);
    });
  }

  m.open();
  ctx.trackModal(m);
  window.setTimeout(() => title.focus(), 30);
}

/** What one person's ticks add up to, in words: “sings and plays the chords”. */
function summarise(modes: string[]): string {
  if (modes.length === 0) return 'nothing yet';
  if (modes.length === 1) return modes[0]!.toLowerCase();
  return `${modes.slice(0, -1).map((m) => m.toLowerCase()).join(', ')} and ${modes[modes.length - 1]!.toLowerCase()}`;
}

/** What a `[[link]]` says once the brackets are off. */
const plain = (raw: string): string => raw.trim().replace(/^\[\[|\]\]$/g, '').split('|')[0]!.trim();

/** The month a group heading names, when it names one — used to order and step through them. */
export const groupPeriod = (title: string): ReturnType<typeof parsePeriod> => parsePeriod(title);
