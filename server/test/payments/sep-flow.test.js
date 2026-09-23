// SEP end-to-end over the real app with a fake SEP behind service.transport:
// admin enables SEP (terminal id as a masked secret) → pay page offers it and
// the CSP form-action lists the bank → start (token request) → the bank POSTs
// the form-urlencoded callback → server-to-server verify → paid. Plus the
// safety rules: replayed callback (no second verify), forged Status=2 with an
// unknown receipt, amount echo mismatch → orphaned, a receipt replayed against
// another same-amount invoice → orphaned (SEP re-confirms receipts), cancel.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestApp } from '../helpers.js';

const TERMINAL = '13456789';
let t, db, service;
// fake SEP: remembers tokens and which receipts the "bank" issued for them
const bank = { tokens: new Map(), receipts: new Map(), verified: new Set(), calls: [] };
let seq = 0;
async function fakeSep(opts) {
  bank.calls.push({ url: opts.url, body: opts.body, allowHosts: opts.allowHosts });
  const res = data => ({ ok: true, status: 200, data, text: JSON.stringify(data), headers: new Map() });
  if (opts.url === 'https://sep.shaparak.ir/onlinepg/onlinepg') {
    const token = `tok${String(++seq).padStart(29, '0')}`;
    bank.tokens.set(token, { amount: opts.body.Amount, resNum: opts.body.ResNum, terminal: opts.body.TerminalId });
    return res({ status: 1, token });
  }
  if (opts.url === 'https://sep.shaparak.ir/verifyTxnRandomSessionkey/ipg/VerifyTransaction') {
    const rc = bank.receipts.get(opts.body.RefNum);
    if (!rc || opts.body.TerminalNumber !== Number(TERMINAL)) return res({ ResultCode: -2, ResultDescription: 'تراکنش یافت نشد', Success: false });
    const again = bank.verified.has(opts.body.RefNum);
    bank.verified.add(opts.body.RefNum);
    return res({ TransactionDetail: { RRN: rc.rrn, RefNum: opts.body.RefNum, MaskedPan: '621986****8080', HashedPan: 'h'.repeat(64), TerminalNumber: Number(TERMINAL), OrginalAmount: rc.amount, AffectiveAmount: rc.amount, StraceDate: '2026-09-23 10:00:00', StraceNo: rc.trace }, ResultCode: again ? 2 : 0, ResultDescription: again ? 'درخواست تکراری می باشد' : 'عملیات با موفقیت انجام شد', Success: !again });
  }
  return { ok: false, status: 404, data: null, text: 'not found', headers: new Map() };
}
// the customer pays at the bank: SEP issues a receipt and builds the POST it sends back
function pay(token, { amount } = {}) {
  const tk = bank.tokens.get(token);
  const refNum = `Ref${String(++seq).padStart(27, '0')}`;
  bank.receipts.set(refNum, { amount: amount ?? tk.amount, rrn: String(14226761800 + seq), trace: String(100400 + seq) });
  return { MID: TERMINAL, TerminalId: TERMINAL, State: 'OK', Status: '2', RRN: String(14226761800 + seq), RefNum: refNum, ResNum: tk.resNum, TraceNo: String(100400 + seq), Amount: String(tk.amount), SecurePan: '621986****8080', Token: token, HashedCardNumber: 'x' };
}
const postCallback = (pid, form) => fetch(`${t.base}/api/pay/callback/sep?p=${pid}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://sep.shaparak.ir' }, body: new URLSearchParams(form), redirect: 'manual' });
const verifyCalls = () => bank.calls.filter(c => c.url.endsWith('/VerifyTransaction')).length;
const payment = id => db.prepare('SELECT * FROM payments WHERE id=?').get(id);
const invoiceRow = id => db.prepare('SELECT * FROM invoices WHERE id=?').get(id);
const settle = (ms = 60) => new Promise(r => setTimeout(r, ms));

before(async () => {
  t = await startTestApp();
  ({ db } = await import('../../src/db/index.js'));
  service = await import('../../src/payments/service.js');
  service.transport.fetch = fakeSep;
  await t.loginAsAdmin();
  const r = await t.fetchAdmin('/gateways', { method: 'PUT', body: { gateways: { sep: { enabled: true, secret: TERMINAL } }, default: 'sep' } });
  assert.equal(r.status, 200, await r.clone().text());
  const g = (await r.json()).gateways.find(x => x.id === 'sep');
  assert.deepEqual([g.enabled, g.secret.configured, g.callbackMethod, g.wireUnit], [true, true, 'POST', 'IRR']);
});
after(async () => { service.transport.fetch = null; await t.close(); });

async function sentInvoice(unit = 1250000) {
  const r = await t.fetchAdmin('/invoices', { method: 'POST', body: { customer_name: 'سارا احمدی', customer_phone: '09123456789', title: 'پشتیبانی ماهانه', items: [{ title: 'پشتیبانی', qty: 1, unit_toman: unit }] } });
  assert.equal(r.status, 201, await r.clone().text());
  const inv = await r.json();
  assert.equal((await t.fetchAdmin(`/invoices/${inv.id}/send`, { method: 'POST', body: { channel: 'none' } })).status, 200);
  return inv;
}
async function start(inv) {
  const r = await fetch(`${t.base}/api/pay/${inv.token}/start`, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ gateway: 'sep' }) });
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  return { ...body, p: payment(body.paymentId) };
}

test('admin + pay page: secret never echoed, SEP offered first, CSP form-action allows the bank', async () => {
  const g = await (await t.fetchAdmin('/gateways')).json();
  assert.ok(!JSON.stringify(g).includes(TERMINAL), 'terminal id never returned');
  assert.ok(g.gateways.find(x => x.id === 'sep').callback_url.endsWith('/api/pay/callback/sep'));
  const inv = await sentInvoice();
  const pr = await fetch(`${t.base}/fa/pay/${inv.token}`);
  const page = await pr.text();
  assert.ok(page.includes('name="gateway" value="sep"') && page.includes('سامان (سپ)'));
  assert.match(pr.headers.get('content-security-policy'), /form-action[^;]*https:\/\/sep\.shaparak\.ir/);
});

test('full flow: token (Rial + ResNum) → SendToken redirect → POST callback → verify → paid; replay does not re-verify', async () => {
  const inv = await sentInvoice();
  const st = await start(inv);
  const tokenCall = bank.calls.at(-1);
  assert.deepEqual(tokenCall.body, { action: 'token', TerminalId: TERMINAL, Amount: 12500000, ResNum: `${inv.number}-${st.paymentId}`, RedirectUrl: `${service.callbackUrl('sep', st.paymentId)}`, CellNumber: '09123456789' });
  assert.deepEqual(tokenCall.allowHosts, ['sep.shaparak.ir']);
  assert.equal(st.redirectUrl, `https://sep.shaparak.ir/OnlinePG/SendToken?token=${st.p.authority}`);
  assert.deepEqual([st.p.status, st.p.amount_toman], ['pending', 1250000]);
  // the no-JS form path gets a 303 straight to the bank
  const inv2 = await sentInvoice();
  const plain = await fetch(`${t.base}/api/pay/${inv2.token}/start`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'gateway=sep', redirect: 'manual' });
  assert.equal(plain.status, 303);
  assert.match(plain.headers.get('location'), /^https:\/\/sep\.shaparak\.ir\/OnlinePG\/SendToken\?token=tok\d+$/);

  const form = pay(st.p.authority);
  const before = verifyCalls();
  let r = await postCallback(st.paymentId, form);
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), `/fa/pay/${inv.token}/result?p=${st.paymentId}`);
  assert.equal(verifyCalls(), before + 1);
  assert.deepEqual(bank.calls.at(-1).body, { RefNum: form.RefNum, TerminalNumber: Number(TERMINAL) });
  const p = payment(st.paymentId);
  assert.deepEqual([p.status, p.ref_id, p.card_pan, p.already_verified], ['succeeded', form.RefNum, '621986****8080', 0]);
  assert.ok(!p.raw_verify.includes('621986') && p.raw_verify.includes(form.RRN), 'RRN kept for support, PAN not in the raw payload');
  assert.deepEqual([invoiceRow(inv.id).status, invoiceRow(inv.id).paid_method, invoiceRow(inv.id).paid_ref], ['paid', 'sep', form.RefNum]);
  const result = await (await fetch(`${t.base}${r.headers.get('location')}`)).text();
  assert.ok(result.includes('پرداخت با موفقیت انجام شد'));

  // replayed callback (browser back / double POST): success page, no second verify, still one success
  r = await postCallback(st.paymentId, form);
  assert.equal(r.status, 303);
  assert.equal(verifyCalls(), before + 1);
  assert.equal(payment(st.paymentId).status, 'succeeded');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM payments WHERE invoice_id=? AND status='succeeded'").get(inv.id).n, 1);
});

