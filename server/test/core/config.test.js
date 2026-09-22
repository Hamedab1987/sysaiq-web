// Production fail-fast: the process must not start with missing/weak secrets.
// Each case boots config.js (or createApp) in a child process with a
// controlled environment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

const run = promisify(execFile);
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');
const GOOD = { JWT_SECRET: randomBytes(24).toString('hex'), SECRETS_KEY: randomBytes(32).toString('base64') };

async function boot(code, env) {
  const base = { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', PORT: '0' };
  try {
    const { stdout, stderr } = await run(process.execPath, ['--input-type=module', '-e', code], { env: { ...base, ...env }, cwd: SRC, timeout: 20000 });
    return { ok: true, out: stdout + stderr };
  } catch (e) {
    return { ok: false, out: String(e.stdout || '') + String(e.stderr || ''), code: e.code };
  }
}
const loadConfig = env => boot(`const { config } = await import('./config.js'); console.log(JSON.stringify({ env: config.env, origins: config.allowedOrigins, key: config.secretsKey.length, leads: config.leadsRateMax }));`, env);

test('production refuses to boot without JWT_SECRET / with the shipped placeholder / too short', async () => {
  for (const JWT_SECRET of [undefined, 'change-me-in-env', 'change-this-to-a-long-random-string', 'short']) {
    const r = await loadConfig({ JWT_SECRET, SECRETS_KEY: GOOD.SECRETS_KEY });
    assert.equal(r.ok, false, String(JWT_SECRET));
    assert.match(r.out, /JWT_SECRET/);
    assert.ok(!r.out.includes(GOOD.SECRETS_KEY), 'never prints a secret');
  }
});

test('production refuses a missing or malformed SECRETS_KEY', async () => {
  for (const SECRETS_KEY of [undefined, 'tooshort', randomBytes(16).toString('hex'), 'a'.repeat(64), randomBytes(31).toString('base64')]) {
    const r = await loadConfig({ JWT_SECRET: GOOD.JWT_SECRET, SECRETS_KEY });
    assert.equal(r.ok, false, String(SECRETS_KEY));
    assert.match(r.out, /SECRETS_KEY/);
  }
});

test('production accepts a good config (hex and base64 keys) and only lists the public origin', async () => {
  for (const SECRETS_KEY of [randomBytes(32).toString('hex'), randomBytes(32).toString('base64')]) {
    const r = await loadConfig({ ...GOOD, SECRETS_KEY, PUBLIC_BASE_URL: 'https://sysaiq.com/', ALLOWED_ORIGINS: 'https://www.sysaiq.com' });
    assert.equal(r.ok, true, r.out);
    const j = JSON.parse(r.out.trim().split('\n').pop());
    assert.equal(j.env, 'production');
    assert.deepEqual(j.origins, ['https://sysaiq.com', 'https://www.sysaiq.com']);
    assert.equal(j.key, 32);
    assert.equal(j.leads, 15);
    // the boot line ops grep for in journalctl — and it never prints a secret
    assert.match(r.out, /\[config\] production: JWT_SECRET \+ SECRETS_KEY loaded from the environment/);
    assert.ok(!r.out.includes(SECRETS_KEY) && !r.out.includes(GOOD.JWT_SECRET));
  }
});

test('development generates secrets in memory and says so without printing them', async () => {
  const r = await loadConfig({ NODE_ENV: 'development', PORT: '3999' });
  assert.equal(r.ok, true, r.out);
  assert.match(r.out, /\[config\] development: JWT_SECRET \+ SECRETS_KEY not set/);
  const j = JSON.parse(r.out.trim().split('\n').pop());
  assert.deepEqual(j.origins, ['http://127.0.0.1:3999', 'http://localhost:3999']);
});

test('LEADS_RATE_MAX overrides the contact-form rate limit; junk falls back to 15', async () => {
  for (const [LEADS_RATE_MAX, want] of [['40', 40], ['1000', 1000], ['0', 15], ['-3', 15], ['abc', 15], ['', 15], ['12.5', 15]]) {
    const r = await loadConfig({ ...GOOD, LEADS_RATE_MAX });
    assert.equal(r.ok, true, r.out);
    assert.equal(JSON.parse(r.out.trim().split('\n').pop()).leads, want, JSON.stringify(LEADS_RATE_MAX));
  }
});

test('secure_delete is on for every connection, not only the boot that ran migration 002', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sysaiq-sd-'));
  try {
    const code = `const { db } = await import('./db/index.js'); console.log('SD=' + db.pragma('secure_delete', { simple: true }) + ' JM=' + db.pragma('journal_mode', { simple: true }));`;
    const first = await boot(code, { ...GOOD, DATA_DIR: dir });
    assert.equal(first.ok, true, first.out);
    assert.match(first.out, /\[migrate\] applied/);
    assert.match(first.out, /SD=1 JM=wal/);
    // second boot: nothing to migrate, the pragma must still be set by db/index.js itself
    const second = await boot(code, { ...GOOD, DATA_DIR: dir });
    assert.equal(second.ok, true, second.out);
    assert.ok(!/\[migrate\] applied/.test(second.out), second.out);
    assert.match(second.out, /SD=1 JM=wal/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('production with no admin yet refuses a missing or weak ADMIN_PASS, accepts a strong one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'sysaiq-cfg-'));
  try {
    const code = `const { createApp } = await import('./app.js'); await createApp(); console.log('BOOTED');`;
    for (const ADMIN_PASS of [undefined, 'change-this-now', 'sysaiq-admin', 'short']) {
      const r = await boot(code, { ...GOOD, DATA_DIR: dir, SITE_DIR: dir, ADMIN_PASS });
      assert.equal(r.ok, false, String(ADMIN_PASS));
      assert.match(r.out, /ADMIN_PASS/);
    }
    const ok = await boot(code, { ...GOOD, DATA_DIR: dir, SITE_DIR: dir, ADMIN_USER: 'owner', ADMIN_PASS: 'a-strong-password-1' });
    assert.equal(ok.ok, true, ok.out);
    assert.match(ok.out, /created admin "owner"/);
    assert.ok(!ok.out.includes('a-strong-password-1'));
    // second boot: admin exists, ADMIN_PASS no longer required
    const again = await boot(code, { ...GOOD, DATA_DIR: dir, SITE_DIR: dir });
    assert.equal(again.ok, true, again.out);
    assert.match(again.out, /BOOTED/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
