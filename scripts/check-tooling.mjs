// Regression checks for the build and tooling setup (review findings M3, M4, L1, L11–L14).
// Each check names the finding it guards. Exits 1 and lists every failure.
// usage: node scripts/check-tooling.mjs [repo root]   (the root needs its own node_modules for the run.mjs check)
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const text = (f) => readFileSync(join(root, f), 'utf8');
const json = (f) => JSON.parse(text(f));
const pkg = json('package.json'), lock = json('package-lock.json'), tsconfig = json('tsconfig.json');
const workflows = readdirSync(join(root, '.github', 'workflows')).filter((f) => /\.ya?ml$/.test(f));
const major = (v) => v.split('.').map(Number);
const failures = [];
const check = (id, ok, msg) => { if (!ok) failures.push(`${id}: ${msg}`); };

// M3 — reproducible builds: no floating dev dependency, obsidian typings pinned exactly.
for (const [name, range] of Object.entries(pkg.devDependencies ?? {})) check('M3', !/^(latest|\*|)$/.test(range), `${name} floats on "${range}"`);
check('M3', /^\d+\.\d+\.\d+$/.test(pkg.devDependencies?.obsidian ?? ''), `obsidian is "${pkg.devDependencies?.obsidian}", not an exact version`);

// M4 — the dev toolchain sits on majors without the known critical/high advisories.
const locked = (name) => lock.packages?.[`node_modules/${name}`]?.version ?? '0.0.0';
const [vMaj] = major(locked('vitest')), [eMaj, eMin] = major(locked('esbuild'));
check('M4', vMaj >= 4, `vitest ${locked('vitest')} is below 4 (tinypool/vite advisories)`);
check('M4', eMaj > 0 || eMin >= 25, `esbuild ${locked('esbuild')} is 0.24 or older (GHSA-67mh-4wv8-2f99)`);

// L1 — the lockfile's root version follows package.json.
check('L1', lock.version === pkg.version && lock.packages?.['']?.version === pkg.version, `package-lock.json says ${lock.version}, package.json ${pkg.version}`);

// L11 — no dead tsconfig options, no flags repeated on the command line.
const opts = tsconfig.compilerOptions ?? {};
check('L11', !('baseUrl' in opts) || 'paths' in opts, 'tsconfig.json sets baseUrl without paths');
for (const [name, cmd] of Object.entries(pkg.scripts ?? {})) if (opts.skipLibCheck) check('L11', !/tsc\b[^&|]*--skipLibCheck/.test(cmd), `script "${name}" repeats --skipLibCheck`);

// L12 — scripts/run.mjs leaves nothing behind in the temp directory.
const tmp = mkdtempSync(join(tmpdir(), 'helm-check-'));
try {
  const probe = join(tmp, 'probe.ts');
  writeFileSync(probe, "console.log('probe');\n");
  const res = spawnSync(process.execPath, [join(root, 'scripts', 'run.mjs'), probe], { cwd: root, env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp }, encoding: 'utf8' });
  check('L12', res.status === 0, `run.mjs exited ${res.status}: ${res.stderr.trim()}`);
  const left = readdirSync(tmp).filter((f) => f.startsWith('helm-run-'));
  check('L12', left.length === 0, `run.mjs left ${left.join(', ')} in the temp directory`);
} finally { rmSync(tmp, { recursive: true, force: true }); }

// L13 and L14 — workflows pin actions by commit SHA and run on a supported Node.
for (const f of workflows) {
  const src = text(join('.github', 'workflows', f));
  for (const [, ref] of src.matchAll(/uses:\s*(\S+)/g)) check('L13', /@[0-9a-f]{40}$/.test(ref), `${f}: ${ref} is not pinned to a commit SHA`);
  for (const [, v] of src.matchAll(/node-version:\s*'?(\d+)/g)) check('L14', Number(v) >= 22, `${f}: node-version ${v} is end of life`);
}
const floor = /(\d+)/.exec(pkg.engines?.node ?? '')?.[1];
check('L14', Number(floor) >= 22, `engines.node "${pkg.engines?.node}" still allows an end-of-life Node`);

if (failures.length) { for (const f of failures) console.error(`FAIL ${f}`); process.exit(1); }
console.log('[helm] tooling checks passed (M3, M4, L1, L11, L12, L13, L14)');
