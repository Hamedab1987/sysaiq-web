// Pay-link pages on the shared layout (all noindex, served no-store):
//   renderPayPage(inv, lang)                /:lang/pay/:token          invoice card + gateway choice
//   renderResultPage(inv, payment, outcome) /:lang/pay/:token/result   after the bank callback
//   renderReceipt(inv, payment, lang)       /:lang/pay/:token/receipt  printable receipt
//   renderMockBank(payment, inv)            /api/pay/mock/bank         dev-only fake bank page
// Everything from the DB goes through esc()/attr(); amounts are integer
// Toman rendered with Persian digits + «تومان» in fa. No inline script: the
// gateway form is driven by /assets/site/pay.js (fetch → location.assign).
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { esc, attr } from '../lib/html.js';
import { toFaDigits } from '../lib/normalize.js';
import { getSiteInfo } from '../lib/siteinfo.js';
import { renderBadge } from '../lib/trust.js';
import { renderLayout } from './layout.js';
import { enabledGateways, readPayConfig, ensureGatewayCsp } from '../payments/config.js';

function assetVersion() {
  let v = 0;
  for (const f of ['pay.css', 'pay.js']) {
    try { v = Math.max(v, Math.floor(statSync(join(config.siteDir, 'assets', 'site', f)).mtimeMs)); } catch { /* missing asset */ }
  }
  return v ? v.toString(36) : '1';
}
const V = assetVersion();
export const PAY_CSS = `/assets/site/pay.css?v=${V}`;
export const PAY_JS = `/assets/site/pay.js?v=${V}`;
const head = () => `<link rel="stylesheet" href="${PAY_CSS}">\n<script src="${PAY_JS}" defer></script>`;

