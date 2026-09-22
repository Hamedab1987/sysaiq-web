// Audit trail + admin session bookkeeping.
// (002 is reserved for the secrets table — numbers are never reused.)
export const version = 3;
export const name = 'audit_admins';

export function up(db, ctx) {
  db.exec(`
    -- who changed what, when. Never holds request bodies or secret values.
    CREATE TABLE IF NOT EXISTS audit_log (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id    INTEGER,
      admin_name  TEXT NOT NULL DEFAULT '',
      action      TEXT NOT NULL,             -- create | update | delete | login | …
      entity      TEXT NOT NULL DEFAULT '',  -- projects | faqs | settings | …
      entity_id   TEXT NOT NULL DEFAULT '',
      summary     TEXT NOT NULL DEFAULT '',
      meta        TEXT NOT NULL DEFAULT '{}', -- small JSON
      ip          TEXT NOT NULL DEFAULT '',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at);
    CREATE INDEX IF NOT EXISTS idx_audit_entity  ON audit_log (entity, entity_id);
  `);

  // token_version: bumping it invalidates every cookie issued before
  ctx.addColumn('admins', 'token_version', 'INTEGER NOT NULL DEFAULT 0');
  ctx.addColumn('admins', 'pwd_changed_at', 'TEXT');
  ctx.addColumn('admins', 'last_login_at', 'TEXT');
}
