import { describe, expect, it } from 'vitest';
import { DEFAULT_FOCUS } from '../../src/core/pomodoro';
import { buildPrompt, buildWeekPrompt, parseAnswer, parseWeekAnswer, proposePlan, proposeWeekPlan, type PlanRequest, type WeekPlanRequest } from '../../src/data/ai';

const REQ: PlanRequest = {
  date: '2026-09-04', from: '09:00', to: '17:00',
  busy: [{ start: '11:00', end: '12:00', label: 'Team meeting' }],
  tasks: [
    { key: 'a', text: 'Write the report', effortMinutes: 90, priority: 'high', due: '2026-09-04' },
    { key: 'b', text: 'Ring the plumber', priority: 'normal' },
    { key: 'c', text: 'Read the blueprint', effortMinutes: 60, priority: 'low' },
  ],
  focus: DEFAULT_FOCUS,
  capacityMinutes: 360,
};

describe('asking Claude to size a day', () => {
  it('sends it everything it needs and nothing it does not', () => {
    const p = buildPrompt(REQ);
    expect(p).toContain('Working window: 09:00–17:00');
    expect(p).toContain('- 11:00–12:00 Team meeting');
    expect(p).toContain('- t1 | Write the report | 90m | high | 2026-09-04');   // short handles, not Helm's own keys
    expect(p).toContain('- t2 | Ring the plumber | no estimate | normal | no due date');
    expect(p).toContain('at most 50 minutes');
    expect(p).toContain('JSON only');
  });

  it('reads the answer, ignores what it invented, and keeps what it forgot', () => {
    const answer = parseAnswer('```json\n{"order":["b","a","zz"],"minutes":{"b":20,"a":95,"zz":5},"defer":[{"key":"nope"}]}\n```', REQ);
    expect(answer.order).toEqual(['b', 'a', 'c']);          // “zz” is not ours; “c” was forgotten, so it is last
    expect(answer.minutes).toMatchObject({ b: 20, a: 95, c: 60 });   // c falls back to what Helm knows
    expect(answer.defer).toEqual([]);
    expect(() => parseAnswer('I cannot do that', REQ)).toThrow(/JSON/);
  });

  it('lays the answer out as blocks and breaks, working round the meeting', async () => {
    const cli = async (): Promise<string> => JSON.stringify({ order: ['a', 'c', 'b'], minutes: { a: 90, c: 60, b: 15 }, defer: [] });
    const p = await proposePlan(REQ, cli);
    expect(p.source).toBe('claude');
    const focus = p.blocks.filter((b) => b.kind === 'focus');
    expect(focus.map((b) => [b.taskKey, b.start, b.end])).toEqual([
      ['a', '09:00', '09:45'], ['a', '09:50', '10:35'],     // 90 minutes, split in two, five minutes apart
      ['c', '12:00', '12:30'], ['c', '12:50', '13:20'],     // the meeting is left alone; c starts after it
      ['b', '13:25', '13:40'],
    ]);
    expect(p.blocks.filter((b) => b.kind === 'break')).toHaveLength(5);
    expect(p.blocks.some((b) => b.start < '12:00' && b.end > '11:00')).toBe(false);   // nothing over the meeting
    expect(p.focusMinutes).toBe(165);
    expect(p.breakMinutes).toBe(40);                        // including one long one after three stretches
  });

  it('understands an answer written in the handles it handed out', () => {
    const answer = parseAnswer('{"order":["t2","t1"],"minutes":{"t2":25,"t1":100},"notes":{"t1":"it is a long one"},"defer":[{"key":"t3"}]}', REQ);
    expect(answer.order).toEqual(['b', 'a']);
    expect(answer.minutes).toMatchObject({ b: 25, a: 100 });
    expect(answer.notes).toEqual({ a: 'it is a long one' });
    expect(answer.defer).toEqual([{ key: 'c' }]);
  });

  it('still proposes a day when there is no CLI, and says so', async () => {
    const p = await proposePlan(REQ, undefined);
    expect(p.source).toBe('helm');
    expect(p.answer.minutes).toEqual({ a: 90, b: 30, c: 60 });   // Helm's own estimates, 30 for the unsized one
    expect(p.blocks.length).toBeGreaterThan(0);
  });

  it('falls back when the CLI fails or talks nonsense, and keeps the reason', async () => {
    const broken = async (): Promise<string> => { throw new Error('claude: command not found'); };
    const p = await proposePlan(REQ, broken);
    expect(p.source).toBe('helm');
    expect(p.error).toMatch(/command not found/);
    expect(p.blocks.length).toBeGreaterThan(0);

    const rambling = async (): Promise<string> => 'Sure! Here is my plan: do the report first.';
    expect((await proposePlan(REQ, rambling)).source).toBe('helm');
  });

  it('carries what the model wants to put off into the overflow', async () => {
    const cli = async (): Promise<string> => JSON.stringify({ order: ['a'], minutes: { a: 90 }, defer: [{ key: 'c', reason: 'not due yet' }, { key: 'b' }] });
    const p = await proposePlan(REQ, cli);
    expect(p.overflow.map((t) => t.key).sort()).toEqual(['b', 'c']);
    expect(p.blocks.every((b) => b.taskKey === 'a')).toBe(true);
  });
});

