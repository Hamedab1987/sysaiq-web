// Outbound HTTP for provider adapters (payment gateways, SMS panels, news).
//   const r = await httpJson({ provider: 'zarinpal', op: 'request', url, method: 'POST', body: {...} });
//   r → { ok, status, headers, data (parsed JSON | null), text }
// - https only (opt out with insecure:true for local mocks), timeout,
//   response size cap.
// - SSRF guard: the host we connect to (the URL's, or the relay's) is
//   resolved with dns.lookup before fetch and refused when ANY address is
//   loopback / private / link-local / CGNAT / unspecified / multicast, in
//   IPv4, IPv6 or IPv4-mapped form. allowPrivate:true skips it (local
//   mocks). allowHosts:[…] additionally pins the URL host to a fixed list.
//   Residual risk: DNS rebinding between the check and the connect — fetch
//   resolves again and Node's fetch can't pin the address without undici.
// - relay-aware: pass relay:{base, token} and the request goes to
//   <base>/<host><path> with X-Relay-Key + X-Relay-Host headers — a locked
//   nginx map on an Iranian VPS forwards it (see master plan §5). The adapter
//   code does not change; only its relay config does.
// - logs exactly {provider, op, status, ms} — never URLs, bodies or headers,
//   because provider keys travel in URLs (Kavenegar) and headers.
//   `redactUrl(url)` is called only to build the error message of a failure.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

const DEFAULT_TIMEOUT = 15000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;

// names that never denote a provider, whatever they resolve to
const PRIVATE_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.home\.arpa)$/i;

export class HttpRequestError extends Error {
  constructor(code, message, extra = {}) {
    super(message);
    this.name = 'HttpRequestError';
    this.code = code;
    Object.assign(this, extra);
  }
}

// ---- address ranges --------------------------------------------------------
const v4ToInt = ip => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0);
const V4_BLOCKED = [
  ['0.0.0.0', 8],        // "this" network (0.0.0.1 reaches loopback on Linux)
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],    // CGNAT
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],   // link-local, cloud metadata
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],     // IETF protocol assignments
  ['192.0.2.0', 24],     // TEST-NET-1
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],    // benchmarking
  ['198.51.100.0', 24],  // TEST-NET-2
  ['203.0.113.0', 24],   // TEST-NET-3
  ['224.0.0.0', 3],      // multicast, reserved, broadcast
].map(([a, bits]) => [v4ToInt(a), bits]);

