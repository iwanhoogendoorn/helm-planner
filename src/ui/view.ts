/** The Helm leaf: a tab bar and one tab body, re-rendered from the index. */
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { IsoDate } from '../core/types';
import { clear, h, icon, iconButton, setShown } from './dom';
import type { TabId, UiContext } from './context';
import { selection, selectionBar } from './selection';
import { renderToday, type TodayState } from './tabs/today';
import { renderCalendar, type CalendarState } from './tabs/calendar';
import { renderProjects, type ProjectsState } from './tabs/projects';
import { renderInbox, type InboxState } from './tabs/inbox';
import { renderReview, type ReviewState } from './tabs/review';
import { renderHorizons, type HorizonsState } from './tabs/horizons';
import { renderDashboard, type DashboardState, defaultDashboardState } from './tabs/dashboard';
import { renderHabits, type HabitsState, defaultHabitsState } from './tabs/habits';
import { openCapture } from './modals/capture';
import { openSearch } from './modals/search';
import { collecting, Disposers, rememberFocus, restoreFocus } from './lifecycle';

export const VIEW_TYPE = 'helm-view';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'week', label: 'Calendar', icon: 'calendar-range' },
  { id: 'projects', label: 'Projects', icon: 'folder-kanban' },
  { id: 'habits', label: 'Habits', icon: 'repeat' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'review', label: 'Review', icon: 'clipboard-check' },
  { id: 'horizons', label: 'Horizons', icon: 'mountain' },
  { id: 'dashboard', label: 'Dashboard', icon: 'bar-chart-3' },
];

interface ViewState { tab: TabId; date?: IsoDate; weekAnchor?: IsoDate; scope?: CalendarState['scope']; projectId?: string; year?: number; periodKey?: string }