const STR = {
  fa: {
    invoice: 'فاکتور', payTitle: 'پرداخت فاکتور', number: 'شمارهٔ فاکتور', issued: 'تاریخ صدور', due: 'مهلت پرداخت', customer: 'مشتری',
    item: 'شرح', qty: 'تعداد', unit: 'مبلغ واحد', total: 'جمع', subtotal: 'جمع اقلام', discount: 'تخفیف', tax: 'مالیات بر ارزش افزوده', payable: 'مبلغ قابل پرداخت',
    toman: 'تومان', chooseGateway: 'درگاه پرداخت را انتخاب کنید', payBtn: 'پرداخت آنلاین', redirecting: 'در حال انتقال به درگاه…',
    secure: 'اطلاعات کارت فقط در صفحهٔ بانک (شاپرک) وارد می‌شود و SysaiQ هرگز آن را نمی‌بیند.',
    vpn: 'پیش از پرداخت، فیلترشکن (VPN) را خاموش کنید؛ درگاه‌های بانکی به IP خارج از ایران پاسخ نمی‌دهند.',
    seller: 'فروشنده', offline: 'پرداخت از راه واریز بانکی', noGateway: 'پرداخت آنلاین در حال حاضر فعال نیست. لطفاً از راه واریز بانکی اقدام کنید یا با ما تماس بگیرید.',
    paid: 'این فاکتور پرداخت شده است.', paidHint: 'رسید پرداخت را می‌توانید ببینید یا چاپ کنید.', receipt: 'مشاهدهٔ رسید',
    expired: 'مهلت پرداخت این فاکتور گذشته است.', expiredHint: 'برای دریافت لینک تازه با ما تماس بگیرید.',
    cancelled: 'این فاکتور لغو شده است.', draft: 'این فاکتور هنوز صادر نشده است.',
    pendingNote: 'پرداخت قبلی شما در حال بررسی است؛ اگر مبلغ از حساب کم شده، تا چند دقیقهٔ دیگر وضعیت به‌روز می‌شود. دوباره پرداخت نکنید.',
    contact: 'تماس با ما', notes: 'توضیحات',
    // result
    rSucceeded: 'پرداخت با موفقیت انجام شد', rSucceededHint: 'رسید پرداخت به شمارهٔ شما پیامک می‌شود. از اعتماد شما سپاسگزاریم.',
    rFailed: 'پرداخت انجام نشد', rFailedHint: 'مبلغی از حساب شما کم نشده است؛ اگر کم شده باشد، تا ۷۲ ساعت به‌صورت خودکار برمی‌گردد.',
    rCancelled: 'پرداخت لغو شد', rCancelledHint: 'شما از صفحهٔ بانک بازگشتید. هر وقت خواستید می‌توانید دوباره تلاش کنید.',
    rPending: 'در حال بررسی پرداخت', rPendingHint: 'پاسخ نهایی بانک هنوز نرسیده است. این صفحه هر ۱۰ ثانیه به‌روز می‌شود؛ دوباره پرداخت نکنید.',
    rOrphaned: 'پرداخت دریافت شد، اما نیاز به بررسی دارد', rOrphanedHint: 'مبلغ با فاکتور نمی‌خواند یا این فاکتور قبلاً تسویه شده بود. مبلغ اضافی به‌صورت دستی برگردانده می‌شود؛ لطفاً با ما تماس بگیرید.',
    rReplayed: 'این پرداخت قبلاً تأیید شده است', rUnknown: 'اطلاعات بازگشتی از درگاه معتبر نبود', rUnknownHint: 'اگر مبلغی پرداخت کرده‌اید، با ما تماس بگیرید؛ با کد پیگیری بانک بررسی می‌کنیم.',
    ref: 'کد پیگیری', gateway: 'درگاه', card: 'کارت', amount: 'مبلغ', back: 'بازگشت به فاکتور', retry: 'تلاش دوباره',
    // receipt
    receiptTitle: 'رسید پرداخت', paidAt: 'تاریخ پرداخت', method: 'روش پرداخت', manual: 'واریز بانکی', print: 'چاپ رسید',
    notTax: 'این رسید صورتحساب رسمی مالیاتی نیست.', thanks: 'از همکاری شما سپاسگزاریم.',
  },
  en: {
    invoice: 'Invoice', payTitle: 'Pay invoice', number: 'Invoice number', issued: 'Issued', due: 'Due', customer: 'Customer',
    item: 'Description', qty: 'Qty', unit: 'Unit price', total: 'Total', subtotal: 'Subtotal', discount: 'Discount', tax: 'VAT', payable: 'Amount payable',
    toman: 'Toman', chooseGateway: 'Choose a payment gateway', payBtn: 'Pay online', redirecting: 'Redirecting to the bank…',
    secure: 'Card details are entered only on the bank (Shaparak) page; SysaiQ never sees them.',
    vpn: 'Turn off any VPN before paying — Iranian bank gateways do not answer non-Iranian IPs.',
    seller: 'Seller', offline: 'Pay by bank transfer', noGateway: 'Online payment is not available right now. Please pay by bank transfer or contact us.',
    paid: 'This invoice has been paid.', paidHint: 'You can view or print the receipt.', receipt: 'View receipt',
    expired: 'This invoice has expired.', expiredHint: 'Contact us for a fresh link.',
    cancelled: 'This invoice has been cancelled.', draft: 'This invoice has not been issued yet.',
    pendingNote: 'Your previous payment is being verified; if the amount was debited the status will update within minutes. Please do not pay again.',
    contact: 'Contact us', notes: 'Notes',
    rSucceeded: 'Payment successful', rSucceededHint: 'A receipt will be sent to your phone. Thank you.',
    rFailed: 'Payment failed', rFailedHint: 'Nothing was charged; if it was, the bank refunds it automatically within 72 hours.',
    rCancelled: 'Payment cancelled', rCancelledHint: 'You returned from the bank page. You can try again any time.',
    rPending: 'Verifying payment', rPendingHint: 'The bank has not answered yet. This page refreshes every 10 seconds; please do not pay again.',
    rOrphaned: 'Payment received but needs review', rOrphanedHint: 'The amount did not match, or the invoice was already settled. The extra amount is refunded manually — please contact us.',
    rReplayed: 'This payment was already verified', rUnknown: 'The gateway response was not valid', rUnknownHint: 'If you did pay, contact us with the bank reference and we will check.',
    ref: 'Reference', gateway: 'Gateway', card: 'Card', amount: 'Amount', back: 'Back to invoice', retry: 'Try again',
    receiptTitle: 'Payment receipt', paidAt: 'Paid on', method: 'Method', manual: 'Bank transfer', print: 'Print receipt',
    notTax: 'This receipt is not an official tax invoice.', thanks: 'Thank you for your business.',
  },
};

