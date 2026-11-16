/** Id generation and derived keys. */

const ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export type IdPrefix = 'tsk' | 'prj' | 'hab' | 'gol' | 'hsi';

export function randomId(prefix: IdPrefix, length = 6, rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(rng() * ALPHABET.length)];
  return `${prefix}-${s}`;
}

export function uniqueId(prefix: IdPrefix, taken: (id: string) => boolean, rng?: () => number): string {
  for (let i = 0; i < 50; i++) {
    const id = randomId(prefix, i < 20 ? 6 : 8, rng);
    if (!taken(id)) return id;
  }
  throw new Error('Could not generate a unique id');
}

/** FNV-1a 32-bit, base36. Deterministic across runs. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}

/**
 * A key for a line without an id: the file, the text, and which occurrence of
 * that text it is in the file. Stable when lines above it move; changes only
 * when the text itself changes (callers re-fetch by position after a rewrite).
 */
export function derivedKey(path: string, occurrence: number, text: string): string {
  return `d:${hash(`${path} #${occurrence} ${text.trim()}`)}`;
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'untitled';
}
