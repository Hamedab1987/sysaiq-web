// Invoices: numbering, tokens, totals, the status machine and the edit lock.
//   draft ──send──▶ sent ──payment / mark-paid──▶ paid
//     │               │  └──lazy, after due_at──▶ expired ──send──▶ sent
//     └──cancel──▶ cancelled ◀──cancel── sent | expired
// Money is integer Toman. Numbers are SQ-{Jalali year}-{seq} from
// invoice_counters (one row per year, bumped inside the insert transaction).
// The pay page is reached by `token` (24 random bytes, base64url) or by the
// 12-char Crockford `short_code` in SMS (/p/:code → 302 to the token URL).
// Once a payment row is in flight or succeeded the money fields are locked:
// the amount the customer saw at the bank is the amount on the invoice.
import { randomBytes } from 'node:crypto';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { emit } from '../lib/events.js';
import { normalizeMobile, parseTomanInput, toLatinDigits } from '../lib/normalize.js';
import { readPayConfig, MAX_TOMAN } from './config.js';
import { sendInvoiceLink, sendPaymentReceipt } from '../mail.js';

export const STATUSES = Object.freeze(['draft', 'sent', 'paid', 'cancelled', 'expired']);
export const ACTIVE_PAYMENT = Object.freeze(['initiated', 'pending', 'verifying', 'succeeded', 'orphaned']);
export const LIMITS = Object.freeze({ items: 40, title: 160, itemTitle: 200, description: 2000, note: 2000, name: 120, company: 120, ref: 120 });
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// ---- ids -------------------------------------------------------------------
export function jalaliYear(date = new Date()) {
  const s = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric', timeZone: 'Asia/Tehran' }).format(date);
  const y = Number(toLatinDigits(s).replace(/\D/g, ''));
  return Number.isInteger(y) && y > 1300 ? y : 1405;
}
export const newToken = () => randomBytes(24).toString('base64url');
export function newShortCode() {
  const b = randomBytes(8);
  let bits = 0n;
  for (const x of b) bits = (bits << 8n) | BigInt(x);
  let out = '';
  for (let i = 0; i < 12; i++) { out = CROCKFORD[Number(bits & 31n)] + out; bits >>= 5n; }
  return out;
}
// Crockford decoding rules: case-insensitive, I/L → 1, O → 0, dashes ignored
export function normalizeShortCode(s) {
  const c = toLatinDigits(s).trim().toUpperCase().replace(/[-\s]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(c) ? c : null;
}
export const TOKEN_RE = /^[A-Za-z0-9_-]{32}$/;

function nextNumber(jyear) {
  db.prepare('INSERT OR IGNORE INTO invoice_counters (jyear, seq) VALUES (?, 0)').run(jyear);
  db.prepare('UPDATE invoice_counters SET seq = seq + 1 WHERE jyear=?').run(jyear);
  const { seq } = db.prepare('SELECT seq FROM invoice_counters WHERE jyear=?').get(jyear);
  return `SQ-${jyear}-${String(seq).padStart(4, '0')}`;
}

// ---- money -----------------------------------------------------------------
export function computeTotals(items, discountToman = 0, taxPercent = 0) {
  const subtotal = items.reduce((n, it) => n + it.qty * it.unit_toman, 0);
  const discount = Math.min(Math.max(0, discountToman), subtotal);
  const taxable = subtotal - discount;
  const tax = Math.round(taxable * taxPercent / 100);
  return { subtotal_toman: subtotal, discount_toman: discount, tax_toman: tax, amount_toman: taxable + tax };
}

const invalid = fields => new HttpError(422, 'validation', 'Validation failed', fields);
const s = (x, max) => (x === undefined || x === null ? '' : String(x)).trim().slice(0, max);
const toman = (x, key, fields, { min = 0, max = MAX_TOMAN } = {}) => {
  if (x === undefined || x === null || x === '') return 0;
  const n = typeof x === 'number' ? (Number.isInteger(x) ? x : null) : parseTomanInput(x);
  if (n === null || n < min || n > max) { fields[key] = `باید عددی صحیح بین ${min} و ${max} تومان باشد`; return 0; }
  return n;
};

// admin input → clean columns + items; every field capped, unknown keys dropped
export function validateInvoiceInput(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const fields = {};
  const out = {};
  const has = k => !partial || k in b;
  if (has('customer_name')) { out.customer_name = s(b.customer_name, LIMITS.name); if (!out.customer_name) fields.customer_name = 'نام مشتری الزامی است'; }
  if (has('customer_phone')) {
    const raw = s(b.customer_phone, 40);
    out.customer_phone = raw ? normalizeMobile(raw) : '';
    if (raw && !out.customer_phone) fields.customer_phone = 'شمارهٔ همراه معتبر نیست (۰۹xxxxxxxxx)';
  }
  if (has('customer_email')) {
    out.customer_email = s(b.customer_email, 254).toLowerCase();
    if (out.customer_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.customer_email)) fields.customer_email = 'ایمیل معتبر نیست';
  }
  if (has('customer_company')) out.customer_company = s(b.customer_company, LIMITS.company);
  if (has('language')) out.language = String(b.language).toLowerCase() === 'en' ? 'en' : 'fa';
  if (has('title')) { out.title = s(b.title, LIMITS.title); if (!out.title) fields.title = 'عنوان فاکتور الزامی است'; }
  if (has('description')) out.description = s(b.description, LIMITS.description);
  if (has('note_internal')) out.note_internal = s(b.note_internal, LIMITS.note);
  if (has('lead_id')) { const n = Number(b.lead_id); out.lead_id = Number.isInteger(n) && n > 0 ? n : null; }
  if (has('due_at')) {
    const d = s(toLatinDigits(b.due_at), 10);
    if (!d) out.due_at = null;
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || Number.isNaN(Date.parse(`${d}T00:00:00Z`))) fields.due_at = 'تاریخ سررسید معتبر نیست';
    else out.due_at = `${d} 23:59:59`;
  }
  if (has('discount_toman')) out.discount_toman = toman(b.discount_toman, 'discount_toman', fields);
  if ('tax_percent' in b) {   // absent on create = the pay_config default
    const n = b.tax_percent === '' || b.tax_percent === undefined || b.tax_percent === null ? 0 : Number(toLatinDigits(b.tax_percent));
    if (!Number.isInteger(n) || n < 0 || n > 25) fields.tax_percent = 'درصد مالیات باید عددی صحیح بین ۰ و ۲۵ باشد';
    else out.tax_percent = n;
  }
  if (has('items')) {
    const list = Array.isArray(b.items) ? b.items : null;
    if (!list) fields.items = 'اقلام باید یک آرایه باشد';
    else if (list.length > LIMITS.items) fields.items = `حداکثر ${LIMITS.items} قلم`;
    else {
      out.items = list.map((it, i) => {
        const o = it && typeof it === 'object' ? it : {};
        const title = s(o.title, LIMITS.itemTitle);
        if (!title) fields[`items[${i}].title`] = 'شرح قلم الزامی است';
        const qty = o.qty === undefined || o.qty === '' ? 1 : Number(toLatinDigits(o.qty));
        if (!Number.isInteger(qty) || qty < 1 || qty > 10000) fields[`items[${i}].qty`] = 'تعداد باید عددی صحیح بین ۱ و ۱۰٬۰۰۰ باشد';
        const unit = toman(o.unit_toman, `items[${i}].unit_toman`, fields);
        return { sort: i, title, qty: Number.isInteger(qty) ? qty : 1, unit_toman: unit, total_toman: (Number.isInteger(qty) ? qty : 1) * unit };
      });
      if (!out.items.length && !partial) fields.items = 'دست‌کم یک قلم لازم است';
    }
  }
  if (Object.keys(fields).length) throw invalid(fields);
  return out;
}

