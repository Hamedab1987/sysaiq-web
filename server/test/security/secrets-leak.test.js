// Plant a sentinel OpenAI key, then crawl every public route and the admin
// status endpoints: the sentinel must never appear in any response.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

const SENTINEL = 'sk-SENTINEL-leak-test-9f8e7d6c5b4a3210';
let t;
before(async () => {
  t = await startTestApp();
  const { setSecret } = await import('../../src/lib/secrets.js');
  setSecret('openai.api_key', SENTINEL);
  // a stale plaintext copy in settings (as before migration 002) must not surface either
  const { setSetting, db } = await import('../../src/db/index.js');
  setSetting('ai_config', { openai_key: SENTINEL, model: 'gpt-4o-mini' });
  db.prepare("INSERT INTO projects (slug, title_en, title_fa, published) VALUES ('p1', 'P', 'پ', 1)").run();
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

async function text(path, opts) {
  const r = await fetch(t.base + path, opts);
  return { status: r.status, body: await r.text(), headers: r.headers };
}

test('public routes never contain the sentinel', async () => {
  const paths = ['/', '/healthz', '/api/content', '/fa/work', '/en/work', '/fa/work/p1', '/en/work/p1',
    '/fa/work/nope', '/api/nope', '/admin/', '/admin/app.js', '/uploads/nope.png', '/api/leads'];
  for (const p of paths) {
    const r = await text(p);
    assert.ok(!r.body.includes(SENTINEL), `${p} leaked the key`);
    assert.ok(!r.body.includes(SENTINEL.slice(-16)), `${p} leaked part of the key`);
  }
  // the chat endpoint, with a fake client so nothing leaves the process
  const { setClientFactory } = await import('../../src/ai.js');
  setClientFactory(() => ({ chat: { completions: { create: async () => ({ choices: [{ message: { content: 'hi' } }] }) } } }));
  const chat = await text('/api/ai/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: 'hello' }) });
  assert.equal(chat.status, 200);
  assert.ok(!chat.body.includes(SENTINEL));
  setClientFactory(null);
});

test('admin status endpoints only ever return hints', async () => {
  for (const p of ['/settings', '/secrets', '/ai-config', '/setup-status', '/system', '/audit', '/account', '/leads', '/conversations', '/projects', '/knowledge', '/faqs']) {
    const r = await t.fetchAdmin(p);
    const body = await r.text();
    assert.equal(r.status, 200, p);
    assert.ok(!body.includes(SENTINEL), `${p} leaked the key`);
    assert.ok(!body.includes(SENTINEL.slice(4, -4)), `${p} leaked the middle of the key`);
  }
  const s = await (await t.fetchAdmin('/secrets')).json();
  const k = s.find(x => x.name === 'openai.api_key');
  assert.deepEqual(k, { ...k, configured: true, hint: '••••3210', source: 'db', group: 'ai' });
  const ai = await (await t.fetchAdmin('/ai-config')).json();
  assert.equal(ai.key_hint, 'sk-…3210');
  assert.equal(ai.source, 'panel');
  // audit rows for secret writes carry no value
  const put = await t.fetchAdmin('/secrets/openai.api_key', { method: 'PUT', body: { value: SENTINEL + 'x' } });
  assert.deepEqual(await put.json(), { ok: true, hint: '••••210x' });
  const audit = await (await t.fetchAdmin('/audit?entity=secrets')).text();
  assert.ok(!audit.includes(SENTINEL));
  assert.ok(audit.includes('secret.set'));
  // unknown names are refused; the error never echoes the value
  const bad = await t.fetchAdmin('/secrets/not.registered', { method: 'PUT', body: { value: SENTINEL } });
  assert.equal(bad.status, 404);
  assert.ok(!(await bad.text()).includes(SENTINEL));
  const del = await t.fetchAdmin('/secrets/openai.api_key', { method: 'DELETE' });
  assert.deepEqual(await del.json(), { ok: true });
  assert.equal((await (await t.fetchAdmin('/ai-config')).json()).configured, false);
});

test('a database row for an unregistered name is invisible to the API', async () => {
  const { setSecret, listSecrets } = await import('../../src/lib/secrets.js');
  setSecret('orphan.value', 'orphan-value-should-not-list');
  assert.ok(!listSecrets().some(s => s.name === 'orphan.value'));
  const body = await (await t.fetchAdmin('/secrets')).text();
  assert.ok(!body.includes('orphan'));
});
