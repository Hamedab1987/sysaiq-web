// Lead-notification email. Uses SMTP if configured (env), otherwise no-ops
// gracefully so lead capture never fails just because mail isn't set up yet.
import nodemailer from 'nodemailer';

let transporter = null;
function tx() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE) === 'true',
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export async function sendLeadNotification(lead) {
  const t = tx();
  const to = process.env.LEAD_NOTIFY_TO || 'hello@sysaiq.com';
  // log the id only — the address is personal data and stdout goes to journald
  if (!t) { console.log(`[lead] #${lead.id} — SMTP not configured, skipping notify`); return; }
  const from = process.env.MAIL_FROM || 'SysaiQ <hello@sysaiq.com>';
  const lines = [
    `New lead #${lead.id}`,
    `Name: ${lead.name || '-'}`,
    `Email: ${lead.email || '-'}`,
    `Phone: ${lead.phone || '-'}`,
    `Company: ${lead.company || '-'}`,
    `Project type: ${lead.project_type || '-'}`,
    `Language: ${lead.language || '-'}  ·  Source: ${lead.source || '-'}`,
    '',
    `Message:\n${lead.message || '-'}`,
    lead.summary ? `\nAI summary:\n${lead.summary}` : '',
  ].join('\n');
  await t.sendMail({ from, to, replyTo: lead.email || undefined, subject: `SysaiQ lead #${lead.id} — ${lead.name || lead.email || 'new'}`, text: lines });
}

// ---- invoices / payments (payments workstream) --------------------------------
// Plain-text, bilingual by invoice.language; no-ops when SMTP is not
// configured or the invoice has no email. Logs ids only.
const fmtToman = (n, lang) => {
  const latin = Math.round(Number(n) || 0).toLocaleString('en-US');
  return lang === 'en' ? `${latin} Toman` : `${latin.replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/,/g, '٬')} تومان`;
};

export async function sendInvoiceLink(invoice, { reminder = false } = {}) {
  const t = tx();
  const to = invoice?.customer_email;
  if (!invoice?.id || !to) return false;
  if (!t) { console.log(`[invoice] #${invoice.id} — SMTP not configured, skipping email`); return false; }
  const en = invoice.language === 'en';
  const from = process.env.MAIL_FROM || 'SysaiQ <hello@sysaiq.com>';
  const amount = fmtToman(invoice.amount_toman, en ? 'en' : 'fa');
  const subject = en
    ? `${reminder ? 'Reminder: ' : ''}SysaiQ invoice ${invoice.number} — ${amount}`
    : `${reminder ? 'یادآوری: ' : ''}فاکتور ${invoice.number} SysaiQ — ${amount}`;
  const text = en
    ? [`Dear ${invoice.customer_name || 'customer'},`, '', `${reminder ? 'A reminder that ' : ''}SysaiQ invoice ${invoice.number} (${invoice.title}) for ${amount} is ${reminder ? 'awaiting payment' : 'ready'}.`, '', `Pay online: ${invoice.pay_url}`, `Short link: ${invoice.short_url}`, '', 'Card details are entered only on the bank page; SysaiQ never sees them.', '', 'SysaiQ — Hamed Abooali, Qazvin'].join('\n')
    : [`${invoice.customer_name || 'مشتری'} عزیز،`, '', `${reminder ? 'یادآوری می‌کنیم که ' : ''}فاکتور ${invoice.number} SysaiQ (${invoice.title}) به مبلغ ${amount} ${reminder ? 'در انتظار پرداخت است' : 'صادر شد'}.`, '', `پرداخت آنلاین: ${invoice.pay_url}`, `لینک کوتاه: ${invoice.short_url}`, '', 'اطلاعات کارت فقط در صفحهٔ بانک وارد می‌شود و SysaiQ هرگز آن را نمی‌بیند.', '', 'SysaiQ — حامد ابوعلی، قزوین'].join('\n');
  await t.sendMail({ from, to, subject, text });
  return true;
}

export async function sendPaymentReceipt(invoice, payment) {
  const t = tx();
  const to = invoice?.customer_email;
  if (!invoice?.id || !to) return false;
  if (!t) { console.log(`[payment] #${payment?.id} — SMTP not configured, skipping receipt email`); return false; }
  const en = invoice.language === 'en';
  const from = process.env.MAIL_FROM || 'SysaiQ <hello@sysaiq.com>';
  const amount = fmtToman(payment?.amount_toman ?? invoice.amount_toman, en ? 'en' : 'fa');
  const ref = payment?.ref_id || '—';
  const subject = en ? `SysaiQ payment received — invoice ${invoice.number}` : `رسید پرداخت SysaiQ — فاکتور ${invoice.number}`;
  const text = en
    ? [`Dear ${invoice.customer_name || 'customer'},`, '', `Your payment of ${amount} for SysaiQ invoice ${invoice.number} (${invoice.title}) was received.`, `Reference: ${ref}`, '', `Receipt: ${invoice.pay_url}/receipt`, '', 'This receipt is not an official tax invoice.', '', 'Thank you — SysaiQ'].join('\n')
    : [`${invoice.customer_name || 'مشتری'} عزیز،`, '', `پرداخت ${amount} بابت فاکتور ${invoice.number} SysaiQ (${invoice.title}) ثبت شد.`, `کد پیگیری: ${ref}`, '', `رسید: ${invoice.pay_url}/receipt`, '', 'این رسید صورتحساب رسمی مالیاتی نیست.', '', 'سپاسگزاریم — SysaiQ'].join('\n');
  await t.sendMail({ from, to, subject, text });
  return true;
}
