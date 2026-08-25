import esbuild from 'esbuild';
import process from 'node:process';
import builtins from 'builtin-modules';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, copyFileSync, existsSync } from 'node:fs';

const banner = `/* Helm — bundled by esbuild. Source: https://github.com/iwanhoogendoorn/helm-planner */\n`;
const prod = process.argv[2] === 'production';
const TEST_VAULT = process.env.HELM_VAULT ?? join(homedir(), 'dev', 'helm-test-vault');
const PLUGIN_DIR = join(TEST_VAULT, '.obsidian', 'plugins', 'helm-planner');

if (!prod) {
  if (/IWAN-REMOTE-VAULT|Documents/i.test(TEST_VAULT)) throw new Error(`Refusing to dev-build into a real vault: ${TEST_VAULT}`);
  mkdirSync(PLUGIN_DIR, { recursive: true });
}

const copyStatics = {
  name: 'copy-statics',
  setup(build) {
    build.onEnd(() => {
      if (prod) return;
      for (const f of ['manifest.json', 'styles.css']) if (existsSync(f)) copyFileSync(f, join(PLUGIN_DIR, f));
      console.log(`[helm] built -> ${PLUGIN_DIR}`);
    });
  },
};

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ['src/main.ts'],
  bundle: true,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', ...builtins],
  format: 'cjs',
  target: 'es2022',
  logLevel: 'info',
  sourcemap: prod ? false : 'inline',
  treeShaking: true,
  outfile: prod ? 'main.js' : join(PLUGIN_DIR, 'main.js'),
  minify: false,
  plugins: [copyStatics],
});
if (prod) { await ctx.rebuild(); process.exit(0); } else { await ctx.watch(); }
