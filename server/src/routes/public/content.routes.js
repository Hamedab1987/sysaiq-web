// GET /api/content — full site content (public settings + published projects
// + published faqs) in one call. Only registry-public settings are served.
import express from 'express';
import { db } from '../../db/index.js';
import { publicSettingValues } from '../../lib/site-settings.js';

const router = express.Router();

router.get('/', (_req, res) => {
  res.json({
    settings: publicSettingValues(),
    projects: db.prepare('SELECT * FROM projects WHERE published=1 ORDER BY sort, id').all(),
    faqs: db.prepare('SELECT * FROM faqs WHERE published=1 ORDER BY sort, id').all(),
  });
});

export default { basePath: '/api/content', order: 10, router };
