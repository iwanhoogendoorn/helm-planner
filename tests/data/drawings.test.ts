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

describe('AI overview diagrams', () => {
  it('sends a digest, draws the reply, marks it generated and embeds it', async () => {
    const { vault, index, settings } = await setup();
    const prompts: string[] = [];
    const m = new Mutations({ vault, index, settings: () => settings, today: () => TODAY, notify: () => undefined, ai: async (prompt) => { prompts.push(prompt); return '{"title":"Week 35 — Kitchen week","summary":"Tiles and plumbing moved.","themes":[{"name":"Kitchen Remodel","color":"blue","items":["Pick tiles","Call the plumber"]},{"name":"Book","items":["Draft chapter list"]}],"highlights":["Plumber booked"],"next":["Order tiles"]}'; } });
    const p = await m.generateDiagram({ kind: 'period', key: '2026-W35', title: 'Week 35' });
    expect(p).toBe('Excalidraw/2026-W35 — overview.excalidraw.md');
    expect(prompts[0]).toContain('Reply with ONLY a JSON object');
    expect(prompts[0]).toContain('Week 35, 2026');
    expect(prompts[0]).toContain('Kitchen Remodel');
    const c = await vault.read(p);
    expect(c).toContain('helm-generated: true');
    expect(c).toContain('> Tiles and plumbing moved.');
    expect(c).toContain('Week 35 — Kitchen week ^');
    expect(index.drawingsFor({ kind: 'period', key: '2026-W35', title: '' })[0]?.generated).toBe(true);
    expect(await vault.read('Weekly Notes/2026-W35.md')).toContain('![[2026-W35 — overview.excalidraw]]');
    // Project digest works too and refuses a non-diagram reply.
    const bad = new Mutations({ vault, index, settings: () => settings, today: () => TODAY, notify: () => undefined, ai: async () => 'I cannot do that.' });
    await expect(bad.generateDiagram({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' })).rejects.toThrow(/not a diagram/);
    expect(m.diagramPrompt({ kind: 'project', id: 'prj-kitchen', title: 'Kitchen Remodel' })).toContain('# Project: Kitchen Remodel');
  });
});

describe('excalidraw-diagram skill engine', () => {
  it('runs the skill in a scratch folder, imports the file it wrote, tags the engine, and embeds the drawing', async () => {
    const { vault, index, settings } = await setup();
    const s = { ...settings, aiEngine: 'skill' as const, skillBackground: 'dark' as const, skillRender: false };
    const runs: { prompt: string; cwd: string; extraDirs: string[] }[] = [];
    const files = new Map<string, string>();
    const m = new Mutations({ vault, index, settings: () => s, today: () => TODAY, notify: () => undefined, skill: {
      workDir: () => '/tmp/helm-x',
      expandHome: (p) => p.replace('~', '/Users/me'),
      run: async (prompt, o) => { runs.push({ prompt, cwd: o.cwd, extraDirs: o.extraDirs }); files.set('/tmp/helm-x/diagram.excalidraw', JSON.stringify({ type: 'excalidraw', version: 2, elements: [{ id: 'r1', type: 'rectangle', x: 0, y: 0, width: 200, height: 80 }, { id: 't1', type: 'text', x: 10, y: 10, width: 100, height: 20, text: 'Kitchen', containerId: 'r1' }, { id: 'gone', type: 'text', x: 0, y: 0, width: 1, height: 1, text: 'x', isDeleted: true }], appState: { viewBackgroundColor: '#1e1e1e' } })); return '/tmp/helm-x/diagram.excalidraw'; },
      readFile: async (p) => { const c = files.get(p); if (c === undefined) throw new Error('ENOENT'); return c; },
    } });
    const p = await m.generateDiagram({ kind: 'period', key: '2026-W35', title: 'Week 35' });
    expect(p).toBe('Excalidraw/2026-W35 — diagram.excalidraw.md');
    expect(runs[0]!.cwd).toBe('/tmp/helm-x');
    expect(runs[0]!.extraDirs).toEqual(['/Users/me/.claude/skills/excalidraw-diagram']);
    expect(runs[0]!.prompt).toContain('/Users/me/.claude/skills/excalidraw-diagram');
    expect(runs[0]!.prompt).toContain('Background: black (#1e1e1e)');
    expect(runs[0]!.prompt).toContain('Skip the render-and-validate loop');
    expect(runs[0]!.prompt).toContain('/tmp/helm-x/diagram.excalidraw');
    expect(runs[0]!.prompt).toContain('Week 35, 2026');
    const c = await vault.read(p);
    expect(c).toContain('helm-engine: excalidraw-diagram skill');
    expect(c).toContain('"viewBackgroundColor":"#1e1e1e"');
    expect(c).toMatch(/Kitchen \^h[a-z0-9]{9}/);
    expect(c).not.toContain('"gone"');
    expect(await vault.read('Weekly Notes/2026-W35.md')).toContain('![[2026-W35 — diagram.excalidraw]]');
  });
  it('falls back to a path in the reply, and fails clearly when nothing usable comes back', async () => {
    const { vault, index, settings } = await setup();
    const s = { ...settings, aiEngine: 'skill' as const };
    const mk = (run: () => Promise<string>, file?: string) => new Mutations({ vault, index, settings: () => s, today: () => TODAY, notify: () => undefined, skill: { workDir: () => '/tmp/w', expandHome: (p) => p, run, readFile: async (p) => { if (file !== undefined && p === '/tmp/w/other.excalidraw') return file; throw new Error('ENOENT'); } } });
    const ok = mk(async () => 'Done: /tmp/w/other.excalidraw', JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a', type: 'ellipse', x: 0, y: 0, width: 10, height: 10 }] }));
    expect(await ok.generateDiagram({ kind: 'date', date: TODAY, title: TODAY })).toBe('Excalidraw/26, Wednesday, Aug, 2026 — diagram.excalidraw.md');
    const bad = mk(async () => 'I could not do that.');
    await expect(bad.generateDiagram({ kind: 'date', date: TODAY, title: TODAY })).rejects.toThrow(/did not produce an Excalidraw file/);
  });
});

describe('skill engine when the clock runs out', () => {
  it('imports the file the skill already wrote, and only fails when there is none', async () => {
    const { vault, index, settings } = await setup();
    const s = { ...settings, aiEngine: 'skill' as const };
    const notices: string[] = [];
    const scene = JSON.stringify({ type: 'excalidraw', elements: [{ id: 'a', type: 'rectangle', x: 0, y: 0, width: 10, height: 10 }] });
    const mk = (file?: string) => new Mutations({ vault, index, settings: () => s, today: () => TODAY, notify: (m) => notices.push(m), skill: { workDir: () => '/tmp/w', expandHome: (p) => p, run: async () => { throw new Error('The AI took longer than 900s'); }, readFile: async (p) => { if (file !== undefined && p === '/tmp/w/diagram.excalidraw') return file; throw new Error('ENOENT'); } } });
    expect(await mk(scene).generateDiagram({ kind: 'period', key: '2026-W35', title: 'Week 35' })).toBe('Excalidraw/2026-W35 — diagram.excalidraw.md');
    expect(notices[0]).toMatch(/longer than 900s — imported the diagram it had already written/);
    await expect(mk().generateDiagram({ kind: 'period', key: '2026-W36', title: 'Week 36' })).rejects.toThrow(/longer than 900s/);
  });
});
