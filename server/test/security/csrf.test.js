// middleware/csrf.js on the whole /api/admin tree, login included.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, ADMIN_USER, ADMIN_PASS } from '../helpers.js';

let t;
before(async () => { t = await startTestApp(); await t.loginAsAdmin(); });
after(async () => { await t.close(); });

const creds = JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS });
const login = headers => fetch(`${t.base}/api/admin/login`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: creds });
const write = (path, headers, method = 'PUT') => fetch(`${t.base}/api/admin${path}`, {
  method, headers: { 'content-type': 'application/json', cookie: t.cookie, ...headers }, body: JSON.stringify({ value: { en: 'x', fa: 'y' } }),
});

test('login: missing or foreign Origin → 403 csrf; missing X-Requested-With → 403; both correct → 200', async () => {
  const noOrigin = await login({ 'x-requested-with': 'sysaiq-admin' });
  assert.equal(noOrigin.status, 403);
  assert.deepEqual(await noOrigin.json(), { error: 'csrf' });

  const foreign = await login({ origin: 'https://evil.example', 'x-requested-with': 'sysaiq-admin' });
  assert.equal(foreign.status, 403);
  assert.deepEqual(await foreign.json(), { error: 'csrf' });

  const nullOrigin = await login({ origin: 'null', 'x-requested-with': 'sysaiq-admin' });
  assert.equal(nullOrigin.status, 403);

  const noHeader = await login({ origin: t.base });
  assert.equal(noHeader.status, 403);
  assert.deepEqual(await noHeader.json(), { error: 'csrf' });

  const wrongHeader = await login({ origin: t.base, 'x-requested-with': 'XMLHttpRequest' });
  assert.equal(wrongHeader.status, 403);

  const ok = await login({ origin: t.base, 'x-requested-with': 'sysaiq-admin' });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, username: ADMIN_USER });
});

test('Referer origin is accepted when Origin is absent; a foreign Referer is not', async () => {
  const ok = await login({ referer: `${t.base}/admin/`, 'x-requested-with': 'sysaiq-admin' });
  assert.equal(ok.status, 200);
  const bad = await login({ referer: 'https://evil.example/admin/', 'x-requested-with': 'sysaiq-admin' });
  assert.equal(bad.status, 403);
  // a matching Referer does not rescue a foreign Origin
  const mixed = await login({ origin: 'https://evil.example', referer: `${t.base}/admin/`, 'x-requested-with': 'sysaiq-admin' });
  assert.equal(mixed.status, 403);
});

test('gated writes with a valid cookie but bad CSRF headers are refused before anything runs', async () => {
  const { getSetting } = await import('../../src/db/index.js');
  for (const headers of [{}, { origin: 'https://evil.example', 'x-requested-with': 'sysaiq-admin' }, { origin: t.base }]) {
    const r = await write('/settings/hero_h1', headers);
    assert.equal(r.status, 403);
    assert.deepEqual(await r.json(), { error: 'csrf' });
  }
  assert.equal(getSetting('hero_h1'), null, 'nothing was written');
  for (const method of ['POST', 'DELETE', 'PATCH']) {
    const r = await write('/settings/hero_h1', {}, method);
    assert.equal(r.status, 403, method);
  }
  const ok = await write('/settings/hero_h1', { origin: t.base, 'x-requested-with': 'sysaiq-admin' });
  assert.equal(ok.status, 200);
  assert.deepEqual(getSetting('hero_h1'), { en: 'x', fa: 'y' });
  // logout too
  const out = await fetch(`${t.base}/api/admin/logout`, { method: 'POST', headers: { cookie: t.cookie } });
  assert.equal(out.status, 403);
});

test('reads are never blocked by the guard (auth decides)', async () => {
  const anon = await fetch(`${t.base}/api/admin/projects`);
  assert.equal(anon.status, 401);
  const withCookie = await fetch(`${t.base}/api/admin/projects`, { headers: { cookie: t.cookie } });
  assert.equal(withCookie.status, 200);
  const me = await fetch(`${t.base}/api/admin/me`, { headers: { cookie: t.cookie } });
  assert.equal(me.status, 200);
});

test('the session cookie is httpOnly, SameSite=Strict and scoped to /api/admin', async () => {
  const r = await login({ origin: t.base, 'x-requested-with': 'sysaiq-admin' });
  const c = r.headers.getSetCookie().find(x => /^sysaiq_admin=[^;]+/.test(x));
  assert.match(c, /HttpOnly/i);
  assert.match(c, /SameSite=Strict/i);
  assert.match(c, /Path=\/api\/admin/);
  assert.doesNotMatch(c, /Secure/i); // test env is http; production sets Secure
});
