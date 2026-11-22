import { describe, expect, it } from 'vitest';
import { dayPlan } from '../../src/data/planner';
import { dailyPath, setup, SETTINGS, TODAY } from './fixture';

const PAST = '2026-08-24';
const LATER = '2026-08-27';
const FURTHER = '2026-08-28';

const day = (lines: string): string => `---\ntitle: d\n---\n\n# Day planner\n\n### A. Morning\n\n### B. Afternoon\n\n### C. Evening\n\n### Anytime\n\n${lines}\n`;
const onDay = (snap: Parameters<typeof dayPlan>[0], date: string, text: string): number =>
  dayPlan(snap, date, SETTINGS).items.filter((i) => i.display.text.includes(text) && i.display.status !== 'forwarded').length;

describe('moving a task that sits on a past day shows it once', () => {
  it('a daily line planned with ⏳ for a later day is not left behind on that day', async () => {
    // Written on Monday with ⏳ Thursday, moved on Wednesday to Friday.
    const { index, m } = await setup({ [dailyPath(PAST)]: day(`- [ ] Call the bank ⏳ ${LATER}`) });
    const key = index.allTasks().find((t) => t.text === 'Call the bank')!.key;
    await m.schedule(key, FURTHER);
    const s = index.snapshot;
    expect(onDay(s, FURTHER, 'Call the bank')).toBe(1);
    expect(onDay(s, LATER, 'Call the bank')).toBe(0);
    // The record on Monday is a record of Monday, and nowhere else.
    expect(dayPlan(s, LATER, SETTINGS).items.filter((i) => i.display.text === 'Call the bank')).toHaveLength(0);
  });

  it('a daily line with a later 📅 lands on the day it was moved to, not its due day', async () => {
    const { index, m } = await setup({ [dailyPath(PAST)]: day(`- [ ] Pay the invoice 📅 ${FURTHER}`) });
    const key = index.allTasks().find((t) => t.text === 'Pay the invoice')!.key;
    await m.schedule(key, LATER);
    const s = index.snapshot;
    expect(onDay(s, LATER, 'Pay the invoice')).toBe(1);
    expect(dayPlan(s, FURTHER, SETTINGS).items.filter((i) => i.display.text === 'Pay the invoice')).toHaveLength(0);
  });

  it('a project task moved off a past day leaves that day a forwarded record, not a second open copy', async () => {
    const { index, m } = await setup();
    const src = index.allTasks().find((t) => t.text === 'Get three quotes')!;
    await m.schedule(src.key, PAST);
    // Pretend Monday has passed: the mirror stays there. Now move it on to Thursday.
    await m.schedule(index.allTasks().find((t) => t.text === 'Get three quotes' && t.origin === 'project')!.key, LATER);
    const s = index.snapshot;
    expect(onDay(s, LATER, 'Get three quotes')).toBe(1);
    expect(onDay(s, PAST, 'Get three quotes')).toBe(0);
    expect(TODAY > PAST).toBe(true);
  });
});
