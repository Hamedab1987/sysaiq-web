// Provider adapters against a fake fetch: request shapes, key redaction,
// error mapping, credit parsing and delivery-status normalisation.
// lib/http.js has no fetch injection point, so globalThis.fetch is stubbed
// for this process and DNS is bypassed through the `lookup` option.
import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeHttp } from '../../src/sms/http.js';
import { SmsError } from '../../src/sms/errors.js';
import kavenegar, { redactUrl } from '../../src/sms/providers/kavenegar.js';
import smsir, { MAX_PARAM_CHARS } from '../../src/sms/providers/smsir.js';
import ghasedak from '../../src/sms/providers/ghasedak.js';
import ippanel, { lineE164 } from '../../src/sms/providers/ippanel.js';
import melipayamak from '../../src/sms/providers/melipayamak.js';
import mock from '../../src/sms/providers/mock.js';

const KEY = 'SECRET-KEY-a1b2c3d4e5f6';
const seen = [];
const logs = [];
let reply = () => ({ status: 200, body: {} });
const realFetch = globalThis.fetch;

before(() => {
  globalThis.fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const r = reply(String(url), init);
    const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
    return new Response(text, { status: r.status || 200, headers: { 'content-type': r.contentType || 'application/json' } });
  };
});
after(() => { globalThis.fetch = realFetch; });
beforeEach(() => { seen.length = 0; logs.length = 0; reply = () => ({ status: 200, body: {} }); });

const lookup = async () => [{ address: '5.6.7.8', family: 4 }];
const ctxFor = (p, extra = {}) => ({
  secret: KEY, sender: '10004346', username: 'user1',
  http: makeHttp({ provider: p.id, hosts: p.hosts, redactUrl: p.redactUrl, lookup, log: l => logs.push(l) }),
  log: l => logs.push(l),
  ...extra,
});
const last = () => seen.at(-1);
const form = () => Object.fromEntries(new URLSearchParams(last().body));
const json = () => JSON.parse(last().body);
const rejects = (p, code, extra) => assert.rejects(p, e => e instanceof SmsError && e.code === code && (!extra || extra(e)), `expected ${code}`);

// ---- Kavenegar -------------------------------------------------------------------
test('kavenegar: form-encoded send with the key in the path; log and errors never show the key', async () => {
  reply = () => ({ status: 200, body: { return: { status: 200, message: 'ok' }, entries: [{ messageid: 8123, cost: 140, status: 1 }] } });
  const r = await kavenegar.send(ctxFor(kavenegar), { to: '09121234567', text: 'سلام', sender: '10004346' });
  assert.deepEqual({ ok: r.ok, messageId: r.messageId, cost: r.cost }, { ok: true, messageId: '8123', cost: 140 });
  assert.equal(last().url, `https://api.kavenegar.com/v1/${KEY}/sms/send.json`);
  assert.equal(last().method, 'POST');
  assert.equal(last().headers['content-type'], 'application/x-www-form-urlencoded');
  assert.deepEqual(form(), { receptor: '09121234567', sender: '10004346', message: 'سلام' });
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(JSON.parse(logs[0])).sort(), ['ms', 'op', 'provider', 'status']);
  assert.ok(!logs.join('\n').includes(KEY));
  assert.equal(redactUrl(last().url), 'https://api.kavenegar.com/v1/***/sms/send.json');
  // transport failure: the message goes through redactUrl
  const stub = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('fetch failed'); };
  try {
    await rejects(kavenegar.send(ctxFor(kavenegar), { to: '09121234567', text: 'x' }), 'network', e => !e.message.includes(KEY) && e.message.includes('***') && e.retriable);
  } finally { globalThis.fetch = stub; }
  assert.ok(!logs.join('\n').includes(KEY));
});

