/**
 * Runs the Claude CLI (the user's Claude Code subscription) as a one-shot
 * question: prompt in on stdin, `--output-format json` out. Desktop only —
 * Obsidian on mobile has no child processes.
 */
export interface AiOptions { command: string; model?: string; timeoutSec: number; cwd?: string; /** Extra CLI flags (permissions, allowed tools, extra dirs). */ extraArgs?: string[] }

type ChildProcess = { spawn: (cmd: string, args: string[], opts: Record<string, unknown>) => { stdin: { write: (s: string) => void; end: () => void }; stdout: { on: (ev: string, fn: (d: Buffer) => void) => void }; stderr: { on: (ev: string, fn: (d: Buffer) => void) => void }; on: (ev: string, fn: (...a: unknown[]) => void) => void; kill: (sig?: string) => void } };

function nodeRequire(name: string): unknown {
  const req = (globalThis as unknown as { require?: (n: string) => unknown }).require;
  if (!req) throw new Error('Not available here (needs the desktop app)');
  return req(name);
}

/** PATH with the usual homes of user-installed CLIs, since Electron starts with a minimal one. */
function fullPath(): string {
  const home = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.['HOME'] ?? '';
  const cur = (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.['PATH'] ?? '';
  return [`${home}/.local/bin`, `${home}/.claude/local`, '/opt/homebrew/bin', '/usr/local/bin', `${home}/.npm-global/bin`, `${home}/.volta/bin`, cur].filter(Boolean).join(':');
}

export function aiAvailable(): boolean {
  try { return typeof nodeRequire('child_process') === 'object'; } catch { return false; }
}

export function runClaude(prompt: string, o: AiOptions): Promise<string> {
  const cp = nodeRequire('child_process') as ChildProcess;
  const args = ['-p', '--output-format', 'json', ...(o.model ? ['--model', o.model] : []), ...(o.extraArgs ?? [])];
  return new Promise((resolve, reject) => {
    let out = '', err = '';
    let done = false;
    const env = { ...((globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env ?? {}), PATH: fullPath() };
    let child: ReturnType<ChildProcess['spawn']>;
    try { child = cp.spawn(o.command || 'claude', args, { env, ...(o.cwd ? { cwd: o.cwd } : {}) }); } catch (e) { reject(e); return; }
    const timer = setTimeout(() => { if (!done) { done = true; try { child.kill('SIGTERM'); } catch { /* gone */ } reject(new Error(`The AI took longer than ${o.timeoutSec}s`)); } }, o.timeoutSec * 1000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); reject(new Error(`Could not run "${o.command}": ${(e as Error).message}`)); });
    child.on('close', (code) => {
      if (done) return; done = true; clearTimeout(timer);
      if (code !== 0 && out.trim() === '') { reject(new Error(`"${o.command}" exited with ${String(code)}: ${err.trim().slice(0, 300)}`)); return; }
      resolve(extractResult(out));
    });
    try { child.stdin.write(prompt); child.stdin.end(); } catch (e) { if (!done) { done = true; clearTimeout(timer); reject(e); } }
  });
}

/** `--output-format json` wraps the reply as {"result": "..."}; be tolerant of other shapes. */
export function extractResult(raw: string): string {
  const t = raw.trim();
  try {
    const j = JSON.parse(t) as unknown;
    if (j && typeof j === 'object') {
      const o = j as Record<string, unknown>;
      if (typeof o['result'] === 'string') return o['result'];
      if (Array.isArray(o['content'])) return (o['content'] as { text?: string }[]).map((c) => c.text ?? '').join('\n');
    }
  } catch { /* not JSON: stream or plain text */ }
  // stream-json: last line with a result.
  for (const line of t.split('\n').reverse()) { try { const j = JSON.parse(line) as Record<string, unknown>; if (typeof j['result'] === 'string') return j['result']; } catch { /* skip */ } }
  return t;
}

/* ── Small file helpers for engines that work through files on disk ─────── */

export function homeDir(): string { return (globalThis as unknown as { process?: { env?: Record<string, string> } }).process?.env?.['HOME'] ?? ''; }
export function expandHome(p: string): string { return p.startsWith('~') ? homeDir() + p.slice(1) : p; }

/** A fresh scratch directory for one diagram run. */
export function makeWorkDir(prefix = 'helm-diagram'): string {
  const fs = nodeRequire('fs') as { mkdtempSync: (p: string) => string };
  const os = nodeRequire('os') as { tmpdir: () => string };
  const path = nodeRequire('path') as { join: (...a: string[]) => string };
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}
export function readTextFile(p: string): Promise<string> {
  const fs = nodeRequire('fs') as { promises: { readFile: (p: string, enc: string) => Promise<string> } };
  return fs.promises.readFile(p, 'utf8');
}
export function fileExists(p: string): boolean {
  const fs = nodeRequire('fs') as { existsSync: (p: string) => boolean };
  return fs.existsSync(p);
}
