// Knowledge base CRUD (feeds the AI assistant). Bodies are validated and
// length-capped (422 {fields} on bad input); bodies stay generous because
// the assistant's pitches live here.
// slug / grp / sort (migration 014) are optional so the legacy shapes keep
// working: a POST without a slug gets slugify(title) (-2, -3… on collision),
// a PUT that leaves them out keeps the stored values. `group` is accepted as
// an alias of `grp` (the content files' key). The slug is the key
// scripts/content-apply.mjs matches content/knowledge/<slug>.json on.
import express from 'express';
import { db } from '../../db/index.js';
import { v, validate } from '../../lib/validate.js';
import { asyncHandler, HttpError } from '../../lib/errors.js';
import { KNOWLEDGE_GROUPS, slugify, uniqueSlug } from '../../db/migrations/014_knowledge_slug.js';

const router = express.Router();

// '' clears the group; missing → left out (PUT keeps the stored value)
const group = (x, key) => {
  if (x === undefined || x === null) return undefined;
  if (x === '') return '';
  return v.oneOf(KNOWLEDGE_GROUPS)(x, key);
};

const SCHEMA = {
  title: v.str({ max: 300 }), body_en: v.str({ max: 50000 }), body_fa: v.str({ max: 50000 }),
  tags: v.str({ max: 500 }), enabled: v.bool(),
  slug: v.optional(v.slug({ max: 64 })),
  grp: group,
  sort: v.optional(v.int({ min: -100000, max: 100000 })),
};
function cleanKnowledge(body) {
  const src = body && typeof body === 'object' ? { ...body } : {};
  if (src.grp === undefined && src.group !== undefined) src.grp = src.group;
  const b = validate(SCHEMA, src);
  b.enabled = b.enabled ? 1 : 0;
  return b;
}

const slugTaken = (slug, exceptId = 0) => !!db.prepare('SELECT 1 FROM knowledge WHERE slug=? AND id<>?').get(slug, exceptId);
const slugConflict = () => new HttpError(422, 'validation', 'Validation failed', { slug: 'این شناسه برای مدخل دیگری ثبت شده است' });

router.get('/', (_req, res) => res.json(db.prepare('SELECT * FROM knowledge ORDER BY id DESC').all()));

router.post('/', asyncHandler(async (req, res) => {
  const b = cleanKnowledge(req.body);
  let slug = b.slug;
  if (slug) { if (slugTaken(slug)) throw slugConflict(); }
  else {
    const base = slugify(b.title);
    slug = base ? uniqueSlug(base, new Set(db.prepare("SELECT slug FROM knowledge WHERE slug<>''").all().map(r => r.slug))) : '';
  }
  const info = db.prepare(`INSERT INTO knowledge (title,body_en,body_fa,tags,enabled,slug,grp,sort)
    VALUES (@title,@body_en,@body_fa,@tags,@enabled,@slug,@grp,@sort)`)
    .run({ ...b, slug, grp: b.grp ?? '', sort: b.sort ?? 0 });
  res.json({ ok: true, id: info.lastInsertRowid, slug });
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const id = Number(req.params.id);
  const b = cleanKnowledge(req.body);
  if (b.slug && slugTaken(b.slug, id)) throw slugConflict();
  // the legacy columns are replaced as before; slug/grp/sort only when sent
  const extra = ['slug', 'grp', 'sort'].filter(k => b[k] !== undefined);
  db.prepare(`UPDATE knowledge SET title=@title,body_en=@body_en,body_fa=@body_fa,tags=@tags,
    enabled=@enabled,${extra.map(k => `${k}=@${k},`).join('')}updated_at=datetime('now') WHERE id=@id`)
    .run({ title: b.title, body_en: b.body_en, body_fa: b.body_fa, tags: b.tags, enabled: b.enabled,
      ...Object.fromEntries(extra.map(k => [k, b[k]])), id });
  res.json({ ok: true });
}));

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM knowledge WHERE id=?').run(Number(req.params.id));
  res.json({ ok: true });
});

export default { basePath: '/knowledge', order: 40, router };
