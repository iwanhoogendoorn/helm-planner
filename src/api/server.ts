/**
 * A small HTTP server so other tools can drive Helm. Off unless you switch it on; bound to 127.0.0.1
 * unless the settings say otherwise (a Tailscale address, or every interface); every request needs
 * the token from Settings. The routing itself lives in routes.ts — this file is only plumbing.
 */
import { LOOPBACK } from './bind';
import { API_BASE, handle, type ApiDeps } from './routes';

type Server = { close: () => void; port: number; host: string };

const MAX_BODY = 1_000_000; // a task is a line of text; anything larger is a mistake or an attack

/** Timing-safe enough for a loopback token: compare every byte. */
function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function randomToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startApiServer(opts: { port: number; host?: string; token: string; deps: ApiDeps; log?: (m: string) => void }): Promise<Server> {
  const host = opts.host?.trim() || LOOPBACK;
  // Required at run time so the bundle stays loadable where node's http is not available.
  const http = require('node:http') as typeof import('node:http');
  const server = http.createServer((req, res) => {
    const send = (status: number, body: unknown): void => {
      const text = JSON.stringify(body ?? null);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-helm-revision': String(opts.deps.index.revision) });
      res.end(text);
    };
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith(API_BASE)) { send(404, { error: `Helm serves ${API_BASE}` }); return; }
      const auth = req.headers['authorization'];
      const given = typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      if (opts.token === '' || !sameToken(given, opts.token)) { send(401, { error: 'Send the Helm API token as: Authorization: Bearer <token>' }); return; }

      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) { send(413, { error: 'Body too large' }); req.destroy(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        void (async () => {
          let body: unknown;
          const raw = Buffer.concat(chunks).toString('utf8');
          if (raw.trim() !== '') {
            try { body = JSON.parse(raw); } catch { send(400, { error: 'Body must be JSON' }); return; }
          }
          const query: Record<string, string> = {};
          url.searchParams.forEach((v, k) => { query[k] = v; });
          try {
            const r = await handle({ method: req.method ?? 'GET', path: url.pathname.slice(API_BASE.length), query, body }, opts.deps);
            if (r.raw) {
              res.writeHead(r.status, { 'content-type': r.raw.contentType, 'content-length': String(r.raw.bytes.byteLength), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-helm-revision': String(opts.deps.index.revision) });
              res.end(Buffer.from(r.raw.bytes));
              return;
            }
            send(r.status, r.body);
          } catch (e) {
            opts.log?.(`request failed: ${String(e)}`);
            send(500, { error: e instanceof Error ? e.message : String(e) });
          }
        })();
      });
    } catch (e) {
      send(500, { error: e instanceof Error ? e.message : String(e) });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => { server.removeListener('error', reject); resolve(); });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : opts.port;
  opts.log?.(`listening on http://${host}:${port}${API_BASE}`);
  return { close: () => server.close(), port, host };
}
