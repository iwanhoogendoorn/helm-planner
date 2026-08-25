/**
 * An end-to-end scenario run inside a live vault. Everything it creates sits
 * under a project called "Helm Self-Test" plus mirror lines in today's and
 * tomorrow's daily notes. It returns a markdown report; it never throws.
 */
import type { Plugin } from 'obsidian';
import type { IsoDate } from './core/types';
import { addDays } from './core/dates';
import type { HelmIndex } from './data/index';
import type { Mutations } from './data/mutations';
import type { VaultAdapter } from './data/vault';

interface Host extends Plugin { index: HelmIndex; mutations: Mutations; vault: VaultAdapter; today(): IsoDate }

export async function runSelfTest(host: Host): Promise<string> {
  const lines: string[] = ['# Helm self-test report', '', `Run at ${new Date().toISOString()} in vault “${host.app.vault.getName()}”.`, ''];
  let pass = 0;
  let fail = 0;
  const check = (name: string, ok: boolean, detail = ''): void => {
    if (ok) pass++; else fail++;
    lines.push(`- ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  };
  const read = (p: string): Promise<string> => host.vault.read(p);
  const today = host.today();
  const tomorrow = addDays(today, 1);
  const { index, mutations: m } = host;
  const title = 'Helm Self-Test';
  try {
    // Clean up a previous run.
    const old = index.projectByTitle(title);
    if (old) {
      for (const k of [...old.phases.flatMap((p) => p.taskKeys), ...old.looseTaskKeys]) { const t = index.task(k); if (t) await m.deleteTask(t.key).catch(() => undefined); }
    }
    const p = old ?? (await m.createProject({ title, status: 'active', priority: 'high', area: 'Testing', phases: [{ title: 'Alpha', due: addDays(today, 10), tasks: [] }], tasks: [] }));
    check('Project created and indexed', index.project(p.id) !== undefined, p.path);
    const phase = index.project(p.id)!.phases[0];
    check('Phase parsed with target date', phase !== undefined && phase.due === addDays(today, 10));

    await m.addTask({ text: 'Self-test task one', projectId: p.id, phaseId: phase?.id, fields: { priority: 'high', effortMinutes: 30, effortRaw: '30m' } });
    await m.addTask({ text: 'Self-test task two', projectId: p.id, fields: { due: addDays(today, 2) } });
    let src = await read(p.path);
    check('Tasks written into the phase and the Tasks section', src.includes('- [ ] Self-test task one') && src.includes('- [ ] Self-test task two'));
    const t1 = index.allTasks().find((t) => t.projectId === p.id && t.text === 'Self-test task one');
    const t2 = index.allTasks().find((t) => t.projectId === p.id && t.text === 'Self-test task two');
    check('Index sees both tasks', t1 !== undefined && t2 !== undefined);
    if (!t1 || !t2) throw new Error('tasks missing');

    await m.schedule(t1.key, today);
    src = await read(p.path);
    const t1b = index.allTasks().find((t) => t.projectId === p.id && t.text === 'Self-test task one')!;
    check('Scheduling adds ⏳ and an id to the source', /Self-test task one 🆔 tsk-\w+ (?:➕ \S+ )?⏳ \d{4}-\d{2}-\d{2}/.test(src), src.split('\n').find((l) => l.includes('task one')) ?? '');
    const dailyPath = index.dailyPath(today);
    const daily = await read(dailyPath);
    check('Mirror line written into today’s daily note', daily.includes('%% helm:start %%') && daily.includes(`Self-test task one 🆔 ${t1b.id}`) && daily.includes('🔗 [['), dailyPath);
    check('Mirror is linked in the index', index.mirrorsOf(t1b.key).length === 1);

    const mirror = index.mirrorsOf(t1b.key)[0]!;
    await m.setStatus(mirror.key, 'done');
    src = await read(p.path);
    check('Ticking the mirror completes the source', new RegExp(`- \\[x\\] Self-test task one 🆔 ${t1b.id}.*✅ ${today}`).test(src));
    check('…and the mirror itself', (await read(dailyPath)).includes(`- [x] Self-test task one 🆔 ${t1b.id}`));
    await m.setStatus(t1b.key, 'todo');
    check('Reopening flows back to the mirror', (await read(dailyPath)).includes(`- [ ] Self-test task one 🆔 ${t1b.id}`));

    await m.schedule(t1b.key, tomorrow);
    check('Rescheduling moves the mirror to tomorrow', !(await read(dailyPath)).includes(`Self-test task one 🆔 ${t1b.id}`) && (await read(index.dailyPath(tomorrow))).includes(`Self-test task one 🆔 ${t1b.id}`));
    await m.schedule(t1b.key, undefined);
    check('Unscheduling removes ⏳ and the mirror', !(await read(p.path)).includes('⏳') && !(await read(index.dailyPath(tomorrow))).includes(`Self-test task one 🆔 ${t1b.id}`));

    await m.addTask({ text: 'Self-test standalone', date: today, fields: { effortMinutes: 15, effortRaw: '15m' } });
    const st = index.allTasks().find((t) => t.origin === 'daily' && t.noteDate === today && t.text === 'Self-test standalone');
    check('Standalone task lands in the daily note’s Today section', st !== undefined && st.section === 'today');
    if (st) {
      await m.schedule(st.key, tomorrow);
      const st2 = index.allTasks().find((t) => t.origin === 'daily' && t.noteDate === tomorrow && t.text === 'Self-test standalone');
      check('Moving a daily task carries it to tomorrow’s note', st2 !== undefined && !(await read(dailyPath)).includes('Self-test standalone'));
      if (st2) await m.deleteTask(st2.key);
    }

    await m.updateTask(t2.key, { text: 'Self-test task two (edited)', priority: 'medium' });
    check('Editing rewrites the line', (await read(p.path)).includes('- [ ] Self-test task two (edited)') && (await read(p.path)).includes('🔼'));
    await m.appendLog(p.id, 'self-test ran');
    check('Log entry appended', (await read(p.path)).includes(`- ${today} — self-test ran`));
    await m.setProjectFields(p.id, { status: 'on-hold' });
    check('Frontmatter status updated', index.project(p.id)?.status === 'on-hold');
    await m.setProjectFields(p.id, { status: 'active' });

    const rec = await m.reconcile();
    check('Reconcile finds nothing to fix after a clean run', rec === 0, `${rec} writes`);
    const diags = index.snapshot.diagnostics.filter((d) => d.path === p.path);
    check('No diagnostics on the project note', diags.length === 0, diags.map((d) => d.message).join('; '));
  } catch (e) {
    fail++;
    lines.push(`- ❌ Exception: ${(e as Error).message}`);
    console.error('[helm selftest]', e);
  }
  lines.push('', `**${pass} passed, ${fail} failed.**`, '', 'The “Helm Self-Test” project can be deleted; the daily notes for today and tomorrow may still carry a Helm region.');
  return lines.join('\n');
}
