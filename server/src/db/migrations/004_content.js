// Home-page copy overrides: `content` (one row per key, NULL = "use the
// build.py default", '' = intentionally blank) + `content_revisions` (every
// write, newest last). Defaults live in server/templates/content-defaults.json,
// so only what the owner changed is stored here.
//
// Legacy import: the pre-rebuild admin kept five home strings in `settings`
// (hero_h1, hero_note_l, hero_note_r, about_1, about_2). A value is carried
// over ONLY when it differs from the seed.js value after whitespace
// normalisation — an untouched seed row must keep following the template
// default. contact_email belongs to migration 005 (site_info), not here.
// The seed values are copied below because a migration may not import
// seed.js (it imports db/index.js — see the contract's import rule).
export const version = 4;
export const name = 'content';

export const LEGACY_MAP = Object.freeze({
  hero_h1: 'HERO_H1',
  hero_note_l: 'HERO_NOTE_L',
  hero_note_r: 'HERO_NOTE_R',
  about_1: 'FEAT1',
  about_2: 'FEAT2',
});

// server/src/seed.js SETTINGS, verbatim (minus contact_email). Exported for
// lib/content.js, whose legacy bridge writes these back into `settings`
// when the owner resets a mirrored key.
export const LEGACY_SEED = Object.freeze({
  hero_h1: { en: "I don't just build websites", fa: 'من فقط وب‌سایت نمی‌سازم' },
  hero_note_l: {
    en: 'AI & software developer — websites · custom apps · automation · accounting & trading systems.',
    fa: 'AI & Software Developer — وب‌سایت · اپ اختصاصی · اتوماسیون · سیستم‌های حسابداری و معاملاتی.',
  },
  hero_note_r: {
    en: 'I design and build intelligent digital systems — software, AI, automation, data and modern interfaces, combined into one living whole and shaped around your actual problem.',
    fa: 'برای کسب‌وکارها سیستم‌های دیجیتال هوشمند می‌سازم؛ ترکیبی از نرم‌افزار، AI، اتوماسیون، داده و طراحی — از وب‌سایت اختصاصی تا AI Agent و سیستم‌های پیچیده‌تر، بر اساس مسئله‌ی واقعی شما.',
  },
  about_1: {
    en: 'SysaiQ is a one-person systems lab. I design and build intelligent digital systems that combine software, AI, automation, data and modern interfaces — from custom websites and apps to AI agents and automated workflows.',
    fa: 'SysaiQ یک لابراتوار سیستم‌سازیِ تک‌نفره است. سیستم‌های دیجیتال هوشمند طراحی و پیاده‌سازی می‌کنم؛ ترکیبی از نرم‌افزار، AI، اتوماسیون، داده و رابط‌های مدرن — از وب‌سایت و اپ اختصاصی تا AI Agent و فرایندهای خودکار.',
  },
  about_2: {
    en: 'Every build starts from the actual business problem, not a template: accounting and trading systems, process automation, integrations between the tools you already use — engineered end to end.',
    fa: 'هر پروژه از مسئله‌ی واقعی کسب‌وکار شروع می‌شود، نه از قالب آماده: سیستم حسابداری و معاملاتی، اتوماسیون فرایندها، و اتصال ابزارهایی که همین حالا استفاده می‌کنید — مهندسی‌شده از ابتدا تا انتها.',
  },
});

const norm = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// {en, fa} of a legacy settings row, or null when it is missing/unusable
function legacyValue(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key=?').get(key);
  if (!row) return null;
  let v = null;
  try { v = JSON.parse(row.value); } catch { return null; }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  return v;
}

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS content (
      key        TEXT PRIMARY KEY CHECK (key GLOB '[A-Z0-9_]*' AND NOT key GLOB '*[^A-Z0-9_]*'),
      en         TEXT,                                     -- NULL = default, '' = blank
      fa         TEXT,
      is_custom  INTEGER NOT NULL DEFAULT 0,               -- 1 = owner-created X_* key
      label_fa   TEXT NOT NULL DEFAULT '',                 -- custom keys only (registered ones label from the defaults file)
      label_en   TEXT NOT NULL DEFAULT '',
      type       TEXT NOT NULL DEFAULT 'plain' CHECK (type IN ('plain', 'inline')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_by TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS content_revisions (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      key      TEXT NOT NULL,
      en       TEXT,                                       -- the values as stored after the write
      fa       TEXT,
      at       TEXT NOT NULL DEFAULT (datetime('now')),
      admin_id INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_content_rev_key ON content_revisions (key, id);
  `);

  const insert = db.prepare(`INSERT INTO content (key, en, fa, is_custom, type, updated_by)
    VALUES (@key, @en, @fa, 0, 'plain', 'migration-004')
    ON CONFLICT(key) DO NOTHING`);
  const imported = [];
  const unchanged = [];
  for (const [legacyKey, key] of Object.entries(LEGACY_MAP)) {
    const v = legacyValue(db, legacyKey);
    if (!v) continue;
    const seed = LEGACY_SEED[legacyKey];
    const out = { key, en: null, fa: null };
    const langs = [];
    for (const lang of ['en', 'fa']) {
      if (typeof v[lang] !== 'string') continue;
      if (norm(v[lang]) === norm(seed[lang])) continue;
      out[lang] = v[lang]; // legacy values are plain text: stored as-is
      langs.push(lang);
    }
    if (langs.length) { insert.run(out); imported.push(`${key}.${langs.join('+')}`); } else unchanged.push(key);
  }
  if (process.env.NODE_ENV !== 'test') {
    console.log(`[migrate 004] legacy site copy → content: ${imported.length ? `imported ${imported.join(', ')}` : 'nothing edited'}${unchanged.length ? `; kept defaults for ${unchanged.join(', ')}` : ''}`);
  }
}
