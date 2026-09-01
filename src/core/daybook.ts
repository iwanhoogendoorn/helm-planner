/**
 * The daybook: what happened today, in the order it happened.
 *
 * A day's note keeps it under its own heading, one bullet per moment:
 *
 *     ## Daybook
 *
 *     - **11:13** 🔔 Late-morning pulse check: how is it going?
 *
 *     - **12:49** ⌨️ Picked up a new SR and two meetings.
 *     	- 💬 *A reply, indented under the entry it answers.*
 *
 * Helm reads that shape and writes it back unchanged — the note stays something you can read, edit and
 * sync without Helm, which is the whole point of keeping it in markdown.
 */
import type { Document } from './document';

export interface DaybookReply {
  text: string;
  icon: string;
  line: number;
}

export interface DaybookEntry {
  /** `HH:MM`, as written. */
  time: string;
  /** The emoji after the time — 🔔 for a prompt, ⌨️ for something you typed. */
  icon: string;
  text: string;
  line: number;
  /** One past the last line of this entry, replies included. */
  endLine: number;
  replies: DaybookReply[];
}

export interface Daybook {
  /** The heading's line, or -1 when the note has no daybook yet. */
  heading: number;
  /** First body line, and one past the last. */
  start: number;
  end: number;
  entries: DaybookEntry[];
}

export const DAYBOOK_ENTRY_RE = /^\s*[-*]\s+\*\*(\d{1,2}:\d{2})\*\*\s*(\p{Extended_Pictographic}️?)?\s*(.*)$/u;
const REPLY_RE = /^\s+[-*]\s+(\p{Extended_Pictographic}️?)?\s*\*?(.*?)\*?\s*$/u;

/** The daybook heading of a note, by name (case-insensitive), else -1. */
export function daybookHeading(doc: Document, name: string): number {
  const want = name.trim().toLowerCase().replace(/^#+\s*/, '');
  return doc.headings.find((h) => h.text.trim().toLowerCase() === want)?.line ?? -1;
}

/** Read the daybook out of a note. A note with no daybook heading comes back empty, not broken. */
export function parseDaybook(doc: Document, name: string): Daybook {
  const heading = daybookHeading(doc, name);
  if (heading === -1) return { heading, start: doc.lines.length, end: doc.lines.length, entries: [] };
  const level = doc.headings.find((h) => h.line === heading)!.level;
  let end = doc.lines.length;
  for (const h of doc.headings) if (h.line > heading && h.level <= level) { end = h.line; break; }

  const entries: DaybookEntry[] = [];
  for (let i = heading + 1; i < end; i++) {
    const m = DAYBOOK_ENTRY_RE.exec(doc.lines[i]!);
    if (!m || /^\s/.test(doc.lines[i]!)) continue;                    // indented lines belong to the entry above
    const entry: DaybookEntry = { time: m[1]!, icon: m[2] ?? '', text: m[3]!.trim(), line: i, endLine: i + 1, replies: [] };
    for (let j = i + 1; j < end; j++) {
      const l = doc.lines[j]!;
      if (l.trim() === '') { entry.endLine = j; continue; }           // a blank line does not end the entry
      if (!/^\s/.test(l)) break;                                      // the next top-level line does
      const r = REPLY_RE.exec(l);
      if (r) entry.replies.push({ icon: r[1] ?? '', text: r[2]!.trim(), line: j });
      entry.endLine = j + 1;
    }
    entries.push(entry);
  }
  // Trailing blank lines belong to the section, not to the last entry.
  for (const e of entries) while (e.endLine > e.line + 1 && doc.lines[e.endLine - 1]!.trim() === '') e.endLine--;
  return { heading, start: heading + 1, end, entries };
}

/** One entry, as markdown. */
export function renderEntry(time: string, text: string, icon = '⌨️'): string {
  return `- **${time}** ${icon} ${text.trim()}`;
}

/** A reply under an entry, indented and in italics, the way the bots write them. */
export function renderReply(text: string, indent = '\t', icon = '💬'): string {
  return `${indent}- ${icon} *${text.trim()}*`;
}
