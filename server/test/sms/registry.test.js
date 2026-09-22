// sms/registry.js: provider lookup, the mock refusal in production (checked
// in a real NODE_ENV=production child process, since config is frozen at
// import) and migration 100 on a fresh database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, '..', '..');

test('registry: ids, lookup, unknown id, env-scoped mock, registerProvider guard', async () => {
  const reg = await import('../../src/sms/registry.js');
  assert.deepEqual(reg.providerIds(), ['kavenegar', 'smsir', 'ghasedak', 'ippanel', 'melipayamak', 'mock']);
  assert.deepEqual(reg.providerIds({ env: 'production' }), ['kavenegar', 'smsir', 'ghasedak', 'ippanel', 'melipayamak']);
  assert.equal(reg.getProvider('smsir').id, 'smsir');
  assert.throws(() => reg.getProvider('nope'), e => e.code === 'provider_unknown');
  assert.equal(reg.getProvider('mock').id, 'mock');
  assert.throws(() => reg.getProvider('mock', { env: 'production' }), e => e.code === 'mock_refused' && /production/.test(e.message_fa));
  assert.equal(reg.hasProvider('mock', { env: 'production' }), false);
  assert.throws(() => reg.registerProvider({ id: 'mock', send() {} }), /built in/);
  assert.throws(() => reg.registerProvider({ id: 'x' }), /required/);
  for (const p of reg.providers()) {
    const d = reg.describeProvider(p);
    assert.ok(d.label_fa && d.label_en, p.id);
    assert.ok(['local', 'e164'].includes(d.recipientFormat));
    assert.ok(Array.isArray(d.configFields));
    assert.equal(typeof p.send, 'function');
    assert.equal(typeof p.credit, 'function');
    if (p.supportsPattern) assert.equal(typeof p.sendPattern, 'function');
    if (p.supportsStatus) assert.equal(typeof p.status, 'function');
    assert.equal(typeof p.validateMap, 'function');
  }
});

test('with NODE_ENV=production the registry refuses the mock and hides it from the list', () => {
  const script = `
    const reg = await import('./src/sms/registry.js');
    const out = { ids: reg.providerIds(), has: reg.hasProvider('mock') };
    try { reg.getProvider('mock'); out.threw = null; } catch (e) { out.threw = e.code; }
    console.log(JSON.stringify(out));
  `;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: SERVER,
    env: { PATH: process.env.PATH, NODE_ENV: 'production', JWT_SECRET: randomBytes(32).toString('hex'), SECRETS_KEY: randomBytes(32).toString('base64'), DATA_DIR: join(SERVER, 'test', '.tmp-never-used') },
    encoding: 'utf8',
  });
  const out = JSON.parse(stdout.trim().split('\n').at(-1));
  assert.deepEqual(out, { ids: ['kavenegar', 'smsir', 'ghasedak', 'ippanel', 'melipayamak'], has: false, threw: 'mock_refused' });
});

test('migration 100 on a fresh db: tables, indexes, seed, idempotent re-run, phone_norm guard', async () => {
  const { runMigrations } = await import('../../src/db/migrate.js');
  const db = new Database(':memory:');
  await runMigrations(db, { log: () => {} });
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  assert.ok(tables.includes('sms_templates') && tables.includes('sms_log'));
  const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='sms_log'").all().map(r => r.name);
  for (const i of ['idx_sms_log_created', 'idx_sms_log_to', 'idx_sms_log_dedupe', 'idx_sms_log_lead', 'idx_sms_log_status']) assert.ok(idx.includes(i), i);
  const cols = db.prepare('PRAGMA table_info(sms_log)').all().map(c => c.name);
  for (const c of ['kind', 'template_key', 'provider', 'mode', 'to_number', 'lang', 'text', 'vars', 'segments', 'status', 'error_code', 'error_message', 'message_id', 'cost', 'dedupe_key', 'lead_id', 'invoice_id', 'payment_id', 'attempt', 'retry_of', 'admin_user', 'sent_at', 'status_checked_at']) {
    assert.ok(cols.includes(c), c);
  }
  assert.ok(db.prepare('PRAGMA table_info(leads)').all().some(c => c.name === 'phone_norm'));
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sms_templates WHERE is_system=1').get().c, 6);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM schema_migrations WHERE version=100').get().c, 1);
  // the seed never overwrites an edited template
  db.prepare("UPDATE sms_templates SET body_fa='edited' WHERE key='lead_owner'").run();
  const { up, DEFAULT_TEMPLATES } = await import('../../src/db/migrations/100_sms.js');
  up(db, { hasColumn: () => true, addColumn: () => false });
  assert.equal(db.prepare("SELECT body_fa FROM sms_templates WHERE key='lead_owner'").get().body_fa, 'edited');
  assert.equal(db.prepare('SELECT COUNT(*) c FROM sms_templates').get().c, 6);
  assert.equal(DEFAULT_TEMPLATES.length, 6);
});
