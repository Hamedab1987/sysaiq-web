// SLOT:FOOTER_TRUST — enabled trust seals (placement footer|both, langs
// matching) on small white rounded tiles (the seals are drawn for light
// backgrounds). Markup per seal comes from lib/trust.js renderBadge(), never
// from the pasted snippet.
import { db } from '../../db/index.js';
import { renderBadge } from '../../lib/trust.js';

const langMatch = (langs, lang) => String(langs || '').split(',').map(s => s.trim()).filter(Boolean).includes(lang);

// enabled badges for one placement ('footer' also includes 'both')
export function badgesFor(placement, lang) {
  const l = lang === 'fa' ? 'fa' : 'en';
  return db.prepare('SELECT * FROM badges WHERE enabled=1 AND (placement=? OR placement=\'both\') ORDER BY sort, id').all(placement)
    .filter(b => langMatch(b.langs, l));
}

export function renderTrustStrip(lang, placement = 'footer') {
  const tiles = badgesFor(placement, lang)
    .map(b => renderBadge(b, lang))
    .filter(Boolean)
    .map(html => `<div class="trust-tile">${html}</div>`);
  if (!tiles.length) return '';
  return `<div class="trust-strip" data-placement="${placement}">${tiles.join('')}</div>`;
}

// the slot carries its own small style block: the footer belongs to the template
export const TRUST_CSS = `<style>
.trust-strip{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:center;padding:18px 0 6px}
.trust-tile{background:#fff;border-radius:12px;padding:8px 10px;display:inline-flex;align-items:center;justify-content:center;min-width:72px;min-height:72px;max-height:150px}
.trust-tile .badge{display:inline-flex;line-height:0}
.trust-tile img{display:block;max-height:130px;max-width:150px;height:auto;width:auto}
</style>`;

export function renderFooterTrustSlot(lang) {
  const strip = renderTrustStrip(lang, 'footer');
  return strip ? `${TRUST_CSS}\n${strip}` : '';
}
// the name lib/sitecontext.js looks for (shared SSR footer)
export const renderFooterTrust = renderFooterTrustSlot;

export function render({ lang = 'fa' } = {}) {
  return renderFooterTrustSlot(lang);
}
export default render;