const WEEK: WeekPlanRequest = {
  days: [
    { date: '2026-09-04', from: '09:00', to: '17:00', busy: [{ start: '11:00', end: '12:00', label: 'Team meeting' }] },
    { date: '2026-09-05', from: '09:00', to: '17:00', busy: [] },
  ],
  tasks: [
    { key: 'a', text: 'Write the report', effortMinutes: 180, priority: 'high', due: '2026-09-05', date: '2026-09-04' },
    { key: 'b', text: 'Ring the plumber', effortMinutes: 30, priority: 'normal', date: '2026-09-04' },
    { key: 'c', text: 'Read the blueprint', effortMinutes: 120, priority: 'low', date: '2026-09-04' },
    { key: 'd', text: 'Book the ferry', priority: 'normal' },
  ],
  focus: DEFAULT_FOCUS,
  capacityMinutes: 240,
};

describe('asking Claude to spread a week', () => {
  it('tells it what each day holds and where every task sits now', () => {
    const p = buildWeekPrompt(WEEK);
    expect(p).toContain('- 2026-09-04 09:00–17:00; booked: 11:00–12:00 Team meeting');
    expect(p).toContain('- 2026-09-05 09:00–17:00');
    expect(p).toContain('- t1 | Write the report | 180m | high | 2026-09-05 | 2026-09-04');
    expect(p).toContain('- t4 | Book the ferry | no estimate | normal | no due date | not planned');
    expect(p).toContain('about 240 minutes of real work on each day');
  });

  it('reads the answer, drops days and keys it invented, and places what it forgot', () => {
    const answer = parseWeekAnswer(JSON.stringify({
      days: { '2026-09-04': ['a', 'zz'], '2026-09-05': ['b', 'a'], '2026-09-09': ['c'] },
      minutes: { a: 200, b: 25 },
      defer: [{ key: 'd', reason: 'no rush' }],
    }), WEEK);
    expect(answer.days['2026-09-04']).toEqual(['a', 'c']);       // “zz” is not ours; forgotten “c” stays on its own day
    expect(answer.days['2026-09-05']).toEqual(['b']);            // “a” is not placed twice, and the invented day is dropped
    expect(answer.minutes).toMatchObject({ a: 200, b: 25, c: 120 });
    expect(answer.defer).toEqual([{ key: 'd', reason: 'no rush' }]);
  });

  it('understands a week answered in handles too', () => {
    const answer = parseWeekAnswer('{"days":{"2026-09-04":["t1"],"2026-09-05":["t2","t3"]},"minutes":{"t1":60},"defer":[{"key":"t4"}]}', WEEK);
    expect(answer.days['2026-09-04']).toEqual(['a']);
    expect(answer.days['2026-09-05']).toEqual(['b', 'c']);
    expect(answer.minutes['a']).toBe(60);
    expect(answer.defer!.map((d) => d.key)).toEqual(['d']);
  });

  it('lays each day out on its own, round what that day already holds', async () => {
    const cli = async (): Promise<string> => JSON.stringify({
      days: { '2026-09-04': ['b'], '2026-09-05': ['a'] },
      minutes: { b: 30, a: 90 },
      defer: [{ key: 'c' }, { key: 'd' }],
    });
    const p = await proposeWeekPlan(WEEK, cli);
    expect(p.source).toBe('claude');
    const day = (d: string): [string, string, string][] => p.days.find((x) => x.date === d)!.laid.blocks.filter((b) => b.kind === 'focus').map((b) => [b.taskKey, b.start, b.end]);
    expect(day('2026-09-04')).toEqual([['b', '09:00', '09:30']]);
    expect(day('2026-09-05')).toEqual([['a', '09:00', '09:45'], ['a', '09:50', '10:35']]);
    expect(p.overflow.map((t) => t.key).sort()).toEqual(['c', 'd']);
  });

  it('spreads the week itself when there is no CLI: a full day rolls on to the next', async () => {
    const p = await proposeWeekPlan(WEEK, undefined);
    expect(p.source).toBe('helm');
    // Monday holds 180 + 30, and the ferry still fits to the minute; the blueprint would take it past
    // 240, so that is what moves on.
    expect(p.answer.days['2026-09-04']).toEqual(['a', 'b', 'd']);
    expect(p.answer.days['2026-09-05']).toEqual(['c']);
    expect(p.answer.minutes['d']).toBe(30);
    expect(p.answer.defer).toEqual([]);
  });

  it('leaves for another week what no day can hold, and says why it fell back', async () => {
    const tight: WeekPlanRequest = { ...WEEK, capacityMinutes: 60, tasks: WEEK.tasks.map((t) => ({ ...t, effortMinutes: t.effortMinutes ?? 30 })) };
    const p = await proposeWeekPlan(tight, async () => { throw new Error('claude: command not found'); });
    expect(p.source).toBe('helm');
    expect(p.error).toMatch(/command not found/);
    // A day always takes its first task however long it is — an empty day is no use to anyone — so the
    // report fills Monday on its own and only the blueprint is left with nowhere to go.
    expect(p.answer.defer!.map((d) => d.key)).toEqual(['c']);
    expect(p.answer.days['2026-09-04']).toEqual(['a']);
    expect(p.answer.days['2026-09-05']).toEqual(['b', 'd']);
  });
});
