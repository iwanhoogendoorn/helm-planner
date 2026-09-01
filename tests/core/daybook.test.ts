import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../src/core/document';
import { parseDaybook, renderEntry, renderReply } from '../../src/core/daybook';

const NOTE = `---\ntitle: 01, Tuesday, Sep, 2026\n---\n\n# Day planner\n\n### Anytime\n- [ ] Something\n\n## Daybook\n\n- **11:13** 🔔 Late-morning pulse check: how is it going?\n\n- **12:49** ⌨️ Picked up a new SR, had two meetings.\n\t- 💬 *New SR and two meetings — what is next?*\n\n- **13:42** ⌨️ Call about heat pumps.\n\t- 💬 *Quotes next week, then.*\n\n## Something else\n\n- not an entry\n`;

describe('reading a daybook', () => {
  it('finds every entry with its time, icon and replies', () => {
    const d = parseDaybook(parseDocument(NOTE), 'Daybook');
    expect(d.entries.map((e) => [e.time, e.icon, e.text])).toEqual([
      ['11:13', '🔔', 'Late-morning pulse check: how is it going?'],
      ['12:49', '⌨️', 'Picked up a new SR, had two meetings.'],
      ['13:42', '⌨️', 'Call about heat pumps.'],
    ]);
    expect(d.entries[1]!.replies.map((r) => [r.icon, r.text])).toEqual([['💬', 'New SR and two meetings — what is next?']]);
    expect(d.entries[0]!.replies).toEqual([]);
    // The section stops at the next heading of the same level.
    expect(d.entries.every((e) => e.line < d.end)).toBe(true);
    expect(parseDocument(NOTE).lines[d.end]).toBe('## Something else');
  });

  it('a note without a daybook comes back empty', () => {
    const d = parseDaybook(parseDocument('---\ntitle: x\n---\n\n# Day planner\n'), 'Daybook');
    expect(d).toMatchObject({ heading: -1, entries: [] });
  });

  it('writes the shape it reads', () => {
    expect(renderEntry('09:05', '  Rang the plumber  ')).toBe('- **09:05** ⌨️ Rang the plumber');
    expect(renderReply('Noted.')).toBe('\t- 💬 *Noted.*');
    const round = parseDaybook(parseDocument(`## Daybook\n\n${renderEntry('09:05', 'Rang the plumber')}\n${renderReply('Noted.')}\n`), 'Daybook');
    expect(round.entries[0]).toMatchObject({ time: '09:05', icon: '⌨️', text: 'Rang the plumber' });
    expect(round.entries[0]!.replies[0]).toMatchObject({ icon: '💬', text: 'Noted.' });
  });
});
