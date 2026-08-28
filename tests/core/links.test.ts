import { describe, expect, it } from 'vitest';
import { addLinkToText, linkLabel, linksIn, removeLinkFromText } from '../../src/core/links';

describe('task links', () => {
  it('finds markdown links and bare URLs, labels bare ones by host and path', () => {
    const text = 'UC3 (NAT on DRG) || Hi on this? https://jira-sd.mc1.oracleiaas.com/browse/RSC-132207. See [design](https://example.com/a/b?x=1)';
    expect(linksIn(text)).toEqual([
      { url: 'https://example.com/a/b?x=1', label: 'design', raw: '[design](https://example.com/a/b?x=1)' },
      { url: 'https://jira-sd.mc1.oracleiaas.com/browse/RSC-132207', label: 'jira-sd.mc1.oracleiaas.com/browse/RSC-132207', raw: 'https://jira-sd.mc1.oracleiaas.com/browse/RSC-132207' },
    ]);
    expect(linkLabel('https://example.com/')).toBe('example.com');
    expect(linkLabel('https://example.com/a/very/long/path/that/keeps/going/and/going/forever/ok')).toMatch(/^example\.com…/);
  });
  it('adds, upgrades a bare URL in place, and removes', () => {
    expect(addLinkToText('Call Bob', 'https://x.io/t/1', 'ticket')).toBe('Call Bob [ticket](https://x.io/t/1)');
    expect(addLinkToText('Call Bob', 'https://x.io/t/1')).toBe('Call Bob [x.io/t/1](https://x.io/t/1)');
    expect(addLinkToText('See https://x.io/t/1 today', 'https://x.io/t/1', 'ticket')).toBe('See [ticket](https://x.io/t/1) today');
    expect(removeLinkFromText('See [ticket](https://x.io/t/1) today', 'https://x.io/t/1')).toBe('See today');
    expect(removeLinkFromText('See https://x.io/t/1', 'https://x.io/t/1')).toBe('See');
    expect(removeLinkFromText('Nothing', 'https://x.io/t/1')).toBe('Nothing');
  });
});
