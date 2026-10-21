/** A rebuild reads the whole vault; what changes while it reads must not be undone by it (CD-08). */
import { describe, expect, it } from 'vitest';
import { setup, keyOf } from './fixture';

const INBOX = '01 INBOX/Inbox.md';

describe('index rebuild (CD-08)', () => {
  it('keeps an update that lands while it is reading', async () => {
    const { vault, index } = await setup();
    const read = vault.read.bind(vault);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    // The rebuild reads the inbox as it was, then waits; meanwhile a mutation writes and updates the index.
    vault.read = async (p: string) => { const c = await read(p); if (p === INBOX) await gate; return c; };
    const building = index.rebuild();
    await new Promise((r) => setTimeout(r, 0));
    const next = vault.files.get(INBOX)!.replace('- [ ] Call the plumber', '- [x] Call the plumber ✅ 2026-08-26');
    vault.files.set(INBOX, next);
    index.update(INBOX, next);
    release();
    await building;
    expect(index.task(keyOf(index, 'Call the plumber'))?.status).toBe('done');
  });

  it('keeps a file that went away while it was reading', async () => {
    const { vault, index } = await setup();
    const read = vault.read.bind(vault);
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    vault.read = async (p: string) => { const c = await read(p); if (p === INBOX) await gate; return c; };
    const building = index.rebuild();
    await new Promise((r) => setTimeout(r, 0));
    vault.files.delete(INBOX);
    index.update(INBOX, undefined);
    release();
    await building;
    expect(index.hasFile(INBOX)).toBe(false);
  });

  it('overlapping calls share one pass and one follow-up, never two at once', async () => {
    const { vault, index, settings } = await setup();
    const list = vault.list.bind(vault);
    let running = 0;
    let most = 0;
    let passes = 0;
    vault.list = async () => { running++; passes++; most = Math.max(most, running); await new Promise((r) => setTimeout(r, 5)); running--; return list(); };
    const a = index.rebuild();
    // A settings change during the pass: the follow-up must see it.
    settings.excludePaths = ['01 INBOX'];
    const b = index.rebuild();
    const c = index.rebuild();
    await Promise.all([a, b, c]);
    expect(most).toBe(1);
    expect(passes).toBe(2);
    expect(index.hasFile(INBOX)).toBe(false);
  });
});
