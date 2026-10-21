/**
 * The index lags the disk (a 250 ms debounce plus a read). Every write Helm makes must land on the line
 * it means, found again by what it is — never on whatever now sits at the index's old line number (CD-01).
 */
import { describe, expect, it } from 'vitest';
import { setup, dailyPath, editBehindIndex, keyOf, TODAY } from './fixture';
import { LineMovedError } from '../../src/data/mutations';

const INBOX = '01 INBOX/Inbox.md';
const BOOK = '02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md';
const insertAbove = (marker: string, line: string) => (c: string): string => c.replace(marker, `${line}\n${marker}`);

describe('writes after the vault moved on behind the index (CD-01)', () => {
  it('setStatus ticks the task it was asked about, not the line now at its old number', async () => {
    const { vault, index, m } = await setup();
    const key = keyOf(index, 'Call the plumber');
    editBehindIndex(vault, INBOX, insertAbove('- [ ] Call the plumber', '- [ ] Call the bank'));
    await m.setStatus(key, 'done');
    const c = vault.files.get(INBOX)!;
    expect(c).toContain('- [ ] Call the bank\n');
    expect(c).toMatch(/- \[x\] Call the plumber ✅ 2026-08-26/);
  });

  it('updateTask, setProgress and ensureId find the line again', async () => {
    const { vault, index, m } = await setup();
    const key = keyOf(index, 'Buy reference books');
    editBehindIndex(vault, BOOK, insertAbove('- [ ] Buy reference books', '- [ ] Order the paper'));
    await m.updateTask(key, { priority: 'high' });
    expect(vault.files.get(BOOK)).toMatch(/- \[ \] Buy reference books .*⏫/);
    expect(vault.files.get(BOOK)).toContain('- [ ] Order the paper\n');
    editBehindIndex(vault, BOOK, insertAbove('- [ ] Order the paper', '- [ ] Ring the printer'));
    const id = await m.ensureId(keyOf(index, 'Buy reference books'));
    expect(vault.files.get(BOOK)).toContain(`🆔 ${id}`);
    expect(vault.files.get(BOOK)).toContain('- [ ] Ring the printer\n- [ ] Order the paper\n');
  });

  it('deleteTask removes the task and its subtree, not its new neighbour', async () => {
    const { vault, index, m } = await setup();
    const key = keyOf(index, 'Renew passport');
    editBehindIndex(vault, INBOX, insertAbove('- [ ] Renew passport', '- [ ] Keep me'));
    await m.deleteTask(key);
    const c = vault.files.get(INBOX)!;
    expect(c).toContain('- [ ] Keep me');
    expect(c).not.toMatch(/Renew passport|Find photo/);
  });

  it('a recurring task\'s next turn goes in beside it', async () => {
    const { vault, index, m } = await setup();
    const key = keyOf(index, 'Chapter 2');
    editBehindIndex(vault, BOOK, insertAbove('- [ ] Chapter 1', '- [ ] Interlude'));
    await m.setStatus(key, 'done');
    const c = vault.files.get(BOOK)!;
    expect(c).toMatch(/- \[ \] Interlude\n- \[ \] Chapter 1 📅 2026-08-20\n- \[ \] Chapter 2 .*\n- \[x\] Chapter 2 🆔 tsk-0002 🔁 every week/);
  });

  it('reconcile writes a mirror\'s status onto the source line, wherever it now is', async () => {
    const today = dailyPath(TODAY);
    const { vault, index, m } = await setup({
      [today]: '# Day planner\n\n### Anytime\n- [x] Chapter 2 🆔 tsk-0002 🔁 every week 🔗 [[Oracle Book Writing]] ✅ 2026-08-26\n',
    });
    expect(index.task('tsk-0002')?.status).toBe('todo');
    editBehindIndex(vault, BOOK, insertAbove('- [ ] Chapter 2', '- [ ] Chapter 1b'));
    await m.reconcile();
    const c = vault.files.get(BOOK)!;
    expect(c).toContain('- [ ] Chapter 1b\n');
    expect(c).toMatch(/- \[x\] Chapter 2 🆔 tsk-0002/);
  });

  it('reconcile rewrites a mirror line, not the line that took its place', async () => {
    const today = dailyPath(TODAY);
    const { vault, index, m } = await setup({
      [today]: '# Day planner\n\n### Anytime\n- [ ] Draft the chapter list 🆔 tsk-0001 🔗 [[Oracle Book Writing]]\n',
    });
    expect(index.mirrorsOf('tsk-0001')).toHaveLength(1);
    editBehindIndex(vault, today, insertAbove('- [ ] Draft the chapter list', '- [ ] My own line'));
    await m.reconcile();
    const c = vault.files.get(today)!;
    expect(c).toContain('- [ ] My own line\n');
    expect(c).toMatch(/- \[ \] Draft chapter list 🆔 tsk-0001 ⏫ 🔗 \[\[Oracle Book Writing\]\]/);
  });

  it('refuses — and writes nothing — when the line is gone altogether', async () => {
    const { vault, index, m } = await setup();
    const key = keyOf(index, 'Call the plumber');
    editBehindIndex(vault, INBOX, (c) => c.replace('- [ ] Call the plumber\n', '- [ ] Something else\n'));
    const before = vault.files.get(INBOX);
    await expect(m.setStatus(key, 'done')).rejects.toBeInstanceOf(LineMovedError);
    expect(vault.files.get(INBOX)).toBe(before);
  });

  it('daybook edits and deletes reach the entry the caller saw', async () => {
    const day = dailyPath('2026-08-25');
    const { vault, index, m } = await setup();
    await m.addDaybookEntry('2026-08-25', 'Coffee with Sam', { time: '09:00' });
    await m.addDaybookEntry('2026-08-25', 'Fixed the router', { time: '11:00' });
    const [first, second] = index.daybook('2026-08-25');
    expect(second!.text).toBe('Fixed the router');
    editBehindIndex(vault, day, (c) => c.replace(/(- \*\*09:00\*\* .*Coffee with Sam)/, '- **08:30** ⌨️ Early start\n\n$1'));
    await m.updateDaybookEntry('2026-08-25', second!.line, 'Fixed the router at last');
    expect(vault.files.get(day)).toMatch(/Early start[\s\S]*Coffee with Sam[\s\S]*Fixed the router at last/);
    const coffee = index.daybook('2026-08-25').find((e) => e.text === 'Coffee with Sam')!;
    editBehindIndex(vault, day, (c) => c.replace(/(- \*\*08:30\*\* .*Early start)/, '- **08:00** ⌨️ Earlier still\n\n$1'));
    await m.removeDaybookEntry('2026-08-25', coffee.line);
    const c = vault.files.get(day)!;
    expect(c).not.toContain('Coffee with Sam');
    expect(c).toMatch(/Earlier still[\s\S]*Early start[\s\S]*Fixed the router at last/);
    // A caller holding an older line number than the index says what it saw, and that is what is found.
    expect(first!.text).toBe('Coffee with Sam');
    await m.updateDaybookEntry('2026-08-25', first!.line, 'Never mind', { time: '11:00', text: 'Fixed the router at last' });
    expect(vault.files.get(day)).toMatch(/Earlier still[\s\S]*Early start[\s\S]*\*\*11:00\*\* ⌨️ Never mind/);
  });

  it('phase edits find the phase heading again', async () => {
    const { vault, m } = await setup();
    editBehindIndex(vault, BOOK, (c) => c.replace('# Oracle Book Writing\n', '# Oracle Book Writing\n\nA line of context.\nAnd another.\n'));
    await m.renamePhase('prj-book', 'prj-book#writing', 'Drafting');
    let c = vault.files.get(BOOK)!;
    expect(c).toContain('## Phase: Drafting\n');
    expect(c).toContain('## Phase: Outline 📅 2026-09-15');
    expect(c).toContain('A line of context.\nAnd another.\n');
    editBehindIndex(vault, BOOK, (c) => c.replace('A line of context.\n', 'A line of context.\nOne more.\n'));
    await m.deletePhase('prj-book', 'prj-book#outline');
    c = vault.files.get(BOOK)!;
    expect(c).not.toContain('## Phase: Outline');
    expect(c).toContain('## Phase: Drafting');
    expect(c).toContain('- [ ] Draft chapter list 🆔 tsk-0001');
    expect(c).toContain('A line of context.\nOne more.\nAnd another.\n');
  });
});
