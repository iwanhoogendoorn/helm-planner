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
    expect(index.linkableNotes().map((n) => n.title)).not.toContain('Kitchen Remodel');
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
    expect(p).toBe('Notes/2026-W35 — retro.md');
    const c = await vault.read(p);
    expect(c).toMatch(/^---\nhelm-period: 2026-W35\nrelated: "\[\[2026-W35\]\]"\ncreated: 2026-08-26\n---\n\n# 2026-W35 — retro\n\n> For: \[\[2026-W35\]\]/);
    expect(await vault.read('Weekly Notes/2026-W35.md')).toMatch(/## Notes\n\n- \[\[2026-W35 — retro\]\]/);
    expect(index.notesFor({ kind: 'period', key: '2026-W35', title: '' }).map((n) => n.title)).toEqual(['2026-W35 — retro']);
    const q = await m.createNote({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' }, { name: 'Decisions' });
    expect(q).toBe('02 PROJECTS/Kitchen Remodel/Decisions.md');
    expect(await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')).toContain('- [[Decisions]]');
    const t = [...index.snapshot.tasks.values()].find((x) => x.origin === 'project' && x.projectId !== undefined && x.status !== 'done')!;
    const n = await m.createNote({ kind: 'task', key: t.key, title: t.text });
    expect(n).toBe(`Notes/${t.text} — note.md`);
    expect(await vault.read(n)).toMatch(/helm-task: tsk-\w+/);
    const t2 = [...index.snapshot.tasks.values()].find((x) => x.text === t.text && x.origin === 'project')!;
    expect(index.notesFor({ kind: 'task', key: t2.key, id: t2.id, title: '' }).map((x) => x.title)).toEqual([`${t.text} — note`]);
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
