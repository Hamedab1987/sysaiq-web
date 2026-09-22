// SMS subsystem: templates + send log, seeded with the six default bilingual
// templates. Range 100–199 belongs to SMS (see conventions). Everything is
// additive; the seed uses INSERT OR IGNORE so a re-run or an owner-edited
// template is never overwritten. leads.phone_norm is normally added by 011,
// guarded here in case this database skipped it.
//
// Imports nothing from the app on purpose (db/index.js is mid-await while
// migrations load).
export const version = 100;
export const name = 'sms';

// Placeholder syntax is {{var}}; `variables` lists what the template expects
// so the admin UI can show the counter and sample values. `provider_map` is
// the per-provider pattern mapping the owner fills in after approving the
// pattern in the provider's panel:
//   { kavenegar: {template, tokens?}, smsir: {templateId, params?},
//     ghasedak: {templateName, inputs?}, ippanel: {code, params?},
//     melipayamak: {bodyId, order?}, mock: {template} }
// The pay link is fixed text + a 12-char code because SMS.ir caps pattern
// values at 25 characters.
export const DEFAULT_TEMPLATES = [
  {
    key: 'lead_owner',
    label_fa: 'هشدار سرنخ جدید (به مالک)',
    label_en: 'New lead alert (to owner)',
    body_fa: 'SysaiQ: سرنخ جدید #{{id}} — {{name}} — {{phone}} — {{service}}',
    body_en: 'SysaiQ: new lead #{{id}} — {{name}} — {{phone}} — {{service}}',
    variables: ['id', 'name', 'phone', 'service'],
  },
  {
    key: 'lead_customer',
    label_fa: 'تأیید دریافت درخواست (به مشتری)',
    label_en: 'Request received (to customer)',
    body_fa: '{{name}} عزیز، درخواست شما در SysaiQ ثبت شد. در اولین فرصت با شما تماس می‌گیریم.',
    body_en: 'Dear {{name}}, SysaiQ has received your request. We will be in touch soon.',
    variables: ['name'],
  },
  {
    key: 'invoice_link',
    label_fa: 'لینک پرداخت فاکتور',
    label_en: 'Invoice pay link',
    body_fa: '{{name}} عزیز، فاکتور {{number}} SysaiQ به مبلغ {{amount}} تومان صادر شد. پرداخت: sysaiq.com/p/{{code}}',
    body_en: 'Dear {{name}}, SysaiQ invoice {{number}} for {{amount}} Toman is ready. Pay: sysaiq.com/p/{{code}}',
    variables: ['name', 'number', 'amount', 'code'],
  },
  {
    key: 'invoice_reminder',
    label_fa: 'یادآوری پرداخت فاکتور',
    label_en: 'Invoice payment reminder',
    body_fa: '{{name}} عزیز، یادآوری: فاکتور {{number}} SysaiQ به مبلغ {{amount}} تومان در انتظار پرداخت است. sysaiq.com/p/{{code}}',
    body_en: 'Dear {{name}}, reminder: SysaiQ invoice {{number}} for {{amount}} Toman is awaiting payment. sysaiq.com/p/{{code}}',
    variables: ['name', 'number', 'amount', 'code'],
  },
  {
    key: 'payment_customer',
    label_fa: 'رسید پرداخت (به مشتری)',
    label_en: 'Payment receipt (to customer)',
    body_fa: '{{name}} عزیز، پرداخت {{amount}} تومان بابت فاکتور {{number}} SysaiQ ثبت شد. کد پیگیری: {{ref}}. سپاسگزاریم.',
    body_en: 'Dear {{name}}, your payment of {{amount}} Toman for SysaiQ invoice {{number}} was received. Ref: {{ref}}. Thank you.',
    variables: ['name', 'amount', 'number', 'ref'],
  },
  {
    key: 'payment_owner',
    label_fa: 'هشدار پرداخت (به مالک)',
    label_en: 'Payment alert (to owner)',
    body_fa: 'SysaiQ: پرداخت {{amount}} تومان بابت فاکتور {{number}} ({{name}}) — وضعیت: {{status}}',
    body_en: 'SysaiQ: payment of {{amount}} Toman for invoice {{number}} ({{name}}) — status: {{status}}',
    variables: ['amount', 'number', 'name', 'status'],
  },
];

