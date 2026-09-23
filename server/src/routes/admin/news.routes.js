// News admin API (/api/admin/news…) — the review queue, sources, settings
// and runs. Behind the auto-mounter (requireAdmin + CSRF + audit + cache
// invalidation on every 2xx write). Nothing is ever published without one
// of the publish endpoints below; publishing needs title + summary in both
// languages. Outbound fetches (source test, draft from a link) go through
// news/fetch.js: https only, private/loopback hosts refused.
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';
import { HttpError, asyncHandler } from '../../lib/errors.js';
import { aiModel } from '../../ai.js';
import { audit } from '../../lib/audit.js';
import { CATEGORIES, getNewsConfig, setNewsConfig } from '../../news/config.js';
import { listSources, getSource, createSource, updateSource, deleteSource, probeFeed } from '../../news/sources.js';
import {
  getItem, formatItem, publishItem, setStatus, missingForPublish, uniqueSlug, draftFromUrl, summarizeItem, REQUIRED_FOR_PUBLISH,
} from '../../news/items.js';
import { runNews, lastRuns, getRun, aiCallsToday } from '../../news/scheduler.js';
import { hasNewsKey, LIMITS } from '../../news/summarize.js';

const router = express.Router();
const STATUSES = ['draft', 'published', 'rejected', 'skipped'];
const PER_PAGE = 20;

const idParam = (req, what = 'News item') => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw new HttpError(404, 'not_found', `${what} not found`);
  return id;
};
const who = req => String(req.admin?.u || '');
const mustItem = id => {
  const it = getItem(id);
  if (!it) throw new HttpError(404, 'not_found', 'News item not found');
  return it;
};

