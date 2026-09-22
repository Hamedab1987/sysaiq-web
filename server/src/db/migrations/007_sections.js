// Home-page sections the owner composes in the admin (plan §2 data model).
// A section is one block rendered into a home slot (after_about / after_work /
// after_faq) by render/slots/sections_after_*.js. `items` is a JSON array
// whose shape depends on `type` (validated in routes/admin/sections.routes.js).
// Imports nothing from db/index.js (see the contract's migration import rule).
export const version = 7;
export const name = 'sections';

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sections (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      slug          TEXT NOT NULL UNIQUE,                      -- also the DOM id on the home page
      type          TEXT NOT NULL DEFAULT 'richtext',          -- richtext | cards | steps | stats | cta | pricing
      theme         TEXT NOT NULL DEFAULT 'light',             -- light | dark
      placement     TEXT NOT NULL DEFAULT 'after_about',       -- after_about | after_work | after_faq
      eyebrow       TEXT NOT NULL DEFAULT '',                  -- mono LTR label, e.g. "SYSAIQ—PROCESS / SYS.05"
      title_en      TEXT NOT NULL DEFAULT '',
      title_fa      TEXT NOT NULL DEFAULT '',
      body_en       TEXT NOT NULL DEFAULT '',                  -- markdown subset (lib/markdown.js)
      body_fa       TEXT NOT NULL DEFAULT '',
      items         TEXT NOT NULL DEFAULT '[]',                -- JSON, type-specific (max 24 items)
      cta_label_en  TEXT NOT NULL DEFAULT '',
      cta_label_fa  TEXT NOT NULL DEFAULT '',
      cta_href      TEXT NOT NULL DEFAULT '',                  -- site-relative or https
      show_in_nav   INTEGER NOT NULL DEFAULT 0,
      nav_label_en  TEXT NOT NULL DEFAULT '',
      nav_label_fa  TEXT NOT NULL DEFAULT '',
      sort          INTEGER NOT NULL DEFAULT 0,
      published     INTEGER NOT NULL DEFAULT 0,
      created_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_sections_place ON sections (placement, published, sort);
  `);
}
