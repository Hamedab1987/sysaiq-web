// Project slugs: the slug is the detail page URL (/:lang/work/:slug), UNIQUE
// in the table, and must never end up empty.
import { db } from '../db/index.js';

export const slugify = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

// guarantee a non-empty slug unique among projects other than `selfId`;
// falls back to the English title, then 'project', and suffixes -2, -3, …
export function withSlug(b, selfId = 0) {
  const base = slugify(b.slug) || slugify(b.title_en) || 'project';
  const taken = s => db.prepare('SELECT 1 FROM projects WHERE slug=? AND id<>?').get(s, selfId);
  let slug = base;
  for (let n = 2; taken(slug); n++) slug = `${base}-${n}`;
  b.slug = slug;
  return b;
}
