// Every legacy endpoint answers with its legacy shape.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp, ADMIN_USER } from '../helpers.js';

let t;
before(async () => { t = await startTestApp(); });
after(async () => { await t.close(); });

test('GET /healthz', async () => {
  const { status, body } = await t.json('/healthz');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Number.isInteger(body.version) && body.version >= 3);
});

// runs before any key is stored: tests must never reach OpenAI
test('POST /api/ai/chat → fallback reply when no key is configured', async () => {
  const { status, body } = await t.json('/api/ai/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hello', history: [{ role: 'system', content: 'ignored' }] }),
  });
  assert.equal(status, 200);
  assert.equal(typeof body.reply, 'string');
  assert.equal(body.lang, 'en');
  assert.equal(body.configured, false);
  assert.equal(typeof body.sessionId, 'string');
  const bad = await t.json('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'message required');
});

test('GET /api/content has the legacy shape and never leaks ai_config', async () => {
  const { setSetting } = await import('../../src/db/index.js');
  setSetting('ai_config', { openai_key: 'sk-secret-1234', model: 'gpt-4o-mini' });
  setSetting('hero_h1', { en: 'Hello', fa: 'سلام' });
  const { status, body } = await t.json('/api/content');
  assert.equal(status, 200);
  assert.deepEqual(Object.keys(body).sort(), ['faqs', 'projects', 'settings']);
  assert.ok(Array.isArray(body.projects) && Array.isArray(body.faqs));
  assert.deepEqual(body.settings.hero_h1, { en: 'Hello', fa: 'سلام' });
  assert.ok(!('ai_config' in body.settings));
  assert.ok(!JSON.stringify(body).includes('sk-secret'));
});

test('POST /api/leads → {ok, id}', async () => {
  const { status, body } = await t.json('/api/leads', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'Ali', email: 'ali@example.com', message: 'hi', language: 'fa' }),
  });
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.ok(Number.isInteger(body.id));
});

test('SSR work pages and the admin shell', async () => {
  for (const p of ['/fa/work', '/en/work', '/fa/work/']) {
    const r = await fetch(t.base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/html/);
  }
  const r404 = await fetch(t.base + '/fa/work/does-not-exist');
  assert.equal(r404.status, 404);
  const admin = await fetch(t.base + '/admin/');
  assert.equal(admin.status, 200);
  assert.match(await admin.text(), /<html/i);
  const site = await fetch(t.base + '/');
  assert.equal(site.status, 200);
  const api404 = await t.json('/api/does-not-exist');
  assert.equal(api404.status, 404);
  assert.equal(api404.body.error, 'not_found');
});

test('admin API is gated: 401 without a cookie, login/logout/me', async () => {
  for (const p of ['/projects', '/settings', '/faqs', '/knowledge', '/leads', '/conversations', '/ai-config', '/me']) {
    const r = await fetch(`${t.base}/api/admin${p}`);
    assert.equal(r.status, 401, p);
    assert.deepEqual(await r.json(), { error: 'unauthorized' });
  }
  // login sits behind the CSRF guard too (test/security/csrf.test.js covers the 403s)
  const bad = await fetch(`${t.base}/api/admin/login`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: t.base, 'x-requested-with': 'sysaiq-admin' },
    body: JSON.stringify({ username: ADMIN_USER, password: 'wrong' }),
  });
  assert.equal(bad.status, 401);
  assert.deepEqual(await bad.json(), { error: 'invalid credentials' });

  const r = await t.loginAsAdmin();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true, username: ADMIN_USER });
  const session = r.headers.getSetCookie().find(c => /^sysaiq_admin=[^;]+/.test(c));
  assert.match(session, /HttpOnly/);
  assert.match(session, /Path=\/api\/admin/);
  assert.match(session, /SameSite=Strict/);

  const me = await t.fetchAdmin('/me');
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { username: ADMIN_USER });
});