// ---- reads -----------------------------------------------------------------
let stmts = null;
const q = () => stmts ||= {
  byId: db.prepare('SELECT * FROM invoices WHERE id=?'),
  byToken: db.prepare('SELECT * FROM invoices WHERE token=?'),
  byCode: db.prepare('SELECT * FROM invoices WHERE short_code=?'),
  items: db.prepare('SELECT id, sort, title, qty, unit_toman, total_toman FROM invoice_items WHERE invoice_id=? ORDER BY sort, id'),
  payments: db.prepare('SELECT id, invoice_id, gateway, status, amount_toman, authority, ref_id, card_pan, fee_toman, already_verified, error_code, error_message, claimed_at, verified_at, created_at, updated_at FROM payments WHERE invoice_id=? ORDER BY id'),
  activePayment: db.prepare(`SELECT id FROM payments WHERE invoice_id=? AND status IN (${ACTIVE_PAYMENT.map(x => `'${x}'`).join(',')}) LIMIT 1`),
  expire: db.prepare(`UPDATE invoices SET status='expired', updated_at=datetime('now') WHERE id=? AND status='sent' AND due_at IS NOT NULL AND due_at < datetime('now')`),
  delItems: db.prepare('DELETE FROM invoice_items WHERE invoice_id=?'),
  insItem: db.prepare('INSERT INTO invoice_items (invoice_id, sort, title, qty, unit_toman, total_toman) VALUES (?,?,?,?,?,?)'),
};

