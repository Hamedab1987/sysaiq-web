// SEP (Saman) adapter against a fake fetch: token request shape (Rial, ResNum,
// TerminalId), redirect built from a constant, error mapping, callback parsing
// (OK / CanceledByUser / tampered), verify (0, 2 = already verified, amount
// mismatch, missing detail, no receipt yet, no answer), reverse and the
// read-only test(). No app, no db.
import test from 'node:test';
import assert from 'node:assert/strict';
import sep from '../../src/payments/gateways/sep.js';
import { getGateway, describeGateway } from '../../src/payments/registry.js';

const TERMINAL = '13456789';
const TOKEN = '2c3c1fefac5a48feb9f9be7e445dd9b2';
const REF = 'jJnBmy/IojtTemplUH5ke9ULCGtDtb';
const CB = 'https://sysaiq.com/api/pay/callback/sep?p=7';
function ctxWith(responses, secrets = { 'gw.sep.terminal_id': TERMINAL }) {
  const calls = [];
  const fetch = async opts => {
    calls.push(opts);
    const r = typeof responses === 'function' ? responses(opts, calls.length) : responses[calls.length - 1];
    return { ok: (r.status || 200) < 400, status: r.status || 200, data: r.data ?? null, text: r.text ?? JSON.stringify(r.data ?? null), headers: new Map() };
  };
  return { ctx: { config: {}, secret: n => secrets[n] ?? null, fetch, relay: null, log: () => {} }, calls };
}
const detail = (over = {}) => ({ RRN: '14226761817', RefNum: REF, MaskedPan: '621986****8080', HashedPan: 'b96a14400c3a', TerminalNumber: Number(TERMINAL), OrginalAmount: 125000, AffectiveAmount: 125000, StraceDate: '2026-09-23 18:11:06', StraceNo: '100428', ...over });
const okCallback = (over = {}) => ({ MID: TERMINAL, TerminalId: TERMINAL, State: 'OK', Status: '2', RRN: '14226761817', RefNum: REF, ResNum: 'SQ-1405-0001-7', TraceNo: '100428', Amount: '125000', SecurePan: '621986****8080', Token: TOKEN, HashedCardNumber: 'abc', ...over });

test('registered: id sep, Rial, POST callback, SEP origin, terminal id as the secret', () => {
  const g = getGateway('sep');
  assert.equal(g, sep);
  const d = describeGateway(g);
  assert.deepEqual([d.id, d.label_fa, d.label_en, d.wireUnit, d.callbackMethod, d.secretName, d.hasInquiry], ['sep', 'سامان (سپ)', 'Saman (SEP)', 'IRR', 'POST', 'gw.sep.terminal_id', false]);
  assert.deepEqual(sep.redirectOrigins, ['https://sep.shaparak.ir']);
  assert.ok(d.configFields.find(f => f.type === 'secret').help_fa.includes('محیط آزمایشی ندارد'));
});

test('create: POST onlinepg JSON {action:token, TerminalId, Amount in Rial, ResNum, RedirectUrl, CellNumber}; GET SendToken redirect', async () => {
  const { ctx, calls } = ctxWith([{ data: { status: 1, token: TOKEN } }]);
  const r = await sep.create(ctx, { amountToman: 12500, callbackUrl: CB, description: 'ignored', mobile: '09123456789', email: 'a@b.co', orderId: 'SQ-1405-0001-7', payerName: 'x' });
  assert.equal(calls[0].url, 'https://sep.shaparak.ir/onlinepg/onlinepg');
  assert.equal(calls[0].method ?? 'POST', 'POST');
  assert.deepEqual(calls[0].allowHosts, ['sep.shaparak.ir']);
  assert.deepEqual(calls[0].body, { action: 'token', TerminalId: TERMINAL, Amount: 125000, ResNum: 'SQ-1405-0001-7', RedirectUrl: CB, CellNumber: '09123456789' });
  assert.deepEqual([r.ok, r.authority, r.redirectUrl], [true, TOKEN, `https://sep.shaparak.ir/OnlinePG/SendToken?token=${TOKEN}`]);
  assert.ok(!JSON.stringify(r.raw).includes(TOKEN), 'token not kept in the raw payload (it is the authority column)');
  // no / malformed mobile → no CellNumber; Persian-digit terminal id is normalised
  const p = ctxWith([{ data: { status: 1, token: TOKEN } }], { 'gw.sep.terminal_id': '۱۳۴۵۶۷۸۹' });
  await sep.create(p.ctx, { amountToman: 1000, callbackUrl: CB, mobile: '', orderId: 'o' });
  assert.deepEqual(p.calls[0].body, { action: 'token', TerminalId: TERMINAL, Amount: 10000, ResNum: 'o', RedirectUrl: CB });
});