function isPrivateV4(ip) {
  const n = v4ToInt(ip);
  return V4_BLOCKED.some(([net, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(net / 2 ** (32 - bits)));
}

// → 8 groups as numbers; input must already be a valid IPv6 (net.isIP === 6)
function v6Groups(ip) {
  let s = ip.toLowerCase().replace(/%.*$/, '');
  const dotted = /^(.*:)(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const n = v4ToInt(dotted[2]);
    s = `${dotted[1]}${Math.floor(n / 65536).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.map(g => parseInt(g, 16));
}
const embeddedV4 = (a, b) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;

function isPrivateV6(ip) {
  const g = v6Groups(ip);
  const zeroTo = n => g.slice(0, n).every(x => x === 0);
  if (zeroTo(5) && g[5] === 0xffff) return isPrivateV4(embeddedV4(g[6], g[7]));   // ::ffff:a.b.c.d (IPv4-mapped)
  if (zeroTo(6)) return true;                                                      // ::, ::1, ::a.b.c.d (IPv4-compatible)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every(x => x === 0)) {
    return isPrivateV4(embeddedV4(g[6], g[7]));                                    // 64:ff9b::/96 (NAT64)
  }
  if ((g[0] & 0xfe00) === 0xfc00) return true;   // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true;   // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true;   // ff00::/8 multicast
  if (g[0] === 0x2001 && g[1] === 0xdb8) return true; // documentation
  return false;
}

// true for anything that must never be a provider address; unparsable → true
export function isPrivateAddress(ip) {
  const s = String(ip || '').replace(/^\[|\]$/g, '');
  const fam = isIP(s);
  if (fam === 4) return isPrivateV4(s);
  if (fam === 6) return isPrivateV6(s);
  return true;
}

function checkUrl(url, { insecure, allowPrivate, allowHosts }) {
  let u;
  try { u = new URL(String(url)); } catch { throw new HttpRequestError('bad_url', 'invalid URL'); }
  if (u.protocol !== 'https:' && !(insecure && u.protocol === 'http:')) {
    throw new HttpRequestError('bad_url', 'https required');
  }
  if (u.username || u.password) throw new HttpRequestError('bad_url', 'credentials in URL are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (Array.isArray(allowHosts) && !allowHosts.map(h => String(h).toLowerCase()).includes(host.toLowerCase())) {
    throw new HttpRequestError('bad_url', 'host not in allowlist');
  }
  if (!allowPrivate && (PRIVATE_NAME.test(host) || (isIP(host) && isPrivateAddress(host)))) {
    throw new HttpRequestError('bad_url', 'private host refused');
  }
  return u;
}

// the host we are about to open a socket to must not resolve anywhere private
async function checkResolved(hostname, lookup) {
  const host = hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) { if (isPrivateAddress(host)) throw new HttpRequestError('bad_url', 'private host refused'); return; }
  if (PRIVATE_NAME.test(host)) throw new HttpRequestError('bad_url', 'private host refused');
  const addrs = await lookup(host, { all: true });
  const list = Array.isArray(addrs) ? addrs : [addrs];
  if (!list.length || list.some(a => isPrivateAddress(a?.address))) {
    throw new HttpRequestError('bad_url', 'private host refused');
  }
}

// relay.base will come from admin config: it gets the same scheme /
// credential checks as a provider URL (the private-address check runs on
// its resolved host in httpRequest)
function relayTarget(u, relay, { insecure }) {
  const base = String(relay.base || '').replace(/\/+$/, '');
  if (!base) throw new HttpRequestError('bad_relay', 'relay.base missing');
  let b;
  try { b = new URL(base); } catch { throw new HttpRequestError('bad_relay', 'relay.base is not a URL'); }
  if (b.protocol !== 'https:' && !(insecure && b.protocol === 'http:')) throw new HttpRequestError('bad_relay', 'relay.base must be https');
  if (b.username || b.password) throw new HttpRequestError('bad_relay', 'credentials in relay.base are not allowed');
  const target = `${base}/${u.host}${u.pathname}${u.search}`;
  const headers = { 'x-relay-host': u.host };
  if (relay.token) headers[relay.header || 'x-relay-key'] = relay.token;
  return { target, headers, hostname: b.hostname };
}

async function readCapped(res, maxBytes) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { reader.cancel().catch(() => {}); throw new HttpRequestError('too_large', `response over ${maxBytes} bytes`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function httpRequest({
  url, method = 'GET', headers = {}, body, timeoutMs = DEFAULT_TIMEOUT, maxBytes = DEFAULT_MAX_BYTES,
  provider = 'http', op = method.toLowerCase(), redactUrl, relay = null, insecure = false, allowPrivate = false,
  allowHosts = null, lookup = dnsLookup, log = console.log,
} = {}) {
  const u = checkUrl(url, { insecure, allowPrivate, allowHosts });
  let target = u.href;
  let socketHost = u.hostname;
  const hdrs = {};
  for (const [k, v] of Object.entries(headers)) if (v !== undefined && v !== null) hdrs[k.toLowerCase()] = String(v);
  if (relay) {
    const r = relayTarget(u, relay, { insecure });
    target = r.target;
    socketHost = r.hostname;
    Object.assign(hdrs, r.headers);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  const describe = () => (typeof redactUrl === 'function' ? ` ${redactUrl(u.href)}` : '');
  try {
    // the socket goes to the relay when there is one, so that is the host to vet
    if (!allowPrivate) await checkResolved(socketHost, lookup);
    const res = await fetch(target, { method, headers: hdrs, body, signal: ctrl.signal, redirect: 'manual' });
    const text = await readCapped(res, maxBytes);
    let data = null;
    const ct = res.headers.get('content-type') || '';
    if (text && (ct.includes('json') || /^[[{]/.test(text.trimStart()))) { try { data = JSON.parse(text); } catch { data = null; } }
    log(JSON.stringify({ provider, op, status: res.status, ms: Date.now() - t0 }));
    return { ok: res.ok, status: res.status, headers: res.headers, data, text };
  } catch (e) {
    const ms = Date.now() - t0;
    const code = e instanceof HttpRequestError ? e.code : (e?.name === 'AbortError' ? 'timeout' : 'network');
    log(JSON.stringify({ provider, op, status: 0, error: code, ms }));
    if (e instanceof HttpRequestError) throw e;
    throw new HttpRequestError(code, `${provider}/${op} ${code}${describe()}`, { cause: e });
  } finally {
    clearTimeout(timer);
  }
}

// JSON in (object body), JSON out
export function httpJson(opts = {}) {
  const headers = { accept: 'application/json', ...(opts.headers || {}) };
  let body = opts.body;
  if (body !== undefined && body !== null && typeof body !== 'string') {
    headers['content-type'] = headers['content-type'] || 'application/json';
    body = JSON.stringify(body);
  }
  return httpRequest({ method: body !== undefined ? 'POST' : 'GET', ...opts, headers, body });
}

// application/x-www-form-urlencoded in (object or URLSearchParams), JSON/text out
export function httpForm(opts = {}) {
  const headers = { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded', ...(opts.headers || {}) };
  const src = opts.body || {};
  const body = src instanceof URLSearchParams ? src.toString() : new URLSearchParams(src).toString();
  return httpRequest({ method: 'POST', ...opts, headers, body });
}
