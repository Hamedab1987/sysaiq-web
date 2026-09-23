// Public news: /:lang/news (?c=category&page=n), /:lang/news/feed.xml and
// /:lang/news/:slug. Only published items exist here; anything else → next()
// (Foundation's 404). CSP kind "page" comes from siteCspMiddleware in app.js.
// Also reserves the "news" slug and starts the collection timer (not under
// NODE_ENV=test — tests drive runNews() directly).
import express from 'express';
import { config } from '../../config.js';
import { cached, cacheVersion } from '../../lib/cache.js';
import { reserveSlug } from '../../lib/registry.js';
import { findNews, listNews, renderNewsIndex, renderNewsArticle, renderNewsFeed, NEWS_CATEGORIES } from '../../render/news.js';
import { startNewsScheduler } from '../../news/scheduler.js';

reserveSlug('news');
if (config.env !== 'test') startNewsScheduler();

const router = express.Router();

function send(req, res, key, type, fn) {
  const body = cached(key, fn);
  res.set('Cache-Control', 'no-cache');
  res.set('ETag', `W/"n${cacheVersion()}-${key.replace(/[^a-z0-9:.-]/gi, '')}"`);
  if (req.fresh) return res.status(304).end();
  res.type(type).send(body);
}

router.get('/:lang(en|fa)/news', (req, res, next) => {
  const lang = req.params.lang;
  const c = typeof req.query.c === 'string' ? req.query.c : '';
  const rawPage = typeof req.query.page === 'string' ? req.query.page : '1';
  // unknown category or a malformed / out-of-range page is a 404, not a cache key
  if (c && !NEWS_CATEGORIES.includes(c)) return next();
  if (!/^[1-9]\d{0,4}$/.test(rawPage)) return next();
  const page = Number(rawPage);
  if (page > 1 && page > listNews({ category: c, page: 1 }).pages) return next();
  send(req, res, `news:list:${lang}:${c}:${page}`, 'html', () => renderNewsIndex(lang, { category: c, page }));
});

router.get('/:lang(en|fa)/news/feed.xml', (req, res) => {
  send(req, res, `news:feed:${req.params.lang}`, 'application/rss+xml; charset=utf-8', () => renderNewsFeed(req.params.lang));
});

router.get('/:lang(en|fa)/news/:slug([a-z0-9-]+)', (req, res, next) => {
  const item = findNews(req.params.slug);
  if (!item) return next();
  send(req, res, `news:item:${req.params.lang}:${item.slug}`, 'html', () => renderNewsArticle(item, req.params.lang));
});

export default { basePath: '/', order: 50, router };
