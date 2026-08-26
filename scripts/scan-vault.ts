/** Read-only: index a real vault with Helm's parser and print what it sees. Never writes. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { DEFAULT_SETTINGS } from '../src/core/types';
import { HelmIndex } from '../src/data/index';
import type { VaultAdapter } from '../src/data/vault';
import { todayLocal } from '../src/core/dates';
import { projectHealth, candidates, dayPlan } from '../src/data/planner';

const root = process.argv[2]!;
const walk = (dir: string, out: string[] = []): string[] => { for (const e of readdirSync(dir)) { if (e.startsWith('.')) continue; const p = join(dir, e); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) walk(p, out); else if (e.endsWith('.md')) out.push(relative(root, p)); } return out; };
const vault: VaultAdapter = {
  list: async () => walk(root), read: async (p) => readFileSync(join(root, p), 'utf8'),
  write: async () => { throw new Error('read-only'); }, exists: async (p) => { try { statSync(join(root, p)); return true; } catch { return false; } },
  mtime: (p) => { try { return statSync(join(root, p)).mtimeMs; } catch { return undefined; } },
};
const dn = JSON.parse(readFileSync(join(root, '.obsidian/daily-notes.json'), 'utf8'));
const settings = { ...DEFAULT_SETTINGS };
const index = new HelmIndex(vault, { settings: () => settings, today: todayLocal, dailyConfig: () => ({ folder: dn.folder, format: dn.format }) });
const t0 = Date.now();
await index.rebuild();
const s = index.snapshot;
console.log(`indexed in ${Date.now() - t0} ms: ${s.projects.size} projects, ${s.tasks.size} tasks, ${s.habits.size} habits, ${s.dailyNotes.size} daily notes, ${s.completions.length} habit ticks`);
const by: Record<string, number> = {}; for (const t of s.tasks.values()) by[t.origin] = (by[t.origin] ?? 0) + 1; console.log('tasks by origin', by);
const st: Record<string, number> = {}; for (const p of s.projects.values()) st[p.status] = (st[p.status] ?? 0) + 1; console.log('projects by status', st);
console.log('umbrellas', [...s.projects.values()].filter((p) => p.childIds.length).map((p) => `${p.title} (${p.childIds.length})`).join(' | '));
console.log('with phases', [...s.projects.values()].filter((p) => p.phases.length).map((p) => `${p.title}:${p.phases.length}`).join(' | ') || 'none');
console.log('with period/goal fm', [...s.projects.values()].filter((p) => (p as unknown as { period?: string }).period).length);
const today = todayLocal();
const plan = dayPlan(s, today, settings); console.log(`today ${today}: ${plan.today.length} today, ${plan.timeBlocks.length} time blocks, ${plan.mirrors.length} mirrors`);
const c = candidates(s, today, settings, today); console.log(`candidates: ${c.length}`, c.slice(0, 8).map((x) => `[${x.reason}] ${x.task.text.slice(0, 40)}`).join(' | '));
const hs = [...s.projects.values()].map((p) => projectHealth(s, p, today, settings));
console.log('flags', hs.filter((h) => h.flags.length).map((h) => `${h.project.title}: ${h.flags.join(',')}`).slice(0, 12).join(' | '));
const diag: Record<string, number> = {}; for (const d of s.diagnostics) diag[d.code] = (diag[d.code] ?? 0) + 1; console.log('diagnostics', diag, s.diagnostics.filter((d) => d.severity !== 'info').slice(0, 5).map((d) => `${d.code} ${d.path}: ${d.message}`));
console.log('sample project', [...s.projects.values()].find((p) => p.title === 'Oracle Book Writing'));
