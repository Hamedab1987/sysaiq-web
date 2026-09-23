// Projects redesign: the story columns behind /:lang/work/:slug.
//   category      one of CATEGORIES (filter chips on the index)
//   problem_* / solution_* / outcome_* / tech_*   markdown-lite narrative
//                 (outcome is QUALITATIVE — never numbers; tech only the
//                 confirmed stack from server/content/FACTS.md)
//   gallery       JSON [{image, caption_en, caption_fa}]
//   service_slug  the related service (one of the 10 fixed catalogue slugs)
//   seo_title_* / seo_desc_*   per-language overrides (fall back to title/tagline)
// Backfill for the 17 seeded slugs: category + service_slug from the maps
// below (only where the row still has none — an owner edit is never
// overwritten) and a gallery from the image files that actually exist under
// <siteDir>/assets/projects (<slug>-full.jpg always, <slug>-fa-full.jpg
// where the owner supplied a Persian UI). Rows seeded AFTER this migration
// (fresh install) get their category from the same map at render time.
// Imports only config.js (never db/index.js — see the migrations contract).
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.js';

export const version = 13;
export const name = 'projects_story';

export const CATEGORIES = Object.freeze(['business-systems', 'profession-landing', 'ai-automation', 'finance-trading']);
export const SERVICE_SLUGS = Object.freeze([
  'custom-website', 'profession-landing', 'web-app', 'ecommerce', 'mobile-app',
  'ai-agent', 'automation', 'accounting-systems', 'trading-systems', 'support-maintenance',
]);

// Mapping decisions (noted for the supervisor): the AI-first systems
// (realestate: AI matching, medical: AI + telemedicine) and the B2B
// route/ordering automation (distribution) sit under ai-automation so every
// chip has members; accounting joins trading under finance-trading; the
// five *-landing pages are profession-landing; the rest are business-systems.
export const CATEGORY_BY_SLUG = Object.freeze({
  restaurant: 'business-systems', ecommerce: 'business-systems', pos: 'business-systems', salon: 'business-systems',
  hotel: 'business-systems', school: 'business-systems', hr: 'business-systems',
  realestate: 'ai-automation', medical: 'ai-automation', distribution: 'ai-automation',
  accounting: 'finance-trading', trading: 'finance-trading',
  'law-landing': 'profession-landing', 'dental-landing': 'profession-landing', 'fitness-landing': 'profession-landing',
  'cafe-landing': 'profession-landing', 'architect-landing': 'profession-landing',
});
// the service whose related_projects list names the slug (content/services/*.json)
export const SERVICE_BY_SLUG = Object.freeze({
  restaurant: 'web-app', realestate: 'ai-agent', medical: 'ai-agent', trading: 'trading-systems',
  ecommerce: 'ecommerce', accounting: 'accounting-systems', pos: 'ecommerce', salon: 'web-app',
  distribution: 'automation', hotel: 'custom-website', school: 'custom-website', hr: 'automation',
  'law-landing': 'profession-landing', 'dental-landing': 'profession-landing', 'fitness-landing': 'profession-landing',
  'cafe-landing': 'profession-landing', 'architect-landing': 'profession-landing',
});

export const PROJECTS_DIR = () => join(config.siteDir, 'assets', 'projects');

// [{image, caption_en, caption_fa}] for the files that exist; [] when none
export function galleryFor(slug, dir) {
  const out = [];
  for (const suffix of ['-full.jpg', '-fa-full.jpg']) {
    const file = `${slug}${suffix}`;
    if (existsSync(join(dir, file))) out.push({ image: `/assets/projects/${file}`, caption_en: '', caption_fa: '' });
  }
  return out;
}

const COLUMNS = [
  ['category', "TEXT NOT NULL DEFAULT ''"],
  ['problem_en', "TEXT NOT NULL DEFAULT ''"], ['problem_fa', "TEXT NOT NULL DEFAULT ''"],
  ['solution_en', "TEXT NOT NULL DEFAULT ''"], ['solution_fa', "TEXT NOT NULL DEFAULT ''"],
  ['outcome_en', "TEXT NOT NULL DEFAULT ''"], ['outcome_fa', "TEXT NOT NULL DEFAULT ''"],
  ['tech_en', "TEXT NOT NULL DEFAULT ''"], ['tech_fa', "TEXT NOT NULL DEFAULT ''"],
  ['gallery', "TEXT NOT NULL DEFAULT '[]'"],
  ['service_slug', "TEXT NOT NULL DEFAULT ''"],
  ['seo_title_en', "TEXT NOT NULL DEFAULT ''"], ['seo_title_fa', "TEXT NOT NULL DEFAULT ''"],
  ['seo_desc_en', "TEXT NOT NULL DEFAULT ''"], ['seo_desc_fa', "TEXT NOT NULL DEFAULT ''"],
];

export function up(db, ctx, { projectsDir = PROJECTS_DIR() } = {}) {
  if (!ctx.hasTable('projects')) return;
  for (const [col, ddl] of COLUMNS) ctx.addColumn('projects', col, ddl);

  const setCat = db.prepare("UPDATE projects SET category=? WHERE slug=? AND category=''");
  const setSvc = db.prepare("UPDATE projects SET service_slug=? WHERE slug=? AND service_slug=''");
  const setGal = db.prepare("UPDATE projects SET gallery=? WHERE slug=? AND (gallery='' OR gallery='[]')");
  let n = 0;
  for (const [slug, cat] of Object.entries(CATEGORY_BY_SLUG)) {
    n += setCat.run(cat, slug).changes;
    n += setSvc.run(SERVICE_BY_SLUG[slug] || '', slug).changes;
    const gal = galleryFor(slug, projectsDir);
    if (gal.length) n += setGal.run(JSON.stringify(gal), slug).changes;
  }
  if (n && process.env.NODE_ENV !== 'test') console.log(`[migrate 013] backfilled ${n} project field(s)`);
}
