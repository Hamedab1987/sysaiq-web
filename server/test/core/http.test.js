// lib/http.js against a local server: json/form bodies, relay mapping,
// timeout, size cap, URL policy and log redaction.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { httpJson, httpForm, httpRequest, HttpRequestError, isPrivateAddress } from '../../src/lib/http.js';

let server, base;
const seen = [];
before(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', c => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers, body });
      if (req.url.startsWith('/slow')) return setTimeout(() => { res.end('late'); }, 300);
      if (req.url.startsWith('/big')) { res.setHeader('content-type', 'text/plain'); return res.end('x'.repeat(5000)); }
      if (req.url.startsWith('/text')) { res.statusCode = 502; return res.end('gateway down'); }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, path: req.url, method: req.method, body, ct: req.headers['content-type'] || '' }));
    });
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(r => server.close(r)));

const local = { insecure: true, allowPrivate: true, log: () => {} };

test('httpJson posts JSON and parses JSON back; non-2xx is returned, not thrown', async () => {
  const r = await httpJson({ ...local, url: `${base}/api?k=1`, body: { a: 1 }, headers: { 'X-Api-Key': 'secret' } });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { ok: true, path: '/api?k=1', method: 'POST', body: '{"a":1}', ct: 'application/json' });
  assert.equal(seen.at(-1).headers['x-api-key'], 'secret');
  const g = await httpJson({ ...local, url: `${base}/get` });
  assert.equal(g.data.method, 'GET');
  const t = await httpJson({ ...local, url: `${base}/text` });
  assert.equal(t.ok, false);
  assert.equal(t.status, 502);
  assert.equal(t.data, null);
  assert.equal(t.text, 'gateway down');
});

test('httpForm sends urlencoded', async () => {
  const r = await httpForm({ ...local, url: `${base}/form`, body: { a: '1', b: 'x y' } });
  assert.equal(r.data.body, 'a=1&b=x+y');
  assert.equal(r.data.ct, 'application/x-www-form-urlencoded');
});

test('relay: request goes to <relay>/<host><path> with the relay headers', async () => {
  const r = await httpJson({ ...local, url: 'https://api.provider.ir/v1/send?x=1', body: { m: 1 }, relay: { base: `${base}/relay/`, token: 'tok' } });
  assert.equal(r.status, 200);
  const last = seen.at(-1);
  assert.equal(last.url, '/relay/api.provider.ir/v1/send?x=1');
  assert.equal(last.headers['x-relay-host'], 'api.provider.ir');
  assert.equal(last.headers['x-relay-key'], 'tok');
});

test('timeout and size cap', async () => {
  await assert.rejects(httpJson({ ...local, url: `${base}/slow`, timeoutMs: 50 }), e => e instanceof HttpRequestError && e.code === 'timeout');
  await assert.rejects(httpJson({ ...local, url: `${base}/big`, maxBytes: 1000 }), e => e.code === 'too_large');
});

test('URL policy: https by default, no credentials, private hosts refused', async () => {
  await assert.rejects(httpJson({ url: `${base}/x`, log: () => {} }), e => e.code === 'bad_url' && /https/.test(e.message));
  await assert.rejects(httpJson({ url: 'https://u:p@example.com/', log: () => {} }), e => e.code === 'bad_url');
  await assert.rejects(httpJson({ url: 'https://127.0.0.1/', log: () => {} }), e => e.code === 'bad_url' && /private/.test(e.message));
  await assert.rejects(httpJson({ url: 'https://10.1.2.3/', log: () => {} }), e => e.code === 'bad_url');
  await assert.rejects(httpJson({ url: 'not a url', log: () => {} }), e => e.code === 'bad_url');
});

test('isPrivateAddress: v4, v6, IPv4-mapped, NAT64, garbage', () => {
  const priv = ['127.0.0.1', '127.255.255.254', '0.0.0.0', '0.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1',
    '169.254.169.254', '100.64.0.1', '100.127.255.255', '192.0.0.8', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1',
    '224.0.0.1', '239.1.1.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::FFFF:10.0.0.1', '::ffff:a9fe:a9fe', '::ffff:100.64.0.1', '::127.0.0.1',
    '64:ff9b::7f00:1', '64:ff9b::10.0.0.1', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'ff02::1', '2001:db8::1',
    '[::1]', '[::ffff:127.0.0.1]', '', 'nope', 'example.com', '999.1.1.1'];
  for (const ip of priv) assert.equal(isPrivateAddress(ip), true, `${ip} is private`);
  const pub = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '11.0.0.1',
    '223.255.255.255', '192.0.3.1', '198.20.0.1', '2606:4700::1111', '2a00:1450:4001::1', '::ffff:8.8.8.8', '::ffff:808:808',
    '64:ff9b::808:808', 'fbff::1', 'fe00::1', 'fec0::1', '2001:db9::1'];
  for (const ip of pub) assert.equal(isPrivateAddress(ip), false, `${ip} is public`);
});

test('SSRF guard: literal private addresses in every notation are refused before any lookup', async () => {
  const urls = ['https://[::ffff:127.0.0.1]/', 'https://[::ffff:7f00:1]/', 'https://0.0.0.1/', 'https://100.64.0.1/',
    'https://169.254.169.254/latest/meta-data/', 'https://[::1]/', 'https://[fe80::1]/', 'https://[fd00::1]/', 'https://[64:ff9b::7f00:1]/',
    'https://127.1/', 'https://2130706433/', 'https://0x7f000001/', 'https://0/', 'https://localhost/', 'https://a.localhost/',
    'https://printer.local/', 'https://db.internal/', 'https://x.home.arpa/', 'https://224.0.0.1/', 'https://255.255.255.255/'];
  const lookup = async () => { throw new Error('lookup must not run for a literal address'); };
  for (const url of urls) {
    await assert.rejects(httpJson({ url, lookup, log: () => {} }), e => e instanceof HttpRequestError && e.code === 'bad_url' && /private/.test(e.message), url);
  }
});

