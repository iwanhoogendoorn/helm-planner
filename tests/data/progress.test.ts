import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';

describe('setting how far along a task is', () => {
  const find = (index: { snapshot: { tasks: Map<string, { text: string; status: string; progress?: number; key: string; path: string }> } }, text: string) =>
    [...index.snapshot.tasks.values()].find((t) => t.text === text)!;

  it('puts the task in progress, writes the percentage, and takes it off again', async () => {
    const { m, index, vault } = await setup();
    const t = find(index, 'Start with OIB');
    await m.setProgress(t.key, 40);
    const after = find(index, 'Start with OIB');
    expect(after.status).toBe('doing');
    expect(after.progress).toBe(40);
    expect(await vault.read(after.path)).toMatch(/- \[\/\] .*Start with OIB.*📈 40%/);

    await m.setProgress(after.key, 65);
    expect(find(index, 'Start with OIB').progress).toBe(65);

    await m.setProgress(find(index, 'Start with OIB').key, undefined);
    const cleared = find(index, 'Start with OIB');
    expect(cleared.progress).toBeUndefined();
    expect(cleared.status).toBe('doing');                       // clearing the number does not un-start it
    expect(await vault.read(cleared.path)).not.toContain('📈');
  });

  it('100% finishes the task, and finishing it clears the percentage', async () => {
    const { m, index, vault } = await setup();
    await m.setProgress(find(index, 'Start with OIB').key, 90);
    await m.setProgress(find(index, 'Start with OIB').key, 100);
    const done = find(index, 'Start with OIB');
    expect(done.status).toBe('done');
    expect(done.progress).toBeUndefined();
    const note = await vault.read(done.path);
    expect(note).toMatch(/- \[x\] .*Start with OIB/);
    expect(note).not.toContain('📈');
  });

  it('refuses a percentage that is not one', async () => {
    const { m, index } = await setup();
    const key = find(index, 'Start with OIB').key;
    await expect(m.setProgress(key, 140)).rejects.toThrow(/0 to 100/);
    await expect(m.setProgress(key, -5)).rejects.toThrow(/0 to 100/);
  });

  it('follows a mirror back to the task it mirrors', async () => {
    const { m, index } = await setup();
    const source = [...index.snapshot.tasks.values()].find((t) => t.text === 'Draft chapter list' && t.origin === 'project')!;
    await m.schedule(source.key, TODAY);
    const mirror = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily-mirror' && t.text.includes('Draft chapter list'))!;
    await m.setProgress(mirror.key, 50);
    const after = [...index.snapshot.tasks.values()].find((t) => t.text === 'Draft chapter list' && t.origin === 'project')!;
    expect(after.progress).toBe(50);                            // the project task is the one that knows
    expect(after.status).toBe('doing');
    void dailyPath;
  });
});

describe('a part-done task that moves day', () => {
  it('keeps its percentage and stays in progress', async () => {
    const { m, index, vault } = await setup();
    const t = [...index.snapshot.tasks.values()].find((x) => x.text === 'Start with OIB')!;
    await m.setProgress(t.key, 75);
    const doing = [...index.snapshot.tasks.values()].find((x) => x.text === 'Start with OIB' && x.status === 'doing')!;
    await m.schedule(doing.key, '2026-08-27');
    const moved = [...index.snapshot.tasks.values()].find((x) => x.text === 'Start with OIB' && x.status !== 'forwarded')!;
    expect(moved.noteDate ?? moved.scheduled).toBe('2026-08-27');
    expect({ status: moved.status, progress: moved.progress }).toEqual({ status: 'doing', progress: 75 });
    expect(await vault.read(moved.path)).toMatch(/- \[\/\] .*Start with OIB.*📈 75%/);
  });

  it('a task with nothing against its name still starts the new day fresh', async () => {
    const { m, index } = await setup();
    const t = [...index.snapshot.tasks.values()].find((x) => x.text === 'Start with OIB')!;
    await m.setStatus(t.key, 'doing');
    await m.schedule([...index.snapshot.tasks.values()].find((x) => x.text === 'Start with OIB' && x.status === 'doing')!.key, '2026-08-27');
    const moved = [...index.snapshot.tasks.values()].find((x) => x.text === 'Start with OIB' && x.status !== 'forwarded')!;
    expect(moved.status).toBe('todo');
  });
});

describe('a part of the day is a time of day', () => {
  it('gives an untimed task a free slot in the part it lands in, and takes it back in Anytime', async () => {
    const { m, index, vault } = await setup();
    await m.addTask({ text: 'Tidy the desk', date: TODAY });
    const at = () => [...index.snapshot.tasks.values()].find((t) => t.text === 'Tidy the desk')!;
    expect({ part: at().part, time: at().time }).toEqual({ part: 'anytime', time: undefined });

    await m.setPart(at().key, 'evening');
    expect(at().part).toBe('evening');
    expect(at().time!.start >= '18:00').toBe(true);
    expect(at().time!.end).toBeTruthy();                       // a block, not a bare start

    // A second task in the same part takes the next free slot, not the same one.
    await m.addTask({ text: 'Water the plants', date: TODAY });
    const other = [...index.snapshot.tasks.values()].find((t) => t.text === 'Water the plants')!;
    await m.setPart(other.key, 'evening');
    const second = [...index.snapshot.tasks.values()].find((t) => t.text === 'Water the plants')!;
    expect(second.time!.start).not.toBe(at().time!.start);

    await m.setPart(at().key, 'anytime');
    expect({ part: at().part, time: at().time }).toEqual({ part: 'anytime', time: undefined });
    expect(await vault.read(at().path)).toMatch(/- \[ \] Tidy the desk\s*$/m);
  });

  it('leaves a time that already suits the part alone', async () => {
    const { m, index } = await setup();
    await m.addTask({ text: 'Stand-up', date: TODAY, part: 'morning', fields: { time: { start: '09:15', end: '09:30' } } });
    const at = () => [...index.snapshot.tasks.values()].find((t) => t.text === 'Stand-up')!;
    await m.setPart(at().key, 'morning');
    expect(at().time).toEqual({ start: '09:15', end: '09:30' });   // it is already a morning time
    // Moved to the afternoon it is retimed, keeping how long it takes.
    await m.setPart(at().key, 'afternoon');
    expect(at().time!.start >= '12:00' && at().time!.start < '18:00').toBe(true);
    expect(at().time!.end).toBeTruthy();
  });
});
