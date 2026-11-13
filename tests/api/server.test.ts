import { afterEach, describe, expect, it } from 'vitest';
import { setup, TODAY } from '../data/fixture';
import { etagMatches, etagOf, idempotencyKeyOf, randomToken, startApiServer } from '../../src/api/server';
import type { ApiDeps } from '../../src/api/routes';

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); stop = undefined; });

async function serve(token = randomToken(), host?: string, extra: Record<string, string> = {}) {
  const s = await setup(extra);
  const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: '9.9.9', written: () => [], read: (p) => s.vault.read(p), readBinary: (p) => s.vault.readBinary!(p) };
  const server = await startApiServer({ port: 0, token, deps, ...(host ? { host } : {}) }); // port 0: let the OS pick a free one
  stop = server.close;
  return { ...s, token, server, base: `http://${server.host}:${server.port}/helm/v1` };
}

describe('the API server', () => {
  it('names a served file by its bytes, and answers 304 with no body to a client that already has them', async () => {
    const { base, token, vault, index, m } = await serve(undefined, undefined, { '99 ATTACHMENTS/comic-evening-x.jpg': 'x' });
    const path = await m.ensureDailyNote(TODAY);
    const bytes = new Uint8Array([1, 2, 3, 4]);
    await vault.writeBinary('99 ATTACHMENTS/comic-evening-x.jpg', bytes.buffer as ArrayBuffer);
    await vault.write(path, `${await vault.read(path)}\n![[comic-evening-x.jpg|evening-comic ${TODAY}]]\n`);
    await index.rebuild();
    const url = `${base}/files/binary?path=${encodeURIComponent('99 ATTACHMENTS/comic-evening-x.jpg')}`;
    const auth = { authorization: `Bearer ${token}` };

    const first = await fetch(url, { headers: auth });
    expect(first.status).toBe(200);
    const etag = first.headers.get('etag');
    expect(etag).toBe(etagOf(bytes));
    expect(etag).toMatch(/^"sha256-[0-9a-f]{32}"$/);
    expect(new Uint8Array(await first.arrayBuffer())).toEqual(bytes);

    const again = await fetch(url, { headers: { ...auth, 'if-none-match': etag! } });
    expect(again.status).toBe(304);
    expect(again.headers.get('etag')).toBe(etag);
    expect((await again.arrayBuffer()).byteLength).toBe(0);

    // The file made again with other bytes: the old name no longer matches, so the new bytes come.
    await vault.writeBinary('99 ATTACHMENTS/comic-evening-x.jpg', new Uint8Array([9, 9]).buffer as ArrayBuffer);
    const changed = await fetch(url, { headers: { ...auth, 'if-none-match': etag! } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(new Uint8Array(await changed.arrayBuffer())).toEqual(new Uint8Array([9, 9]));

    // A 304 is only for someone who may read the file at all.
    expect((await fetch(url, { headers: { 'if-none-match': etag! } })).status).toBe(401);
    expect((await fetch(`${base}/files/binary?path=99%20ATTACHMENTS/stray.jpg`, { headers: { ...auth, 'if-none-match': '*' } })).status).toBe(404);
  });

  it('does a keyed POST once: the same key gets the first answer back and writes nothing more', async () => {
    const { base, token, index } = await serve();
    const post = (text: string, key?: string): Promise<Response> => fetch(`${base}/tasks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(key ? { 'idempotency-key': key } : {}) }, body: JSON.stringify({ text, scheduled: TODAY }) });
    const count = (): number => [...index.snapshot.tasks.values()].filter((t) => t.text.includes('Ring the plumber')).length;

    const first = await post('Ring the plumber', 'phone-0001-abcd');
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotent-replay')).toBeNull();
    const made = await first.json() as { task: { id: string } };

    const again = await post('Ring the plumber', 'phone-0001-abcd');
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replay')).toBe('true');
    expect((await again.json() as { task: { id: string } }).task.id).toBe(made.task.id);
    expect(count()).toBe(1);

    // Two at once with one key are one request too.
    const [a, b] = await Promise.all([post('Ring the plumber twice', 'phone-0002-abcd'), post('Ring the plumber twice', 'phone-0002-abcd')]);
    expect((await a.json() as { task: { id: string } }).task.id).toBe((await b.json() as { task: { id: string } }).task.id);
    expect(count()).toBe(2);

    // Another key, or none, is another request.
    await post('Ring the plumber', 'phone-0003-abcd');
    await post('Ring the plumber');
    await post('Ring the plumber');
    expect(count()).toBe(5);

    // A refused request is not remembered, so the corrected one goes through under the same key.
    const bad = await fetch(`${base}/tasks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': 'phone-0004-abcd' }, body: JSON.stringify({}) });
    expect(bad.status).toBe(400);
    const fixed = await post('Ring the plumber after all', 'phone-0004-abcd');
    expect(fixed.status).toBe(201);
    expect(fixed.headers.get('idempotent-replay')).toBeNull();
  });

  it('remembers a keyed POST across a restart when it has somewhere to keep it', async () => {
    const s = await setup();
    const deps: ApiDeps = { index: s.index, mutations: s.m, settings: () => s.settings, today: () => TODAY, version: '9.9.9', written: () => [], read: (p) => s.vault.read(p) };
    let file: string | undefined;
    const idempotency = { load: async () => file, save: async (json: string) => { file = json; } };
    const token = randomToken();
    const post = (port: number, key: string): Promise<Response> => fetch(`http://127.0.0.1:${port}/helm/v1/tasks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': key }, body: JSON.stringify({ text: 'Ring the plumber once', scheduled: TODAY }) });
    const count = (): number => [...s.index.snapshot.tasks.values()].filter((t) => t.text.includes('Ring the plumber once')).length;

    const first = await startApiServer({ port: 0, token, deps, idempotency });
    const made = await (await post(first.port, 'phone-0009-abcd')).json() as { task: { id: string } };
    const refused = await fetch(`http://127.0.0.1:${first.port}/helm/v1/tasks`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'idempotency-key': 'phone-0010-abcd' }, body: '{}' });
    expect(refused.status).toBe(400);
    await first.settled();
    first.close();
    expect(JSON.parse(file!).map((e: { key: string }) => e.key)).toEqual(['/helm/v1/tasks phone-0009-abcd']); // the refused one is not kept

    // The key was in the store before the phone heard the answer, not some time after.
    let savedWhenAnswered = false;
    const watched = { load: async () => undefined as string | undefined, save: async (json: string) => { await new Promise((r) => setTimeout(r, 30)); file = json; } };
    const slow = await startApiServer({ port: 0, token, deps, idempotency: watched });
    await post(slow.port, 'phone-0013-abcd');
    savedWhenAnswered = (file ?? '').includes('phone-0013-abcd');
    slow.close();
    expect(savedWhenAnswered).toBe(true);
    file = JSON.stringify(JSON.parse(file!).length ? [{ key: '/helm/v1/tasks phone-0009-abcd', at: Date.now(), status: 201, body: made }] : []);

    // Obsidian was closed and opened again; the phone, which never heard the answer, tries once more.
    const second = await startApiServer({ port: 0, token, deps, idempotency });
    stop = second.close;
    const again = await post(second.port, 'phone-0009-abcd');
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replay')).toBe('true');
    expect((await again.json() as { task: { id: string } }).task.id).toBe(made.task.id);
    expect(count()).toBe(2); // the plumber of 0009 and of 0013, and no third

    // What is in the store is read with care: junk, or an entry past its thirty days, is no entry.
    second.close();
    file = JSON.stringify([{ key: '/helm/v1/tasks phone-0011-abcd', at: Date.now() - 31 * 24 * 60 * 60 * 1000, status: 201, body: { task: { id: 'tsk-old' } } }, 'junk', { key: 5 }]);
    const third = await startApiServer({ port: 0, token, deps, idempotency });
    stop = third.close;
    const expired = await post(third.port, 'phone-0011-abcd');
    expect(expired.headers.get('idempotent-replay')).toBeNull();
    expect(count()).toBe(3);
    third.close();
    file = 'not json at all';
    const fourth = await startApiServer({ port: 0, token, deps, idempotency });
    stop = fourth.close;
    expect((await post(fourth.port, 'phone-0012-abcd')).status).toBe(201);
  });

  it('takes an idempotency key only on a POST, and only a plain one of a sane length', () => {
    expect(idempotencyKeyOf('POST', 'phone-0001-abcd')).toBe('phone-0001-abcd');
    expect(idempotencyKeyOf('POST', '  phone-0001-abcd  ')).toBe('phone-0001-abcd');
    expect(idempotencyKeyOf('PATCH', 'phone-0001-abcd')).toBeUndefined();
    expect(idempotencyKeyOf('POST', 'short')).toBeUndefined();
    expect(idempotencyKeyOf('POST', 'x'.repeat(129))).toBeUndefined();
    expect(idempotencyKeyOf('POST', 'has a space in it')).toBeUndefined();
    expect(idempotencyKeyOf('POST', undefined)).toBeUndefined();
    expect(idempotencyKeyOf('POST', ['a-key-000', 'b-key-000'])).toBeUndefined();
  });

  it('matches an If-None-Match that lists several tags, a weak one, or a star', () => {
    const tag = etagOf(new Uint8Array([1]));
    expect(etagMatches(tag, tag)).toBe(true);
    expect(etagMatches(`"other", W/${tag}`, tag)).toBe(true);
    expect(etagMatches('*', tag)).toBe(true);
    expect(etagMatches('"other"', tag)).toBe(false);
    expect(etagMatches(undefined, tag)).toBe(false);
    expect(etagMatches(tag.replace(/"/g, ''), tag)).toBe(false);
  });

  it('binds to loopback by default and to the host it is given', async () => {
    const dflt = await serve();
    expect(dflt.server.host).toBe('127.0.0.1');
    stop?.(); stop = undefined;
    // The other loopback address (IPv6): reachable there, and not on 127.0.0.1 at that port.
    const { token, server } = await serve(undefined, '::1');
    expect(server.host).toBe('::1');
    const here = await fetch(`http://[::1]:${server.port}/helm/v1/health`, { headers: { authorization: `Bearer ${token}` } });
    expect(here.status).toBe(200);
    await expect(fetch(`http://127.0.0.1:${server.port}/helm/v1/health`, { headers: { authorization: `Bearer ${token}` } })).rejects.toThrow();
  });

  it('serves JSON over loopback, and only with the token', async () => {
    const { base, token } = await serve();
    const noAuth = await fetch(`${base}/health`);
    expect(noAuth.status).toBe(401);
    const wrong = await fetch(`${base}/health`, { headers: { authorization: 'Bearer not-the-token-not-the-token-not' } });
    expect(wrong.status).toBe(401);
    const good = await fetch(`${base}/health`, { headers: { authorization: `Bearer ${token}` } });
    expect(good.status).toBe(200);
    expect(good.headers.get('content-type')).toContain('application/json');
    expect(good.headers.get('cache-control')).toBe('no-store');
    expect(good.headers.get('x-helm-revision')).toMatch(/^\d+$/);
    expect(await good.json()).toMatchObject({ ok: true, version: '9.9.9', api: 2 });
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
