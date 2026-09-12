/**
 * A vault-relative path an outside caller may name. The API, the mutations and the Obsidian adapter
 * all check with this before touching a file: nothing absolute, nothing that climbs out with `..`,
 * no control characters — a path that fails here is refused, never "normalised" into something else.
 */
export function isSafeVaultPath(p: string): boolean {
  if (typeof p !== 'string' || p === '') return false;
  if (/[\u0000-\u001f\u007f]/.test(p)) return false;
  if (p.startsWith('/') || p.startsWith('\\') || /^[a-zA-Z]:/.test(p)) return false;
  return p.split(/[\/\\]/).every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

/** The path, trimmed of a trailing slash, when it is safe; undefined otherwise. */
export function safeVaultPath(p: string | undefined): string | undefined {
  if (p === undefined) return undefined;
  const s = p.trim().replace(/\/+$/, '');
  return isSafeVaultPath(s) ? s : undefined;
}

/** A folder an outside caller may name for a new file: safe, or empty for "the default". */
export function safeFolder(f: string | undefined): { ok: true; folder?: string } | { ok: false; error: string } {
  if (f === undefined || f.trim() === '') return { ok: true };
  const s = safeVaultPath(f);
  return s === undefined ? { ok: false, error: `Not a folder inside the vault: ${f}` } : { ok: true, folder: s };
}
