/**
 * A small HTTP server so other tools can drive Helm. Off unless you switch it on; bound to 127.0.0.1
 * unless the settings say otherwise (a Tailscale address, or every interface); every request needs
 * the token from Settings. The routing itself lives in routes.ts — this file is only plumbing.
 */
import { LOOPBACK } from './bind';
import { API_BASE, handle, type ApiDeps } from './routes';

type Server = { close: () => void; port: number; host: string };

const MAX_BODY = 1_000_000; // a task is a line of text; anything larger is a mistake or an attack

/** Constant-time over digests of equal length, so neither the bytes nor the token's length leak through timing. */
export function sameToken(a: string, b: string): boolean {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const digest = (x: string): Buffer => crypto.createHash('sha256').update(x, 'utf8').digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/** A short id that ties a generic 500 to the full error in the log. */
const requestId = (): string => Math.random().toString(36).slice(2, 10);

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
    // Only an authenticated caller learns the index revision; before that the server says as little as it can.
    let authed = false;
    const headers = (): Record<string, string> => ({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...(authed ? { 'x-helm-revision': String(opts.deps.index.revision) } : {}) });
    const send = (status: number, body: unknown): void => {
      if (res.headersSent) return;
      const text = JSON.stringify(body ?? null);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers() });
      res.end(text);
    };
    const fail = (e: unknown): void => {
      const id = requestId();
      opts.log?.(`request ${id} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
      send(500, { error: 'Internal error', requestId: id });
    };
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      if (!url.pathname.startsWith(API_BASE)) { send(404, { error: 'Not found' }); return; }
      const auth = req.headers['authorization'];
      const given = typeof auth === 'string' && auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
      if (opts.token === '' || !sameToken(given, opts.token)) { send(401, { error: 'Send the Helm API token as: Authorization: Bearer <token>' }); return; }
      authed = true;

      // Refuse an oversized body from its declared length, and otherwise once it passes the cap. The rest
      // of the upload is read and dropped (for a second at most) so the client gets the 413, not a reset.
      const tooLarge = (): void => {
        send(413, { error: 'Body too large' });
        req.resume();
        const cut = setTimeout(() => req.destroy(), 1000);
        cut.unref?.();
        req.on('end', () => clearTimeout(cut));
      };
      if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) { tooLarge(); return; }
      const chunks: Buffer[] = [];
      let size = 0;
      let refused = false;
      req.on('data', (c: Buffer) => {
        if (refused) return;
        size += c.length;
        if (size > MAX_BODY) { refused = true; chunks.length = 0; tooLarge(); return; }
        chunks.push(c);
      });
      req.on('end', () => {
        if (refused) return;
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
              res.writeHead(r.status, { 'content-type': r.raw.contentType, 'content-length': String(r.raw.bytes.byteLength), ...headers() });
              res.end(Buffer.from(r.raw.bytes));
              return;
            }
            send(r.status, r.body);
          } catch (e) {
            fail(e);
          }
        })();
      });
    } catch (e) {
      fail(e);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, host, () => { server.removeListener('error', reject); resolve(); });
  });
  const addr = server.address();
  const port = typeof addr === 'object' && addr !== null ? addr.port : opts.port;
  opts.log?.(`listening on http://${host}:${port}${API_BASE}`);
  // Closing stops new connections; a kept-alive socket would otherwise go on serving the old token.
  return { close: () => { server.close(); server.closeAllConnections(); }, port, host };
}
