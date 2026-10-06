import { describe, expect, it } from 'vitest';
import { setup, dailyPath, DAILY_YESTERDAY } from './fixture';
import { parseTaskLine, serialiseTaskLine } from '../../src/core/taskLine';

/** A weekly meeting: last Tuesday's done, next Tuesday's waiting (today is Wednesday 26 Aug). */
async function meeting(rule = 'every week') {
  const s = await setup({
    [dailyPath('2026-08-25')]: DAILY_YESTERDAY.replace('### Anytime\n', `### Anytime\n- [x] 10:00 - 11:00: Team sync #meeting 🔁 ${rule} ✅ 2026-08-25\n`),
    [dailyPath('2026-09-01')]: `# Day planner\n\n### A. Morning\n- [ ] 10:00 - 11:00: Team sync #meeting 🔁 ${rule}\n`,
  });
  const on = (d: string) => s.index.allTasks().filter((t) => t.text.startsWith('Team sync') && t.noteDate === d);
  const open = () => s.index.allTasks().filter((t) => t.text.startsWith('Team sync') && t.status === 'todo').map((t) => `${t.noteDate} ${t.time?.start ?? '-'} ${t.part}`).sort();
  return { ...s, on, open };
}

describe('moving one turn of a repeating task', () => {
  it('moves only that turn: the day it left stays empty and the series keeps its day', async () => {
    for (const rule of ['every week', 'every week on Tuesday']) {
      const s = await meeting(rule);
      await s.m.schedule(s.on('2026-09-01')[0]!.key, '2026-09-02');
      expect(await s.m.catchUpRecurring()).toBe(0);
      expect(s.on('2026-09-01')).toHaveLength(0);
      const moved = s.on('2026-09-02')[0]!;
      expect(moved.movedFrom).toEqual({ date: '2026-09-01', time: { start: '10:00', end: '11:00' } });
      expect(await s.vault.read(dailyPath('2026-09-02'))).toContain('Team sync #meeting [moved from:: 2026-09-01 10:00 - 11:00]');
      await s.m.setStatus(moved.key, 'done');
      expect(s.open()).toEqual(['2026-09-08 10:00 morning']);
      expect(await s.m.catchUpRecurring()).toBe(0);
    }
  });

  it('keeps the series time when one turn moves to another time, and the new day’s part', async () => {
    const s = await meeting();
    await s.m.scheduleAt(s.on('2026-09-01')[0]!.key, '2026-09-02', { start: '15:00', end: '16:00' });
    const moved = s.on('2026-09-02')[0]!;
    expect(moved.time).toEqual({ start: '15:00', end: '16:00' });
    expect(moved.part).toBe('afternoon');
    expect(moved.movedFrom).toEqual({ date: '2026-09-01', time: { start: '10:00', end: '11:00' } });
    await s.m.setStatus(moved.key, 'done');
    expect(s.open()).toEqual(['2026-09-08 10:00 morning']);
  });

  it('a later time on the same day is a move of that turn too', async () => {
    const s = await meeting();
    await s.m.updateTask(s.on('2026-09-01')[0]!.key, { time: { start: '14:00', end: '15:00' } });
    expect(s.on('2026-09-01')[0]!.movedFrom).toEqual({ date: '2026-09-01', time: { start: '10:00', end: '11:00' } });
    await s.m.setStatus(s.on('2026-09-01')[0]!.key, 'done');
    expect(s.open()).toEqual(['2026-09-08 10:00 morning']);
  });

  it('remembers the first turn through several moves, and forgets it when put back', async () => {
    const s = await meeting();
    await s.m.schedule(s.on('2026-09-01')[0]!.key, '2026-09-02');
    await s.m.schedule(s.on('2026-09-02')[0]!.key, '2026-09-05');
    expect(s.on('2026-09-05')[0]!.movedFrom?.date).toBe('2026-09-01');
    await s.m.schedule(s.on('2026-09-05')[0]!.key, '2026-09-01', 'morning');
    const back = s.on('2026-09-01')[0]!;
    expect(back.movedFrom).toBeUndefined();
    expect(back.time).toEqual({ start: '10:00', end: '11:00' });
    expect(await s.vault.read(dailyPath('2026-09-01'))).not.toContain('moved from');
  });

  it('deleting a moved turn keeps both its days free', async () => {
    const s = await meeting();
    await s.m.schedule(s.on('2026-09-01')[0]!.key, '2026-09-02');
    await s.m.deleteOccurrence(s.on('2026-09-02')[0]!.key, 'once');
    expect(await s.m.catchUpRecurring()).toBe(0);
    expect(s.open()).toEqual([]);
  });

  it('leaves plain tasks, when-done repeats and due-date series alone', async () => {
    const s = await setup({ [dailyPath('2026-09-01')]: '# Day planner\n\n### Anytime\n- [ ] Water plants 🔁 every week when done\n- [ ] Pay rent 📅 2026-09-01 🔁 every month\n- [ ] Call mum\n' });
    for (const text of ['Water plants', 'Pay rent', 'Call mum']) {
      const t = s.index.allTasks().find((x) => x.text === text)!;
      await s.m.schedule(t.key, '2026-09-02');
      expect(s.index.allTasks().find((x) => x.text === text)!.movedFrom).toBeUndefined();
    }
  });

  it('a project task planned for another day is one turn moved, too', async () => {
    const s = await setup({ '02 PROJECTS/Weekly/Weekly.md': '---\ntitle: Weekly\ntype: project\nstatus: active\nid: prj-weekly\n---\n\n# Weekly\n\n## Tasks\n\n- [ ] Weekly report 🆔 tsk-wr ⏳ 2026-09-01 🔁 every week\n' });
    await s.m.schedule('tsk-wr', '2026-09-03');
    expect(s.index.taskById('tsk-wr')!.movedFrom).toEqual({ date: '2026-09-01' });
    await s.m.setStatus('tsk-wr', 'done');
    const next = s.index.allTasks().filter((t) => t.text === 'Weekly report' && t.status === 'todo');
    expect(next.map((t) => t.scheduled)).toEqual(['2026-09-08']);
  });
});

describe('the moved-from field on a line', () => {
  it('reads it from the text or after the fields, and writes it back after the text', () => {
    for (const line of ['- [ ] 10:00 - 11:00: Team sync [moved from:: 2026-09-01 10:00 - 11:00] 🔁 every week', '- [ ] 10:00 - 11:00: Team sync 🔁 every week [moved from:: 2026-09-01 10:00 - 11:00]']) {
      const t = parseTaskLine(line)!;
      expect(t.text).toBe('Team sync');
      expect(t.unknown).toEqual([]);
      expect(t.movedFrom).toEqual({ date: '2026-09-01', time: { start: '10:00', end: '11:00' } });
      expect(serialiseTaskLine(t, { force: true })).toBe('- [ ] 10:00 - 11:00: Team sync [moved from:: 2026-09-01 10:00 - 11:00] 🔁 every week');
    }
    expect(parseTaskLine('- [ ] Report [moved from:: 2026-09-01] 🔁 every week')!.movedFrom).toEqual({ date: '2026-09-01' });
    const untouched = '- [ ] Report [moved from:: 2026-09-01]   🔁 every week';
    expect(serialiseTaskLine(parseTaskLine(untouched)!)).toBe(untouched);
  });
});