test('create errors: status -1 → errorCode/errorDesc; a malformed token is refused; missing terminal throws not_configured', async () => {
  const e = ctxWith([{ data: { status: -1, errorCode: '5', errorDesc: 'پارامترهای ارسال شده نامعتبر است' } }]);
  const r = await sep.create(e.ctx, { amountToman: 1000, callbackUrl: CB, orderId: 'o' });
  assert.deepEqual([r.ok, r.code, r.message], [false, '5', 'پارامترهای ارسال شده نامعتبر است']);
  const e2 = ctxWith([{ data: { status: -1, errorCode: '8' } }]);
  assert.match((await sep.create(e2.ctx, { amountToman: 1000, callbackUrl: CB, orderId: 'o' })).message, /IP/);
  const bad = ctxWith([{ data: { status: 1, token: '../evil?x=' } }]);
  assert.equal((await sep.create(bad.ctx, { amountToman: 1000, callbackUrl: CB, orderId: 'o' })).ok, false);
  const http = ctxWith([{ status: 503, data: null, text: '<html>' }]);
  assert.deepEqual([(await sep.create(http.ctx, { amountToman: 1000, callbackUrl: CB, orderId: 'o' })).code], ['503']);
  const none = ctxWith([], {});
  await assert.rejects(sep.create(none.ctx, { amountToman: 1000, callbackUrl: CB, orderId: 'o' }), e3 => e3.code === 'not_configured');
  await assert.rejects(sep.create(ctxWith([], { 'gw.sep.terminal_id': 'abc123' }).ctx, { amountToman: 1000, callbackUrl: CB, orderId: 'o' }), e4 => e4.code === 'not_configured');
});

test('parseCallback: success, CanceledByUser, failed, tampered Status / State / empty RefNum', () => {
  const ok = sep.parseCallback({ query: { p: '7' }, body: okCallback() });
  assert.deepEqual([ok.authority, ok.outcome], [TOKEN, 'ok']);
  assert.deepEqual(ok.extra, { state: 'OK', status: '2', refNum: REF, resNum: 'SQ-1405-0001-7', rrn: '14226761817', traceNo: '100428', amount: 125000, terminalId: TERMINAL, maskedPan: '621986****8080', errorCode: '' });
  const c = sep.parseCallback({ body: okCallback({ State: 'CanceledByUser', Status: '1', RefNum: '' }) });
  assert.deepEqual([c.outcome, c.extra.errorCode, c.extra.refNum], ['cancelled', '1', '']);
  assert.equal(sep.parseCallback({ body: okCallback({ State: 'Failed', Status: '3', RefNum: '' }) }).outcome, 'failed');
  assert.equal(sep.parseCallback({ body: okCallback({ State: 'SessionIsNull', Status: '4' }) }).outcome, 'failed');
  // tampered: Status says OK but State disagrees / no receipt / a non-numeric Status
  assert.equal(sep.parseCallback({ body: okCallback({ State: 'Failed' }) }).outcome, 'failed');
  assert.equal(sep.parseCallback({ body: okCallback({ State: 'CanceledByUser' }) }).outcome, 'cancelled');
  assert.equal(sep.parseCallback({ body: okCallback({ RefNum: '' }) }).outcome, 'failed');
  assert.equal(sep.parseCallback({ body: okCallback({ Status: 'OK' }) }).outcome, 'failed');
  assert.equal(sep.parseCallback({ body: okCallback({ Token: '<script>' }) }).authority, '');
  // Rrn spelling (doc appendix) and a full PAN is masked, never stored
  const alt = sep.parseCallback({ body: okCallback({ RRN: undefined, Rrn: '999', SecurePan: '6219861234568080' }) });
  assert.deepEqual([alt.extra.rrn, alt.extra.maskedPan], ['999', '621986******8080']);
});

