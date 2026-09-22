// Data fix: migration 008 seeded a `contact` system page, but /:lang/contact
// is rendered from site info (routes/public/contact.routes.js) and the slug
// is reserved in routes/public/pages.routes.js, so that row's body was never
// shown anywhere and, once published with show_in_nav, it duplicated
// «تماس با ما» in the footer. The row is removed; 008 no longer seeds it.
// Schema untouched (additive-only rule): a rolled-back build never rendered
// this row either, so nothing depends on it. Imports nothing from db/index.js.
export const version = 12;
export const name = 'drop_contact_page';

export function up(db, ctx) {
  if (!ctx.hasTable('pages')) return;
  db.prepare("DELETE FROM pages WHERE system_key = 'contact' OR slug = 'contact'").run();
}
