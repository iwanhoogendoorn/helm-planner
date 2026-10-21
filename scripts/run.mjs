// Run a TypeScript script with esbuild, no extra dependencies.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [, , script, ...rest] = process.argv;
if (!script) { console.error('usage: node scripts/run.mjs <script.ts> [-- args]'); process.exit(1); }
const dir = mkdtempSync(join(tmpdir(), 'helm-run-'));
const out = join(dir, 'script.mjs');
// The ESM bundle gets a `require` so code that loads node modules lazily (the API server's `require('node:http')`) works.
const banner = { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" };
const r = await build({ entryPoints: [resolve(script)], bundle: true, platform: 'node', format: 'esm', target: 'node22', write: false, external: ['obsidian'], banner });
writeFileSync(out, r.outputFiles[0].text);
const args = rest[0] === '--' ? rest.slice(1) : rest;
// Ctrl-C reaches the child too; ignoring it here lets the child stop first, so the temp folder is still removed.
process.on('SIGINT', () => {});
const res = spawnSync(process.execPath, [out, ...args], { stdio: 'inherit' });
rmSync(dir, { recursive: true, force: true });
process.exit(res.status ?? 1);