test('verify: POST {RefNum, TerminalNumber}; 0 = ok, 2 = already verified; amounts compared exactly in Rial', async () => {
  const cb = sep.parseCallback({ body: okCallback() });
  const v = ctxWith([
    { data: { TransactionDetail: detail(), ResultCode: 0, ResultDescription: 'عملیات با موفقیت انجام شد', Success: true } },
    { data: { TransactionDetail: detail(), ResultCode: 2, ResultDescription: 'درخواست تکراری می باشد', Success: false } },
  ]);
  const args = { authority: TOKEN, amountToman: 12500, orderId: 'SQ-1405-0001-7', extra: cb.extra };
  const v1 = await sep.verify(v.ctx, args);
  assert.equal(v.calls[0].url, 'https://sep.shaparak.ir/verifyTxnRandomSessionkey/ipg/VerifyTransaction');
  assert.deepEqual(v.calls[0].body, { RefNum: REF, TerminalNumber: Number(TERMINAL) });
  assert.deepEqual([v1.ok, v1.pending, v1.alreadyVerified, v1.refId, v1.cardPan, v1.cardHash, v1.amountToman, v1.orderIdEcho, v1.code], [true, false, false, REF, '621986****8080', 'b96a14400c3a', 12500, null, '0']);
  assert.ok(!JSON.stringify(v1.raw).includes('621986'), 'no PAN in the stored payload');
  assert.equal(v1.raw.TransactionDetail.StraceNo, '100428');
  const v2 = await sep.verify(v.ctx, args);
  assert.deepEqual([v2.ok, v2.alreadyVerified, v2.code], [true, true, '2']);
});

test('verify: amount echo ≠ snapshot is reported (service → orphaned); off-by-4 Rial is not rounded away; no detail → not ok', async () => {
  const extra = sep.parseCallback({ body: okCallback() }).extra;
  const args = { authority: TOKEN, amountToman: 12500, orderId: 'SQ-1405-0001-7', extra };
  const r = ctxWith([
    { data: { TransactionDetail: detail({ OrginalAmount: 10000, AffectiveAmount: 10000 }), ResultCode: 0 } },
    { data: { TransactionDetail: detail({ OrginalAmount: 125004, AffectiveAmount: 125004 }), ResultCode: 0 } },
    { data: { TransactionDetail: detail({ AffectiveAmount: 100000 }), ResultCode: 0 } },
    { data: { ResultCode: 2, ResultDescription: 'درخواست تکراری' } },
  ]);
  const a = await sep.verify(r.ctx, args);
  assert.deepEqual([a.ok, a.amountToman], [true, 1000]);
  const b = await sep.verify(r.ctx, args);
  assert.deepEqual([b.ok, b.amountToman !== 12500], [true, true]);
  const c = await sep.verify(r.ctx, args);   // what left the card ≠ what we asked for
  assert.deepEqual([c.ok, c.amountToman], [true, 10000]);
  const d = await sep.verify(r.ctx, args);
  assert.deepEqual([d.ok, d.pending, d.code], [false, false, '2_no_detail']);
});