test('kavenegar: lookup (pattern) maps variables to token slots and reads the object-shaped entries', async () => {
  reply = () => ({ status: 200, body: { return: { status: 200 }, entries: { messageid: 55, cost: 100 } } });
  const r = await kavenegar.sendPattern(ctxFor(kavenegar), { to: '09121234567', template: { template: 'sq-lead', tokens: { code: 'token10' } }, params: { name: 'سارا  احمدی', code: 'abc def' } });
  assert.equal(r.messageId, '55');
  assert.equal(last().url, `https://api.kavenegar.com/v1/${KEY}/verify/lookup.json`);
  assert.deepEqual(form(), { receptor: '09121234567', template: 'sq-lead', token: 'سارا احمدی', token10: 'abc def' });

  // an explicitly claimed default slot is skipped by the declaration-order fill (no silent overwrite)
  await kavenegar.sendPattern(ctxFor(kavenegar), { to: '09121234567', template: { template: 'sq', tokens: { b: 'token' } }, params: { a: '1', b: '2', c: '3' } });
  assert.deepEqual(form(), { receptor: '09121234567', template: 'sq', token: '2', token2: '1', token3: '3' });

  // a 4-variable system template with a full map sends all four; without one the 4th has no slot
  const four = { id: '12', name: 'سارا احمدی', phone: '+989121112233', service: 'AI agent' };
  await kavenegar.sendPattern(ctxFor(kavenegar), { to: '09121234567', template: { template: 'sq-owner', tokens: { id: 'token', phone: 'token2', name: 'token10', service: 'token20' } }, params: four });
  assert.deepEqual(form(), { receptor: '09121234567', template: 'sq-owner', token: '12', token2: '+989121112233', token10: 'سارا احمدی', token20: 'AI agent' });
  const calls = seen.length;
  await rejects(kavenegar.sendPattern(ctxFor(kavenegar), { to: '09121234567', template: { template: 'sq-owner' }, params: four }), 'validation', e => !e.retriable && /service/.test(e.message) && /token10/.test(e.message));
  assert.equal(seen.length, calls, 'refused before any request');
});

test('kavenegar: validateMap refuses a map that would fail at send time (more than 3 variables without a full tokens map, duplicate or bogus slots)', () => {
  const vars4 = ['id', 'name', 'phone', 'service'];
  assert.equal(kavenegar.validateMap({ template: 'sq-owner', tokens: { id: 'token', phone: 'token2', name: 'token10', service: 'token20' } }, { variables: vars4 }), null);
  assert.equal(kavenegar.validateMap({ template: 'sq-lead' }, { variables: ['name'] }), null, 'up to three variables need no map');
  assert.equal(kavenegar.validateMap({ template: 'sq-lead' }), null, 'no variables known → only the shape is checked');
  const plain = kavenegar.validateMap({ template: 'sq-owner' }, { variables: vars4 });
  assert.match(plain, /token10/);
  assert.match(plain, /۴ متغیر/, 'Persian digits');
  assert.match(plain, /id, name, phone, service/);
  const partial = kavenegar.validateMap({ template: 'sq-owner', tokens: { name: 'token10' } }, { variables: vars4 });
  assert.match(partial, /id, phone, service/);
  assert.match(kavenegar.validateMap({ template: 'x', tokens: { a: 'token', b: 'token' } }, { variables: ['a', 'b'] }), /بیش از یک متغیر/);
  assert.match(kavenegar.validateMap({ template: 'x', tokens: { a: 'token4' } }), /token4/);
  assert.match(kavenegar.validateMap({ template: 'x', tokens: [] }), /شیء/);
  assert.match(kavenegar.validateMap({ tokens: {} }), /نام الگو/);
  assert.match(kavenegar.validateMap({ template: 'x' }, { variables: ['a', 'b', 'c', 'd', 'e', 'f'] }), /حداکثر ۵ متغیر/);
  assert.ok(kavenegar.mapHelp.fa.includes('token10') && kavenegar.mapHelp.en.includes('token10'));
});