// 12500000 → fa '۱۲٬۵۰۰٬۰۰۰ تومان' · en '12,500,000 Toman'
export function money(toman, lang) {
  const n = Math.round(Number(toman) || 0).toLocaleString('en-US');
  return lang === 'en' ? `${n} ${STR.en.toman}` : `${toFaDigits(n).replace(/,/g, '٬')} ${STR.fa.toman}`;
}
const num = (n, lang) => (lang === 'en' ? String(n) : toFaDigits(String(n)));
export function date(iso, lang) {
  if (!iso) return '—';
  const d = new Date(String(iso).replace(' ', 'T') + (/Z$|[+-]\d\d:\d\d$/.test(iso) ? '' : 'Z'));
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fa-IR-u-ca-persian', { dateStyle: 'long', timeZone: 'Asia/Tehran' }).format(d);
}
const L = lang => (lang === 'en' ? 'en' : 'fa');

function seller(lang, t) {
  const s = getSiteInfo(lang);
  const parts = [s.owner_name, s.brand, s.city].filter(Boolean);
  const rows = [
    parts.length ? `<div class="pay-seller__name">${esc(parts.join(' — '))}</div>` : '',
    s.landline ? `<a href="tel:${attr(s.landline_tel)}" dir="ltr">${esc(s.landline)}</a>` : '',
    s.mobile ? `<a href="tel:${attr(s.mobile_tel)}" dir="ltr">${esc(s.mobile)}</a>` : '',
    s.email ? `<a href="${attr(s.mailto)}" dir="ltr">${esc(s.email)}</a>` : '',
  ].filter(Boolean).join('');
  return `<div class="pay-seller"><span class="pay-label">${esc(t.seller)}</span>${rows}</div>`;
}
function enamad(lang) {
  if (!readPayConfig().show_enamad) return '';
  let rows = [];
  try { rows = db.prepare("SELECT * FROM badges WHERE enabled=1 AND kind='enamad' ORDER BY sort, id LIMIT 1").all(); } catch { rows = []; }
  const html = rows.map(r => renderBadge(r, lang)).filter(Boolean).join('');
  return html ? `<div class="pay-enamad">${html}</div>` : '';
}
function itemsTable(inv, lang, t) {
  const rows = inv.items.map(it => `<tr><td>${esc(it.title)}</td><td class="num">${num(it.qty, lang)}</td><td class="num">${esc(money(it.unit_toman, lang))}</td><td class="num">${esc(money(it.total_toman, lang))}</td></tr>`).join('');
  const totals = [
    inv.discount_toman || inv.tax_toman ? `<tr class="pay-sub"><th colspan="3">${esc(t.subtotal)}</th><td class="num">${esc(money(inv.subtotal_toman, lang))}</td></tr>` : '',
    inv.discount_toman ? `<tr class="pay-sub"><th colspan="3">${esc(t.discount)}</th><td class="num">−${esc(money(inv.discount_toman, lang))}</td></tr>` : '',
    inv.tax_toman ? `<tr class="pay-sub"><th colspan="3">${esc(t.tax)} (${num(inv.tax_percent, lang)}٪)</th><td class="num">${esc(money(inv.tax_toman, lang))}</td></tr>` : '',
    `<tr class="pay-total"><th colspan="3">${esc(t.payable)}</th><td class="num">${esc(money(inv.amount_toman, lang))}</td></tr>`,
  ].join('');
  return `<table class="pay-items"><thead><tr><th>${esc(t.item)}</th><th class="num">${esc(t.qty)}</th><th class="num">${esc(t.unit)}</th><th class="num">${esc(t.total)}</th></tr></thead><tbody>${rows}</tbody><tfoot>${totals}</tfoot></table>`;
}
function meta(inv, lang, t) {
  return `<dl class="pay-meta">
<dt>${esc(t.number)}</dt><dd dir="ltr" class="mono">${esc(inv.number)}</dd>
<dt>${esc(t.customer)}</dt><dd>${esc(inv.customer_name)}${inv.customer_company ? ` — ${esc(inv.customer_company)}` : ''}</dd>
<dt>${esc(t.issued)}</dt><dd>${esc(date(inv.sent_at || inv.created_at, lang))}</dd>
${inv.due_at && inv.status === 'sent' ? `<dt>${esc(t.due)}</dt><dd>${esc(date(inv.due_at, lang))}</dd>` : ''}
</dl>`;
}
const notice = (kind, title, hint = '', extra = '') => `<div class="pay-notice pay-notice--${kind}" role="status"><strong>${esc(title)}</strong>${hint ? `<p>${esc(hint)}</p>` : ''}${extra}</div>`;
const offline = (lang, t) => {
  const cfg = readPayConfig();
  const text = lang === 'en' ? cfg.offline_en : cfg.offline_fa;
  return text ? `<section class="pay-offline"><h2>${esc(t.offline)}</h2><p>${esc(text)}</p></section>` : '';
};
const contactLink = (lang, t) => `<a class="btn btn-ghost btn-sm" href="/${lang}/contact">${esc(t.contact)}</a>`;

