// The settings registry is the only gate between the settings table and
// the outside world: public keys are served, everything else is invisible.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

let t, db, registry;
before(async () => {
  t = await startTestApp();
  db = await import('../../src/db/index.js');
  registry = await import('../../src/lib/registry.js');
  db.setSetting('ai_config', { openai_key: 'sk-private-9999', model: 'm' });
  db.setSetting('sms_config', { api_key: 'kave-private' });
  db.setSetting('hero_h1', { en: 'H', fa: 'ه' });
  db.setSetting('contact_email', { en: 'a@b.c', fa: 'a@b.c' });
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

test('registry: the six legacy copy keys are public; private keys are not registered', () => {
  const pub = registry.publicSettings();
  assert.deepEqual([...pub].sort(), ['about_1', 'about_2', 'contact_email', 'hero_h1', 'hero_note_l', 'hero_note_r']);
  assert.equal(registry.isRegisteredSetting('ai_config'), false);
  assert.equal(registry.isPublicSetting('ai_config'), false);
  assert.equal(registry.isPublicSetting('hero_h1'), true);
  // registering is idempotent
  registry.registerSetting({ key: 'hero_h1', public: true });
  assert.equal(registry.publicSettings().length, 6);
});

test('a private (registered, non-public) key stays out of every public/admin listing', async () => {
  registry.registerSetting({ key: 'gateway_config', public: false });
  db.setSetting('gateway_config', { merchant: 'MERCHANT-1' });
  const content = (await t.json('/api/content')).body;
  const admin = await (await t.fetchAdmin('/settings')).json();
  for (const o of [content.settings, admin]) {
    assert.ok(!('gateway_config' in o));
    assert.ok(!('ai_config' in o));
    assert.ok(!('sms_config' in o));
  }
  assert.ok(!JSON.stringify(content).includes('private'));
  assert.ok(!JSON.stringify(admin).includes('MERCHANT'));
});

test('GET /api/content and GET /api/admin/settings serve public keys only', async () => {
  const content = (await t.json('/api/content')).body.settings;
  assert.deepEqual(Object.keys(content).sort(), ['contact_email', 'hero_h1']);
  const admin = await (await t.fetchAdmin('/settings')).json();
  assert.deepEqual(Object.keys(admin).sort(), ['contact_email', 'hero_h1']);
});

test('PUT /api/admin/settings/:key refuses private and unknown keys', async () => {
  for (const key of ['ai_config', 'sms_config', 'gateway_config', 'whatever', '__proto__']) {
    const r = await t.fetchAdmin(`/settings/${key}`, { method: 'PUT', body: { value: { en: 'x', fa: 'y' } } });
    assert.equal(r.status, 400, key);
    assert.deepEqual(await r.json(), { error: 'unknown setting' });
  }
  assert.deepEqual(db.getSetting('ai_config'), { openai_key: 'sk-private-9999', model: 'm' });
  const ok = await t.fetchAdmin('/settings/about_1', { method: 'PUT', body: { value: { en: 'A', fa: 'آ' } } });
  assert.deepEqual(await ok.json(), { ok: true });
  assert.deepEqual(db.getSetting('about_1'), { en: 'A', fa: 'آ' });
});
