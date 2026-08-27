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

beforeEach(() => { document.body.innerHTML = ''; Notice.messages = []; Modal.last = undefined; Menu.last = undefined; });

describe('Today tab', () => {
  it('renders yesterday: time blocks, tasks, mirrors, habits, done', async () => {
    const { ctx } = await ctxFor();
    const root = render((r) => renderToday(ctx, r, { date: '2026-08-25', collapsed: new Map() }));
    expect(root.querySelector('.helm-day-title-main')!.textContent).toBe('Yesterday');
    expect(texts(root, '.helm-section-title')).toEqual(['Habits', 'Morning', 'Afternoon', 'Anytime', 'Done']);
    expect(texts(root, '.helm-section:nth-of-type(2) .helm-task-text')).toEqual(['Start with OIB']);
    expect(texts(root, '.helm-section:nth-of-type(3) .helm-task-text')).toEqual(['Fix router config']);
    expect(root.querySelector('.helm-habit.is-done')!.textContent).toContain('Morning workout');
    expect(root.querySelector('.helm-capacity-label')!.textContent).toContain('3 open · 1 done');
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
    click([...root.querySelectorAll('.helm-habit')].find((e) => e.textContent?.includes('Evening')));
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
    expect(texts(root, '.helm-section-title')).toEqual(['Outline', 'Writing', 'Other tasks', 'Notes', 'Diagrams']);
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

  it('Today tab renders parts with drop zones and moves a task on drop', async () => {
    const { ctx, vault } = await ctxFor();
    await ctx.mutations.schedule('tsk-0001', TODAY, 'morning');
    const root = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    expect(texts(root, '.helm-section-title')).toEqual(['Needs attention', 'Habits', 'Morning', 'Afternoon', 'Evening', 'Anytime']);
    expect(texts(root, '.helm-section.part-morning .helm-task-text')).toEqual(['Draft chapter list', 'Collect diagrams']);
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

  it('stores an uploaded PNG under the habits icons folder and links it from the note', async () => {
    const { ctx, vault, index } = await ctxFor();
    openHabitForm(ctx);
    const root = Modal.last!.contentEl;
    root.querySelector<HTMLInputElement>('input[type="text"]')!.value = 'Hydrate';
    const file = root.querySelector<HTMLInputElement>('input[type="file"]')!;
    const png = new File([new Uint8Array([137, 80, 78, 71])], 'water-drop.png', { type: 'image/png' });
    Object.defineProperty(file, 'files', { value: [png] });
    file.dispatchEvent(new Event('change'));
    await flush(); await flush();
    expect(root.querySelector('.helm-habit-icon-preview img')).not.toBeNull();
    click([...root.querySelectorAll('.helm-seg')].find((b) => b.textContent === 'Every N days'));
    click([...root.querySelectorAll('.helm-seg')].find((b) => b.textContent === '3'));
    click([...root.querySelectorAll('button')].find((b) => b.textContent?.includes('Create habit')));
    await flush(); await flush(); await flush();
    expect([...vault.binaries.keys()]).toEqual(['02 PROJECTS/Habits/icons/Hydrate.png']);
    const note = await vault.read('02 PROJECTS/Habits/Hydrate.md');
    expect(note).toContain('icon_image: 02 PROJECTS/Habits/icons/Hydrate.png');
    expect(note).toContain('schedule: every 3 days');
    await index.rebuild();
    const hb = index.allHabits().find((x) => x.title === 'Hydrate')!;
    expect(hb.iconImage).toBe('02 PROJECTS/Habits/icons/Hydrate.png');
    // The Today tab shows the image instead of an emoji.
    const today = render((r) => renderToday(ctx, r, { date: TODAY, collapsed: new Map() }));
    const chip = [...today.querySelectorAll('.helm-habit')].find((c) => c.textContent?.includes('Hydrate'))!;
    expect(chip.querySelector('img.helm-habit-img')?.getAttribute('src')).toBe('app://02 PROJECTS/Habits/icons/Hydrate.png');
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
    expect(texts(render(tabs[6]![1]), '.helm-crumb')).toEqual(['Dashboard', '30 days']);
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
    expect(Menu.last!.items.map((i) => i.title)).toEqual([expect.stringContaining('26, Wednesday, Aug, 2026 — sketch'), 'New drawing…', 'Link existing drawing…', 'Manage drawings…']);
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
