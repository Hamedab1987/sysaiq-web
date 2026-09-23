// Gateway adapters against a fake fetch: request shapes, wire units (Rial ×10
// for Zarinpal/Zibal, Toman for PayPing), redirect URLs built from constants,
// callback parsing, verify outcomes incl. the "already verified" codes, and
// the production registry refusing the mock. No app, no db.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { toWire, fromWire, redact, maskedPan } from '../../src/payments/gateways/common.js';
import zarinpal from '../../src/payments/gateways/zarinpal.js';
import payping from '../../src/payments/gateways/payping.js';
import zibal from '../../src/payments/gateways/zibal.js';
import mock, { settle, reset } from '../../src/payments/gateways/mock.js';
import { gateways, getGateway, hasGateway } from '../../src/payments/registry.js';

const MERCHANT = '12345678-1234-1234-1234-123456789abc';
const SECRETS = { 'gw.zarinpal.merchant_id': MERCHANT, 'gw.payping.token': 'pp-token-xyz', 'gw.zibal.merchant': 'zb-merchant' };
function ctxWith(responses, cfg = {}) {
  const calls = [];
  const fetch = async opts => {
    calls.push(opts);
    const r = typeof responses === 'function' ? responses(opts, calls.length) : responses[calls.length - 1];
    return { ok: (r.status || 200) < 400, status: r.status || 200, data: r.data ?? null, text: r.text ?? JSON.stringify(r.data ?? null), headers: new Map() };
  };
  return { ctx: { config: cfg, secret: n => SECRETS[n] ?? null, fetch, relay: null, log: () => {} }, calls };
}
const CB = 'https://sysaiq.com/api/pay/callback/x?p=7';

test('toWire is the only ×10: Rial for IRR, Toman for IRT; rejects bad amounts', () => {
  assert.equal(toWire(12500, 'IRR'), 125000);
  assert.equal(toWire(12500, 'IRT'), 12500);
  assert.equal(fromWire(125000, 'IRR'), 12500);
  assert.throws(() => toWire(0, 'IRR'), /positive/);
  assert.throws(() => toWire(12.5, 'IRT'), /positive/);
  assert.throws(() => toWire(1000, 'USD'), /unit/);
});

test('redact drops card / personal / credential keys; maskedPan never stores a full PAN', () => {
  const r = redact({ code: 100, card_pan: '6037991234567890', mobile: '0912', merchant_id: 'x', nested: { authorization: 'Bearer', ref_id: 5 } });
  assert.deepEqual(r, { code: 100, nested: { ref_id: 5 } });
  assert.equal(maskedPan('6037991234567890'), '603799******7890');
  assert.equal(maskedPan('603799******1234'), '603799******1234');
});

test('zarinpal: create sends Rial + currency IRR + merchant + metadata; redirect from constants', async () => {
  const { ctx, calls } = ctxWith([{ data: { data: { code: 100, message: 'ok', authority: 'A' + '0'.repeat(35), fee: 5000 }, errors: [] } }]);
  const r = await zarinpal.create(ctx, { amountToman: 12500, callbackUrl: CB, description: 'SQ-1405-0001', mobile: '09123456789', email: 'a@b.co', orderId: 'SQ-1405-0001-7' });
  assert.equal(calls[0].url, 'https://payment.zarinpal.com/pg/v4/payment/request.json');
  assert.deepEqual(calls[0].body, { merchant_id: MERCHANT, amount: 125000, currency: 'IRR', description: 'SQ-1405-0001', callback_url: CB, metadata: { mobile: '09123456789', email: 'a@b.co', order_id: 'SQ-1405-0001-7' } });
  assert.deepEqual(calls[0].allowHosts, ['payment.zarinpal.com']);
  assert.equal(r.ok, true);
  assert.equal(r.redirectUrl, `https://payment.zarinpal.com/pg/StartPay/A${'0'.repeat(35)}`);
  assert.equal(r.feeToman, 500);
  // sandbox flips the host; a malformed authority is refused even with code 100
  const s = ctxWith([{ data: { data: { code: 100, authority: 'bad' } } }], { sandbox: true });
  const r2 = await zarinpal.create(s.ctx, { amountToman: 1000, callbackUrl: CB, orderId: 'x' });
  assert.equal(s.calls[0].url, 'https://sandbox.zarinpal.com/pg/v4/payment/request.json');
  assert.equal(r2.ok, false);
  const e = ctxWith([{ status: 400, data: { data: [], errors: { code: -41, message: 'too big' } } }]);
  const r3 = await zarinpal.create(e.ctx, { amountToman: 1000, callbackUrl: CB, orderId: 'x' });
  assert.deepEqual([r3.ok, r3.code, r3.message], [false, '-41', 'too big']);
});

