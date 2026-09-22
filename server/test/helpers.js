// Test harness. One app per test FILE (node:test runs each file in its own
// process and the db module is a process-wide singleton):
//   const t = await startTestApp();
//   await fetch(t.base + '/api/content');
//   await t.loginAsAdmin();  await t.fetchAdmin('/projects');
//   await t.close();
// Env is prepared BEFORE app.js is imported: temp DATA_DIR, NODE_ENV=test,
// random SECRETS_KEY/JWT_SECRET, known ADMIN_USER/ADMIN_PASS, no OpenAI/SMTP,
// and a lead rate limit high enough that test files never trip it.
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import net from 'node:net';

export const ADMIN_USER = 'tester';
export const ADMIN_PASS = 'test-pass-' + randomBytes(6).toString('hex');

// reserve a port up front so config.port / allowedOrigins match the real listener
function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  });
}

export async function startTestApp({ env = {} } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'sysaiq-test-'));
  const siteDir = join(dataDir, 'site');
  await mkdir(siteDir, { recursive: true });
  await writeFile(join(siteDir, 'index.html'), '<!doctype html><title>test site</title>');
  const port = await freePort();

  for (const k of ['OPENAI_API_KEY', 'OPENAI_MODEL', 'SMTP_HOST', 'PUBLIC_BASE_URL', 'ALLOWED_ORIGINS', 'UPLOAD_DIR']) delete process.env[k];
  Object.assign(process.env, {
    NODE_ENV: 'test',
    PORT: String(port),
    DATA_DIR: dataDir,
    SITE_DIR: siteDir,
    SECRETS_KEY: randomBytes(32).toString('base64'),
    JWT_SECRET: randomBytes(32).toString('hex'),
    ADMIN_USER,
    ADMIN_PASS,
    LEADS_RATE_MAX: '1000',
    ...env,
  });

  const { createApp } = await import('../src/app.js');
  const app = await createApp();
  const server = await new Promise((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  const t = {
    app, server, base, dataDir, siteDir, port,
    get cookie() { return cookie; },

    async loginAsAdmin(username = ADMIN_USER, password = ADMIN_PASS) {
      const r = await fetch(`${base}/api/admin/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: base, 'x-requested-with': 'sysaiq-admin' },
        body: JSON.stringify({ username, password }),
      });
      // login also expires the legacy Path=/ cookie: keep the one that carries a token
      const pairs = r.headers.getSetCookie().map(c => c.split(';')[0]);
      cookie = pairs.find(p => p.split('=')[1]) || '';
      return r;
    },

    // admin request with session cookie + the CSRF headers the guard expects;
    // a plain-object body is JSON-encoded
    fetchAdmin(path, opts = {}) {
      const headers = { origin: base, 'x-requested-with': 'sysaiq-admin', ...(opts.headers || {}) };
      if (cookie) headers.cookie = cookie;
      let body = opts.body;
      if (body && typeof body === 'object' && !(body instanceof FormData) && !Buffer.isBuffer(body)) {
        headers['content-type'] = 'application/json';
        body = JSON.stringify(body);
      }
      return fetch(`${base}/api/admin${path}`, { ...opts, headers, body });
    },

    async json(path, opts) {
      const r = await fetch(`${base}${path}`, opts);
      return { status: r.status, body: await r.json() };
    },

    async close() {
      await new Promise(r => server.close(r));
      try { (await import('../src/db/index.js')).db.close(); } catch {}
      await rm(dataDir, { recursive: true, force: true });
    },
  };
  return t;
}
