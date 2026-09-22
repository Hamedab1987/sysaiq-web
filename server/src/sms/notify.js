// Event → SMS. Subscribes once (on import) to lib/events.js and turns each
// business event into template sends through sms/service.js. Every send is
// dedupe-keyed by event + role + record id, so a re-emitted event never
// double-texts anyone. Failures are logged rows, never thrown.
//
// Payload contracts (the payments workstream emits these — see the tests in
// test/sms/notify.test.js for the fixtures this file is written against):
//   lead.created      { id, lead: { id, name, phone, phone_norm, language, service_slug, project_type } }   (lib/leads.js)
//   invoice.sent      { invoice, reminder?: true, dedupeKey?: string }
//   payment.succeeded { payment, invoice }
//   payment.failed    { payment, invoice }
//   payment.orphaned  { payment, invoice }          (a second success for a paid invoice — owner must refund)
//   invoice = { id, number, short_code, amount_toman, customer_name, customer_phone, language? }
//   payment = { id, invoice_id, amount_toman, ref_id? }
// The route module imports this file, which is how it gets loaded at boot
// (routes are auto-discovered; app.js is not ours to edit).
import { on } from '../lib/events.js';
import { toFaDigits } from '../lib/normalize.js';
import { readConfig } from './config.js';
import { sendTemplate } from './service.js';

const lang = l => (String(l || '').toLowerCase() === 'en' ? 'en' : 'fa');
const s = x => (x === undefined || x === null ? '' : String(x)).trim();

// 12500000 → fa '۱۲٬۵۰۰٬۰۰۰' · en '12,500,000'
export function formatAmount(toman, l = 'fa') {
  const n = Number(toman);
  if (!Number.isFinite(n)) return '';
  const latin = Math.round(n).toLocaleString('en-US');
  return l === 'en' ? latin : toFaDigits(latin).replace(/,/g, '٬');
}

const STATUS_LABEL = {
  succeeded: { fa: 'موفق', en: 'succeeded' },
  failed: { fa: 'ناموفق', en: 'failed' },
  orphaned: { fa: 'نیازمند بررسی (پرداخت تکراری)', en: 'needs review (duplicate payment)' },
};

function ownerVars(invoice, payment, status) {
  return {
    amount: formatAmount(payment?.amount_toman ?? invoice?.amount_toman, 'fa'),
    number: s(invoice?.number) || `#${s(invoice?.id)}`,
    name: s(invoice?.customer_name) || '—',
    status: STATUS_LABEL[status]?.fa || status,
  };
}

export const handlers = {
  async 'lead.created'(p) {
    const lead = p?.lead || {};
    const id = p?.id ?? lead.id;
    if (!id) return [];
    const cfg = readConfig();
    const service = s(lead.service_slug) || s(lead.project_type) || '—';
    const out = [];
    out.push(await sendTemplate({
      key: 'lead_owner', to: cfg.owner_mobile, lang: 'fa',
      vars: { id: String(id), name: s(lead.name) || '—', phone: s(lead.phone) || s(lead.email) || '—', service },
      dedupeKey: `lead.created:owner:${id}`, refs: { lead_id: id },
    }));
    // only Iranian mobiles get the confirmation (phone_norm is set by lib/leads.js)
    const to = s(lead.phone_norm) || s(lead.phone);
    if (to) {
      out.push(await sendTemplate({
        key: 'lead_customer', to, lang: lang(lead.language),
        vars: { name: s(lead.name) || '—' },
        dedupeKey: `lead.created:customer:${id}`, refs: { lead_id: id },
      }));
    }
    return out;
  },

  async 'invoice.sent'(p) {
    const inv = p?.invoice;
    if (!inv?.id || !s(inv.customer_phone)) return [];
    const l = lang(inv.language);
    const reminder = p?.reminder === true;
    const day = new Date().toISOString().slice(0, 10);
    return [await sendTemplate({
      key: reminder ? 'invoice_reminder' : 'invoice_link', to: inv.customer_phone, lang: l,
      vars: { name: s(inv.customer_name) || '—', number: s(inv.number) || `#${inv.id}`, amount: formatAmount(inv.amount_toman, l), code: s(inv.short_code) },
      dedupeKey: s(p?.dedupeKey) || (reminder ? `invoice.reminder:${inv.id}:${day}` : `invoice.sent:customer:${inv.id}`),
      refs: { invoice_id: inv.id },
    })];
  },

  async 'payment.succeeded'(p) {
    const { payment, invoice } = p || {};
    if (!payment?.id) return [];
    const cfg = readConfig();
    const out = [];
    if (s(invoice?.customer_phone)) {
      const l = lang(invoice.language);
      out.push(await sendTemplate({
        key: 'payment_customer', to: invoice.customer_phone, lang: l,
        vars: { name: s(invoice.customer_name) || '—', amount: formatAmount(payment.amount_toman ?? invoice.amount_toman, l), number: s(invoice.number) || `#${invoice.id}`, ref: s(payment.ref_id) || '—' },
        dedupeKey: `payment.succeeded:customer:${payment.id}`, refs: { invoice_id: invoice.id, payment_id: payment.id },
      }));
    }
    out.push(await sendTemplate({
      key: 'payment_owner', to: cfg.owner_mobile, lang: 'fa', vars: ownerVars(invoice, payment, 'succeeded'),
      dedupeKey: `payment.succeeded:owner:${payment.id}`, refs: { invoice_id: invoice?.id, payment_id: payment.id },
    }));
    return out;
  },

  async 'payment.failed'(p) {
    return ownerOnly(p, 'failed');
  },
  async 'payment.orphaned'(p) {
    return ownerOnly(p, 'orphaned');
  },
};

async function ownerOnly(p, status) {
  const { payment, invoice } = p || {};
  if (!payment?.id) return [];
  const cfg = readConfig();
  return [await sendTemplate({
    key: 'payment_owner', to: cfg.owner_mobile, lang: 'fa', vars: ownerVars(invoice, payment, status),
    dedupeKey: `payment.${status}:owner:${payment.id}`, refs: { invoice_id: invoice?.id, payment_id: payment.id },
  })];
}

let installed = false;
export function installSmsNotifications() {
  if (installed) return false;
  installed = true;
  for (const [evt, fn] of Object.entries(handlers)) {
    on(evt, payload => fn(payload).catch(e => console.error(`[sms] ${evt}: ${e?.message || e}`)));
  }
  return true;
}
installSmsNotifications();