test('kavenegar: error mapping (418 credit → retriable, 403 key → not, 411 receptor → not), credit, status', async () => {
  reply = () => ({ status: 418, body: { return: { status: 418, message: 'اعتبار کافی نیست' } } });
  await rejects(kavenegar.send(ctxFor(kavenegar), { to: '09121234567', text: 'x' }), 'no_credit', e => e.retriable && e.detail.includes('418'));
  reply = () => ({ status: 403, body: { return: { status: 403, message: 'invalid api key' } } });
  await rejects(kavenegar.send(ctxFor(kavenegar), { to: '09121234567', text: 'x' }), 'auth', e => !e.retriable);
  reply = () => ({ status: 411, body: { return: { status: 411, message: 'receptor invalid' } } });
  await rejects(kavenegar.send(ctxFor(kavenegar), { to: '0912', text: 'x' }), 'bad_mobile', e => !e.retriable);
  reply = () => ({ status: 502, body: 'bad gateway', contentType: 'text/html' });
  await rejects(kavenegar.send(ctxFor(kavenegar), { to: '09121234567', text: 'x' }), 'server_error', e => e.retriable);
  await rejects(kavenegar.send(ctxFor(kavenegar, { secret: '' }), { to: '09121234567', text: 'x' }), 'not_configured');

  reply = () => ({ status: 200, body: { return: { status: 200 }, entries: { remaincredit: 123456, expiredate: 0, type: 'x' } } });
  assert.deepEqual((({ amount, unit }) => ({ amount, unit }))(await kavenegar.credit(ctxFor(kavenegar))), { amount: 123456, unit: 'rial' });
  assert.equal(last().url, `https://api.kavenegar.com/v1/${KEY}/account/info.json`);

  for (const [code, state] of [[10, 'delivered'], [11, 'undelivered'], [4, 'sent'], [1, 'queued'], [14, 'blocked'], [6, 'failed'], [77, 'unknown']]) {
    reply = () => ({ status: 200, body: { return: { status: 200 }, entries: [{ messageid: 8123, status: code }] } });
    assert.equal((await kavenegar.status(ctxFor(kavenegar), { messageId: '8123' })).state, state, `status ${code}`);
    assert.deepEqual(form(), { messageid: '8123' });
  }
});

// ---- SMS.ir ---------------------------------------------------------------------------
test('smsir: bulk send with X-API-KEY, numeric lineNumber, mobiles array', async () => {
  reply = () => ({ status: 200, body: { status: 1, message: 'ok', data: { packId: 'p1', messageIds: [9001], cost: 1.5 } } });
  const r = await smsir.send(ctxFor(smsir, { sender: '30007732' }), { to: '09121234567', text: 'hi' });
  assert.deepEqual({ messageId: r.messageId, cost: r.cost }, { messageId: '9001', cost: 1.5 });
  assert.equal(last().url, 'https://api.sms.ir/v1/send/bulk');
  assert.equal(last().headers['x-api-key'], KEY);
  assert.equal(last().headers['content-type'], 'application/json');
  assert.deepEqual(json(), { lineNumber: 30007732, messageText: 'hi', mobiles: ['09121234567'] });
});

test('smsir: verify (pattern) sends a parameters array; long free text is shortened to 25 chars, long codes/numbers are refused before calling', async () => {
  reply = () => ({ status: 200, body: { status: 1, data: { messageId: 42, cost: 1 } } });
  const r = await smsir.sendPattern(ctxFor(smsir), { to: '09121234567', template: { templateId: '123456', params: { code: 'CODE' } }, params: { name: 'سارا', code: 'a1b2c3d4e5f6' } });
  assert.equal(r.messageId, '42');
  assert.equal(last().url, 'https://api.sms.ir/v1/send/verify');
  assert.deepEqual(json(), { mobile: '09121234567', templateId: 123456, parameters: [{ name: 'name', value: 'سارا' }, { name: 'CODE', value: 'a1b2c3d4e5f6' }] });
  assert.ok(!('key' in json().parameters[0]), 'our variable key never reaches the provider');

  // a 30-char customer name is shortened to 24 chars + «…» (25 total) and the send goes through
  const longName = 'محمدرضا عبدالحسین‌زادهٔ قزوینی';
  assert.equal([...longName].length, 30);
  const t = await smsir.sendPattern(ctxFor(smsir), { to: '09121234567', template: { templateId: 1, params: { name: 'NAME' } }, params: { name: longName, code: 'a1b2c3d4e5f6' } });
  assert.equal(t.messageId, '42');
  const sentName = json().parameters[0].value;
  assert.ok([...sentName].length <= MAX_PARAM_CHARS && [...sentName].length >= MAX_PARAM_CHARS - 2, sentName);
  assert.ok(sentName.endsWith('…') && longName.startsWith(sentName.slice(0, -1)), sentName);
  assert.ok(!sentName.endsWith(' …'), 'no dangling space before the ellipsis');
  assert.equal(json().parameters[1].value, 'a1b2c3d4e5f6', 'the code is untouched');
  // exactly 25 chars is sent as is
  await smsir.sendPattern(ctxFor(smsir), { to: '09121234567', template: { templateId: 1 }, params: { name: 'n'.repeat(MAX_PARAM_CHARS) } });
  assert.equal(json().parameters[0].value, 'n'.repeat(MAX_PARAM_CHARS));

  // identifiers must never be cut: refused, no request made, the log names our variable
  const calls = seen.length;
  for (const key of ['code', 'number', 'amount', 'ref', 'phone', 'topic']) {
    await rejects(smsir.sendPattern(ctxFor(smsir), { to: '09121234567', template: { templateId: 1 }, params: { [key]: 'x'.repeat(MAX_PARAM_CHARS + 1) } }), 'validation', e => !e.retriable && e.message.includes(`"${key}"`));
  }
  assert.equal(seen.length, calls, 'no request was made');
  assert.equal(smsir.validateMap({ templateId: 5, params: ['x'] }), 'params باید یک شیء باشد');
});

