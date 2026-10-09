import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';

const NOTE = (fm: string, body = 'body'): string => `---\n${fm}\n---\n\n# Note\n\n${body}\n`;
const EXTRA = {
  '81 AI/Certs research.md': NOTE('helm-task: tsk-0001\nhelm-period: [2026-W35, 2026-08]'),   // out of scope, keyed
  '30 HOUSE/Plumber quotes.md': '# Plumber quotes\n\nthree quotes\n',                          // reached only by a task's text link
  '02 PROJECTS/Kitchen Remodel/Decisions.md': NOTE('helm-project: prj-kitchen'),               // keyed, inside the project folder
  '10 PERSONAL/Reading list.md': '# Reading list\n',                                           // listed under the day's Notes heading
};

describe('note attachments', () => {
  it('finds notes by frontmatter keys anywhere in the vault, by task-text links, and by a Notes list in the target note', async () => {
    const { index, vault } = await setup({ ...EXTRA, [dailyPath('2026-08-25')]: (await (await setup()).vault.read(dailyPath('2026-08-25'))) + '\n## Notes\n\n- [[Reading list]]\n', '01 INBOX/Inbox.md': '# Inbox\n\n- [ ] Call the plumber || [[Plumber quotes]]\n- [ ] Pay invoice\n' });
    const titles = (t: Parameters<typeof index.notesFor>[0]): string[] => index.notesFor(t).map((n) => n.title).sort();
    const t1 = index.task('tsk-0001')!;
    expect(titles({ kind: 'task', key: t1.key, id: 'tsk-0001', title: '' })).toEqual(['Certs research']);
    expect(titles({ kind: 'period', key: '2026-W35', title: '' })).toEqual(['Certs research']);
    expect(titles({ kind: 'period', key: '2026-08', title: '' })).toEqual(['Certs research']);
    expect(titles({ kind: 'project', id: 'prj-kitchen', title: '' })).toEqual(['Decisions']);
    const plumber = [...index.snapshot.tasks.values()].find((t) => t.text.startsWith('Call the plumber') && t.origin === 'inbox')!;
    expect(titles({ kind: 'task', key: plumber.key, title: '' })).toEqual(['Plumber quotes']);
    expect(titles({ kind: 'date', date: '2026-08-25', title: '' })).toEqual(['Reading list']);
    expect(index.snapshot.notes.has('81 AI/Certs research.md')).toBe(true);
    expect(index.snapshot.notes.has('30 HOUSE/Plumber quotes.md')).toBe(false); // unindexed, still found by the link
    expect(index.linkableNotes().map((n) => n.title)).toEqual(expect.arrayContaining(['Certs research', 'Plumber quotes', 'Reading list', 'Backlog Tasks']));
    // A project note is linkable too — plenty of people keep real content in one — and says what it is.
    expect(index.linkableNotes().find((n) => n.title === 'Kitchen Remodel')).toEqual({ path: '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md', title: 'Kitchen Remodel', kind: 'project' });
    expect(index.linkableNotes().find((n) => n.title === 'Reading list')!.kind).toBeUndefined(); // a plain note carries no label
    expect(index.linkableNotes().some((n) => n.path.includes('70-06 Daily Notes'))).toBe(false); // days are attached to as days
    expect(index.linkableNotes().some((n) => n.path.endsWith('.excalidraw.md'))).toBe(false);
    // A keyed note outside the scanned folders is picked up when it changes.
    await vault.write('99 ELSEWHERE/Later.md', NOTE('helm-date: 2026-08-26'));
    index.update('99 ELSEWHERE/Later.md', await vault.read('99 ELSEWHERE/Later.md'));
    expect(titles({ kind: 'date', date: TODAY, title: '' })).toEqual(['Later']);
  });
});

