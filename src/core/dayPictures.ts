/**
 * The pictures a daily note carries: the quote card the bot embeds as the day starts, and the comic as it ends.
 * It marks each with an alias (`![[x.jpg|evening-comic 2026-11-01]]`); a bare `comic-evening-…` name counts too.
 * A morning comic is no longer made, and one an older note still embeds is not shown.
 */
export type DayPictureKind = 'quote' | 'evening';

export interface DayPictureLink { kind: DayPictureKind; link: string }

export const DAY_PICTURE_KINDS: DayPictureKind[] = ['quote', 'evening'];

const EMBED_RE = /!\[\[([^\]|#]+\.(?:png|jpe?g|gif|webp))(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/gi;

function kindOf(mark: string): DayPictureKind | undefined {
  const m = mark.toLowerCase();
  if (m.includes('quote-card')) return 'quote';
  if (m.includes('evening-comic') || m.includes('comic-evening')) return 'evening';
  return undefined;
}

/** Each kind once, in day order; the first embed of a kind wins. */
export function parseDayPictures(content: string): DayPictureLink[] {
  const found = new Map<DayPictureKind, string>();
  for (const m of content.matchAll(EMBED_RE)) {
    const link = m[1]!.trim();
    const kind = kindOf(`${m[2] ?? ''} ${link}`);
    if (kind && !found.has(kind)) found.set(kind, link);
  }
  return DAY_PICTURE_KINDS.flatMap((kind) => { const link = found.get(kind); return link ? [{ kind, link }] : []; });
}
