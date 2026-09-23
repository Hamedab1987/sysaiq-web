// news_items helpers shared by the scheduler and the admin routes.
// Status flow: collected → draft → (AI) draft | skipped → owner: published | rejected.
// Nothing here publishes on its own: publishItem() is only called from an
// admin request.
import { db } from '../db/index.js';
import { HttpError } from '../lib/errors.js';
import { slugify } from '../lib/slug.js';
import { J } from '../lib/html.js';
import { normalizeUrl, urlHash, MAX_AGE_DAYS } from './dedupe.js';
import { fetchText, pageSummary, pageExcerpt, errorCode } from './fetch.js';
import { parseFeed, looksLikeFeed, clip, MAX_SUMMARY } from './parse.js';
import { summarize } from './summarize.js';
import { getNewsConfig, CATEGORIES } from './config.js';

export const REQUIRED_FOR_PUBLISH = ['title_fa', 'summary_fa', 'title_en', 'summary_en'];

export const getItem = id => db.prepare('SELECT * FROM news_items WHERE id=?').get(id);
export const itemByHash = hash => db.prepare('SELECT id, status FROM news_items WHERE url_hash=?').get(hash);

// admin-facing shape
export function formatItem(row) {
  if (!row) return null;
  return {
    ...row,
    tags: J(row.tags).filter(t => typeof t === 'string'),
    ai_pending: row.status === 'draft' && !row.ai_at,
    public_path: row.status === 'published' && row.slug ? `/fa/news/${row.slug}` : '',
  };
}

// titles collected in the freshness window (for the similarity check)
export const recentTitles = () => db.prepare(
  `SELECT id, title_src AS title FROM news_items WHERE fetched_at >= datetime('now', ?) ORDER BY id DESC LIMIT 3000`,
).all(`-${MAX_AGE_DAYS} days`);