// sent + past due → expired, at read time (no timer needed)
function expireIfDue(row) {
  if (row && row.status === 'sent' && row.due_at && q().expire.run(row.id).changes) return q().byId.get(row.id);
  return row;
}
export const hasActivePayment = id => !!q().activePayment.get(id);
export const isLocked = row => !row || ['paid', 'cancelled'].includes(row.status) || hasActivePayment(row.id);

function hydrate(row) {
  if (!row) return null;
  const r = expireIfDue(row);
  return { ...r, items: q().items.all(r.id), payments: q().payments.all(r.id), locked: isLocked(r), pay_url: payUrl(r), short_url: shortUrl(r) };
}
export const getInvoice = id => hydrate(q().byId.get(Number(id)));
export const getInvoiceByToken = token => (TOKEN_RE.test(String(token || '')) ? hydrate(q().byToken.get(String(token))) : null);
export function getInvoiceByShortCode(code) {
  const c = normalizeShortCode(code);
  return c ? hydrate(q().byCode.get(c)) : null;
}
export const payUrl = (row, lang) => `${config.publicBaseUrl}/${lang || row.language || 'fa'}/pay/${row.token}`;
export const shortUrl = row => `${config.publicBaseUrl}/p/${row.short_code}`;

export function listInvoices({ status = '', q: query = '', limit = 100, offset = 0 } = {}) {
  const where = [];
  const args = [];
  if (status && STATUSES.includes(status)) { where.push('status=?'); args.push(status); }
  if (query) {
    const like = `%${String(query).slice(0, 80)}%`;
    where.push('(number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ? OR title LIKE ? OR short_code LIKE ?)');
    args.push(like, like, like, normalizeShortCode(query) ? `%${normalizeShortCode(query)}%` : like, like);
  }
  const sql = `SELECT * FROM invoices ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ? OFFSET ?`;
  const rows = db.prepare(sql).all(...args, Math.min(500, Math.max(1, Number(limit) || 100)), Math.max(0, Number(offset) || 0));
  return rows.map(expireIfDue);
}

// ---- writes ----------------------------------------------------------------
const COLS = ['customer_name', 'customer_phone', 'customer_email', 'customer_company', 'language', 'title', 'description', 'note_internal', 'lead_id', 'due_at', 'discount_toman', 'tax_percent'];

export function createInvoice(input, { adminUser = '' } = {}) {
  const clean = validateInvoiceInput(input);
  const totals = computeTotals(clean.items, clean.discount_toman || 0, clean.tax_percent ?? readPayConfig().tax_percent);
  const row = db.transaction(() => {
    const number = nextNumber(jalaliYear());
    let token = newToken(), code = newShortCode();
    while (q().byToken.get(token)) token = newToken();
    while (q().byCode.get(code)) code = newShortCode();
    const r = db.prepare(`INSERT INTO invoices (number, token, short_code, status, lead_id, customer_name, customer_phone, customer_email, customer_company, language,
        title, description, note_internal, subtotal_toman, discount_toman, tax_percent, tax_toman, amount_toman, due_at, created_by)
      VALUES (@number, @token, @short_code, 'draft', @lead_id, @customer_name, @customer_phone, @customer_email, @customer_company, @language,
        @title, @description, @note_internal, @subtotal_toman, @discount_toman, @tax_percent, @tax_toman, @amount_toman, @due_at, @created_by)`).run({
      number, token, short_code: code,
      lead_id: clean.lead_id ?? null, customer_name: clean.customer_name, customer_phone: clean.customer_phone || '', customer_email: clean.customer_email || '',
      customer_company: clean.customer_company || '', language: clean.language || 'fa', title: clean.title, description: clean.description || '',
      note_internal: clean.note_internal || '', ...totals, tax_percent: clean.tax_percent ?? readPayConfig().tax_percent, due_at: clean.due_at ?? null,
      created_by: String(adminUser || '').slice(0, 80),
    });
    const id = Number(r.lastInsertRowid);
    for (const it of clean.items) q().insItem.run(id, it.sort, it.title, it.qty, it.unit_toman, it.total_toman);
    return id;
  })();
  return getInvoice(row);
}

