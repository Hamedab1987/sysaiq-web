// Trust seals + verification meta tags (admin «اینماد و نمادها» / «سئو و تگ‌های تأیید»).
// A pasted eNamad/samandehi snippet is never stored: lib/trust.js parses it
// into seal_id + seal_code (+ the two validated URLs) and rebuilds canonical
// markup at render time. head_meta rows are <meta name content> pairs from a
// fixed allowlist of verification names (enamad, google-site-verification…).
export const version = 10;
export const name = 'badges_head_meta';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS badges (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      kind       TEXT NOT NULL,                    -- enamad | samandehi | custom_image
      seal_id    TEXT NOT NULL DEFAULT '',         -- numeric id from the snippet
      seal_code  TEXT NOT NULL DEFAULT '',         -- Code= / Verify p= from the snippet
      link_url   TEXT NOT NULL DEFAULT '',         -- https, host ∈ TRUST_HOSTS (custom: any https)
      img_url    TEXT NOT NULL DEFAULT '',         -- https trust host, or /uploads/… for custom
      label_en   TEXT NOT NULL DEFAULT '',
      label_fa   TEXT NOT NULL DEFAULT '',
      width      INTEGER NOT NULL DEFAULT 0,       -- 0 = attribute omitted
      height     INTEGER NOT NULL DEFAULT 0,
      placement  TEXT NOT NULL DEFAULT 'footer',   -- footer | contact | both
      langs      TEXT NOT NULL DEFAULT 'fa,en',    -- comma list of languages it shows on
      enabled    INTEGER NOT NULL DEFAULT 1,
      sort       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_badges_enabled ON badges (enabled, placement, sort);

    CREATE TABLE IF NOT EXISTS head_meta (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,                    -- allowlisted verification name (lib/trust.js)
      content    TEXT NOT NULL,                    -- [A-Za-z0-9_\\-=.:+/ ]{1,200}
      enabled    INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
