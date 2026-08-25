// Copy the built plugin into a vault's plugin folder. Never enables it.
// usage: node scripts/install.mjs "/path/to/vault"
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const vault = process.argv[2];
if (!vault) { console.error('usage: node scripts/install.mjs <vault path>'); process.exit(1); }
if (!existsSync(join(vault, '.obsidian'))) { console.error(`${vault} does not look like a vault (no .obsidian)`); process.exit(2); }
if (!existsSync(resolve('main.js'))) { console.error('main.js missing — run npm run build first'); process.exit(3); }
const dir = join(vault, '.obsidian', 'plugins', 'helm-planner');
mkdirSync(dir, { recursive: true });
for (const f of ['main.js', 'manifest.json', 'styles.css']) cpSync(resolve(f), join(dir, f));
console.log(`Installed Helm into ${dir}. Enable it under Settings → Community plugins.`);
