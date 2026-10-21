/**
 * The UI, the API and the reconcile all write through one Mutations. Two operations on one note at once
 * must both land: every read-modify-write of a path waits its turn, and uses the vault's atomic
 * `process` when it has one (CD-02).
 */
import { describe, expect, it, vi } from 'vitest';
import { setup, dailyPath, keyOf, TODAY } from './fixture';
import { MemoryVault } from '../../src/data/vault';

const INBOX = '01 INBOX/Inbox.md';

/** A vault whose reads take a while, so two writers would read the same old content without the lock. */
function slowReads(vault: MemoryVault): void {
  const read = vault.read.bind(vault);
  vault.read = async (p: string) => { const c = await read(p); await new Promise((r) => setTimeout(r, 5)); return c; };
}

describe('concurrent writes to one note (CD-02)', () => {
  for (const atomic of [true, false]) {
    describe(atomic ? 'with an atomic process' : 'with read-then-write only', () => {
      const prepare = async () => {
        const s = await setup();
        if (!atomic) (s.vault as { process?: unknown }).process = undefined;
        else {
          // The atomic path, but slow enough that two transforms would overlap without the lock.
          const proc = s.vault.process.bind(s.vault);
          s.vault.process = async (p, fn) => { await new Promise((r) => setTimeout(r, 5)); return proc(p, fn); };
        }
        slowReads(s.vault);
        return s;
      };

      it('two status changes on one file both stick', async () => {
        const { vault, index, m } = await prepare();
        await Promise.all([m.setStatus(keyOf(index, 'Call the plumber'), 'done'), m.setStatus(keyOf(index, 'Find photo'), 'done')]);
        const c = vault.files.get(INBOX)!;
        expect(c).toMatch(/- \[x\] Call the plumber/);
        expect(c).toMatch(/- \[x\] Find photo/);
      });

      it('five captures at once all reach the inbox', async () => {
        const { vault, m } = await prepare();
        await Promise.all([1, 2, 3, 4, 5].map((n) => m.addTask({ text: `Captured ${n}` })));
        const c = vault.files.get(INBOX)!;
        for (const n of [1, 2, 3, 4, 5]) expect(c).toContain(`- [ ] Captured ${n}`);
      });

      it('the reconcile and a user action on the same notes do not undo each other', async () => {
        const today = dailyPath(TODAY);
        const { vault, index, m } = await prepare();
        await m.schedule(keyOf(index, 'Chapter 2'), TODAY);
        const mirror = index.mirrorsOf('tsk-0002')[0]!;
        // Ticked on the day note in the editor: the reconcile will carry it to the source...
        vault.files.set(today, vault.files.get(today)!.replace(/- \[ \] (.*Chapter 2)/, '- [x] $1 ✅ 2026-08-26'));
        index.update(today, vault.files.get(today)!);
        expect(index.task(mirror.key)?.status).toBe('done');
        // ...while the user adds a task to the same project and a line to the same day.
        await Promise.all([
          m.reconcile(),
          m.addTask({ text: 'Proofread', projectId: 'prj-book' }),
          m.addTask({ text: 'Water the plants', date: TODAY }),
        ]);
        const book = vault.files.get('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md')!;
        expect(book).toMatch(/- \[x\] Chapter 2 🆔 tsk-0002/);
        expect(book).toContain('- [ ] Proofread');
        expect(vault.files.get(today)).toContain('Water the plants');
      });
    });
  }

  it('goes through the vault\'s process, so an editor save in between is kept', async () => {
    const { vault, index, m } = await setup();
    const proc = vi.spyOn(vault, 'process');
    const write = vi.spyOn(vault, 'write');
    // An edit lands on disk after the index was read but before Helm's write: process sees it.
    vault.files.set(INBOX, vault.files.get(INBOX)! + '- [ ] Typed in the editor\n');
    await m.setStatus(keyOf(index, 'Call the plumber'), 'done');
    expect(proc).toHaveBeenCalled();
    expect(write).toHaveBeenCalledTimes(1); // from inside process, with the transformed current content
    expect(vault.files.get(INBOX)).toMatch(/- \[x\] Call the plumber[\s\S]*- \[ \] Typed in the editor/);
  });

  it('a failed write releases the file for the next one', async () => {
    const { vault, index, m } = await setup();
    const key = keyOf(index, 'Call the plumber');
    vault.files.set(INBOX, '# Inbox\n'); // the line is gone: the first write refuses
    await expect(m.setStatus(key, 'done')).rejects.toThrow(/moved under us/);
    await m.addTask({ text: 'Still writable' });
    expect(vault.files.get(INBOX)).toContain('- [ ] Still writable');
  });

  it('two writers making one new day note make it once', async () => {
    const { vault, m } = await setup();
    const day = '2026-08-27';
    const writes = vi.spyOn(vault, 'write');
    await Promise.all([m.addTask({ text: 'One', date: day }), m.addTask({ text: 'Two', date: day })]);
    const c = vault.files.get(dailyPath(day))!;
    expect(c).toContain('One');
    expect(c).toContain('Two');
    expect(c.match(/^title:/gm)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(writes.mock.calls.filter(([p]) => p === dailyPath(day)).length).toBeGreaterThan(0);
  });
});
