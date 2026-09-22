// Home-page slot FOOTER_LINKS: the «قوانین و اعتماد» row — the legal / trust
// pages (published, show_in_footer) plus the services index when any service
// is published. The template puts the marker directly inside `footer > .wrap`
// between `.foot-main` and `.foot-base` (not inside `.foot-nav`), so the slot
// is self-contained like the sections engine: a labelled row plus its own
// small <style> (the home CSP allows inline styles, never inline scripts) —
// it never depends on a template rule. It is a div[role=navigation], not a
// <nav>: the template styles the bare `nav` element for the header (and
// turns it into the absolutely-positioned mobile dropdown ≤900px), which is
// also why the template's own footer row is `div.foot-nav`.
// Empty when there is nothing to link.
import { esc, attr } from '../../lib/html.js';
import { getSiteContext } from '../../lib/sitecontext.js';

const STR = {
  fa: { label: 'قوانین و اعتماد', services: 'خدمات' },
  en: { label: 'Legal and trust', services: 'Services' },
};

// colours fall back to the template's tokens (--dim / --ink / --line / --faint)
export const FOOTER_LINKS_CSS = `<style>
.foot-legal{display:flex;flex-wrap:wrap;align-items:center;gap:10px 22px;padding:16px 0 22px;border-top:1px solid var(--line,rgba(236,234,246,.12))}
.foot-legal-h{font-size:12px;color:var(--faint,rgba(236,234,246,.32));margin-inline-end:6px}
.foot-legal a{font-size:12px;color:var(--dim,rgba(236,234,246,.55));text-decoration:none;transition:color .25s}
.foot-legal a:hover,.foot-legal a:focus-visible{color:var(--ink,#eceaf6)}
</style>`;

export function footerLinks(lang) {
  const ctx = getSiteContext(lang === 'en' ? 'en' : 'fa');
  return [
    ...(ctx.services.length ? [{ href: `/${ctx.lang}/services`, label: STR[ctx.lang].services }] : []),
    ...ctx.footerPages,
  ];
}

export function renderFooterLinks(lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const links = footerLinks(lang);
  if (!links.length) return '';
  const t = STR[lang];
  return `${FOOTER_LINKS_CSS}
<div class="foot-legal" role="navigation" aria-label="${attr(t.label)}"><span class="foot-legal-h">${esc(t.label)}</span>${links.map(n => `<a href="${attr(n.href)}">${esc(n.label)}</a>`).join('')}</div>`;
}
export default renderFooterLinks;
