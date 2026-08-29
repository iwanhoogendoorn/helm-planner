import { afterEach, describe, expect, it } from 'vitest';
import { setup, TODAY } from '../data/fixture';
import { randomToken, startApiServer } from '../../src/api/server';
import type { ApiDeps } from '../../src/api/routes';

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; });

async function serve(token = randomToken()) {
  const s = await setup();
  const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: '9.9.9', written: () => [] };
  const server = await startApiServer({ port: 0, token, deps }); // port 0: let the OS pick a free one
  stop = server.close;
  return { ...s, token, base: `http://127.0.0.1:${server.port}/helm/v1` };
}

describe('the API server', () => {
  it('serves JSON over loopback, and only with the token', async () => {
    const { base, token } = await serve();
    const noAuth = await fetch(`${base}/health`);
    expect(noAuth.status).toBe(401);
    const wrong = await fetch(`${base}/health`, { headers: { authorization: 'Bearer not-the-token-not-the-token-not' } });
    expect(wrong.status).toBe(401);
    const good = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } });
    expect(good.status).toBe(200);
    expect(good.headers.get('content-type')).toContain('application/json');
    expect(await good.json()).toMatchObject({ ok: true, version: '9.9.9' });
  });

  it('writes to the vault through a POST and refuses a body that is not JSON', async () => {
    const { base, token, vault } = await serve();
    const auth = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const r = await fetch(`${base}/tasks`, { method: 'POST', headers: auth, body: JSON.stringify({ text: 'From the API', scheduled: TODAY }) });
    expect(r.status).toBe(201);
    const made = await r.json() as { task: { id: string; path: string } };
    expect(made.task.id).toMatch(/^tsk-/);
    expect(await vault.read(made.task.path)).toContain('From the API');

    const junk = await fetch(`${base}/tasks`, { method: 'POST', headers: auth, body: 'not json' });
    expect(junk.status).toBe(400);
    expect(await junk.json()).toEqual({ error: 'Body must be JSON' });
  });

  it('answers nothing outside its own base path', async () => {
    const { base, token } = await serve();
    const outside = await fetch(base.replace('/helm/v1', '/vault/secrets.md'), { headers: { authorization: `Bearer ${token}` } });
    expect(outside.status).toBe(404);
  });
});
