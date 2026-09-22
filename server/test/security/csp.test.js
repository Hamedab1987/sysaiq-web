// lib/csp.js policies and where app.js applies them.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { startTestApp } from '../helpers.js';

let t, csp, registry;
// The home tests plant their own templates/manifest.json at csp.MANIFEST_PATH
// (lib/csp.js reads a fixed path). The real one — build.py output that the
// deployed home page's CSP depends on — is moved aside first and put back
// afterwards, byte for byte, so a test run never ships a server without it.
let savedManifest = null; // Buffer while a real manifest existed, else null
async function restoreManifest() {
  if (savedManifest === null) { await rm(csp.MANIFEST_PATH, { force: true }); }
  else {
    await mkdir(csp.MANIFEST_PATH.replace(/[\\/]manifest\.json$/, ''), { recursive: true });
    await writeFile(csp.MANIFEST_PATH, savedManifest);
  }
  csp.resetCspCache();
}
before(async () => {
  t = await startTestApp();
  csp = await import('../../src/lib/csp.js');
  registry = await import('../../src/lib/registry.js');
  const { db } = await import('../../src/db/index.js');
  db.prepare("INSERT INTO projects (slug, title_en, title_fa, published) VALUES ('p1', 'P', 'پ', 1)").run();
  await t.loginAsAdmin();
  savedManifest = await readFile(csp.MANIFEST_PATH).catch(() => null);
  await rm(csp.MANIFEST_PATH, { force: true });
  csp.resetCspCache();
});
after(async () => { await restoreManifest(); await t.close(); });

const directive = (policy, name) => policy.split(';').map(s => s.trim()).find(s => s === name || s.startsWith(`${name} `)) || '';
const header = async (path, opts) => { const r = await fetch(t.base + path, opts); return { r, csp: r.headers.get('content-security-policy') }; };