function gatewayForm(inv, lang, t) {
  const list = enabledGateways();
  if (!list.length) return notice('warn', t.noGateway);
  ensureGatewayCsp();
  const radios = list.map((g, i) => `<label class="pay-gw"><input type="radio" name="gateway" value="${attr(g.id)}"${i === 0 ? ' checked' : ''}><span class="pay-gw__name">${esc(lang === 'en' ? g.label_en : g.label_fa)}</span><span class="pay-gw__unit mono" dir="ltr">${esc(g.id)}</span></label>`).join('');
  return `<form class="pay-form" method="post" action="/api/pay/${attr(inv.token)}/start" data-pay-form data-token="${attr(inv.token)}" data-redirecting="${attr(t.redirecting)}">
<fieldset><legend>${esc(t.chooseGateway)}</legend><div class="pay-gws">${radios}</div></fieldset>
<p class="pay-error" data-pay-error hidden></p>
<button type="submit" class="btn btn-primary pay-submit">${esc(t.payBtn)} — ${esc(money(inv.amount_toman, lang))}</button>
<p class="pay-cue">${esc(t.secure)}</p><p class="pay-cue">${esc(t.vpn)}</p>
</form>`;
}

export function renderPayPage(inv, lang = inv.language) {
  lang = L(lang);
  const t = STR[lang];
  const pending = inv.payments.some(p => ['pending', 'verifying'].includes(p.status));
  let body;
  if (inv.status === 'paid') body = notice('ok', t.paid, t.paidHint, `<p><a class="btn btn-primary btn-sm" href="/${lang}/pay/${attr(inv.token)}/receipt">${esc(t.receipt)}</a></p>`);
  else if (inv.status === 'expired') body = notice('warn', t.expired, t.expiredHint, `<p>${contactLink(lang, t)}</p>`) + offline(lang, t);
  else if (inv.status === 'cancelled') body = notice('danger', t.cancelled);
  else if (inv.status === 'draft') body = notice('info', t.draft);
  else body = (pending ? notice('info', t.pendingNote) : '') + gatewayForm(inv, lang, t) + offline(lang, t);

  const html = `<div class="wrap pay-wrap"><article class="pay-card">
<div class="pay-eyebrow mono" dir="ltr">[ SYSAIQ—INVOICE / ${esc(inv.number)} ]</div>
<h1 class="pay-title">${esc(inv.title)}</h1>
${meta(inv, lang, t)}
${inv.description ? `<section class="pay-desc"><h2>${esc(t.notes)}</h2><p>${esc(inv.description).replace(/\n/g, '<br>')}</p></section>` : ''}
${itemsTable(inv, lang, t)}
${body}
<footer class="pay-foot">${seller(lang, t)}${enamad(lang)}</footer>
</article></div>`;
  return renderLayout({ lang, title: `${t.payTitle} ${inv.number}`, description: t.secure, canonicalPath: `/${lang}/pay/${inv.token}`, head: head(), body: html, noindex: true, bodyClass: 'pay-page' });
}