// ---- items -------------------------------------------------------------------
router.get('/items', (req, res) => {
  const q = validate({
    status: v.optional(v.oneOf(STATUSES)),
    category: v.optional(v.oneOf(CATEGORIES)),
    q: v.optional(v.str({ max: 120 })),
    page: v.optional(v.int({ min: 1, max: 10000 })),
  }, req.query);
  const where = [];
  const args = [];
  if (q.status) { where.push('status=?'); args.push(q.status); }
  if (q.category) { where.push('category=?'); args.push(q.category); }
  if (q.q) {
    where.push("(title_src LIKE ? ESCAPE '\\' OR title_en LIKE ? ESCAPE '\\' OR title_fa LIKE ? ESCAPE '\\' OR source_name LIKE ? ESCAPE '\\')");
    const like = `%${q.q.replace(/[\\%_]/g, m => `\\${m}`)}%`;
    args.push(like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM news_items ${w}`).get(...args).c;
  const page = q.page || 1;
  // drafts: most important first; everything else: newest first
  const order = q.status === 'draft'
    ? 'ORDER BY (ai_at IS NULL), importance DESC, COALESCE(published_src, fetched_at) DESC, id DESC'
    : q.status === 'published' ? 'ORDER BY published_at DESC, id DESC' : 'ORDER BY id DESC';
  const rows = db.prepare(`SELECT * FROM news_items ${w} ${order} LIMIT ? OFFSET ?`).all(...args, PER_PAGE, (page - 1) * PER_PAGE);
  const counts = Object.fromEntries(STATUSES.map(s => [s, 0]));
  for (const r of db.prepare('SELECT status, COUNT(*) c FROM news_items GROUP BY status').all()) counts[r.status] = r.c;
  res.json({ items: rows.map(formatItem), total, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), per_page: PER_PAGE, counts });
});

router.get('/items/:id', (req, res) => {
  const it = mustItem(idParam(req));
  const source = it.source_id ? getSource(it.source_id) : null;
  res.json({ item: formatItem(it), source: source ? { id: source.id, name: source.name, url: source.url } : null, missing: Object.keys(missingForPublish(it)) });
});

// optional display image: '' clears it; otherwise a site path (not
// protocol-relative, no backslash — "/\host" is "//host" to a browser) or
// an https URL without quotes/brackets/spaces — the same rule as project covers
const IMAGE_RE = /^\/(?![/\\])[^\s"'<>\\]*$/;
function image(x, key) {
  const s = v.str({ max: 2048 })(x, key);
  if (!s || IMAGE_RE.test(s)) return s;
  const u = v.url({ https: true, max: 2048 })(s, key);
  if (/["'<>\\\s]/.test(u)) throw new HttpError(422, 'validation', 'Validation failed', { [key]: `${key} must be a site path or an https URL` });
  return u;
}

const EDIT = {
  title_en: v.str({ max: LIMITS.title }), title_fa: v.str({ max: LIMITS.title }),
  summary_en: v.str({ max: LIMITS.summary }), summary_fa: v.str({ max: LIMITS.summary }),
  why_en: v.str({ max: LIMITS.why }), why_fa: v.str({ max: LIMITS.why }),
  category: v.oneOf(CATEGORIES),
  importance: v.int({ min: 1, max: 5 }),
  tags: v.array(v.str({ max: LIMITS.tag, pattern: /^[a-z0-9.+ -]*$/i }), { max: 8 }),
  slug: v.slug({ max: 64 }),
  image,
};

router.put('/items/:id', (req, res) => {
  const id = idParam(req);
  const cur = mustItem(id);
  const src = req.body && typeof req.body === 'object' ? req.body : {};
  const schema = {};
  for (const k of Object.keys(EDIT)) if (Object.hasOwn(src, k)) schema[k] = EDIT[k];
  if (!Object.keys(schema).length) throw new HttpError(422, 'validation', 'Nothing to update');
  const b = validate(schema, src);
  if (b.tags) b.tags = JSON.stringify(b.tags.map(t => t.toLowerCase().trim()).filter(Boolean));
  const next = { ...cur, ...b };
  const cols = Object.keys(b);
  // a live item can't lose a language
  if (cur.status === 'published') {
    const missing = missingForPublish(next);
    if (Object.keys(missing).length) throw new HttpError(422, 'validation', 'A published item needs both languages', missing);
    if (!next.slug) { next.slug = uniqueSlug(next.title_en, id); cols.push('slug'); }
  }
  if (b.slug && db.prepare('SELECT 1 FROM news_items WHERE slug=? AND id<>?').get(b.slug, id)) {
    throw new HttpError(409, 'conflict', 'Another news item uses this slug', { slug: 'already used' });
  }
  db.prepare(`UPDATE news_items SET ${cols.map(c => `${c}=@${c}`).join(',')}, reviewed_by=@reviewed_by, updated_at=datetime('now') WHERE id=@id`)
    .run({ ...Object.fromEntries(cols.map(c => [c, next[c]])), reviewed_by: who(req), id });
  res.json({ ok: true, item: formatItem(getItem(id)) });
});

// explicit rows (the auto-mounter's row names the entity "news"): the
// review decisions are what the owner wants to find in «گزارش تغییرات»
const note = (req, action, it) => audit(req, action, 'news_items', it.id, `${action}: ${String(it.title_fa || it.title_en || it.title_src).slice(0, 120)}`);

router.post('/items/:id/publish', (req, res) => {
  const it = publishItem(idParam(req), who(req));
  note(req, 'publish', it);
  res.json({ ok: true, item: formatItem(it) });
});

router.post('/items/:id/reject', (req, res) => {
  const id = idParam(req);
  mustItem(id);
  const it = setStatus(id, 'rejected', who(req));
  note(req, 'reject', it);
  res.json({ ok: true, item: formatItem(it) });
});

// back to the queue (a rejected, skipped or published item)
router.post('/items/:id/restore', (req, res) => {
  const id = idParam(req);
  mustItem(id);
  res.json({ ok: true, item: formatItem(setStatus(id, 'draft', who(req))) });
});

// ask the AI again (drafts / skipped only: live text never changes behind the owner's back)
router.post('/items/:id/summarize', asyncHandler(async (req, res) => {
  const id = idParam(req);
  const it = mustItem(id);
  if (!['draft', 'skipped'].includes(it.status)) throw new HttpError(409, 'not_draft', 'Only drafts can be summarised again');
  if (!hasNewsKey()) throw new HttpError(409, 'no_key', 'OpenAI key is not configured');
  if (it.status === 'skipped') setStatus(id, 'draft', who(req));
  const cfg = getNewsConfig();
  const { res: r } = await summarizeItem(getItem(id), { minImportance: 0, model: cfg.model });
  res.json({ ok: !!r.ok, error: r.ok ? undefined : r.error, item: formatItem(getItem(id)) });
}));

router.post('/items/bulk', (req, res) => {
  const b = validate({ ids: v.array(v.int({ min: 1 }), { max: 100 }), action: v.oneOf(['publish', 'reject']) }, req.body);
  if (!b.ids.length) throw new HttpError(422, 'validation', 'Validation failed', { ids: 'at least one id' });
  const results = [];
  for (const id of [...new Set(b.ids)]) {
    try {
      const it = b.action === 'publish' ? publishItem(id, who(req)) : setStatus(id, 'rejected', who(req));
      if (!it) throw new HttpError(404, 'not_found', 'News item not found');
      note(req, b.action, it);
      results.push({ id, ok: true });
    } catch (e) {
      results.push({ id, ok: false, error: e?.code || 'error', fields: e?.fields ? Object.keys(e.fields) : undefined });
    }
  }
  res.json({ ok: results.every(r => r.ok), results, done: results.filter(r => r.ok).length });
});

router.delete('/items/:id', (req, res) => {
  const it = mustItem(idParam(req));
  db.prepare('DELETE FROM news_items WHERE id=?').run(it.id);
  note(req, 'delete', it);
  res.json({ ok: true });
});

router.post('/items/draft-from-url', asyncHandler(async (req, res) => {
  const b = validate({ url: v.url({ https: true, max: 2048 }) }, req.body);
  const it = await draftFromUrl(b.url, { admin: who(req) });
  res.status(201).json({ ok: true, id: it.id, item: formatItem(it) });
}));

// ---- sources -------------------------------------------------------------------
const SOURCE = {
  name: v.str({ min: 1, max: 120 }),
  url: v.url({ https: true, max: 2048 }),
  category: v.oneOf(CATEGORIES),
  lang: v.oneOf(['en', 'fa']),
  enabled: v.bool(),
};
const pickSchema = (body, all) => {
  const src = body && typeof body === 'object' ? body : {};
  const s = {};
  for (const k of Object.keys(SOURCE)) if (all || Object.hasOwn(src, k)) s[k] = all && k !== 'name' && k !== 'url' ? v.optional(SOURCE[k]) : SOURCE[k];
  return s;
};

router.get('/sources', (_req, res) => res.json({ sources: listSources() }));

router.post('/sources', (req, res) => {
  const b = validate(pickSchema(req.body, true), req.body);
  const s = createSource(b);
  res.status(201).json({ ok: true, id: s.id, source: s });
});

// probe a feed before adding it
router.post('/sources/test', asyncHandler(async (req, res) => {
  const b = validate({ url: v.url({ https: true, max: 2048 }) }, req.body);
  res.json(await probeFeed(b.url));
}));

router.put('/sources/:id', (req, res) => {
  const id = idParam(req, 'Source');
  const schema = pickSchema(req.body, false);
  if (!Object.keys(schema).length) throw new HttpError(422, 'validation', 'Nothing to update');
  const s = updateSource(id, validate(schema, req.body));
  if (!s) throw new HttpError(404, 'not_found', 'Source not found');
  res.json({ ok: true, source: s });
});

router.delete('/sources/:id', (req, res) => {
  if (!deleteSource(idParam(req, 'Source'))) throw new HttpError(404, 'not_found', 'Source not found');
  res.json({ ok: true });
});

router.post('/sources/:id/test', asyncHandler(async (req, res) => {
  const s = getSource(idParam(req, 'Source'));
  if (!s) throw new HttpError(404, 'not_found', 'Source not found');
  res.json(await probeFeed(s.url));
}));

// ---- settings, runs --------------------------------------------------------------
const configView = () => ({
  config: getNewsConfig(),
  openai_configured: hasNewsKey(),
  model_effective: getNewsConfig().model || aiModel(),
  ai_calls_today: aiCallsToday(),
  required_for_publish: REQUIRED_FOR_PUBLISH,
});
router.get('/config', (_req, res) => res.json(configView()));
router.put('/config', (req, res) => { setNewsConfig(req.body); res.json({ ok: true, ...configView() }); });

// run now: answers with the summary when the run ends within RUN_WAIT_MS,
// otherwise 202 + the run id (GET /runs shows it finishing) — a proxy
// timeout must not look like a failure
const RUN_WAIT_MS = 25_000;
router.post('/run', asyncHandler(async (req, res) => {
  let runId = 0;
  const p = runNews({ trigger: 'manual', onStart: id => { runId = id; } });
  p.catch(e => console.error('[news] manual run', e?.message || e));
  let timer;
  const slow = new Promise(r => { timer = setTimeout(() => r(null), RUN_WAIT_MS); timer.unref?.(); });
  const run = await Promise.race([p, slow]);
  clearTimeout(timer);
  if (run) return res.json({ ok: !run.error || run.error === 'daily_cap', run });
  res.status(202).json({ ok: true, running: true, run: getRun(runId) });
}));

router.get('/runs', (_req, res) => res.json({ runs: lastRuns(20) }));

export default { basePath: '/news', order: 60, router };