export function up(db, ctx) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sms_templates (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      key          TEXT UNIQUE NOT NULL,            -- lead_owner … | owner-created slug
      label_fa     TEXT NOT NULL DEFAULT '',
      label_en     TEXT NOT NULL DEFAULT '',
      body_fa      TEXT NOT NULL DEFAULT '',        -- text with {{var}} placeholders
      body_en      TEXT NOT NULL DEFAULT '',
      variables    TEXT NOT NULL DEFAULT '[]',      -- JSON ["name", …]
      provider_map TEXT NOT NULL DEFAULT '{}',      -- JSON {providerId: pattern mapping}
      is_system    INTEGER NOT NULL DEFAULT 0,      -- seeded: key fixed, never deletable
      enabled      INTEGER NOT NULL DEFAULT 1,
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- one row per send attempt (a fallback or an admin retry is a new row)
    CREATE TABLE IF NOT EXISTS sms_log (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      kind              TEXT NOT NULL DEFAULT 'auto',    -- auto | manual | test
      template_key      TEXT NOT NULL DEFAULT '',        -- '' for free text
      provider          TEXT NOT NULL DEFAULT '',
      mode              TEXT NOT NULL DEFAULT 'simple',  -- simple | pattern
      to_number         TEXT NOT NULL,                   -- 09xxxxxxxxx
      lang              TEXT NOT NULL DEFAULT 'fa',      -- fa | en (template language used)
      text              TEXT NOT NULL DEFAULT '',        -- rendered text as the recipient reads it
      vars              TEXT NOT NULL DEFAULT '{}',      -- JSON, sanitised values (for pattern retries)
      segments          INTEGER NOT NULL DEFAULT 1,
      status            TEXT NOT NULL DEFAULT 'queued',  -- queued | sent | delivered | undelivered | failed | blocked | skipped
      error_code        TEXT NOT NULL DEFAULT '',        -- normalised (see sms/errors.js) or skip reason
      error_message     TEXT NOT NULL DEFAULT '',        -- provider text, capped
      message_id        TEXT NOT NULL DEFAULT '',        -- provider message id
      cost              REAL,                            -- provider-reported, unit per provider
      dedupe_key        TEXT NOT NULL DEFAULT '',
      lead_id           INTEGER,
      invoice_id        INTEGER,
      payment_id        INTEGER,
      attempt           INTEGER NOT NULL DEFAULT 1,      -- 2 = fallback provider
      retry_of          INTEGER,                         -- sms_log.id this row retries
      admin_user        TEXT NOT NULL DEFAULT '',        -- manual/test/retry sends
      sent_at           TEXT,
      status_checked_at TEXT,
      updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sms_log_created ON sms_log (created_at);
    CREATE INDEX IF NOT EXISTS idx_sms_log_to      ON sms_log (to_number, created_at);
    CREATE INDEX IF NOT EXISTS idx_sms_log_dedupe  ON sms_log (dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_sms_log_lead    ON sms_log (lead_id);
    CREATE INDEX IF NOT EXISTS idx_sms_log_status  ON sms_log (status, created_at);
  `);

  // 011 adds this on every known database; keep the guard for a copy that skipped it
  if (!ctx.hasColumn('leads', 'phone_norm')) {
    ctx.addColumn('leads', 'phone_norm', "TEXT NOT NULL DEFAULT ''");
  }

  const seed = db.prepare(`INSERT OR IGNORE INTO sms_templates
    (key, label_fa, label_en, body_fa, body_en, variables, provider_map, is_system, enabled)
    VALUES (@key, @label_fa, @label_en, @body_fa, @body_en, @variables, '{}', 1, 1)`);
  for (const t of DEFAULT_TEMPLATES) {
    seed.run({ ...t, variables: JSON.stringify(t.variables) });
  }
}
