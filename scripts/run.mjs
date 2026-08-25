// Run a TypeScript script with esbuild, no extra dependencies.
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const [, , script, ...rest] = process.argv;
if (!script) { console.error('usage: node scripts/run.mjs <script.ts> [-- args]'); process.exit(1); }
const out = join(mkdtempSync(join(tmpdir(), 'helm-run-')), 'script.mjs');
const r = await build({ entryPoints: [resolve(script)], bundle: true, platform: 'node', format: 'esm', target: 'node20', write: false, external: ['obsidian'] });
writeFileSync(out, r.outputFiles[0].text);
const args = rest[0] === '--' ? rest.slice(1) : rest;
const res = spawnSync(process.execPath, [out, ...args], { stdio: 'inherit' });
process.exit(res.status ?? 1);
