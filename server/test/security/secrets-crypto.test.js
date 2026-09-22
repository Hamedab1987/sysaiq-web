// lib/secrets.js: AES-256-GCM with the secret name as AAD.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { startTestApp } from '../helpers.js';

let t, secrets, crypto, db;
before(async () => {
  t = await startTestApp();
  secrets = await import('../../src/lib/secrets.js');
  crypto = await import('../../src/lib/secrets-crypto.js');
  ({ db } = await import('../../src/db/index.js'));
  secrets.registerSecret({ name: 'test.alpha', label_en: 'A', label_fa: 'آ', group: 'test' });
  secrets.registerSecret({ name: 'test.beta', label_en: 'B', label_fa: 'ب', group: 'test', envFallback: 'TEST_BETA_FALLBACK' });
});
after(async () => { await t.close(); });

const row = name => db.prepare('SELECT * FROM secrets WHERE name=?').get(name);

test('roundtrip: set → get returns the value; the row holds only ciphertext', () => {
  const value = 'sk-live-' + randomBytes(16).toString('hex');
  secrets.setSecret('test.alpha', value, 'tester');
  assert.equal(secrets.getSecret('test.alpha'), value);
  assert.equal(secrets.hasSecret('test.alpha'), true);
  const r = row('test.alpha');
  assert.ok(Buffer.isBuffer(r.iv) && r.iv.length === 12);
  assert.ok(Buffer.isBuffer(r.tag) && r.tag.length === 16);
  assert.ok(Buffer.isBuffer(r.ciphertext));
  assert.ok(!r.ciphertext.toString('latin1').includes(value.slice(8, 24)));
  assert.equal(r.hint, `••••${value.slice(-4)}`);
  assert.equal(r.updated_by, 'tester');
  assert.match(r.key_id, /^[0-9a-f]{8}$/);
  // a persian-only value roundtrips too
  secrets.setSecret('test.alpha', 'کلید آزمایشی ۱۲۳۴');
  assert.equal(secrets.getSecret('test.alpha'), 'کلید آزمایشی ۱۲۳۴');
});

test('unique IV per write, even for the same value', () => {
  secrets.setSecret('test.alpha', 'same-value-twice');
  const a = row('test.alpha');
  secrets.setSecret('test.alpha', 'same-value-twice');
  const b = row('test.alpha');
  assert.notDeepEqual(a.iv, b.iv);
  assert.notDeepEqual(a.ciphertext, b.ciphertext);
  assert.equal(secrets.getSecret('test.alpha'), 'same-value-twice');
});

test('tampered ciphertext or tag fails to decrypt and getSecret degrades to null', () => {
  secrets.setSecret('test.alpha', 'untampered-value-1');
  const good = row('test.alpha');
  assert.equal(crypto.decryptSecret('test.alpha', good), 'untampered-value-1');

  const flipped = Buffer.from(good.ciphertext); flipped[0] ^= 0x01;
  assert.throws(() => crypto.decryptSecret('test.alpha', { ...good, ciphertext: flipped }));
  const badTag = Buffer.from(good.tag); badTag[3] ^= 0x80;
  assert.throws(() => crypto.decryptSecret('test.alpha', { ...good, tag: badTag }));
  assert.throws(() => crypto.decryptSecret('test.alpha', good, randomBytes(32)), 'wrong key');

  db.prepare('UPDATE secrets SET ciphertext=? WHERE name=?').run(flipped, 'test.alpha');
  assert.equal(secrets.getSecret('test.alpha'), null);
  // hasSecret agrees with getSecret; listSecrets names the state so the UI can say "re-enter"
  assert.equal(secrets.hasSecret('test.alpha'), false);
  const st = secrets.listSecrets().find(s => s.name === 'test.alpha');
  assert.deepEqual({ configured: st.configured, source: st.source, hint: st.hint }, { configured: false, source: 'unreadable', hint: '' });
  assert.ok(st.updated_at, 'the row is still there');
  // re-entering the value clears the state
  secrets.setSecret('test.alpha', 'untampered-value-2');
  assert.equal(secrets.hasSecret('test.alpha'), true);
  assert.equal(secrets.listSecrets().find(s => s.name === 'test.alpha').source, 'db');
});

