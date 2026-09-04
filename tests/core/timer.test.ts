import { describe, expect, it } from 'vitest';
import { clock, elapsed, isDone, pause, remaining, resume, startTimer } from '../../src/core/timer';

const T0 = 1_700_000_000_000;

describe('the timer', () => {
  it('counts from the clock, so a re-render or a sleeping laptop changes nothing', () => {
    const t = startTimer('k', 'Write the report', 25, 'focus', T0);
    expect(remaining(t, T0)).toBe(1500);
    expect(remaining(t, T0 + 60_000)).toBe(1440);
    expect(remaining(t, T0 + 1500_000)).toBe(0);
    expect(isDone(t, T0 + 1500_000)).toBe(true);
    expect(remaining(t, T0 + 9_999_000)).toBe(0);          // never goes negative
  });

  it('pauses where it stands and picks up from there', () => {
    const t = startTimer('k', 'x', 25, 'focus', T0);
    const held = pause(t, T0 + 300_000);                    // five minutes in
    expect(elapsed(held, T0 + 999_000)).toBe(300);          // time passing does not count while paused
    expect(remaining(held, T0 + 999_000)).toBe(1200);
    expect(pause(held, T0 + 400_000)).toBe(held);           // pausing twice is not a thing

    const back = resume(held, T0 + 600_000);
    expect(remaining(back, T0 + 600_000)).toBe(1200);       // exactly where it was
    expect(remaining(back, T0 + 660_000)).toBe(1140);       // and running again
    expect(resume(back, T0 + 700_000)).toBe(back);
  });

  it('reads as a clock', () => {
    expect(clock(1500)).toBe('25:00');
    expect(clock(59)).toBe('0:59');
    expect(clock(0)).toBe('0:00');
    expect(clock(3725)).toBe('1:02:05');
  });
});
