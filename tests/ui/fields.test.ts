// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { effortField, linkTimes } from '../../src/ui/fields';

const times = (a: string, b: string): [HTMLInputElement, HTMLInputElement] => {
  const s = document.createElement('input'); s.type = 'time'; s.value = a;
  const e = document.createElement('input'); e.type = 'time'; e.value = b;
  return [s, e];
};
const type = (el: HTMLInputElement, v: string): void => { el.value = v; el.dispatchEvent(new Event('input')); };

describe('start, end and effort stay consistent', () => {
  it('moves the whole block when the start moves and there is no estimate', () => {
    const [s, e] = times('09:00', '10:00');
    linkTimes(s, e, effortField());
    type(s, '18:00');
    expect(e.value).toBe('19:00'); // the hour travels with it, never left behind at 10:00
    type(s, '18:30');
    expect(e.value).toBe('19:30');
  });

  it('uses the estimate when there is one, and reads one back from a typed end', () => {
    const [s, e] = times('09:00', '');
    linkTimes(s, e, effortField(45));
    type(s, '14:00');
    expect(e.value).toBe('14:45');

    const [s2, e2] = times('', '');
    const eff2 = effortField();
    linkTimes(s2, e2, eff2);
    type(s2, '09:00');
    type(e2, '09:30');
    expect(eff2.get()).toBe(30);
  });

  it('drops an end that no longer makes sense', () => {
    const [s, e] = times('', '10:00'); // an end with no start to anchor it
    linkTimes(s, e, effortField());
    type(s, '18:00');
    expect(e.value).toBe('');
  });
});
