// /api/admin/sms/*: auth + CSRF gate, config with masked secrets, test send,
// credit, template CRUD (system templates locked), log listing, status
// refresh, retry, manual send with its rate limit, audit rows, and a
// sentinel-key leak crawl.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

const SENTINEL = 'KAVE-SENTINEL-9f8e7d6c5b4a3210';
let t, db;
before(async () => {
  t = await startTestApp({ env: { SMS_SEND_RATE_MAX: '40' } });
  ({ db } = await import('../../src/db/index.js'));
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

const api = async (path, opts) => { const r = await t.fetchAdmin(`/sms${path}`, opts); return { status: r.status, body: await r.json() }; };
const rows = () => db.prepare('SELECT * FROM sms_log ORDER BY id').all();

test('gate: no cookie → 401, missing CSRF header → 403, JSON 404 for unknown sub-paths', async () => {
  const anon = await fetch(`${t.base}/api/admin/sms/config`);
  assert.equal(anon.status, 401);
  const noCsrf = await fetch(`${t.base}/api/admin/sms/send`, { method: 'POST', headers: { cookie: t.cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noCsrf.status, 403);
  assert.equal((await api('/nope')).status, 404);
});

test('GET /config: defaults, every provider described, secrets as {configured, hint, source} only', async () => {
  const { status, body } = await api('/config');
  assert.equal(status, 200);
  assert.deepEqual(body.config, {
    active: '', fallback: '', providers: {}, owner_mobile: '09125130505',
    events: { lead_owner: true, lead_customer: true, invoice_link: true, invoice_reminder: true, payment_customer: true, payment_owner: true },
    daily_cap: 200, per_number_daily_cap: 5, relay_base: '',
  });
  assert.deepEqual(body.providers.map(p => p.id), ['kavenegar', 'smsir', 'ghasedak', 'ippanel', 'melipayamak', 'mock']);
  const kv = body.providers.find(p => p.id === 'kavenegar');
  assert.deepEqual(kv.secret, { configured: false, hint: '', source: 'none' });
  assert.equal(kv.configFields.find(f => f.key === 'api_key').type, 'secret');
  assert.equal(body.providers.find(p => p.id === 'mock').secret, null);
  assert.equal(body.env, 'test');
  assert.deepEqual(body.usage, { sent_24h: 0, daily_cap: 200, per_number_daily_cap: 5, limits: body.usage.limits });
});

test('PUT /config: secrets are written to the secrets table, never echoed; empty or masked values keep the stored one', async () => {
  let r = await api('/config', { method: 'PUT', body: { active: 'mock', fallback: 'kavenegar', providers: { kavenegar: { api_key: SENTINEL, sender: '10004346' }, melipayamak: { username: 'u1', password: 'pw-secret-1' } }, owner_mobile: '۰۹۱۲ ۵۱۳ ۰۵۰۵', daily_cap: '150', relay_base: 'https://relay.example.ir/sms/' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.config.active, 'mock');
  assert.equal(r.body.config.fallback, 'kavenegar');
  assert.deepEqual(r.body.config.providers, { kavenegar: { sender: '10004346', username: '' }, melipayamak: { sender: '', username: 'u1' } });
  assert.equal(r.body.config.owner_mobile, '09125130505');
  assert.equal(r.body.config.daily_cap, 150);
  assert.equal(r.body.config.relay_base, 'https://relay.example.ir/sms');
  const kv = r.body.providers.find(p => p.id === 'kavenegar');
  assert.deepEqual(kv.secret, { configured: true, hint: '••••3210', source: 'db' });
  assert.equal(r.body.providers.find(p => p.id === 'melipayamak').secret.hint, '••••et-1');
  assert.ok(!JSON.stringify(r.body).includes(SENTINEL));
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM settings').all()).includes(SENTINEL), 'settings row holds no secret');
  const { getSecret } = await import('../../src/lib/secrets.js');
  assert.equal(getSecret('sms.kavenegar.api_key'), SENTINEL);

  // the hint echoed back, or an empty string → unchanged
  r = await api('/config', { method: 'PUT', body: { providers: { kavenegar: { api_key: '••••3210' }, melipayamak: { password: '' } } } });
  assert.equal(r.status, 200);
  assert.equal(getSecret('sms.kavenegar.api_key'), SENTINEL);
  assert.equal(getSecret('sms.melipayamak.password'), 'pw-secret-1');
  // a new value replaces
  r = await api('/config', { method: 'PUT', body: { providers: { kavenegar: { api_key: 'NEW-KEY-0001' } } } });
  assert.equal(getSecret('sms.kavenegar.api_key'), 'NEW-KEY-0001');
  assert.equal(r.body.providers.find(p => p.id === 'kavenegar').secret.hint, '••••0001');
  // sender survived the partial update
  assert.equal(r.body.config.providers.kavenegar.sender, '10004346');

  // audit: action + which secrets, never the value
  const audit = db.prepare("SELECT * FROM audit_log WHERE action='sms.config' ORDER BY id").all();
  assert.ok(audit.length >= 3);
  assert.ok(audit[0].summary.includes('sms.kavenegar.api_key'));
  assert.ok(!JSON.stringify(audit).includes(SENTINEL));
  assert.ok(!JSON.stringify(audit).includes('NEW-KEY'));
});

test('PUT /config validation → 422 with Persian field messages', async () => {
  const cases = [
    [{ active: 'nope' }, 'active'],
    [{ fallback: 'mock' }, 'fallback'],                   // equals the active provider
    [{ owner_mobile: '028-33323002' }, 'owner_mobile'],
    [{ events: { lead_owner: 'yes' } }, 'events.lead_owner'],
    [{ events: { bogus: true } }, 'events.bogus'],
    [{ daily_cap: 0 }, 'daily_cap'],
    [{ per_number_daily_cap: 5000 }, 'per_number_daily_cap'],
    [{ relay_base: 'http://relay.ir' }, 'relay_base'],
    [{ providers: { kavenegar: { sender: 'abc' } } }, 'providers.kavenegar.sender'],
    [{ providers: { kavenegar: { api_key: 'has space' } } }, 'sms.kavenegar.api_key'],
    [{ providers: { nope: { sender: '1' } } }, 'providers.nope'],
    [{ providers: [] }, 'providers'],
  ];
  for (const [body, field] of cases) {
    const r = await api('/config', { method: 'PUT', body });
    assert.equal(r.status, 422, JSON.stringify(body));
    assert.equal(r.body.error, 'validation');
    assert.ok(r.body.fields[field], `${field} in ${JSON.stringify(r.body.fields)}`);
    assert.match(r.body.fields[field], /[؀-ۿ]/, 'Persian message');
    assert.doesNotMatch(r.body.fields[field], /[0-9]/, `Latin digits in a Persian message: ${r.body.fields[field]}`);
    assert.equal(r.body.message, 'اطلاعات واردشده معتبر نیست');
    assert.equal(r.body.message_en, 'Validation failed');
  }
  assert.equal((await api('/config')).body.config.active, 'mock', 'nothing changed');
  assert.equal((await api('/config', { method: 'PUT', body: { daily_cap: 0 } })).body.fields.daily_cap, 'باید عددی بین ۱ و ۱۰۰٬۰۰۰ باشد');
});

test('PUT /config is atomic: a rejected config never leaves a new secret behind, and a rejected secret never leaves a new config behind', async () => {
  const { getSecret } = await import('../../src/lib/secrets.js');
  const before = getSecret('sms.kavenegar.api_key');
  // fallback === active (mock) → 422 from writeConfig; the key riding along must not be persisted
  let r = await api('/config', { method: 'PUT', body: { fallback: 'mock', providers: { kavenegar: { api_key: 'LEAKED-KEY-4321', sender: '20002000' } } } });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.fallback);
  assert.equal(getSecret('sms.kavenegar.api_key'), before, 'secret unchanged after a rejected config');
  assert.notEqual((await api('/config')).body.config.providers.kavenegar?.sender, '20002000', 'config unchanged too');
  // a bad key value (space) → 422 from setSecret; the config fields in the same request must not be persisted
  r = await api('/config', { method: 'PUT', body: { daily_cap: 123, providers: { kavenegar: { api_key: 'has space', sender: '20002000' } } } });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields['sms.kavenegar.api_key']);
  const cfg = (await api('/config')).body.config;
  assert.notEqual(cfg.daily_cap, 123);
  assert.notEqual(cfg.providers.kavenegar?.sender, '20002000');
  assert.equal(getSecret('sms.kavenegar.api_key'), before);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='sms.config' AND summary LIKE '%20002000%'").get().c, 0);
});

test('POST /test and GET /credit', async () => {
  let r = await api('/test', { method: 'POST', body: { to: '0912 123 4567', mode: 'simple' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ kind: r.body.log.kind, provider: r.body.log.provider, status: r.body.log.status, admin: r.body.log.admin_user }, { kind: 'test', provider: 'mock', status: 'sent', admin: 'tester' });
  assert.equal(r.body.log.text, 'پیام آزمایشی SysaiQ — تنظیمات پیامک درست است.');
  r = await api('/test', { method: 'POST', body: { to: '12', mode: 'simple' } });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.to);
  r = await api('/test', { method: 'POST', body: { to: '09121234567', mode: 'pattern', template_key: 'lead_customer' } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'sms_template');
  r = await api('/test', { method: 'POST', body: { to: '09121234567', mode: 'pattern', template_key: 'nope' } });
  assert.equal(r.status, 422);
  // the mock's simulated outage surfaces as 502 with a Persian message
  r = await api('/test', { method: 'POST', body: { to: '09120000000' } });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'sms_server_error');
  assert.match(r.body.message, /خطای داخلی/);
  // a provider that is not the active one, by id; unknown → 409
  r = await api('/test', { method: 'POST', body: { to: '09121234567', provider: 'kavenegar' } });
  assert.equal(r.status, 502, 'kavenegar has no reachable host in tests → transport error, mapped to 502');
  assert.equal((await api('/test', { method: 'POST', body: { to: '09121234567', provider: 'nope' } })).status, 409);

  r = await api('/credit');
  assert.deepEqual({ provider: r.body.provider, amount: r.body.amount, unit: r.body.unit, cached: r.body.cached }, { provider: 'mock', amount: 1000, unit: 'mock', cached: false });
  assert.equal((await api('/credit')).body.cached, true);
  assert.equal((await api('/credit?force=1')).body.cached, false);
  assert.equal((await api('/credit?provider=nope')).status, 409);
});

test('templates: list, create, update (system key locked, provider_map validated), delete rules', async () => {
  let r = await api('/templates');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 6);
  const lc = r.body.items.find(x => x.key === 'lead_customer');
  assert.deepEqual(lc.placeholders, ['name']);
  assert.equal(lc.counter.fa.unicode, true);
  assert.ok(r.body.variable_labels.name.fa);
  assert.deepEqual(r.body.providers.map(p => p.id).length, 6);
  assert.match(r.body.providers.find(p => p.id === 'kavenegar').map_help.fa, /token10/);
  assert.match(r.body.providers.find(p => p.id === 'smsir').map_help.fa, /۲۵ نویسه/);
  assert.equal(r.body.providers.find(p => p.id === 'mock').map_help, null);

  // create
  r = await api('/templates', { method: 'POST', body: { key: 'Follow_Up', label_fa: 'پیگیری', body_fa: 'سلام {{name}}، پیگیری {{topic}}' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual({ key: r.body.item.key, variables: r.body.item.variables, is_system: r.body.item.is_system, enabled: r.body.item.enabled }, { key: 'follow_up', variables: ['name', 'topic'], is_system: false, enabled: true });
  for (const [body, field] of [
    [{ key: 'follow_up', body_fa: 'x' }, 'key'], [{ key: '1bad', body_fa: 'x' }, 'key'], [{ key: 'ok_key' }, 'body_fa'],
    [{ key: 'ok2', body_fa: 'x'.repeat(1001) }, 'body_fa'], [{ key: 'ok3', body_fa: 'x', variables: 'name' }, 'variables'],
    [{ key: 'ok4', body_fa: 'x', provider_map: { kavenegar: { tokens: {} } } }, 'provider_map.kavenegar'],
    [{ key: 'ok5', body_fa: 'x', provider_map: { smsir: { templateId: 'abc' } } }, 'provider_map.smsir'],
    [{ key: 'ok6', body_fa: 'x', provider_map: { zzz: { code: '1' } } }, 'provider_map.zzz'],
    [{ key: 'ok7', body_fa: 'x', enabled: 'yes' }, 'enabled'],
    // an oversized mapping is refused with 422, not a 500 from slicing JSON
    [{ key: 'ok8', body_fa: 'x', provider_map: { mock: { template: 'x'.repeat(2500) } } }, 'provider_map.mock'],
    // a 4-variable template (placeholders in the body) needs a full Kavenegar tokens map
    [{ key: 'ok9', body_fa: '{{id}} {{name}} {{phone}} {{service}}', provider_map: { kavenegar: { template: 'sq-owner' } } }, 'provider_map.kavenegar'],
  ]) {
    const e = await api('/templates', { method: 'POST', body });
    assert.equal(e.status, 422, JSON.stringify(body));
    assert.ok(e.body.fields[field], `${field}: ${JSON.stringify(e.body.fields)}`);
  }
  assert.equal((await api('/templates', { method: 'POST', body: { key: 'ok2', body_fa: 'x'.repeat(1001) } })).body.fields.body_fa, 'متن قالب حداکثر ۱٬۰۰۰ نویسه');
  const big = await api('/templates', { method: 'POST', body: { key: 'ok8', body_fa: 'x', provider_map: { mock: { template: 'x'.repeat(2500) } } } });
  assert.match(big.body.fields['provider_map.mock'], /بیش از حد بلند/);
  assert.doesNotMatch(big.body.fields['provider_map.mock'], /[0-9]/);

  // the system 4-variable template: a plain {template} is refused, a complete tokens map is accepted
  r = await api('/templates/lead_owner', { method: 'PUT', body: { provider_map: { kavenegar: { template: 'sq-owner' } } } });
  assert.equal(r.status, 422);
  assert.match(r.body.fields['provider_map.kavenegar'], /token10/);
  assert.match(r.body.fields['provider_map.kavenegar'], /id, name, phone, service/);
  r = await api('/templates/lead_owner', { method: 'PUT', body: { provider_map: { kavenegar: { template: 'sq-owner', tokens: { id: 'token', phone: 'token2', name: 'token10', service: 'token20' } } } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.item.provider_map.kavenegar.tokens, { id: 'token', phone: 'token2', name: 'token10', service: 'token20' });
  await api('/templates/lead_owner', { method: 'PUT', body: { provider_map: { kavenegar: null } } });

  // update a system template: body + provider_map fine, key change refused
  r = await api('/templates/lead_customer', { method: 'PUT', body: { body_fa: '{{name}} عزیز، دریافت شد.', provider_map: { kavenegar: { template: 'sq-lead', tokens: { name: 'token' } }, smsir: { templateId: 123456 }, ippanel: { code: 'p1' }, melipayamak: { bodyId: '77', order: ['name'] }, ghasedak: { templateName: 'lead' }, mock: {} } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.item.body_fa, '{{name}} عزیز، دریافت شد.');
  assert.deepEqual(Object.keys(r.body.item.provider_map).sort(), ['ghasedak', 'ippanel', 'kavenegar', 'melipayamak', 'mock', 'smsir']);
  r = await api('/templates/lead_customer', { method: 'PUT', body: { key: 'other' } });
  assert.equal(r.status, 422);
  assert.ok(r.body.fields.key);
  // null removes a mapping; empty body refused
  r = await api('/templates/lead_customer', { method: 'PUT', body: { provider_map: { kavenegar: null } } });
  assert.deepEqual(Object.keys(r.body.item.provider_map), []);
  r = await api('/templates/lead_customer', { method: 'PUT', body: { body_fa: '', body_en: '' } });
  assert.equal(r.status, 422);
  r = await api('/templates/lead_customer', { method: 'PUT', body: { enabled: false } });
  assert.equal(r.body.item.enabled, false);
  await api('/templates/lead_customer', { method: 'PUT', body: { enabled: true, body_fa: '{{name}} عزیز، درخواست شما در SysaiQ ثبت شد. در اولین فرصت با شما تماس می‌گیریم.' } });

  // delete
  r = await api('/templates/lead_customer', { method: 'DELETE' });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'system_template');
  assert.match(r.body.message, /سیستمی/);
  assert.equal((await api('/templates/follow_up', { method: 'DELETE' })).status, 200);
  assert.equal((await api('/templates/follow_up', { method: 'DELETE' })).status, 404);
  assert.equal((await api('/templates/nope', { method: 'PUT', body: {} })).status, 404);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sms_templates').get().c, 6);
  const audit = db.prepare("SELECT action, entity_id FROM audit_log WHERE action LIKE 'sms.template.%' ORDER BY id").all();
  assert.deepEqual(audit.map(a => a.action), ['sms.template.create', ...Array(6).fill('sms.template.update'), 'sms.template.delete']);
  assert.deepEqual(audit.slice(1, 3).map(a => a.entity_id), ['lead_owner', 'lead_owner']);
});

test('POST /send: by number or lead, free text or template, Persian validation, refs and audit', async () => {
  db.prepare('DELETE FROM sms_log').run();
  const lead = db.prepare("INSERT INTO leads (name, phone, phone_norm, language) VALUES ('لید', '09121112233', '09121112233', 'en')").run();
  const leadId = Number(lead.lastInsertRowid);
  let r = await api('/send', { method: 'POST', body: { to: '+98 912 123 4567', text: 'سلام، پیام دستی' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ to: r.body.log.to_number, kind: r.body.log.kind, mode: r.body.log.mode, admin: r.body.log.admin_user, text: r.body.log.text }, { to: '09121234567', kind: 'manual', mode: 'simple', admin: 'tester', text: 'سلام، پیام دستی' });
  r = await api('/send', { method: 'POST', body: { lead_id: leadId, template_key: 'lead_customer', params: { name: 'Lead' } } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ to: r.body.log.to_number, lead_id: r.body.log.lead_id, lang: r.body.log.lang, key: r.body.log.template_key }, { to: '09121112233', lead_id: leadId, lang: 'en', key: 'lead_customer' });
  assert.ok(r.body.log.text.startsWith('Dear Lead'));

  for (const [body, field] of [
    [{ text: 'x' }, 'to'], [{ to: '12', text: 'x' }, 'to'], [{ to: '09121234567' }, 'text'], [{ to: '09121234567', template_key: 'nope' }, 'template_key'],
    [{ lead_id: 999999, text: 'x' }, 'lead_id'], [{ to: '09121234567', text: 'x'.repeat(501) }, 'text'],
  ]) {
    const e = await api('/send', { method: 'POST', body });
    assert.equal(e.status, 422, JSON.stringify(body));
    assert.ok(e.body.fields[field], `${field}: ${JSON.stringify(e.body.fields)}`);
    assert.match(e.body.fields[field], /[؀-ۿ]/);
  }
  const noPhone = Number(db.prepare("INSERT INTO leads (name, email) VALUES ('m', 'm@x.io')").run().lastInsertRowid);
  r = await api('/send', { method: 'POST', body: { lead_id: noPhone, text: 'x' } });
  assert.equal(r.status, 422);
  assert.match(r.body.fields.lead_id, /شمارهٔ همراه ایرانی/);
  // deliver-time errors use the same status-by-code mapping as thrown ones:
  // a template with a missing variable → 422 sms_missing_var (row is logged as failed)
  r = await api('/send', { method: 'POST', body: { to: '09121234567', template_key: 'invoice_link', params: { name: 'x' } } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'sms_missing_var');
  assert.equal(rows().at(-1).status, 'failed');
  // the provider rejecting the number (mock: …9999) is a request-value problem → 422
  r = await api('/send', { method: 'POST', body: { to: '09129999999', text: 'x' } });
  assert.equal(r.status, 422);
  assert.equal(r.body.error, 'sms_bad_mobile');
  assert.equal(r.body.message, 'شمارهٔ گیرنده نامعتبر است — mock rejects …9999');
  // a provider outage (mock: …0000) stays 502 (fallback off so the mock's error is the final one)
  assert.equal((await api('/config', { method: 'PUT', body: { fallback: '' } })).status, 200);
  r = await api('/send', { method: 'POST', body: { to: '09120000000', text: 'x' } });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'sms_server_error');
  assert.equal(rows().at(-1).error_code, 'server_error');
  // the 500-char message carries Persian digits
  r = await api('/send', { method: 'POST', body: { to: '09121234567', text: 'x'.repeat(501) } });
  assert.equal(r.body.fields.text, 'متن پیام حداکثر ۵۰۰ نویسه');
  const audit = db.prepare("SELECT action, summary FROM audit_log WHERE action='sms.send' ORDER BY id").all();
  assert.ok(audit.length >= 2);
  assert.ok(audit[0].summary.includes('free text'));
  assert.ok(!JSON.stringify(audit).includes('0912'), 'audit never carries the number');
});

test('GET /log with filters, GET /log/:id, refresh-status and retry', async () => {
  let r = await api('/log?kind=manual&per_page=2');
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 2);
  assert.ok(r.body.total >= 4);
  assert.deepEqual(r.body.statuses, ['queued', 'sent', 'delivered', 'undelivered', 'failed', 'blocked', 'skipped']);
  assert.ok(r.body.error_labels.no_credit.fa);
  const failed = (await api('/log?status=failed')).body.items;
  assert.ok(failed.length >= 2);
  assert.ok(failed.every(x => x.error_label));
  assert.equal((await api('/log?to=۰۹۱۲۱۱۱۲۲۳۳')).body.total, 1);
  assert.equal((await api('/log?template_key=lead_customer&kind=manual')).body.total, 1);
  assert.equal((await api('/log?q=دستی')).body.total, 1);
  const sent = (await api('/log?status=sent')).body.items[0];
  assert.deepEqual((await api(`/log/${sent.id}`)).body.id, sent.id);
  assert.equal((await api('/log/999999')).status, 404);

  r = await api(`/log/${sent.id}/refresh-status`, { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(r.body.state, 'delivered');
  assert.equal(r.body.log.status, 'delivered');
  const skipped = failed.find(x => x.error_code === 'missing_var');
  r = await api(`/log/${skipped.id}/refresh-status`, { method: 'POST' });
  assert.equal(r.status, 409);
  assert.equal((await api('/log/999999/refresh-status', { method: 'POST' })).status, 404);

  const bad = failed.find(x => x.error_code === 'bad_mobile');
  r = await api(`/log/${bad.id}/retry`, { method: 'POST' });
  assert.equal(r.status, 422, 'retrying the …9999 number fails again (provider rejects the number → 422)');
  assert.equal(r.body.error, 'sms_bad_mobile');
  assert.equal(rows().at(-1).retry_of, bad.id);
  const outage = failed.find(x => x.error_code === 'server_error');
  assert.equal((await api(`/log/${outage.id}/retry`, { method: 'POST' })).status, 502, 'a provider outage on retry stays 502');
  // fix the number is not possible from a retry — but a failed send to a good number retries fine
  db.prepare("UPDATE sms_log SET to_number='09121234567' WHERE id=?").run(bad.id);
  r = await api(`/log/${bad.id}/retry`, { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ retry_of: r.body.log.retry_of, status: r.body.log.status, kind: r.body.log.kind, admin: r.body.log.admin_user }, { retry_of: bad.id, status: 'sent', kind: 'manual', admin: 'tester' });
  assert.equal((await api('/log/999999/retry', { method: 'POST' })).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='sms.retry'").get().c, 3);
});

test('sentinel secret never leaks through any SMS or status endpoint', async () => {
  await api('/config', { method: 'PUT', body: { providers: { kavenegar: { api_key: SENTINEL } } } });
  for (const p of ['/sms/config', '/sms/templates', '/sms/log', '/sms/credit', '/secrets', '/setup-status', '/audit', '/settings']) {
    const r = await t.fetchAdmin(p);
    const body = await r.text();
    assert.equal(r.status, 200, p);
    assert.ok(!body.includes(SENTINEL), `${p} leaked the key`);
    assert.ok(!body.includes(SENTINEL.slice(4, -4)), `${p} leaked the middle of the key`);
  }
  const pub = await fetch(`${t.base}/api/content`);
  assert.ok(!(await pub.text()).includes(SENTINEL));
  const secrets = await (await t.fetchAdmin('/secrets')).json();
  const mine = secrets.filter(s => s.group === 'sms').map(s => s.name).sort();
  assert.deepEqual(mine, ['sms.ghasedak.api_key', 'sms.ippanel.api_key', 'sms.kavenegar.api_key', 'sms.melipayamak.password', 'sms.relay.key', 'sms.smsir.api_key']);
});

test('manual sends are rate-limited per admin (SMS_SEND_RATE_MAX in tests, 30/h by default)', async () => {
  let limited = null;
  for (let i = 0; i < 45 && !limited; i++) {
    const r = await api('/send', { method: 'POST', body: { to: '09121234567', text: `n${i}` } });
    if (r.status === 429) limited = r.body;
  }
  assert.ok(limited, 'hit the limiter');
  assert.equal(limited.error, 'rate_limited');
  // the message states the configured limit (40 here), in Persian digits
  assert.equal(limited.message, 'سقف ارسال دستی (۴۰ پیام در ساعت) پر شده است');
  assert.equal(limited.message_en, 'Manual send limit (40 per hour) reached');
  // a read is unaffected
  assert.equal((await api('/log?per_page=1')).status, 200);
});
