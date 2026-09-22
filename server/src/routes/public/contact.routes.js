// GET /:lang/contact — server-rendered contact page (lead form + full info).
// Cached per language through lib/cache.js like the other SSR routes: any
// admin write (routes/admin/index.js → invalidate()) re-renders on the next
// request, and the cache version doubles as the ETag.
import express from 'express';
import { asyncHandler } from '../../lib/errors.js';
import { cached, cacheVersion } from '../../lib/cache.js';
import { renderContactPage } from '../../render/contact.js';

const router = express.Router();

router.get('/:lang(en|fa)/contact', asyncHandler(async (req, res) => {
  const { lang } = req.params;
  const html = cached(`contact:${lang}`, () => renderContactPage(lang));
  res.setHeader('ETag', `"contact-${lang}-${cacheVersion()}"`);
  res.setHeader('Cache-Control', 'no-cache');
  res.type('html').send(html);
}));

export default { basePath: '/', order: 50, router };
