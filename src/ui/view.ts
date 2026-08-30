/** The Helm leaf: a tab bar and one tab body, re-rendered from the index. */
import { ItemView, WorkspaceLeaf } from 'obsidian';
import type { IsoDate } from '../core/types';
import { clear, h, icon, iconButton } from './dom';
import type { TabId, UiContext } from './context';
import { selection, selectionBar } from './selection';
import { renderToday, type TodayState } from './tabs/today';
import { renderCalendar, type CalendarState } from './tabs/calendar';
import { renderProjects, type ProjectsState } from './tabs/projects';
import { renderInbox, type InboxState } from './tabs/inbox';
import { renderReview, type ReviewState } from './tabs/review';
import { renderHorizons, type HorizonsState } from './tabs/horizons';
import { renderDashboard, type DashboardState, defaultDashboardState } from './tabs/dashboard';
import { openCapture } from './modals/capture';
import { openSearch } from './modals/search';

export const VIEW_TYPE = 'helm-view';

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'today', label: 'Today', icon: 'sun' },
  { id: 'week', label: 'Calendar', icon: 'calendar-range' },
  { id: 'projects', label: 'Projects', icon: 'folder-kanban' },
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
  private projectsState: ProjectsState = { filter: '', showClosed: false, collapsed: new Map(), showDone: false };
  private inboxState: InboxState = { collapsed: new Map() };
  private reviewState: ReviewState = { collapsed: new Map(), checks: new Set() };
  private horizonsState: HorizonsState;
  private dashboardState: DashboardState = defaultDashboardState();
  private body!: HTMLElement;
  private tabBar!: HTMLElement;
  private scrollTop = new Map<string, number>();
  private scheduled = false;

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
    this.tabBar = h('div', { cls: 'helm-tabs' });
    this.body = h('div', { cls: 'helm-body' });
    root.append(this.tabBar, this.body);
    this.tab = this.ctx().settings().defaultTab;
    this.render();
  }

  override async onClose(): Promise<void> {
    clear(this.contentEl);
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
    if (this.scheduled) return;
    this.scheduled = true;
    window.requestAnimationFrame(() => { this.scheduled = false; this.render(); });
  }

  render(): void {
    if (!this.body) return;
    const ctx = this.ctx();
    clear(this.tabBar);
    for (const t of TABS) {
      this.tabBar.appendChild(h('button', { cls: ['helm-tab', this.tab === t.id && 'is-active'], title: t.label, onClick: () => this.navigate(t.id) }, icon(t.icon), h('span', { cls: 'helm-tab-label', text: t.label })));
    }
    this.tabBar.appendChild(h('span', { cls: 'helm-spacer' }));
    if (!ctx.index.ready) this.tabBar.appendChild(h('span', { cls: 'helm-hint helm-indexing', text: 'indexing…' }));
    this.tabBar.appendChild(iconButton('search', 'Search everything (tasks, projects, notes, drawings)', () => openSearch(ctx), 'helm-tab-search'));
    this.tabBar.appendChild(iconButton('plus', 'Capture (quick add)', () => openCapture(ctx, this.tab === 'today' ? { date: this.todayState.date } : {}), 'helm-tab-capture'));
    this.tabBar.appendChild(iconButton('refresh-cw', 'Rebuild index', () => void ctx.run('Rebuild index', () => ctx.index.rebuild())));

    this.scrollTop.set(this.scrollKey(), this.body.scrollTop);
    clear(this.body);
    this.body.setAttribute('data-tab', this.tab);
    // Whatever the tab, a selection is shown and acted on in the same place.
    selection.prune((k) => ctx.index.task(k) !== undefined);
    const bar = selectionBar(ctx);
    if (bar) this.body.appendChild(bar);
    try {
      switch (this.tab) {
        case 'today': renderToday(ctx, this.body, this.todayState); break;
        case 'week': renderCalendar(ctx, this.body, this.weekState); break;
        case 'projects': renderProjects(ctx, this.body, this.projectsState); break;
        case 'inbox': renderInbox(ctx, this.body, this.inboxState); break;
        case 'review': renderReview(ctx, this.body, this.reviewState); break;
        case 'horizons': renderHorizons(ctx, this.body, this.horizonsState); break;
        case 'dashboard': renderDashboard(ctx, this.body, this.dashboardState); break;
      }
    } catch (e) {
      console.error('[helm] render failed', e);
      this.body.appendChild(h('div', { cls: 'helm-banner is-error', text: `Helm could not render this tab: ${(e as Error).message}` }));
    }
    const st = this.scrollTop.get(this.scrollKey());
    if (st) this.body.scrollTop = st;
  }

  private scrollKey(): string {
    return `${this.tab}:${this.tab === 'projects' ? this.projectsState.projectId ?? '' : this.tab === 'today' ? this.todayState.date : ''}`;
  }
}
