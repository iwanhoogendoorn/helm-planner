// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { AbstractInputSuggest, Menu, Modal, Notice } from '../stubs/obsidian';
import { setup, TODAY, dailyPath } from '../data/fixture';
import type { UiContext, TabId } from '../../src/ui/context';
import { renderToday } from '../../src/ui/tabs/today';
import { renderWeek } from '../../src/ui/tabs/week';
import { renderProjects } from '../../src/ui/tabs/projects';
import { renderInbox } from '../../src/ui/tabs/inbox';
import { renderReview } from '../../src/ui/tabs/review';
import { openCapture } from '../../src/ui/modals/capture';
import { openPlanDay } from '../../src/ui/modals/planDay';
import { openWrapUp } from '../../src/ui/modals/wrapUp';
import { openTaskEditor } from '../../src/ui/modals/taskEditor';
import { openSearch } from '../../src/ui/modals/search';
import { taskMenu } from '../../src/ui/menus';
import { taskRow } from '../../src/ui/taskRow';
import { openProjectForm, parsePhases } from '../../src/ui/modals/projectForm';
import { openHabitForm } from '../../src/ui/modals/habitForm';
import { effortField, linkTimes } from '../../src/ui/fields';
import { renderHorizons } from '../../src/ui/tabs/horizons';
import { renderDashboard, defaultDashboardState } from '../../src/ui/tabs/dashboard';
import { renderCalendar, type CalendarState } from '../../src/ui/tabs/calendar';

async function ctxFor() {
  const s = await setup();
  const nav: { tab: TabId; opts?: unknown }[] = [];
  const opened: string[] = [];
  const ctx: UiContext = {
    app: { vault: { adapter: { exists: async () => true } } } as never,
    index: s.index,
    mutations: s.m,
    settings: () => s.settings,
    saveSettings: async () => undefined,
    today: () => TODAY,
    now: () => '14:37',
    notify: (m) => { new Notice(m); },
    openFile: async (p) => { opened.push(p); },
    openLink: () => undefined,
    refresh: () => undefined,
    navigate: (tab, opts) => { nav.push({ tab, opts }); },
    run: async (_l, fn) => { await fn(); },
    trackModal: () => undefined,
    resourceUrl: (p) => `app://${p}`,
  };
  return { ...s, ctx, nav, opened };
}

const render = (fn: (root: HTMLElement) => void): HTMLElement => { const root = document.createElement('div'); fn(root); document.body.appendChild(root); return root; };
const texts = (root: HTMLElement, sel: string): string[] => [...root.querySelectorAll<HTMLElement>(sel)].map((e) => e.textContent?.trim() ?? '');
const click = (el: Element | null | undefined): void => { if (!el) throw new Error('element missing'); el.dispatchEvent(new MouseEvent('click', { bubbles: true })); };
const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
/** Wait for something the UI does asynchronously (a FileReader, a chain of awaits) instead of guessing at flushes. */
const waitFor = async <T>(get: () => T | null | undefined, what = 'condition', tries = 200): Promise<T> => {
  for (let i = 0; i < tries; i++) { const v = get(); if (v !== null && v !== undefined && v !== false) return v as T; await flush(); }
  throw new Error(`waitFor: ${what} never happened`);
};

beforeEach(() => { document.body.innerHTML = ''; Notice.messages = []; Modal.last = undefined; Menu.last = undefined; });

describe('Today tab', () => {
  it('renders yesterday: time blocks, tasks, mirrors, habits, done', async () => {
    const { ctx } = await ctxFor();
    const root = render((r) => renderToday(ctx, r, { date: '2026-08-25', collapsed: new Map() }));
    expect(root.querySelector('.helm-day-title-main')!.textContent).toBe('Yesterday');
    expect(texts(root, '.helm-section-title')).toEqual(['Habits', 'Morning', 'Afternoon', 'Anytime']); // no Done section: finished tasks ghost inside their part
    expect(texts(root, '.helm-section:nth-of-type(2) .helm-task-text')).toEqual(['Start with OIB']);
    expect(texts(root, '.helm-section:nth-of-type(3) .helm-task-text')).toEqual(['Fix router config', 'Pay invoice']); // open first, then the ghost
    const ghost = root.querySelector('.helm-ghost')!;
    expect(ghost.querySelector('.helm-task-text')!.textContent).toBe('Pay invoice');
    const ghostSection = ghost.closest('.helm-section')!;
    expect(ghostSection.querySelector('.helm-chip.done')!.textContent).toBe('1 done');
    expect(ghostSection.querySelector('.helm-dropzone-hint')).toBeNull();
    expect(root.querySelector('.helm-habit-card.is-day-done')!.textContent).toContain('Morning workout');
    expect(root.querySelector('.helm-capacity-label')!.textContent).toContain('3 open · 1 done');
  });

  it('keeps late work in Needs attention on every day until it is planned forward or finished', async () => {
    const { ctx, m, index } = await ctxFor();
    const reasons = (date: string): string[] => {
      const root = render((r) => renderToday(ctx, r, { date, collapsed: new Map() }));
      const sec = [...root.querySelectorAll<HTMLElement>('.helm-section')].find((s) => s.querySelector('.helm-section-title')?.textContent === 'Needs attention');
      return sec ? texts(sec, '.helm-chip.reason') : [];
    };
    for (const d of [TODAY, '2026-09-06', '2026-09-07', '2026-09-28']) {
      expect(reasons(d), `on ${d}`).toEqual(expect.arrayContaining(['overdue', 'carried over'])); // however far out you look
    }
    expect(reasons('2026-08-25')).toEqual([]); // a past day is a record, not a to-do list
    // Planning one of them onto a day from today onwards is what takes it off the list.
    const late = [...index.snapshot.tasks.values()].find((t) => t.text === 'Renew passport')!;
    await m.schedule(late.key, '2026-09-28');
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const sec = [...root.querySelectorAll<HTMLElement>('.helm-section')].find((s) => s.querySelector('.helm-section-title')?.textContent === 'Needs attention')!;
    expect(texts(sec, '.helm-task-text')).not.toContain('Renew passport');
  });

  it('renders today with attention items and an empty plan call-to-action', async () => {
    const { ctx } = await ctxFor();
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    expect(root.querySelector('.helm-day-title-main')!.textContent).toBe('Today');
    expect(texts(root, '.helm-section-title')[0]).toBe('Needs attention');
    expect(texts(root, '.is-attention .helm-chip.reason')).toContain('overdue');
    expect(root.querySelector('.helm-empty')!.textContent).toContain('Nothing planned yet');
  });

  it('ticking a checkbox writes the file; pulling an item schedules it', async () => {
    const { ctx, vault } = await ctxFor();
    const root = render((r) => renderToday(ctx, r, { date: '2026-08-25', collapsed: new Map() }));
    const row = [...root.querySelectorAll('.helm-task')].find((r) => r.textContent?.includes('Fix router config'))!;
    click(row.querySelector('.helm-check'));
    await flush();
    expect(await vault.read(dailyPath('2026-08-25'))).toContain('- [x] Fix router config ⏱️ 30m ✅ 2026-08-25');
    const root2 = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const pull = [...root2.querySelectorAll('.helm-task')].find((r) => r.textContent?.includes('Renew passport'))!.querySelector('.helm-task-actions button');
    click(pull);
    await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('- [ ] Renew passport');
  });

  it('habit chip toggles', async () => {
    const { ctx, vault } = await ctxFor();
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    click([...root.querySelectorAll('.helm-habit-card')].find((e) => e.textContent?.includes('Evening'))!.querySelector('.helm-habit-tick'));
    await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('- [x] Evening reading 🆔 hab-read ✅ 2026-08-26');
  });
});

describe('Week tab', () => {
  it('renders seven days with the right content and a drop handler', async () => {
    const { ctx, vault } = await ctxFor();
    const root = render((r) => renderWeek(ctx, r, { anchor: TODAY, collapsed: new Map() }));
    expect(root.querySelectorAll('.helm-week-day')).toHaveLength(7);
    expect(root.querySelector('.helm-day-title-main')!.textContent).toBe('Week 35');
    expect(root.querySelector('.helm-week-day.is-today .helm-week-dom')!.textContent).toBe('26');
    expect(texts(root, '.helm-week-day:nth-child(2) .helm-task-text')).toEqual(['Start with OIB', 'Fix router config', 'Chapter 1']); // morning · afternoon · anytime
    expect(texts(root, '.helm-week-side .helm-section-title')).toEqual(['Overdue']);
    // Drop tsk-0001 on Friday.
    const fri = root.querySelectorAll('.helm-week-day')[4]!;
    const dt = { types: ['text/helm-task'], getData: (k: string) => (k === 'text/helm-task' ? 'tsk-0001' : '') };
    const ev = new Event('drop', { bubbles: true, cancelable: true }) as Event & { dataTransfer: unknown };
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    fri.dispatchEvent(ev);
    await flush();
    expect(await vault.read(dailyPath('2026-08-28'))).toContain('tsk-0001');
  });
});

