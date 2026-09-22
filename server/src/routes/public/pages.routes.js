// Catch-all for server-rendered pages: GET /:lang/:slug → a published
// `pages` row, else next() (the final 404 handler is Foundation's). Mounted
// last among the site routes (order 900) so /work, /services, /contact …
// keep winning; their slugs are reserved here so the admin can never create
// a page that shadows one.
import express from 'express';
import { db } from '../../db/index.js';
import { cached, cacheVersion } from '../../lib/cache.js';
import { reserveSlug, isReservedSlug } from '../../lib/registry.js';
import { renderPage } from '../../render/page.js';

reserveSlug('work', 'services', 'contact', 'admin', 'api', 'uploads', 'assets', 'p', 'pay', 'invoice', 'invoices',
  'account', 'login', 'index', 'sitemap', 'robots', 'news', 'healthz');

const router = express.Router();

router.get('/:lang(en|fa)/:slug', (req, res, next) => {
  const { lang, slug } = req.params;
  // reserved slugs belong to other routes (contact is rendered by site-info)
  if (isReservedSlug(slug) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return next();
  const page = db.prepare('SELECT * FROM pages WHERE slug=? AND published=1').get(slug);
  if (!page) return next();
  const html = cached(`page:${lang}:${slug}`, () => renderPage(page, lang));
  res.set('Cache-Control', 'no-cache');
  res.set('ETag', `W/"p${cacheVersion()}-${lang}-${page.id}"`);
  if (req.fresh) return res.status(304).end();
  res.type('html').send(html);
});

export default { basePath: '/', order: 900, router };