// → new id, or 0 when the URL is already known
export function insertCollected({ source = null, sourceName = '', title, link, date = null, summary = '', category, status = 'draft', note = '' }) {
  const url = normalizeUrl(link);
  if (!url) return 0;
  const hash = urlHash(url);
  if (itemByHash(hash)) return 0;
  const r = db.prepare(`INSERT OR IGNORE INTO news_items
      (source_id, source_name, url, url_hash, title_src, excerpt_src, published_src, status, category, ai_note)
      VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(source?.id ?? null, clip(sourceName || source?.name || '', 120), url, hash, clip(title, 300), clip(summary, MAX_SUMMARY),
      date, status, CATEGORIES.includes(category) ? category : (source?.category || 'industry'), note);
  return r.changes ? Number(r.lastInsertRowid) : 0;
}

// store an AI result. ok → translations + importance (below the threshold →
// skipped); failure → the item stays a draft with its source text and empty
// translations, and ai_note tells the reviewer why. Published / rejected
// items are never touched.
export function applySummary(id, res, { minImportance = 0 } = {}) {
  if (res?.ok) {
    const f = res.fields;
    const below = minImportance && f.importance < minImportance;
    db.prepare(`UPDATE news_items SET importance=@importance, category=@category, title_fa=@title_fa, title_en=@title_en,
        summary_fa=@summary_fa, summary_en=@summary_en, why_fa=@why_fa, why_en=@why_en, tags=@tags,
        ai_at=datetime('now'), ai_note=@note, status=@status, updated_at=datetime('now')
      WHERE id=@id AND status IN ('draft','skipped')`)
      .run({ ...f, tags: JSON.stringify(f.tags), note: below ? 'below_min' : (res.note || ''), status: below ? 'skipped' : 'draft', id });
    return below ? 'skipped' : 'draft';
  }
  const err = String(res?.error || 'error').slice(0, 60);
  // no key: leave ai_at empty so the item is summarised once a key exists
  db.prepare(`UPDATE news_items SET ai_at=${err === 'no_key' ? 'NULL' : "datetime('now')"}, ai_note=?, updated_at=datetime('now')
    WHERE id=? AND status IN ('draft','skipped')`).run(err, id);
  return 'draft';
}

// the excerpt a feed gives is sometimes empty or one line: read the article's
// own description before asking the model (same SSRF guard, best effort)
export async function enrichExcerpt(item) {
  if ((item.excerpt_src || '').length >= 200) return item.excerpt_src;
  try {
    const r = await fetchText(item.url, { kind: 'page' });
    if (looksLikeFeed(r.text)) return item.excerpt_src;
    const better = pageExcerpt(pageSummary(r.text));
    if (better.length > (item.excerpt_src || '').length) {
      db.prepare('UPDATE news_items SET excerpt_src=? WHERE id=?').run(better, item.id);
      return better;
    }
  } catch { /* keep the feed excerpt */ }
  return item.excerpt_src;
}

export async function summarizeItem(item, { minImportance = 0, model = '', enrich = true } = {}) {
  const excerpt = enrich ? await enrichExcerpt(item) : item.excerpt_src;
  const res = await summarize({ title: item.title_src, excerpt, source: item.source_name, published: item.published_src || '' }, { model });
  return { status: applySummary(item.id, res, { minImportance }), res };
}

// ---- publishing ------------------------------------------------------------
const has = x => !!String(x ?? '').trim();
export function missingForPublish(item) {
  const fields = {};
  for (const k of REQUIRED_FOR_PUBLISH) if (!has(item[k])) fields[k] = `${k} is required to publish`;
  return fields;
}

// slug from the English title, ≤ 64 chars cut at a dash, unique among items
export function uniqueSlug(titleEn, selfId) {
  let base = slugify(titleEn);
  if (base.length > 60) base = base.slice(0, 60).replace(/-[^-]*$/, '');
  base = base.replace(/^-+|-+$/g, '') || `news-${selfId}`;
  const taken = s => db.prepare('SELECT 1 FROM news_items WHERE slug=? AND id<>?').get(s, selfId);
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  return slug;
}

export function publishItem(id, admin = '') {
  const item = getItem(id);
  if (!item) throw new HttpError(404, 'not_found', 'News item not found');
  const missing = missingForPublish(item);
  if (Object.keys(missing).length) throw new HttpError(422, 'validation', 'Both languages are required to publish', missing);
  const slug = item.slug || uniqueSlug(item.title_en, id);
  db.prepare(`UPDATE news_items SET status='published', slug=?, published_at=COALESCE(published_at, datetime('now')),
      reviewed_by=?, updated_at=datetime('now') WHERE id=?`).run(slug, String(admin).slice(0, 60), id);
  return getItem(id);
}

export function setStatus(id, status, admin = '') {
  const r = db.prepare(`UPDATE news_items SET status=?, reviewed_by=?, updated_at=datetime('now') WHERE id=?`)
    .run(status, String(admin).slice(0, 60), id);
  return r.changes ? getItem(id) : null;
}

// ---- manual draft from a link ------------------------------------------------
export async function draftFromUrl(rawUrl, { admin = '' } = {}) {
  const url = normalizeUrl(rawUrl);
  if (!url) throw new HttpError(422, 'validation', 'Validation failed', { url: 'not a valid link' });
  const known = itemByHash(urlHash(url));
  if (known) throw new HttpError(409, 'duplicate', 'This link is already in the news list', { id: String(known.id) });

  let r;
  try { r = await fetchText(url, { kind: 'page' }); } catch (e) {
    throw new HttpError(422, 'fetch_failed', 'The link could not be read', { url: errorCode(e) });
  }
  let entry;
  if (looksLikeFeed(r.text)) {
    let feed;
    try { feed = parseFeed(r.text, { baseUrl: r.url }); } catch (e) { throw new HttpError(422, 'fetch_failed', 'The feed could not be read', { url: errorCode(e) }); }
    const want = urlHash(url);
    const it = feed.items.find(i => urlHash(i.link) === want) || feed.items[0];
    if (!it) throw new HttpError(422, 'fetch_failed', 'The feed has no items', { url: 'empty_feed' });
    entry = { title: it.title, link: it.link, date: it.date, summary: it.summary, sourceName: feed.title };
  } else {
    const p = pageSummary(r.text);
    entry = { title: p.title, link: r.url || url, date: p.published, summary: pageExcerpt(p), sourceName: p.siteName || new URL(r.url || url).hostname.replace(/^www\./, '') };
  }
  if (!entry.title) throw new HttpError(422, 'fetch_failed', 'No title found at this link', { url: 'no_content' });
  const finalKnown = itemByHash(urlHash(entry.link));
  if (finalKnown) throw new HttpError(409, 'duplicate', 'This link is already in the news list', { id: String(finalKnown.id) });

  const id = insertCollected({ sourceName: entry.sourceName, title: entry.title, link: entry.link, date: entry.date, summary: entry.summary, category: 'industry', note: 'manual' });
  if (!id) throw new HttpError(409, 'duplicate', 'This link is already in the news list');
  if (admin) db.prepare('UPDATE news_items SET reviewed_by=? WHERE id=?').run(String(admin).slice(0, 60), id);
  // the owner asked for this one: it stays a draft whatever its importance
  const cfg = getNewsConfig();
  await summarizeItem(getItem(id), { minImportance: 0, model: cfg.model, enrich: false });
  return getItem(id);
}
