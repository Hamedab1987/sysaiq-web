// Server-rendered portfolio: /:lang/work (index) and /:lang/work/:slug (detail),
// rendered by render/work.js on the shared layout. Unknown slug → next().
import express from 'express';
import { cached, cacheVersion } from '../../lib/cache.js';
import { findProject, renderProjectPage, renderWorkIndex } from '../../render/work.js';

const router = express.Router();

function send(req, res, key, fn) {
  const html = cached(key, fn);
  res.set('Cache-Control', 'no-cache');
  res.set('ETag', `W/"w${cacheVersion()}-${key}"`);
  if (req.fresh) return res.status(304).end();
  res.type('html').send(html);
}

router.get('/:lang(en|fa)/work', (req, res) => {
  send(req, res, `work:${req.params.lang}`, () => renderWorkIndex(req.params.lang));
});
router.get('/:lang(en|fa)/work/:slug', (req, res, next) => {
  const p = findProject(req.params.slug);
  if (!p) return next();
  send(req, res, `project:${req.params.lang}:${p.slug}`, () => renderProjectPage(p, req.params.lang));
});

export default { basePath: '/', order: 50, router };
