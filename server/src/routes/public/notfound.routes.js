// Bilingual 404 for every /:lang/… URL no route claimed: a typo, an
// unpublished page or an unpublished service gets the site chrome
// (render/notfound.js) instead of Express's bare English "Cannot GET".
// Mounted last among the site routes (order 950, after the pages catch-all
// at 900). The home root (/fa/, /en/) is left alone: home.routes.js renders
// it and falls back to the baked page in SITE_DIR when the runtime template
// is missing, and express.static (app.js) only runs after the routes — the
// built site has nothing else under /fa/ or /en/. The `page` CSP is already
// applied by app.js's siteCspMiddleware on this prefix.
import express from 'express';
import { renderNotFound } from '../../render/notfound.js';

const router = express.Router();

router.use('/:lang(en|fa)', (req, res, next) => {
  if (req.path === '/' || req.path === '') return next();
  res.status(404);
  res.set('Cache-Control', 'no-cache');
  res.type('html').send(renderNotFound(req.params.lang));
});

export default { basePath: '/', order: 950, router };
