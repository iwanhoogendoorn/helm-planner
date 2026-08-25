import { describe, expect, it } from 'vitest';
import { newTaskLine, parseTaskLine, serialiseTaskLine, withStatus } from '../../src/core/taskLine';

describe('parseTaskLine', () => {
  it('parses a fully loaded line', () => {
    const line = '- [ ] Draft chapter list #writing #book/oci 🆔 tsk-8821 ➕ 2026-08-20 🛫 2026-08-25 ⏳ 2026-08-26 📅 2026-09-05 ⏫ 🔁 every week when done ⛔ tsk-7712 ⏱️ 2h [context:: office]';
    const t = parseTaskLine(line)!;
    expect(t.text).toBe('Draft chapter list #writing #book/oci');
    expect(t.tags).toEqual(['writing', 'book/oci']);
    expect(t.id).toBe('tsk-8821');
    expect(t.created).toBe('2026-08-20');
    expect(t.start).toBe('2026-08-25');
    expect(t.scheduled).toBe('2026-08-26');
    expect(t.due).toBe('2026-09-05');
    expect(t.priority).toBe('high');
    expect(t.recurrence?.parsed).toBe(true);
    expect(t.recurrence?.whenDone).toBe(true);
    expect(t.blockedBy).toEqual(['tsk-7712']);
    expect(t.effortMinutes).toBe(120);
    expect(t.unknown.map((u) => u.raw)).toEqual(['[context:: office]']);
    expect(t.status).toBe('todo');
  });

  it('round-trips untouched lines byte for byte', () => {
    const lines = [
      '- [ ] Call the plumber',
      '\t- [x] nested   with  spaces ✅ 2026-01-02  ',
      '* [/] star bullet 📅 2026-02-03 🏷️ green @home ^abc123',
      '- [-] cancelled ❌ 2026-01-01',
      '- [ ] 🎛️ 1. Leads (Melody Synths)',
      '- [x] 🎂 Janna Norder (dag 22) ✅ 2026-06-22',
      '- [ ] ❌ **Every registry rule verified** — *registry is empty*',
      '- [ ] 📅 2026-01-01',
      '1. [ ] ordered task',
      '- [ ] 07:00 - 08:00: Start with OCI Infra Builder',
      '- [ ] ',
    ];
    for (const l of lines) {
      const t = parseTaskLine(l);
      expect(t, l).toBeDefined();
      expect(serialiseTaskLine(t!)).toBe(l);
    }
  });

  it('treats leading unowned emoji as text', () => {
    expect(parseTaskLine('- [ ] 🎛️ 1. Leads (Melody Synths)')!.text).toBe('🎛️ 1. Leads (Melody Synths)');
    expect(parseTaskLine('- [ ] ❌ **Every registry rule verified**')!.text).toBe('❌ **Every registry rule verified**');
    expect(parseTaskLine('- [ ] 📅 2026-01-01')!.due).toBe('2026-01-01');
  });

  it('parses status markers', () => {
    expect(parseTaskLine('- [x] a')!.status).toBe('done');
    expect(parseTaskLine('- [X] a')!.status).toBe('done');
    expect(parseTaskLine('- [/] a')!.status).toBe('doing');
    expect(parseTaskLine('- [-] a')!.status).toBe('cancelled');
    expect(parseTaskLine('- [>] a')!.status).toBe('forwarded');
    expect(parseTaskLine('- [?] a')!.status).toBe('waiting');
    expect(parseTaskLine('- [!] a')!.status).toBe('todo');
    expect(parseTaskLine('- [!] a')!.marker).toBe('!');
  });

  it('parses time blocks', () => {
    const t = parseTaskLine('- [ ] 08:00 - 09:00: Start with OCI Infra Builder (OIB)')!;
    expect(t.time).toEqual({ start: '08:00', end: '09:00' });
    expect(t.text).toBe('Start with OCI Infra Builder (OIB)');
    const e = parseTaskLine('- [ ] 07:00 - 08:00: ')!;
    expect(e.text).toBe('');
    const s = parseTaskLine('- [ ] 9:30 standup')!;
    expect(s.time).toEqual({ start: '09:30' });
    expect(s.text).toBe('standup');
  });

  it('keeps the first priority and reports the second as unknown', () => {
    const t = parseTaskLine('- [ ] two prios ⏫ 🔽')!;
    expect(t.priority).toBe('high');
    expect(t.unknown.map((u) => u.raw)).toEqual(['🔽']);
  });

  it('rejects invalid dates as unknown tokens', () => {
    const t = parseTaskLine('- [ ] bad date 📅 2026-13-40 ok 📅 2026-01-05')!;
    expect(t.due).toBe('2026-01-05');
    expect(t.text).toBe('bad date 📅 2026-13-40 ok');
  });

  it('mirror links', () => {
    const t = parseTaskLine('- [ ] Draft chapter list 🔗 [[OCI Networking Book|OCI]] 📅 2026-09-05 🆔 tsk-8821')!;
    expect(t.mirrorLink).toBe('[[OCI Networking Book|OCI]]');
    expect(t.id).toBe('tsk-8821');
  });

  it('serialises edits in canonical order with unknowns preserved', () => {
    const t = parseTaskLine('- [ ] Reply to Marieke [context:: office] 📅 2026-09-05 #work')!;
    const done = withStatus(t, 'done', '2026-09-06');
    expect(serialiseTaskLine(done)).toBe('- [x] Reply to Marieke [context:: office] 📅 2026-09-05 #work ✅ 2026-09-06');
    expect(done.tags).toEqual(['work']);
  });

  it('creates new lines', () => {
    const t = newTaskLine('Buy milk', { due: '2026-09-01', priority: 'high', effortMinutes: 15, id: 'tsk-abc123' });
    expect(serialiseTaskLine(t)).toBe('- [ ] Buy milk 🆔 tsk-abc123 📅 2026-09-01 ⏫ ⏱️ 15m');
  });

  it('accepts the bare U+23F1 effort symbol', () => {
    expect(parseTaskLine('- [ ] x ⏱ 45m')!.effortMinutes).toBe(45);
  });

  it('does not treat plain bullets as tasks', () => {
    expect(parseTaskLine('- not a task')).toBeUndefined();
    expect(parseTaskLine('-[ ] no space')).toBeUndefined();
    expect(parseTaskLine('- [ ]no space after')).toBeUndefined();
  });
});
