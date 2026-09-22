// Server-rendered portfolio: /:lang/work (index) and /:lang/work/:slug (detail).
import express from 'express';
import { findProject, renderProjectPage, renderWorkIndex } from '../../projectPage.js';

const router = express.Router();

router.get('/:lang(en|fa)/work', (req, res) => {
  res.type('html').send(renderWorkIndex(req.params.lang));
});
router.get('/:lang(en|fa)/work/', (req, res) => {
  res.type('html').send(renderWorkIndex(req.params.lang));
});
router.get('/:lang(en|fa)/work/:slug', (req, res, next) => {
  const p = findProject(req.params.slug);
  if (!p) return next();
  res.type('html').send(renderProjectPage(p, req.params.lang));
});

export default { basePath: '/', order: 50, router };