export function renderResultPage(inv, payment, outcome, lang = inv.language) {
  lang = L(lang);
  const t = STR[lang];
  const o = outcome === 'replayed' ? 'succeeded' : outcome;
  const kind = o === 'succeeded' ? 'ok' : o === 'pending' ? 'info' : o === 'orphaned' ? 'warn' : 'danger';
  const title = { succeeded: t.rSucceeded, failed: t.rFailed, cancelled: t.rCancelled, expired: t.rFailed, pending: t.rPending, orphaned: t.rOrphaned, mismatch: t.rUnknown, unknown: t.rUnknown }[o] || t.rUnknown;
  const hint = { succeeded: t.rSucceededHint, failed: t.rFailedHint, cancelled: t.rCancelledHint, expired: t.rFailedHint, pending: t.rPendingHint, orphaned: t.rOrphanedHint, mismatch: t.rUnknownHint, unknown: t.rUnknownHint }[o] || t.rUnknownHint;
  const details = payment ? `<dl class="pay-meta">
<dt>${esc(t.amount)}</dt><dd>${esc(money(payment.amount_toman, lang))}</dd>
<dt>${esc(t.gateway)}</dt><dd dir="ltr" class="mono">${esc(payment.gateway)}</dd>
${payment.ref_id ? `<dt>${esc(t.ref)}</dt><dd dir="ltr" class="mono">${esc(payment.ref_id)}</dd>` : ''}
${payment.card_pan ? `<dt>${esc(t.card)}</dt><dd dir="ltr" class="mono">${esc(payment.card_pan)}</dd>` : ''}
</dl>` : '';
  const actions = o === 'succeeded'
    ? `<a class="btn btn-primary" href="/${lang}/pay/${attr(inv.token)}/receipt">${esc(t.receipt)}</a>`
    : o === 'pending' ? contactLink(lang, t)
      : `<a class="btn btn-primary" href="/${lang}/pay/${attr(inv.token)}">${esc(o === 'orphaned' || o === 'unknown' || o === 'mismatch' ? t.back : t.retry)}</a> ${contactLink(lang, t)}`;
  const html = `<div class="wrap pay-wrap"><article class="pay-card pay-card--result">
<div class="pay-eyebrow mono" dir="ltr">[ SYSAIQ—PAYMENT / ${esc(inv.number)} ]</div>
${notice(kind, title, hint)}
${details}
<div class="pay-actions">${actions}</div>
</article></div>`;
  const refresh = o === 'pending' ? `<meta http-equiv="refresh" content="10">\n` : '';
  return renderLayout({ lang, title: `${title} — ${inv.number}`, description: hint, canonicalPath: `/${lang}/pay/${inv.token}/result`, head: refresh + head(), body: html, noindex: true, bodyClass: 'pay-page' });
}

