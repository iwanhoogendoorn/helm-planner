/** A short, readable version of a task's text for chips and titles. */
import { linksIn } from './links';

/** Links dropped, `[[Note|label]]` reduced to its label, tags removed, whitespace squashed. */
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
