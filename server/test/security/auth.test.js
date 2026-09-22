// Admin auth hardening: pinned JWT algorithm, token_version invalidation on
// password change, account endpoints, production fail-fast without SECRETS_KEY.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { startTestApp, ADMIN_USER, ADMIN_PASS } from '../helpers.js';

const run = promisify(execFile);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

let t;
before(async () => { t = await startTestApp(); await t.loginAsAdmin(); });
after(async () => { await t.close(); });

const b64url = s => Buffer.from(typeof s === 'string' ? s : JSON.stringify(s)).toString('base64url');
const me = cookie => fetch(`${t.base}/api/admin/me`, { headers: { cookie } });

test('a forged token with alg "none" (or a wrong algorithm) is rejected', async () => {
  const jwt = (await import('jsonwebtoken')).default;
  const { config } = await import('../../src/config.js');
  const real = jwt.decode(t.cookie.split('=')[1]);
  assert.equal(real.u, ADMIN_USER);
  assert.ok(Number.isInteger(real.tv));

  const none = `${b64url({ alg: 'none', typ: 'JWT' })}.${b64url({ ...real, exp: real.exp + 3600 })}.`;
  assert.equal((await me(`sysaiq_admin=${none}`)).status, 401);
  // a different HMAC alg signed with the real secret is still refused (pinned to HS256)
  const hs512 = jwt.sign({ uid: real.uid, u: real.u, tv: real.tv }, config.jwtSecret, { algorithm: 'HS512', expiresIn: '1h' });
  assert.equal((await me(`sysaiq_admin=${hs512}`)).status, 401);
  // tampered payload
  const [h, , s] = t.cookie.split('=')[1].split('.');
  assert.equal((await me(`sysaiq_admin=${h}.${b64url({ ...real, uid: 999 })}.${s}`)).status, 401);
  // wrong token_version claim
  const staleTv = jwt.sign({ uid: real.uid, u: real.u, tv: real.tv + 5 }, config.jwtSecret, { algorithm: 'HS256', expiresIn: '1h' });
  assert.equal((await me(`sysaiq_admin=${staleTv}`)).status, 401);
  assert.equal((await me(t.cookie)).status, 200);
});

test('GET /account reports the bootstrap password as suspected until it is changed', async () => {
  const a = await (await t.fetchAdmin('/account')).json();
  assert.equal(a.username, ADMIN_USER);
  assert.equal(a.pwd_changed_at, null);
  assert.equal(typeof a.last_login_at, 'string');
  assert.equal(a.default_password_suspected, true);
  assert.equal((await (await t.fetchAdmin('/setup-status')).json()).default_password_suspected, true);
});

test('password change: validation, wrong current password, then the old cookie dies', async () => {
  const bad = async (body, field) => {
    const r = await t.fetchAdmin('/account/password', { method: 'POST', body });
    assert.equal(r.status, 422, JSON.stringify(body));
    const j = await r.json();
    assert.equal(j.error, 'validation');
    assert.ok(j.fields[field], `${field}: ${JSON.stringify(j.fields)}`);
  };
  await bad({ current: ADMIN_PASS, next: 'short1' }, 'next');
  await bad({ current: ADMIN_PASS, next: 'onlyletterslong' }, 'next');
  await bad({ current: ADMIN_PASS, next: '12345678901' }, 'next');
  await bad({ current: ADMIN_PASS, next: ADMIN_PASS }, 'next');
  await bad({ next: 'new-password-1' }, 'current');

  const wrong = await t.fetchAdmin('/account/password', { method: 'POST', body: { current: 'not-it', next: 'new-password-1' } });
  assert.equal(wrong.status, 403);
  assert.equal((await wrong.json()).error, 'wrong_password');

  const oldCookie = t.cookie;
  const ok = await t.fetchAdmin('/account/password', { method: 'POST', body: { current: ADMIN_PASS, next: 'new-password-1' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true });
  const fresh = ok.headers.getSetCookie().map(c => c.split(';')[0]).find(p => p.split('=')[1]);
  assert.ok(fresh, 'a new cookie was issued');

  assert.equal((await me(oldCookie)).status, 401, 'the pre-change cookie is invalid');
  assert.equal((await me(fresh)).status, 200, 'the re-issued cookie works');

  // old password no longer logs in, new one does; account now reports the change
  assert.equal((await t.loginAsAdmin(ADMIN_USER, ADMIN_PASS)).status, 401);
  assert.equal((await t.loginAsAdmin(ADMIN_USER, 'new-password-1')).status, 200);
  const a = await (await t.fetchAdmin('/account')).json();
  assert.equal(typeof a.pwd_changed_at, 'string');
  assert.equal(a.default_password_suspected, false);

  const { db } = await import('../../src/db/index.js');
  const rows = db.prepare('SELECT action, summary FROM audit_log WHERE entity=? ORDER BY id').all('admins');
  assert.ok(rows.some(r => r.action === 'password.change'));
  assert.ok(rows.some(r => r.action === 'password.change.failed'));
  assert.ok(!rows.some(r => r.summary.includes('new-password')));
});

test('production boot with a missing SECRETS_KEY exits non-zero without printing secrets', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sysaiq-boot-'));
  try {
    const env = {
      PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', PORT: '0',
      DATA_DIR: dir, SITE_DIR: dir, JWT_SECRET: randomBytes(24).toString('hex'), ADMIN_PASS: 'a-strong-password-1',
    };
    const code = "const { createApp } = await import('./app.js'); await createApp(); console.log('BOOTED');";
    let out = '', exit = 0;
    try {
      const r = await run(process.execPath, ['--input-type=module', '-e', code], { env, cwd: SRC, timeout: 20000 });
      out = r.stdout + r.stderr;
    } catch (e) { exit = e.code; out = String(e.stdout || '') + String(e.stderr || ''); }
    assert.notEqual(exit, 0);
    assert.match(out, /SECRETS_KEY/);
    assert.doesNotMatch(out, /BOOTED/);
    assert.ok(!out.includes(env.JWT_SECRET));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