test('no kind allows inline scripts; each kind has its distinguishing directives', () => {
  for (const kind of ['page', 'admin', 'api', 'upload']) {
    const p = csp.buildCsp(kind);
    assert.equal(typeof p, 'string', kind);
    assert.ok(!directive(p, 'script-src').includes('unsafe-inline'), `${kind}: script-src has unsafe-inline`);
    assert.ok(!directive(p, 'default-src').includes('unsafe-inline'), kind);
    assert.ok(!p.includes('unsafe-eval'), kind);
  }
  assert.equal(csp.buildCsp('api'), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(csp.buildCsp('upload'), "default-src 'none'; img-src 'self'; sandbox");

  const page = csp.buildCsp('page');
  assert.equal(directive(page, 'script-src'), "script-src 'self'");
  assert.equal(directive(page, 'style-src'), "style-src 'self' 'unsafe-inline'");
  assert.equal(directive(page, 'img-src'), "img-src 'self' data: https:");
  assert.equal(directive(page, 'object-src'), "object-src 'none'");
  assert.equal(directive(page, 'base-uri'), "base-uri 'self'");
  assert.equal(directive(page, 'form-action'), "form-action 'self'");
  assert.equal(directive(page, 'frame-ancestors'), "frame-ancestors 'self'");
  assert.ok(!page.includes('script-src-attr'));

  const admin = csp.buildCsp('admin');
  assert.equal(directive(admin, 'frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(directive(admin, 'img-src'), "img-src 'self' data: https: blob:");
  assert.equal(directive(admin, 'script-src'), "script-src 'self'");
  assert.equal(directive(admin, 'script-src-attr'), "script-src-attr 'unsafe-inline'"); // TODO: legacy admin only
  assert.throws(() => csp.buildCsp('nope'), /unknown kind/);
});

test('registered sources are merged into page/admin/home, never into api/upload', () => {
  registry.registerCspSource('img-src', 'https://trustseal.enamad.ir');
  registry.registerCspSource('form-action', 'https://gateway.example');
  // directives outside the allowlist are refused at registration, so they can never reach a policy
  assert.throws(() => registry.registerCspSource('report-uri', 'https://nope.example'), /not allowed/);
  assert.throws(() => registry.registerCspSource('script-src', 'https://cdn.example'), /not allowed/);
  assert.equal(directive(csp.buildCsp('page'), 'img-src'), "img-src 'self' data: https: https://trustseal.enamad.ir");
  assert.ok(!csp.buildCsp('page').includes('report-uri'));
  assert.equal(directive(csp.buildCsp('page'), 'script-src'), "script-src 'self'");
  assert.equal(directive(csp.buildCsp('page'), 'form-action'), "form-action 'self' https://gateway.example");
  assert.equal(directive(csp.buildCsp('admin'), 'img-src'), "img-src 'self' data: https: blob: https://trustseal.enamad.ir");
  assert.equal(csp.buildCsp('api'), "default-src 'none'; frame-ancestors 'none'");
  assert.equal(csp.buildCsp('upload'), "default-src 'none'; img-src 'self'; sandbox");
});

test('home: no header until templates/manifest.json exists, then sha256 hashes are added', async () => {
  // the baked static home pages, as vesper-project ships them
  for (const lang of ['fa', 'en']) {
    await mkdir(`${t.siteDir}/${lang}`, { recursive: true });
    await writeFile(`${t.siteDir}/${lang}/index.html`, `<!doctype html><title>${lang}</title><script>var baked=1;</script>`);
  }
  assert.equal(csp.buildCsp('home'), null);
  const r0 = await header('/fa/');
  assert.equal(r0.r.status, 200);
  assert.equal(r0.csp, null, 'the baked static home page gets no CSP yet');
  assert.equal((await header('/en/index.html')).csp, null);

  // simulate build.py output
  await mkdir(csp.MANIFEST_PATH.replace(/[\\/]manifest\.json$/, ''), { recursive: true });
  await writeFile(csp.MANIFEST_PATH, JSON.stringify({ scripts: ['sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', "'sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='", 'bogus'] }));
  try {
    csp.resetCspCache();
    const home = csp.buildCsp('home');
    assert.equal(directive(home, 'script-src'), "script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' 'sha256-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB='");
    assert.ok(!home.includes('unsafe-inline') || directive(home, 'style-src').includes('unsafe-inline'));
    assert.ok(!directive(home, 'script-src').includes('unsafe-inline'));
    assert.equal(directive(home, 'img-src'), "img-src 'self' data: https: https://trustseal.enamad.ir");
    const r1 = await header('/fa/');
    assert.equal(directive(r1.csp, 'script-src'), directive(home, 'script-src'));
  } finally {
    await rm(csp.MANIFEST_PATH, { force: true });
    csp.resetCspCache();
  }
  assert.equal(csp.buildCsp('home'), null);
});

test('home: a malformed, unrecognised or hash-less manifest fails like a missing one (no header, never a blocking policy)', async () => {
  await mkdir(csp.MANIFEST_PATH.replace(/[\\/]manifest\.json$/, ''), { recursive: true });
  const cases = [
    ['not json {', 'malformed JSON'],
    ['{"foo": 1}', 'unrecognised shape'],
    ['null', 'null'],
    ['"sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="', 'bare string'],
    ['{"scripts": []}', 'empty list'],
    ['{"scripts": ["bogus", 42, {"md5": "x"}]}', 'no valid hash'],
    ['{"csp": {"script-src": "sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="}}', 'script-src not a list'],
  ];
  const errors = [];
  const orig = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    for (const [body, label] of cases) {
      await writeFile(csp.MANIFEST_PATH, body);
      csp.resetCspCache();
      assert.equal(csp.buildCsp('home'), null, label);
      assert.equal(csp.buildCsp('home'), null, label); // cached answer is the same
      const r = await header('/fa/');
      assert.equal(r.r.status, 200, label);
      assert.equal(r.csp, null, `${label}: the served home page must not get a policy that blocks its inline scripts`);
    }
    // logged once per manifest version, not once per request
    assert.equal(errors.length, cases.length, errors.join('\n'));
    assert.ok(errors.every(e => e.includes('[csp]') && e.includes('without CSP')), errors.join('\n'));
    // the page policy is unaffected
    assert.equal(directive(csp.buildCsp('page'), 'script-src'), "script-src 'self'");
    // and a good manifest written afterwards is picked up again
    await writeFile(csp.MANIFEST_PATH, JSON.stringify({ scripts: ['sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='] }));
    csp.resetCspCache();
    assert.equal(directive(csp.buildCsp('home'), 'script-src'), "script-src 'self' 'sha256-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='");
  } finally {
    console.error = orig;
    await rm(csp.MANIFEST_PATH, { force: true });
    csp.resetCspCache();
  }
});

test('headers on /api, /admin, /fa/work, /uploads; Referrer-Policy; no HSTS outside production', async () => {
  const api = await header('/api/content');
  assert.equal(api.csp, "default-src 'none'; frame-ancestors 'none'");
  assert.equal((await header('/api/does-not-exist')).csp, "default-src 'none'; frame-ancestors 'none'");
  const adminApi = await fetch(`${t.base}/api/admin/projects`, { headers: { cookie: t.cookie } });
  assert.equal(adminApi.headers.get('content-security-policy'), "default-src 'none'; frame-ancestors 'none'");

  const admin = await header('/admin/');
  assert.equal(admin.r.status, 200);
  assert.equal(directive(admin.csp, 'frame-ancestors'), "frame-ancestors 'none'");
  assert.equal(directive(admin.csp, 'script-src'), "script-src 'self'");
  assert.equal((await header('/admin/app.js')).csp, admin.csp);

  // an unclaimed site URL is the SSR not-found page (routes/public/notfound.routes.js) under the page policy
  const missing = await header('/fa/work/missing');
  assert.equal(missing.r.status, 404);
  assert.equal(directive(missing.csp, 'script-src'), "script-src 'self'");
  assert.equal(directive(missing.csp, 'frame-ancestors'), "frame-ancestors 'self'");

  for (const p of ['/fa/work', '/en/work', '/fa/work/p1', '/en/work/p1']) {
    const { r, csp: policy } = await header(p);
    assert.equal(directive(policy, 'script-src'), "script-src 'self'", p);
    assert.equal(directive(policy, 'frame-ancestors'), "frame-ancestors 'self'", p);
    assert.equal(directive(policy, 'style-src'), "style-src 'self' 'unsafe-inline'", p); // SSR pages use inline <style>
    assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin', p);
    assert.equal(r.headers.get('strict-transport-security'), null, p);
    if (r.status === 200) {
      const html = await r.text();
      // external /assets/site/pages.js and JSON(-LD) data blocks are fine; any other <script> is inline and would be blocked
      const inline = (html.match(/<script\b[^>]*>/gi) || []).filter(s => !/\ssrc=/i.test(s) && !/type="application\/(ld\+)?json"/i.test(s));
      assert.deepEqual(inline, [], `${p} has an inline script the page policy would block`);
      assert.ok(!/\son[a-z]+=/i.test(html), `${p} has an inline event handler`);
    }
  }

  const fd = new FormData();
  fd.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')]), 'x.png');
  const up = await (await t.fetchAdmin('/upload', { method: 'POST', body: fd })).json();
  const img = await header(up.url);
  assert.equal(img.r.status, 200);
  assert.equal(img.csp, "default-src 'none'; img-src 'self'; sandbox");
  assert.equal(img.r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await header('/uploads/missing.png')).csp, "default-src 'none'"); // express 404 page
});

// Regression (supervisor, round 2): this file used to assert null over the real
// build.py manifest and delete it in `finally`, so every `npm test` left the
// home page without a CSP header until the next build.py. The real file must
// come back exactly as it was and drive the home policy again.
test('the real templates/manifest.json is restored after the home tests and drives the home policy again', async t => {
  await restoreManifest();
  if (savedManifest === null) {
    t.diagnostic('no build.py manifest existed before this run (run python3 build.py) — only checking nothing was left behind');
    await assert.rejects(readFile(csp.MANIFEST_PATH), { code: 'ENOENT' });
    assert.equal(csp.buildCsp('home'), null);
    return;
  }
  assert.ok(Buffer.from(await readFile(csp.MANIFEST_PATH)).equals(savedManifest), 'manifest.json bytes changed');
  const home = csp.buildCsp('home');
  assert.equal(typeof home, 'string', 'buildCsp("home") must be a policy while a real manifest is present');
  assert.match(directive(home, 'script-src'), /^script-src 'self'( 'sha(256|384|512)-[A-Za-z0-9+/=_-]+')+$/);
  assert.equal(directive((await header('/fa/')).csp, 'script-src'), directive(home, 'script-src'));
  assert.equal(directive((await header('/en/')).csp, 'script-src'), directive(home, 'script-src'));
});
