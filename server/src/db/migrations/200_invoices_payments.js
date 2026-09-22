// Invoices + pay-link payments (range 200–299 = payments). Additive only.
// Imports nothing from the app on purpose (db/index.js is mid-await while
// migrations load).
//
// Money is integer Toman everywhere; the gateway wire unit (Rial for
// Zarinpal/Zibal) is applied only in payments/gateways/*.toWire().
//   invoices.status   draft → sent → paid | cancelled | expired  (expired → sent on resend)
//   payments.status   initiated → pending → verifying → succeeded | failed | cancelled | expired | orphaned
//   ux_pay_one_success  one succeeded payment per invoice — last line of defence
//                       against a double charge (violation ⇒ 'orphaned' + owner alert)
//   ux_pay_authority    one payment row per (gateway, authority): a replayed
//                       gateway id can never create a second row
export const version = 200;
export const name = 'invoices_payments';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_counters (
      jyear INTEGER PRIMARY KEY,                       -- Jalali year of issue (SQ-{jyear}-{seq})
      seq   INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      number           TEXT NOT NULL UNIQUE,            -- SQ-1405-0001
      token            TEXT NOT NULL UNIQUE,            -- randomBytes(24) base64url — the pay-page secret
      short_code       TEXT NOT NULL UNIQUE,            -- 12-char Crockford base32 for /p/:code (SMS)
      status           TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | paid | cancelled | expired
      lead_id          INTEGER,
      customer_name    TEXT NOT NULL DEFAULT '',
      customer_phone   TEXT NOT NULL DEFAULT '',        -- 09xxxxxxxxx (normalised) or ''
      customer_email   TEXT NOT NULL DEFAULT '',
      customer_company TEXT NOT NULL DEFAULT '',
      language         TEXT NOT NULL DEFAULT 'fa',      -- fa | en (pay page + messages)
      title            TEXT NOT NULL DEFAULT '',        -- "وب‌سایت شرکتی — مرحلهٔ ۱"
      description      TEXT NOT NULL DEFAULT '',        -- plain text shown on the pay page
      note_internal    TEXT NOT NULL DEFAULT '',        -- owner-only
      subtotal_toman   INTEGER NOT NULL DEFAULT 0,
      discount_toman   INTEGER NOT NULL DEFAULT 0,
      tax_percent      INTEGER NOT NULL DEFAULT 0,      -- optional VAT, whole percent
      tax_toman        INTEGER NOT NULL DEFAULT 0,
      amount_toman     INTEGER NOT NULL DEFAULT 0,      -- payable total
      due_at           TEXT,                            -- ISO; sent invoices expire lazily after this
      sent_at          TEXT,
      paid_at          TEXT,
      cancelled_at     TEXT,
      paid_method      TEXT NOT NULL DEFAULT '',        -- gateway id | manual
      paid_ref         TEXT NOT NULL DEFAULT '',        -- gateway ref id | bank receipt reference
      paid_note        TEXT NOT NULL DEFAULT '',
      reminder_count   INTEGER NOT NULL DEFAULT 0,
      last_reminded_at TEXT,
      created_by       TEXT NOT NULL DEFAULT '',
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_status  ON invoices (status, created_at);
    CREATE INDEX IF NOT EXISTS idx_invoices_lead    ON invoices (lead_id);

    CREATE TABLE IF NOT EXISTS invoice_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
      sort        INTEGER NOT NULL DEFAULT 0,
      title       TEXT NOT NULL DEFAULT '',
      qty         INTEGER NOT NULL DEFAULT 1,
      unit_toman  INTEGER NOT NULL DEFAULT 0,
      total_toman INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id, sort);

    CREATE TABLE IF NOT EXISTS payments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id       INTEGER NOT NULL REFERENCES invoices(id),
      gateway          TEXT NOT NULL,                   -- zarinpal | payping | zibal | mock | manual
      status           TEXT NOT NULL DEFAULT 'initiated',
      amount_toman     INTEGER NOT NULL,                -- snapshot at start: the ONLY amount ever verified
      authority        TEXT NOT NULL DEFAULT '',        -- gateway transaction id (authority / paymentCode / trackId)
      ref_id           TEXT NOT NULL DEFAULT '',        -- gateway reference after verify (or manual receipt ref)
      card_pan         TEXT NOT NULL DEFAULT '',        -- gateway-masked PAN only
      card_hash        TEXT NOT NULL DEFAULT '',
      fee_toman        INTEGER,
      already_verified INTEGER NOT NULL DEFAULT 0,
      error_code       TEXT NOT NULL DEFAULT '',
      error_message    TEXT NOT NULL DEFAULT '',
      raw_create       TEXT NOT NULL DEFAULT '{}',      -- redacted gateway payloads
      raw_callback     TEXT NOT NULL DEFAULT '{}',
      raw_verify       TEXT NOT NULL DEFAULT '{}',
      ip_hash          TEXT NOT NULL DEFAULT '',
      claimed_at       TEXT,                            -- set by the atomic claim before verify
      verified_at      TEXT,
      created_at       TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments (invoice_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_payments_status  ON payments (status, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_one_success ON payments (invoice_id) WHERE status = 'succeeded';
    CREATE UNIQUE INDEX IF NOT EXISTS ux_pay_authority   ON payments (gateway, authority) WHERE authority <> '';
  `);
}
