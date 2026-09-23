// The collection run and its timer.
//   await runNews({ trigger: 'schedule' | 'manual' }) → run summary
// A run: no OpenAI key → a run row with error 'no_key' and nothing fetched
// (collecting without being able to summarise only fills the queue with
// untranslated items). Otherwise: take the lock (an unfinished news_runs
// row; one older than LOCK_STALE_MIN is closed as stale_lock), fetch every
// enabled source (conditional GET, 4 at a time), keep items ≤ 10 days old
// and not seen before (URL hash + title similarity), then summarise the
// draft backlog newest first within the daily AI cap. Every AI result lands
// as a draft (or skipped below min_importance) — never published.
// The timer ticks every TICK_MS and starts a run when interval_hours have
// passed since the last one, so a changed interval applies without a restart.
import { db } from '../db/index.js';
import { emit } from '../lib/events.js';
import { getNewsConfig } from './config.js';
import { enabledSources, recordFetch } from './sources.js';
import { fetchText, errorCode } from './fetch.js';
import { parseFeed } from './parse.js';
import { isFresh, findSimilar, MAX_AGE_DAYS } from './dedupe.js';
import { insertCollected, recentTitles, summarizeItem, getItem } from './items.js';
import { hasNewsKey } from './summarize.js';

export const TICK_MS = 10 * 60_000;
export const LOCK_STALE_MIN = 30;
export const MAX_PER_SOURCE = 10;
const CONCURRENCY = 4;

const finish = (id, patch) => db.prepare(`UPDATE news_runs SET finished_at=datetime('now'), sources_ok=@sources_ok,
    sources_failed=@sources_failed, items_new=@items_new, items_drafted=@items_drafted, items_skipped=@items_skipped, error=@error WHERE id=@id`)
  .run({ sources_ok: 0, sources_failed: 0, items_new: 0, items_drafted: 0, items_skipped: 0, error: '', ...patch, id });

export const getRun = id => db.prepare('SELECT * FROM news_runs WHERE id=?').get(id);
export const lastRuns = (n = 20) => db.prepare('SELECT * FROM news_runs ORDER BY id DESC LIMIT ?').all(n);

// the lock: one open run at a time (better-sqlite3 is synchronous, so the
// check-and-insert inside an IMMEDIATE transaction cannot interleave)
export const acquireLock = db.transaction(trigger => {
  db.prepare(`UPDATE news_runs SET finished_at=datetime('now'), error='stale_lock'
    WHERE finished_at IS NULL AND started_at < datetime('now', ?)`).run(`-${LOCK_STALE_MIN} minutes`);
  const open = db.prepare('SELECT id FROM news_runs WHERE finished_at IS NULL ORDER BY id DESC LIMIT 1').get();
  if (open) return { ok: false, runId: open.id };
  const r = db.prepare('INSERT INTO news_runs (trigger) VALUES (?)').run(trigger);
  return { ok: true, runId: Number(r.lastInsertRowid) };
});

// AI calls made since midnight (UTC, SQLite's clock)
export const aiCallsToday = () => db.prepare("SELECT COUNT(*) c FROM news_items WHERE ai_at >= datetime('now', 'start of day')").get().c;

async function pool(list, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const x = list[i++]; await fn(x); }
  });
  await Promise.all(workers);
}

async function collect(source, recent, out) {
  let r;
  try {
    r = await fetchText(source.url, { etag: source.etag, lastModified: source.last_modified, kind: 'feed' });
  } catch (e) {
    out.sources_failed++;
    recordFetch(source.id, { status: 'error', error: errorCode(e) });
    return;
  }
  if (r.status === 304) {
    out.sources_ok++;
    recordFetch(source.id, { status: 'not_modified' });
    return;
  }
  let feed;
  try { feed = parseFeed(r.text, { baseUrl: r.url }); } catch (e) {
    out.sources_failed++;
    recordFetch(source.id, { status: 'error', error: errorCode(e) });
    return;
  }
  out.sources_ok++;
  const fresh = feed.items.filter(it => isFresh(it.date))
    .sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0))
    .slice(0, MAX_PER_SOURCE);
  let seen = 0;
  for (const it of fresh) {
    const dup = findSimilar(it.title, recent);
    const id = insertCollected({
      source, title: it.title, link: it.link, date: it.date, summary: it.summary, category: source.category,
      ...(dup ? { status: 'skipped', note: `duplicate_of:${dup.id}` } : {}),
    });
    if (!id) continue;
    seen++;
    out.items_new++;
    if (dup) out.items_skipped++;
    else recent.push({ id, title: it.title });
  }
  recordFetch(source.id, { status: 'ok', itemsSeen: seen, etag: r.etag, lastModified: r.lastModified });
}