export function updateInvoice(id, input) {
  const cur = getInvoice(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Invoice not found');
  const clean = validateInvoiceInput(input, { partial: true });
  const keys = Object.keys(clean);
  if (cur.locked && keys.some(k => k !== 'note_internal')) {
    throw new HttpError(409, 'invoice_locked', cur.status === 'paid' ? 'فاکتور پرداخت‌شده قابل ویرایش نیست' : cur.status === 'cancelled' ? 'فاکتور لغوشده قابل ویرایش نیست' : 'برای این فاکتور پرداختی در جریان است؛ تا پایان آن قابل ویرایش نیست');
  }
  db.transaction(() => {
    const items = clean.items ?? cur.items.map(({ sort, title, qty, unit_toman, total_toman }) => ({ sort, title, qty, unit_toman, total_toman }));
    if (clean.items && !items.length) throw invalid({ items: 'دست‌کم یک قلم لازم است' });
    const totals = computeTotals(items, clean.discount_toman ?? cur.discount_toman, clean.tax_percent ?? cur.tax_percent);
    const sets = [];
    const args = {};
    for (const k of COLS) if (k in clean) { sets.push(`${k}=@${k}`); args[k] = clean[k]; }
    for (const [k, v] of Object.entries(totals)) { sets.push(`${k}=@${k}`); args[k] = v; }
    sets.push("updated_at=datetime('now')");
    db.prepare(`UPDATE invoices SET ${sets.join(', ')} WHERE id=@id`).run({ ...args, id: cur.id });
    if (clean.items) {
      q().delItems.run(cur.id);
      for (const it of items) q().insItem.run(cur.id, it.sort, it.title, it.qty, it.unit_toman, it.total_toman);
    }
  })();
  return getInvoice(id);
}

// draft | expired | sent → sent (+ due_at default, +sent_at) and emit invoice.sent
export function sendInvoice(id, { reminder = false, dedupeKey = '', channel = 'sms' } = {}) {
  const cur = getInvoice(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Invoice not found');
  if (['paid', 'cancelled'].includes(cur.status)) throw new HttpError(409, 'invoice_state', 'این فاکتور قابل ارسال نیست');
  if (cur.amount_toman <= 0) throw new HttpError(409, 'invoice_amount', 'مبلغ فاکتور باید بیشتر از صفر باشد');
  const days = readPayConfig().due_days;
  const now = new Date();
  const wasSent = cur.status === 'sent';
  const dueExpired = cur.due_at && new Date(cur.due_at.replace(' ', 'T') + 'Z') < now;
  const due = !cur.due_at || dueExpired ? new Date(now.getTime() + days * 864e5).toISOString().slice(0, 10) + ' 23:59:59' : cur.due_at;
  db.prepare(`UPDATE invoices SET status='sent', due_at=?, sent_at=COALESCE(sent_at, datetime('now')),
    reminder_count = reminder_count + ?, last_reminded_at = CASE WHEN ? THEN datetime('now') ELSE last_reminded_at END, updated_at=datetime('now') WHERE id=?`)
    .run(due, reminder && wasSent ? 1 : 0, reminder && wasSent ? 1 : 0, cur.id);
  const inv = getInvoice(id);
  // sms/notify.js texts whoever has a customer_phone and knows nothing about
  // channels: for email-only / status-only sends the payload carries no phone
  const smsWanted = channel === 'sms' || channel === 'both';
  emit('invoice.sent', { invoice: smsWanted ? inv : { ...inv, customer_phone: '' }, reminder: reminder && wasSent, dedupeKey: dedupeKey || undefined, channel });
  // email is called directly (not a second event listener: sms/notify.js's
  // tests assert one listener per event); a no-op without SMTP or an address
  if (channel === 'email' || channel === 'both') sendInvoiceLink(inv, { reminder: reminder && wasSent }).catch(e => console.error(`[mail] invoice #${inv.id}: ${e?.message || e}`));
  return inv;
}

// manual (bank transfer) settlement: one succeeded 'manual' payment row +
// invoice paid, in one transaction; ux_pay_one_success refuses a second
export function markPaidManual(id, { ref = '', note = '', amount = null, adminUser = '' } = {}) {
  const cur = getInvoice(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Invoice not found');
  if (cur.status === 'paid') throw new HttpError(409, 'invoice_state', 'این فاکتور قبلاً پرداخت شده است');
  if (cur.status === 'cancelled') throw new HttpError(409, 'invoice_state', 'فاکتور لغوشده را نمی‌توان پرداخت‌شده کرد');
  const amountToman = amount === null || amount === undefined || amount === '' ? cur.amount_toman : parseTomanInput(amount);
  if (amountToman === null || amountToman <= 0) throw invalid({ amount: 'مبلغ معتبر نیست' });
  const payment = db.transaction(() => {
    const r = db.prepare(`INSERT INTO payments (invoice_id, gateway, status, amount_toman, ref_id, error_message, verified_at, raw_verify)
      VALUES (?, 'manual', 'succeeded', ?, ?, '', datetime('now'), ?)`).run(cur.id, amountToman, s(ref, LIMITS.ref), JSON.stringify({ manual: true, by: String(adminUser || '').slice(0, 80) }));
    db.prepare(`UPDATE invoices SET status='paid', paid_at=datetime('now'), paid_method='manual', paid_ref=?, paid_note=?, updated_at=datetime('now') WHERE id=?`)
      .run(s(ref, LIMITS.ref), s(note, LIMITS.note), cur.id);
    return db.prepare('SELECT * FROM payments WHERE id=?').get(Number(r.lastInsertRowid));
  })();
  const inv = getInvoice(id);
  emit('payment.succeeded', { payment, invoice: inv });
  sendPaymentReceipt(inv, payment).catch(e => console.error(`[mail] payment #${payment.id}: ${e?.message || e}`));
  return inv;
}

export function cancelInvoice(id, { reason = '' } = {}) {
  const cur = getInvoice(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Invoice not found');
  if (cur.status === 'paid') throw new HttpError(409, 'invoice_state', 'فاکتور پرداخت‌شده قابل لغو نیست');
  if (cur.status === 'cancelled') return cur;
  db.transaction(() => {
    db.prepare(`UPDATE invoices SET status='cancelled', cancelled_at=datetime('now'), paid_note=?, updated_at=datetime('now') WHERE id=?`).run(s(reason, LIMITS.note), cur.id);
    // a payment nobody finished cannot succeed later: verify is only reached through a live callback on a sent invoice
    db.prepare(`UPDATE payments SET status='cancelled', updated_at=datetime('now') WHERE invoice_id=? AND status IN ('initiated','pending')`).run(cur.id);
  })();
  return getInvoice(id);
}

export function duplicateInvoice(id, { adminUser = '' } = {}) {
  const cur = getInvoice(id);
  if (!cur) throw new HttpError(404, 'not_found', 'Invoice not found');
  return createInvoice({
    customer_name: cur.customer_name, customer_phone: cur.customer_phone, customer_email: cur.customer_email, customer_company: cur.customer_company,
    language: cur.language, title: cur.title, description: cur.description, note_internal: cur.note_internal, lead_id: cur.lead_id,
    discount_toman: cur.discount_toman, tax_percent: cur.tax_percent, items: cur.items.map(({ title, qty, unit_toman }) => ({ title, qty, unit_toman })),
  }, { adminUser });
}

// what the public pay page / receipt may see (no internal note, no lead id)
export function publicInvoice(inv) {
  if (!inv) return null;
  const { note_internal, lead_id, created_by, ...rest } = inv;
  return { ...rest, payments: inv.payments.map(({ id, gateway, status, amount_toman, ref_id, card_pan, verified_at, created_at }) => ({ id, gateway, status, amount_toman, ref_id, card_pan, verified_at, created_at })) };
}
