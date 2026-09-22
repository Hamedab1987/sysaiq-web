// Home-page membership flags: projects.show_on_home (default 0, the nine
// showcase projects flipped to 1) and faqs.show_on_home (default 1).
//
// The baked home page showed the W<n>_D copy from content.py for each
// showcase row, while the seeded projects.desc_* still held the short
// tagline. So that the showcase reads exactly the same the moment the
// server-rendered home goes live, a desc_<lang> that still equals
// tagline_<lang> (never edited by the owner) is replaced by that W<n>_D
// default from server/templates/content-defaults.json. An edited desc is
// left alone. Missing defaults file (fresh checkout without build.py) →
// flags only, one warning.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const version = 6;
export const name = 'show_on_home';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULTS_PATH = join(__dirname, '..', '..', '..', 'templates', 'content-defaults.json');

// order = W1..W9 in the template
export const SHOWCASE_SLUGS = Object.freeze([
  'restaurant', 'realestate', 'medical', 'trading', 'ecommerce', 'accounting', 'pos', 'salon', 'distribution',
]);

function readDefaults(path) {
  try {
    const d = JSON.parse(readFileSync(path, 'utf8'));
    return d && typeof d === 'object' && !Array.isArray(d) ? d : null;
  } catch {
    return null;
  }
}

export function up(db, ctx, { defaultsPath = DEFAULTS_PATH } = {}) {
  ctx.addColumn('projects', 'show_on_home', 'INTEGER NOT NULL DEFAULT 0');
  ctx.addColumn('faqs', 'show_on_home', 'INTEGER NOT NULL DEFAULT 1');

  db.prepare(`UPDATE projects SET show_on_home=1 WHERE slug IN (${SHOWCASE_SLUGS.map(() => '?').join(',')})`)
    .run(...SHOWCASE_SLUGS);

  const defaults = readDefaults(defaultsPath);
  if (!defaults) {
    if (process.env.NODE_ENV !== 'test') console.warn('[migrate 006] templates/content-defaults.json not found — showcase descriptions left as they are (run build.py and they will differ from the baked page until edited)');
    return;
  }
  const sync = {
    en: db.prepare('UPDATE projects SET desc_en=? WHERE slug=? AND desc_en=tagline_en'),
    fa: db.prepare('UPDATE projects SET desc_fa=? WHERE slug=? AND desc_fa=tagline_fa'),
  };
  let n = 0;
  SHOWCASE_SLUGS.forEach((slug, i) => {
    const d = defaults[`W${i + 1}_D`];
    if (!d || typeof d !== 'object') return;
    for (const lang of ['en', 'fa']) {
      if (typeof d[lang] !== 'string' || !d[lang]) continue;
      n += sync[lang].run(d[lang], slug).changes;
    }
  });
  if (n && process.env.NODE_ENV !== 'test') console.log(`[migrate 006] synced ${n} unedited showcase description(s) to the home-page defaults`);
}