test('forged Status=2 with a receipt the bank never issued → verify -2 → failed, never paid', async () => {
  const inv = await sentInvoice();
  const st = await start(inv);
  const form = { ...pay(st.p.authority), RefNum: 'ForgedReceipt000000000000000000' };
  await postCallback(st.paymentId, form);
  const p = payment(st.paymentId);
  assert.deepEqual([p.status, p.error_code, invoiceRow(inv.id).status], ['failed', '-2', 'sent']);
});

test('tampering: amount echo ≠ snapshot → orphaned (never paid); callback Amount edited → not verified at all', async () => {
  const inv = await sentInvoice();
  const st = await start(inv);
  await postCallback(st.paymentId, pay(st.p.authority, { amount: 10000 }));   // the bank charged 1,000 Toman
  await settle();
  let p = payment(st.paymentId);
  assert.deepEqual([p.status, p.error_code, invoiceRow(inv.id).status], ['orphaned', 'amount_mismatch', 'sent']);

  const inv2 = await sentInvoice();
  const st2 = await start(inv2);
  const before = verifyCalls();
  await postCallback(st2.paymentId, { ...pay(st2.p.authority), Amount: '10000' });
  p = payment(st2.paymentId);
  assert.deepEqual([p.status, p.error_code, verifyCalls()], ['failed', 'amount_mismatch', before]);
});

