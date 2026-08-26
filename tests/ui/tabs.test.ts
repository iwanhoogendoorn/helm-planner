// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { Menu, Modal, Notice } from '../stubs/obsidian';
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
import { parsePhases } from '../../src/ui/modals/projectForm';
import { renderHorizons } from '../../src/ui/tabs/horizons';

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
    notify: (m) => { new Notice(m); },
    openFile: async (p) => { opened.push(p); },
    openLink: () => undefined,
    refresh: () => undefined,
    navigate: (tab, opts) => { nav.push({ tab, opts }); },
    run: async (_l, fn) => { await fn(); },
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
    expect(texts(root, '.helm-section-title')).toEqual(['Habits', 'Day planner', 'Today', 'From projects', 'Done']);
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
    expect(texts(root, '.helm-week-day:nth-child(2) .helm-task-text')).toEqual(['Start with OIB', 'Chapter 1', 'Fix router config']);
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
    expect(texts(root, '.helm-section-title')).toEqual(['Outline', 'Writing', 'Other tasks']);
    expect(texts(root, '.helm-section:nth-of-type(1) .helm-task-text')).toEqual(['Draft chapter list', 'Collect diagrams', 'Review with editor']);
    const input = root.querySelector<HTMLInputElement>('.helm-section:nth-of-type(2) .helm-quickadd-input')!;
    input.value = 'Chapter 3 tomorrow !high';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();
    const src = await vault.read('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md');
    expect(src).toMatch(/- \[ \] Chapter 3 🆔 tsk-\w+ ➕ 2026-08-26 ⏳ 2026-08-27 ⏫\n\n## Tasks/);
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
    expect(await vault.read('01 INBOX/Inbox.md')).toContain('- [ ] Buy milk ➕ 2026-08-26 🔼 ⏱️ 10m');
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
    expect(k).toMatch(/- \[ \] Call the plumber 🆔 tsk-\w+ ➕ 2026-08-26 ⏳ 2026-08-27 ⏫ ⏱️ 30m/);
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
    expect(daily).toContain('### Today\n- [ ] Call the plumber');
    expect(daily).toContain('### From projects\n- [ ] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 [[Oracle Book Writing]]');
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