export async function runNews({ trigger = 'schedule', onStart = null } = {}) {
  const cfg = getNewsConfig();
  if (!hasNewsKey()) {
    const r = db.prepare("INSERT INTO news_runs (trigger, finished_at, error) VALUES (?, datetime('now'), 'no_key')").run(trigger);
    return getRun(Number(r.lastInsertRowid));
  }
  const lock = acquireLock.immediate(trigger);
  if (!lock.ok) return { ...getRun(lock.runId), locked: true };
  const runId = lock.runId;
  if (typeof onStart === 'function') { try { onStart(runId); } catch { /* caller's problem */ } }
  const out = { sources_ok: 0, sources_failed: 0, items_new: 0, items_drafted: 0, items_skipped: 0, error: '' };
  try {
    const recent = recentTitles();
    await pool(enabledSources(), CONCURRENCY, s => collect(s, recent, out));

    // summarise the draft backlog, newest first, inside the daily cap
    const budget = Math.max(0, cfg.daily_cap - aiCallsToday());
    const backlog = db.prepare(`SELECT id FROM news_items WHERE status='draft' AND ai_at IS NULL
      ORDER BY COALESCE(published_src, fetched_at) DESC, id DESC LIMIT ?`).all(budget);
    for (const { id } of backlog) {
      const item = getItem(id);
      if (!item) continue;
      if (!isFresh(item.published_src || item.fetched_at.replace(' ', 'T') + 'Z')) {
        db.prepare(`UPDATE news_items SET status='skipped', ai_note='stale', updated_at=datetime('now') WHERE id=? AND status='draft'`).run(id);
        out.items_skipped++;
        continue;
      }
      const { status } = await summarizeItem(item, { minImportance: cfg.min_importance, model: cfg.model });
      if (status === 'skipped') out.items_skipped++;
      else out.items_drafted++;
    }
    if (budget === 0 && cfg.daily_cap > 0) out.error = 'daily_cap';
  } catch (e) {
    out.error = errorCode(e);
    console.error('[news] run failed', out.error);
  } finally {
    finish(runId, out);
  }
  if (out.items_drafted > 0) emit('news.drafted', { count: out.items_drafted, run_id: runId });
  return getRun(runId);
}

// ---- timer -------------------------------------------------------------------
let timer = null;
let running = null;

export function dueForRun(cfg = getNewsConfig()) {
  if (!cfg.enabled) return false;
  const last = db.prepare("SELECT started_at FROM news_runs WHERE error NOT IN ('no_key') ORDER BY id DESC LIMIT 1").get();
  if (!last) return true;
  const age = Date.now() - Date.parse(`${last.started_at.replace(' ', 'T')}Z`);
  return !(age < cfg.interval_hours * 3600_000);
}

export async function tick() {
  if (running) return null;
  const cfg = getNewsConfig();
  if (!cfg.enabled) return null;
  if (!hasNewsKey()) {
    // one no_key row per interval, not one per tick
    const last = db.prepare("SELECT started_at FROM news_runs ORDER BY id DESC LIMIT 1").get();
    if (last && Date.now() - Date.parse(`${last.started_at.replace(' ', 'T')}Z`) < cfg.interval_hours * 3600_000) return null;
    return runNews({ trigger: 'schedule' });
  }
  if (!dueForRun(cfg)) return null;
  running = runNews({ trigger: 'schedule' }).finally(() => { running = null; });
  return running;
}

export function startNewsScheduler({ tickMs = TICK_MS } = {}) {
  if (timer) return timer;
  timer = setInterval(() => { tick().catch(e => console.error('[news] tick', e?.message || e)); }, tickMs);
  timer.unref();
  return timer;
}
export function stopNewsScheduler() { if (timer) clearInterval(timer); timer = null; }

export { MAX_AGE_DAYS };