export class HelmView extends ItemView {
  private tab: TabId;
  private todayState: TodayState;
  private weekState: CalendarState;
  private projectsState: ProjectsState = { filter: '', showClosed: false, collapsed: new Map(), showDone: true };   // a project keeps its finished work in view
  private inboxState: InboxState = { collapsed: new Map() };
  private reviewState: ReviewState = { collapsed: new Map(), checks: new Set() };
  private horizonsState: HorizonsState;
  private dashboardState: DashboardState = defaultDashboardState();
  private habitsState: HabitsState = defaultHabitsState();
  private body!: HTMLElement;
  private tabBar!: HTMLElement;
  private scrollTop = new Map<string, number>();
  private scheduled = false;
  /** The queued paint, cancelled on close so nothing renders into a closed leaf. */
  private frame = 0;
  private closed = false;
  /** A render was asked for while the leaf was hidden; it is done when the leaf shows again. */
  private stale = false;
  /** What the last render started (timer ticks, chart observers), stopped before the next one and on close. */
  private disposers = new Disposers();
  private tabButtons = new Map<TabId, HTMLButtonElement>();
  private indexingHint!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private ctxFactory: (view: HelmView) => UiContext) {
    super(leaf);
    this.tab = 'today';
    const today = this.ctx().today();
    this.todayState = { date: today, collapsed: new Map() };
    this.weekState = { scope: 'week', anchor: today, collapsed: new Map() };
    this.horizonsState = { year: Number(today.slice(0, 4)), collapsed: new Map() };
    this.navigation = false;
  }

  ctx(): UiContext { return this.ctxFactory(this); }
  override getViewType(): string { return VIEW_TYPE; }
  override getDisplayText(): string { return 'Helm'; }
  override getIcon(): string { return 'compass'; }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.addClass('helm-root');
    this.closed = false;
    this.tabBar = this.buildTabBar();
    this.body = h('div', { cls: 'helm-body', attr: { role: 'tabpanel' } });
    root.append(this.tabBar, this.body);
    this.tab = this.ctx().settings().defaultTab;
    // A leaf in a background tab skips its renders; catch up the moment it is shown again.
    const ws = (this.app as { workspace?: { on?: (name: string, cb: (leaf: unknown) => void) => unknown } } | undefined)?.workspace;
    if (ws?.on && typeof (this as { registerEvent?: unknown }).registerEvent === 'function') {
      this.registerEvent(ws.on('active-leaf-change', (leaf) => { if (leaf === this.leaf && this.stale) this.render(); }) as never);
    }
    this.render();
  }

  override async onClose(): Promise<void> {
    this.closed = true;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.scheduled = false;
    this.disposers.run();
    if (this.body) clear(this.body);
    clear(this.contentEl);
  }

  override onResize(): void {
    if (this.stale) this.render();
  }

  override getState(): Record<string, unknown> {
    const s: ViewState = { tab: this.tab, date: this.todayState.date, weekAnchor: this.weekState.anchor, scope: this.weekState.scope };
    if (this.projectsState.projectId) s.projectId = this.projectsState.projectId;
    s.year = this.horizonsState.year;
    if (this.horizonsState.selected) s.periodKey = this.horizonsState.selected;
    return s as unknown as Record<string, unknown>;
  }

  override async setState(state: unknown, result: { history: boolean }): Promise<void> {
    const s = (state ?? {}) as Partial<ViewState>;
    if (s.tab && TABS.some((t) => t.id === s.tab)) this.tab = s.tab;
    if (s.date) this.todayState.date = s.date;
    if (s.weekAnchor) this.weekState.anchor = s.weekAnchor;
    if (s.scope) this.weekState.scope = s.scope;
    if (s.projectId !== undefined) this.projectsState.projectId = s.projectId;
    if (typeof s.year === 'number') this.horizonsState.year = s.year;
    if (s.periodKey) this.horizonsState.selected = s.periodKey;
    await super.setState(state, result);
    if (this.body) this.render();
  }

  navigate(tab: TabId, opts: { date?: IsoDate; projectId?: string; periodKey?: string; scope?: CalendarState['scope'] } = {}): void {
    this.tab = tab;
    if (tab === 'today' && opts.date) this.todayState.date = opts.date;
    if (tab === 'week') { if (opts.date) this.weekState.anchor = opts.date; if (opts.scope) this.weekState.scope = opts.scope; }
    if (tab === 'projects') this.projectsState.projectId = opts.projectId;
    if (tab === 'horizons' && opts.periodKey) { this.horizonsState.selected = opts.periodKey; const y = Number(opts.periodKey.slice(0, 4)); if (y) this.horizonsState.year = y; }
    this.render();
    this.app.workspace.requestSaveLayout();
  }

  /** Coalesce many index events into one paint. */
  requestRender(): void {
    if (this.scheduled || this.closed) return;
    this.scheduled = true;
    this.frame = window.requestAnimationFrame(() => { this.scheduled = false; this.frame = 0; this.render(); });
  }

  /**
   * The tab bar is built once; a render only moves the selection and the indexing hint. It is a
   * tablist: the arrow keys, Home and End move between tabs, and only the current tab is in the tab order.
   */
  private buildTabBar(): HTMLElement {
    const bar = h('div', { cls: 'helm-tabs' });
    const list = h('div', { cls: 'helm-tablist', attr: { role: 'tablist', 'aria-label': 'Helm' } });
    const go = (i: number): void => {
      const t = TABS[(i + TABS.length) % TABS.length]!;
      this.navigate(t.id);
      this.tabButtons.get(t.id)?.focus();
    };
    TABS.forEach((t, i) => {
      const b = h('button', {
        cls: 'helm-tab', title: t.label,
        attr: { role: 'tab', 'aria-selected': 'false', tabindex: '-1', 'data-tab': t.id },
        onClick: () => this.navigate(t.id),
        onKeyDown: (ev) => {
          const to = ev.key === 'ArrowRight' ? i + 1 : ev.key === 'ArrowLeft' ? i - 1 : ev.key === 'Home' ? 0 : ev.key === 'End' ? TABS.length - 1 : undefined;
          if (to === undefined) return;
          ev.preventDefault();
          go(to);
        },
      }, icon(t.icon), h('span', { cls: 'helm-tab-label', text: t.label }));
      this.tabButtons.set(t.id, b);
      list.appendChild(b);
    });
    this.indexingHint = h('span', { cls: 'helm-hint helm-indexing', text: 'indexing…' });
    bar.append(list, h('span', { cls: 'helm-spacer' }), this.indexingHint,
      iconButton('search', 'Search everything (tasks, projects, notes, drawings)', () => openSearch(this.ctx()), 'helm-tab-search'),
      iconButton('plus', 'Capture (quick add)', () => openCapture(this.ctx(), this.tab === 'today' ? { date: this.todayState.date } : {}), 'helm-tab-capture'),
      iconButton('refresh-cw', 'Rebuild index', () => { const ctx = this.ctx(); void ctx.run('Rebuild index', () => ctx.index.rebuild()); }));
    return bar;
  }

  private syncTabBar(ready: boolean): void {
    for (const [id, b] of this.tabButtons) {
      const on = id === this.tab;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', String(on));
      b.setAttribute('tabindex', on ? '0' : '-1');
    }
    setShown(this.indexingHint, !ready);
  }

  /** Hidden behind another tab: Obsidian keeps the leaf's DOM, so the render can wait until it shows. */
  private hidden(): boolean {
    const el = (this as { containerEl?: HTMLElement }).containerEl as (HTMLElement & { isShown?: () => boolean }) | undefined;
    return typeof el?.isShown === 'function' && !el.isShown();
  }

  render(): void {
    if (!this.body || this.closed) return;
    if (this.hidden()) { this.stale = true; return; }
    this.stale = false;
    const ctx = this.ctx();
    this.syncTabBar(ctx.index.ready);
    this.body.setAttribute('aria-label', TABS.find((t) => t.id === this.tab)?.label ?? '');

    const focus = rememberFocus(this.body);
    this.scrollTop.set(this.scrollKey(), this.body.scrollTop);
    this.disposers.run();
    clear(this.body);
    this.body.setAttribute('data-tab', this.tab);
    // Whatever the tab, a selection is shown and acted on in the same place.
    selection.prune((k) => ctx.index.task(k) !== undefined);
    const bar = selectionBar(ctx);
    if (bar) this.body.appendChild(bar);
    collecting(this.disposers, () => this.renderTab(ctx));
    const st = this.scrollTop.get(this.scrollKey());
    if (st) this.body.scrollTop = st;
    restoreFocus(this.body, focus);
  }

  private renderTab(ctx: UiContext): void {
    try {
      switch (this.tab) {
        case 'today': renderToday(ctx, this.body, this.todayState); break;
        case 'week': renderCalendar(ctx, this.body, this.weekState); break;
        case 'projects': renderProjects(ctx, this.body, this.projectsState); break;
        case 'inbox': renderInbox(ctx, this.body, this.inboxState); break;
        case 'review': renderReview(ctx, this.body, this.reviewState); break;
        case 'horizons': renderHorizons(ctx, this.body, this.horizonsState); break;
        case 'dashboard': renderDashboard(ctx, this.body, this.dashboardState); break;
        case 'habits': renderHabits(ctx, this.body, this.habitsState); break;
      }
    } catch (e) {
      console.error('[helm] render failed', e);
      this.body.appendChild(h('div', { cls: 'helm-banner is-error', text: `Helm could not render this tab: ${(e as Error).message}` }));
    }
  }

  private scrollKey(): string {
    return `${this.tab}:${this.tab === 'projects' ? this.projectsState.projectId ?? '' : this.tab === 'today' ? this.todayState.date : ''}`;
  }
}
