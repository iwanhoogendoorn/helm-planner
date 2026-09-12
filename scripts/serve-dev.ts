/**
 * Serve Helm's HTTP API over a folder on disk — no Obsidian, no risk to the real vault. For developing
 * the iPhone app and anything else that talks to the API:
 *
 *   npm run serve:dev                       # ~/dev/helm-iphone-vault on http://127.0.0.1:27127
 *   HELM_VAULT=~/dev/other HELM_PORT=27130 HELM_HOST=0.0.0.0 HELM_TODAY=2026-09-11 npm run serve:dev
 *
 * Same routes, same code path (`startApiServer` + `handle`), same index and mutations the plugin uses,
 * with `FsVault` standing in for Obsidian. Edits made on disk (an editor, git checkout, the seeder)
 * are picked up through fs.watch. The token is read from, or created in, `<vault>/.helm-dev-token`.
 */
import { existsSync, readFileSync, statSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomToken, startApiServer } from '../src/api/server';
import { API_BASE } from '../src/api/routes';
import { apiUrls } from '../src/api/bind';
import { todayLocal } from '../src/core/dates';
import { DEFAULT_SETTINGS, type HelmSettings, type IsoDate } from '../src/core/types';
import { FsVault } from '../src/data/fsVault';
import { HelmIndex } from '../src/data/index';
import { Mutations } from '../src/data/mutations';

const expandHome = (p: string): string => (p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const vaultDir = resolve(expandHome(process.env['HELM_VAULT'] ?? join(homedir(), 'dev', 'helm-iphone-vault')));
// The same guard the seeder uses: nothing that looks like a real vault, ever.
if (/IWAN-REMOTE-VAULT|\/Documents\/|Desktop|iCloud|Dropbox/i.test(vaultDir) || vaultDir.split('/').length < 4) {
  console.error(`Refusing to serve ${vaultDir}: it looks like a real vault. Point HELM_VAULT at a disposable copy.`);
  process.exit(2);
}
if (!existsSync(vaultDir)) {
  console.error(`${vaultDir} does not exist. Seed one first: HELM_VAULT=${vaultDir} npm run seed`);
  process.exit(2);
}
// Belt and braces: a disposable copy says so with a marker file; a vault without one is never served, whatever it is called.
const MARKER = '.helm-dev-vault';
if (!existsSync(join(vaultDir, MARKER))) {
  console.error(`Refusing to serve ${vaultDir}: no ${MARKER} marker. The dev server only serves disposable copies — \`npm run seed\` writes the marker, or create it by hand in a copy you can afford to lose:\n  touch '${join(vaultDir, MARKER)}'`);
  process.exit(2);
}

const port = Number(process.env['HELM_PORT'] ?? 27127);
const host = process.env['HELM_HOST'] ?? '127.0.0.1';
const fixedToday = process.env['HELM_TODAY'];
if (fixedToday !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(fixedToday)) { console.error('HELM_TODAY must be YYYY-MM-DD'); process.exit(2); }
const today = (): IsoDate => fixedToday ?? todayLocal();

const tokenFile = join(vaultDir, '.helm-dev-token');
let token = process.env['HELM_TOKEN']?.trim() ?? '';
if (!token) {
  if (existsSync(tokenFile)) token = readFileSync(tokenFile, 'utf8').trim();
  if (!/^[0-9a-f]{48}$/.test(token)) { token = randomToken(); writeFileSync(tokenFile, token + '\n', { mode: 0o600 }); }
}

const vault = new FsVault(vaultDir);

// Configuration the plugin would read from .obsidian: daily and periodic note layout, Helm's own settings.
const readJson = (rel: string): Record<string, unknown> | undefined => {
  try { return JSON.parse(readFileSync(join(vaultDir, rel), 'utf8')) as Record<string, unknown>; } catch { return undefined; }
};
const DAILY_FALLBACK = { folder: '70 OBSIDIAN/70-06 Daily Notes', format: 'YYYY/MM - MMMM/ww/DD, dddd, MMM, YYYY', template: '70 OBSIDIAN/70-07 Templates/DAILY NOTE TEMPLATE' };
const core = readJson('.obsidian/daily-notes.json');
const pn = readJson('.obsidian/plugins/periodic-notes/data.json');
const pnDaily = pn?.['daily'] as Record<string, unknown> | undefined;
const pick = (k: 'folder' | 'format' | 'template'): string => {
  const c = core?.[k];
  const p = pnDaily?.[k];
  return typeof c === 'string' && c.trim() !== '' ? c : typeof p === 'string' && p.trim() !== '' ? p : DAILY_FALLBACK[k];
};
const daily = { folder: pick('folder').replace(/\/+$/, ''), format: pick('format'), template: pick('template') };
const PERIODIC_FALLBACK = { year: { folder: '70 OBSIDIAN/70-19 Yearly Notes', format: 'YYYY' }, quarter: { folder: '70 OBSIDIAN/70-18 Quarterly Notes', format: 'YYYY-[Q]Q' }, month: { folder: '70 OBSIDIAN/70-17 Monthly Notes', format: 'YYYY-MM' }, week: { folder: '70 OBSIDIAN/70-12 Weekly Notes', format: 'gggg-[W]ww' } };
const per = (kind: keyof typeof PERIODIC_FALLBACK, key: 'yearly' | 'quarterly' | 'monthly' | 'weekly'): { folder: string; format: string; template: string } => {
  const c = pn?.[key] as Record<string, unknown> | undefined;
  const g = (k: string): string => (typeof c?.[k] === 'string' ? (c[k] as string).trim() : '');
  return { folder: (g('folder') || PERIODIC_FALLBACK[kind].folder).replace(/\/+$/, ''), format: g('format') || PERIODIC_FALLBACK[kind].format, template: g('template') };
};
const periodic = { year: per('year', 'yearly'), quarter: per('quarter', 'quarterly'), month: per('month', 'monthly'), week: per('week', 'weekly') };

const settings: HelmSettings = {
  ...DEFAULT_SETTINGS,
  projectsFolder: '02 PROJECTS',
  habitsFolder: '02 PROJECTS/Habits',
  inboxNote: '01 INBOX/Inbox.md',
  dailyCapacityMinutes: 360,
  ...((readJson('.obsidian/plugins/helm-planner/data.json') ?? {}) as Partial<HelmSettings>),
  // The API is this process; the plugin's own API settings mean nothing here.
  apiEnabled: true, apiPort: port, apiToken: token, apiBind: 'loopback',
};
if (!Array.isArray(settings.extraFolders)) settings.extraFolders = [];

const readTemplate = async (p: string): Promise<string | undefined> => {
  if (!p) return undefined;
  try { return await vault.read(p.endsWith('.md') ? p : `${p}.md`); } catch { return undefined; }
};

const index = new HelmIndex(vault, {
  settings: () => settings,
  today,
  dailyConfig: () => ({ folder: daily.folder, format: daily.format }),
  periodicConfig: () => ({ year: periodic.year, quarter: periodic.quarter, month: periodic.month, week: periodic.week }),
});
const mutations = new Mutations({
  vault, index,
  settings: () => settings,
  today,
  now: () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; },
  notify: (m) => console.log(`[helm/notice] ${m}`),
  dailyTemplate: () => readTemplate(settings.dailyNoteTemplate.trim() || daily.template),
  periodicTemplate: (kind) => readTemplate(periodic[kind].template),
});

