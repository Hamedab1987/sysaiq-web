// Server-rendered services: /:lang/services (index) and /:lang/services/:slug.
// Unpublished or unknown → next() (404 handler is Foundation's).
import express from 'express';
import { cached, cacheVersion } from '../../lib/cache.js';
import { findService, renderServicesIndex, renderServicePage } from '../../render/services.js';

const router = express.Router();

function send(req, res, key, fn) {
  const html = cached(key, fn);
  res.set('Cache-Control', 'no-cache');
  res.set('ETag', `W/"s${cacheVersion()}-${key}"`);
  if (req.fresh) return res.status(304).end();
  res.type('html').send(html);
}

router.get('/:lang(en|fa)/services', (req, res) => {
  send(req, res, `services:${req.params.lang}`, () => renderServicesIndex(req.params.lang));
});
router.get('/:lang(en|fa)/services/:slug', (req, res, next) => {
  const s = findService(req.params.slug);
  if (!s) return next();
  send(req, res, `service:${req.params.lang}:${s.slug}`, () => renderServicePage(s, req.params.lang));
});

export default { basePath: '/', order: 50, router };