describe('Projects tab', () => {
  it('lists projects by status with umbrella nesting and flags', async () => {
    const { ctx, nav } = await ctxFor();
    const state = { filter: '', showClosed: false, collapsed: new Map(), showDone: false };
    const root = render((r) => renderProjects(ctx, r, state));
    expect(texts(root, '.helm-section-title')).toEqual(['Active', 'Planned']);
    expect(texts(root, '.helm-section:nth-of-type(1) .helm-project-title')).toEqual(['Oracle Book Writing', 'Oracle', 'OCI Certification']);
    expect(root.querySelector('.helm-project.depth-1 .helm-project-title')!.textContent).toBe('OCI Certification');
    expect(texts(root, '.helm-chip.flag')).toContain('overdue tasks');
    click(root.querySelector('.helm-project'));
    expect(nav[0]).toEqual({ tab: 'projects', opts: { projectId: 'prj-book' } });
  });

  it('project detail shows phases, tasks, quick add', async () => {
    const { ctx, vault } = await ctxFor();
    const state = { projectId: 'prj-book', filter: '', showClosed: false, collapsed: new Map(), showDone: false };
    const root = render((r) => renderProjects(ctx, r, state));
    expect(root.querySelector('h2')!.textContent).toBe('Oracle Book Writing');
    expect(texts(root, '.helm-section-title')).toEqual(['Outline', 'Writing', 'Other tasks', 'Notes', 'Links', 'Diagrams']);
    expect(texts(root, '.helm-section:nth-of-type(1) .helm-task-text')).toEqual(['Draft chapter list', 'Collect diagrams', 'Review with editor']);
    const input = root.querySelector<HTMLInputElement>('.helm-section:nth-of-type(2) .helm-quickadd-input')!;
    input.value = 'Chapter 3 tomorrow !high';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    const src = await vault.read('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md');
    expect(src).toMatch(/- \[ \] Chapter 3 🆔 tsk-\w+ ⏳ 2026-08-27 ⏫\n\n## Tasks/);
    expect(await vault.read(dailyPath('2026-08-27'))).toContain('Chapter 3');
  });
});

describe('Inbox tab', () => {
  it('captures and triages', async () => {
    const { ctx, vault } = await ctxFor();
    const root = render((r) => renderInbox(ctx, r, { collapsed: new Map() }));
    expect(texts(root, '.helm-section-title')).toEqual(['Inbox', 'Tasks in other notes', 'Backlog Tasks', 'Project tasks with no date']);
    const input = root.querySelector<HTMLInputElement>('.helm-capture-input')!;
    input.value = 'Buy milk !! ~10m';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(await vault.read('01 INBOX/Inbox.md')).toContain('- [ ] Buy milk 🔼 ⏱️ 10m');
    const row = [...root.querySelectorAll('.helm-task')].find((r) => r.textContent?.includes('Call the plumber'))!;
    click(row.querySelector('.helm-task-actions button'));
    await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('- [ ] Call the plumber');
  });
});

describe('Review tab', () => {
  it('renders stats, checklist, attention, habits', async () => {
    const { ctx } = await ctxFor();
    const root = render((r) => renderReview(ctx, r, { collapsed: new Map(), checks: new Set() }));
    expect(texts(root, '.helm-stat-value')).toEqual(['1', '2', '2', '3', '2', '0']);
    expect(texts(root, '.helm-section-title')).toEqual(['Review checklist', 'Goals in play', 'Projects needing attention', 'Overdue', 'Due in the next 14 days', 'Habits', 'Completed this week']);
    expect(root.querySelectorAll('.helm-heat-cell')).toHaveLength(84 * 2);
    expect(root.querySelectorAll('.helm-spark-bar')).toHaveLength(8);
  });
});

describe('Modals', () => {
  it('search: starting points, grouped hits, keyboard, and acting on a result without leaving', async () => {
    const { ctx, nav, opened, vault } = await ctxFor();
    await ctx.mutations.schedule('tsk-0001', TODAY);
    openSearch(ctx, '');
    const m = Modal.last!;
    const input = m.contentEl.querySelector<HTMLInputElement>('.helm-search-input')!;
    // Nothing typed: what is late, what is on today, what was touched last.
    expect(texts(m.contentEl, '.helm-search-group').map((x) => x.replace(/\d+$/, ''))).toEqual(['Overdue', 'Today']);
    expect(texts(m.contentEl, '.helm-search-row .helm-search-title')).toContain('Draft chapter list'); // the one planned for today
    expect(m.contentEl.querySelector('.helm-search-summary')!.textContent).toContain('Where you left off');
    // Typing searches; hits are grouped by kind, best first.
    input.value = 'chapter'; input.dispatchEvent(new Event('input'));
    expect(texts(m.contentEl, '.helm-search-group')).toEqual(['Tasks3', 'Create']);
    expect(texts(m.contentEl, '.helm-search-row .helm-search-title')).toEqual(['Chapter 1', 'Chapter 2', 'Draft chapter list', 'Capture “chapter”…']);
    expect(m.contentEl.querySelectorAll('.helm-search-row')[0]!.classList.contains('is-selected')).toBe(true);
    // A filter chip toggles its token in and out of the query.
    click([...m.contentEl.querySelectorAll('.helm-search-chips button')].find((b) => b.textContent === 'Open'));
    expect(input.value).toBe('chapter is:open');
    expect(texts(m.contentEl, '.helm-search-chips button')).toContain('In daily notes');
    expect(m.contentEl.querySelector('.helm-search-chips .is-active')!.textContent).toBe('Open');
    click([...m.contentEl.querySelectorAll('.helm-search-chips button')].find((b) => b.textContent === 'Open'));
    expect(input.value).toBe('chapter');
    // Ticking a task off the list writes to the note and the list stays open.
    click(m.contentEl.querySelectorAll('.helm-search-row')[0]!.querySelector('.helm-check'));
    await flush(); await flush();
    expect(await vault.read('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')).toMatch(/- \[x\] Chapter 1/);
    expect(Modal.last).toBe(m);
    // Arrows then Enter open the third hit's note at its line.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(opened.at(-1)).toBe('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md');
    // ⌘Enter opens the row's action menu instead of the note.
    openSearch(ctx, 'chapter');
    const m2 = Modal.last!;
    m2.contentEl.querySelector('.helm-search-input')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true }));
    expect(Menu.last!.items.map((i) => i.title)).toContain('Follow up…');
    // A project hit navigates to its tab; the group header narrows the query.
    openSearch(ctx, 'kitchen');
    const m3 = Modal.last!;
    click([...m3.contentEl.querySelectorAll('.helm-search-group')].find((g) => g.textContent?.startsWith('Projects')));
    expect(m3.contentEl.querySelector<HTMLInputElement>('.helm-search-input')!.value).toBe('kitchen kind:project');
    click([...m3.contentEl.querySelectorAll('.helm-search-row')].find((r) => r.querySelector('.helm-search-title')?.textContent === 'Kitchen Remodel'));
    expect(nav.at(-1)).toEqual({ tab: 'projects', opts: { projectId: 'prj-kitchen' } });
    // Nothing matching still offers to capture the words.
    openSearch(ctx, 'zzzznothing');
    const m4 = Modal.last!;
    expect(texts(m4.contentEl, '.helm-search-row .helm-search-title')).toEqual(['Capture “zzzznothing”…']);
    click(m4.contentEl.querySelector('.helm-search-row'));
    expect(Modal.last!.titleEl.textContent).toBe('Capture');
    expect(Modal.last!.contentEl.querySelector<HTMLInputElement>('input')!.value).toBe('zzzznothing');
  });

  it('task editor: a link added in the Links section shows at once, lands in the Text field and is written on Save', async () => {
    const { ctx, index, vault } = await ctxFor();
    await ctx.mutations.addTask({ text: 'Chase UC3', date: TODAY, part: 'morning' });
    const t = [...index.snapshot.tasks.values()].find((x) => x.text === 'Chase UC3')!;
    openTaskEditor(ctx, t);
    const ed = Modal.last!;
    const textInput = ed.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(ed.contentEl.querySelector('.helm-attach-section')!.textContent).toContain('No links yet.');
    click([...ed.contentEl.querySelectorAll('.helm-attach-section button')].find((b) => b.textContent?.includes('Add link')));
    const dlg = Modal.last!;
    const inputs = dlg.contentEl.querySelectorAll<HTMLInputElement>('input');
    inputs[0]!.value = 'http://www.iwanhoogendoorn.nl'; inputs[1]!.value = 'My website';
    click([...dlg.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Add'));
    expect(texts(ed.contentEl, '.helm-attach-row a')).toEqual(['My website']); // immediately, no save needed
    expect(textInput.value).toBe('Chase UC3'); // the Text field never shows raw links
    expect((await vault.read(dailyPath(TODAY)))).not.toContain('iwanhoogendoorn'); // nothing written yet
    click(ed.contentEl.querySelector('.helm-attach-row button[aria-label="Remove this link"]'));
    expect(ed.contentEl.querySelector('.helm-attach-section')!.textContent).toContain('No links yet.');
    click([...ed.contentEl.querySelectorAll('.helm-attach-section button')].find((b) => b.textContent?.includes('Add link')));
    const d2 = Modal.last!.contentEl.querySelectorAll<HTMLInputElement>('input');
    d2[0]!.value = 'https://jira.example.com/browse/RSC-1';
    click([...Modal.last!.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Add'));
    click([...ed.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Save'));
    await flush(); await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('Chase UC3 [jira.example.com/browse/RSC-1](https://jira.example.com/browse/RSC-1)');
    // Reopening: clean text, the link listed; editing the text keeps the link on the line.
    const t2 = [...index.snapshot.tasks.values()].find((x) => x.text.startsWith('Chase UC3'))!;
    openTaskEditor(ctx, t2);
    const ed2 = Modal.last!;
    const ti2 = ed2.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(ti2.value).toBe('Chase UC3');
    expect(texts(ed2.contentEl, '.helm-attach-row a')).toEqual(['jira.example.com/browse/RSC-1']);
    ti2.value = 'Chase UC3 again';
    click([...ed2.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Save'));
    await flush(); await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('Chase UC3 again [jira.example.com/browse/RSC-1](https://jira.example.com/browse/RSC-1)');
  });

  it('task links: bare URLs render as labelled anchors; the menu opens, adds and removes links; the row shows a pill', async () => {
    const { ctx, index, vault } = await ctxFor();
    await ctx.mutations.addTask({ text: 'Chase UC3 https://jira.example.com/browse/RSC-1', date: TODAY, part: 'morning' });
    let t = [...index.snapshot.tasks.values()].find((x) => x.text.startsWith('Chase UC3'))!;
    let root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const row = () => [...root.querySelectorAll<HTMLElement>('.helm-task')].find((r) => r.textContent?.includes('Chase UC3'))!;
    expect(row().querySelector('.helm-task-text')!.textContent).toBe('Chase UC3'); // the URL is not in the text …
    const a = row().querySelector<HTMLAnchorElement>('.helm-task-meta a.helm-chip.link')!; // … it is a pill under it
    expect(a.textContent).toBe('jira.example.com/browse/RSC-1');
    expect(a.getAttribute('href')).toBe('https://jira.example.com/browse/RSC-1');
    expect(row().querySelector('.helm-task-links .helm-badge')!.textContent).toBe('1');
    click(row().querySelector('button[aria-label="More…"]'));
    const links = Menu.last!.items.find((i) => i.title === 'Links')!;
    expect(links.sub!.items.map((i) => i.title)).toEqual(['jira.example.com/browse/RSC-1', 'Add link…', 'Remove link']);
    links.sub!.items[1]!.click!();
    const dlg = Modal.last!;
    expect(dlg.titleEl.textContent).toBe('Add link');
    const inputs = dlg.contentEl.querySelectorAll<HTMLInputElement>('input');
    // Deliberately the wrong way round: the label in the URL box and the address in the label box.
    inputs[0]!.value = 'NAT docs'; inputs[0]!.dispatchEvent(new Event('input'));
    inputs[1]!.value = 'https://docs.example.com/nat'; inputs[1]!.dispatchEvent(new Event('input'));
    expect(dlg.contentEl.querySelector('.helm-path-preview')!.textContent).toBe('[NAT docs](https://docs.example.com/nat)');
    click([...dlg.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Add'));
    await flush(); await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('Chase UC3 https://jira.example.com/browse/RSC-1 [NAT docs](https://docs.example.com/nat)');
    t = [...index.snapshot.tasks.values()].find((x) => x.text.startsWith('Chase UC3'))!;
    root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    expect(row().querySelector('.helm-task-links .helm-badge')!.textContent).toBe('2');
    expect(texts(row(), '.helm-task-meta a.helm-chip.link')).toEqual(['NAT docs', 'jira.example.com/browse/RSC-1']);
    expect(row().querySelector('.helm-task-text')!.textContent).toBe('Chase UC3');
    click(row().querySelector('button[aria-label="More…"]'));
    const rm = Menu.last!.items.find((i) => i.title === 'Links')!.sub!.items.find((i) => i.title === 'Remove link')!;
    expect(rm.sub!.items.map((i) => i.title)).toEqual(['NAT docs', 'jira.example.com/browse/RSC-1']);
    rm.sub!.items[1]!.click!();
    await flush(); await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('Chase UC3 [NAT docs](https://docs.example.com/nat)');
    expect(await vault.read(dailyPath(TODAY))).not.toContain('jira.example.com');
    void t;
  });

  it('capture has quick tag toggles that add and remove the tag in the text', async () => {
    const { ctx } = await ctxFor();
    openCapture(ctx);
    const m = Modal.last!;
    const input = m.contentEl.querySelector<HTMLInputElement>('input')!;
    input.value = 'Sync with Bob'; input.dispatchEvent(new Event('input'));
    expect(texts(m.contentEl, '.helm-tag-toggle')).toEqual(['#meeting', '#followup', '#task']);
    click([...m.contentEl.querySelectorAll('.helm-tag-toggle')].find((b) => b.textContent === '#meeting'));
    expect(input.value).toBe('#meeting Sync with Bob');
    expect(m.contentEl.querySelector('.helm-tag-toggle.is-active')!.textContent).toBe('#meeting');
    expect(texts(m.contentEl, '.helm-capture-preview .helm-chip.tag, .helm-chip.tag')).toContain('#meeting');
    click([...m.contentEl.querySelectorAll('.helm-tag-toggle')].find((b) => b.textContent === '#task'));
    expect(input.value).toBe('#task #meeting Sync with Bob');
    click([...m.contentEl.querySelectorAll('.helm-tag-toggle')].find((b) => b.textContent === '#meeting'));
    expect(input.value).toBe('#task Sync with Bob');
    input.value = 'Plan #Meeting-Room booking #meeting'; input.dispatchEvent(new Event('input')); // typed tag lights up; #Meeting-Room does not count
    expect(texts(m.contentEl, '.helm-tag-toggle.is-active')).toEqual(['#meeting']);
  });

  it('capture previews and writes', async () => {
    const { ctx, vault } = await ctxFor();
    openCapture(ctx);
    const m = Modal.last!;
    const input = m.contentEl.querySelector<HTMLInputElement>('input')!;
    input.value = 'Call the plumber tomorrow !high @Kitchen Remodel ~30m';
    input.dispatchEvent(new Event('input'));
    expect(m.contentEl.querySelector('.helm-capture-where')!.textContent).toContain('project “Kitchen Remodel”');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush();
    await flush();
    const k = await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md');
    expect(k).toMatch(/- \[ \] Call the plumber 🆔 tsk-\w+ ⏳ 2026-08-27 ⏫ ⏱️ 30m/);
    expect(await vault.read(dailyPath('2026-08-27'))).toContain('Call the plumber');
  });

  it('plan day picks candidates and writes the note', async () => {
    const { ctx, vault } = await ctxFor();
    openPlanDay(ctx, TODAY);
    const m = Modal.last!;
    const items = [...m.contentEl.querySelectorAll('.helm-plan-left .helm-plan-item')];
    expect(items.length).toBeGreaterThan(3);
    click(items.find((i) => i.textContent?.includes('Draft chapter list')));
    click(items.find((i) => i.textContent?.includes('Call the plumber')));
    expect(m.contentEl.querySelector('.helm-plan-right')!.textContent).toContain('Adding (2)');
    click([...m.contentEl.querySelectorAll('button')].find((b) => b.textContent?.includes('Write plan')));
    await flush();
    await flush();
    const daily = await vault.read(dailyPath(TODAY));
    expect(daily).toContain('### Habits');
    expect(daily).toContain('- [ ] Call the plumber');
    expect(daily).toContain('### Anytime');
    expect(daily).toContain('- [ ] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]]');
  });

  it('wrap up moves open items to tomorrow', async () => {
    const { ctx, vault } = await ctxFor();
    await ctx.mutations.schedule('tsk-0001', TODAY);
    await ctx.mutations.addTask({ text: 'Loose end', date: TODAY });
    openWrapUp(ctx, TODAY);
    const m = Modal.last!;
    expect(m.contentEl.querySelectorAll('.helm-wrapup-row')).toHaveLength(2); // mirror + loose end; planner slots excluded
    click([...m.contentEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Apply'));
    await flush();
    await flush();
    const tomorrow = await vault.read(dailyPath('2026-08-27'));
    expect(tomorrow).toContain('- [ ] Loose end');
    expect(tomorrow).toContain('tsk-0001');
    expect(await vault.read(dailyPath(TODAY))).not.toContain('tsk-0001');
  });

  it('task editor saves fields', async () => {
    const { ctx, vault, index } = await ctxFor();
    openTaskEditor(ctx, index.task('tsk-0001')!);
    const m = Modal.last!;
    const [text] = m.contentEl.querySelectorAll<HTMLInputElement>('input[type="text"]');
    text!.value = 'Draft the list';
    const due = m.contentEl.querySelectorAll<HTMLInputElement>('input[type="date"]')[1]!;
    due.value = '2026-09-10';
    click([...m.contentEl.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Save'));
    await flush();
    await flush();
    expect(await vault.read('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')).toContain('- [ ] Draft the list 🆔 tsk-0001 📅 2026-09-10 ⏫');
  });

  it('context menu carries schedule and status items', async () => {
    const { ctx, index } = await ctxFor();
    const row = taskRow(ctx, index.task('tsk-0001')!);
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    const titles = Menu.last!.items.map((i) => i.title);
    expect(titles).toContain('Today');
    expect(titles).toContain('Move to project…');
    expect(Menu.last!.items.find((i) => i.title === 'Status')!.sub!.items.map((i) => i.title)).toContain('Waiting on someone');
  });

  it('parses the phases textarea', () => {
    expect(parsePhases('Phase: Design 📅 2026-09-30\n- Sketch\n- [ ] Tiles\nPhase: Build\nDemolition\n')).toEqual({ phases: [{ title: 'Design', due: '2026-09-30', tasks: ['Sketch', 'Tiles'] }, { title: 'Build', tasks: ['Demolition'] }], tasks: [] });
    expect(parsePhases('- Loose one')).toEqual({ phases: [], tasks: ['Loose one'] });
  });
});

describe('Horizons tab', () => {
  const YEARLY = '---\ntitle: 2026\n---\n# 2026\n\n## Goals\n\n- [ ] Publish the book 🆔 gol-book26\n';
  it('renders year, quarters, months; selecting a quarter shows its goals and projects; adding a goal writes the note', async () => {
    const base = await setup();
    const book = base.vault.files.get('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')!.replace('---\n\n# ', 'period: 2026-Q3\ngoal: gol-book26\n---\n\n# ');
    const s = await setup({ 'Yearly Notes/2026.md': YEARLY, '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md': book });
    const ctx: UiContext = { ...(await ctxFor()).ctx, index: s.index, mutations: s.m };
    const state = { year: 2026, collapsed: new Map(), selected: undefined as string | undefined };
    const root = render((r) => renderHorizons(ctx, r, state));
    expect(root.querySelectorAll('.helm-horizon.kind-quarter')).toHaveLength(4);
    expect(root.querySelectorAll('.helm-horizon.kind-month')).toHaveLength(12);
    expect(root.querySelector('.helm-horizon.kind-year .helm-horizon-goal-text')!.textContent).toBe('Publish the book');
    expect(root.querySelector('.helm-horizon.kind-quarter.is-current .helm-horizon-label')!.textContent).toBe('Q3 2026');
    click(root.querySelectorAll('.helm-horizon.kind-quarter')[2]);
    expect(state.selected).toBe('2026-Q3');
    const root2 = render((r) => renderHorizons(ctx, r, state));
    expect(root2.querySelector('.helm-horizon-detail h2')!.textContent).toBe('Q3 2026');
    expect(texts(root2, '.helm-horizon-detail .helm-project-title')).toEqual(['Oracle Book Writing']);
    const input = root2.querySelector<HTMLInputElement>('.helm-horizon-detail .helm-quickadd-input')!;
    input.value = 'Finish chapters 4-6';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    expect(await s.vault.read('Quarterly Notes/2026-Q3.md')).toMatch(/## Goals\n\n- \[ \] Finish chapters 4-6 🆔 gol-\w+/);
    // Year goal shows the linked project's progress.
    state.selected = '2026';
    const root3 = render((r) => renderHorizons(ctx, r, state));
    expect(root3.querySelector('.helm-horizon-detail .helm-goal-progress .helm-hint')!.textContent).toBe('2/7 tasks · 29%');
    expect(texts(root3, '.helm-horizon-detail .helm-goal .helm-chip.project')).toEqual(['Oracle Book Writing']);
  });

  it('project detail offers horizon and goal selects', async () => {
    const s = await setup({ 'Yearly Notes/2026.md': YEARLY });
    const ctx: UiContext = { ...(await ctxFor()).ctx, index: s.index, mutations: s.m };
    const state = { projectId: 'prj-book', filter: '', showClosed: false, collapsed: new Map(), showDone: false };
    const root = render((r) => renderProjects(ctx, r, state));
    const selects = root.querySelectorAll<HTMLSelectElement>('.helm-horizon-controls select');
    expect(selects).toHaveLength(2);
    selects[0]!.value = '2026-Q4';
    selects[0]!.dispatchEvent(new Event('change'));
    await flush();
    expect(s.index.project('prj-book')!.period).toBe('2026-Q4');
    selects[1]!.value = 'gol-book26';
    selects[1]!.dispatchEvent(new Event('change'));
    await flush();
    expect(s.index.project('prj-book')!.goalId).toBe('gol-book26');
  });
});

describe('Dashboard tab', () => {
  it('opens on this week and on daily-note tasks, with pills to add the other places tasks live', async () => {
    const { ctx } = await ctxFor();
    const state = defaultDashboardState();
    expect([state.preset, state.sources]).toEqual(['week', ['daily']]);
    let root = render((r) => renderDashboard(ctx, r, state));
    expect(texts(root, '.helm-crumb')).toEqual(['Dashboard', 'This week']);
    expect(texts(root, '.helm-source-pills button')).toEqual(['Daily notes', 'Project notes', 'Tasks in other notes', 'Inbox']);
    expect(texts(root, '.helm-source-pills .is-active')).toEqual(['Daily notes']);
    click([...root.querySelectorAll('.helm-source-pills button')].find((b) => b.textContent === 'Project notes'));
    expect(state.sources).toEqual(['daily', 'project']);
    root = render((r) => renderDashboard(ctx, r, state));
    expect(texts(root, '.helm-source-pills .is-active')).toEqual(['Daily notes', 'Project notes']);
    click([...root.querySelectorAll('.helm-source-pills button')].find((b) => b.textContent === 'Daily notes'));
    expect(state.sources).toEqual(['project']); // daily notes can be switched off …
    root = render((r) => renderDashboard(ctx, r, state));
    click([...root.querySelectorAll('.helm-source-pills button')].find((b) => b.textContent === 'Project notes'));
    expect(state.sources).toEqual(['project']); // … but the last one on stays on
  });

  it('renders KPIs, charts, projects table and drills into a bar', async () => {
    const { ctx, vault } = await ctxFor();
    void vault;
    const state = defaultDashboardState();
    const root = render((r) => renderDashboard(ctx, r, state));
    expect(root.querySelectorAll('.helm-stat')).toHaveLength(8);
    expect(root.querySelectorAll('svg.helm-chart').length).toBeGreaterThanOrEqual(6);
    expect(texts(root, '.helm-table tbody tr td:first-child')).toContain('Oracle Book Writing');
    click([...root.querySelectorAll('.helm-bar-group')].find((g) => g.querySelector('title')?.textContent?.includes('Yesterday')));
    const m = Modal.last!;
    expect(m.titleEl.textContent).toBe('Done on Yesterday');
    expect(texts(m.contentEl, '.helm-task-text')).toEqual(['Pay invoice']);
    expect(m.contentEl.querySelector('.helm-drilldown-summary')!.textContent).toContain('1 task');
  });

  it('shows an empty habit tracker with a New habit button when the vault has no habits', async () => {
    const { ctx, vault, index } = await ctxFor();
    for (const p of [...index.snapshot.habits.values()].map((x) => x.path)) { await vault.delete(p); index.update(p, undefined); }
    index.snapshot.completions.length = 0; // no ticks left either — otherwise the removed habits would still show
    const root = render((r) => renderDashboard(ctx, r, defaultDashboardState()));
    const tracker = [...root.querySelectorAll('.helm-section')].find((x) => x.querySelector('.helm-section-title')?.textContent === 'Habit tracker')!;
    expect(tracker.textContent).toContain('No habits yet');
    click([...tracker.querySelectorAll('button')].find((b) => b.textContent?.includes('New habit')));
    expect(Modal.last!.titleEl.textContent).toBe('New habit');
  });

  it('has an all-time habit tracker with week / month / quarter / year columns, rate cells and totals', async () => {
    const { ctx, index } = await ctxFor();
    const state = defaultDashboardState();
    let root = render((r) => renderDashboard(ctx, r, state));
    const tracker = () => [...root.querySelectorAll('.helm-section')].find((x) => x.querySelector('.helm-section-title')?.textContent === 'Habit tracker')!;
    expect(tracker()).toBeTruthy();
    expect(texts(tracker() as HTMLElement, '.helm-habit-scope .helm-seg')).toEqual(['Week', 'Month', 'Quarter', 'Year']);
    expect(texts(tracker() as HTMLElement, 'thead .helm-hgrid-col')).toContain('Aug');
    expect(texts(tracker() as HTMLElement, '.helm-hgrid-title')).toEqual(['Evening reading', 'Morning workout']);
    const cell = [...tracker().querySelectorAll('.helm-hgrid-val')].find((b) => b.getAttribute('title')?.includes('Morning workout'))!;
    expect(cell.getAttribute('title')).toMatch(/August 2026 · Morning workout: 1\/\d+ done/);
    click([...tracker().querySelectorAll('.helm-seg')].find((b) => b.textContent === 'Week'));
    expect(state.habitScope).toBe('week');
    root = render((r) => renderDashboard(ctx, r, state));
    expect(texts(tracker() as HTMLElement, 'thead .helm-hgrid-col')).toContain('W35');
    expect(texts(tracker() as HTMLElement, '.helm-hgrid-years th').filter(Boolean)).toEqual(['2026']);
    // A habit whose note is gone still shows, rebuilt from its ticks, marked removed.
    index.snapshot.completions.push({ habitId: 'hab-gone', date: '2026-08-05', path: 'x.md', line: 1, state: 'done', text: '🧘 Meditate 🆔 hab-gone' });
    root = render((r) => renderDashboard(ctx, r, state));
    expect(texts(tracker() as HTMLElement, '.helm-hgrid-title')).toEqual(['Evening reading', 'Morning workout', 'Meditate']);
    expect(tracker().querySelector('tr.is-removed .helm-chip')!.textContent).toBe('removed');
    index.snapshot.completions.pop();
    root = render((r) => renderDashboard(ctx, r, state));
    const navs: unknown[] = [];
    ctx.navigate = (tab, opts) => { navs.push([tab, opts]); };
    click([...tracker().querySelectorAll('.helm-hgrid-val')].find((b) => b.getAttribute('title')?.includes('Week 35')));
    expect(navs).toEqual([['week', { date: '2026-08-24' }]]);
  });

  it('Today tab renders parts with drop zones and moves a task on drop', async () => {
    const { ctx, vault } = await ctxFor();
    await ctx.mutations.schedule('tsk-0001', TODAY, 'morning');
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    expect(texts(root, '.helm-section-title')).toEqual(['Needs attention', 'Habits', 'Morning', 'Afternoon', 'Evening', 'Anytime']);
    // 'Collect diagrams' is a finished subtask: under its parent, and again as a ghost among the morning's done work.
    expect(texts(root, '.helm-section.part-morning .helm-task-text')).toEqual(['Draft chapter list', 'Collect diagrams', 'Collect diagrams']);
    const ghost = [...root.querySelectorAll('.helm-section.part-morning .helm-ghost')].find((r) => r.querySelector('.helm-chip.subtask-of'))!;
    expect(ghost.querySelector('.helm-task-text')!.textContent).toBe('Collect diagrams');
    expect(ghost.querySelector('.helm-chip.subtask-of')!.textContent).toBe('part of Draft chapter list'); // says whose subtask it is
    const evening = root.querySelector('.helm-section.part-evening')!;
    const dt = { types: ['text/helm-task'], getData: (k: string) => (k === 'text/helm-task' ? `tsk-0001@${TODAY}` : '') };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    evening.dispatchEvent(ev);
    await flush();
    expect(await vault.read(dailyPath(TODAY))).toMatch(/### Evening\n- \[ \] Draft chapter list/);
    expect(await vault.read(dailyPath(TODAY))).not.toContain('### Morning');
  });
});

describe('Calendar tab', () => {
  const YEARLY = '---\ntitle: 2026\n---\n# 2026\n\n## Goals\n\n- [ ] Publish the book 🆔 gol-book26\n';
  const MONTHLY = '---\ntitle: 2026-08\n---\n## Goals\n\n- [ ] Finish chapter 5\n';
  async function cal() {
    const base = await setup();
    const book = base.vault.files.get('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')!.replace('---\n\n# ', 'period: 2026-08\ngoal: gol-book26\n---\n\n# ');
    const s = await setup({ 'Yearly Notes/2026.md': YEARLY, 'Monthly Notes/2026-08.md': MONTHLY, '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md': book });
    const c = await ctxFor();
    const ctx: UiContext = { ...c.ctx, index: s.index, mutations: s.m };
    return { ...s, ctx, nav: c.nav };
  }
  it('new task from any scope: + on week / month cells, right-click day menus, New task in the header, month blocks in quarter and year', async () => {
    const { ctx, nav } = await cal();
    // Month: + on a cell opens Capture on that day; right-click gives the day menu.
    let root = render((r) => renderCalendar(ctx, r, { scope: 'month', anchor: TODAY, collapsed: new Map() }));
    const cell = root.querySelector<HTMLElement>('.helm-month-cell[data-date="2026-08-28"]')!;
    click(cell.querySelector('.helm-month-add'));
    expect(Modal.last!.titleEl.textContent).toBe('Capture');
    expect(Modal.last!.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-08-28');
    cell.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(Menu.last!.items.map((i) => i.title)).toEqual(['New task on Fri 28 Aug…', 'Plan this day…', 'Open day', 'Open daily note']);
    Menu.last!.items[2]!.click!();
    expect(nav.at(-1)).toEqual({ tab: 'today', opts: { date: '2026-08-28' } });
    // Yesterday has no Plan entry.
    root.querySelector<HTMLElement>('.helm-month-cell[data-date="2026-08-25"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(Menu.last!.items.map((i) => i.title)).toEqual(['New task on Yesterday…', 'Open day', 'Open daily note']);
    // Header button: New task lands on today when the period holds it.
    click([...root.querySelectorAll('.helm-day-actions button')].find((b) => b.textContent?.includes('New task')));
    expect(Modal.last!.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe(TODAY);
    // Week: + on a day column and right-click on the column.
    root = render((r) => renderCalendar(ctx, r, { scope: 'week', anchor: TODAY, collapsed: new Map() }));
    const col = root.querySelector<HTMLElement>('.helm-week-day[data-date="2026-08-27"]')!;
    click(col.querySelector('button[aria-label^="New task on"]'));
    expect(Modal.last!.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-08-27');
    col.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(Menu.last!.items[0]!.title).toBe('New task on Tomorrow…');
    // Quarter: a mini-month day right-click is a day menu; a month head right-click offers the month.
    root = render((r) => renderCalendar(ctx, r, { scope: 'quarter', anchor: TODAY, collapsed: new Map() }));
    const sept = [...root.querySelectorAll<HTMLElement>('.helm-qmonth')].find((m) => m.textContent?.startsWith('Sep'))!;
    sept.querySelector('.helm-qmonth-head')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(Menu.last!.items.map((i) => i.title)).toEqual(['New task in September 2026 (Tue 1 Sep)…', 'Open month', 'Open note']);
    Menu.last!.items[0]!.click!();
    expect(Modal.last!.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-09-01');
    const miniDays = [...sept.querySelectorAll<HTMLElement>('.helm-mini-day:not(.is-outside)')];
    miniDays[9]!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(Menu.last!.items[0]!.title).toBe('New task on Thu 10 Sep…');
    // Year: the current month's block offers today; a future quarter head offers its first day.
    root = render((r) => renderCalendar(ctx, r, { scope: 'year', anchor: TODAY, collapsed: new Map() }));
    root.querySelector<HTMLElement>('.helm-year-month.is-current')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(Menu.last!.items[0]!.title).toBe('New task in August 2026 (Today)…');
    const q4 = [...root.querySelectorAll<HTMLElement>('.helm-year-quarter-head')].find((x) => x.textContent?.includes('Q4'))!;
    q4.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(Menu.last!.items[0]!.title).toBe('New task in Q4 2026 (Thu 1 Oct)…');
  });

  it('month: grid with week numbers, counts, goals and projects; day click drills to Today; drop plans', async () => {
    const { ctx, nav, vault } = await cal();
    const state: CalendarState = { scope: 'month', anchor: TODAY, collapsed: new Map() };
    const root = render((r) => renderCalendar(ctx, r, state));
    expect(root.querySelector('.helm-day-title-main')!.textContent).toBe('August 2026');
    expect(root.querySelectorAll('.helm-month-row')).toHaveLength(6);
    expect(root.querySelectorAll('.helm-month-cell:not(.is-outside)')).toHaveLength(31);
    const yesterday = root.querySelector('.helm-month-cell[data-date="2026-08-25"]')!;
    expect(yesterday.querySelector('.helm-chip.done-count')!.textContent).toBe('✓1');
    expect(texts(yesterday as HTMLElement, '.helm-month-item')).toEqual(['08:00Start with OIB', 'Chapter 1', 'Fix router config']);
    expect(texts(root, '.helm-section-title')).toEqual(['Goals for August 2026', 'Projects in August 2026']);
    expect(texts(root, '.helm-goal-text')).toEqual(['Finish chapter 5']);
    expect(texts(root, '.helm-project-title')).toEqual(['Oracle Book Writing']);
    click(root.querySelector('.helm-month-cell[data-date="2026-08-28"]'));
    expect(nav.at(-1)).toEqual({ tab: 'today', opts: { date: '2026-08-28' } });
    click(root.querySelectorAll('button.helm-month-wk')[1]);
    expect(nav.at(-1)).toEqual({ tab: 'week', opts: { date: '2026-08-03', scope: 'week' } });
    const dt = { types: ['text/helm-task'], getData: () => 'tsk-0001' };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    root.querySelector('.helm-month-cell[data-date="2026-08-28"]')!.dispatchEvent(ev);
    await flush();
    expect(await vault.read(dailyPath('2026-08-28'))).toContain('tsk-0001');
  });
  it('quarter: three mini months drill to month; year: four quarters drill to quarter', async () => {
    const { ctx, nav } = await cal();
    const q = render((r) => renderCalendar(ctx, r, { scope: 'quarter', anchor: TODAY, collapsed: new Map() }));
    expect(q.querySelector('.helm-day-title-main')!.textContent).toBe('Q3 2026');
    expect(q.querySelectorAll('.helm-qmonth')).toHaveLength(3);
    expect(q.querySelector('.helm-qmonth.is-current .helm-qmonth-title')!.textContent).toBe('August');
    click(q.querySelectorAll('.helm-qmonth-head')[0]);
    expect(nav.at(-1)).toEqual({ tab: 'week', opts: { date: '2026-07-01', scope: 'month' } });
    const y = render((r) => renderCalendar(ctx, r, { scope: 'year', anchor: TODAY, collapsed: new Map() }));
    expect(y.querySelector('.helm-day-title-main')!.textContent).toBe('2026');
    expect(y.querySelectorAll('.helm-year-quarter')).toHaveLength(4);
    expect(y.querySelectorAll('.helm-year-month')).toHaveLength(12);
    expect(texts(y, '.helm-goal-text')).toEqual(['Publish the book']);
    click(y.querySelectorAll('.helm-year-quarter-head')[3]);
    expect(nav.at(-1)).toEqual({ tab: 'week', opts: { date: '2026-10-01', scope: 'quarter' } });
    expect(texts(y, '.helm-crumb')).toEqual(['Calendar', '2026', 'Q3', 'Aug', 'W35']);
  });
  it('week scope renders the grid split into parts of the day, with breadcrumbs', async () => {
    const { ctx, nav } = await cal();
    const w = render((r) => renderCalendar(ctx, r, { scope: 'week', anchor: TODAY, collapsed: new Map() }));
    expect(w.querySelectorAll('.helm-week-day')).toHaveLength(7);
    expect(texts(w, '.helm-crumb')).toEqual(['Calendar', '2026', 'Q3', 'Aug', 'W35']);
    const tue = w.querySelectorAll('.helm-week-day')[1]!;
    expect([...tue.querySelectorAll('.helm-week-part')].map((p) => p.className.match(/part-(\w+)/)![1])).toEqual(['morning', 'afternoon', 'anytime']);
    expect(texts(tue as HTMLElement, '.helm-week-part.part-afternoon .helm-task-text')).toEqual(['Fix router config']);
    click(w.querySelectorAll('.helm-crumb')[2]);
    expect(nav.at(-1)).toEqual({ tab: 'week', opts: { date: TODAY, scope: 'quarter' } });
  });
  it('project detail shows the full umbrella chain as breadcrumbs', async () => {
    const { ctx } = await ctxFor();
    const root = render((r) => renderProjects(ctx, r, { projectId: 'prj-cert', filter: '', showClosed: false, collapsed: new Map(), showDone: false }));
    expect(texts(root, '.helm-crumb')).toEqual(['Projects', 'Oracle', 'OCI Certification']);
    const today = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    expect(texts(today, '.helm-crumb')).toEqual(['Today', '2026', 'Q3', 'Aug', 'W35', 'Today']);
  });
});

describe('effort field and time linking', () => {
  it('start + effort gives the end; start + end gives the effort; grammar fills the dropdown', () => {
    const start = document.createElement('input'); start.type = 'time';
    const end = document.createElement('input'); end.type = 'time';
    const effort = effortField();
    linkTimes(start, end, effort);
    const sel = effort.el.querySelector('select')!;
    sel.value = '45'; sel.dispatchEvent(new Event('change'));
    start.value = '13:00'; start.dispatchEvent(new Event('input'));
    expect(end.value).toBe('13:45');
    end.value = '15:00'; end.dispatchEvent(new Event('input'));
    expect(effort.get()).toBe(120);
    sel.value = 'custom'; sel.dispatchEvent(new Event('change'));
    const custom = effort.el.querySelector<HTMLInputElement>('input')!;
    custom.value = '1h10m'; custom.dispatchEvent(new Event('change'));
    expect(effort.get()).toBe(70);
    expect(end.value).toBe('14:10');
  });

  it('a capture for today defaults to the current hour; a typed time wins', async () => {
    const { ctx, vault } = await ctxFor();
    openCapture(ctx, { date: TODAY });
    const m = Modal.last!;
    const start = m.contentEl.querySelector<HTMLInputElement>('.helm-capture-time input[type="time"]')!;
    expect(start.value).toBe('14:00');
    const input = m.contentEl.querySelector<HTMLInputElement>('.helm-capture-input')!;
    input.value = 'Call back ~30m'; input.dispatchEvent(new Event('input'));
    expect(m.contentEl.querySelectorAll<HTMLInputElement>('.helm-capture-time input[type="time"]')[1]!.value).toBe('14:30');
    input.value = 'Call back 16:15 ~30m'; input.dispatchEvent(new Event('input'));
    expect(start.value).toBe('');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush(); await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('- [ ] 16:15: Call back ⏱️ 30m');
    openCapture(ctx, { date: '2026-08-28' });
    expect(Modal.last!.contentEl.querySelector<HTMLInputElement>('.helm-capture-time input[type="time"]')!.value).toBe('');
  });

  it('capture writes the effort and the end time derived from it', async () => {
    const { ctx, vault } = await ctxFor();
    openCapture(ctx, { date: TODAY });
    const m = Modal.last!;
    const input = m.contentEl.querySelector<HTMLInputElement>('.helm-capture-input')!;
    input.value = 'Deep work ~1h'; input.dispatchEvent(new Event('input'));
    const start = m.contentEl.querySelector<HTMLInputElement>('.helm-capture-time input[type="time"]')!;
    start.value = '09:00'; start.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush(); await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('- [ ] 09:00 - 10:00: Deep work ⏱️ 1h');
  });
});

describe('Project builder modal', () => {
  it('builds phases and tasks by clicking, and writes the project note with task metadata', async () => {
    const { ctx, vault } = await ctxFor();
    openProjectForm(ctx);
    const m = Modal.last!;
    const root = m.contentEl;
    root.querySelector<HTMLInputElement>('input[placeholder="Project name"]')!.value = 'Garden shed';
    // Add a phase, name it, give it a target date, add two tasks via Enter.
    click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Add phase')));
    const phaseName = root.querySelector<HTMLInputElement>('.helm-builder-phase-name')!;
    phaseName.value = 'Design'; phaseName.dispatchEvent(new Event('input'));
    const phaseDue = root.querySelector<HTMLInputElement>('.helm-builder-phase input[type="date"]')!;
    phaseDue.value = '2026-09-30'; phaseDue.dispatchEvent(new Event('change'));
    const addTo = (idx: number, text: string): void => {
      const input = root.querySelectorAll<HTMLInputElement>('.helm-quickadd-input')[idx]!;
      input.value = text; input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    };
    addTo(0, 'Sketch layout due friday !high ~1h');
    addTo(0, 'Order timber next week');
    expect(texts(root, '.helm-builder-task-text')).toEqual(['Sketch layout', 'Order timber']);
    expect(root.querySelector('.helm-builder-task')!.textContent).toContain('1h');
    // Reorder the second task above the first, then add a loose task.
    click(root.querySelectorAll('.helm-builder-task')[1]!.querySelector('button[aria-label="Move up"]'));
    expect(texts(root, '.helm-builder-task-text')).toEqual(['Order timber', 'Sketch layout']);
    addTo(1, 'Get permit');
    click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create project')));
    await flush(); await flush();
    const note = await vault.read('02 PROJECTS/Garden shed/Garden shed.md');
    expect(note).toContain('## Phase: Design 📅 2026-09-30');
    expect(note).toMatch(/- \[ \] Order timber ⏳ 2026-\d{2}-\d{2}/);
    expect(note).toContain('- [ ] Sketch layout 📅 2026-08-28 ⏫ ⏱️ 1h');
    expect(note.indexOf('Order timber')).toBeLessThan(note.indexOf('Sketch layout'));
    expect(note).toMatch(/## Tasks\n+- \[ \] Get permit/);
  });

  it('refuses unnamed phases', async () => {
    const { ctx } = await ctxFor();
    openProjectForm(ctx);
    const root = Modal.last!.contentEl;
    root.querySelector<HTMLInputElement>('input[placeholder="Project name"]')!.value = 'X';
    click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Add phase')));
    click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create project')));
    await flush();
    expect(Notice.messages).toContain('Every phase needs a name.');
  });
});

describe('Habit form modal', () => {
  it('creates a habit from clicks only: emoji, pick-days schedule, target, grace', async () => {
    const { ctx, vault } = await ctxFor();
    openHabitForm(ctx);
    const root = Modal.last!.contentEl;
    root.querySelector<HTMLInputElement>('input[type="text"]')!.value = 'Spanish practice';
    click([...root.querySelectorAll('.helm-emoji')].find((b) => b.textContent === '🇪🇸'));
    expect(root.querySelector('.helm-habit-icon-preview')!.textContent).toBe('🇪🇸');
    click([...root.querySelectorAll('.helm-seg')].find((b) => b.textContent === 'Pick days'));
    const wd = (n: string) => [...root.querySelectorAll('.helm-weekday')].find((b) => b.textContent === n);
    click(wd('Mon')); // default Mon/Wed/Fri → toggles Monday off
    click(wd('Tue'));
    expect(root.textContent).toContain('Understood as: every week on tuesday, wednesday, friday');
    click([...root.querySelectorAll('.helm-seg')].find((b) => b.textContent === '3×'));
    click([...root.querySelectorAll('.helm-seg')].find((b) => b.textContent === '1 day'));
    click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create habit')));
    await flush(); await flush();
    const note = await vault.read('02 PROJECTS/Habits/Spanish practice.md');
    expect(note).toContain('schedule: every week on tuesday, wednesday, friday');
    expect(note).toContain('target_per_week: 3');
    expect(note).toContain('grace_days: 1');
    expect(note).toContain('icon: 🇪🇸');
  });

  it('queues notes and drawings on a new habit and creates / links them once the habit exists', async () => {
    const { ctx, vault, index } = await ctxFor();
    await vault.write('10 PERSONAL/Reading list.md', '# Reading list\n');
    index.update('10 PERSONAL/Reading list.md', await vault.read('10 PERSONAL/Reading list.md'));
    openHabitForm(ctx);
    const form = Modal.last!;
    const root = form.contentEl;
    const nameInput = root.querySelector<HTMLInputElement>('input[type="text"]')!;
    nameInput.value = 'Read daily'; nameInput.dispatchEvent(new Event('input'));
    expect(texts(root, '.helm-pending-actions button')).toEqual(['New note…', 'Link note…', 'New drawing…', 'Link drawing…']);
    // Link an existing note: the picker lists the vault's linkable notes; choosing one queues it.
    click([...root.querySelectorAll('.helm-pending-actions button')].find((b) => b.textContent?.includes('Link note')));
    const picker = Modal.last! as unknown as { getItems: () => { path: string; title: string }[]; onChooseItem: (n: { path: string; title: string }) => void };
    picker.onChooseItem(picker.getItems().find((n) => n.title === 'Reading list')!);
    // A new drawing: the name dialog previews the path with the habit's name; accepting queues it.
    click([...root.querySelectorAll('.helm-pending-actions button')].find((b) => b.textContent?.includes('New drawing')));
    const dlg = Modal.last!;
    expect(dlg.contentEl.querySelector('.helm-path-preview')!.textContent).toBe('Excalidraw/Read daily.excalidraw.md');
    click([...dlg.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Create'));
    expect(texts(root, '.helm-pending')).toEqual(['Reading list×', 'New drawing: Read daily×']);
    // Removing a queued item, then re-adding it, keeps the rest.
    click(root.querySelectorAll('.helm-pending-remove')[0]);
    expect(texts(root, '.helm-pending')).toEqual(['New drawing: Read daily×']);
    click([...root.querySelectorAll('.helm-pending-actions button')].find((b) => b.textContent?.includes('Link note')));
    const picker2 = Modal.last! as unknown as typeof picker;
    picker2.onChooseItem(picker2.getItems().find((n) => n.title === 'Reading list')!);
    click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create habit')));
    await flush(); await flush(); await flush();
    const hb = [...index.snapshot.habits.values()].find((x) => x.title === 'Read daily')!;
    expect(hb).toBeTruthy();
    const target = { kind: 'habit' as const, id: hb.id, title: hb.title };
    expect(index.notesFor(target).map((n) => n.title)).toEqual(['Reading list']);
    expect(index.drawingsFor(target).map((d) => d.title)).toEqual(['Read daily']);
    expect(await vault.read('10 PERSONAL/Reading list.md')).toMatch(new RegExp(`helm-habit: ${hb.id}\\nrelated: "\\[\\[Read daily\\]\\]"`));
    expect(await vault.read('Excalidraw/Read daily.excalidraw.md')).toContain(`helm-habit: ${hb.id}`);
    const note = await vault.read('02 PROJECTS/Habits/Read daily.md');
    expect(note).toContain('- [[Reading list]]');
    expect(note).toContain('![[Read daily.excalidraw]]');
  });

  it('stores an uploaded PNG under the habits icons folder and links it from the note', async () => {
    const { ctx, vault, index } = await ctxFor();
    openHabitForm(ctx);
    const root = Modal.last!.contentEl;
    root.querySelector<HTMLInputElement>('input[type="text"]')!.value = 'Hydrate';
    const file = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'water-drop.png', { type: 'image/png' });
    Object.defineProperty(file, 'files', { value: [png] });
    file.dispatchEvent(new Event('change'));
    await waitFor(() => root.querySelector('.helm-habit-icon-preview img'), 'the icon preview');
    click([...root.querySelectorAll('.helm-seg')].find((b) => b.textContent === 'Every N days'));
    click([...root.querySelectorAll('.helm-seg')].find((b) => b.textContent === '3'));
    click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create habit')));
    await waitFor(() => vault.binaries.size > 0, 'the icon to be written');
    await waitFor(() => vault.files.has('02 PROJECTS/Habits/Hydrate.md'), 'the habit note');
    expect([...vault.binaries.keys()]).toEqual(['02 PROJECTS/Habits/icons/Hydrate.png']);
    const note = await vault.read('02 PROJECTS/Habits/Hydrate.md');
    expect(note).toContain('icon_image: 02 PROJECTS/Habits/icons/Hydrate.png');
    expect(note).toContain('schedule: every 3 days');
    await index.rebuild();
    const hb = index.allHabits().find((x) => x.title === 'Hydrate')!;
    expect(hb.iconImage).toBe('02 PROJECTS/Habits/icons/Hydrate.png');
    // The Today tab shows the image instead of an emoji.
    const today = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const card = [...today.querySelectorAll('.helm-habit-card')].find((c) => c.textContent?.includes('Hydrate'))!;
    expect(card.querySelector('img.helm-habit-img')?.getAttribute('src')).toBe('app://02 PROJECTS/Habits/icons/Hydrate.png');
  });
});

describe('Breadcrumbs are consistent across tabs', () => {
  it('every tab starts with the same crumb bar, first crumb = the tab name', async () => {
    const { ctx } = await ctxFor();
    const tabs: [string, (r: HTMLElement) => void][] = [
      ['Today', (r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() })],
      ['Calendar', (r) => renderCalendar(ctx, r, { anchor: TODAY, scope: 'month', collapsed: new Map() } as CalendarState)],
      ['Projects', (r) => renderProjects(ctx, r, { filter: '', showClosed: false, showDone: false, collapsed: new Map() })],
      ['Inbox', (r) => renderInbox(ctx, r, { collapsed: new Map() })],
      ['Review', (r) => renderReview(ctx, r, { collapsed: new Map(), checks: new Set() })],
      ['Horizons', (r) => renderHorizons(ctx, r, { year: 2026, collapsed: new Map() })],
      ['Dashboard', (r) => renderDashboard(ctx, r, defaultDashboardState())],
    ];
    for (const [name, fn] of tabs) {
      const root = render(fn);
      const bar = root.firstElementChild as HTMLElement;
      expect(bar.classList.contains('helm-crumbs-top'), `${name}: crumb bar is the first thing rendered`).toBe(true);
      expect(texts(bar, '.helm-crumb')[0], `${name}: first crumb`).toBe(name);
    }
    // Trails: Review shows this week's time trail, Dashboard its range, Calendar the anchor's period.
    expect(texts(render(tabs[4]![1]), '.helm-crumb')).toEqual(['Review', '2026', 'Q3', 'Aug', 'W35']);
    expect(texts(render(tabs[6]![1]), '.helm-crumb')).toEqual(['Dashboard', 'This week']);
    expect(texts(render(tabs[1]![1]), '.helm-crumb')).toEqual(['Calendar', '2026', 'Q3', 'Aug', 'W35']);
  });
});

describe('Drawings in the UI', () => {
  it('day and period headers carry a drawings button with a count; task rows show an indicator only when drawings exist', async () => {
    const { ctx, m, index } = await ctxFor();
    await m.createDrawing({ kind: 'date', date: TODAY, title: TODAY }, { name: 'sketch' });
    const today = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const btn = today.querySelector('.helm-day-actions .helm-drawings-btn')!;
    expect(btn.querySelector('.helm-badge')!.textContent).toBe('1');
    click(btn);
    expect(Menu.last!.items.map((i) => i.title)).toEqual([expect.stringContaining('sketch'), 'New drawing…', 'Link existing drawing…', 'Manage drawings…']);
    const cal = render((r) => renderCalendar(ctx, r, { anchor: TODAY, scope: 'week', collapsed: new Map() } as CalendarState));
    expect(cal.querySelector('.helm-day-actions .helm-drawings-btn .helm-badge')).toBeNull();
    const t = [...index.snapshot.tasks.values()].find((x) => x.text === 'Call the plumber' && x.origin !== 'daily-mirror')!;
    expect(taskRow(ctx, t).querySelector('.helm-task-drawings')).toBeNull();
    await m.createDrawing({ kind: 'task', key: t.key, title: t.text });
    const t2 = [...index.snapshot.tasks.values()].find((x) => x.text === 'Call the plumber' && x.origin !== 'daily-mirror')!;
    expect(taskRow(ctx, t2).querySelector('.helm-task-drawings .helm-badge')!.textContent).toBe('1');
  });
  it('project detail shows a Diagrams section with cards, New and AI', async () => {
    const { ctx, m } = await ctxFor();
    await m.createDrawing({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' }, { name: 'Architecture' });
    const root = render((r) => renderProjects(ctx, r, { projectId: 'prj-kitchen', filter: '', showClosed: false, showDone: false, collapsed: new Map() }));
    expect(texts(root, '.helm-drawing-card-title')).toEqual(['Architecture']);
    const diagrams = [...root.querySelectorAll('.helm-section')].find((sec) => sec.querySelector('.helm-section-title')?.textContent === 'Diagrams')!;
    expect(texts(diagrams as HTMLElement, '.helm-drawing-actions button')).toEqual(['New drawing', 'Link existing', 'Manage']);
  });
});

describe('Linking drawings in the UI', () => {
  it('Link existing drawing… lists unattached drawings; picking one attaches it and it shows in the menu', async () => {
    const { ctx, index, vault } = await ctxFor();
    await vault.write('Excalidraw/loose.excalidraw.md', '---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n\n## Text Elements\n\n%%\n## Drawing\n```json\n{"type":"excalidraw","elements":[]}\n```\n%%\n');
    index.update('Excalidraw/loose.excalidraw.md', await vault.read('Excalidraw/loose.excalidraw.md'));
    const today = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    click(today.querySelector('.helm-day-actions .helm-drawings-btn'));
    Menu.last!.items.find((i) => i.title === 'Link existing drawing…')!.click!();
    const picker = Modal.last as unknown as { getItems: () => { path: string }[]; onChooseItem: (d: { path: string }) => void };
    expect(picker.getItems().map((d) => d.path)).toContain('Excalidraw/loose.excalidraw.md');
    picker.onChooseItem(picker.getItems().find((d) => d.path === 'Excalidraw/loose.excalidraw.md')!);
    await flush(); await flush();
    expect(index.drawingsFor({ kind: 'date', date: TODAY, title: '' }).map((d) => d.title)).toEqual(['loose']);
    expect(await vault.read('Excalidraw/loose.excalidraw.md')).toContain('helm-date: 2026-08-26');
    expect(await vault.read(dailyPath(TODAY))).toContain('![[loose.excalidraw]]');
  });
});

describe('Notes in the UI', () => {
  it('headers carry a notes button; the task menu has a Notes submenu; linking a note attaches it and shows an indicator', async () => {
    const { ctx, index, vault } = await ctxFor();
    await vault.write('10 PERSONAL/Reading list.md', '# Reading list\n');
    index.update('10 PERSONAL/Reading list.md', '# Reading list\n');
    const today = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    click(today.querySelector('.helm-day-actions .helm-notes-btn'));
    expect(Menu.last!.items.map((i) => i.title)).toEqual(['New note…', 'Link existing note…']);
    const t = [...index.snapshot.tasks.values()].find((x) => x.origin === 'project' && x.projectId !== undefined && x.status !== 'done')!;
    click(taskRow(ctx, t).querySelector('button[aria-label="More…"]'));
    const notes = Menu.last!.items.find((i) => i.title === 'Notes')!.sub!;
    notes.items.find((i) => i.title === 'Link existing note…')!.click!();
    const picker = Modal.last as unknown as { getItems: () => { path: string }[]; onChooseItem: (n: { path: string }) => void };
    expect(picker.getItems().map((n) => n.path)).toContain('10 PERSONAL/Reading list.md');
    picker.onChooseItem({ path: '10 PERSONAL/Reading list.md' });
    await flush(); await flush();
    const t2 = [...index.snapshot.tasks.values()].find((x) => x.text === t.text && x.origin === 'project')!;
    expect(await vault.read('10 PERSONAL/Reading list.md')).toContain(`helm-task: ${t2.id}`);
    expect(taskRow(ctx, t2).querySelector('.helm-task-notes .helm-badge')!.textContent).toBe('1');
    const detail = render((r) => renderProjects(ctx, r, { projectId: t2.projectId!, filter: '', showClosed: false, showDone: false, collapsed: new Map() }));
    expect(texts(detail, '.helm-section-title')).toContain('Notes');
  });
});

describe('[[ completion in task inputs', () => {
  it('offers vault note titles after [[ at the caret, closes the link on pick, and is attached to Capture', async () => {
    const { ctx, index, vault } = await ctxFor();
    await vault.write('10 PERSONAL/Test note.md', '# Test note\n');
    index.update('10 PERSONAL/Test note.md', '# Test note\n');
    const { wikilinkSuggest } = await import('../../src/ui/fields');
    const input = document.createElement('input');
    input.type = 'text';
    document.body.appendChild(input);
    const sg = wikilinkSuggest(ctx, input);
    input.value = 'Create [[Te'; input.setSelectionRange(11, 11);
    expect(sg.getSuggestions(input.value)).toEqual(expect.arrayContaining(['Test note']));
    expect(sg.getSuggestions(input.value).some((t) => /Kitchen Remodel/.test(t))).toBe(false); // prefix match wins; contains-matches only when they contain "te"
    input.value = 'Create [[k'; input.setSelectionRange(10, 10);
    expect(sg.getSuggestions(input.value)[0]).toBe('Kitchen Remodel');
    input.value = 'No link here'; input.setSelectionRange(12, 12);
    expect(sg.getSuggestions(input.value)).toEqual([]);
    input.value = 'Create [[Te'; input.setSelectionRange(11, 11);
    let fired = 0; input.addEventListener('input', () => fired++);
    sg.selectSuggestion('Test note');
    expect(input.value).toBe('Create [[Test note]]');
    expect(input.selectionStart).toBe('Create [[Test note]]'.length);
    expect(fired).toBe(1);
    input.value = 'Create [[Te]] today'; input.setSelectionRange(11, 11);
    sg.selectSuggestion('Test note');
    expect(input.value).toBe('Create [[Test note]] today');
    // Drawings are offered with their extension so the link resolves.
    expect(index.noteTitles().some((t) => t.endsWith('.excalidraw'))).toBe(false);
    const before = AbstractInputSuggest.instances.length;
    openCapture(ctx);
    expect(AbstractInputSuggest.instances.length).toBe(before + 1);
  });
});

describe('habits by part of the day', () => {
  it('Today shows a parted habit as chips inside its parts (not in the Habits row), counts occurrences, and the form has part toggles', async () => {
    const MED = '---\ntitle: Meditate\ntype: habit\nid: hab-med\nschedule: every day\nactive: true\ngrace_days: 0\nparts: [morning, evening]\n---\n# Meditate\n';
    const s = await setup({ '02 PROJECTS/Habits/Meditate.md': MED });
    const ctx = { ...(await ctxFor()).ctx, index: s.index, mutations: s.m };
    await s.m.syncHabitsForDay(TODAY);
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const habitsSection = [...root.querySelectorAll('.helm-section')].find((x) => x.querySelector('.helm-section-title')?.textContent === 'Habits')!;
    expect(habitsSection.querySelector('.helm-section-count')?.textContent ?? habitsSection.textContent).toContain('0/4');
    expect([...habitsSection.querySelectorAll('.helm-habit')].map((e) => e.textContent)).not.toContain(expect.stringContaining('Meditate'));
    const morning = [...root.querySelectorAll('.helm-section')].find((x) => x.querySelector('.helm-section-title')?.textContent === 'Morning')!;
    const chip = [...morning.querySelectorAll('.helm-part-habits .helm-habit')].find((e) => e.textContent?.includes('Meditate'))!;
    expect(chip).toBeTruthy();
    click(chip);
    await flush(); await flush();
    expect(s.index.snapshot.completions.some((c) => c.habitId === 'hab-med' && c.date === TODAY && c.part === 'morning' && c.state === 'done')).toBe(true);
    const evening = [...render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() })).querySelectorAll('.helm-section')].find((x) => x.querySelector('.helm-section-title')?.textContent === 'Evening')!;
    expect(evening.querySelector('.helm-part-habits .helm-habit.is-missed, .helm-part-habits .helm-habit.is-pending')).toBeTruthy();
    openHabitForm(ctx, s.index.snapshot.habits.get('hab-med'));
    const form = Modal.last!.contentEl;
    const segs = [...form.querySelectorAll('.helm-seg')].filter((b) => ['Once a day', 'Morning', 'Afternoon', 'Evening'].includes(b.textContent ?? ''));
    expect(segs.filter((b) => b.classList.contains('is-active')).map((b) => b.textContent)).toEqual(['Morning', 'Evening']);
  });
});

describe('New drawing / note dialog', () => {
  it('shows the default location and a live path preview; a typed name and a picked folder go through', async () => {
    const { ctx, vault } = await ctxFor();
    const { newDrawing } = await import('../../src/ui/drawings');
    newDrawing(ctx, { kind: 'period', key: '2026-W35', title: '2026-W35' });
    const m = Modal.last!;
    const [name, folder] = [...m.contentEl.querySelectorAll<HTMLInputElement>('input')];
    expect(folder!.value).toBe('Excalidraw');
    expect(m.contentEl.querySelector('.helm-path-preview')!.textContent).toBe('Excalidraw/2026-W35.excalidraw.md');
    name!.value = 'map'; name!.dispatchEvent(new Event('input'));
    folder!.value = '70 OBSIDIAN/70-02 Excalidraw'; folder!.dispatchEvent(new Event('input'));
    expect(m.contentEl.querySelector('.helm-path-preview')!.textContent).toBe('70 OBSIDIAN/70-02 Excalidraw/map.excalidraw.md');
    click([...m.contentEl.querySelectorAll('button')].find((b) => b.textContent === 'Create'));
    await flush(); await flush();
    expect(await vault.read('70 OBSIDIAN/70-02 Excalidraw/map.excalidraw.md')).toContain('helm-period: 2026-W35');
  });
});

describe('managing habits from Today', () => {
  it('ticking a habit files it under the part of the day you are in, checked, and unticking leaves it there', async () => {
    const { ctx, vault, index } = await ctxFor(); // the test clock says 14:37 → afternoon
    let root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const cardOf = (title: string) => [...root.querySelectorAll<HTMLElement>('.helm-habit-card')].find((c) => c.textContent?.includes(title))!;
    click(cardOf('Morning workout').querySelector('.helm-habit-tick'));
    await flush(); await flush();
    const note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/#+ Afternoon\n+- \[x\] 🏃 Morning workout 🆔 hab-workout/);
    expect(note.match(/hab-workout/g)).toHaveLength(1); // not left behind in the Habits list as well
    root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const chip = root.querySelector('.helm-section.part-afternoon .helm-part-habits .helm-habit')!;
    expect(chip.textContent).toContain('Morning workout');
    expect(chip.classList.contains('is-done')).toBe(true);
    expect(cardOf('Morning workout').querySelector('.helm-habit-moved')!.textContent).toBe('afternoon today');
    // Unticking keeps the line where it is, just not ticked.
    click(cardOf('Morning workout').querySelector('.helm-habit-tick'));
    await flush(); await flush();
    expect(await vault.read(dailyPath(TODAY))).toMatch(/#+ Afternoon\n+- \[ \] 🏃 Morning workout 🆔 hab-workout/);
    void index;
  });

  it('moves a day-level habit into a part of the day for one date only: menu, drag-drop, tick where it sits, back to general next day', async () => {
    const { ctx, index, vault } = await ctxFor();
    await ctx.mutations.schedule('tsk-0001', TODAY, 'afternoon'); // an open task, so every part of the day is drawn
    let root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const cardOf = (title: string) => [...root.querySelectorAll<HTMLElement>('.helm-habit-card')].find((c) => c.textContent?.includes(title))!;
    expect(cardOf('Morning workout').getAttribute('draggable')).toBe('true');
    // Menu → For this day → Morning
    cardOf('Morning workout').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    const forDay = Menu.last!.items.find((i) => i.title === 'For this day')!;
    expect(forDay.sub!.items.map((i) => i.title)).toEqual(['General (Habits section)', 'Morning', 'Afternoon', 'Evening']);
    forDay.sub!.items[1]!.click!();
    await flush(); await flush();
    let note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/#+ Morning\n+- \[ \] 🏃 Morning workout 🆔 hab-workout/);
    expect(note.match(/hab-workout/g)).toHaveLength(1);
    root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    expect(texts(root, '.helm-section.part-morning .helm-part-habits .helm-habit').join()).toContain('Morning workout');
    expect(cardOf('Morning workout').querySelector('.helm-habit-moved')!.textContent).toBe('morning today');
    // Ticking from the card ticks the moved line; the board and the chip agree.
    click(cardOf('Morning workout').querySelector('.helm-habit-tick'));
    await flush(); await flush();
    note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/#+ Morning\n+- \[x\] 🏃 Morning workout 🆔 hab-workout/);
    root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    expect(cardOf('Morning workout').classList.contains('is-day-done')).toBe(true);
    expect(root.querySelector('.helm-section.part-morning .helm-part-habits .helm-habit')!.classList.contains('is-done')).toBe(true);
    // Syncing the day again does not re-add a general line.
    await ctx.mutations.syncHabitsForDay(TODAY);
    expect((await vault.read(dailyPath(TODAY))).match(/hab-workout/g)).toHaveLength(1);
    // Drag the card onto the evening: it moves, tick state travels.
    const evening = root.querySelector<HTMLElement>('.helm-section.part-evening')!;
    const dt = { types: ['text/helm-habit'], getData: (k: string) => (k === 'text/helm-habit' ? 'hab-workout' : '') };
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    evening.dispatchEvent(ev);
    await flush(); await flush();
    note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/#+ Evening\n+- \[x\] 🏃 Morning workout 🆔 hab-workout/);
    expect(note.match(/hab-workout/g)).toHaveLength(1);
    // Tomorrow it is a general habit again.
    await ctx.mutations.syncHabitsForDay('2026-08-27');
    const tomorrow = await vault.read(dailyPath('2026-08-27'));
    expect(tomorrow).toMatch(/#+ Habits\n(?:- .*\n)*- \[ \] 🏃 Morning workout 🆔 hab-workout/); // back in the Habits list (title order)
    expect(tomorrow.match(/hab-workout/g)).toHaveLength(1);
    void index;
  });

  it('shows note / drawing pills on a habit card that open the attachment menus, and the edit form lists them', async () => {
    const { ctx, index, vault } = await ctxFor();
    await vault.write('81 AI/Workout plan.md', '---\nhelm-habit: hab-workout\n---\n# Workout plan\n');
    index.update('81 AI/Workout plan.md', await vault.read('81 AI/Workout plan.md'));
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const card = [...root.querySelectorAll('.helm-habit-card')].find((c) => c.textContent?.includes('Morning workout'))!;
    const pill = card.querySelector('.helm-habit-attach .helm-task-notes') as HTMLButtonElement;
    expect(pill).toBeTruthy();
    expect(pill.textContent).toBe('1');
    expect(card.querySelector('.helm-habit-attach .helm-task-drawings')).toBeNull();
    pill.click();
    expect(Menu.last!.items.some((i) => i.title.startsWith('Workout plan'))).toBe(true);
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    Menu.last!.items[0]!.click!();
    const form = Modal.last!;
    expect(form.contentEl.textContent).toContain('Workout plan');
  });
  it('has a New habit button, a right-click menu on chips with edit / skip / pause / delete, and Delete in the edit form', async () => {
    const { ctx, index } = await ctxFor();
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const habitsSection = [...root.querySelectorAll('.helm-section')].find((x) => x.querySelector('.helm-section-title')?.textContent === 'Habits')!;
    expect(texts(habitsSection as HTMLElement, '.helm-section-actions button')).toEqual(['New habit']);
    const chip = habitsSection.querySelector('.helm-habit-card')!;
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    expect(Menu.last!.items.map((i) => i.title)).toEqual(['Edit…', 'Mark done', 'Skip today', 'For this day', 'Notes', 'Drawings', 'Pause habit', 'Open note', 'Delete habit…']);
    Menu.last!.items[0]!.click!();
    const form = Modal.last!;
    expect(form.titleEl.textContent).toBe('Edit habit');
    expect(texts(form.contentEl, '.helm-modal-buttons button')).toEqual(['Active', 'Delete', 'Cancel', 'Save']);
    const hb = index.allHabits()[0]!;
    chip.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    Menu.last!.items.find((i) => i.title === 'Pause habit')!.click!();
    await flush(); await flush();
    expect(index.snapshot.habits.get(hb.id)!.active).toBe(false);
  });
});

describe('habit board', () => {
  it('renders a coloured card per habit with today’s ticks, seven week cells and a month ring; cells fix past days; part ticks toggle one part', async () => {
    const MED = '---\ntitle: Meditate\ntype: habit\nid: hab-med\nschedule: every day\nactive: true\ngrace_days: 0\nparts: [morning, evening]\ncolor: purple\n---\n# Meditate\n';
    const s = await setup({ '02 PROJECTS/Habits/Meditate.md': MED });
    const ctx = { ...(await ctxFor()).ctx, index: s.index, mutations: s.m };
    await s.m.syncHabitsForDay(TODAY);
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const cards = [...root.querySelectorAll<HTMLElement>('.helm-habit-card')];
    expect(cards).toHaveLength(3);
    const med = cards.find((c) => c.textContent?.includes('Meditate'))!;
    expect(med.getAttribute('data-color')).toBe('purple');
    expect(med.style.getPropertyValue('--hc')).toBe('var(--color-purple)');
    expect(med.querySelectorAll('.helm-habit-tick')).toHaveLength(2);
    expect(med.querySelectorAll('.helm-habit-cell')).toHaveLength(7);
    expect(med.querySelector('.helm-habit-ring')).toBeTruthy();
    const other = cards.find((c) => !c.textContent?.includes('Meditate'))!;
    expect(other.getAttribute('data-color')).toMatch(/^(green|blue|purple|orange|cyan|pink|yellow|red)$/); // auto-assigned
    // Tick the morning part only.
    click(med.querySelectorAll('.helm-habit-tick')[0]);
    await flush(); await flush();
    expect(s.index.snapshot.completions.filter((c) => c.habitId === 'hab-med' && c.date === TODAY && c.state === 'done').map((c) => c.part)).toEqual(['morning']);
    // Click yesterday's cell: the whole day is marked done in yesterday's note.
    const root2 = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const med2 = [...root2.querySelectorAll<HTMLElement>('.helm-habit-card')].find((c) => c.textContent?.includes('Meditate'))!;
    const yesterday = [...med2.querySelectorAll<HTMLElement>('.helm-habit-cell')].find((c) => c.title.startsWith('2026-08-25'))!;
    click(yesterday);
    await flush(); await flush(); await flush();
    expect(s.index.snapshot.completions.filter((c) => c.habitId === 'hab-med' && c.date === '2026-08-25' && c.state === 'done').map((c) => c.part).sort()).toEqual(['evening', 'morning']);
    expect(await s.vault.read(dailyPath('2026-08-25'))).toMatch(/- \[x\] Meditate 🆔 hab-med ✅ 2026-08-25/);
    // The form offers colour swatches and saves the pick.
    openHabitForm(ctx, s.index.snapshot.habits.get('hab-med'));
    const form = Modal.last!;
    expect(form.contentEl.querySelectorAll('.helm-swatch')).toHaveLength(8);
    expect(form.contentEl.querySelector('.helm-swatch.is-active')!.getAttribute('title')).toBe('purple');
  });
});

describe('Follow up from the UI', () => {
  it('the task menu offers Follow up…; the dialog prefills the title, defaults to tomorrow, and creates the tagged, dependent task', async () => {
    const { ctx, index, vault } = await ctxFor();
    const t = [...index.snapshot.tasks.values()].find((x) => x.origin === 'daily' && x.noteDate === '2026-08-25' && x.status === 'todo' && x.section !== 'outside')!;
    click(taskRow(ctx, t).querySelector('button[aria-label="More…"]'));
    expect(Menu.last!.items.map((i) => i.title).slice(0, 3)).toEqual(['Edit…', 'Add subtask…', 'Follow up…']);
    Menu.last!.items[2]!.click!();
    const m = Modal.last!;
    expect(m.titleEl.textContent).toBe('Follow up');
    const text = m.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(text.value).toBe(t.text);
    expect(m.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!.value).toBe('2026-08-27');
    expect(m.contentEl.querySelector('input[type="checkbox"]')).toBeNull(); // nothing in the dialog can change the original
    text.value = 'Next step';
    const tagBtn = m.contentEl.querySelector<HTMLButtonElement>('.helm-tag-toggle')!;
    expect(tagBtn.textContent).toBe('#followup');
    expect(tagBtn.classList.contains('is-active')).toBe(false); // off unless you ask for it
    click(tagBtn);
    const [ts, te] = [...m.contentEl.querySelectorAll<HTMLInputElement>('input[type="time"]')];
    expect(ts!.value).toBe(t.time?.start ?? '');
    ts!.value = '14:00'; ts!.dispatchEvent(new Event('input'));
    const effortSel = m.contentEl.querySelector<HTMLSelectElement>('.helm-effort-select')!;
    effortSel.value = '45'; effortSel.dispatchEvent(new Event('change'));
    expect(te!.value).toBe('14:45');
    click([...m.contentEl.querySelectorAll('button')].find((b) => b.textContent?.includes('Create follow-up')));
    await flush(); await flush(); await flush();
    const line = (await vault.read(dailyPath('2026-08-27'))).split('\n').find((l) => l.includes('Next step'))!;
    expect(line).toMatch(/^- \[ \] 14:00 - 14:45: Next step #followup 🆔 tsk-\w+ ⛔ tsk-\w+ ⏱️ 45m/);
    const fu = [...index.snapshot.tasks.values()].find((x) => x.text.startsWith('Next step') && x.origin === 'daily')!;
    // The chip names the original in plain words: no tag, no wikilink brackets, no URL, ellipsis by CSS.
    const rowRoot = render((r) => renderToday(ctx, r, { date: '2026-08-27', collapsed: new Map() }));
    const chipEl = rowRoot.querySelector('.helm-chip.followup .helm-chip-label');
    if (chipEl) { expect(chipEl.textContent).not.toContain('#'); expect(chipEl.textContent).not.toContain('[['); }
    expect(fu.part).toBe('afternoon'); // from the time
    const row = taskRow(ctx, [...index.snapshot.tasks.values()].find((x) => x.text.startsWith('Next step') && x.origin === 'daily')!);
    expect(row.querySelector('.helm-chip.followup')!.textContent).toContain('follows:');
  });
});

describe('Capture for another day', () => {
  it('the Day row is preset to the viewed day; Tomorrow and a typed date override the text; Inbox unplans', async () => {
    const { ctx, vault } = await ctxFor();
    openCapture(ctx, { date: TODAY });
    const m = Modal.last!;
    const seg = (label: string) => [...m.contentEl.querySelectorAll<HTMLElement>('.helm-capture-day .helm-seg')].find((b) => b.textContent === label)!;
    expect(seg('Today').classList.contains('is-active')).toBe(true);
    expect(m.contentEl.querySelector<HTMLInputElement>('.helm-capture-date')!.value).toBe(TODAY);
    const input = m.contentEl.querySelector<HTMLInputElement>('.helm-capture-input')!;
    input.value = 'Call the dentist today'; input.dispatchEvent(new Event('input'));
    click(seg('Tomorrow'));
    expect(m.contentEl.querySelector('.helm-capture-where')!.textContent).toBe('→ daily note for Tomorrow');
    expect(seg('Tomorrow').classList.contains('is-active')).toBe(true);
    const dateInput = m.contentEl.querySelector<HTMLInputElement>('.helm-capture-date')!;
    expect(dateInput.value).toBe('2026-08-27');
    dateInput.value = '2026-09-03'; dateInput.dispatchEvent(new Event('change'));
    expect(m.contentEl.querySelector('.helm-capture-where')!.textContent).toBe('→ daily note for Thu 3 Sep');
    expect([...m.contentEl.querySelectorAll('.helm-capture-day .helm-chip')].map((c) => c.textContent)).toEqual(['Thu 3 Sep 2026']);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush(); await flush(); await flush();
    expect(await vault.read(ctx.index.dailyPath('2026-09-03'))).toContain('Call the dentist');
    openCapture(ctx, { date: TODAY });
    const m2 = Modal.last!;
    click([...m2.contentEl.querySelectorAll<HTMLElement>('.helm-capture-day .helm-seg')].find((b) => b.textContent === 'Inbox'));
    expect(m2.contentEl.querySelector('.helm-capture-where')!.textContent).toMatch(/^→ inbox/);
  });
});

describe('dragging a task between parts of the day', () => {
  it('offers Make a project from this…, prefilled with the task name', async () => {
    const { ctx, m, index, vault } = await ctxFor();
    await m.addTask({ text: 'Build the cert lab #work', date: TODAY, part: 'morning' });
    const t = [...index.snapshot.tasks.values()].find((x) => x.text.startsWith('Build the cert lab'))!;
    taskMenu(ctx, t, new MouseEvent('contextmenu'));
    const item = Menu.last!.items.find((i) => i.title === 'Make a project from this…')!;
    expect(item).toBeTruthy();
    item.click!();
    const form = Modal.last!;
    expect(form.titleEl.textContent).toBe('New project');
    const name = form.contentEl.querySelector<HTMLInputElement>('input[type="text"]')!;
    expect(name.value).toBe('Build the cert lab'); // the tag is not part of the project name
    click([...form.contentEl.querySelectorAll('button')].find((b) => b.textContent?.includes('Create project')));
    await flush(); await flush(); await flush();
    const project = index.allProjects().find((p) => p.title === 'Build the cert lab')!;
    expect(project).toBeTruthy();
    expect(await vault.read(project.path)).toContain('Build the cert lab');
    // A task that already lives in a project is not offered it.
    const inProject = [...index.snapshot.tasks.values()].find((x) => x.origin === 'project')!;
    taskMenu(ctx, inProject, new MouseEvent('contextmenu'));
    expect(Menu.last!.items.some((i) => i.title === 'Make a project from this…')).toBe(false);
  });

  it('offers Follow up… on a subtask but not on the task that has it', async () => {
    const { ctx, m, index } = await ctxFor();
    await m.addTask({ text: 'Ship the draft', date: TODAY, part: 'morning' });
    const parent = [...index.snapshot.tasks.values()].find((x) => x.text === 'Ship the draft')!;
    await m.addTask({ text: 'Proof it', parentKey: parent.key });
    const fresh = index.task(parent.key)!;
    taskMenu(ctx, fresh, new MouseEvent('contextmenu'));
    const parentItem = Menu.last!.items.find((i) => i.title.startsWith('Follow up'))!;
    expect(parentItem.title).toBe('Follow up… — move it instead (it has subtasks)');
    expect(parentItem.disabled).toBe(true);
    expect(parentItem.click).toBeUndefined();
    const kid = index.task(fresh.childKeys[0]!)!;
    taskMenu(ctx, kid, new MouseEvent('contextmenu'));
    const kidItem = Menu.last!.items.find((i) => i.title.startsWith('Follow up'))!;
    expect(kidItem.title).toBe('Follow up…'); // a subtask follows up like any other task
    expect(kidItem.disabled).toBe(false);
  });

  it('deleting a finished subtask from the day\'s done list removes it from under its parent too', async () => {
    const { ctx, m, index, vault } = await ctxFor();
    await m.addTask({ text: 'Ship the draft', date: TODAY, part: 'morning' });
    const parent = [...index.snapshot.tasks.values()].find((x) => x.text === 'Ship the draft')!;
    await m.addTask({ text: 'Proof it', parentKey: parent.key });
    const proof = index.task(parent.key)!.childKeys.map((k) => index.task(k)!)[0]!;
    await m.setStatus(proof.key, 'done');
    let root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const rows = () => texts(root, '.helm-section.part-morning .helm-task-text');
    expect(rows()).toEqual(['Ship the draft', 'Proof it', 'Proof it']); // under its parent, and in the done list
    // Delete it from the ghost row: it is the same task, so both go.
    const ghost = [...root.querySelectorAll<HTMLElement>('.helm-section.part-morning .helm-ghost')].find((r) => r.querySelector('.helm-chip.subtask-of'))!;
    const confirmOrig = window.confirm;
    window.confirm = () => true;
    try {
      click(ghost.querySelector('button[aria-label="More…"]'));
      Menu.last!.items.find((i) => i.title.startsWith('Delete'))!.click!();
      await flush(); await flush();
    } finally { window.confirm = confirmOrig; }
    expect(await vault.read(dailyPath(TODAY))).not.toContain('Proof it');
    root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    expect(rows()).toEqual(['Ship the draft']); // gone from both places, parent untouched
  });

  it('takes the subtasks along, done ones included', async () => {
    const { ctx, m, index, vault } = await ctxFor();
    await m.addTask({ text: 'Ship the draft', date: TODAY, part: 'morning' });
    const parent = [...index.snapshot.tasks.values()].find((x) => x.text === 'Ship the draft')!;
    await m.addTask({ text: 'Proof it', parentKey: parent.key });
    await m.addTask({ text: 'Send it', parentKey: parent.key });
    const proof = index.task(parent.key)!.childKeys.map((k) => index.task(k)!)[0]!;
    await m.setStatus(proof.key, 'done');
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const el = root.querySelector<HTMLElement>('.helm-section.part-evening')!;
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['text/helm-task'], getData: (k: string) => (k === 'text/helm-task' ? index.task(parent.key)!.key : '') } });
    el.dispatchEvent(ev);
    await flush(); await flush(); await flush();
    const note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/#+ Evening\n(?:.*\n)*?- \[ \] Ship the draft\n\t- \[x\] Proof it[^\n]*\n\t- \[ \] Send it/);
    expect(note.split('# Morning')[1]?.split('#')[0] ?? '').not.toContain('Proof it');
  });

  it('gives a timed task the first free slot in the part it lands in, keeping its length', async () => {
    const { ctx, m, index, vault } = await ctxFor();
    await m.addTask({ text: 'Review links', date: TODAY, part: 'evening', fields: { time: { start: '21:00', end: '22:00' } } });
    await m.addTask({ text: 'Standup', date: TODAY, part: 'morning', fields: { time: { start: '08:00', end: '08:30' } } });
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const drop = (part: string, key: string): void => {
      const el = root.querySelector<HTMLElement>(`.helm-section.part-${part}`)!;
      const ev = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: { types: ['text/helm-task'], getData: (k: string) => (k === 'text/helm-task' ? key : '') } });
      el.dispatchEvent(ev);
    };
    const task = [...index.snapshot.tasks.values()].find((x) => x.text === 'Review links')!;
    drop('morning', task.key);
    await flush(); await flush(); await flush();
    const note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/#+ Morning\n(?:.*\n)*?- \[ \] 08:30 - 09:30: Review links/); // after the standup, still an hour long
    expect(note).not.toContain('21:00 - 22:00');
  });

  it('leaves a task without a time alone', async () => {
    const { ctx, m, index, vault } = await ctxFor();
    await m.addTask({ text: 'Tidy desk', date: TODAY, part: 'evening' });
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const task = [...index.snapshot.tasks.values()].find((x) => x.text === 'Tidy desk')!;
    const el = root.querySelector<HTMLElement>('.helm-section.part-afternoon')!;
    const ev = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: { types: ['text/helm-task'], getData: (k: string) => (k === 'text/helm-task' ? task.key : '') } });
    el.dispatchEvent(ev);
    await flush(); await flush(); await flush();
    const note = await vault.read(dailyPath(TODAY));
    expect(note).toMatch(/#+ Afternoon\n(?:.*\n)*?- \[ \] Tidy desk/);
    expect(note).not.toMatch(/- \[ \] \d\d:\d\d.*Tidy desk/);
  });
});

describe('moving a task to another day', () => {
  it('every day in the task menu opens onto the parts of the day, and the date picker offers them too', async () => {
    const { ctx, index, vault } = await ctxFor();
    const t = index.task('tsk-0001')!;
    taskMenu(ctx, t, new MouseEvent('contextmenu'));
    const tomorrow = Menu.last!.items.find((i) => i.title === 'Tomorrow')!;
    expect(tomorrow.sub!.items.map((i) => i.title)).toEqual(['Just move it', 'Morning', 'Afternoon', 'Evening', 'Anytime']);
    tomorrow.sub!.items[1]!.click!(); // Morning
    await flush(); await flush();
    const note = await vault.read(dailyPath('2026-08-27'));
    expect(note).toMatch(/#+ Morning\n+- \[ \] .*Draft chapter list/);
    // A task that already sits in a part offers to keep it.
    const moved = [...index.snapshot.tasks.values()].find((x) => x.id === 'tsk-0001' && x.origin === 'daily-mirror')!;
    taskMenu(ctx, moved, new MouseEvent('contextmenu'));
    expect(Menu.last!.items.find((i) => i.title === 'Tomorrow')!.sub!.items[0]!.title).toBe('Keep the morning');
    // Pick a date… opens the picker with a part row.
    taskMenu(ctx, t, new MouseEvent('contextmenu'));
    Menu.last!.items.find((i) => i.title === 'Pick a date…')!.click!();
    const picker = Modal.last!;
    expect(texts(picker.contentEl, '.helm-datepicker-parts button')).toEqual(['Keep', 'Morning', 'Afternoon', 'Evening', 'Anytime']);
    click([...picker.contentEl.querySelectorAll('.helm-datepicker-parts button')].find((b) => b.textContent === 'Evening'));
    click([...picker.contentEl.querySelectorAll('.helm-presets button')].find((b) => b.textContent === '+2 days'));
    await flush(); await flush();
    expect(await vault.read(dailyPath('2026-08-28'))).toMatch(/#+ Evening\n+- \[ \] .*Draft chapter list/);
  });
});

describe('double-booking guard', () => {
  it('Capture warns inline when the time overlaps and asks before adding; the follow-up dialog warns too', async () => {
    const { ctx, m, vault, index } = await ctxFor();
    await m.addTask({ text: 'Dentist', date: TODAY, fields: { time: { start: '10:00', end: '11:00' } } });
    openCapture(ctx, { date: TODAY });
    const cap = Modal.last!;
    const input = cap.contentEl.querySelector<HTMLInputElement>('.helm-capture-input')!;
    input.value = 'Haircut 10:30-11:00'; input.dispatchEvent(new Event('input'));
    expect(cap.contentEl.querySelector<HTMLElement>('.helm-conflict')!.textContent).toContain('⚠ Overlaps 10:00–11:00 Dentist');
    expect(cap.contentEl.querySelector('.helm-conflict-fix')!.textContent).toBe('Move to 11:00'); // the first slot that fits
    const confirms: string[] = [];
    const orig = window.confirm;
    window.confirm = (msg?: string) => { confirms.push(msg ?? ''); return false; };
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush(); await flush();
    expect(confirms[0]).toContain('overlaps 10:00–11:00 Dentist');
    expect(await vault.read(dailyPath(TODAY))).not.toContain('Haircut');
    window.confirm = () => true;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await flush(); await flush(); await flush();
    expect(await vault.read(dailyPath(TODAY))).toContain('10:30 - 11:00: Haircut');
    window.confirm = orig;
    // Follow-up: overlapping time on the chosen day shows the same warning.
    const { openFollowUp } = await import('../../src/ui/modals/followUp');
    const dentist = [...index.snapshot.tasks.values()].find((t) => t.text === 'Dentist')!;
    openFollowUp(ctx, dentist);
    const fu = Modal.last!;
    click([...fu.contentEl.querySelectorAll<HTMLElement>('.helm-seg')].find((b) => b.textContent === 'Today') ?? fu.contentEl.querySelector('.helm-seg'));
    const dateInput = fu.contentEl.querySelector<HTMLInputElement>('input[type="date"]')!;
    dateInput.value = TODAY; dateInput.dispatchEvent(new Event('change'));
    const [ts] = [...fu.contentEl.querySelectorAll<HTMLInputElement>('input[type="time"]')];
    ts!.value = '10:45'; ts!.dispatchEvent(new Event('input'));
    expect(fu.contentEl.querySelector<HTMLElement>('.helm-conflict')!.textContent).toContain('Haircut');
    expect(fu.contentEl.querySelector<HTMLElement>('.helm-conflict')!.textContent).not.toContain('Dentist'); // itself excluded
  });
});
