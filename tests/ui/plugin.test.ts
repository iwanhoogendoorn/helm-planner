// @vitest-environment jsdom
/**
 * Boots the real HelmPlugin against a fake Obsidian app: settings load,
 * daily-note config discovery, index build, commands, vault events flowing
 * into the index, and the reconcile loop fixing an outside edit.
 */
import { describe, expect, it, vi } from 'vitest';
import { FakeApp, FakeTFile } from '../stubs/fakeApp';
import HelmPlugin from '../../src/main';
import { makeVault, dailyPath, TODAY, DAILY_FOLDER, DAILY_FORMAT } from '../data/fixture';
import { VIEW_TYPE } from '../../src/ui/view';

async function boot(): Promise<{ plugin: HelmPlugin; app: FakeApp }> {
  const mem = makeVault();
  const app = new FakeApp(mem);
  app.configFiles.set('.obsidian/daily-notes.json', JSON.stringify({ folder: DAILY_FOLDER, format: DAILY_FORMAT, template: '70 OBSIDIAN/70-07 Templates/DAILY NOTE TEMPLATE' }));
  const plugin = new HelmPlugin(app as never, { id: 'helm-planner', name: 'Helm', version: '0.1.0' } as never);
  plugin.today = () => TODAY;
  plugin.loadData = async () => ({ projectsFolder: '02 PROJECTS', habitsFolder: '02 PROJECTS/Habits', inboxNote: '01 INBOX/Inbox.md', developerActions: true });
  plugin.saveData = async () => undefined;
  await plugin.onload();
  app.workspace.fireLayoutReady();
  await plugin.index.rebuild();
  return { plugin, app };
}

const tick = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('HelmPlugin', () => {
  it('loads settings, discovers daily-note config, builds the index, registers commands', async () => {
    const { plugin, app } = await boot();
    expect(plugin.settings.projectsFolder).toBe('02 PROJECTS');
    expect(plugin.dailyConfig().folder).toBe(DAILY_FOLDER);
    expect(plugin.index.dailyPath(TODAY)).toBe(dailyPath(TODAY));
    expect(plugin.index.snapshot.projects.size).toBe(4);
    const ids = app.commands.map((c) => c.id);
    for (const id of ['open', 'capture', 'plan-day', 'wrap-up', 'new-project', 'rebuild-index', 'task-under-cursor-today', 'self-test']) expect(ids).toContain(id);
    expect(app.views.has(VIEW_TYPE)).toBe(true);
    expect(app.ribbons.map((r) => r.title)).toContain('Open Helm');
    expect(app.protocolHandlers.has('helm')).toBe(true);
  });

  it('a vault modify event re-indexes the file and reconcile fixes a mirror edited outside Helm', async () => {
    const { plugin, app } = await boot();
    await plugin.mutations.schedule('tsk-0001', TODAY);
    const p = dailyPath(TODAY);
    // The user ticks the mirror in the editor.
    const content = (await app.vault.read(new FakeTFile(p))).replace('- [ ] Draft chapter list', '- [x] Draft chapter list');
    app.vault.files.files.set(p, content);
    app.vault.emit('modify', new FakeTFile(p));
    await tick(300); // debounce
    expect(plugin.index.task(`tsk-0001@${TODAY}`)?.status).toBe('done');
    await tick(700); // reconcile
    expect(plugin.index.task('tsk-0001')?.status).toBe('done');
    expect(await app.vault.read(new FakeTFile('02 PROJECTS/Oracle Book Writing/Oracle Book Writing.md'))).toContain('- [x] Draft chapter list 🆔 tsk-0001 ⏳ 2026-08-26 ⏫ ✅ 2026-08-26');
  });

  it('delete and rename events drop and re-add files', async () => {
    const { plugin, app } = await boot();
    const p = '02 PROJECTS/Kitchen Remodel/Kitchen Remodel.md';
    app.vault.emit('delete', new FakeTFile(p));
    expect(plugin.index.project('prj-kitchen')).toBeUndefined();
    const np = '02 PROJECTS/Kitchen v2/Kitchen v2.md';
    app.vault.files.files.set(np, app.vault.files.files.get(p)!);
    app.vault.emit('rename', new FakeTFile(np), p);
    await tick(300);
    expect(plugin.index.project('prj-kitchen')?.path).toBe(np);
  });

  it('editor commands find the task under the cursor', async () => {
    const { app } = await boot();
    const cmd = app.commands.find((c) => c.id === 'task-under-cursor-today')!;
    const editor = { getCursor: () => ({ line: 2, ch: 0 }) };
    const view = { file: { path: '01 INBOX/Inbox.md' } };
    expect(cmd.editorCheckCallback!(true, editor as never, view as never)).toBe(true);
    expect(cmd.editorCheckCallback!(true, { getCursor: () => ({ line: 0, ch: 0 }) } as never, view as never)).toBe(false);
    cmd.editorCheckCallback!(false, editor as never, view as never);
    await tick(10);
    expect(await app.vault.read(new FakeTFile(dailyPath(TODAY)))).toContain('- [ ] Call the plumber');
  });

  it('the self-test passes against the fixture vault', async () => {
    const { plugin, app } = await boot();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const cmd = app.commands.find((c) => c.id === 'self-test')!;
    expect(cmd.checkCallback!(true)).toBe(true);
    cmd.checkCallback!(false);
    for (let i = 0; i < 50 && !app.vault.files.files.has('Helm Self-Test Report.md'); i++) await tick(20);
    const report = app.vault.files.files.get('Helm Self-Test Report.md') ?? '';
    expect(report).toContain('0 failed');
    expect(report).not.toContain('❌');
    expect(plugin.index.projectByTitle('Helm Self-Test')).toBeDefined();
  });
});
