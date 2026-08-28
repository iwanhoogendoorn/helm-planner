import { describe, expect, it } from 'vitest';
import { plainLabel, shortLabel } from '../../src/core/label';

describe('readable task labels', () => {
  it('drops links and tags, reduces wikilinks to their label, squashes whitespace', () => {
    expect(plainLabel('#followup UC3 (NAT on DRG) || [[NAT-DRG-UC3 - 2026.excalidraw]] || Update on Jira Ticket? [Jira](https://j.io/1)'))
      .toBe('UC3 (NAT on DRG) || NAT-DRG-UC3 - 2026.excalidraw || Update on Jira Ticket?');
    expect(plainLabel('Read [[Book|the book]] #reading')).toBe('Read the book');
    expect(plainLabel('Ping https://x.io/a #followup')).toBe('Ping');
  });
  it('cuts on a word boundary', () => {
    expect(shortLabel('a'.repeat(60))).toHaveLength(48);
    expect(shortLabel('Update the routing tables on every edge router today', 20)).toBe('Update the routing…');
    expect(shortLabel('Short one')).toBe('Short one');
  });
});
