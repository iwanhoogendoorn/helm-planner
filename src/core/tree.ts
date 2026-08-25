/**
 * Indentation → depth/parent, and code-fence awareness.
 *
 * Column width: space = 1, tab advances to the next multiple of 2. Two lines
 * with equal width are siblings. A non-list, non-blank line resets the tree.
 */
import { LIST_ITEM_RE } from './taskLine';

export function columnWidth(indent: string): number {
  let col = 0;
  for (const ch of indent) col += ch === '\t' ? 2 - (col % 2) : 1;
  return col;
}

export interface FenceState { open: boolean; char: string; len: number }

export function fenceStart(): FenceState {
  return { open: false, char: '', len: 0 };
}

/** Feed a line; returns true when the line is inside (or delimits) a fence. */
export function fenceStep(state: FenceState, line: string): boolean {
  const m = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!state.open) {
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      state.open = true;
      state.char = m[1]![0]!;
      state.len = m[1]!.length;
      return true;
    }
    return false;
  }
  if (m && m[1]![0] === state.char && m[1]!.length >= state.len && m[2]!.trim() === '') {
    state.open = false;
    return true;
  }
  return true;
}

export interface Nested { index: number; depth: number; parent: number | undefined }

/**
 * Given the indices of task lines in a document (and the document), compute
 * depth/parent for each. `isTask(i)` tells whether line i is a task line;
 * `indentOf(i)` its leading whitespace.
 */
export function nest(lines: string[], isTask: (i: number) => boolean, indentOf: (i: number) => string): Map<number, Nested> {
  const out = new Map<number, Nested>();
  const stack: { w: number; i: number }[] = [];
  const fence = fenceStart();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (fenceStep(fence, line)) { stack.length = 0; continue; }
    if (isTask(i)) {
      const w = columnWidth(indentOf(i));
      while (stack.length > 0 && stack[stack.length - 1]!.w >= w) stack.pop();
      out.set(i, { index: i, depth: stack.length, parent: stack[stack.length - 1]?.i });
      stack.push({ w, i });
      continue;
    }
    if (line.trim() === '') continue;
    if (LIST_ITEM_RE.test(line)) continue;
    stack.length = 0;
  }
  return out;
}

export function isHeading(line: string): { level: number; text: string } | undefined {
  const m = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
  return m ? { level: m[1]!.length, text: m[2]! } : undefined;
}
