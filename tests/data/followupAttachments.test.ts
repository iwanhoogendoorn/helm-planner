import { describe, expect, it } from 'vitest';
import { setup, dailyPath } from './fixture';
import { parseTaskLine } from '../../src/core/taskLine';

const DRAW = (fm: string): string => `---\n${fm}\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n\n## Text Elements\n\n%%\n## Drawing\n\`\`\`json\n{"type":"excalidraw","elements":[]}\n\`\`\`\n%%\n`;

describe('follow-ups of tasks with attachments and duplicated keys', () => {
  it('a ⛔ id written with an index-key suffix still parses as the id', () => {
    const t = parseTaskLine('- [ ] Plan certs #followup ⛔ tsk-zlecjp~5')!;
    expect(t.blockedBy).toEqual(['tsk-zlecjp']);
    expect(t.text).toBe('Plan certs #followup');
  });

  it('ensureId returns the id even when the index key carries a ~n suffix; the follow-up references the id', async () => {
    const { m, vault, index } = await setup();
    // The same idless line in two daily notes → the second copy gets a ~1 key once ids are shared; force the situation with an explicit duplicate id.
    const a = dailyPath('2026-08-24');
    await vault.write(a, `---\ntitle: 24, Monday, Aug, 2026\ndate: 2026-08-24\n---\n\n## Plan\n### Evening\n- [ ] Make list of certs 🆔 tsk-dup\n`);
    index.update(a, await vault.read(a));
    const b = dailyPath('2026-08-25');
    await vault.write(b, (await vault.read(b)).replace('### Habits', '### Evening\n- [ ] Make list of certs 🆔 tsk-dup\n### Habits'));
    index.update(b, await vault.read(b));
    const dup = [...index.snapshot.tasks.values()].find((t) => t.id === 'tsk-dup' && t.key !== 'tsk-dup')!;
    expect(dup.key).toMatch(/~\d+$/);
    expect(await m.ensureId(dup.key)).toBe('tsk-dup');
    const r = await m.followUp(dup.key, { text: 'Plan for certs', date: '2026-08-28' });
    expect(r.id).toBe('tsk-dup');
    const friday = await vault.read(dailyPath('2026-08-28'));
    expect(friday).toMatch(/- \[ \] Plan for certs 🆔 tsk-\w+ ⛔ tsk-dup(\s|$)/);
    expect(friday).not.toContain('tsk-dup~');
  });

  it('the notes and drawings of the original are linked to the follow-up as well', async () => {
    const { m, vault, index } = await setup({
      '81 AI/Cert research.md': '---\nhelm-task: tsk-0001\n---\n# Cert research\n',
      'Excalidraw/cert map.excalidraw.md': DRAW('helm-task: tsk-0001'),
    });
    const orig = index.task('tsk-0001')!;
    const from = { kind: 'task' as const, key: orig.key, id: 'tsk-0001', title: orig.text };
    expect(index.notesFor(from).map((n) => n.title)).toEqual(['Cert research']);
    expect(index.drawingsFor(from).map((d) => d.title)).toEqual(['cert map']);
    const r = await m.followUp(orig.key, { text: 'Continue cert research', date: '2026-08-28' });
    const fu = [...index.snapshot.tasks.values()].find((t) => t.id === r.followUpId && t.origin !== 'daily-mirror')!;
    expect(fu.text).toContain('Continue cert research');
    const to = { kind: 'task' as const, key: fu.key, id: r.followUpId, title: fu.text };
    expect(index.notesFor(to).map((n) => n.title)).toEqual(['Cert research']);
    expect(index.drawingsFor(to).map((d) => d.title)).toEqual(['cert map']);
    // Both tasks are keyed in the frontmatter; the original keeps its attachments.
    expect(await vault.read('81 AI/Cert research.md')).toMatch(new RegExp(`helm-task:\\n  - tsk-0001\\n  - ${r.followUpId}\\n`));
    expect(await vault.read('Excalidraw/cert map.excalidraw.md')).toMatch(new RegExp(`helm-task:\\n  - tsk-0001\\n  - ${r.followUpId}\\n`));
    expect(index.notesFor(from).map((n) => n.title)).toEqual(['Cert research']);
  });
});
