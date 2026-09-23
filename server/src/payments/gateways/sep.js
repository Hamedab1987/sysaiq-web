// SEP — Saman Electronic Payment (sep.ir), the direct Shaparak bank IPG.
// Contract per .claude/skills/iran-payment-gateways (verified 2026-09-23 against
// SEP's «راهنمای استفاده از درگاه پرداخت اینترنتی» v3.3, Esfand 1402, and
// cross-checked with shetabit/multipay's SEP driver and farayaz/larapay's Sep).
// Wire unit: Rial. No sandbox. The terminal id is the only credential: SEP
// authorises token/verify calls by the caller's IP, so the IP that actually
// calls SEP (this server, or the Iranian relay) must be registered with SEP.
// Verify must happen within 30 minutes or SEP reverses the payment itself.
// SEP's verify takes no amount, echoes no order id and re-confirms a receipt
// (RefNum) on every call — so the amount echo is mandatory here, and the
// service refuses a RefNum that already belongs to another payment.
import { toWire, str, redact, maskedPan, callJson, GatewayError } from './common.js';
import { toLatinDigits } from '../../lib/normalize.js';

const ID = 'sep';
const HOST = 'sep.shaparak.ir';
const TOKEN_URL = `https://${HOST}/onlinepg/onlinepg`;
const START_URL = `https://${HOST}/OnlinePG/SendToken`;   // GET ?token= (doc v2+); the POST form variant needs no inline JS we'd have to ship
const VERIFY_URL = `https://${HOST}/verifyTxnRandomSessionkey/ipg/VerifyTransaction`;
const REVERSE_URL = `https://${HOST}/verifyTxnRandomSessionkey/ipg/ReverseTransaction`;
// VERIFY AT IMPLEMENTATION: the doc's sample token is 32 alphanumerics and its
// sample RefNum is base64-like ("jJnBmy/IojtTemplUH5ke9ULCGtDtb"); lengths are guesses
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;
const REFNUM_RE = /^[A-Za-z0-9+/=_-]{1,64}$/;
const TERMINAL_RE = /^\d{4,15}$/;   // ≤ 15 digits stays an exact JS number; VERIFY AT IMPLEMENTATION: numeric (verify sends it as Int64)
const MOBILE_RE = /^09\d{9}$/;
const TEST_REFNUM = 'SysaiQConnectionTest0000000000';   // cannot be a real receipt

// callback Status / token errorCode («جدول وضعیت تراکنش»)
const STATUS_FA = {
  1: 'کاربر انصراف داده است', 2: 'پرداخت موفق', 3: 'پرداخت انجام نشد', 4: 'کاربر در مهلت تعیین‌شده پاسخی نداد',
  5: 'پارامترهای ارسالی نامعتبر است', 8: 'IP سرور پذیرنده نزد سپ ثبت نشده است', 10: 'توکن یافت نشد',
  11: 'این ترمینال فقط تراکنش توکنی می‌پذیرد', 12: 'شمارهٔ ترمینال یافت نشد', 21: 'محدودیت‌های مدل چندحسابی رعایت نشده',
};
// VerifyTransaction / ReverseTransaction ResultCode
const RESULT_FA = {
  0: 'موفق', 2: 'درخواست تکراری (قبلاً تأیید شده)', 5: 'تراکنش برگشت خورده است', '-2': 'تراکنش یافت نشد',
  '-6': 'بیش از نیم ساعت از تراکنش گذشته و سپ آن را برگشت زده است', '-104': 'ترمینال غیرفعال است',
  '-105': 'ترمینال در سیستم سپ موجود نیست', '-106': 'IP سرور نزد سپ مجاز نیست',
};

const obj = x => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
const int = x => { const s = toLatinDigits(str(x, 24)); return /^\d{1,15}$/.test(s) ? Number(s) : null; };

function terminal(ctx) {
  const t = toLatinDigits(str(ctx.secret('gw.sep.terminal_id'), 32));
  if (!TERMINAL_RE.test(t)) throw new GatewayError('not_configured', 'SEP terminal id missing or not numeric');
  return t;
}
const fail = (code, message, extra = {}) => ({ ok: false, pending: false, alreadyVerified: false, code, message, ...extra });
// the stored verify payload: no PAN / hash (those go to their own columns)
function rawVerify(d) {
  const td = obj(d.TransactionDetail);
  return {
    ResultCode: d.ResultCode ?? null, ResultDescription: str(d.ResultDescription, 200), Success: d.Success ?? null,
    TransactionDetail: { RRN: str(td.RRN, 32), RefNum: str(td.RefNum, 64), TerminalNumber: td.TerminalNumber ?? null, OrginalAmount: td.OrginalAmount ?? null, AffectiveAmount: td.AffectiveAmount ?? null, StraceDate: str(td.StraceDate, 32), StraceNo: str(td.StraceNo, 32) },
  };
}