test('receipt reuse: a paid RefNum replayed against another same-amount invoice → orphaned, not paid (SEP re-confirms receipts)', async () => {
  const a = await sentInvoice(990000);
  const sa = await start(a);
  const receipt = pay(sa.p.authority);
  await postCallback(sa.paymentId, receipt);
  assert.equal(payment(sa.paymentId).status, 'succeeded');
  const b = await sentInvoice(990000);
  const sb = await start(b);
  // the attacker keeps B's token (so the authority check passes) but reuses A's receipt
  await postCallback(sb.paymentId, { ...receipt, Token: sb.p.authority, ResNum: `${b.number}-${sb.paymentId}` });
  await settle();
  const p = payment(sb.paymentId);
  assert.deepEqual([p.status, p.error_code, invoiceRow(b.id).status, invoiceRow(a.id).status], ['orphaned', 'duplicate_ref', 'sent', 'paid']);
});

test('cancel at the bank → cancelled, invoice payable again; a callback for another gateway path is a mismatch', async () => {
  const inv = await sentInvoice();
  const st = await start(inv);
  const before = verifyCalls();
  let r = await postCallback(st.paymentId, { MID: TERMINAL, State: 'CanceledByUser', Status: '1', RefNum: '', ResNum: `${inv.number}-${st.paymentId}`, Token: st.p.authority });
  assert.equal(r.status, 303);
  assert.deepEqual([payment(st.paymentId).status, verifyCalls(), invoiceRow(inv.id).status], ['cancelled', before, 'sent']);
  const st2 = await start(inv);
  r = await fetch(`${t.base}/api/pay/callback/zibal?p=${st2.paymentId}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(pay(st2.p.authority)), redirect: 'manual' });
  assert.equal(r.status, 303);
  assert.equal(payment(st2.paymentId).status, 'pending');
});

test('reconcile: callback never arrived → stays pending (no receipt yet); with the stored receipt → verified', async () => {
  const reconcile = await import('../../src/payments/reconcile.js');
  const inv = await sentInvoice();
  const st = await start(inv);
  const later = "datetime('now', '+3 minutes')";
  let out = await reconcile.reconcileOnce({ now: db.prepare(`SELECT ${later} AS n`).get().n, log: () => {} });
  assert.equal(payment(st.paymentId).status, 'pending', JSON.stringify(out));
  // the callback arrived but the verify answer was lost (SEP down): pending, then reconcile verifies
  const form = pay(st.p.authority);
  const real = service.transport.fetch;
  service.transport.fetch = async o => (o.url.endsWith('/VerifyTransaction') ? { ok: false, status: 502, data: null, text: 'bad gateway', headers: new Map() } : real(o));
  await postCallback(st.paymentId, form);
  assert.equal(payment(st.paymentId).status, 'pending');
  service.transport.fetch = real;
  out = await reconcile.reconcileOnce({ now: db.prepare(`SELECT ${later} AS n`).get().n, log: () => {} });
  assert.deepEqual([payment(st.paymentId).status, invoiceRow(inv.id).status, out.verified], ['succeeded', 'paid', 1]);
});

test('forged callback with a wrong token cannot replace the stored receipt of a payment awaiting retry', async () => {
  const reconcile = await import('../../src/payments/reconcile.js');
  const inv = await sentInvoice();
  const st = await start(inv);
  const form = pay(st.p.authority);
  const real = service.transport.fetch;
  service.transport.fetch = async o => (o.url.endsWith('/VerifyTransaction') ? { ok: false, status: 502, data: null, text: 'bad gateway', headers: new Map() } : real(o));
  await postCallback(st.paymentId, form);
  service.transport.fetch = real;
  assert.equal(payment(st.paymentId).status, 'pending');
  const stored = payment(st.paymentId).raw_callback;
  // attacker guesses the sequential pid, has no token: mismatch, stored receipt untouched, no verify
  const before = verifyCalls();
  const r = await postCallback(st.paymentId, { MID: TERMINAL, TerminalId: TERMINAL, State: 'OK', Status: '2', RRN: '1', RefNum: 'Forged000000000000000000000000', ResNum: 'X-1', TraceNo: '1', Amount: '10', Token: `tok${'9'.repeat(29)}` });
  assert.equal(r.status, 303);
  assert.deepEqual([payment(st.paymentId).status, payment(st.paymentId).raw_callback, verifyCalls()], ['pending', stored, before]);
  const out = await reconcile.reconcileOnce({ now: db.prepare("SELECT datetime('now', '+3 minutes') AS n").get().n, log: () => {} });
  const p = payment(st.paymentId);
  assert.deepEqual([p.status, p.ref_id, invoiceRow(inv.id).status, out.verified], ['succeeded', form.RefNum, 'paid', 1]);
});

test('reverify ignores a stored callback that did not carry the right token', async () => {
  const inv = await sentInvoice();
  const st = await start(inv);
  const forged = { ...pay(st.p.authority), Token: `tok${'8'.repeat(29)}` };
  await postCallback(st.paymentId, forged);
  const rc = JSON.parse(payment(st.paymentId).raw_callback);
  assert.deepEqual([rc.authority_ok, rc.extra], [false, undefined]);
  // an admin «بررسی مجدد» has no receipt to send → never paid on the forged RefNum
  const before = verifyCalls();
  const v = await service.verifyPayment(st.paymentId, { force: true });
  assert.notEqual(v.outcome, 'succeeded');
  assert.equal(verifyCalls(), before);
  assert.equal(invoiceRow(inv.id).status, 'sent');
});

test('test connection runs server-side through the read-only verify probe', async () => {
  const r = await t.fetchAdmin('/gateways/sep/test', { method: 'POST', body: {} });
  const j = await r.json();
  assert.deepEqual([r.status, j.ok], [200, true]);
  assert.ok(bank.calls.at(-1).url.endsWith('/VerifyTransaction'));
});
