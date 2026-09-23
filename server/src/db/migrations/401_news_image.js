// Optional per-item display image for published news (range 400–499).
// '' = no image: every surface keeps drawing the brand cover, so existing
// rows look exactly as before. The value is a site path (/uploads/…) or an
// https URL, validated by the admin route; renderers re-check it.
//
// Imports nothing on purpose: db/index.js is still awaiting runMigrations()
// while this file loads (see 002_secrets.js).

export const version = 401;
export const name = 'news_image';

export function up(db, ctx) {
  if (!ctx.hasColumn('news_items', 'image')) db.exec("ALTER TABLE news_items ADD COLUMN image TEXT NOT NULL DEFAULT ''");
}
