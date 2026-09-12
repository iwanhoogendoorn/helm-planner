import { describe, expect, it } from 'vitest';
import { setup } from './fixture';
import { runBulk } from '../../src/data/bulk';
import { freeWindowsOn } from '../../src/data/conflicts';

describe('runBulk', () => {
  it('stamps ids first, acts once per task, lets a parent cover its subtasks, and reports failures unless told to stop', async () => {
    const { index, m } = await setup();
    const passport = index.allTasks().find((t) => t.text === 'Renew passport')!;
    const kid = index.task(passport.childKeys[0]!)!;
    const plumber = index.allTasks().find((t) => t.text === 'Call the plumber')!;
    const seen: string[] = [];
    const r = await runBulk(index, m, [passport, kid, plumber], async (key, t) => { seen.push(t.text); if (t.text === 'Call the plumber') throw new Error('nope'); await m.setStatus(key, 'done'); });
    expect(seen).toEqual(['Renew passport', 'Call the plumber']);
    expect(r.applied).toHaveLength(1);
    expect(r.covered).toHaveLength(1);
    expect(r.failed).toEqual([{ ref: expect.stringMatching(/^tsk-/), error: 'nope' }]);
    expect(index.allTasks().find((t) => t.text === 'Renew passport')!.id).toMatch(/^tsk-/);
    await expect(runBulk(index, m, [index.allTasks().find((t) => t.text === 'Call the plumber')!], async () => { throw new Error('stop'); }, { stopOnError: true })).rejects.toThrow('stop');
  });
});

describe('freeWindowsOn', () => {
  it('lists every gap long enough inside the window, after what is booked', async () => {
    const { index, m, settings } = await setup();
    await m.addTask({ text: 'A', date: '2026-08-26', fields: { time: { start: '09:00', end: '09:30' } } });
    await m.addTask({ text: 'B', date: '2026-08-26', fields: { time: { start: '11:00', end: '12:00' } } });
    expect(freeWindowsOn(index.snapshot, '2026-08-26', settings, { part: 'morning', minutes: 30 })).toEqual([{ start: '08:00', end: '09:00' }, { start: '09:30', end: '11:00' }]);
    expect(freeWindowsOn(index.snapshot, '2026-08-26', settings, { part: 'morning', minutes: 120 })).toEqual([]);
    expect(freeWindowsOn(index.snapshot, '2026-08-26', settings, { minutes: 240 })).toEqual([{ start: '12:00', end: '22:00' }]);
    expect(freeWindowsOn(index.snapshot, '2026-08-27', settings, { part: 'evening' })).toEqual([{ start: '18:00', end: '22:00' }]);
  });
});