test('zarinpal: callback parse + verify (100 ok, 101 already verified, -51 fail) with the DB amount in Rial', async () => {
  const auth = 'S' + 'b'.repeat(35);
  assert.deepEqual(zarinpal.parseCallback({ query: { Authority: auth, Status: 'OK' } }), { authority: auth, outcome: 'ok', extra: {} });
  assert.equal(zarinpal.parseCallback({ query: { Authority: auth, Status: 'NOK' } }).outcome, 'cancelled');
  assert.equal(zarinpal.parseCallback({ query: { Authority: 'nope', Status: 'OK' } }).authority, '');
  const { ctx, calls } = ctxWith([
    { data: { data: { code: 100, ref_id: 987654, card_pan: '603799******1234', card_hash: 'H', fee: 5000 }, errors: [] } },
    { data: { data: { code: 101, ref_id: 987654 }, errors: [] } },
    { data: { data: [], errors: { code: -51, message: 'failed' } } },
  ]);
  const v1 = await zarinpal.verify(ctx, { authority: auth, amountToman: 12500 });
  assert.deepEqual(calls[0].body, { merchant_id: MERCHANT, amount: 125000, authority: auth });
  assert.deepEqual([v1.ok, v1.alreadyVerified, v1.refId, v1.cardPan, v1.feeToman], [true, false, '987654', '603799******1234', 500]);
  const v2 = await zarinpal.verify(ctx, { authority: auth, amountToman: 12500 });
  assert.deepEqual([v2.ok, v2.alreadyVerified, v2.code], [true, true, '101']);
  const v3 = await zarinpal.verify(ctx, { authority: auth, amountToman: 12500 });
  assert.deepEqual([v3.ok, v3.code], [false, '-51']);
  const inq = ctxWith([{ data: { data: { code: 100, status: 'PAID' } } }]);
  assert.equal((await zarinpal.inquire(inq.ctx, { authority: auth })).state, 'paid_unverified');
});

test('payping: Toman on the wire, Bearer auth, clientRefId; POST callback with JSON data; verify 200 / 409+110 / 202', async () => {
  const { ctx, calls } = ctxWith([{ data: { paymentCode: 'abc123' } }]);
  const r = await payping.create(ctx, { amountToman: 12500, callbackUrl: CB, description: 'd', mobile: '09123456789', orderId: 'SQ-1405-0001-7', payerName: 'Sara' });
  assert.equal(calls[0].url, 'https://api.payping.ir/v3/pay');
  assert.equal(calls[0].headers.authorization, 'Bearer pp-token-xyz');
  assert.deepEqual(calls[0].body, { amount: 12500, returnUrl: CB, clientRefId: 'SQ-1405-0001-7', payerIdentity: '09123456789', payerName: 'Sara', description: 'd' });
  assert.equal(r.redirectUrl, 'https://api.payping.ir/v3/pay/start/abc123');
  const cb = payping.parseCallback({ body: { status: '1', data: JSON.stringify({ clientRefId: 'SQ-1405-0001-7', paymentCode: 'abc123', paymentRefId: 'R1', amount: 12500, cardNumber: '6037991234567890' }) } });
  assert.deepEqual([cb.authority, cb.outcome, cb.extra.paymentRefId, cb.extra.cardNumber], ['abc123', 'ok', 'R1', '603799******7890']);
  assert.equal(payping.parseCallback({ body: { status: '0', errorCode: '2', data: '{}' } }).outcome, 'failed');
  const v = ctxWith([
    { data: { paymentRefId: 'R1', amount: 12500, clientRefId: 'SQ-1405-0001-7', cardNumber: '603799******7890' } },
    { status: 409, data: { metaData: { code: 110 } } },
    { status: 202, data: {} },
    { status: 401, data: {} },
  ]);
  const v1 = await payping.verify(v.ctx, { authority: 'abc123', amountToman: 12500, extra: cb.extra });
  assert.deepEqual(v.calls[0].body, { paymentRefId: 'R1', paymentCode: 'abc123', amount: 12500 });
  assert.deepEqual([v1.ok, v1.amountToman, v1.orderIdEcho, v1.refId], [true, 12500, 'SQ-1405-0001-7', 'R1']);
  const v2 = await payping.verify(v.ctx, { authority: 'abc123', amountToman: 12500, extra: cb.extra });
  assert.deepEqual([v2.ok, v2.alreadyVerified], [true, true]);
  const v3 = await payping.verify(v.ctx, { authority: 'abc123', amountToman: 12500, extra: cb.extra });
  assert.deepEqual([v3.ok, v3.pending], [false, true]);
  const v4 = await payping.verify(v.ctx, { authority: 'abc123', amountToman: 12500, extra: cb.extra });
  assert.deepEqual([v4.ok, v4.pending, v4.code], [false, false, '401']);
  assert.equal((await payping.verify(v.ctx, { authority: 'abc123', amountToman: 12500, extra: {} })).code, 'no_ref');
});

