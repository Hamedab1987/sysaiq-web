// Knowledge base as versioned content: server/content/knowledge/<slug>.json
// is applied by scripts/content-apply.mjs ("knowledge" kind), matched by slug.
//   slug  stable id of an entry ('' allowed: UNIQUE only where slug <> '')
//   grp   one of KNOWLEDGE_GROUPS ('' = not grouped yet) — orders the
//         assistant's prompt and tells it which rows are industry pitches
//   sort  order inside the group
// Backfill: every existing row gets slug = slugify(title), the exact rule the
// content files use, so applying them UPDATES the 38 seeded rows instead of
// duplicating them (a title that slugifies to '' is skipped, a collision gets
// -2, -3…). grp is guessed from the legacy tags only where it is still '' —
// the content files overwrite it on the next apply. updated_at is left alone.
// Pure on purpose (no imports): routes, ai.js and the apply script import
// slugify/KNOWLEDGE_GROUPS from here, and a migration must never pull in
// db/index.js (see the migrations contract).
export const version = 14;
export const name = 'knowledge_slug';

export const KNOWLEDGE_GROUPS = Object.freeze([
  'company', 'services', 'process', 'commercial', 'legal', 'contact', 'projects', 'pitch', 'playbook', 'news',
]);

// the shared contract's slug rule — never change it: existing rows were keyed with it
export const slugify = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

// first unused of base, base-2, base-3… (kept ≤ 64 chars)
export function uniqueSlug(base, taken) {
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const suffix = `-${n}`;
    const s = `${base.slice(0, 64 - suffix.length).replace(/-+$/, '')}${suffix}`;
    if (!taken.has(s)) return s;
  }
}

// legacy tag → group (first match wins; order matters: a pitch row also
// carries its industry tag, a project row its project slug)
const TAG_GROUP = [
  ['pitch', 'pitch'], ['project', 'projects'], ['playbook', 'playbook'], ['services', 'services'],
  ['about', 'company'], ['why', 'company'], ['process', 'process'], ['pricing', 'commercial'],
  ['contact', 'contact'], ['legal', 'legal'], ['news', 'news'],
];
export function guessGroup(tags) {
  const set = new Set(String(tags || '').split(',').map(t => t.trim().toLowerCase()).filter(Boolean));
  return TAG_GROUP.find(([tag]) => set.has(tag))?.[1] || '';
}

export function up(db, ctx) {
  if (!ctx.hasTable('knowledge')) return;
  ctx.addColumn('knowledge', 'slug', "TEXT NOT NULL DEFAULT ''");
  ctx.addColumn('knowledge', 'grp', "TEXT NOT NULL DEFAULT ''");
  ctx.addColumn('knowledge', 'sort', 'INTEGER NOT NULL DEFAULT 0');

  const rows = db.prepare('SELECT id, title, tags, slug, grp FROM knowledge ORDER BY id').all();
  const taken = new Set(rows.map(r => r.slug).filter(Boolean));
  const setSlug = db.prepare('UPDATE knowledge SET slug=? WHERE id=?');
  const setGrp = db.prepare('UPDATE knowledge SET grp=? WHERE id=?');
  for (const r of rows) {
    if (!r.slug) {
      const base = slugify(r.title);
      if (base) {
        const s = uniqueSlug(base, taken);
        taken.add(s);
        setSlug.run(s, r.id);
      }
    }
    if (!r.grp) {
      const g = guessGroup(r.tags);
      if (g) setGrp.run(g, r.id);
    }
  }
  // after the backfill, so no duplicate can make the index creation fail
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS knowledge_slug_uq ON knowledge(slug) WHERE slug <> ''");
}
