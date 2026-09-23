// GET /sitemap.xml — home fa/en, /work + published projects, published
// services and pages (tables owned by other workstreams: guarded with
// hasTable + try/catch so a schema we don't know just leaves them out),
// each with xhtml:link hreflang alternates (x-default → fa, like the root
// redirect). GET /robots.txt only when the static site has none.
import express from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { cached } from '../../lib/cache.js';
import { esc } from '../../lib/html.js';

const router = express.Router();
const LANGS = ['fa', 'en'];
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const hasTable = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
const hasColumn = (table, col) => hasTable(table) && db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col);
const safeSlugs = (table, sql) => {
  if (!hasTable(table)) return [];
  try { return db.prepare(sql).all().map(r => r.slug).filter(s => typeof s === 'string' && SLUG_RE.test(s)); } catch { return []; }
};

// site-relative paths (without the /:lang prefix) that exist in both languages
export function sitemapPaths() {
  const paths = ['/', '/work', '/contact'];
  for (const s of safeSlugs('projects', 'SELECT slug FROM projects WHERE published=1 ORDER BY sort, id')) paths.push(`/work/${s}`);
  const services = safeSlugs('services', 'SELECT slug FROM services WHERE published=1 ORDER BY sort, id');
  if (services.length) paths.push('/services');
  for (const s of services) paths.push(`/services/${s}`);
  // pages flagged noindex stay out; /contact is ours (the pages row is only its draft twin)
  const noindex = hasColumn('pages', 'noindex') ? ' AND noindex=0' : '';
  for (const s of safeSlugs('pages', `SELECT slug FROM pages WHERE published=1${noindex} ORDER BY id`)) if (s !== 'contact') paths.push(`/${s}`);
  // news (news workstream): published items exist in both languages
  const news = safeSlugs('news_items', "SELECT slug FROM news_items WHERE status='published' AND slug IS NOT NULL ORDER BY published_at DESC, id DESC LIMIT 5000");
  if (news.length) paths.push('/news');
  for (const s of news) paths.push(`/news/${s}`);
  return [...new Set(paths)];
}

export function buildSitemap() {
  const base = config.publicBaseUrl;
  const url = (lang, p) => esc(`${base}/${lang}${p === '/' ? '/' : p}`);
  const entries = [];
  for (const p of sitemapPaths()) {
    const alternates = LANGS.map(l => `    <xhtml:link rel="alternate" hreflang="${l}" href="${url(l, p)}"/>`).join('\n') +
      `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${url('fa', p)}"/>`;
    for (const l of LANGS) entries.push(`  <url>\n    <loc>${url(l, p)}</loc>\n${alternates}\n  </url>`);
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join('\n')}\n</urlset>\n`;
}

router.get('/sitemap.xml', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=600');
  res.type('application/xml').send(cached('sitemap.xml', buildSitemap));
});

export const ROBOTS = () => `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${config.publicBaseUrl}/sitemap.xml\n`;

router.get('/robots.txt', (_req, res, next) => {
  // a robots.txt in the static site wins (express.static is mounted after the routes)
  if (existsSync(join(config.siteDir, 'robots.txt'))) return next();
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').send(ROBOTS());
});

export default { basePath: '/', order: 40, router };