test('verify: callback inconsistencies are refused WITHOUT calling SEP (it auto-reverses); errors, no receipt, no answer', async () => {
  const extra = sep.parseCallback({ body: okCallback() }).extra;
  const never = ctxWith(() => { throw new Error('must not call SEP'); });
  const base = { authority: TOKEN, amountToman: 12500, orderId: 'SQ-1405-0001-7' };
  assert.equal((await sep.verify(never.ctx, { ...base, extra: { ...extra, amount: 10000 } })).code, 'amount_mismatch');
  assert.equal((await sep.verify(never.ctx, { ...base, extra: { ...extra, resNum: 'SQ-1405-0002-9' } })).code, 'resnum_mismatch');
  assert.equal((await sep.verify(never.ctx, { ...base, extra: { ...extra, terminalId: '99999999' } })).code, 'terminal_mismatch');
  assert.equal((await sep.verify(never.ctx, { ...base, authority: 'bad' })).code, 'bad_authority');
  const noRef = await sep.verify(never.ctx, { ...base, extra: {} });   // reconcile before the callback arrived
  assert.deepEqual([noRef.ok, noRef.pending, noRef.code], [false, true, 'no_ref']);
  assert.equal(never.calls.length, 0);
  const e = ctxWith([{ data: { ResultCode: -2, ResultDescription: 'تراکنش یافت نشد' } }, { data: { ResultCode: -6 } }, { data: { ResultCode: -106 } }, { status: 502, data: null, text: 'bad gateway' }, { status: 200, data: null, text: '<html>' }]);
  const n1 = await sep.verify(e.ctx, { ...base, extra });
  assert.deepEqual([n1.ok, n1.pending, n1.code], [false, false, '-2']);
  assert.match((await sep.verify(e.ctx, { ...base, extra })).message, /نیم ساعت/);
  assert.match((await sep.verify(e.ctx, { ...base, extra })).message, /IP/);
  assert.deepEqual([(await sep.verify(e.ctx, { ...base, extra })).pending, (await sep.verify(e.ctx, { ...base, extra })).pending], [true, true]);
});

test('reverse: POST ReverseTransaction {RefNum, TerminalNumber}; not wired to the UI', async () => {
  const { ctx, calls } = ctxWith([{ data: { TransactionDetail: detail(), ResultCode: 0 } }, { data: { ResultCode: -2 } }]);
  const r = await sep.reverse(ctx, { refNum: REF });
  assert.equal(calls[0].url, 'https://sep.shaparak.ir/verifyTxnRandomSessionkey/ipg/ReverseTransaction');
  assert.deepEqual(calls[0].body, { RefNum: REF, TerminalNumber: Number(TERMINAL) });
  assert.deepEqual([r.ok, (await sep.reverse(ctx, { refNum: REF })).ok], [true, false]);
});

test('test(): read-only verify of an impossible receipt — -2 = terminal + IP accepted; -105/-106 explained; never a token request', async () => {
  const { ctx, calls } = ctxWith([{ data: { ResultCode: -2 } }, { data: { ResultCode: -106 } }, { data: { ResultCode: -105 } }, { status: 403, data: null, text: 'Request Rejected' }]);
  const a = await sep.test(ctx);
  assert.equal(a.ok, true);
  assert.match(a.message_fa, /۱٬۰۰۰ تومانی/);
  assert.ok(calls.every(c => c.url.endsWith('/VerifyTransaction')), 'no token request');
  assert.equal(calls[0].body.TerminalNumber, Number(TERMINAL));
  const b = await sep.test(ctx);
  assert.deepEqual([b.ok, /IP/.test(b.message_fa)], [false, true]);
  assert.equal((await sep.test(ctx)).ok, false);
  assert.match((await sep.test(ctx)).message_fa, /HTTP 403/);
  assert.equal((await sep.test(ctxWith([], {}).ctx)).ok, false);
});