test('smsir: status codes 102 → no_credit (retriable), 115 → blacklisted, 10 → auth, 20 → rate_limited; credit; deliveryState', async () => {
  const cases = [[102, 'no_credit', true], [115, 'blacklisted', false], [10, 'auth', false], [20, 'rate_limited', true], [113, 'template', false], [104, 'bad_mobile', false]];
  for (const [status, code, retriable] of cases) {
    reply = () => ({ status: 200, body: { status, message: `err ${status}`, data: null } });
    await rejects(smsir.send(ctxFor(smsir), { to: '09121234567', text: 'x' }), code, e => e.retriable === retriable);
  }
  reply = () => ({ status: 401, body: 'Unauthorized', contentType: 'text/plain' });
  await rejects(smsir.send(ctxFor(smsir), { to: '09121234567', text: 'x' }), 'auth');

  reply = () => ({ status: 200, body: { status: 1, data: 8500 } });
  const c = await smsir.credit(ctxFor(smsir));
  assert.deepEqual({ amount: c.amount, unit: c.unit }, { amount: 8500, unit: 'credit' });
  assert.equal(last().url, 'https://api.sms.ir/v1/credit');
  assert.equal(last().method, 'GET');

  for (const [ds, state] of [[1, 'delivered'], [2, 'undelivered'], [3, 'sent'], [5, 'sent'], [6, 'failed'], [7, 'blocked'], [9, 'unknown']]) {
    reply = () => ({ status: 200, body: { status: 1, data: { deliveryState: ds } } });
    assert.equal((await smsir.status(ctxFor(smsir), { messageId: '9001' })).state, state);
    assert.equal(last().url, 'https://api.sms.ir/v1/send/9001');
  }
});

// ---- Ghasedak ---------------------------------------------------------------------------
test('ghasedak: ApiKey header, SendSingleSMS body, SendOtpSMS receptors/inputs, case-tolerant response', async () => {
  reply = () => ({ status: 200, body: { IsSuccess: true, StatusCode: 200, Message: 'ok', Data: { Items: [{ MessageId: 777, Cost: 90 }] } } });
  const r = await ghasedak.send(ctxFor(ghasedak), { to: '09121234567', text: 'hi', sender: '10008566' });
  assert.deepEqual({ messageId: r.messageId, cost: r.cost }, { messageId: '777', cost: 90 });
  assert.equal(last().url, 'https://gateway.ghasedak.me/rest/api/v1/WebService/SendSingleSMS');
  assert.equal(last().headers.apikey, KEY);
  const b = json();
  assert.equal(b.lineNumber, '10008566');
  assert.equal(b.receptor, '09121234567');
  assert.equal(b.message, 'hi');
  assert.match(b.clientReferenceId, /^sq-\d+$/);

  reply = () => ({ status: 200, body: { isSuccess: true, statusCode: 200, data: { items: [{ messageId: 778 }] } } });
  const p = await ghasedak.sendPattern(ctxFor(ghasedak), { to: '09121234567', template: { templateName: 'sq-lead', inputs: { name: 'Name' } }, params: { name: 'سارا', code: 'k1' } });
  assert.equal(p.messageId, '778');
  assert.equal(last().url, 'https://gateway.ghasedak.me/rest/api/v1/WebService/SendOtpSMS');
  const pb = json();
  assert.equal(pb.templateName, 'sq-lead');
  assert.equal(pb.receptors.length, 1);
  assert.equal(pb.receptors[0].mobile, '09121234567');
  assert.deepEqual(pb.inputs, [{ param: 'Name', value: 'سارا' }, { param: 'code', value: 'k1' }]);

  reply = () => ({ status: 401, body: { isSuccess: false, statusCode: 401, message: 'Unauthorized' } });
  await rejects(ghasedak.send(ctxFor(ghasedak), { to: '09121234567', text: 'x' }), 'auth');
  reply = () => ({ status: 200, body: { isSuccess: false, statusCode: 402, message: 'credit' } });
  await rejects(ghasedak.send(ctxFor(ghasedak), { to: '09121234567', text: 'x' }), 'no_credit', e => e.retriable);

  reply = () => ({ status: 200, body: { isSuccess: true, data: { credit: 250000 } } });
  assert.equal((await ghasedak.credit(ctxFor(ghasedak))).amount, 250000);
  assert.equal(last().url, 'https://gateway.ghasedak.me/rest/api/v1/WebService/GetAccountInformation');

  for (const [code, state] of [[5, 'delivered'], [4, 'undelivered'], [3, 'sent'], [2, 'blocked'], [1, 'failed'], [0, 'queued']]) {
    reply = () => ({ status: 200, body: { isSuccess: true, data: { items: [{ status: code }] } } });
    assert.equal((await ghasedak.status(ctxFor(ghasedak), { messageId: '777' })).state, state);
    assert.equal(last().url, 'https://gateway.ghasedak.me/rest/api/v1/WebService/CheckSmsStatus?Ids=777&Type=1');
  }
});

