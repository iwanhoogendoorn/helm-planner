import { describe, expect, it } from 'vitest';
import { parseDayPictures } from '../../src/core/dayPictures';

describe('parseDayPictures', () => {
  it('reads the bot’s embeds by alias or name, each kind once, in day order, and leaves a morning comic out', () => {
    const note = [
      '## 🌙 Evening comic', '![[99 ATTACHMENTS/e.jpg|evening-comic 2026-10-31]]',
      '![[99 ATTACHMENTS/q.jpg|quote-card 2026-10-31]]',
      '![[comic-morning-2026-10-31.jpg|morning-comic 2026-10-31]]', '![[comic-morning-other.jpg]]',
      '![[Backlog Tasks]]', '![[holiday.png|photo]]',
    ].join('\n');
    expect(parseDayPictures(note)).toEqual([
      { kind: 'quote', link: '99 ATTACHMENTS/q.jpg' },
      { kind: 'evening', link: '99 ATTACHMENTS/e.jpg' },
    ]);
  });

  it('counts a bare comic file name without an alias', () => {
    expect(parseDayPictures('![[comic-evening-2026-11-01.webp]]')).toEqual([{ kind: 'evening', link: 'comic-evening-2026-11-01.webp' }]);
  });
});
