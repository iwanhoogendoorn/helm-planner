import { describe, expect, it } from 'vitest';
import { setup } from './fixture';
import { parseCapture } from '../../src/core/nlp';
import { captureDestination, captureFields } from '../../src/data/capture';

describe('capture helpers', () => {
  it('turns a parse into task-line fields, letting an adjusted effort and time win', () => {
    const c = parseCapture('Call the plumber tomorrow !high ~30m 14:00 every week', '2026-08-26');
    const f = captureFields(c);
    expect(f).toMatchObject({ priority: 'high', effortMinutes: 30, effortRaw: '30m', time: { start: '14:00' }, recurrence: { raw: 'every week' } });
    expect(captureFields(c, 90, { start: '15:00', end: '16:30' })).toMatchObject({ effortMinutes: 90, effortRaw: '1h30m', time: { start: '15:00', end: '16:30' } });
    expect(captureFields(parseCapture('Just text', '2026-08-26'))).toEqual({ priority: 'normal' });
  });

  it('says where a capture lands, the part following the time when none was chosen', async () => {
    const { index, settings } = await setup();
    const kitchen = index.project('prj-kitchen')!;
    expect(captureDestination({ settings })).toMatchObject({ kind: 'inbox', sentence: '→ inbox (01 INBOX/Inbox.md)' });
    expect(captureDestination({ date: '2026-08-27', time: { start: '19:00' }, settings })).toMatchObject({ kind: 'day', date: '2026-08-27', part: 'evening', sentence: '→ daily note for 2026-08-27' });
    expect(captureDestination({ project: kitchen, settings })).toMatchObject({ kind: 'project', projectId: 'prj-kitchen', sentence: '→ project “Kitchen Remodel”' });
    expect(captureDestination({ project: kitchen, date: '2026-08-27', part: 'morning', settings, dateLabel: () => 'tomorrow' })).toMatchObject({ kind: 'project+day', part: 'morning', sentence: '→ project “Kitchen Remodel” (and the plan for tomorrow)' });
  });
});