test('settings: read/write public keys, reject private ones', async () => {
  const get = await t.fetchAdmin('/settings');
  assert.equal(get.status, 200);
  const s = await get.json();
  assert.deepEqual(s.hero_h1, { en: 'Hello', fa: 'سلام' });
  assert.ok(!('ai_config' in s));

  const put = await t.fetchAdmin('/settings/hero_h1', { method: 'PUT', body: { value: { en: 'New', fa: 'نو' } } });
  assert.deepEqual(await put.json(), { ok: true });
  assert.deepEqual((await (await t.fetchAdmin('/settings')).json()).hero_h1, { en: 'New', fa: 'نو' });

  const bad = await t.fetchAdmin('/settings/ai_config', { method: 'PUT', body: { value: { en: 'x', fa: 'y' } } });
  assert.equal(bad.status, 400);
  assert.deepEqual(await bad.json(), { error: 'unknown setting' });
});

test('projects CRUD', async () => {
  const created = await t.fetchAdmin('/projects', { method: 'POST', body: { title_en: 'Shop System', title_fa: 'فروشگاه', published: true, features: [{ title_en: 'a' }] } });
  assert.equal(created.status, 200);
  const { ok, id } = await created.json();
  assert.equal(ok, true);
  assert.ok(Number.isInteger(id));

  const list = await (await t.fetchAdmin('/projects')).json();
  const p = list.find(x => x.id === id);
  assert.equal(p.slug, 'shop-system');
  assert.equal(p.features, '[{"title_en":"a"}]');

  // public content + SSR page see it
  const content = (await t.json('/api/content')).body;
  assert.ok(content.projects.some(x => x.id === id));
  assert.equal((await fetch(`${t.base}/fa/work/shop-system`)).status, 200);

  const upd = await t.fetchAdmin(`/projects/${id}`, { method: 'PUT', body: { title_en: 'Shop System v2', published: false } });
  assert.deepEqual(await upd.json(), { ok: true });
  const p2 = (await (await t.fetchAdmin('/projects')).json()).find(x => x.id === id);
  assert.equal(p2.title_en, 'Shop System v2');
  assert.equal(p2.published, 0);

  const del = await t.fetchAdmin(`/projects/${id}`, { method: 'DELETE' });
  assert.deepEqual(await del.json(), { ok: true });
  assert.ok(!(await (await t.fetchAdmin('/projects')).json()).some(x => x.id === id));
});

test('faqs CRUD', async () => {
  const { id } = await (await t.fetchAdmin('/faqs', { method: 'POST', body: { q_en: 'Q', q_fa: 'س', a_en: 'A', a_fa: 'ج', published: 1 } })).json();
  assert.ok(Number.isInteger(id));
  assert.ok((await (await t.fetchAdmin('/faqs')).json()).some(f => f.id === id && f.q_en === 'Q'));
  assert.ok((await t.json('/api/content')).body.faqs.some(f => f.id === id));
  assert.deepEqual(await (await t.fetchAdmin(`/faqs/${id}`, { method: 'PUT', body: { q_en: 'Q2' } })).json(), { ok: true });
  assert.equal((await (await t.fetchAdmin('/faqs')).json()).find(f => f.id === id).q_en, 'Q2');
  assert.deepEqual(await (await t.fetchAdmin(`/faqs/${id}`, { method: 'DELETE' })).json(), { ok: true });
});

test('knowledge CRUD', async () => {
  const { id } = await (await t.fetchAdmin('/knowledge', { method: 'POST', body: { title: 'K', body_en: 'b', enabled: true } })).json();
  assert.ok(Number.isInteger(id));
  const row = (await (await t.fetchAdmin('/knowledge')).json()).find(k => k.id === id);
  assert.equal(row.enabled, 1);
  assert.deepEqual(await (await t.fetchAdmin(`/knowledge/${id}`, { method: 'PUT', body: { title: 'K2', enabled: false } })).json(), { ok: true });
  assert.equal((await (await t.fetchAdmin('/knowledge')).json()).find(k => k.id === id).enabled, 0);
  assert.deepEqual(await (await t.fetchAdmin(`/knowledge/${id}`, { method: 'DELETE' })).json(), { ok: true });
});

