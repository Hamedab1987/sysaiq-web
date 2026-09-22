// The server-rendered home page: GET /fa/ and /en/ (render/home.js).
// Mounted at order 10 so it wins over the static SITE_DIR fallback (app.js
// mounts express.static after every route). /fa and /en → 301 to the slash
// form (one canonical URL), /fa/index.html likewise. Cache-Control: no-cache
// + a strong ETag (sha1 of the html) → browsers revalidate on every visit
// and get a 304 until the owner changes something. When the runtime
// template has not been built yet the request falls through to the baked
// page in SITE_DIR instead of failing.
import express from 'express';
import { asyncHandler } from '../../lib/errors.js';
import { cspMiddleware } from '../../lib/csp.js';
import { renderHome } from '../../render/home.js';

const router = express.Router();
let warnedNoTemplate = false;

// keep ?utm=… on the canonical redirect (same-origin, relative Location)
const query = req => { const i = req.url.indexOf('?'); return i === -1 ? '' : req.url.slice(i); };

router.get('/:lang(en|fa)/index.html', (req, res) => res.redirect(301, `/${req.params.lang}/${query(req)}`));

router.get('/:lang(en|fa)', cspMiddleware('home'), asyncHandler(async (req, res, next) => {
  const { lang } = req.params;
  if (!req.path.endsWith('/')) return res.redirect(301, `/${lang}/${query(req)}`);
  let page;
  try {
    page = await renderHome(lang);
  } catch (e) {
    if (e?.code !== 'ENOENT') throw e;
    if (!warnedNoTemplate) { warnedNoTemplate = true; console.error(`[home] ${e.message} — serving the baked page from SITE_DIR; run "python3 build.py" in vesper-project`); }
    return next();
  }
  res.set('Cache-Control', 'no-cache');
  res.set('ETag', page.etag);
  if (req.fresh) return res.status(304).end();
  res.type('html').send(page.html);
}));

export default { basePath: '/', order: 10, router };
