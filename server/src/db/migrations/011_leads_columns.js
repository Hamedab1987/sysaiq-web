// Lead pipeline columns + admin notes. All additive with defaults, so the
// legacy INSERT (name…lead_score) keeps working and a code rollback is safe.
export const version = 11;
export const name = 'leads_columns';

export function up(db, ctx) {
  for (const [col, ddl] of [
    ['status', "TEXT NOT NULL DEFAULT 'new'"],       // new | contacted | qualified | won | lost | spam
    ['page', "TEXT NOT NULL DEFAULT ''"],            // page the form was on
    ['ip_hash', "TEXT NOT NULL DEFAULT ''"],         // HMAC-SHA256(SECRETS_KEY, ip), first 24 hex — see lib/leads.js hashIp(); never the raw ip
    ['phone_norm', "TEXT NOT NULL DEFAULT ''"],      // 09xxxxxxxxx when the phone is an Iranian mobile
    ['business_type', "TEXT NOT NULL DEFAULT ''"],
    ['service_slug', "TEXT NOT NULL DEFAULT ''"],
    ['contact_pref', "TEXT NOT NULL DEFAULT ''"],    // phone | email | whatsapp | telegram
    ['consent_at', 'TEXT'],
    ['session_id', "TEXT NOT NULL DEFAULT ''"],      // AI chat session that produced the lead
    ['next_followup_at', 'TEXT'],
    ['archived_at', 'TEXT'],
  ]) {
    ctx.addColumn('leads', col, ddl);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS lead_notes (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      body       TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      admin_user TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_lead_notes_lead ON lead_notes (lead_id);
    CREATE INDEX IF NOT EXISTS idx_leads_status ON leads (status, created_at);
  `);
}
