// news/fetch.js: every outbound news fetch is https-only and refuses private
// / loopback / link-local hosts, on the first hop and after a redirect.
// None of these requests reaches the network (the guard throws first).
import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchText, setTransport, errorCode, pageSummary, pageExcerpt } from '../../src/news/fetch.js';
import { httpRequest } from '../../src/lib/http.js';

afterEach(() => setTransport(null));
const quiet = opts => httpRequest({ ...opts, log: () => {} });

test('http:// is refused', async () => {
  setTransport(quiet);
  await assert.rejects(fetchText('http://example.com/feed.xml'), e => errorCode(e) === 'https_required');
});

test('private, loopback, link-local and localhost hosts are refused', async () => {
  setTransport(quiet);
  for (const u of [
    'https://127.0.0.1/feed', 'https://10.0.0.8/rss', 'https://192.168.1.1/', 'https://169.254.169.254/latest/meta-data/',
    'https://[::1]/feed', 'https://[::ffff:127.0.0.1]/x', 'https://localhost/feed', 'https://printer.local/feed', 'https://0.0.0.0/',
  ]) {
    await assert.rejects(fetchText(u), e => errorCode(e) === 'private_host', u);
  }
});

test('credentials in the URL are refused', async () => {
  setTransport(quiet);
  await assert.rejects(fetchText('https://user:pw@example.com/feed'), e => errorCode(e) === 'bad_url');
});

test('a redirect to a private host is refused on the next hop', async () => {
  const seen = [];
  setTransport(opts => {
    seen.push(opts.url);
    if (opts.url === 'https://feeds.example.com/rss') {
      return { ok: false, status: 302, headers: new Headers({ location: 'https://127.0.0.1:8080/admin' }), text: '' };
    }
    return quiet(opts);
  });
  await assert.rejects(fetchText('https://feeds.example.com/rss'), e => errorCode(e) === 'private_host');
  assert.deepEqual(seen, ['https://feeds.example.com/rss', 'https://127.0.0.1:8080/admin']);
});

test('redirect loops stop, 304 and conditional headers pass through', async () => {
  setTransport(() => ({ ok: false, status: 301, headers: new Headers({ location: '/again' }), text: '' }));
  await assert.rejects(fetchText('https://loop.example.com/'), e => errorCode(e) === 'too_many_redirects');

  let hdrs = null;
  setTransport(opts => { hdrs = opts.headers; return { ok: false, status: 304, headers: new Headers(), text: '' }; });
  const r = await fetchText('https://feeds.example.com/rss', { etag: 'W/"abc"', lastModified: 'Tue, 22 Sep 2026 10:00:00 GMT' });
  assert.equal(r.status, 304);
  assert.equal(hdrs['if-none-match'], 'W/"abc"');
  assert.equal(hdrs['if-modified-since'], 'Tue, 22 Sep 2026 10:00:00 GMT');
  assert.equal(r.etag, 'W/"abc"');

  setTransport(() => ({ ok: false, status: 404, headers: new Headers(), text: 'nope' }));
  await assert.rejects(fetchText('https://feeds.example.com/gone'), e => errorCode(e) === 'http_404');
});

test('the transport receives the 10 s timeout and 2 MB cap', async () => {
  let got = null;
  setTransport(opts => { got = opts; return { ok: true, status: 200, headers: new Headers({ etag: '"e1"' }), text: '<rss/>' }; });
  const r = await fetchText('https://feeds.example.com/rss');
  assert.equal(got.timeoutMs, 10_000);
  assert.equal(got.maxBytes, 2 * 1024 * 1024);
  assert.equal(got.provider, 'news');
  assert.equal(r.etag, '"e1"');
});

test('pageSummary: og tags, article paragraphs, plain text only', () => {
  const html = `<html><head><title>Fallback</title>
    <meta content="Big &amp; new model" property="og:title">
    <meta property="og:description" content="The lab released a model.">
    <meta property="og:site_name" content="Lab Blog">
    <meta property="article:published_time" content="2026-09-22T09:00:00Z">
    </head><body><nav><p>Menu menu menu menu menu menu menu menu menu menu menu</p></nav>
    <article><p>short</p><p>The model <b>handles</b> long documents and tool use for agents in production.</p><script>evil()</script></article></body></html>`;
  const p = pageSummary(html);
  assert.equal(p.title, 'Big & new model');
  assert.equal(p.description, 'The lab released a model.');
  assert.equal(p.siteName, 'Lab Blog');
  assert.equal(p.published, '2026-09-22T09:00:00.000Z');
  assert.equal(p.text, 'The model handles long documents and tool use for agents in production.');
  assert.equal(pageExcerpt(p), 'The lab released a model. The model handles long documents and tool use for agents in production.');
});
