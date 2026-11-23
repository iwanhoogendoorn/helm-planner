/** New / edit habit — click, don't type: emoji grid or PNG icon, schedule presets, weekday toggles. */
import { Modal, setIcon } from 'obsidian';
import { HABIT_COLORS, HABIT_COLOR_HEX, HABIT_PARTS, type Habit, type HabitColor, type HabitPart } from '../../core/types';
import { habitColor } from '../../core/habit';
import { drawingsSection, pickDrawing, targetForHabit } from '../drawings';
import { notesSection, pickNote } from '../notes';
import { askNameAndLocation } from '../fields';
import { formatRecurrence, parseRecurrence } from '../../core/recurrence';
import { WEEKDAY_SHORT } from '../../core/dates';
import { button, h, icon } from '../dom';
import type { UiContext } from '../context';
import { confirmModal } from './confirm';
import { askItemNote, itemLinkLabel, itemLinkMenu } from '../itemLink';

const EMOJIS = ['🏃', '🚶', '🏋️', '🧘', '🚴', '🏊', '⚽', '🎾', '🥗', '🍎', '💧', '☕', '🚭', '😴', '🌅', '📖', '✍️', '🎹', '🎸', '🎤', '🎨', '💻', '🧠', '🗣️', '🇪🇸', '🧹', '🧺', '🌱', '🐕', '💊', '🦷', '🧴', '💰', '📧', '📓', '🙏', '❤️', '📵', '🎯', '⭐'];

/** File → bytes; FileReader keeps it working where Blob.arrayBuffer is missing. */
function readBytes(f: Blob): Promise<ArrayBuffer> {
  if (typeof f.arrayBuffer === 'function') return f.arrayBuffer();
  return new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result as ArrayBuffer); r.onerror = () => reject(r.error); r.readAsArrayBuffer(f); });
}

function dataUrl(data: ArrayBuffer, ext: string): string {
  const mime = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
  let bin = '';
  for (const b of new Uint8Array(data)) bin += String.fromCharCode(b);
  return `data:${mime};base64,${btoa(bin)}`;
}

type Preset = 'daily' | 'weekdays' | 'weekends' | 'weekly' | 'everyN' | 'monthly';

/** The Delete habit question: says plainly that it is the whole habit, not one day or one part of the day. */
export function deleteHabitBody(title: string): string {
  return `Delete the whole habit “${title}”, on every day? Its note goes to the trash; past daily notes keep their ticks. To take it out of a morning, afternoon or evening only, use “Remove from …” or “For this day” instead.`;
}