const version = (() => { try { return (JSON.parse(readFileSync(resolve('manifest.json'), 'utf8')) as { version: string }).version + '-dev'; } catch { return 'dev'; } })();

// ── disk → index, the way main.ts turns vault events into index updates ─────────────────────────
const pending = new Set<string>();
let timer: NodeJS.Timeout | undefined;
let firstPending = 0; // a burst (a git checkout) keeps resetting the debounce; the flush still runs within a second of the first event
const touch = (rel: string): void => {
  if (!FsVault.visible(rel)) return;
  index.noteSeen(rel);
  if (!index.inScope(rel) && !index.hasFile(rel)) return;
  if (pending.size === 0) firstPending = Date.now();
  pending.add(rel);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), Math.max(0, Math.min(250, firstPending + 1000 - Date.now())));
};
async function flush(): Promise<void> {
  timer = undefined;
  firstPending = 0;
  const paths = [...pending];
  pending.clear();
  const entries: { path: string; content?: string }[] = [];
  for (const p of paths) {
    if (!(await vault.exists(p))) { index.noteGone(p); entries.push({ path: p }); continue; }
    if (!statSync(vault.abs(p)).isFile()) continue; // a folder appeared or was touched: its files get their own events
    try { entries.push({ path: p, content: await vault.read(p) }); } catch (e) { console.warn(`[helm/dev] could not read ${p}: ${String(e)}`); }
  }
  // A file the API itself just wrote hashes the same as what the index holds, so it is skipped here.
  const n = index.updateMany(entries);
  if (n > 0) console.log(`[helm/dev] re-parsed ${n} file(s) changed on disk`);
}
function watchVault(): FSWatcher | undefined {
  try {
    return watch(vaultDir, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const rel = String(filename).split('\\').join('/');
      touch(rel);
    });
  } catch (e) {
    console.warn(`[helm/dev] fs.watch is not available here (${String(e)}); edits on disk will not show up until restart.`);
    return undefined;
  }
}

async function main(): Promise<void> {
  const t0 = Date.now();
  await index.rebuild();
  const snap = index.snapshot;
  console.log(`[helm/dev] indexed ${vaultDir}: ${snap.tasks.size} tasks, ${snap.projects.size} projects, ${snap.habits.size} habits in ${Date.now() - t0} ms (today=${today()})`);
  const server = await startApiServer({
    port, host, token,
    log: (m) => console.log(`[helm/api] ${m}`),
    deps: {
      index, mutations,
      settings: () => settings,
      today,
      version,
      written: () => vault.takeWrites(),
      vaultName: basename(vaultDir),
      read: (path) => vault.read(path),
      readBinary: (path) => vault.readBinary(path),
    },
  });
  const watcher = watchVault();
  const urls = apiUrls(server.host, server.port, networkInterfaces(), API_BASE);
  console.log('');
  console.log('Helm dev API is up.');
  for (const u of urls) console.log(`  base URL : ${u}`);
  console.log(`  token    : ${process.env['HELM_TOKEN'] ? '(from HELM_TOKEN)' : tokenFile}`);
  console.log(`  vault    : ${vaultDir}`);
  console.log(`  today    : ${today()}${fixedToday ? ' (HELM_TODAY)' : ''}`);
  console.log('');
  console.log(`  curl -s ${urls[0]}/health -H "Authorization: Bearer $(cat '${tokenFile}')"`);
  console.log('');
  const stop = (): void => { watcher?.close(); server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((e) => { console.error('[helm/dev] failed to start:', e); process.exit(1); });