export function renderReceipt(inv, payment, lang = inv.language) {
  lang = L(lang);
  const t = STR[lang];
  const s = getSiteInfo(lang);
  const method = payment.gateway === 'manual' ? t.manual : (enabledGateways().find(g => g.id === payment.gateway) || { label_fa: payment.gateway, label_en: payment.gateway })[lang === 'en' ? 'label_en' : 'label_fa'];
  const html = `<div class="wrap pay-wrap"><article class="pay-card pay-receipt">
<div class="pay-eyebrow mono" dir="ltr">[ SYSAIQ—RECEIPT / ${esc(inv.number)} ]</div>
<h1 class="pay-title">${esc(t.receiptTitle)}</h1>
<dl class="pay-meta">
<dt>${esc(t.number)}</dt><dd dir="ltr" class="mono">${esc(inv.number)}</dd>
<dt>${esc(t.customer)}</dt><dd>${esc(inv.customer_name)}${inv.customer_company ? ` — ${esc(inv.customer_company)}` : ''}</dd>
<dt>${esc(t.paidAt)}</dt><dd>${esc(date(payment.verified_at || inv.paid_at, lang))}</dd>
<dt>${esc(t.method)}</dt><dd>${esc(method)}</dd>
${payment.ref_id ? `<dt>${esc(t.ref)}</dt><dd dir="ltr" class="mono">${esc(payment.ref_id)}</dd>` : ''}
${payment.card_pan ? `<dt>${esc(t.card)}</dt><dd dir="ltr" class="mono">${esc(payment.card_pan)}</dd>` : ''}
</dl>
<h2 class="pay-sub-title">${esc(inv.title)}</h2>
${itemsTable(inv, lang, t)}
<p class="pay-paid-amount">${esc(t.amount)}: <strong>${esc(money(payment.amount_toman, lang))}</strong></p>
<footer class="pay-foot">${seller(lang, t)}<div class="pay-seller">${s.address ? `<span>${esc(s.address)}</span>` : ''}</div></footer>
<p class="pay-cue">${esc(t.notTax)} ${esc(t.thanks)}</p>
<div class="pay-actions pay-noprint"><button type="button" class="btn btn-ghost btn-sm" data-print>${esc(t.print)}</button> <a class="btn btn-ghost btn-sm" href="/${lang}/pay/${attr(inv.token)}">${esc(t.back)}</a></div>
</article></div>`;
  return renderLayout({ lang, title: `${t.receiptTitle} ${inv.number}`, description: t.notTax, canonicalPath: `/${lang}/pay/${inv.token}/receipt`, head: head(), body: html, noindex: true, bodyClass: 'pay-page pay-page--receipt' });
}

// dev only: a standalone page (no site chrome) that posts the tester's choice
// to the mock callback — the same POST a real bank would make
export function renderMockBank(payment, inv) {
  const action = '/api/pay/mock/bank';
  const btn = (status, label, cls) => `<form method="post" action="${attr(action)}"><input type="hidden" name="authority" value="${attr(payment.authority)}"><input type="hidden" name="status" value="${status}"><button class="${cls}" type="submit">${label}</button></form>`;
  return `<!DOCTYPE html><html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>بانک آزمایشی — SysaiQ mock</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3f4f6;font-family:Vazirmatn,system-ui,sans-serif;color:#111}.box{background:#fff;border:1px solid #ddd;border-radius:14px;padding:28px 32px;max-width:420px;width:92%;box-shadow:0 10px 40px -20px rgba(0,0,0,.3)}h1{font-size:18px;margin:0 0 4px}p{margin:6px 0;color:#444}.amt{font-size:26px;font-weight:700;margin:14px 0}.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}form{margin:0}button{border:0;border-radius:10px;padding:12px 18px;font:inherit;font-weight:600;cursor:pointer}.ok{background:#16a34a;color:#fff}.no{background:#dc2626;color:#fff}.cancel{background:#e5e7eb;color:#111}.mono{font-family:monospace;direction:ltr;display:inline-block}</style></head>
<body><div class="box"><h1>درگاه بانک آزمایشی (mock)</h1><p>این صفحه فقط در محیط توسعه وجود دارد و هیچ پولی جابه‌جا نمی‌کند.</p>
<p>فاکتور <span class="mono">${esc(inv.number)}</span></p><div class="amt">${esc(money(payment.amount_toman, 'fa'))}</div>
<p>authority: <span class="mono">${esc(payment.authority)}</span></p>
<div class="row">${btn('ok', 'پرداخت موفق', 'ok')}${btn('failed', 'پرداخت ناموفق', 'no')}${btn('cancelled', 'انصراف', 'cancel')}</div></div></body></html>`;
}
