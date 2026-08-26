import { describe, expect, it } from 'vitest';
import { setup, TODAY, dailyPath } from './fixture';
import { HelmIndex } from '../../src/data/index';
import { Mutations } from '../../src/data/mutations';
import { SETTINGS, DAILY_FOLDER, DAILY_FORMAT, makeVault } from './fixture';

const DRAW = (fm: string, text = ''): string => `---\n${fm}\nexcalidraw-plugin: parsed\ntags: [excalidraw]\n---\n# Excalidraw Data\n\n## Text Elements\n${text}\n\n%%\n## Drawing\n\`\`\`json\n{"type":"excalidraw","elements":[]}\n\`\`\`\n%%\n`;
const EXTRA = {
  '02 PROJECTS/Kitchen Remodel/Layout v2.excalidraw.md': DRAW('', 'Kitchen layout ^a'),                                    // by folder → project
  'Excalidraw/25, Tuesday, Aug, 2026.excalidraw.md': DRAW('', 'morning sketch ^a'),                                        // by name → date
  'Excalidraw/2026-W35 map.excalidraw.md': DRAW('', 'week map ^a'),                                                       // by name → week
  'Excalidraw/random.excalidraw.md': DRAW('', 'see [[Kitchen Remodel]] and [[2026-Q3]] ^a'),                              // by links → project + quarter
  'Excalidraw/flow.excalidraw.md': DRAW('helm-task: tsk-0001\nhelm-date: 2026-08-26', ''),                                  // explicit
  'Excalidraw/board.canvas': '{}',                                                                                          // canvas, path only
};

