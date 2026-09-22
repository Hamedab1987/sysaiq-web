// Services catalogue (/:lang/services, /:lang/services/:slug) — plan §4.
// The 10 slugs are fixed (FACTS.md). Rows are seeded UNPUBLISHED with a
// bilingual title and related portfolio slugs only; the writers fill the
// bodies and the owner publishes. Every long field is markdown; the list
// fields are JSON arrays validated in routes/admin/services.routes.js.
// Imports nothing from db/index.js (see the contract's migration import rule).
export const version = 9;
export const name = 'services';

// slug → title_fa, title_en, related project slugs (from the 17 portfolio systems, by tag)
export const SERVICES = Object.freeze([
  ['custom-website',      'وب‌سایت اختصاصی',                 'Custom website',                ['hotel', 'school', 'architect-landing']],
  ['profession-landing',  'لندینگ‌پیج مشاغل و حرفه‌ها',       'Profession landing page',       ['law-landing', 'dental-landing', 'fitness-landing', 'cafe-landing']],
  ['web-app',             'وب‌اپلیکیشن و SaaS',              'Web application and SaaS',      ['restaurant', 'realestate', 'distribution', 'hr']],
  ['ecommerce',           'فروشگاه اینترنتی',                'E-commerce',                    ['ecommerce', 'pos']],
  ['mobile-app',          'اپلیکیشن موبایل (PWA)',           'Mobile app (PWA)',              ['salon', 'restaurant', 'medical']],
  ['ai-agent',            'AI Agent و چت‌بات',               'AI agents and chatbots',        ['realestate', 'medical', 'ecommerce']],
  ['automation',          'اتوماسیون فرایندهای کسب‌وکار',    'Business process automation',   ['distribution', 'hr', 'pos']],
  ['accounting-systems',  'سیستم‌های حسابداری',              'Accounting systems',            ['accounting', 'pos', 'hr']],
  ['trading-systems',     'نرم‌افزار تحلیل و بک‌تست معاملات', 'Trading analysis software',    ['trading']],
  ['support-maintenance', 'پشتیبانی و نگهداری',              'Support and maintenance',       ['hotel', 'school']],
]);

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS services (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      slug              TEXT NOT NULL UNIQUE,
      title_en          TEXT NOT NULL DEFAULT '',
      title_fa          TEXT NOT NULL DEFAULT '',
      tagline_en        TEXT NOT NULL DEFAULT '',              -- one line under the h1
      tagline_fa        TEXT NOT NULL DEFAULT '',
      summary_en        TEXT NOT NULL DEFAULT '',              -- index card text (inline markup)
      summary_fa        TEXT NOT NULL DEFAULT '',
      audience_en       TEXT NOT NULL DEFAULT '',              -- markdown: who this is for
      audience_fa       TEXT NOT NULL DEFAULT '',
      problems_en       TEXT NOT NULL DEFAULT '',              -- markdown: problems it solves
      problems_fa       TEXT NOT NULL DEFAULT '',
      deliverables      TEXT NOT NULL DEFAULT '[]',            -- JSON [{en, fa}] checklist
      process           TEXT NOT NULL DEFAULT '[]',            -- JSON [{title_en,title_fa,desc_en,desc_fa}] steps
      timeline_en       TEXT NOT NULL DEFAULT '',              -- markdown; empty → "stated in the written proposal"
      timeline_fa       TEXT NOT NULL DEFAULT '',
      price_approach_en TEXT NOT NULL DEFAULT '',              -- markdown: how cost is calculated (never figures)
      price_approach_fa TEXT NOT NULL DEFAULT '',
      faqs              TEXT NOT NULL DEFAULT '[]',            -- JSON [{q_en,q_fa,a_en,a_fa}]
      related_projects  TEXT NOT NULL DEFAULT '[]',            -- JSON [slug]
      meta_desc_en      TEXT NOT NULL DEFAULT '',
      meta_desc_fa      TEXT NOT NULL DEFAULT '',
      icon              TEXT NOT NULL DEFAULT '',              -- short key for the index card glyph
      sort              INTEGER NOT NULL DEFAULT 0,
      published         INTEGER NOT NULL DEFAULT 0,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by        TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_services_pub ON services (published, sort);
  `);

  const ins = db.prepare(`INSERT OR IGNORE INTO services (slug, title_en, title_fa, related_projects, sort, published, updated_by)
    VALUES (@slug, @title_en, @title_fa, @related, @sort, 0, 'migration-009')`);
  SERVICES.forEach(([slug, title_fa, title_en, related], i) => {
    ins.run({ slug, title_en, title_fa, related: JSON.stringify(related), sort: (i + 1) * 10 });
  });
}