describe('creating, linking, unlinking and deleting notes', () => {
  it('creates a note with the key and a For line, lists it under Notes in the target note; project notes sit in the project folder', async () => {
    const { m, vault, index } = await setup();
    const p = await m.createNote({ kind: 'period', key: '2026-W35', title: '2026-W35' }, { name: 'retro' });
    expect(p).toBe('Notes/retro.md');
    const c = await vault.read(p);
    expect(c).toMatch(/^---\nhelm-period: 2026-W35\nrelated: "\[\[2026-W35\]\]"\ncreated: 2026-08-26\n---\n\n# retro\n\n> For: \[\[2026-W35\]\]/);
    expect(await vault.read('Weekly Notes/2026-W35.md')).toMatch(/## Notes\n\n- \[\[retro\]\]/);
    expect(index.notesFor({ kind: 'period', key: '2026-W35', title: '' }).map((n) => n.title)).toEqual(['retro']);
    const q = await m.createNote({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' }, { name: 'Decisions' });
    expect(q).toBe('02 PROJECTS/Kitchen Remodel/Decisions.md');
    expect(await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')).toContain('- [[Decisions]]');
    const t = [...index.snapshot.tasks.values()].find((x) => x.origin === 'project' && x.projectId !== undefined && x.status !== 'done')!;
    const n = await m.createNote({ kind: 'task', key: t.key, title: t.text });
    expect(n).toBe(`${index.projectFolderOf(index.project(t.projectId!)!)}/${t.text}.md`); // a project task's note lives with the project
    expect(await vault.read(n)).toMatch(/helm-task: tsk-\w+/);
    const t2 = [...index.snapshot.tasks.values()].find((x) => x.text === t.text && x.origin === 'project')!;
    expect(index.notesFor({ kind: 'task', key: t2.key, id: t2.id, title: '' }).map((x) => x.title)).toEqual([`${t.text}`]);
  });
  it('links an existing note (creating frontmatter when missing), unlinks it, and deletes with link cleanup', async () => {
    const { m, vault, index } = await setup({ '10 PERSONAL/Reading list.md': '# Reading list\n\n- a book\n' });
    const w = { kind: 'period' as const, key: '2026-W35', title: '2026-W35' };
    await m.linkNote(w, '10 PERSONAL/Reading list.md');
    expect(await vault.read('10 PERSONAL/Reading list.md')).toMatch(/^---\nhelm-period: 2026-W35\nrelated: "\[\[2026-W35\]\]"\n---\n# Reading list/);
    expect(await vault.read('Weekly Notes/2026-W35.md')).toContain('- [[Reading list]]');
    expect(index.notesFor(w).map((n) => n.title)).toEqual(['Reading list']);
    await m.linkNote({ kind: 'date', date: TODAY, title: TODAY }, '10 PERSONAL/Reading list.md');
    expect(await vault.read('10 PERSONAL/Reading list.md')).toContain('helm-date: 2026-08-26');
    await m.unlinkNote(w, '10 PERSONAL/Reading list.md');
    const c = await vault.read('10 PERSONAL/Reading list.md');
    expect(c).not.toContain('helm-period');
    expect(c).toContain('helm-date: 2026-08-26');
    expect(await vault.read('Weekly Notes/2026-W35.md')).not.toContain('Reading list');
    expect(index.notesFor(w)).toEqual([]);
    expect(index.notesFor({ kind: 'date', date: TODAY, title: '' }).map((n) => n.title)).toEqual(['Reading list']);
    // Removing the last key removes the frontmatter block altogether.
    await m.unlinkNote({ kind: 'date', date: TODAY, title: TODAY }, '10 PERSONAL/Reading list.md');
    expect(await vault.read('10 PERSONAL/Reading list.md')).toBe('# Reading list\n\n- a book\n');
    await m.linkNote({ kind: 'date', date: TODAY, title: TODAY }, '10 PERSONAL/Reading list.md');
    await m.deleteNote('10 PERSONAL/Reading list.md');
    expect(vault.trashed).toContain('10 PERSONAL/Reading list.md');
    expect(await vault.read(dailyPath(TODAY))).not.toContain('Reading list');
    expect(index.notesFor({ kind: 'date', date: TODAY, title: '' })).toEqual([]);
  });
});

describe('related back-links', () => {
  it('a created note or drawing points back at the daily / periodic / project note or the note holding the task; linking adds, unlinking removes', async () => {
    const { m, vault, index } = await setup();
    const d = await m.createDrawing({ kind: 'date', date: TODAY, title: TODAY }, { name: 'sketch' });
    expect(await vault.read(d)).toContain('related: "[[26, Wednesday, Aug, 2026]]"');
    const n = await m.createNote({ kind: 'period', key: '2026-W35', title: '2026-W35' }, { name: 'retro' });
    expect(await vault.read(n)).toContain('related: "[[2026-W35]]"');
    const pn = await m.createNote({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' }, { name: 'Decisions' });
    expect(await vault.read(pn)).toContain('related: "[[Kitchen Remodel]]"');
    const t = [...index.snapshot.tasks.values()].find((x) => x.origin === 'project' && x.projectId === 'prj-kitchen' && x.status !== 'done')!;
    const tn = await m.createNote({ kind: 'task', key: t.key, title: t.text });
    expect(await vault.read(tn)).toContain('related: "[[Kitchen Remodel]]"');
    // Linking a second target makes a list; unlinking one leaves the other.
    await m.linkNote({ kind: 'period', key: '2026-08', title: '2026-08' }, n);
    expect(await vault.read(n)).toContain('related:\n  - "[[2026-W35]]"\n  - "[[2026-08]]"');
    await m.unlinkNote({ kind: 'period', key: '2026-W35', title: '2026-W35' }, n);
    const c = (await vault.read(n)).split('---')[1]!;
    expect(c).toContain('related: "[[2026-08]]"');
    expect(c).not.toContain('2026-W35');
    // Drawings too, and a bare note gets both keys on link.
    await vault.write('10 PERSONAL/Reading list.md', '# Reading list\n');
    index.update('10 PERSONAL/Reading list.md', '# Reading list\n');
    await m.linkNote({ kind: 'date', date: TODAY, title: TODAY }, '10 PERSONAL/Reading list.md');
    expect(await vault.read('10 PERSONAL/Reading list.md')).toMatch(/^---\nhelm-date: 2026-08-26\nrelated: "\[\[26, Wednesday, Aug, 2026\]\]"\n---/);
    await m.linkDrawing({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' }, d);
    expect(await vault.read(d)).toContain('related:\n  - "[[26, Wednesday, Aug, 2026]]"\n  - "[[Kitchen Remodel]]"');
  });
});

describe('notes kept in a project’s folder', () => {
  it('belong to that project — the deepest one — without any frontmatter or link', async () => {
    const s = await setup({
      '02 PROJECTS/Oracle Book Writing/Research.md': '---\ntitle: Research\n---\nSources.\n',
      '02 PROJECTS/Oracle Book Writing/drafts/Chapter 1 draft.md': '# Draft\n',
      '02 PROJECTS/⮕ Oracle/OCI Certification/Exam notes.md': '# Exam\n',
      '02 PROJECTS/⮕ Oracle/Oracle roadmap.md': '# Roadmap\n',
      '02 PROJECTS/Stray note.md': '# Loose in the projects folder\n',
    });
    const titles = (id: string) => s.index.notesFor({ kind: 'project', id, title: id }).map((n) => n.title).sort();
    expect(titles('prj-book')).toEqual(['Chapter 1 draft', 'Research']);
    expect(titles('prj-cert')).toEqual(['Exam notes']);
    expect(titles('prj-oracle')).toEqual(['Oracle roadmap']);
    expect(titles('prj-kitchen')).toEqual([]);
    // The project's own note is the project, not one of its notes.
    expect(titles('prj-book')).not.toContain('Oracle Book Writing');
  });
});

describe('what a note holds, at a glance', () => {
  it('takes the first heading and the first line of prose, skipping frontmatter, callout titles, tables, code and embeds', async () => {
    const { notePreview } = await import('../../src/core/noteRef');
    const p = notePreview('---\ntitle: X\ntags: [a]\n---\n\n![[cover.png]]\n## Keyboard guide, bar by bar\n\n> [!info] Basics\n> **Key** A minor · see [[Theory|theory notes]] and [the score](https://x.y)\n\n```\ncode words here\n```\n| a | b |\n- [ ] Learn the intro\n- [x] Buy the book\n');
    expect(p).toEqual({ heading: 'Keyboard guide, bar by bar', text: 'Key A minor · see theory notes and the score', words: 23, openTasks: 1, doneTasks: 1 });
    expect(notePreview('')).toEqual({ words: 0, openTasks: 0, doneTasks: 0 });
    expect(notePreview('# har2cli\nname: har2cli\nTurn a HAR file into a CLI.\n').text).toBe('Turn a HAR file into a CLI.');
    expect(notePreview('Key: A minor, 84 BPM\n').text).toBe('Key: A minor, 84 BPM');
  });
});
