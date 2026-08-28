/** Links on a task: markdown links `[label](url)` and bare URLs inside the task text. */

export interface TaskLink { url: string; label: string; raw: string }

const MD_LINK = /\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+|obsidian:\/\/[^)\s]+)\)/g;
const BARE_URL = /(?<![(\]])\bhttps?:\/\/[^\s<>)\]]+/g;

/** A readable label for a URL: host plus a trimmed path (`jira-sd.mc1.oracleiaas.com/browse/RSC-132207`). */
export function linkLabel(url: string): string {
  try {
    const u = new URL(url);
    const path = decodeURIComponent(u.pathname).replace(/\/+$/, '');
    const short = path.length > 40 ? `…${path.slice(-38)}` : path;
    return `${u.host}${short}${u.search ? '?…' : ''}`;
  } catch { return url; }
}

export function linksIn(text: string): TaskLink[] {
  const out: TaskLink[] = [];
  for (const m of text.matchAll(MD_LINK)) out.push({ url: m[2]!, label: m[1]!, raw: m[0] });
  for (const m of text.matchAll(BARE_URL)) {
    const url = m[0].replace(/[.,;:!?]+$/, '');
    if (!out.some((l) => l.url === url)) out.push({ url, label: linkLabel(url), raw: url });
  }
  return out;
}

/** Append a link; an existing bare occurrence of the same URL is upgraded to a labelled link instead. */
export function addLinkToText(text: string, url: string, label?: string): string {
  const u = url.trim();
  const lab = (label ?? '').trim() || linkLabel(u);
  const md = `[${lab}](${u})`;
  const existing = linksIn(text).find((l) => l.url === u);
  if (existing) return text.replace(existing.raw, md);
  return `${text.trim()} ${md}`.trim();
}

export function removeLinkFromText(text: string, url: string): string {
  const existing = linksIn(text).find((l) => l.url === url);
  if (!existing) return text;
  return text.replace(existing.raw, '').replace(/\s{2,}/g, ' ').trim();
}

/** The text with every link taken out — what a row shows when links are drawn as pills instead. */
export function textWithoutLinks(text: string): string {
  let out = text;
  for (const l of linksIn(text)) out = out.replace(l.raw, '');
  return out.replace(/\s{2,}/g, ' ').trim();
}
