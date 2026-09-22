// Small shared libs: html, cache, events, errors, registry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, attr, jsonForScript, J } from '../../src/lib/html.js';
import { cached, invalidate, cacheVersion } from '../../src/lib/cache.js';
import { on, emit, listenerCount } from '../../src/lib/events.js';
import { HttpError, asyncHandler, errorMiddleware } from '../../src/lib/errors.js';
import { registerSetting, isRegisteredSetting, publicSettings, registerCspSource, cspSources, reserveSlug, isReservedSlug } from '../../src/lib/registry.js';

test('html helpers', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(attr('a`b"c'), 'a&#96;b&quot;c');
  assert.equal(esc(null), '');
  assert.equal(jsonForScript({ s: '</script><b>' }), '{"s":"\\u003c/script>\\u003cb>"}');
  assert.equal(jsonForScript({ s: '\u2028' }), '{"s":"\\u2028"}');
  assert.deepEqual(J('[1,2]'), [1, 2]);
  assert.deepEqual(J('nope'), []);
  assert.deepEqual(J('', { a: 1 }), { a: 1 });
  assert.deepEqual(J(null, 'd'), 'd');
});

test('cache: memoises until invalidate(); prefix invalidation keeps the version', () => {
  let n = 0;
  const v0 = cacheVersion();
  assert.equal(cached('home:fa', () => ++n), 1);
  assert.equal(cached('home:fa', () => ++n), 1);
  assert.equal(cached('page:x', () => ++n), 2);
  invalidate('page:');
  assert.equal(cacheVersion(), v0);
  assert.equal(cached('page:x', () => ++n), 3);
  assert.equal(cached('home:fa', () => ++n), 1);
  invalidate();
  assert.equal(cacheVersion(), v0 + 1);
  assert.equal(cached('home:fa', () => ++n), 4);
});

test('events: listeners run async, a throwing listener does not break the others', async () => {
  const seen = [];
  const off = on('lead.created', p => seen.push(['a', p.id]));
  on('lead.created', () => { throw new Error('boom'); });
  on('lead.created', async () => { throw new Error('async boom'); });
  on('lead.created', p => seen.push(['b', p.id]));
  const origErr = console.error;
  const errs = [];
  console.error = (...a) => errs.push(a.join(' '));
  try {
    assert.equal(emit('lead.created', { id: 7 }), 4);
    assert.deepEqual(seen, [], 'nothing runs synchronously');
    await new Promise(r => setTimeout(r, 5));
    assert.deepEqual(seen, [['a', 7], ['b', 7]]);
    assert.equal(errs.filter(e => e.includes('boom')).length, 2);
  } finally {
    console.error = origErr;
  }
  off();
  assert.equal(listenerCount('lead.created'), 3);
  assert.equal(emit('nobody.listens', {}), 0);
});

test('errors: HttpError shape, asyncHandler forwards rejections, errorMiddleware hides internals', async () => {
  const e = new HttpError(422, 'validation', 'Bad', { name: 'required' });
  assert.deepEqual(e.toJSON(), { error: 'validation', message: 'Bad', fields: { name: 'required' } });
  assert.deepEqual(new HttpError(404, 'not_found').toJSON(), { error: 'not_found', message: 'not_found' });

  const res = () => {
    const r = { code: 0, body: null, headersSent: false };
    r.status = c => { r.code = c; return r; };
    r.json = b => { r.body = b; return r; };
    return r;
  };
  let forwarded;
  await asyncHandler(async () => { throw e; })({}, res(), err => { forwarded = err; });
  assert.equal(forwarded, e);

  const r1 = res();
  errorMiddleware(e, { method: 'GET', originalUrl: '/x' }, r1, () => {});
  assert.equal(r1.code, 422);
  assert.deepEqual(r1.body, e.toJSON());

  const origErr = console.error;
  console.error = () => {};
  try {
    const r2 = res();
    errorMiddleware(new Error('db exploded at /secret/path'), { method: 'GET', originalUrl: '/x' }, r2, () => {});
    assert.equal(r2.code, 500);
    assert.deepEqual(r2.body, { error: 'internal', message: 'Internal server error' });
  } finally {
    console.error = origErr;
  }
  const r3 = res();
  errorMiddleware(Object.assign(new Error('Unexpected token'), { status: 400, type: 'entity.parse.failed' }), { method: 'POST', originalUrl: '/x' }, r3, () => {});
  assert.equal(r3.code, 400);
  assert.equal(r3.body.error, 'bad_json');
  const r4 = res();
  errorMiddleware(Object.assign(new Error('File too large'), { name: 'MulterError', code: 'LIMIT_FILE_SIZE' }), { method: 'POST', originalUrl: '/x' }, r4, () => {});
  assert.equal(r4.code, 400);
  assert.equal(r4.body.error, 'file_too_large');
});

test('registry: settings, csp sources, reserved slugs', () => {
  registerSetting({ key: 'site_info', schema: { x: 1 }, public: false });
  registerSetting({ key: 'nav_cta', public: true });
  assert.equal(isRegisteredSetting('site_info'), true);
  assert.ok(publicSettings().includes('nav_cta'));
  assert.ok(!publicSettings().includes('site_info'));
  assert.throws(() => registerSetting({}), /key required/);

  registerCspSource('img-src', 'https://trustseal.enamad.ir');
  registerCspSource('img-src', 'https://trustseal.enamad.ir');
  registerCspSource('frame-src', 'https://pay.example');
  assert.deepEqual(cspSources('img-src'), ['https://trustseal.enamad.ir']);
  assert.deepEqual(cspSources(), { 'img-src': ['https://trustseal.enamad.ir'], 'frame-src': ['https://pay.example'] });

  // a src derived from admin input cannot widen script-src or inject a directive
  for (const [d, s] of [
    ['script-src', 'https://cdn.example'], ['script-src', "'unsafe-inline'"], ['default-src', 'https://x.example'],
    ['img-src', "'unsafe-inline'"], ['img-src', 'https://a.io; script-src *'], ['img-src', 'http://a.io'],
    ['img-src', '*'], ['img-src', 'https://'], ['img-src', 'https://localhost'], ['img-src', 'https://A.IO'],
    ['img-src', 'https://a.io/path'], ['img-src', ''], ['img-src', null], ['frame-src', 'javascript:'],
  ]) {
    assert.throws(() => registerCspSource(d, s), /registerCspSource/, `${d} ${s}`);
  }
  registerCspSource('font-src', 'data:');
  registerCspSource('connect-src', 'https://*.sysaiq.com:8443');
  assert.deepEqual(cspSources('font-src'), ['data:']);
  assert.deepEqual(cspSources('connect-src'), ['https://*.sysaiq.com:8443']);
  assert.equal(cspSources('script-src').length, 0);

  reserveSlug('services', ['work', 'pay']);
  assert.equal(isReservedSlug('Services'), true);
  assert.equal(isReservedSlug('pay'), true);
  assert.equal(isReservedSlug('blog'), false);
});
