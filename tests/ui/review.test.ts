// @vitest-environment jsdom
/** Regression tests for the UI review findings (REVIEW-ui.md), one describe per finding. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal, Notice } from '../stubs/obsidian';
import { TODAY } from '../data/fixture';
import { ctxFor } from './helpers';
import type { UiContext } from '../../src/ui/context';
import { taskList } from '../../src/ui/taskRow';
import { followsOf as slowFollows, followUpsOf as slowUps } from '../../src/data/planner';
import { followsOf, followUpsOf } from '../../src/ui/taskLinks';
import { selection } from '../../src/ui/selection';
import { clearFolds } from '../../src/ui/fold';
import { HelmView } from '../../src/ui/view';
import type { TabId } from '../../src/ui/context';
import { startFocus, stopTimer } from '../../src/ui/focusTimer';

/* eslint-disable @typescript-eslint/no-explicit-any */

beforeEach(() => { document.body.innerHTML = ''; Notice.messages = []; Modal.last = undefined; selection.clear(); clearFolds(); });

describe('F1 · follow-up lookups are built once per snapshot', () => {
  it('gives the same answers as the linear scans', async () => {
    const { ctx, m, index } = await ctxFor();
    await m.followUp('tsk-0002', { date: TODAY });
    await m.followUp('tsk-0002', { date: '2026-09-01' });
    const snap = index.snapshot;
    for (const t of snap.tasks.values()) {
      expect(followsOf(snap, t)).toBe(slowFollows(snap, t));
      expect(followUpsOf(snap, t)).toEqual(slowUps(snap, t));
    }
    expect(followUpsOf(snap, index.taskById('tsk-0002')!)).toHaveLength(2);
    void ctx;
  });

  it('does not walk every task once per row when a list renders', async () => {
    const { ctx, index } = await ctxFor();
    const snap = index.snapshot;
    const all = [...snap.tasks.values()];
    let walks = 0;
    const values = snap.tasks.values.bind(snap.tasks);
    (snap.tasks as any).values = () => { walks++; return values(); };
    const rows = [...all, ...all, ...all];      // enough rows that a per-row scan shows
    taskList(ctx, rows);
    expect(walks).toBeLessThanOrEqual(1);
  });
});

/** A Helm view over the fixture, in the document, whose ctx.refresh re-renders it the way the plugin does. */
async function viewFor(tab: TabId, over: Partial<UiContext> = {}) {
  const env = await ctxFor(undefined, over);
  let view!: HelmView;
  const ctx: UiContext = { ...env.ctx, refresh: () => view.render(), navigate: (t, o) => view.navigate(t, o), ...over };
  env.settings.defaultTab = tab;
  view = new HelmView({} as never, () => ctx);
  (view as any).app = { workspace: { requestSaveLayout: () => undefined } };
  document.body.appendChild(view.contentEl);
  await view.onOpen();
  return { ...env, ctx, view, root: view.contentEl };
}

const type = (input: HTMLInputElement, text: string): void => {
  input.focus();
  input.value += text;
  input.setSelectionRange(input.value.length, input.value.length);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};
const key = (el: Element, k: string, init: KeyboardEventInit = {}): void => { el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init })); };
const settle = async (): Promise<void> => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)); };

describe('F2 · the project filter keeps focus while you type', () => {
  it('focus and caret stay in the filter across the re-render each keystroke causes', async () => {
    const { root } = await viewFor('projects');
    const first = root.querySelector<HTMLInputElement>('input[placeholder="Filter projects…"]')!;
    type(first, 'o');
    const now = root.querySelector<HTMLInputElement>('input[placeholder="Filter projects…"]')!;
    expect(now).not.toBe(first);                          // the tab was redrawn…
    expect(document.activeElement).toBe(now);             // …and focus came along
    expect(now.value).toBe('o');
    type(now, 'r');
    const again = root.querySelector<HTMLInputElement>('input[placeholder="Filter projects…"]')!;
    expect(document.activeElement).toBe(again);
    expect(again.value).toBe('or');
    expect(again.selectionStart).toBe(2);
  });
});

