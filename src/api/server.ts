/**
 * A small HTTP server so other tools can drive Helm. Off unless you switch it on; bound to 127.0.0.1
 * unless the settings say otherwise (a Tailscale address, or every interface); every request needs
 * the token from Settings. The routing itself lives in routes.ts — this file is only plumbing.
 */
import { ANY, isPrivateClient, LOOPBACK } from './bind';
import { API_BASE, handle, type ApiDeps } from './routes';

type Server = { close: () => void; port: number; host: string; /** Resolves once the idempotency keys answered so far are in the store. */ settled: () => Promise<void> };

const MAX_BODY = 1_000_000; // a task is a line of text; anything larger is a mistake or an attack

/** Constant-time over digests of equal length, so neither the bytes nor the token's length leak through timing. */
export function sameToken(a: string, b: string): boolean {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  const digest = (x: string): Buffer => crypto.createHash('sha256').update(x, 'utf8').digest();
  return crypto.timingSafeEqual(digest(a), digest(b));
}

/**
 * What a file's bytes are called, so a client that kept a copy can ask whether it is still the one:
 * it sends this back as `If-None-Match` and gets a 304 with no body. A hash of the bytes rather than
 * a date, so the client can work it out from its own copy and a file made again unchanged still matches.
 */
export function etagOf(bytes: Uint8Array): string {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return `"sha256-${crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 32)}"`;
}

/** Whether an `If-None-Match` header names this tag: one of a comma-separated list, a weak `W/` form, or `*`. */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
  const given = Array.isArray(header) ? header.join(',') : header ?? '';
  return given.split(',').map((t) => t.trim().replace(/^W\//, '')).some((t) => t === etag || t === '*');
}

/**
 * A POST that says who it is (`Idempotency-Key`) is done once. A phone that never heard the answer
 * sends the same request again with the same key and gets the first answer back, not a second task.
 * Only an answer that succeeded is remembered, for thirty days. With a store they outlive a restart,
 * which matters: the phone may only reach the Mac again days later, after Obsidian was closed.
 */
const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const IDEMPOTENCY_MAX = 500;
/** Where the answers to keyed requests are kept between runs: one small JSON text. */
export interface IdempotencyStore { load: () => Promise<string | undefined>; save: (json: string) => Promise<void> }
interface Remembered { key: string; at: number; status: number; body: unknown }
export function idempotencyKeyOf(method: string | undefined, header: string | string[] | undefined): string | undefined {
  if (method !== 'POST' || typeof header !== 'string') return undefined;
  const key = header.trim();
  return /^[\x21-\x7e]{8,128}$/.test(key) ? key : undefined;
}

/** A short id that ties a generic 500 to the full error in the log. */
const requestId = (): string => Math.random().toString(36).slice(2, 10);

export function randomToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function startApiServer(opts: {
  port: number; host?: string; token: string; deps: ApiDeps; log?: (m: string) => void;
  /** Which client addresses may connect. Defaults to anyone on a loopback or Tailscale bind, and to private addresses only on every interface. */
  allowClient?: (address: string | undefined) => boolean;
  /** Keeps the answers to keyed POSTs across a restart. Without one they are remembered in memory only. */
  idempotency?: IdempotencyStore;
}): Promise<Server> {
  const host = opts.host?.trim() || LOOPBACK;
  const everywhere = host === ANY || host === '::';
  const allowClient = opts.allowClient ?? (everywhere ? isPrivateClient : () => true);
  // Required at run time so the bundle stays loadable where node's http is not available.
  const http = require('node:http') as typeof import('node:http');
  type Handled = Awaited<ReturnType<typeof handle>>;
  const done = new Map<string, { at: number; result: Promise<Handled> }>();
  // What the store holds, oldest first, and one write at a time so a later save never lands before an earlier one.
  const kept = new Map<string, Remembered>();
  let saving: Promise<void> = Promise.resolve();
  const persist = (): void => {
    if (!opts.idempotency) return;
    const store = opts.idempotency;
    const json = JSON.stringify([...kept.values()]);
    saving = saving.then(() => store.save(json)).catch((e) => opts.log?.(`could not save the idempotency keys: ${e instanceof Error ? e.message : String(e)}`));
  };
  if (opts.idempotency) {
    try {
      const raw = await opts.idempotency.load();
      const now = Date.now();
      const list: unknown = raw ? JSON.parse(raw) : [];
      for (const e of Array.isArray(list) ? list as Partial<Remembered>[] : []) {
        if (typeof e?.key !== 'string' || typeof e.at !== 'number' || typeof e.status !== 'number' || now - e.at > IDEMPOTENCY_TTL_MS) continue;
        const r: Remembered = { key: e.key, at: e.at, status: e.status, body: e.body };
        kept.set(r.key, r);
        done.set(r.key, { at: r.at, result: Promise.resolve({ status: r.status, body: r.body } as Handled) });
      }
    } catch (e) {
      opts.log?.(`could not read the idempotency keys, starting without them: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  /** Run the request, or hand back what the same keyed request was already answered with. */
  const once = (key: string | undefined, run: () => Promise<Handled>): { result: Promise<Handled>; replayed: boolean } => {
    if (key === undefined) return { result: run(), replayed: false };
    const now = Date.now();
    // Looked up before anything is let go: the key being asked about is never the one that makes room.
    const seen = done.get(key);
    if (seen && now - seen.at <= IDEMPOTENCY_TTL_MS) return { result: seen.result, replayed: true };
    for (const [k, v] of done) { if (now - v.at > IDEMPOTENCY_TTL_MS || done.size >= IDEMPOTENCY_MAX) { done.delete(k); kept.delete(k); } else break; }
    const result = run();
    done.set(key, { at: now, result });
    // A request that failed is not remembered: sending it again is how the caller tries again.
    const forget = (): void => { if (done.get(key)?.result === result) done.delete(key); };
    result.then((r) => {
      if (r.status < 200 || r.status >= 300) { forget(); return; }
      // A file's bytes are not an answer worth keeping; everything a POST answers with is JSON.
      if (r.raw || done.get(key)?.result !== result) return;
      kept.set(key, { key, at: now, status: r.status, body: r.body });
      persist();
    }, forget);
    return { result, replayed: false };
  };
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
      if (!allowClient(req.socket.remoteAddress)) {
        opts.log?.(`refused a client outside the private ranges: ${req.socket.remoteAddress ?? 'unknown'}`);
        send(403, { error: 'Forbidden' });
        return;
      }
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
            const idem = idempotencyKeyOf(req.method, req.headers['idempotency-key']);
            const keyed = idem === undefined ? undefined : `${url.pathname}${url.search} ${idem}`;
            const { result, replayed } = once(keyed, () => handle({ method: req.method ?? 'GET', path: url.pathname.slice(API_BASE.length), query, body }, opts.deps));
            const r = await result;
            // The answer to a keyed request is in the store before the caller hears it: a caller that then
            // loses the reply, with Obsidian closed straight after, still finds its key on the next start.
            if (keyed !== undefined && !replayed) await saving;
            if (replayed) res.setHeader('idempotent-replay', 'true');
            if (r.raw) {
              const etag = etagOf(r.raw.bytes);
              if (r.status === 200 && etagMatches(req.headers['if-none-match'], etag)) {
                res.writeHead(304, { etag, ...headers() });
                res.end();
                return;
              }
              res.writeHead(r.status, { 'content-type': r.raw.contentType, 'content-length': String(r.raw.bytes.byteLength), etag, ...headers() });
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
  return { close: () => { server.close(); server.closeAllConnections(); }, port, host, settled: () => saving };
}
