// Everything the shared page chrome needs for one language, built from the
// DB and memoised until the next admin write (lib/cache.js is invalidated by
// routes/admin/index.js on every 2xx write):
//   getSiteContext('fa') → { lang, other, nav, navExtra, services, footerPages, siteInfo, tokens, badgesHtml }
// Site info comes from lib/siteinfo.js (getSiteInfo / tokens) and the trust
// strip from render/slots/footer_trust.js — both Foundation contract. A
// render-time exception in either is logged and degrades to the owner's
// fixed defaults (hello@sysaiq.com, no badges) rather than a 500 on every page.
import { db } from '../db/index.js';
import { cached } from './cache.js';
import { getSiteInfo, tokens as siteInfoTokens } from './siteinfo.js';
import { renderFooterTrust } from '../render/slots/footer_trust.js';

const LANGS = ['en', 'fa'];
export const otherLang = lang => (lang === 'fa' ? 'en' : 'fa');

const L = {
  fa: { home: 'خانه', services: 'خدمات', work: 'نمونه‌کارها', news: 'اخبار', contact: 'تماس' },
  en: { home: 'Home', services: 'Services', work: 'Work', news: 'News', contact: 'Contact' },
};

// ---- site info ---------------------------------------------------------------
// Normalised shape used by the layout: plain strings in the requested
// language ('' when hidden or unset), picked from getSiteInfo(lang).
const INFO_KEYS = ['owner_name', 'address', 'landline', 'mobile', 'email', 'hours', 'landline_tel', 'mobile_tel', 'whatsapp', 'telegram', 'map_url', 'instagram', 'linkedin'];

const DEFAULT_INFO = Object.freeze({
  fa: Object.freeze({ owner_name: 'حامد ابوعلی', email: 'hello@sysaiq.com' }),
  en: Object.freeze({ owner_name: 'Hamed Abooali', email: 'hello@sysaiq.com' }),
});

function loadSiteInfo(lang) {
  const out = { ...DEFAULT_INFO[lang] };
  let raw = null;
  try { raw = getSiteInfo(lang); } catch (e) { console.error(`[sitecontext] getSiteInfo(${lang}) threw: ${e?.message || e}`); }
  if (!raw || typeof raw !== 'object') return out;
  for (const k of INFO_KEYS) {
    const v = raw[k] === null || raw[k] === undefined ? '' : String(raw[k]).trim();
    if (v) out[k] = v;
  }
  return out;
}

// {{site.*}} tokens for renderMarkdown: lib/siteinfo.js owns the map; if it
// throws, only the known chrome values are substituted so an unset token
// stays visible in the draft instead of the page failing
export function siteTokens(info, lang) {
  try {
    const t = siteInfoTokens(lang);
    if (t && typeof t === 'object') return { ...t };
  } catch (e) { console.error(`[sitecontext] tokens(${lang}) threw: ${e?.message || e}`); }
  const tokens = {};
  for (const k of ['owner_name', 'address', 'landline', 'mobile', 'email', 'hours']) {
    if (info[k]) tokens[`site.${k}`] = info[k];
  }
  return tokens;
}

// ---- DB-derived navigation -------------------------------------------------
function navPages(lang) {
  return db.prepare('SELECT slug, title_en, title_fa FROM pages WHERE published=1 AND show_in_nav=1 ORDER BY sort, id').all()
    .map(p => ({ href: `/${lang}/${p.slug}`, label: (lang === 'fa' ? p.title_fa : p.title_en) || p.title_en || p.slug }));
}
function footerPages(lang) {
  return db.prepare('SELECT slug, title_en, title_fa FROM pages WHERE published=1 AND show_in_footer=1 ORDER BY sort, id').all()
    .map(p => ({ href: `/${lang}/${p.slug}`, label: (lang === 'fa' ? p.title_fa : p.title_en) || p.title_en || p.slug }));
}
function navSections(lang) {
  return db.prepare('SELECT slug, nav_label_en, nav_label_fa, title_en, title_fa FROM sections WHERE published=1 AND show_in_nav=1 ORDER BY sort, id').all()
    .map(s => ({
      href: `/${lang}/#${s.slug}`,
      label: (lang === 'fa' ? s.nav_label_fa || s.title_fa : s.nav_label_en || s.title_en) || s.slug,
    }));
}
function publishedServices(lang) {
  return db.prepare('SELECT slug, title_en, title_fa FROM services WHERE published=1 ORDER BY sort, id').all()
    .map(s => ({ href: `/${lang}/services/${s.slug}`, label: (lang === 'fa' ? s.title_fa : s.title_en) || s.title_en || s.slug }));
}

// the news section only gets a header link once something is published
function hasPublishedNews() {
  try { return !!db.prepare("SELECT 1 FROM news_items WHERE status='published' LIMIT 1").get(); } catch { return false; }
}

function build(lang) {
  const t = L[lang];
  const services = publishedServices(lang);
  // links the home template does not already have: they go into the home
  // NAV_EXTRA slot and after the fixed items in the SSR header
  const navExtra = [
    ...(services.length ? [{ href: `/${lang}/services`, label: t.services }] : []),
    ...navPages(lang),
    ...navSections(lang),
    ...(hasPublishedNews() ? [{ href: `/${lang}/news`, label: t.news }] : []),
  ];
  const nav = [
    { href: `/${lang}/`, label: t.home },
    ...navExtra,
    { href: `/${lang}/work`, label: t.work },
  ];
  const siteInfo = loadSiteInfo(lang);

  let badgesHtml = '';
  try { badgesHtml = String(renderFooterTrust(lang) ?? ''); } catch (e) { console.error(`[sitecontext] renderFooterTrust(${lang}) threw: ${e?.message || e}`); }

  return Object.freeze({
    lang, other: otherLang(lang), nav, navExtra, services,
    footerPages: footerPages(lang), siteInfo, tokens: siteTokens(siteInfo, lang), badgesHtml,
  });
}

export function getSiteContext(lang) {
  if (!LANGS.includes(lang)) lang = 'fa';
  return cached(`sitecontext:${lang}`, () => build(lang));
}
