// lib/upload.js: only real raster images get stored, named by their bytes.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { startTestApp } from '../helpers.js';

let t, upload, config;
before(async () => {
  t = await startTestApp(); // env must be set before any src/ module loads
  upload = await import('../../src/lib/upload.js');
  ({ config } = await import('../../src/config.js'));
  await t.loginAsAdmin();
});
after(async () => { await t.close(); });

// 1×1 images
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const WEBP = Buffer.from('UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==', 'base64');

async function send(bytes, name, type = 'application/octet-stream') {
  const fd = new FormData();
  fd.append('file', new Blob([bytes], { type }), name);
  const r = await t.fetchAdmin('/upload', { method: 'POST', body: fd });
  return { status: r.status, body: await r.json() };
}
const stored = async () => (await readdir(config.uploadDir)).sort();

test('sniffImage detects the four formats and nothing else', () => {
  assert.deepEqual(upload.sniffImage(PNG), { ext: 'png', mime: 'image/png' });
  assert.deepEqual(upload.sniffImage(GIF), { ext: 'gif', mime: 'image/gif' });
  assert.deepEqual(upload.sniffImage(JPEG), { ext: 'jpg', mime: 'image/jpeg' });
  assert.deepEqual(upload.sniffImage(WEBP), { ext: 'webp', mime: 'image/webp' });
  assert.equal(upload.sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), null);
  assert.equal(upload.sniffImage(Buffer.from('<!doctype html><html><script>alert(1)</script></html>')), null);
  assert.equal(upload.sniffImage(Buffer.from('%PDF-1.4')), null);
  assert.equal(upload.sniffImage(Buffer.alloc(0)), null);
  assert.equal(upload.sniffImage(Buffer.from('RIFF\0\0\0\0WAVE')), null);
  // polyglots: valid image magic, markup inside
  assert.equal(upload.sniffImage(Buffer.concat([GIF, Buffer.from('<script>alert(1)</script>')])), null);
  assert.equal(upload.sniffImage(Buffer.concat([PNG, Buffer.from('<html><body onload=alert(1)>')])), null);
  assert.equal(upload.sniffImage(Buffer.from('GIF89a/*<svg onload=alert(1)>*/=1;')), null);
});

test('the markup scan covers the file head only, so pixel data cannot produce a false positive', () => {
  const head = Buffer.concat([PNG, Buffer.alloc(100), Buffer.from('<svg')]);
  assert.equal(upload.sniffImage(head), null, 'markup within the first 64 KB is caught');
  const edge = Buffer.concat([PNG, Buffer.alloc(upload.SNIFF_BYTES - PNG.length - 4), Buffer.from('<SvG')]);
  assert.equal(upload.sniffImage(edge), null, 'markup ending exactly at the window edge is caught');
  const deep = Buffer.concat([PNG, Buffer.alloc(upload.SNIFF_BYTES), Buffer.from('<svg<script>javascript:')]);
  assert.deepEqual(upload.sniffImage(deep), { ext: 'png', mime: 'image/png' }, 'bytes past the window are pixel data');
});

test('svg, html, a polyglot and an empty file are rejected with 422 and nothing is stored', async () => {
  const before = await stored();
  const cases = [
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'logo.svg', 'image/svg+xml'],
    [Buffer.from('<!doctype html><script>alert(1)</script>'), 'page.html', 'text/html'],
    [Buffer.from('<!doctype html><script>alert(1)</script>'), 'fake.png', 'image/png'], // lying name + type
    [Buffer.concat([GIF, Buffer.from('<script>alert(1)</script>')]), 'poly.gif', 'image/gif'],
    [Buffer.from('MZ\x90\x00'), 'tool.exe', 'application/octet-stream'],
  ];
  for (const [bytes, name, type] of cases) {
    const { status, body } = await send(bytes, name, type);
    assert.equal(status, 422, name);
    assert.equal(body.error, 'unsupported_image', name);
  }
  assert.deepEqual(await stored(), before);
  const none = await t.fetchAdmin('/upload', { method: 'POST', body: new FormData() });
  assert.equal(none.status, 400);
});

test('a real tiny PNG is accepted, stored as .png regardless of the client name, and served', async () => {
  const { status, body } = await send(PNG, '../../evil.HTML', 'text/html');
  assert.equal(status, 200);
  assert.equal(body.ok, true);
  assert.match(body.url, /^\/uploads\/\d+-[0-9a-f]{8}\.png$/);
  const file = body.url.slice('/uploads/'.length);
  assert.ok((await stored()).includes(file));
  assert.deepEqual(await readFile(join(config.uploadDir, file)), PNG);
  const r = await fetch(t.base + body.url);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /image\/png/);
  assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; img-src 'self'; sandbox");
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('jpeg, gif and webp get their own extensions', async () => {
  for (const [bytes, ext] of [[JPEG, 'jpg'], [GIF, 'gif'], [WEBP, 'webp']]) {
    const { status, body } = await send(bytes, 'whatever.bin');
    assert.equal(status, 200, ext);
    assert.match(body.url, new RegExp(`\\.${ext}$`));
  }
});

test('the 8 MB cap is enforced', async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(8 * 1024 * 1024)]);
  const { status, body } = await send(big, 'big.png');
  assert.ok(status === 400 || status === 413, String(status));
  assert.equal(body.error, 'file_too_large');
});
