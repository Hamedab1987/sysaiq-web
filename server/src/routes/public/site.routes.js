// GET /api/public/site → {site_info, badges, footer_pages} for the static
// (baked) home page and the AI widget: settings.site_info with the owner's
// show.* flags applied (a hidden phone/e-mail/address never leaves the
// server), the enabled trust seals (parsed fields only) and the published
// pages the footer should link (table owned by another workstream — guarded).
import express from 'express';
import { db } from '../../db/index.js';
import { publicSiteInfoView } from '../../lib/siteinfo.js';
import { cached } from '../../lib/cache.js';

const router = express.Router();
const hasTable = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);

export function publicBadges() {
  return db.prepare('SELECT id, kind, seal_id, link_url, img_url, label_en, label_fa, width, height, placement, langs, sort FROM badges WHERE enabled=1 ORDER BY sort, id').all()
    .map(b => ({ ...b, langs: String(b.langs || '').split(',').map(s => s.trim()).filter(Boolean) }));
}

export function footerPages() {
  if (!hasTable('pages')) return [];
  try {
    const flag = db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'show_in_footer') ? ' AND show_in_footer=1' : '';
    const order = db.prepare('PRAGMA table_info(pages)').all().some(c => c.name === 'sort') ? 'sort, id' : 'id';
    return db.prepare(`SELECT slug, title_en, title_fa FROM pages WHERE published=1${flag} ORDER BY ${order}`).all()
      .filter(p => typeof p.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p.slug))
      .map(p => ({ slug: p.slug, title: { en: String(p.title_en || ''), fa: String(p.title_fa || '') }, path: { en: `/en/${p.slug}`, fa: `/fa/${p.slug}` } }));
  } catch {
    return []; // unknown column names: the footer simply has no page links yet
  }
}

router.get('/', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.json(cached('api:public:site', () => ({ site_info: publicSiteInfoView(), badges: publicBadges(), footer_pages: footerPages() })));
});

export default { basePath: '/api/public/site', order: 20, router };