// ---- IPPanel Edge ----------------------------------------------------------------------------
test('ippanel: E.164 single recipient, Authorization header, webservice vs pattern bodies, meta codes, credit', async () => {
  assert.equal(lineE164('3000505'), '+983000505');
  assert.equal(lineE164('03000505'), '+983000505');
  assert.equal(lineE164('+98 3000-505'), '+983000505');
  assert.equal(lineE164('983000505'), '+983000505');

  reply = () => ({ status: 200, body: { data: { message_id: 3101 }, meta: { status: true, message: 'ok', message_code: '200-1' } } });
  const r = await ippanel.send(ctxFor(ippanel, { sender: '3000505' }), { to: '۰۹۱۲ ۳۴۵ ۶۷۸۹', text: 'hi' });
  assert.equal(r.messageId, '3101');
  assert.equal(last().url, 'https://edge.ippanel.com/v1/api/send');
  assert.equal(last().headers.authorization, KEY);
  assert.deepEqual(json(), { sending_type: 'webservice', from_number: '+983000505', message: 'hi', params: { recipients: ['+989123456789'] } });

  const p = await ippanel.sendPattern(ctxFor(ippanel, { sender: '+983000505' }), { to: '09121234567', template: { code: 'ptn1', params: { name: 'customer' } }, params: { name: 'سارا', code: 'k' } });
  assert.equal(p.messageId, '3101');
  assert.deepEqual(json(), { sending_type: 'pattern', from_number: '+983000505', code: 'ptn1', recipients: ['+989121234567'], params: { customer: 'سارا', code: 'k' } });

  await rejects(ippanel.send(ctxFor(ippanel), { to: '02833323002', text: 'x' }), 'bad_mobile');
  reply = () => ({ status: 401, body: { data: null, meta: { status: false, message: 'unauthorized', message_code: '400-1' } } });
  await rejects(ippanel.send(ctxFor(ippanel), { to: '09121234567', text: 'x' }), 'auth', e => !e.retriable && e.detail.includes('400-1'));
  reply = () => ({ status: 400, body: { data: null, meta: { status: false, message: 'bad', message_code: '400-2' } } });
  await rejects(ippanel.send(ctxFor(ippanel), { to: '09121234567', text: 'x' }), 'validation');
  reply = () => ({ status: 200, body: { data: { credit: 4200.5 }, meta: { status: true, message_code: '200-1' } } });
  assert.equal((await ippanel.credit(ctxFor(ippanel))).amount, 4200.5);
  assert.equal(last().url, 'https://edge.ippanel.com/v1/api/payment/credit/mine');
  assert.equal(ippanel.supportsStatus, false);
});

