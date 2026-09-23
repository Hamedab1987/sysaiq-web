#!/usr/bin/env node
// content-apply — upsert authored content JSON into the database, by slug.
//
//   node scripts/content-apply.mjs services [--publish] [--dry-run]
//   node scripts/content-apply.mjs pages    [--publish] [--dry-run]
//   node scripts/content-apply.mjs projects [--publish] [--dry-run]
//   node scripts/content-apply.mjs knowledge [--dry-run]
//
// Reads content/<kind>/*.json, INSERTs missing rows and UPDATEs existing ones
// (the id never changes). Idempotent: a row whose stored values already match
// the file is left untouched (updated_at included). `published` is set to 1
// only with --publish; without it an existing row keeps its flag and a new
// row is created unpublished (the owner publishes from the admin panel).
// A column the file sets but the table lacks (a migration not yet deployed)
// is skipped with a warning instead of failing the whole run; `projects`
// never touches image/cover_*/sort/published/show_on_home — those stay the
// owner's (seed's) decision.
// `knowledge` (the AI assistant's base, content/knowledge/<slug>.json with
// {slug, title, group, tags, body_en, body_fa, enabled, sort}) has no
// `published` column: `enabled` comes from the file and --publish is
// ignored. `group` is stored in knowledge.grp. A row seeded without a slug
// (seed.js on a fresh install, after migration 014) is adopted when
// slugify(title) equals the file's slug, so it is updated, not duplicated.
// Goes through ./src/db/index.js, so DATA_DIR / .env decide which database
// is touched and migrations run first — safe to run on the production server:
//   DATA_DIR=/var/lib/sysaiq node scripts/content-apply.mjs services --publish
// The running server keeps its in-memory render cache until it restarts or an
// admin write happens; the script says so at the end.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWLEDGE_GROUPS, slugify } from '../src/db/migrations/014_knowledge_slug.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// per kind: table, columns the file may set (everything else is ignored so a
// stray key can never reach SQL), JSON-array columns, 0/1 columns
export const KINDS = {
  services: {
    table: 'services',
    columns: ['title_en', 'title_fa', 'tagline_en', 'tagline_fa', 'summary_en', 'summary_fa',
      'audience_en', 'audience_fa', 'problems_en', 'problems_fa', 'deliverables', 'process',
      'timeline_en', 'timeline_fa', 'price_approach_en', 'price_approach_fa', 'faqs',
      'related_projects', 'meta_desc_en', 'meta_desc_fa', 'icon', 'sort'],
    json: ['deliverables', 'process', 'faqs', 'related_projects'],
    bool: [],
  },
  pages: {
    table: 'pages',
    columns: ['kind', 'system_key', 'title_en', 'title_fa', 'body_en', 'body_fa', 'meta_desc_en', 'meta_desc_fa',
      'show_in_footer', 'show_in_nav', 'noindex', 'version', 'effective_at', 'sort'],
    json: [],
    bool: ['show_in_footer', 'show_in_nav', 'noindex'],
  },
  projects: {
    table: 'projects',
    columns: ['title_en', 'title_fa', 'tagline_en', 'tagline_fa', 'desc_en', 'desc_fa',
      'overview_en', 'overview_fa', 'problem_en', 'problem_fa', 'solution_en', 'solution_fa',
      'outcome_en', 'outcome_fa', 'tech_en', 'tech_fa', 'industries', 'features', 'pages', 'gallery',
      'category', 'service_slug', 'seo_title_en', 'seo_title_fa', 'seo_desc_en', 'seo_desc_fa', 'tags'],
    json: ['industries', 'features', 'pages', 'gallery'],
    bool: [],
  },
  knowledge: {
    table: 'knowledge',
    columns: ['title', 'grp', 'tags', 'body_en', 'body_fa', 'enabled', 'sort'],
    json: [],
    bool: ['enabled'],
    from: { grp: 'group' },       // column ← file key (the file says "group")
    publishable: false,           // enabled comes from the file
    check(raw) {
      if (typeof raw.title !== 'string' || !raw.title.trim()) throw new Error('title is required');
      const g = raw.group ?? raw.grp;
      if (g !== undefined && g !== '' && !KNOWLEDGE_GROUPS.includes(g)) throw new Error(`group "${g}" is not one of: ${KNOWLEDGE_GROUPS.join(', ')}`);
      for (const k of ['body_en', 'body_fa']) if (raw[k] !== undefined && typeof raw[k] !== 'string') throw new Error(`${k} must be a string`);
    },
    // a legacy row that never got a slug, recognised by the contract's slugify(title)
    adopt(db, slug) {
      return db.prepare("SELECT * FROM knowledge WHERE slug='' ORDER BY id").all().find(r => slugify(r.title) === slug) || null;
    },
  },
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function loadFiles(kind, dir = join(ROOT, 'content', kind)) {
  if (!existsSync(dir)) throw new Error(`content directory not found: ${dir}`);
  const files = readdirSync(dir).filter(f => f.endsWith('.json')).sort();
  return files.map(f => {
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    const slug = String(raw.slug || basename(f, '.json'));
    if (!SLUG.test(slug)) throw new Error(`${f}: invalid slug "${slug}"`);
    if (raw.slug && raw.slug !== basename(f, '.json')) throw new Error(`${f}: slug "${raw.slug}" does not match the file name`);
    return { file: f, slug, raw };
  });
}

// file → the exact column values that will be stored
function toRow(kind, raw) {
  const spec = KINDS[kind];
  const row = {};
  for (const col of spec.columns) {
    const key = spec.from?.[col] && Object.prototype.hasOwnProperty.call(raw, spec.from[col]) ? spec.from[col] : col;
    if (!Object.prototype.hasOwnProperty.call(raw, key)) continue;
    let v = raw[key];
    if (spec.json.includes(col)) {
      if (!Array.isArray(v)) throw new Error(`${col} must be an array`);
      v = JSON.stringify(v);
    } else if (spec.bool.includes(col)) {
      v = v ? 1 : 0;
    } else if (col === 'sort') {
      v = Number.isInteger(v) ? v : parseInt(v, 10) || 0;
    } else if (v === null || v === undefined) {
      v = col === 'system_key' ? null : '';
    } else if (Array.isArray(v)) {
      v = v.map(x => String(x).trim()).filter(Boolean).join(','); // tags: ["a","b"] → "a,b"
    } else {
      v = String(v);
    }
    row[col] = v;
  }
  return row;
}

const same = (a, b) => (a === null || a === undefined ? '' : String(a)) === (b === null || b === undefined ? '' : String(b));

// returns {created, updated, unchanged, published} counts (+ `skipped`: the
// file columns the table does not have yet, only when there are any); `db`
// is a better-sqlite3 handle so tests can point it at a scratch database
export function applyKind(db, kind, { publish = false, dryRun = false, dir, log = () => {}, warn = log } = {}) {
  const spec = KINDS[kind];
  if (!spec) throw new Error(`unknown kind "${kind}" — use one of: ${Object.keys(KINDS).join(', ')}`);
  const entries = loadFiles(kind, dir);
  const publishable = spec.publishable !== false;
  if (!publishable) publish = false;
  if (spec.check) for (const { file, raw } of entries) {
    try { spec.check(raw); } catch (e) { throw new Error(`${file}: ${e.message}`); }
  }
  const stats = { created: 0, updated: 0, unchanged: 0, published: 0 };
  const select = db.prepare(`SELECT * FROM ${spec.table} WHERE slug=?`);
  // columns the live table really has — a migration written in parallel may
  // not be deployed yet, so a missing column is skipped (loudly), not fatal
  const present = new Set(db.pragma(`table_info(${spec.table})`).map(c => c.name));
  const skipped = spec.columns.filter(c => !present.has(c));
  for (const c of skipped) warn(`! ${spec.table}.${c} does not exist yet — skipped (run migrations, then re-apply)`);
  if (skipped.length) stats.skipped = skipped;
  const stamp = present.has('updated_by');

  const run = db.transaction(() => {
    for (const { file, slug, raw } of entries) {
      const row = toRow(kind, raw);
      for (const c of skipped) delete row[c];
      let existing = select.get(slug);
      const adopted = !existing && spec.adopt ? spec.adopt(db, slug) : null;
      if (adopted) { existing = adopted; row.slug = slug; }
      if (!existing) {
        const cols = ['slug', ...Object.keys(row), ...(publishable ? ['published'] : []), ...(stamp ? ['updated_by'] : [])];
        const vals = [slug, ...Object.values(row), ...(publishable ? [publish ? 1 : 0] : []), ...(stamp ? ['content-apply'] : [])];
        if (!dryRun) db.prepare(`INSERT INTO ${spec.table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`).run(...vals);
        stats.created++;
        if (publish) stats.published++;
        log(`+ ${slug}  (created${publish ? ', published' : ''})  ← ${file}`);
        continue;
      }
      const changed = Object.keys(row).filter(k => !same(existing[k], row[k]));
      const flip = publishable && publish && Number(existing.published) !== 1;
      if (!changed.length && !flip) { stats.unchanged++; log(`= ${slug}  (unchanged)`); continue; }
      const sets = changed.map(k => `${k}=?`);
      const vals = changed.map(k => row[k]);
      if (flip) { sets.push('published=1'); stats.published++; }
      sets.push("updated_at=datetime('now')");
      if (stamp) { sets.push('updated_by=?'); vals.push('content-apply'); }
      vals.push(existing.id);
      if (!dryRun) db.prepare(`UPDATE ${spec.table} SET ${sets.join(', ')} WHERE id=?`).run(...vals);
      stats.updated++;
      log(`~ ${slug}  (${changed.length ? changed.join(', ') : ''}${changed.length && flip ? ', ' : ''}${flip ? 'published' : ''})`);
    }
  });
  run();
  return { ...stats, total: entries.length };
}

// ---- CLI ---------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const kind = args.find(a => !a.startsWith('--'));
  const publish = args.includes('--publish');
  const dryRun = args.includes('--dry-run');
  if (publish && KINDS[kind]?.publishable === false) console.warn(`[content-apply] --publish is ignored for ${kind}: "enabled" comes from each file`);
  if (!kind || !KINDS[kind]) {
    console.error(`usage: node scripts/content-apply.mjs <${Object.keys(KINDS).join('|')}> [--publish] [--dry-run]  (knowledge ignores --publish)`);
    process.exit(2);
  }
  const { db } = await import('../src/db/index.js');
  const { config } = await import('../src/config.js');
  console.log(`[content-apply] ${kind} → ${join(config.dataDir, 'sysaiq.db')}${dryRun ? '  (dry run)' : ''}`);
  try {
    const s = applyKind(db, kind, { publish, dryRun, log: m => console.log('  ' + m), warn: m => console.warn('  ' + m) });
    console.log(`[content-apply] ${s.total} files: ${s.created} created, ${s.updated} updated, ${s.unchanged} unchanged, ${s.published} newly published${dryRun ? ' (nothing written)' : ''}`);
    if (s.skipped) console.warn(`[content-apply] ${s.skipped.length} column(s) skipped because the table lacks them: ${s.skipped.join(', ')}`);
    if (!dryRun && (s.created || s.updated)) console.log('[content-apply] restart the sysaiq service (or save anything in the admin) so the render cache picks the changes up');
  } catch (e) {
    console.error(`[content-apply] failed: ${e.message}`);
    process.exit(1);
  } finally {
    db.close();
  }
}
