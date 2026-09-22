// Server-rendered pages (/:lang/:slug) — plan §4. The system pages the
// owner (and enamad) expect are seeded here as UNPUBLISHED drafts with only a
// title and a "⟦draft⟧" body: the writers fill them in a later wave and the
// owner publishes after review. `system_key` pins a row to its role so the
// admin cannot delete it or change its slug (409 in routes/admin/pages.routes.js).
// `contact` is deliberately NOT a pages row: /:lang/contact is rendered from
// site info by routes/public/contact.routes.js and the slug is reserved
// (migration 012 removes the row this file seeded before that was settled).
// Imports nothing from db/index.js (see the contract's migration import rule).
export const version = 8;
export const name = 'pages';

// slug → [kind, title_fa, title_en]. Titles are the plan's Persian titles.
export const SYSTEM_PAGES = Object.freeze([
  ['about',      'custom', 'دربارهٔ ما',                          'About us'],
  ['terms',      'legal',  'قوانین و مقررات',                      'Terms and conditions'],
  ['privacy',    'legal',  'حریم خصوصی',                          'Privacy policy'],
  ['refund',     'legal',  'شرایط لغو و بازپرداخت',               'Cancellation and refund policy'],
  ['complaints', 'custom', 'ثبت شکایت و پیگیری',                  'Complaints and follow-up'],
  ['pricing',    'custom', 'نحوهٔ محاسبهٔ هزینه',                 'How cost is calculated'],
  ['charter',    'legal',  'شیوه‌نامهٔ ارائهٔ خدمات',              'Service charter'],
  ['contract',   'legal',  'چارچوب قرارداد و تعهدات طرفین',       'Contract framework and mutual obligations'],
  ['faq',        'custom', 'سؤالات متداول',                       'Frequently asked questions'],
]);

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pages (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      slug           TEXT NOT NULL UNIQUE,
      kind           TEXT NOT NULL DEFAULT 'custom',           -- custom | legal
      system_key     TEXT UNIQUE,                              -- about | contact | terms … (NULL for owner-made pages)
      title_en       TEXT NOT NULL DEFAULT '',
      title_fa       TEXT NOT NULL DEFAULT '',
      body_en        TEXT NOT NULL DEFAULT '',                 -- markdown subset with {{site.*}} tokens
      body_fa        TEXT NOT NULL DEFAULT '',
      meta_desc_en   TEXT NOT NULL DEFAULT '',
      meta_desc_fa   TEXT NOT NULL DEFAULT '',
      show_in_footer INTEGER NOT NULL DEFAULT 0,
      show_in_nav    INTEGER NOT NULL DEFAULT 0,
      noindex        INTEGER NOT NULL DEFAULT 0,
      version        TEXT NOT NULL DEFAULT '',                 -- legal pages: "1.0"
      effective_at   TEXT NOT NULL DEFAULT '',                 -- legal pages: ISO date the version applies from
      legal_reviewed_at TEXT NOT NULL DEFAULT '',              -- stays empty until a human lawyer signs off
      sort           INTEGER NOT NULL DEFAULT 0,
      published      INTEGER NOT NULL DEFAULT 0,
      created_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by     TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_pages_pub ON pages (published, sort);
  `);

  const ins = db.prepare(`INSERT OR IGNORE INTO pages
    (slug, kind, system_key, title_en, title_fa, body_en, body_fa, show_in_footer, sort, published, updated_by)
    VALUES (@slug, @kind, @slug, @title_en, @title_fa, '⟦draft⟧', '⟦پیش‌نویس⟧', @footer, @sort, 0, 'migration-008')`);
  SYSTEM_PAGES.forEach(([slug, kind, title_fa, title_en], i) => {
    // legal pages belong in the footer's "قوانین و اعتماد" column once published
    ins.run({ slug, kind, title_en, title_fa, footer: kind === 'legal' || slug === 'complaints' || slug === 'pricing' ? 1 : 0, sort: (i + 1) * 10 });
  });
}
