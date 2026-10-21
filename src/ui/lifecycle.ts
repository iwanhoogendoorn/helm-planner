/**
 * Clean-ups for what a render starts: an interval, a ResizeObserver, a queued frame. The view collects
 * them while it renders and runs them before the next render and when it closes, so nothing a
 * discarded tree started keeps running against detached nodes. Outside a view render (a modal, a
 * test) there is no collector and `onDispose` is a no-op; such callers also stop on disconnect.
 */
export class Disposers {
  private fns: (() => void)[] = [];
  add(fn: () => void): void { this.fns.push(fn); }
  run(): void {
    const fns = this.fns;
    this.fns = [];
    for (const fn of fns) { try { fn(); } catch (e) { console.error('[helm] clean-up failed', e); } }
  }
  get size(): number { return this.fns.length; }
}

let active: Disposers | undefined;

/** Register a clean-up with the render in progress, if any. */
export function onDispose(fn: () => void): void { active?.add(fn); }

/** Run `fn` with `d` collecting the clean-ups it registers. */
export function collecting<T>(d: Disposers, fn: () => T): T {
  const prev = active;
  active = d;
  try { return fn(); } finally { active = prev; }
}

/**
 * Keep keyboard focus across a re-render. Elements that should keep focus carry `data-focus-key`; the
 * key, and the caret for a text field, are read before the tree is thrown away and put back on the
 * element with the same key in the new tree.
 */
export interface FocusMemo { key: string; start: number | null; end: number | null }

export function rememberFocus(root: HTMLElement): FocusMemo | undefined {
  const el = root.ownerDocument.activeElement as HTMLElement | null;
  if (!el || !root.contains(el)) return undefined;
  const key = el.getAttribute('data-focus-key');
  if (!key) return undefined;
  const field = el as HTMLInputElement;
  let start: number | null = null;
  let end: number | null = null;
  try { start = field.selectionStart ?? null; end = field.selectionEnd ?? null; } catch { /* not a text field */ }
  return { key, start, end };
}

export function restoreFocus(root: HTMLElement, memo: FocusMemo | undefined): void {
  if (!memo) return;
  const el = [...root.querySelectorAll<HTMLElement>('[data-focus-key]')].find((x) => x.getAttribute('data-focus-key') === memo.key);
  if (!el) return;
  el.focus({ preventScroll: true });
  const field = el as HTMLInputElement;
  if (memo.start !== null && typeof field.setSelectionRange === 'function') {
    const len = field.value?.length ?? 0;
    try { field.setSelectionRange(Math.min(memo.start, len), Math.min(memo.end ?? memo.start, len)); } catch { /* not a text field */ }
  }
}
