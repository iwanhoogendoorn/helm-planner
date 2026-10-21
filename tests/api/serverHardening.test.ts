import { afterEach, describe, expect, it } from 'vitest';
import http from 'node:http';
import { setup, TODAY } from '../data/fixture';
import { randomToken, sameToken, startApiServer } from '../../src/api/server';
import type { ApiDeps } from '../../src/api/routes';

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; });

async function serve(over: Partial<ApiDeps> = {}) {
  const s = await setup();
  const token = randomToken();
  const logs: string[] = [];
  const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: '9.9.9', written: () => [], read: (p) => s.vault.read(p), ...over };
  const server = await startApiServer({ port: 0, token, deps, log: (m) => logs.push(m) });
  stop = server.close;
  return { token, server, logs, base: `http://${server.host}:${server.port}/helm/v1` };
}

/** One GET over a given agent, resolving to the status or rejecting on a socket error. */
const get = (agent: http.Agent, url: string, token: string): Promise<number> => new Promise((resolve, reject) => {
  const req = http.get(url, { agent, headers: { authorization: `Bearer ${token}` } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode ?? 0)); });
  req.on('error', reject);
});

describe('L2 · token comparison', () => {
  it('compares in constant time over digests, whatever the lengths', () => {
    expect(sameToken('abc', 'abc')).toBe(true);
    expect(sameToken('abc', 'abd')).toBe(false);
    expect(sameToken('abc', 'abcd')).toBe(false);
    expect(sameToken('', 'x')).toBe(false);
  });
});

describe('L3 · an internal error does not leak its message', () => {
  it('answers 500 with a generic message and a request id, and logs the detail', async () => {
    const { base, token, logs } = await serve({ today: () => { throw new Error('ENOENT: /Users/secret/vault/x.md'); } });
    const r = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } });
    expect(r.status).toBe(500);
    const body = await r.json() as { error: string; requestId: string };
    expect(body.error).toBe('Internal error');
    expect(JSON.stringify(body)).not.toContain('/Users/secret');
    expect(body.requestId).toMatch(/^[a-z0-9]+$/);
    expect(logs.some((l) => l.includes(body.requestId) && l.includes('/Users/secret'))).toBe(true);
  });
});

describe('L4 · closing the server drops kept-alive connections', () => {
  it('an already-connected client cannot go on using the old server after close', async () => {
    const { base, token, server } = await serve();
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    expect(await get(agent, `${base}/health`, token)).toBe(200);
    server.close();
    stop = undefined;
    await expect(get(agent, `${base}/health`, token)).rejects.toThrow();
    agent.destroy();
  });
});

describe('L6 · an oversized body gets a 413, not a reset', () => {
  it('refuses by content-length and by streamed size, and the client reads the answer', async () => {
    const { base, token } = await serve();
    const r = await fetch(`${base}/tasks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x'.repeat(1_100_000) }) });
    expect(r.status).toBe(413);
    expect(await r.json()).toEqual({ error: 'Body too large' });
    // A declared length over the cap is refused before a byte of the body is read.
    const declared = await new Promise<number>((resolve, reject) => {
      const req = http.request(`${base}/tasks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-length': '5000000' } }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
      req.on('error', reject);
      req.flushHeaders();
    });
    expect(declared).toBe(413);
  });
});

describe('L10 · an unauthenticated request learns nothing about the server', () => {
  it('sends no revision header before auth and a generic 404 outside the base path', async () => {
    const { base, token } = await serve();
    const noAuth = await fetch(`${base}/health`);
    expect(noAuth.status).toBe(401);
    expect(noAuth.headers.get('x-helm-revision')).toBeNull();
    const outside = await fetch(base.replace('/helm/v1', '/other'));
    expect(outside.status).toBe(404);
    expect(outside.headers.get('x-helm-revision')).toBeNull();
    expect(JSON.stringify(await outside.json())).not.toContain('helm');
    const good = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } });
    expect(good.headers.get('x-helm-revision')).toMatch(/^\d+$/);
  });
});
