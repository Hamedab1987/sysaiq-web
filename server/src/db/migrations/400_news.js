// News pipeline tables (range 400–499): feed sources, collected items (every
// AI-written item lands as a draft — the owner publishes by hand), and one
// row per pipeline run (the unfinished row doubles as the overlap lock).
//
// Imports nothing on purpose: db/index.js is still awaiting runMigrations()
// while this file loads (see 002_secrets.js).
//
// Seeded sources: only feeds that answered 200 with a parseable RSS/Atom
// document (no redirect) on 2026-09-23. Not seeded because no working feed
// existed that day: Anthropic news (/rss.xml, /news/rss.xml → 404), Meta AI
// blog (ai.meta.com/blog/rss/ → 404), xAI (404), Microsoft AI blog
// (blogs.microsoft.com/ai/feed/ → 410), NVIDIA newsroom (HTML, not a feed),
// VentureBeat AI (429 to bots). The owner can add them in the admin later.

export const version = 400;
export const name = 'news';

export const NEWS_CATEGORIES = Object.freeze(['models', 'tools', 'devices', 'tech', 'industry']);

// [name, feed url, default category, language]
export const DEFAULT_SOURCES = Object.freeze([
  ['OpenAI News', 'https://openai.com/news/rss.xml', 'models', 'en'],
  ['Google DeepMind Blog', 'https://deepmind.google/blog/rss.xml', 'models', 'en'],
  ['Mistral AI News', 'https://mistral.ai/news/rss', 'models', 'en'],
  ['Google — AI (The Keyword)', 'https://blog.google/innovation-and-ai/technology/ai/rss/', 'tools', 'en'],
  ['Microsoft Source — AI', 'https://news.microsoft.com/source/topics/ai/feed/', 'tools', 'en'],
  ['Hugging Face Blog', 'https://huggingface.co/blog/feed.xml', 'tools', 'en'],
  ['NVIDIA Blog', 'https://blogs.nvidia.com/feed/', 'devices', 'en'],
  ['Google Research Blog', 'https://research.google/blog/rss/', 'tech', 'en'],
  ['Microsoft Research Blog', 'https://www.microsoft.com/en-us/research/feed/', 'tech', 'en'],
  ['MIT Technology Review — AI', 'https://www.technologyreview.com/topic/artificial-intelligence/feed', 'tech', 'en'],
  ['Meta Newsroom', 'https://about.fb.com/news/feed/', 'industry', 'en'],
  ['The Verge — AI', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', 'industry', 'en'],
  ['Ars Technica — AI', 'https://arstechnica.com/ai/feed/', 'industry', 'en'],
  ['TechCrunch — AI', 'https://techcrunch.com/category/artificial-intelligence/feed/', 'industry', 'en'],
]);

const CAT_CHECK = `CHECK (category IN (${NEWS_CATEGORIES.map(c => `'${c}'`).join(',')}))`;

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS news_sources (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      name            TEXT NOT NULL,
      url             TEXT NOT NULL UNIQUE,            -- https RSS/Atom feed
      category        TEXT NOT NULL DEFAULT 'industry' ${CAT_CHECK},
      lang            TEXT NOT NULL DEFAULT 'en',
      enabled         INTEGER NOT NULL DEFAULT 1,
      last_fetched_at TEXT,
      last_status     TEXT NOT NULL DEFAULT '',        -- ok | not_modified | error
      last_error      TEXT NOT NULL DEFAULT '',        -- short code, never a body
      items_seen      INTEGER NOT NULL DEFAULT 0,
      etag            TEXT NOT NULL DEFAULT '',        -- conditional GET
      last_modified   TEXT NOT NULL DEFAULT '',
      created_at      TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS news_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id     INTEGER REFERENCES news_sources(id) ON DELETE SET NULL,
      source_name   TEXT NOT NULL DEFAULT '',          -- kept when the source row is deleted
      url           TEXT NOT NULL UNIQUE,              -- normalised article URL
      url_hash      TEXT NOT NULL,
      title_src     TEXT NOT NULL DEFAULT '',
      excerpt_src   TEXT NOT NULL DEFAULT '',          -- plain text, ≤ 1500 chars
      published_src TEXT,                              -- ISO date from the feed
      fetched_at    TEXT NOT NULL DEFAULT (datetime('now')),
      status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','rejected','skipped')),
      importance    INTEGER CHECK (importance IS NULL OR importance BETWEEN 1 AND 5),
      category      TEXT NOT NULL DEFAULT 'industry' ${CAT_CHECK},
      slug          TEXT UNIQUE,                       -- set on first publish
      title_en      TEXT NOT NULL DEFAULT '',
      title_fa      TEXT NOT NULL DEFAULT '',
      summary_en    TEXT NOT NULL DEFAULT '',
      summary_fa    TEXT NOT NULL DEFAULT '',
      why_en        TEXT NOT NULL DEFAULT '',
      why_fa        TEXT NOT NULL DEFAULT '',
      tags          TEXT NOT NULL DEFAULT '[]',        -- JSON array of short keywords
      ai_at         TEXT,                              -- when the AI was asked (daily cap)
      ai_note       TEXT NOT NULL DEFAULT '',          -- error code / warning for the reviewer
      published_at  TEXT,
      reviewed_by   TEXT NOT NULL DEFAULT '',
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS news_items_status_pub ON news_items(status, published_at DESC);
    CREATE INDEX IF NOT EXISTS news_items_cat_status ON news_items(category, status, published_at DESC);
    CREATE INDEX IF NOT EXISTS news_items_url_hash ON news_items(url_hash);
    CREATE INDEX IF NOT EXISTS news_items_fetched ON news_items(fetched_at);
    CREATE INDEX IF NOT EXISTS news_items_ai_at ON news_items(ai_at);
    CREATE INDEX IF NOT EXISTS news_items_source ON news_items(source_id);

    CREATE TABLE IF NOT EXISTS news_runs (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      started_at     TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at    TEXT,                             -- NULL = running (the overlap lock)
      trigger        TEXT NOT NULL DEFAULT 'schedule', -- schedule | manual
      sources_ok     INTEGER NOT NULL DEFAULT 0,
      sources_failed INTEGER NOT NULL DEFAULT 0,
      items_new      INTEGER NOT NULL DEFAULT 0,
      items_drafted  INTEGER NOT NULL DEFAULT 0,
      items_skipped  INTEGER NOT NULL DEFAULT 0,
      error          TEXT NOT NULL DEFAULT ''          -- no_key | disabled | stale_lock | code
    );
    CREATE INDEX IF NOT EXISTS news_runs_open ON news_runs(finished_at, started_at);
  `);

  const ins = db.prepare('INSERT OR IGNORE INTO news_sources (name, url, category, lang) VALUES (?,?,?,?)');
  for (const s of DEFAULT_SOURCES) ins.run(...s);
}