describe('F3 · quick-capture boxes keep focus after a submit', () => {
  it('the inbox capture box is focused again after the capture re-renders the tab', async () => {
    const { root, index } = await viewFor('inbox');
    const input = root.querySelector<HTMLInputElement>('.helm-capture-input')!;
    input.focus();
    input.value = 'Call the plumber';
    key(input, 'Enter');
    await settle();
    expect(index.allTasks().some((t) => t.text.includes('Call the plumber'))).toBe(true);
    const now = root.querySelector<HTMLInputElement>('.helm-capture-input')!;
    expect(document.activeElement).toBe(now);
  });

  it('a phase quick-add keeps focus so tasks can be added one after another', async () => {
    const { root, view, index } = await viewFor('projects');
    view.navigate('projects', { projectId: 'prj-book' });
    const box = (): HTMLInputElement => root.querySelector<HTMLInputElement>('.helm-quickadd-input[data-focus-key="quickadd:prj-book#outline"]')!;
    box().focus();
    box().value = 'First';
    key(box(), 'Enter');
    await settle();
    expect(document.activeElement).toBe(box());
    box().value = 'Second';
    key(box(), 'Enter');
    await settle();
    expect(index.allTasks().filter((t) => t.text === 'First' || t.text === 'Second')).toHaveLength(2);
  });
});

describe('F4 · a refresh does not rebuild the tab bar, and a hidden leaf waits', () => {
  it('keeps the same tab buttons and moves the selection', async () => {
    const { root, view } = await viewFor('today');
    const before = root.querySelector('.helm-tab[data-tab="projects"]');
    view.navigate('projects');
    const after = root.querySelector('.helm-tab[data-tab="projects"]');
    expect(after).toBe(before);
    expect(after!.getAttribute('aria-selected')).toBe('true');
    expect(root.querySelector('.helm-tab[data-tab="today"]')!.getAttribute('aria-selected')).toBe('false');
  });

  it('skips a render while hidden and catches up when shown', async () => {
    const { root, view } = await viewFor('today');
    let shown = false;
    (view as any).containerEl = Object.assign(document.createElement('div'), { isShown: () => shown });
    view.navigate('projects');
    expect(root.querySelector('.helm-body')!.getAttribute('data-tab')).toBe('today');
    shown = true;
    view.onResize();
    expect(root.querySelector('.helm-body')!.getAttribute('data-tab')).toBe('projects');
  });
});

describe('F5 · the focus-timer tick belongs to the view that draws it', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('every open Helm leaf ticks its own clock, and closing stops the tick', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const a = await viewFor('today');
    const b = await viewFor('today');
    startFocus(a.ctx, a.index.taskById('tsk-0002')!, 25);
    b.view.render();
    const clocks = (): string[] => [a.root, b.root].map((r) => r.querySelector('.helm-timer-clock')?.textContent ?? '');
    expect(clocks()).toEqual(['25:00', '25:00']);
    vi.advanceTimersByTime(2000);
    expect(clocks()).toEqual(['24:58', '24:58']);       // a global querySelector only ever found the first
    const ticking = vi.getTimerCount();
    await a.view.onClose();
    await b.view.onClose();
    expect(vi.getTimerCount()).toBe(ticking - 2);
    stopTimer(a.ctx);
  });
});

describe('F6 · chart observers are disconnected when their render is replaced', () => {
  const observers: { disconnected: boolean }[] = [];
  beforeEach(() => {
    observers.length = 0;
    (globalThis as any).ResizeObserver = class { disconnected = false; constructor() { observers.push(this); } observe(): void {} disconnect(): void { this.disconnected = true; } };
  });
  afterEach(() => { delete (globalThis as any).ResizeObserver; });

  it('a re-render and a close disconnect every observer the previous render made', async () => {
    const { view } = await viewFor('dashboard');
    const first = [...observers];
    expect(first.length).toBeGreaterThan(0);
    view.render();
    expect(first.every((o) => o.disconnected)).toBe(true);
    const second = observers.slice(first.length);
    await view.onClose();
    expect(second.every((o) => o.disconnected)).toBe(true);
  });
});