test('SSRF guard: a public name that resolves to a private address is refused; a public one passes the check', async () => {
  const lines = [];
  const log = l => lines.push(l);
  const resolvesTo = (...addrs) => async (host, opts) => { assert.equal(opts.all, true); return addrs.map(address => ({ address, family: address.includes(':') ? 6 : 4 })); };
  await assert.rejects(httpJson({ url: 'https://127.0.0.1.nip.io/', lookup: resolvesTo('127.0.0.1'), log }), e => e.code === 'bad_url' && /private/.test(e.message));
  await assert.rejects(httpJson({ url: 'https://dual.example/', lookup: resolvesTo('93.184.216.34', '::ffff:10.0.0.1'), log }), e => e.code === 'bad_url', 'any private address poisons the set');
  await assert.rejects(httpJson({ url: 'https://empty.example/', lookup: resolvesTo(), log }), e => e.code === 'bad_url');
  assert.ok(lines.every(l => JSON.parse(l).error === 'bad_url' && !l.includes('nip.io')));
  // check passes → the request proceeds and fails on the network like any unreachable host, not as bad_url
  const seenHosts = [];
  const lookup = async host => { seenHosts.push(host); return [{ address: '93.184.216.34', family: 4 }]; };
  await assert.rejects(httpJson({ url: 'http://sysaiq-guard-test.invalid/', insecure: true, lookup, timeoutMs: 3000, log }), e => e.code !== 'bad_url');
  assert.deepEqual(seenHosts, ['sysaiq-guard-test.invalid']);
  // the resolver runs on the host, not on anything the URL carries
  await assert.rejects(httpJson({ url: 'https://u:p@127.0.0.1.nip.io/', lookup, log }), e => e.code === 'bad_url' && /credentials/.test(e.message));
});

test('relay: the relay base is what we connect to, so it is vetted (and private ones are refused)', async () => {
  const log = () => {};
  const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(httpJson({ url: 'https://api.provider.ir/v1', relay: { base: 'https://127.0.0.1/relay' }, lookup: publicLookup, log }), e => e.code === 'bad_url' && /private/.test(e.message));
  await assert.rejects(httpJson({ url: 'https://api.provider.ir/v1', relay: { base: 'https://[::ffff:7f00:1]/relay' }, lookup: publicLookup, log }), e => e.code === 'bad_url');
  await assert.rejects(httpJson({ url: 'https://api.provider.ir/v1', relay: { base: 'http://relay.example/' }, log }), e => e.code === 'bad_relay' && /https/.test(e.message));
  await assert.rejects(httpJson({ url: 'https://api.provider.ir/v1', relay: { base: 'not a url' }, log }), e => e.code === 'bad_relay');
  await assert.rejects(httpJson({ url: 'https://api.provider.ir/v1', relay: { base: 'https://u:p@relay.example/' }, log }), e => e.code === 'bad_relay');
  await assert.rejects(httpJson({ url: 'https://api.provider.ir/v1', relay: { base: '' }, log }), e => e.code === 'bad_relay');
  // a relay that resolves privately is refused even though the provider host is public
  const privateLookup = async () => [{ address: '10.0.0.5', family: 4 }];
  await assert.rejects(httpJson({ url: 'https://api.provider.ir/v1', relay: { base: 'https://relay.example/' }, lookup: privateLookup, log }), e => e.code === 'bad_url');
});

test('allowHosts pins the URL host to a fixed list', async () => {
  const r = await httpJson({ ...local, url: `${base}/pin`, allowHosts: ['127.0.0.1'] });
  assert.equal(r.status, 200);
  await assert.rejects(httpJson({ ...local, url: `${base}/pin`, allowHosts: ['api.zarinpal.com'] }), e => e.code === 'bad_url' && /allowlist/.test(e.message));
  await assert.rejects(httpJson({ ...local, url: `${base}/pin`, allowHosts: [] }), e => e.code === 'bad_url');
});

test('logs {provider, op, status, ms} only — never the URL or the key', async () => {
  const lines = [];
  await httpRequest({ ...local, url: `${base}/v1/send?apikey=KAVE-SECRET`, provider: 'kavenegar', op: 'send', log: l => lines.push(l) });
  assert.equal(lines.length, 1);
  const j = JSON.parse(lines[0]);
  assert.deepEqual(Object.keys(j).sort(), ['ms', 'op', 'provider', 'status']);
  assert.equal(j.provider, 'kavenegar');
  assert.equal(j.status, 200);
  assert.ok(!lines[0].includes('KAVE-SECRET'));
  // failure message uses redactUrl, never the raw URL
  const fail = await httpRequest({ ...local, url: `${base}/slow?apikey=KAVE-SECRET`, timeoutMs: 30, provider: 'kavenegar', op: 'send', redactUrl: () => '<redacted>', log: l => lines.push(l) }).catch(e => e);
  assert.ok(!fail.message.includes('KAVE-SECRET'));
  assert.ok(fail.message.includes('<redacted>'));
  assert.ok(!lines.join('\n').includes('KAVE-SECRET'));
  assert.equal(JSON.parse(lines.at(-1)).error, 'timeout');
});