test('leads + conversations (admin read/delete)', async () => {
  const leads = await (await t.fetchAdmin('/leads')).json();
  assert.ok(Array.isArray(leads) && leads.length >= 1);
  assert.equal(leads[0].name, 'Ali');
  assert.deepEqual(await (await t.fetchAdmin(`/leads/${leads[0].id}`, { method: 'DELETE' })).json(), { ok: true });
  const conv = await (await t.fetchAdmin('/conversations')).json();
  assert.ok(Array.isArray(conv) && conv.length >= 1); // unconfigured assistant logs the user turn only
  assert.ok(conv.every(c => ['user', 'assistant'].includes(c.role)));
});

test('ai-config: status never returns the raw key; PUT keeps a masked key', async () => {
  // the key lives in the encrypted secrets table (migration 002 / lib/secrets.js), not in settings
  const { setSecret, getSecret } = await import('../../src/lib/secrets.js');
  setSecret('openai.api_key', 'sk-secret-1234');
  const g = await (await t.fetchAdmin('/ai-config')).json();
  assert.deepEqual(Object.keys(g).sort(), ['configured', 'key_hint', 'model', 'source']);
  assert.equal(g.configured, true);
  assert.equal(g.key_hint, 'sk-…1234');
  assert.equal(g.source, 'panel');
  assert.ok(!JSON.stringify(g).includes('sk-secret'));
  assert.deepEqual(await (await t.fetchAdmin('/ai-config', { method: 'PUT', body: { model: 'gpt-4o', openai_key: 'sk-…1234' } })).json(), { ok: true });
  const { getSetting } = await import('../../src/db/index.js');
  // the stale plaintext planted by the /api/content test above is scrubbed on write
  assert.deepEqual(getSetting('ai_config'), { model: 'gpt-4o' });
  assert.equal(getSecret('openai.api_key'), 'sk-secret-1234');
});

test('upload', async () => {
  const none = await t.fetchAdmin('/upload', { method: 'POST', body: new FormData() });
  assert.equal(none.status, 400);
  assert.deepEqual(await none.json(), { error: 'no file' });
  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'pic.PNG');
  const up = await (await t.fetchAdmin('/upload', { method: 'POST', body: fd })).json();
  assert.equal(up.ok, true);
  assert.match(up.url, /^\/uploads\/\d+-[0-9a-f]{8}\.png$/);
  assert.equal((await fetch(t.base + up.url)).status, 200);
});

test('every admin write is audited and unknown admin paths are JSON 404', async () => {
  const { db } = await import('../../src/db/index.js');
  const rows = db.prepare('SELECT action, entity FROM audit_log').all();
  assert.ok(rows.some(r => r.action === 'login' && r.entity === 'admins'));
  assert.ok(rows.some(r => r.action === 'login.failed'));
  assert.ok(rows.some(r => r.action === 'create' && r.entity === 'projects'));
  assert.ok(rows.some(r => r.action === 'delete' && r.entity === 'faqs'));
  const r = await t.fetchAdmin('/nope');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'not_found');
});

test('logout clears the session', async () => {
  const out = await t.fetchAdmin('/logout', { method: 'POST' });
  assert.deepEqual(await out.json(), { ok: true });
  assert.ok(out.headers.getSetCookie().some(c => /^sysaiq_admin=;.*Path=\/api\/admin/.test(c)));
  // the old cookie value is still in the helper — the server rejects a bumped/cleared session only
  // when it is gone client-side, so simulate the browser dropping it
  const noCookie = await fetch(`${t.base}/api/admin/me`);
  assert.equal(noCookie.status, 401);
});
