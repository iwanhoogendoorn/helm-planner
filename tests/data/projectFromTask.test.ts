import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';

const NOTE = (fm: string): string => `---\n${fm}\n---\n\n# Note\n\nbody\n`;
const DRAW = (fm: string): string => `---\n${fm}\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n\n## Text Elements\n\n%%\n## Drawing\n\`\`\`json\n{"type":"excalidraw","elements":[]}\n\`\`\`\n%%\n`;

/** A day task with a subtask, a note, a drawing and a link in its text. */
async function taskWithEverything() {
  const s = await setup({
    '81 AI/Cert research.md': NOTE('helm-task: tsk-grow'),
    'Excalidraw/Cert map.excalidraw.md': DRAW('helm-task: tsk-grow'),
  });
  await s.m.addTask({ text: 'Build the cert lab [OCI docs](https://docs.example.com/oci)', date: TODAY, part: 'morning', fields: { id: 'tsk-grow' } });
  const t = [...s.index.snapshot.tasks.values()].find((x) => x.id === 'tsk-grow' && x.origin === 'daily')!;
  await s.m.addTask({ text: 'Order the hardware', parentKey: t.key });
  return s;
}

describe('promoting a task to a project of its own', () => {
  it('creates the project, moves the task and its subtasks in, and keeps it on the day as a mirror', async () => {
    const { m, vault, index } = await taskWithEverything();
    const r = await m.projectFromTask(index.task('tsk-grow')!.key, { status: 'active', priority: 'normal', area: 'Oracle' });
    expect(r.project.title).toBe('Build the cert lab'); // the link is not part of the name
    expect(r.project.area).toBe('Oracle');

    const note = await vault.read(r.project.path);
    expect(note).toMatch(/- \[ \] Build the cert lab[^\n]*🆔 tsk-grow/);
    expect(note).toMatch(/\n\t- \[ \] Order the hardware/); // the subtask came too
    const day = await vault.read(dailyPath(TODAY));
    expect(day).toContain('Build the cert lab'); // still on the day, as a mirror
    const moved = [...index.snapshot.tasks.values()].find((t) => t.id === 'tsk-grow' && t.origin === 'project')!;
    expect(moved.projectId).toBe(r.project.id);
    expect(moved.scheduled).toBe(TODAY);
  });

  it('takes the notes, drawings and links with it, without taking them off the task', async () => {
    const { m, vault, index } = await taskWithEverything();
    const r = await m.projectFromTask(index.task('tsk-grow')!.key, { status: 'active', priority: 'normal' });
    expect(r.carried).toEqual({ notes: 1, drawings: 1, links: 1 });

    const project = { kind: 'project' as const, id: r.project.id, title: r.project.title };
    expect(index.notesFor(project).map((n) => n.title)).toEqual(['Cert research']);
    expect(index.drawingsFor(project).map((d) => d.title)).toEqual(['Cert map']);

    // The files now answer to both, and the project note lists them.
    expect(await vault.read('81 AI/Cert research.md')).toMatch(/helm-task: tsk-grow/);
    expect(await vault.read('81 AI/Cert research.md')).toMatch(new RegExp(`helm-project: ${r.project.id}`));
    const note = await vault.read(r.project.path);
    expect(note).toContain('[[Cert research]]');
    expect(note).toContain('![[Cert map.excalidraw]]');
    expect(note).toMatch(/## Links\n\n- \[OCI docs\]\(https:\/\/docs\.example\.com\/oci\)/);

    const task = [...index.snapshot.tasks.values()].find((t) => t.id === 'tsk-grow' && t.origin === 'project')!;
    expect(index.notesFor({ kind: 'task', key: task.key, id: 'tsk-grow', title: task.text }).map((n) => n.title)).toEqual(['Cert research']);
  });

  it('carries the belongings when a task is moved into an existing project too', async () => {
    const { m, vault, index } = await taskWithEverything();
    const carried = await m.carryAttachmentsToProject(index.task('tsk-grow')!.key, 'prj-kitchen');
    expect(carried).toEqual({ notes: 1, drawings: 1, links: 1 });
    const note = await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md');
    expect(note).toContain('[[Cert research]]');
    expect(note).toContain('## Links');
    // Running it twice does not duplicate anything.
    await m.carryAttachmentsToProject(index.task('tsk-grow')!.key, 'prj-kitchen');
    const again = await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md');
    expect(again.match(/Cert research/g)).toHaveLength(1);
    expect(again.match(/docs\.example\.com/g)).toHaveLength(1);
  });

  it('carries the belongings however the task gets into a project — the move itself does it', async () => {
    const { m, vault, index } = await taskWithEverything();
    // Straight moveToProject, the way the command, the inbox row and the task editor all call it.
    await m.moveToProject(index.task('tsk-grow')!.key, 'prj-kitchen');
    const note = await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md');
    expect(note).toContain('Build the cert lab');
    expect(note).toContain('[[Cert research]]');
    expect(note).toContain('![[Cert map.excalidraw]]');
    expect(note).toMatch(/## Links\n\n- \[OCI docs\]\(https:\/\/docs\.example\.com\/oci\)/);
    const kitchen = { kind: 'project' as const, id: 'prj-kitchen', title: 'Kitchen Remodel' };
    expect(index.notesFor(kitchen).map((n) => n.title)).toContain('Cert research');
    expect(index.drawingsFor(kitchen).map((d) => d.title)).toContain('Cert map');
    // Moving it on to a second project takes them along again, and adds nothing twice.
    await m.moveToProject(index.taskById('tsk-grow')!.key, 'prj-book');
    const book = await vault.read('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md');
    expect(book.match(/Cert research/g)).toHaveLength(1);
    expect(index.notesFor({ kind: 'project', id: 'prj-book', title: 'Oracle Book Writing' }).map((n) => n.title)).toContain('Cert research');
  });

  it('refuses to promote a task that already lives in a project', async () => {
    const { m, index } = await setup();
    const inProject = [...index.snapshot.tasks.values()].find((t) => t.origin === 'project')!;
    await expect(m.projectFromTask(inProject.key, { status: 'active', priority: 'normal' })).rejects.toThrow(/already lives in a project/i);
  });
});

describe('links on a project', () => {
  it('adds, reads back and removes addresses in the project note', async () => {
    const { m, vault, index } = await setup();
    expect(index.project('prj-kitchen')!.links).toEqual([]);
    await m.addProjectLink('prj-kitchen', 'https://example.com/quote', 'The quote');
    await m.addProjectLink('prj-kitchen', 'plumbers.example.com/rates');
    const p = index.project('prj-kitchen')!;
    expect(p.links).toEqual([
      { url: 'https://example.com/quote', label: 'The quote' },
      { url: 'https://plumbers.example.com/rates', label: 'plumbers.example.com/rates' }, // the scheme is filled in
    ]);
    expect(await vault.read(p.path)).toMatch(/## Links\n\n- \[The quote\]\(https:\/\/example\.com\/quote\)/);
    await expect(m.addProjectLink('prj-kitchen', 'just some words')).rejects.toThrow(/not a web address/i);
    await m.removeProjectLink('prj-kitchen', 'https://example.com/quote');
    expect(index.project('prj-kitchen')!.links.map((l) => l.url)).toEqual(['https://plumbers.example.com/rates']);
    // Only the Links list counts — an address written in the body is left alone.
    expect(index.project('prj-book')!.links).toEqual([]);
  });
});

describe('a project pointing at tasks that live elsewhere', () => {
  it('lists them by id, keeps them where they are, and leaves the project’s own counts alone', async () => {
    const { m, vault, index } = await setup();
    const before = index.project('prj-kitchen')!;
    const ownWork = [...index.snapshot.tasks.values()].filter((t) => t.projectId === 'prj-kitchen' && t.origin === 'project').length;
    const day = [...index.snapshot.tasks.values()].find((t) => t.origin === 'daily' && t.status === 'todo' && t.section !== 'outside')!;
    expect(before.relatedTaskIds).toEqual([]);

    const id = await m.linkTaskToProject('prj-kitchen', day.key);
    expect(id).toMatch(/^tsk-/);
    const p = index.project('prj-kitchen')!;
    expect(p.relatedTaskIds).toEqual([id]);
    const note = await vault.read(p.path);
    expect(note).toMatch(new RegExp(`## Related tasks\\n\\n- ${id} · Start with OIB · \\[\\[25, Tuesday, Aug, 2026\\]\\]`));

    // The task did not move, and it is not counted as the project's work.
    const still = index.taskById(id)!;
    expect(still.origin).toBe('daily');
    expect(still.projectId).toBeUndefined();
    expect([...index.snapshot.tasks.values()].filter((t) => t.projectId === 'prj-kitchen' && t.origin === 'project')).toHaveLength(ownWork);

    // The reference survives the task being reworded, because it is by id.
    await m.updateTask(index.taskById(id)!.key, { text: 'Start with OIB, properly' });
    expect(index.project('prj-kitchen')!.relatedTaskIds).toEqual([id]);
    expect(index.taskById(id)!.text).toBe('Start with OIB, properly');

    // Linking twice changes nothing; unlinking takes it off.
    await m.linkTaskToProject('prj-kitchen', index.taskById(id)!.key);
    expect((await vault.read(p.path)).match(new RegExp(id, 'g'))).toHaveLength(1);
    await m.unlinkTaskFromProject('prj-kitchen', id);
    expect(index.project('prj-kitchen')!.relatedTaskIds).toEqual([]);
    expect(index.taskById(id)).toBeTruthy(); // unlinking is not deleting
  });

  it('refuses to point a project at its own task', async () => {
    const { m, index } = await setup();
    const own = [...index.snapshot.tasks.values()].find((t) => t.origin === 'project' && t.projectId === 'prj-book')!;
    await expect(m.linkTaskToProject('prj-book', own.key)).rejects.toThrow(/already belongs/i);
  });
});