test('setup-status and ai-config agree when the stored OpenAI key no longer decrypts', async () => {
  await t.loginAsAdmin();
  secrets.setSecret('openai.api_key', 'sk-test-unreadable-key-0000abcd');
  const good = row('openai.api_key');
  const flipped = Buffer.from(good.ciphertext); flipped[0] ^= 0x01;
  db.prepare('UPDATE secrets SET ciphertext=? WHERE name=?').run(flipped, 'openai.api_key');
  const origErr = console.error;
  console.error = () => {};
  try {
    const setup = await (await t.fetchAdmin('/setup-status')).json();
    const ai = await (await t.fetchAdmin('/ai-config')).json();
    assert.equal(setup.openai_key, false);
    assert.deepEqual({ configured: ai.configured, key_hint: ai.key_hint, source: ai.source }, { configured: false, key_hint: '', source: 'unreadable' });
    const list = await (await t.fetchAdmin('/secrets')).json();
    const k = list.find(s => s.name === 'openai.api_key');
    assert.deepEqual({ configured: k.configured, source: k.source, hint: k.hint }, { configured: false, source: 'unreadable', hint: '' });
    assert.ok(!JSON.stringify([setup, ai, list]).includes('unreadable-key'));
  } finally {
    console.error = origErr;
  }
  secrets.deleteSecret('openai.api_key');
  assert.equal((await (await t.fetchAdmin('/ai-config')).json()).source, 'none');
});

test('swapping two rows fails because the name is authenticated (AAD)', () => {
  secrets.setSecret('test.alpha', 'value-of-alpha');
  secrets.setSecret('test.beta', 'value-of-beta');
  const a = row('test.alpha');
  const b = row('test.beta');
  // copy beta's cipher material under alpha's name, as an attacker with file access could
  db.prepare('UPDATE secrets SET iv=?, tag=?, ciphertext=? WHERE name=?').run(b.iv, b.tag, b.ciphertext, 'test.alpha');
  assert.throws(() => crypto.decryptSecret('test.alpha', row('test.alpha')));
  assert.equal(secrets.getSecret('test.alpha'), null);
  assert.equal(secrets.getSecret('test.beta'), 'value-of-beta');
});

test('env fallback, delete, listSecrets never exposes values', () => {
  assert.equal(secrets.getSecret('test.beta') !== null, true);
  assert.equal(secrets.deleteSecret('test.beta'), true);
  assert.equal(secrets.getSecret('test.beta'), null);
  process.env.TEST_BETA_FALLBACK = 'from-the-environment-1234';
  assert.equal(secrets.getSecret('test.beta'), 'from-the-environment-1234');
  assert.equal(secrets.hasSecret('test.beta'), true);
  const list = secrets.listSecrets();
  const beta = list.find(s => s.name === 'test.beta');
  assert.deepEqual(Object.keys(beta).sort(), ['configured', 'group', 'hint', 'labels', 'name', 'source', 'updated_at']);
  assert.equal(beta.source, 'env');
  assert.equal(beta.hint, '••••1234');
  assert.ok(!JSON.stringify(list).includes('from-the-environment'));
  delete process.env.TEST_BETA_FALLBACK;
  assert.equal(secrets.getSecret('test.beta'), null);
  assert.equal(secrets.listSecrets().find(s => s.name === 'test.beta').source, 'none');
});

test('setSecret validates: empty, non-string, registered validator', () => {
  secrets.registerSecret({ name: 'test.strict', group: 'test', validate: v => (v.startsWith('ok-') ? null : 'must start with ok-') });
  for (const bad of ['', '   ', 42, null]) assert.throws(() => secrets.setSecret('test.strict', bad), /Validation/);
  assert.throws(() => secrets.setSecret('test.strict', 'nope'), e => e.status === 422 && e.fields.value === 'must start with ok-');
  secrets.setSecret('test.strict', 'ok-fine');
  assert.equal(secrets.getSecret('test.strict'), 'ok-fine');
  assert.throws(() => secrets.registerSecret({ name: 'Bad Name' }), /bad name/);
});

test('maskSecret', () => {
  assert.equal(crypto.maskSecret('sk-abcdef1234'), '••••1234');
  assert.equal(crypto.maskSecret('ab'), '••••');
  assert.equal(crypto.maskSecret(''), '');
});