// ---- Melipayamak --------------------------------------------------------------------------------
test('melipayamak: form fields username/password/to/from/text/isFlash; BaseServiceNumber joins with ;', async () => {
  reply = () => ({ status: 200, body: { Value: '1234567890123', RetStatus: 1, StrRetStatus: 'Ok' } });
  const r = await melipayamak.send(ctxFor(melipayamak), { to: '09121234567', text: 'hi', sender: '50004000' });
  assert.equal(r.messageId, '1234567890123');
  assert.equal(last().url, 'https://rest.payamak-panel.com/api/SendSMS/SendSMS');
  assert.deepEqual(form(), { username: 'user1', password: KEY, to: '09121234567', from: '50004000', text: 'hi', isFlash: 'false' });

  const p = await melipayamak.sendPattern(ctxFor(melipayamak), { to: '09121234567', template: { bodyId: 9876, order: ['code', 'name'] }, params: { name: 'سارا;احمدی', code: 'k1' } });
  assert.equal(p.messageId, '1234567890123');
  assert.equal(last().url, 'https://rest.payamak-panel.com/api/SendSMS/BaseServiceNumber');
  assert.deepEqual(form(), { username: 'user1', password: KEY, to: '09121234567', bodyId: '9876', text: 'k1;سارا،احمدی' });

  reply = () => ({ status: 200, body: { Value: '2', RetStatus: 0, StrRetStatus: 'NotEnoughCredit' } });
  await rejects(melipayamak.send(ctxFor(melipayamak), { to: '09121234567', text: 'x' }), 'no_credit');
  reply = () => ({ status: 200, body: { Value: '0', RetStatus: 0, StrRetStatus: 'InvalidUser' } });
  await rejects(melipayamak.send(ctxFor(melipayamak), { to: '09121234567', text: 'x' }), 'auth');
  await rejects(melipayamak.send(ctxFor(melipayamak, { username: '' }), { to: '09121234567', text: 'x' }), 'not_configured');

  reply = () => ({ status: 200, body: { Value: '312.5', RetStatus: 1, StrRetStatus: 'Ok' } });
  const c = await melipayamak.credit(ctxFor(melipayamak));
  assert.deepEqual({ amount: c.amount, unit: c.unit }, { amount: 312.5, unit: 'sms' });
  assert.deepEqual(form(), { username: 'user1', password: KEY });

  for (const [code, state] of [[1, 'delivered'], [2, 'undelivered'], [8, 'sent'], [16, 'undelivered'], [99, 'unknown']]) {
    reply = () => ({ status: 200, body: { Value: String(code), RetStatus: 1, StrRetStatus: 'Ok' } });
    assert.equal((await melipayamak.status(ctxFor(melipayamak), { messageId: '1234567890123' })).state, state);
    assert.deepEqual(form(), { username: 'user1', password: KEY, recId: '1234567890123' });
  }
});

// ---- SSRF / host pinning + mock ------------------------------------------------------------------
test('adapters only ever talk to their own host; a private relay is refused', async () => {
  const ctx = ctxFor(kavenegar);
  await rejects(ctx.http.json({ op: 'x', url: 'https://evil.example/v1' }), 'bad_response', e => /allowlist/.test(e.message));
  const relayed = makeHttp({ provider: 'kavenegar', hosts: kavenegar.hosts, relay: { base: 'https://127.0.0.1/relay', token: 't' }, lookup, log: () => {} });
  await rejects(relayed.json({ op: 'x', url: 'https://api.kavenegar.com/v1/k/x' }), 'bad_response', e => /private/.test(e.message));
});

test('mock provider: deterministic ids, simulated outage/bad number, status by tail, no number in its log line', async () => {
  mock._reset();
  const lines = [];
  const ctx = { log: l => lines.push(l) };
  const a = await mock.send(ctx, { to: '09121234567', text: 'x' });
  assert.equal(a.messageId, 'mock-1-4567');
  assert.ok(!lines.join('').includes('0912'));
  await rejects(mock.send(ctx, { to: '09120000000', text: 'x' }), 'server_error', e => e.retriable);
  await rejects(mock.send(ctx, { to: '09129999999', text: 'x' }), 'bad_mobile', e => !e.retriable);
  await rejects(mock.send(ctx, { to: '09121234567', text: '  ' }), 'empty_text');
  assert.equal((await mock.status(ctx, { messageId: 'mock-1-4567' })).state, 'delivered');
  assert.equal((await mock.status(ctx, { messageId: 'mock-2-1111' })).state, 'undelivered');
  assert.equal((await mock.credit(ctx)).amount, 1000);
});