export default {
  id: ID,
  label_fa: 'سامان (سپ)',
  label_en: 'Saman (SEP)',
  wireUnit: 'IRR',
  minToman: 1000,          // VERIFY AT IMPLEMENTATION: no minimum is documented
  maxToman: 100_000_000,   // rule 13 (Shaparak per-transaction caps may be lower)
  callbackMethod: 'POST',
  redirectOrigins: [`https://${HOST}`],
  hosts: [HOST],
  secretName: 'gw.sep.terminal_id',
  configFields: [
    { key: 'terminal_id', label_fa: 'شمارهٔ ترمینال (TerminalId)', type: 'secret', required: true, pattern: TERMINAL_RE.source,
      help_fa: 'شماره‌ای که سپ (پرداخت الکترونیک سامان) هنگام قرارداد می‌دهد. IP سرور (یا رلهٔ ایرانی) و دامنهٔ سایت باید نزد سپ ثبت شده باشد. سپ محیط آزمایشی ندارد؛ آزمون کامل فقط با یک پرداخت واقعی ۱٬۰۰۰ تومانی ممکن است.' },
  ],

  async create(ctx, { amountToman, callbackUrl, mobile, orderId }) {
    const body = {
      action: 'token',
      TerminalId: terminal(ctx),
      Amount: toWire(amountToman, 'IRR'),
      ResNum: str(orderId, 50),
      RedirectUrl: callbackUrl,
      // VERIFY AT IMPLEMENTATION: the doc's sample is 10 digits ("9120000000"); we send 09xxxxxxxxx
      ...(MOBILE_RE.test(str(mobile)) ? { CellNumber: str(mobile) } : {}),
    };
    const r = await callJson(ctx, { url: TOKEN_URL, body, op: 'token', allowHosts: [HOST] });
    const d = obj(r.data);
    const token = str(d.token, 128);
    if (String(d.status ?? '') !== '1' || !TOKEN_RE.test(token)) {
      const c = str(d.errorCode, 10);
      return { ok: false, code: c || (r.ok ? 'bad_response' : String(r.status || 'bad_response')), message: str(d.errorDesc, 300) || STATUS_FA[c] || '', raw: redact(d) };
    }
    // built from a constant + the validated token, never a URL from the response
    return { ok: true, authority: token, redirectUrl: `${START_URL}?token=${token}`, raw: redact(d) };
  },

  // POST form-urlencoded to RedirectUrl: Token, State, Status (2 = OK), RefNum,
  // ResNum, RRN/Rrn, TraceNo, MID/TerminalId, Amount, SecurePan, HashedCardNumber…
  parseCallback({ query = {}, body = {} }) {
    const src = { ...query, ...body };
    const token = str(src.Token ?? src.token, 128);
    const status = str(src.Status, 4);
    const state = str(src.State, 40);
    const refNum = str(src.RefNum, 100);
    const refOk = REFNUM_RE.test(refNum);
    // OK needs the numeric and the text status to agree and a receipt (an empty RefNum means the payment failed)
    const outcome = status === '2' && (!state || state.toUpperCase() === 'OK') && refOk ? 'ok'
      : status === '1' || /^CanceledByUser$/i.test(state) ? 'cancelled' : 'failed';
    return {
      authority: TOKEN_RE.test(token) ? token : '',
      outcome,
      extra: {
        state, status, refNum: refOk ? refNum : '', resNum: str(src.ResNum, 50), rrn: str(src.RRN ?? src.Rrn, 32), traceNo: str(src.TraceNo, 32),
        amount: int(src.Amount), terminalId: toLatinDigits(str(src.TerminalId ?? src.MID, 20)), maskedPan: maskedPan(src.SecurePan),
        errorCode: outcome === 'ok' ? '' : (status || state || 'none'),
      },
    };
  },

  async verify(ctx, { authority, amountToman, orderId, extra = {} }) {
    if (!TOKEN_RE.test(str(authority))) return fail('bad_authority', 'token malformed');
    const refNum = str(extra.refNum, 100);
    // no receipt yet (the customer may still be on the bank page): stay pending, reconcile expires it
    if (!REFNUM_RE.test(refNum)) return { ok: false, pending: true, alreadyVerified: false, code: 'no_ref', message: 'RefNum هنوز از سپ نرسیده است' };
    const term = terminal(ctx);
    const wire = toWire(amountToman, 'IRR');
    // the callback comes through the customer's browser: on any inconsistency we
    // do NOT verify, so SEP reverses the payment to the card by itself within 30 minutes
    const noVerify = 'تأیید نشد؛ سپ مبلغ را ظرف ۳۰ دقیقه به کارت برمی‌گرداند';
    if (extra.resNum && orderId && str(extra.resNum, 50) !== str(orderId, 50)) return fail('resnum_mismatch', `شمارهٔ خرید بازگشتی با پرداخت نمی‌خواند — ${noVerify}`);
    if (extra.amount !== null && extra.amount !== undefined && Number(extra.amount) !== wire) return fail('amount_mismatch', `مبلغ بازگشتی (${extra.amount} ریال) با فاکتور نمی‌خواند — ${noVerify}`);
    if (extra.terminalId && extra.terminalId !== term) return fail('terminal_mismatch', `شمارهٔ ترمینال بازگشتی با تنظیمات نمی‌خواند — ${noVerify}`);

    const r = await callJson(ctx, { url: VERIFY_URL, body: { RefNum: refNum, TerminalNumber: Number(term) }, op: 'verify', allowHosts: [HOST] });
    // no usable answer: SEP says retry (within the 30 minutes) — reconcile does
    if (!r.data || typeof r.data !== 'object' || r.status >= 500) return { ok: false, pending: true, alreadyVerified: false, code: String(r.status || 'no_answer'), message: 'پاسخی از سپ نرسید؛ دوباره تلاش می‌شود' };
    const d = r.data;
    const code = String(d.ResultCode ?? '');
    if (code !== '0' && code !== '2') return fail(code || String(r.status), `sep ${code}: ${RESULT_FA[code] || str(d.ResultDescription, 200) || 'تأیید ناموفق'}`, { raw: rawVerify(d) });
    // SEP's verify carries no amount: without the echo nothing proves this receipt pays this invoice
    const td = obj(d.TransactionDetail);
    const orig = int(td.OrginalAmount ?? td.OriginalAmount);
    const aff = int(td.AffectiveAmount);
    if (orig === null) return fail(`${code}_no_detail`, 'سپ تأیید کرد ولی مبلغ تراکنش را برنگرداند؛ در پنل سپ بررسی و در صورت نیاز استرداد کنید', { raw: rawVerify(d) });
    // both what we asked for and what left the card must equal the snapshot; exact in Rial
    const charged = orig !== wire ? orig : aff !== null && aff !== wire ? aff : wire;
    return {
      ok: true, pending: false, alreadyVerified: code === '2',
      refId: refNum,   // SEP's unique digital receipt — the service refuses it on a second payment
      cardPan: maskedPan(td.MaskedPan) || str(extra.maskedPan, 32), cardHash: str(td.HashedPan, 128),
      amountToman: charged === wire ? Number(amountToman) : charged / 10,
      orderIdEcho: null,   // verify does not echo ResNum
      code, message: '', raw: rawVerify(d),
    };
  },

  // not wired to the UI: refund a verified receipt (VERIFY AT IMPLEMENTATION: the
  // doc allows it only for a short window after the payment, roughly 50 minutes)
  async reverse(ctx, { refNum }) {
    const ref = str(refNum, 100);
    if (!REFNUM_RE.test(ref)) return fail('bad_ref', 'RefNum malformed');
    const r = await callJson(ctx, { url: REVERSE_URL, body: { RefNum: ref, TerminalNumber: Number(terminal(ctx)) }, op: 'reverse', allowHosts: [HOST] });
    const d = obj(r.data);
    const code = String(d.ResultCode ?? r.status);
    return { ok: code === '0' || code === '2', code, message: RESULT_FA[code] || str(d.ResultDescription, 200), raw: rawVerify(d) };
  },

  // read-only: verifying a receipt that cannot exist answers -2 (not found) when
  // the terminal and our IP are accepted, -104/-105/-106 when not. It creates
  // nothing — a token request would open a transaction, so it is never a test.
  async test(ctx) {
    let term;
    try { term = terminal(ctx); } catch { return { ok: false, message_fa: 'شمارهٔ ترمینال سپ تنظیم نشده یا فقط از رقم تشکیل نشده است.' }; }
    const r = await callJson(ctx, { url: VERIFY_URL, body: { RefNum: TEST_REFNUM, TerminalNumber: Number(term) }, op: 'verify-test', allowHosts: [HOST] });
    const d = obj(r.data);
    const code = String(d.ResultCode ?? '');
    if (code === '-2') return { ok: true, message_fa: 'اتصال به سپ برقرار است و ترمینال و IP سرور پذیرفته شد. سپ محیط آزمایشی ندارد؛ آزمون کامل فقط با یک پرداخت واقعی ۱٬۰۰۰ تومانی ممکن است.' };
    if (!code) return { ok: false, message_fa: `سپ پاسخ قابل‌خواندنی نداد (HTTP ${r.status}).` };
    return { ok: false, message_fa: `سپ نپذیرفت: کد ${code} — ${RESULT_FA[code] || str(d.ResultDescription, 150)}` };
  },
};