export function openHabitForm(ctx: UiContext, existing?: Habit): void {
  const m = new Modal(ctx.app);
  m.titleEl.setText(existing ? 'Edit habit' : 'New habit');
  const root = m.contentEl;
  root.addClass('helm-modal', 'helm-habit-form');

  // ── Name + icon ──────────────────────────────────────────────────────
  let emoji = existing?.icon ?? '';
  let iconImage: string | undefined = existing?.iconImage;
  let pendingUpload: { name: string; data: ArrayBuffer; ext: string } | undefined;
  const title = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder: 'Morning workout', value: existing?.title ?? '' } });
  const iconPreview = h('div', { cls: 'helm-habit-icon-preview' });
  const emojiGrid = h('div', { cls: 'helm-emoji-grid' });
  const fileInput = h('input', { attr: { type: 'file', accept: 'image/png,image/jpeg,image/svg+xml,image/webp' }, style: { display: 'none' } });
  const drawIcon = (): void => {
    iconPreview.replaceChildren();
    if (pendingUpload) iconPreview.appendChild(h('img', { cls: 'helm-habit-img', attr: { src: dataUrl(pendingUpload.data, pendingUpload.ext), alt: '' } }));
    else if (iconImage) { const url = ctx.resourceUrl(iconImage); iconPreview.appendChild(url ? h('img', { cls: 'helm-habit-img', attr: { src: url, alt: '' } }) : h('span', { cls: 'helm-hint', text: iconImage })); }
    else if (emoji) iconPreview.appendChild(h('span', { cls: 'helm-habit-emoji-big', text: emoji }));
    else iconPreview.appendChild(h('span', { cls: 'helm-hint', text: 'no icon' }));
    for (const b of emojiGrid.querySelectorAll<HTMLElement>('.helm-emoji')) b.classList.toggle('is-active', b.textContent === emoji && !iconImage && !pendingUpload);
  };
  for (const e of EMOJIS) emojiGrid.appendChild(h('button', { cls: 'helm-emoji', text: e, title: e, onClick: () => { emoji = emoji === e ? '' : e; iconImage = undefined; pendingUpload = undefined; drawIcon(); } }));
  fileInput.addEventListener('change', () => {
    const f = fileInput.files?.[0];
    if (!f) return;
    const ext = (f.name.split('.').pop() ?? 'png').toLowerCase();
    void readBytes(f).then((data) => { pendingUpload = { name: title.value.trim() || f.name.replace(/\.[^.]+$/, ''), data, ext }; iconImage = undefined; drawIcon(); });
  });
  const iconRow = h('div', { cls: 'helm-habit-icon-row' },
    iconPreview,
    h('div', { cls: 'helm-habit-icon-actions' },
      button('Upload image…', { icon: 'image-plus', title: 'A 256×256 PNG works best (flaticon etc.)', onClick: () => fileInput.click() }),
      button('Clear icon', { icon: 'x', cls: 'helm-btn-quiet', onClick: () => { emoji = ''; iconImage = undefined; pendingUpload = undefined; drawIcon(); } }),
      fileInput,
    ),
  );

  // ── Schedule ─────────────────────────────────────────────────────────
  const rec = existing?.schedule;
  let preset: Preset = 'daily';
  let weekdays = new Set<number>([1, 3, 5]);
  let everyN = 2;
  let monthDay = 1;
  if (rec?.parsed) {
    if (rec.frequency === 'daily' && (rec.interval ?? 1) > 1) { preset = 'everyN'; everyN = rec.interval ?? 2; }
    else if (rec.frequency === 'weekly' && rec.weekdays && rec.weekdays.length > 0) {
      const w = rec.weekdays;
      if (w.length === 5 && [1, 2, 3, 4, 5].every((d) => w.includes(d))) preset = 'weekdays';
      else if (w.length === 2 && w.includes(6) && w.includes(7)) preset = 'weekends';
      else { preset = 'weekly'; weekdays = new Set(w); }
    } else if (rec.frequency === 'monthly') { preset = 'monthly'; monthDay = rec.monthDays?.[0] ?? 1; }
  }
  const scheduleText = (): string => {
    switch (preset) {
      case 'daily': return 'every day';
      case 'weekdays': return 'every weekday';
      case 'weekends': return 'every week on saturday, sunday';
      case 'weekly': return weekdays.size === 0 ? 'every week' : `every week on ${[...weekdays].sort().map((d) => ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][d - 1]).join(', ')}`;
      case 'everyN': return `every ${everyN} days`;
      case 'monthly': return `every month on the ${monthDay}${['st', 'nd', 'rd'][((monthDay % 100) - 20) % 10 - 1] ?? (['st', 'nd', 'rd'][monthDay - 1] ?? 'th')}`;
    }
  };
  const presets = h('div', { cls: 'helm-segmented helm-wrap' });
  const weekdayRow = h('div', { cls: 'helm-weekday-toggles' });
  const nRow = h('div', { cls: 'helm-row helm-habit-n' });
  const monthRow = h('div', { cls: 'helm-row helm-habit-n' });
  const understood = h('div', { cls: 'helm-hint' });
  const drawSchedule = (): void => {
    presets.replaceChildren(...([['daily', 'Every day'], ['weekdays', 'Weekdays'], ['weekends', 'Weekends'], ['weekly', 'Pick days'], ['everyN', 'Every N days'], ['monthly', 'Monthly']] as [Preset, string][]).map(([k, label]) => h('button', { cls: ['helm-seg', preset === k && 'is-active'], text: label, onClick: () => { preset = k; drawSchedule(); } })));
    weekdayRow.style.display = preset === 'weekly' ? '' : 'none';
    weekdayRow.replaceChildren(...WEEKDAY_SHORT.map((n, i) => h('button', { cls: ['helm-weekday', weekdays.has(i + 1) && 'is-active'], text: n, onClick: () => { if (weekdays.has(i + 1)) weekdays.delete(i + 1); else weekdays.add(i + 1); drawSchedule(); } })));
    nRow.style.display = preset === 'everyN' ? '' : 'none';
    nRow.replaceChildren(h('span', { cls: 'helm-hint', text: 'every' }), ...[2, 3, 4, 5, 7, 10, 14].map((n) => h('button', { cls: ['helm-seg', everyN === n && 'is-active'], text: String(n), onClick: () => { everyN = n; drawSchedule(); } })), h('span', { cls: 'helm-hint', text: 'days' }));
    monthRow.style.display = preset === 'monthly' ? '' : 'none';
    monthRow.replaceChildren(h('span', { cls: 'helm-hint', text: 'on day' }), ...[1, 5, 10, 15, 20, 25, 28].map((n) => h('button', { cls: ['helm-seg', monthDay === n && 'is-active'], text: String(n), onClick: () => { monthDay = n; drawSchedule(); } })));
    const r = parseRecurrence(scheduleText());
    understood.textContent = r.parsed ? `Understood as: ${formatRecurrence(r)}` : 'Not a schedule I understand';
  };
  drawSchedule();

  // ── Colour ───────────────────────────────────────────────────────────
  let color: HabitColor | undefined = existing?.color;
  const colorRow = h('div', { cls: 'helm-swatches' });
  const drawColors = (): void => {
    colorRow.replaceChildren(...HABIT_COLORS.map((c) => { const b = h('button', { cls: ['helm-swatch', color === c && 'is-active'], title: c, onClick: () => { color = color === c ? undefined : c; drawColors(); } }); b.style.setProperty('--sw', `var(--color-${c}, ${HABIT_COLOR_HEX[c]})`); b.style.background = 'var(--sw)'; return b; }));
    if (!color) { const auto = habitColor({ id: existing?.id ?? title.value, ...(color ? { color } : {}) }); colorRow.appendChild(h('span', { cls: 'helm-hint', text: `auto: ${auto}` })); }
  };
  drawColors();

  // ── Parts of the day ─────────────────────────────────────────────────
  const parts = new Set<HabitPart>(existing?.parts ?? []);
  const partsRow = h('div', { cls: 'helm-segmented' });
  const partsHint = h('div', { cls: 'helm-hint' });
  const drawParts = (): void => {
    partsRow.replaceChildren(
      h('button', { cls: ['helm-seg', parts.size === 0 && 'is-active'], text: 'Once a day', onClick: () => { parts.clear(); drawParts(); } }),
      ...HABIT_PARTS.map((pt) => h('button', { cls: ['helm-seg', parts.has(pt) && 'is-active'], text: pt.charAt(0).toUpperCase() + pt.slice(1), onClick: () => { if (parts.has(pt)) parts.delete(pt); else parts.add(pt); drawParts(); } })),
    );
    partsHint.textContent = parts.size === 0 ? 'One tick a day, in the Habits section of the daily note.' : `${parts.size} tick${parts.size === 1 ? '' : 's'} a day — a line at the top of the ${[...parts].sort((a, b) => HABIT_PARTS.indexOf(a) - HABIT_PARTS.indexOf(b)).join(', ')} section${parts.size === 1 ? '' : 's'}. The day counts as done when every tick is done.`;
  };
  drawParts();

  // ── Sub-habits ───────────────────────────────────────────────────────
  // Edited here, written on save: the songs under Guitar, the pieces under Piano.
  // `link` as it will be saved; `newNote` a note to make for it on save (it then links to that).
  type Draft = { id?: string; title: string; original?: string; retired: boolean; wasRetired: boolean; deleted: boolean; link?: string; linkWas?: string; newNote?: { name?: string; folder?: string } };
  const drafts: Draft[] = (existing?.items ?? []).map((i) => ({ id: i.id, title: i.title, original: i.title, retired: !!i.retired, wasRetired: !!i.retired, deleted: false, ...(i.link ? { link: i.link, linkWas: i.link } : {}) }));
  const draftHabit = (): Habit => existing ?? ({ id: 'hab-new', title: title.value.trim() || 'New habit', path: '' } as unknown as Habit);
  const linkLabel = (d: Draft): string | undefined => d.newNote ? `new note${d.newNote.name ? ` “${d.newNote.name}”` : ''}` : d.link ? itemLinkLabel(d.link) : undefined;
  let perDay = existing?.itemsPerDay ?? 1;
  const itemList = h('div', { cls: 'helm-subhabit-edit' });
  const perDayRow = h('div', { cls: 'helm-segmented' });
  const newItem = h('input', { cls: 'helm-input-wide', attr: { type: 'text', placeholder: 'Add a song, a piece, an exercise… (Enter)' } });
  const addDraft = (): void => {
    for (const t of newItem.value.split(/[\n;]/).map((x) => x.trim()).filter(Boolean)) {
      if (!drafts.some((d) => !d.deleted && d.title.toLowerCase() === t.toLowerCase())) drafts.push({ title: t, retired: false, wasRetired: false, deleted: false });
    }
    newItem.value = '';
    drawItems();
  };
  newItem.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); addDraft(); } });
  /** Move a draft to just before `to` (or to the end), keeping the deleted ones out of the way. */
  const moveDraft = (d: Draft, to: Draft | undefined): void => {
    if (d === to) return;
    drafts.splice(drafts.indexOf(d), 1);
    drafts.splice(to ? drafts.indexOf(to) : drafts.length, 0, d);
    drawItems();
  };
  let dragging: Draft | undefined;
  const drawItems = (focus?: Draft): void => {
    const live = drafts.filter((d) => !d.deleted);
    itemList.replaceChildren(...live.map((d, i) => {
      const input = h('input', { cls: 'helm-subhabit-title', attr: { type: 'text', value: d.title, 'aria-label': `${d.title} (Alt+↑/↓ to move)` } });
      input.addEventListener('input', () => { d.title = input.value; });
      // Alt+↑ / Alt+↓ move the song from the keyboard.
      input.addEventListener('keydown', (ev) => {
        if (!ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
        ev.preventDefault();
        if (ev.key === 'ArrowUp' && i > 0) { moveDraft(d, live[i - 1]); drawItems(d); }
        if (ev.key === 'ArrowDown' && i < live.length - 1) { moveDraft(d, live[i + 2]); drawItems(d); }
      });
      if (focus === d) setTimeout(() => input.focus(), 0);
      const handle = h('span', { cls: 'helm-subhabit-grip', title: 'Drag to change the order', attr: { 'aria-hidden': 'true' } }, icon('grip-vertical'));
      const label = linkLabel(d);
      const linkBtn = h('button', {
        cls: ['helm-subhabit-link', 'clickable-icon', !!label && 'is-linked'],
        title: label ? `Linked to ${label}: open, change or remove` : 'Link it to a note or a web page (the song, the exercise)',
        attr: { 'aria-label': `Link ${d.title}` },
        onClick: (ev) => itemLinkMenu(ctx, {
          hb: draftHabit(), title: d.title.trim() || 'this sub-habit', link: d.newNote ? undefined : d.link, ev,
          set: (link) => { delete d.newNote; if (link) d.link = link; else delete d.link; drawItems(); },
          newNote: () => {
            const t = d.title.trim() || 'Untitled';
            if (existing) askItemNote(ctx, existing.id, t, (r) => { d.newNote = r; drawItems(); });
            else { d.newNote = {}; drawItems(); }
          },
        }),
      }, icon(label ? 'file-text' : 'link'), label ? h('span', { cls: 'helm-subhabit-link-label', text: label }) : null);
      const row = h('div', { cls: ['helm-subhabit-row', d.retired && 'is-retired'] }, handle, input, linkBtn,
        button(d.retired ? 'Bring back' : 'Retire', { icon: d.retired ? 'rotate-ccw' : 'archive', cls: 'helm-btn-quiet', title: d.retired ? 'Offer it again' : 'Learned or shelved: no longer offered, its history kept', onClick: () => { d.retired = !d.retired; drawItems(); } }),
        button('', { icon: 'x', cls: 'helm-btn-quiet', title: 'Remove (lines already in daily notes stay)', onClick: () => { if (d.id) d.deleted = true; else drafts.splice(drafts.indexOf(d), 1); drawItems(); } }));
      // Only the grip starts a drag, so the text field still selects text.
      handle.addEventListener('mousedown', () => { row.draggable = true; });
      row.addEventListener('mouseup', () => { row.draggable = false; });
      row.addEventListener('dragstart', (ev) => { dragging = d; row.addClass('is-dragging'); ev.dataTransfer?.setData('text/plain', d.title); if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move'; });
      row.addEventListener('dragend', () => { dragging = undefined; row.draggable = false; drawItems(); });
      row.addEventListener('dragover', (ev) => {
        if (!dragging || dragging === d) return;
        ev.preventDefault();
        const below = ev.offsetY > row.offsetHeight / 2;
        row.toggleClass('is-drop-before', !below); row.toggleClass('is-drop-after', below);
      });
      row.addEventListener('dragleave', () => { row.removeClass('is-drop-before'); row.removeClass('is-drop-after'); });
      row.addEventListener('drop', (ev) => {
        if (!dragging) return;
        ev.preventDefault();
        const below = ev.offsetY > row.offsetHeight / 2;
        moveDraft(dragging, below ? live[i + 1] : d);
      });
      return row;
    }));
    const n = live.filter((d) => !d.retired).length;
    perDayRow.replaceChildren(...[1, 2, 3].filter((k) => k < Math.max(2, n)).map((k) => h('button', { cls: ['helm-seg', perDay === k && 'is-active'], text: `${k}`, onClick: () => { perDay = k; drawItems(); } })),
      h('button', { cls: ['helm-seg', perDay === 0 && 'is-active'], text: 'all of them', onClick: () => { perDay = 0; drawItems(); } }));
    perDayRow.style.display = n > 0 ? '' : 'none';
  };
  drawItems();

  // ── Target and grace ─────────────────────────────────────────────────
  // New habit: attachments chosen now, created / linked right after the habit note exists.
  type Pending = { kind: 'note' | 'drawing'; mode: 'new' | 'link'; label: string; name?: string; folder?: string; path?: string };
  const pending: Pending[] = [];
  const pendingList = h('div', { cls: 'helm-pending-list' });
  const provisional = (): { kind: 'habit'; id: string; title: string } => ({ kind: 'habit', id: 'hab-new', title: title.value.trim() || 'New habit' });
  const drawPending = (): void => {
    pendingList.replaceChildren(...pending.map((x, i) => {
      const chip = h('span', { cls: ['helm-pending', `is-${x.kind}`] });
      const ic = h('span', { cls: 'helm-pending-icon' }); setIcon(ic, x.kind === 'note' ? 'sticky-note' : 'pen-tool');
      chip.append(ic, h('span', { text: x.label }), h('button', { cls: 'helm-pending-remove', title: 'Remove', text: '×', onClick: () => { pending.splice(i, 1); drawPending(); } }));
      return chip;
    }));
    pendingList.style.display = pending.length ? '' : 'none';
  };
  const queueNew = (kind: 'note' | 'drawing'): void => {
    const t = provisional();
    askNameAndLocation(ctx, {
      title: `New ${kind} for ${t.title}`,
      placeholder: kind === 'note' ? 'e.g. why this matters, routine' : 'e.g. routine, mind map',
      defaultFolder: ctx.mutations.defaultFolderFor(t, kind),
      preview: (name, folder) => (kind === 'note' ? ctx.mutations.notePathFor(t, name, folder) : ctx.mutations.drawingPathFor(t, name, folder)),
      onDone: (r) => { if (!r) return; pending.push({ kind, mode: 'new', label: `New ${kind}: ${r.name ?? t.title}`, ...r }); drawPending(); },
    });
  };
  const queueLink = (kind: 'note' | 'drawing'): void => {
    const taken = new Set(pending.filter((x) => x.mode === 'link').map((x) => x.path!));
    if (kind === 'note') pickNote(ctx, taken, (n) => { pending.push({ kind, mode: 'link', label: n.title, path: n.path }); drawPending(); });
    else pickDrawing(ctx, taken, (d) => { pending.push({ kind, mode: 'link', label: d.title, path: d.path }); drawPending(); });
  };
  const pendingRow = h('div', { cls: 'helm-pending-actions' },
    button('New note…', { icon: 'file-plus', onClick: () => queueNew('note') }),
    button('Link note…', { icon: 'link', onClick: () => queueLink('note') }),
    button('New drawing…', { icon: 'pen-tool', onClick: () => queueNew('drawing') }),
    button('Link drawing…', { icon: 'link', onClick: () => queueLink('drawing') }),
  );
  drawPending();
  const applyPending = async (id: string, name: string): Promise<void> => {
    const t = targetForHabit({ id, title: name });
    for (const x of pending) {
      if (x.kind === 'note') await (x.mode === 'new' ? ctx.mutations.createNote(t, { ...(x.name ? { name: x.name } : {}), ...(x.folder ? { folder: x.folder } : {}) }) : ctx.mutations.linkNote(t, x.path!));
      else await (x.mode === 'new' ? ctx.mutations.createDrawing(t, { ...(x.name ? { name: x.name } : {}), ...(x.folder ? { folder: x.folder } : {}) }) : ctx.mutations.linkDrawing(t, x.path!));
    }
  };

  let target: number | undefined = existing?.targetPerWeek;
  let grace = existing?.graceDays ?? 0;
  let active = existing ? existing.active : true;
  const targetRow = h('div', { cls: 'helm-segmented' });
  const graceRow = h('div', { cls: 'helm-segmented' });
  const activeBtn = h('button', { cls: ['helm-seg'], text: 'Active' });
  const drawNumbers = (): void => {
    targetRow.replaceChildren(h('button', { cls: ['helm-seg', target === undefined && 'is-active'], text: 'as scheduled', onClick: () => { target = undefined; drawNumbers(); } }), ...[1, 2, 3, 4, 5, 6, 7].map((n) => h('button', { cls: ['helm-seg', target === n && 'is-active'], text: `${n}×`, onClick: () => { target = n; drawNumbers(); } })));
    graceRow.replaceChildren(...[0, 1, 2, 3].map((n) => h('button', { cls: ['helm-seg', grace === n && 'is-active'], text: n === 0 ? 'none' : `${n} day${n > 1 ? 's' : ''}`, onClick: () => { grace = n; drawNumbers(); } })));
    activeBtn.classList.toggle('is-active', active);
    activeBtn.textContent = active ? 'Active' : 'Paused';
  };
  activeBtn.addEventListener('click', () => { active = !active; drawNumbers(); });
  drawNumbers();

  const field = (label: string, hint: string, ...els: HTMLElement[]): HTMLElement => h('div', { cls: 'helm-field' }, h('span', { cls: 'helm-field-label' }, label, hint ? h('span', { cls: 'helm-hint', text: ` · ${hint}` }) : null), ...els);
  root.append(
    field('Name', '', title),
    field('Icon', 'click an emoji, or upload a PNG', iconRow, emojiGrid),
    field('Schedule', '', presets, weekdayRow, nRow, monthRow, understood),
    field('Part of the day', 'pick several for a habit you do more than once a day', partsRow, partsHint),
    field('Colour', 'for the board, the week cells and the charts', colorRow),
    field('Sub-habits', 'what you practise inside this habit — log one or more a day, several times each', itemList, newItem),
    field('Sub-habits that make the day', 'the habit ticks itself once this many are done', perDayRow),
    ...(existing ? [field('Notes', 'attached to this habit', notesSection(ctx, targetForHabit(existing))), field('Drawings', 'attached to this habit', drawingsSection(ctx, targetForHabit(existing)))]
      : [field('Notes & drawings', 'created or linked as soon as the habit is', pendingRow, pendingList)]),
    h('div', { cls: 'helm-grid2' },
      field('Target per week', 'counts against the streak', targetRow),
      field('Grace', 'misses tolerated before a streak breaks', graceRow),
    ),
    h('div', { cls: 'helm-modal-buttons' }, h('div', { cls: 'helm-segmented' }, activeBtn), existing ? button('Delete', { icon: 'trash', cls: 'helm-btn-quiet', title: 'Move the habit note to the trash', onClick: () => { void confirmModal(ctx, { title: 'Delete habit', body: deleteHabitBody(existing.title), cta: 'Move to trash', warning: true }).then((ok) => { if (ok) { m.close(); void ctx.run('Delete habit', () => ctx.mutations.deleteHabit(existing.id)); } }); } }) : null, h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button(existing ? 'Save' : 'Create habit', { primary: true, onClick: () => void save() })),
  );
  drawIcon();

  async function save(): Promise<void> {
    const name = title.value.trim();
    const r = parseRecurrence(scheduleText());
    if (name === '' || !r.parsed) { ctx.notify('Name and a schedule are required.'); return; }
    if (preset === 'weekly' && weekdays.size === 0) { ctx.notify('Pick at least one day.'); return; }
    m.close();
    await ctx.run(existing ? 'Save habit' : 'Create habit', async () => {
      let image = iconImage;
      if (pendingUpload) image = await ctx.mutations.saveHabitIcon(pendingUpload.name || name, pendingUpload.data, pendingUpload.ext);
      const schedule = formatRecurrence(r);
      const partList = HABIT_PARTS.filter((pt) => parts.has(pt));
      if (newItem.value.trim()) addDraft();
      const anyItems = drafts.some((d) => !d.deleted);
      if (existing) {
        await ctx.mutations.setHabitFields(existing.id, { title: name, schedule, active, graceDays: grace, targetPerWeek: target ?? null, icon: emoji, iconImage: image ?? null, parts: partList, color: color ?? null, ...(anyItems || existing.itemsPerDay !== undefined ? { itemsPerDay: perDay } : {}) });
        for (const d of drafts) {
          const t = d.title.trim();
          if (d.id && d.deleted) await ctx.mutations.removeHabitItem(existing.id, d.id);
          else if (d.id && ((t && t !== d.original) || d.retired !== d.wasRetired)) await ctx.mutations.setHabitItem(existing.id, d.id, { ...(t && t !== d.original ? { title: t } : {}), retired: d.retired });
          else if (!d.id && t) d.id = (await ctx.mutations.addHabitItem(existing.id, t)).id;
          if (d.id && !d.deleted) await saveLink(existing.id, d);
        }
        // Then the order as dragged (retired ones keep their own list, in the same order).
        const order = drafts.filter((d) => !d.deleted && d.id).map((d) => d.id!);
        if (order.length > 1) await ctx.mutations.orderHabitItems(existing.id, order);
      } else {
        const items = drafts.filter((d) => !d.deleted && d.title.trim()).map((d) => d.title.trim());
        const id = await ctx.mutations.createHabit({ title: name, schedule, graceDays: grace, ...(target ? { targetPerWeek: target } : {}), ...(emoji ? { icon: emoji } : {}), ...(image ? { iconImage: image } : {}), ...(partList.length ? { parts: partList } : {}), ...(color ? { color } : {}), ...(items.length ? { items, itemsPerDay: perDay } : {}) });
        await applyPending(id, name);
        // Links: the sub-habits got their ids with the habit note; match them by title.
        const made = ctx.index.snapshot.habits.get(id)?.items ?? [];
        for (const d of drafts) {
          const it = made.find((x) => x.title.toLowerCase() === d.title.trim().toLowerCase());
          if (it && !d.deleted) { d.id = it.id; await saveLink(id, d); }
        }
      }
    });
  }
  async function saveLink(habitId: string, d: Draft): Promise<void> {
    if (d.newNote) { await ctx.mutations.createItemNote(habitId, d.id!, d.newNote); return; }
    if ((d.link ?? '') !== (d.linkWas ?? '')) await ctx.mutations.setHabitItem(habitId, d.id!, { link: d.link ?? null });
  }
  m.open();
  ctx.trackModal(m);
  setTimeout(() => title.focus(), 0);

}
