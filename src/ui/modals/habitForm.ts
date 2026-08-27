/** New / edit habit — click, don't type: emoji grid or PNG icon, schedule presets, weekday toggles. */
import { Modal } from 'obsidian';
import { HABIT_COLORS, HABIT_PARTS, type Habit, type HabitColor, type HabitPart } from '../../core/types';
import { habitColor } from '../../core/habit';
import { drawingsSection, targetForHabit } from '../drawings';
import { notesSection } from '../notes';
import { formatRecurrence, parseRecurrence } from '../../core/recurrence';
import { WEEKDAY_SHORT } from '../../core/dates';
import { button, h } from '../dom';
import type { UiContext } from '../context';

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
    colorRow.replaceChildren(...HABIT_COLORS.map((c) => { const b = h('button', { cls: ['helm-swatch', color === c && 'is-active'], title: c, onClick: () => { color = color === c ? undefined : c; drawColors(); } }); b.style.setProperty('--sw', `var(--color-${c})`); return b; }));
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

  // ── Target and grace ─────────────────────────────────────────────────
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
    ...(existing ? [field('Notes', 'attached to this habit', notesSection(ctx, targetForHabit(existing))), field('Drawings', 'attached to this habit', drawingsSection(ctx, targetForHabit(existing)))] : []),
    h('div', { cls: 'helm-grid2' },
      field('Target per week', 'counts against the streak', targetRow),
      field('Grace', 'misses tolerated before a streak breaks', graceRow),
    ),
    h('div', { cls: 'helm-modal-buttons' }, h('div', { cls: 'helm-segmented' }, activeBtn), existing ? button('Delete', { icon: 'trash', cls: 'helm-btn-quiet', title: 'Move the habit note to the trash', onClick: () => { if (window.confirm(`Move the habit “${existing.title}” to the trash? Past daily notes keep their ticks.`)) { m.close(); void ctx.run('Delete habit', () => ctx.mutations.deleteHabit(existing.id)); } } }) : null, h('span', { cls: 'helm-spacer' }), button('Cancel', { onClick: () => m.close() }), button(existing ? 'Save' : 'Create habit', { primary: true, onClick: () => void save() })),
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
      if (existing) await ctx.mutations.setHabitFields(existing.id, { title: name, schedule, active, graceDays: grace, targetPerWeek: target ?? null, icon: emoji, iconImage: image ?? null, parts: partList, color: color ?? null });
      else await ctx.mutations.createHabit({ title: name, schedule, graceDays: grace, ...(target ? { targetPerWeek: target } : {}), ...(emoji ? { icon: emoji } : {}), ...(image ? { iconImage: image } : {}), ...(partList.length ? { parts: partList } : {}), ...(color ? { color } : {}) });
    });
  }
  m.open();
  ctx.trackModal(m);
  setTimeout(() => title.focus(), 0);

}
