// news_sources CRUD + a feed probe used by the admin's «آزمایش خوراک».
import { db } from '../db/index.js';
import { HttpError } from '../lib/errors.js';
import { fetchText, errorCode } from './fetch.js';
import { parseFeed } from './parse.js';

const COLS = ['name', 'url', 'category', 'lang', 'enabled'];

export const listSources = () => db.prepare(`SELECT s.*,
    (SELECT COUNT(*) FROM news_items i WHERE i.source_id = s.id) AS items_total,
    (SELECT COUNT(*) FROM news_items i WHERE i.source_id = s.id AND i.status = 'published') AS items_published
  FROM news_sources s ORDER BY s.enabled DESC, s.category, s.name`).all();
export const getSource = id => db.prepare('SELECT * FROM news_sources WHERE id=?').get(id);
export const enabledSources = () => db.prepare('SELECT * FROM news_sources WHERE enabled=1 ORDER BY id').all();

const conflict = e => (e?.code === 'SQLITE_CONSTRAINT_UNIQUE'
  ? new HttpError(409, 'conflict', 'This feed is already in the list', { url: 'already added' }) : e);

export function createSource(b) {
  const row = { name: '', url: '', category: 'industry', lang: 'en', enabled: 1, ...b };
  row.enabled = row.enabled ? 1 : 0;
  try {
    const r = db.prepare(`INSERT INTO news_sources (${COLS.join(',')}) VALUES (${COLS.map(c => `@${c}`).join(',')})`).run(row);
    return getSource(r.lastInsertRowid);
  } catch (e) { throw conflict(e); }
}

export function updateSource(id, patch) {
  const cur = getSource(id);
  if (!cur) return null;
  const next = { ...cur, ...patch, id };
  next.enabled = next.enabled ? 1 : 0;
  // a new URL means the old validators no longer apply
  const reset = patch.url !== undefined && patch.url !== cur.url;
  try {
    db.prepare(`UPDATE news_sources SET ${COLS.map(c => `${c}=@${c}`).join(',')}${reset ? ", etag='', last_modified=''" : ''} WHERE id=@id`).run(next);
  } catch (e) { throw conflict(e); }
  return getSource(id);
}

export function deleteSource(id) {
  return db.prepare('DELETE FROM news_sources WHERE id=?').run(id).changes > 0;
}

export function recordFetch(id, { status, error = '', itemsSeen = 0, etag, lastModified } = {}) {
  db.prepare(`UPDATE news_sources SET last_fetched_at=datetime('now'), last_status=?, last_error=?,
      items_seen=items_seen+?, etag=COALESCE(?, etag), last_modified=COALESCE(?, last_modified) WHERE id=?`)
    .run(status, String(error).slice(0, 80), itemsSeen, etag ?? null, lastModified ?? null, id);
}

// fetch + parse without touching the database
export async function probeFeed(url) {
  try {
    const r = await fetchText(url, { kind: 'feed' });
    const feed = parseFeed(r.text, { baseUrl: r.url });
    return {
      ok: true, kind: feed.kind, title: feed.title, count: feed.items.length,
      titles: feed.items.slice(0, 3).map(i => i.title), redirected: r.url !== url ? r.url : '',
    };
  } catch (e) {
    return { ok: false, error: errorCode(e) };
  }
}