test('zibal: Rial on the wire, trackId as authority, verify 100 / 201 / 202, sandbox merchant "zibal"', async () => {
  const { ctx, calls } = ctxWith([{ data: { result: 100, trackId: 123456789 } }]);
  const r = await zibal.create(ctx, { amountToman: 12500, callbackUrl: CB, description: 'd', mobile: '09123456789', orderId: 'SQ-1405-0001-7' });
  assert.equal(calls[0].url, 'https://gateway.zibal.ir/v1/request');
  assert.deepEqual(calls[0].body, { merchant: 'zb-merchant', amount: 125000, callbackUrl: CB, orderId: 'SQ-1405-0001-7', description: 'd', mobile: '09123456789' });
  assert.deepEqual([r.ok, r.authority, r.redirectUrl], [true, '123456789', 'https://gateway.zibal.ir/start/123456789']);
  const cb = zibal.parseCallback({ query: { trackId: '123456789', success: '1', status: '2', orderId: 'SQ-1405-0001-7' } });
  assert.deepEqual([cb.authority, cb.outcome, cb.extra.orderId], ['123456789', 'ok', 'SQ-1405-0001-7']);
  assert.equal(zibal.parseCallback({ query: { trackId: '123456789', success: '0' } }).outcome, 'cancelled');
  const v = ctxWith([
    { data: { result: 100, amount: 125000, refNumber: 55, cardNumber: '603799******1234', orderId: 'SQ-1405-0001-7' } },
    { data: { result: 201 } },
    { data: { result: 202, message: 'unpaid' } },
  ], { sandbox: true });
  const v1 = await zibal.verify(v.ctx, { authority: '123456789', amountToman: 12500 });
  assert.deepEqual(v.calls[0].body, { merchant: 'zibal', trackId: 123456789 });
  assert.deepEqual([v1.ok, v1.amountToman, v1.refId, v1.orderIdEcho], [true, 12500, '55', 'SQ-1405-0001-7']);
  assert.deepEqual([(await zibal.verify(v.ctx, { authority: '123456789' })).alreadyVerified, (await zibal.verify(v.ctx, { authority: '123456789' })).ok], [true, false]);
  const inq = ctxWith([{ data: { result: 100, status: 2 } }, { data: { result: 100, status: -1 } }]);
  assert.equal((await zibal.inquire(inq.ctx, { authority: '1' })).state, 'paid_unverified');
  assert.equal((await zibal.inquire(inq.ctx, { authority: '1' })).state, 'pending');
  const t = ctxWith([{ data: { result: 203 } }]);
  assert.equal((await zibal.test(t.ctx)).ok, true);
});

test('mock: verify answers from the bank decision, never from the callback status; second verify = already verified', async () => {
  reset();
  const r = await mock.create({}, { amountToman: 5000, orderId: 'o-1', callbackUrl: CB });
  assert.match(r.authority, /^M[0-9a-f]{32}$/);
  assert.equal(r.redirectUrl, `/api/pay/mock/bank?authority=${r.authority}`);
  const cb = mock.parseCallback({ query: { authority: r.authority, status: 'ok' } });
  assert.deepEqual([cb.authority, cb.outcome], [r.authority, 'ok']);
  const v0 = await mock.verify({}, { authority: r.authority, amountToman: 5000 });
  assert.deepEqual([v0.ok, v0.pending], [false, true]);   // nobody pressed a button yet
  settle(r.authority, 'ok');
  const v1 = await mock.verify({}, { authority: r.authority, amountToman: 5000 });
  assert.deepEqual([v1.ok, v1.alreadyVerified, v1.amountToman, v1.orderIdEcho], [true, false, 5000, 'o-1']);
  const v2 = await mock.verify({}, { authority: r.authority, amountToman: 5000 });
  assert.deepEqual([v2.ok, v2.alreadyVerified, v2.code], [true, true, '101']);
  assert.equal((await mock.verify({}, { authority: 'Mnope' })).code, 'unknown_authority');
});

test('registry: five gateways in dev, mock refused in production (fresh process with NODE_ENV=production)', () => {
  assert.deepEqual(gateways().map(g => g.id), ['zarinpal', 'payping', 'zibal', 'sep', 'mock']);
  assert.equal(hasGateway('mock'), true);
  assert.equal(getGateway('mock').id, 'mock');
  assert.throws(() => getGateway('nope'), /unknown gateway/);
  assert.deepEqual(gateways({ env: 'production' }).map(g => g.id), ['zarinpal', 'payping', 'zibal', 'sep']);
  assert.throws(() => getGateway('mock', { env: 'production' }), /not available in production/);
  const code = `import('./src/payments/registry.js').then(m => { console.log(JSON.stringify({ ids: m.gatewayIds(), has: m.hasGateway('mock') })); try { m.getGateway('mock'); console.log('NOT-REFUSED'); } catch (e) { console.log('refused:' + e.code); } })`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8',
    env: { ...process.env, NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32), SECRETS_KEY: Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64'), ADMIN_PASS: 'strong-enough-pass-123', DATA_DIR: '/tmp/sysaiq-registry-test' },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /"ids":\["zarinpal","payping","zibal","sep"\],"has":false/);
  assert.match(r.stdout, /refused:mock_refused/);
});