describe('F17 · nothing renders after the view closes', () => {
  it('a render queued before close does not run', async () => {
    const { view } = await viewFor('today');
    const body = (view as any).body as HTMLElement;
    view.requestRender();
    await view.onClose();
    await new Promise((r) => setTimeout(r, 50));
    expect(body.childElementCount).toBe(0);
    view.render();
    expect(body.childElementCount).toBe(0);
  });
});

describe('F8 · core navigation works from the keyboard and is announced', () => {
  it('a section header is a focusable button with aria-expanded, toggled by Enter and Space', async () => {
    const { root } = await viewFor('inbox');
    const head = root.querySelector<HTMLElement>('.helm-section-head')!;
    expect(head.getAttribute('role')).toBe('button');
    expect(head.getAttribute('tabindex')).toBe('0');
    expect(head.getAttribute('aria-expanded')).toBe('true');
    key(head, 'Enter');
    expect(head.closest('.helm-section')!.classList.contains('is-collapsed')).toBe(true);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    key(head, ' ');
    expect(head.getAttribute('aria-expanded')).toBe('true');
  });

  it('Enter on a task opens its editor; Enter on a project card opens the project', async () => {
    const { root, view } = await viewFor('projects');
    const card = root.querySelector<HTMLElement>('.helm-project')!;
    expect(card.getAttribute('tabindex')).toBe('0');
    key(card, 'Enter');
    expect(root.querySelector('.helm-body')!.textContent).toContain('Oracle Book Writing');
    view.navigate('projects', { projectId: 'prj-book' });
    const main = root.querySelector<HTMLElement>('.helm-task-main')!;
    expect(main.getAttribute('role')).toBe('button');
    Modal.last = undefined;
    key(main, 'Enter');
    expect(Modal.last).toBeDefined();
  });

  it('a sortable column header sorts from the keyboard and says which way', async () => {
    const { root, view } = await viewFor('projects');
    (view as any).projectsState.listView = 'table';
    view.render();
    const th = root.querySelector<HTMLElement>('th')!;
    expect(th.getAttribute('tabindex')).toBe('0');
    expect(th.getAttribute('aria-sort')).toBe('none');
    key(th, 'Enter');
    expect(th.getAttribute('aria-sort')).toBe('ascending');
    key(th, ' ');
    expect(th.getAttribute('aria-sort')).toBe('descending');
    const row = root.querySelector<HTMLElement>('tbody tr.is-clickable')!;
    expect(row.getAttribute('tabindex')).toBe('0');
    key(row, 'Enter');
    expect(root.querySelector('.helm-body table')).toBeNull();     // opened the project
  });

  it('the tab bar is a tablist; arrow keys move between tabs', async () => {
    const { root } = await viewFor('today');
    expect(root.querySelector('.helm-tablist')!.getAttribute('role')).toBe('tablist');
    const today = root.querySelector<HTMLElement>('.helm-tab[data-tab="today"]')!;
    expect(today.getAttribute('role')).toBe('tab');
    expect(today.getAttribute('tabindex')).toBe('0');
    key(today, 'ArrowRight');
    expect(root.querySelector('.helm-body')!.getAttribute('data-tab')).toBe('week');
    expect(root.querySelector('.helm-tab[data-tab="week"]')!.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(root.querySelector('.helm-tab[data-tab="week"]'));
  });
});

describe('F11 · the progress bar is announced as one', () => {
  it('has the progressbar role and its range', async () => {
    const { progressBar } = await import('../../src/ui/dom');
    const bar = progressBar(0.42);
    expect(bar.getAttribute('role')).toBe('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
  });
});
