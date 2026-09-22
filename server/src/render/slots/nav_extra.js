// Home-page slot NAV_EXTRA: extra header links after the template's fixed
// ones — the services entry (when any service is published), pages with
// show_in_nav and sections with show_in_nav. Plain <a> elements, exactly
// like the template's own `<nav><a href="#work">…</a></nav>` markup. Section
// links are same-page anchors on the home page.
import { esc, attr } from '../../lib/html.js';
import { getSiteContext } from '../../lib/sitecontext.js';

export function renderNavExtra(lang) {
  const ctx = getSiteContext(lang === 'en' ? 'en' : 'fa');
  return ctx.navExtra.map(n => {
    const href = n.href.replace(new RegExp(`^/${ctx.lang}/#`), '#');
    return `<a href="${attr(href)}">${esc(n.label)}</a>`;
  }).join('\n');
}
export default renderNavExtra;
