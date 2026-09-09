/** A short, readable version of a task's text for chips and titles. */
import { linksIn } from './links';

/** Links dropped, `[[Note|label]]` reduced to its label, tags removed, whitespace squashed. */
/** The `[[note]]` a task or one of its ancestors points at (a song under a music project), by key. */
export function linkedNoteOf(text: string, parentText: (key: string) => string | undefined, parentKeyOf: (key: string) => string | undefined, key: string): string | undefined {
  let cur: string | undefined = key;
  let t: string | undefined = text;
  for (let i = 0; i < 8 && t !== undefined; i++) {
    const m = /\[\[([^\]|#]+)/.exec(t);
    if (m) return m[1]!.trim();
    cur = cur ? parentKeyOf(cur) : undefined;
    t = cur ? parentText(cur) : undefined;
  }
  return undefined;
}

export function plainLabel(text: string): string {
  let out = text;
  for (const l of linksIn(text)) out = out.replace(l.raw, '');
  out = out.replace(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, target: string, alias?: string) => (alias ?? target).trim());
  out = out.replace(/(^|\s)#[\p{L}\p{N}_\-/]+/gu, '$1');
  return out.replace(/`/g, '').replace(/\*\*/g, '').replace(/\s{2,}/g, ' ').replace(/\s*\|\|\s*$/, '').trim();
}

/** `plainLabel`, cut to `max` characters on a word boundary. */
export function shortLabel(text: string, max = 48): string {
  const s = plainLabel(text);
  return s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…` : s;
}