describe('drawing attachments', () => {
  it('attaches drawings by frontmatter, folder, name, links and embeds', async () => {
    const { index } = await setup(EXTRA);
    const titles = (ds: { title: string }[]): string[] => ds.map((d) => d.title).sort();
    expect(titles(index.drawingsFor({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' }))).toEqual(['Layout v2', 'random']);
    expect(titles(index.drawingsFor({ kind: 'date', date: '2026-08-25', title: '' }))).toEqual(['25, Tuesday, Aug, 2026']);
    expect(titles(index.drawingsFor({ kind: 'date', date: '2026-08-26', title: '' }))).toEqual(['flow']);
    expect(titles(index.drawingsFor({ kind: 'period', key: '2026-W35', title: '' }))).toEqual(['2026-W35 map']);
    expect(titles(index.drawingsFor({ kind: 'period', key: '2026-Q3', title: '' }))).toEqual(['random']);
    const t = index.task('tsk-0001')!;
    expect(titles(index.drawingsFor({ kind: 'task', key: t.key, id: 'tsk-0001', title: '' }))).toEqual(['flow']);
    expect(index.allDrawings().map((d) => d.title)).toContain('board');
  });
  it('a daily note embedding a drawing claims it', async () => {
    const { index } = await setup({ ...EXTRA, [dailyPath('2026-08-25')]: (await (await setup()).vault.read(dailyPath('2026-08-25'))) + '\n## Diagrams\n\n![[random.excalidraw]]\n' });
    expect(index.drawingsFor({ kind: 'date', date: '2026-08-25', title: '' }).map((d) => d.title).sort()).toEqual(['25, Tuesday, Aug, 2026', 'random']);
  });
});

describe('creating drawings', () => {
  it('names and places a drawing by target, writes helm-* frontmatter, embeds it in the note, and the index sees it', async () => {
    const { m, vault, index } = await setup();
    const p = await m.createDrawing({ kind: 'period', key: '2026-W35', title: '2026-W35' }, { name: 'map' });
    expect(p).toBe('Excalidraw/2026-W35 — map.excalidraw.md');
    const c = await vault.read(p);
    expect(c).toContain('helm-period: 2026-W35');
    expect(c).toContain('excalidraw-plugin: parsed');
    expect(await vault.read('Weekly Notes/2026-W35.md')).toMatch(/## Diagrams\n\n!\[\[2026-W35 — map\.excalidraw\]\]/);
    expect(index.drawingsFor({ kind: 'period', key: '2026-W35', title: '' }).map((d) => d.title)).toEqual(['2026-W35 — map']);
    // Project drawings go in the project folder; a second one with the same name gets a number.
    const q1 = await m.createDrawing({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' }, { name: 'Architecture' });
    const q2 = await m.createDrawing({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' }, { name: 'Architecture' });
    expect(q1).toBe('02 PROJECTS/Kitchen Remodel/Architecture.excalidraw.md');
    expect(q2).toBe('02 PROJECTS/Kitchen Remodel/Architecture 2.excalidraw.md');
    expect(await vault.read('02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md')).toContain('![[Architecture.excalidraw]]');
    // A task drawing gives the task an id and records it; tasks are not embedded anywhere.
    const t = [...index.snapshot.tasks.values()].find((x) => x.text === 'Call the plumber' && x.origin !== 'daily-mirror')!;
    const d = await m.createDrawing({ kind: 'task', key: t.key, title: t.text });
    expect(d).toBe('Excalidraw/Call the plumber.excalidraw.md');
    expect(await vault.read(d)).toMatch(/helm-task: tsk-\w+/);
    const t2 = [...index.snapshot.tasks.values()].find((x) => x.text === 'Call the plumber' && x.origin !== 'daily-mirror')!;
    expect(t2.id).toMatch(/^tsk-/);
    expect(index.drawingsFor({ kind: 'task', key: t2.key, id: t2.id, title: '' }).map((x) => x.title)).toEqual(['Call the plumber']);
    // A day drawing is named after the daily note and embedded there.
    const dd = await m.createDrawing({ kind: 'date', date: '2026-08-26', title: '2026-08-26' });
    expect(dd).toBe('Excalidraw/26, Wednesday, Aug, 2026.excalidraw.md');
    expect(await vault.read(dailyPath('2026-08-26'))).toContain('![[26, Wednesday, Aug, 2026.excalidraw]]');
  });
  it('copies a configured template and follows the Excalidraw folder', async () => {
    const vault = makeVault({ 'Templates/Grid.excalidraw.md': '---\nexcalidraw-plugin: parsed\n---\n# Excalidraw Data\n## Text Elements\n\n%%\n## Drawing\n```json\n{"type":"excalidraw","elements":[],"appState":{"gridSize":20}}\n```\n%%\n' });
    const s = { ...SETTINGS, drawingTemplate: 'Templates/Grid.excalidraw', embedDrawings: false };
    const index = new HelmIndex(vault, { settings: () => s, today: () => TODAY, dailyConfig: () => ({ folder: DAILY_FOLDER, format: DAILY_FORMAT }), periodicConfig: () => ({ year: { folder: 'Yearly Notes', format: 'YYYY' }, quarter: { folder: 'Quarterly Notes', format: 'YYYY-[Q]Q' }, month: { folder: 'Monthly Notes', format: 'YYYY-MM' }, week: { folder: 'Weekly Notes', format: 'gggg-[W]ww' } }) });
    await index.rebuild();
    const m = new Mutations({ vault, index, settings: () => s, today: () => TODAY, notify: () => undefined, excalidrawFolder: () => '70 OBSIDIAN/70-02 Excalidraw' });
    const p = await m.createDrawing({ kind: 'date', date: TODAY, title: TODAY });
    expect(p).toBe('70 OBSIDIAN/70-02 Excalidraw/26, Wednesday, Aug, 2026.excalidraw.md');
    const c = await vault.read(p);
    expect(c).toContain('"gridSize":20');
    expect(c).toContain('helm-date: 2026-08-26');
    expect(vault.writes).not.toContain(dailyPath(TODAY));
  });
});






describe('deleting and linking drawings', () => {
  it('deleting a drawing trashes it and removes its embed (and an emptied Diagrams heading) from the note', async () => {
    const { m, vault, index } = await setup();
    const p = await m.createDrawing({ kind: 'period', key: '2026-W35', title: '2026-W35' }, { name: 'map' });
    expect(await vault.read('Weekly Notes/2026-W35.md')).toContain('![[2026-W35 — map.excalidraw]]');
    await m.deleteDrawing(p);
    expect(vault.trashed).toContain(p);
    const week = await vault.read('Weekly Notes/2026-W35.md');
    expect(week).not.toContain('map.excalidraw');
    expect(week).not.toMatch(/## Diagrams/);
    expect(index.drawingsFor({ kind: 'period', key: '2026-W35', title: '' })).toEqual([]);
  });
  it('linking an existing drawing to a task writes helm-task on the drawing; to a period adds the key and the embed; unlinking reverses both', async () => {
    const { m, vault, index } = await setup(EXTRA);
    const t = [...index.snapshot.tasks.values()].find((x) => x.origin === 'project' && x.projectId !== undefined && x.status !== 'done')!;
    await m.linkDrawing({ kind: 'task', key: t.key, title: t.text }, 'Excalidraw/random.excalidraw.md');
    const t2 = [...index.snapshot.tasks.values()].find((x) => x.text === t.text && x.origin === 'project')!;
    expect(t2.id).toMatch(/^tsk-/);
    expect(await vault.read('Excalidraw/random.excalidraw.md')).toContain(`helm-task: ${t2.id}`);
    expect(index.drawingsFor({ kind: 'task', key: t2.key, id: t2.id, title: '' }).map((d) => d.title)).toEqual(['random']);
    // A second target on the same drawing becomes a list; the period's note gets the embed.
    await m.linkDrawing({ kind: 'period', key: '2026-W35', title: '2026-W35' }, 'Excalidraw/random.excalidraw.md');
    await m.linkDrawing({ kind: 'period', key: '2026-08', title: '2026-08' }, 'Excalidraw/random.excalidraw.md');
    const c = await vault.read('Excalidraw/random.excalidraw.md');
    expect(c).toContain('helm-period:\n  - 2026-W35\n  - 2026-08');
    expect(await vault.read('Weekly Notes/2026-W35.md')).toContain('![[random.excalidraw]]');
    expect(index.drawingsFor({ kind: 'period', key: '2026-W35', title: '' }).map((d) => d.title)).toContain('random');
    // Linking twice is a no-op.
    const before = vault.writes.length;
    await m.linkDrawing({ kind: 'period', key: '2026-W35', title: '2026-W35' }, 'Excalidraw/random.excalidraw.md');
    expect(vault.writes.length).toBe(before);
    // Unlink from the week: key value and embed gone; the month and the task stay; the quarter link in its text still holds.
    await m.unlinkDrawing({ kind: 'period', key: '2026-W35', title: '2026-W35' }, 'Excalidraw/random.excalidraw.md');
    const c2 = await vault.read('Excalidraw/random.excalidraw.md');
    expect(c2).toContain('helm-period: 2026-08');
    expect(c2).not.toContain('2026-W35');
    expect(await vault.read('Weekly Notes/2026-W35.md')).not.toContain('random.excalidraw');
    expect(index.drawingsFor({ kind: 'period', key: '2026-W35', title: '' }).map((d) => d.title)).not.toContain('random');
    expect(index.drawingsFor({ kind: 'period', key: '2026-Q3', title: '' }).map((d) => d.title)).toEqual(['random']);
    await m.unlinkDrawing({ kind: 'task', key: t2.key, id: t2.id, title: '' }, 'Excalidraw/random.excalidraw.md');
    expect(await vault.read('Excalidraw/random.excalidraw.md')).not.toContain('helm-task');
    await expect(m.linkDrawing({ kind: 'date', date: TODAY, title: TODAY }, 'Excalidraw/board.canvas')).rejects.toThrow(/canvas/);
  });
});

