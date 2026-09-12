import { describe, expect, it } from 'vitest';
import { setup } from './fixture';

const DRAW = (fm: string, text = ''): string => `---\n${fm}\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n\n## Text Elements\n${text}\n\n%%\n## Drawing\n\`\`\`json\n{"type":"excalidraw","elements":[]}\n\`\`\`\n%%\n`;

/** Locks the task-text → drawing/note mapping that link() builds in one pass: which tasks a drawing or note is attached to by a wikilink in their text. */
describe('wikilinks in task text attach drawings and notes', () => {
  it('matches by title, by title.excalidraw, embedded, aliased, in any case; a mirror line never counts; a note link goes to the note', async () => {
    const { index } = await setup({
      'Excalidraw/Flow.excalidraw.md': DRAW('', 'flow ^a'),
      'Excalidraw/Map.excalidraw.md': DRAW('', 'map ^a'),
      'Excalidraw/Lonely.excalidraw.md': DRAW('', 'nobody links me ^a'),
      '81 AI/Research.md': '# Research\n',
      '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md': `---\ntitle: Kitchen Remodel\ntype: project\nstatus: planned\npriority: medium\nid: prj-kitchen\n---\n\n# Kitchen Remodel\n\n## Tasks\n\n- [ ] By title [[Flow]] 🆔 tsk-l1\n- [ ] By suffix [[flow.excalidraw]] 🆔 tsk-l2\n- [ ] Embedded ![[FLOW]] and [[Map|the map]] 🆔 tsk-l3\n- [ ] With heading [[Map#section]] 🆔 tsk-l4\n- [ ] A note [[Research]] and nothing else 🆔 tsk-l5\n- [ ] Plain text mentioning Flow without brackets 🆔 tsk-l6\n`,
      '70 OBSIDIAN/70-06 Daily Notes/2026/08 - August/35/26, Wednesday, Aug, 2026.md': '# Day planner\n\n### Anytime\n- [ ] By title [[Flow]] 🆔 tsk-l1 🔗 [[Kitchen Remodel]]\n',
    });
    const keysFor = (title: string): string[] => {
      const d = index.snapshot.drawings.get(`Excalidraw/${title}.excalidraw.md`)!;
      // Source lines only: asking with a mirror's id would answer for its source, which is drawingsFor's intent.
      return [...index.snapshot.tasks.values()].filter((t) => t.origin !== 'daily-mirror' && index.drawingsFor({ kind: 'task', key: t.key, ...(t.id ? { id: t.id } : {}), title: '' }).some((x) => x.path === d.path)).map((t) => `${t.id}@${t.origin}`).sort();
    };
    expect(keysFor('Flow')).toEqual(['tsk-l1@project', 'tsk-l2@project', 'tsk-l3@project']);
    expect(keysFor('Map')).toEqual(['tsk-l3@project', 'tsk-l4@project']);
    expect(keysFor('Lonely')).toEqual([]);
    // The mirror of tsk-l1 in the daily note links Flow too, but a mirror line is never an attachment of its own.
    const mirror = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily-mirror' && t.id === 'tsk-l1')!;
    expect(index.drawingsFor({ kind: 'task', key: mirror.key, title: '' }).map((d) => d.title)).toEqual([]);
    // A note linked from a task's text is attached to that task, and a drawing link never turns into a note attachment.
    const l5 = index.taskById('tsk-l5')!;
    expect(index.notesFor({ kind: 'task', key: l5.key, id: 'tsk-l5', title: '' }).map((n) => n.path)).toEqual(['81 AI/Research.md']);
    const l1 = index.taskById('tsk-l1')!;
    expect(index.notesFor({ kind: 'task', key: l1.key, id: 'tsk-l1', title: '' })).toEqual([]);
    // Editing one task re-links: dropping the link drops the attachment, adding one adds it.
    const path = '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md';
    const content = (await index['vault'].read(path)).replace('- [ ] By title [[Flow]] 🆔 tsk-l1', '- [ ] By title 🆔 tsk-l1').replace('Plain text mentioning Flow without brackets 🆔 tsk-l6', 'Now links [[lonely]] 🆔 tsk-l6');
    index.update(path, content);
    expect(keysFor('Flow')).toEqual(['tsk-l2@project', 'tsk-l3@project']);
    expect(keysFor('Lonely')).toEqual(['tsk-l6@project']);
  });
});
