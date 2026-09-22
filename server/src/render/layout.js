// Shared chrome for every server-rendered page (/:lang/…):
//   renderLayout({ lang, title, description, canonicalPath, head?, body, noindex?, jsonld?, bodyClass?, ogImage? })
// <html lang dir>, meta + canonical + hreflang (en / fa / x-default = fa),
// OG/Twitter, /assets/site/pages.css + pages.js (no inline script — the
// only <style> is the Persian @font-face), sticky glass header (brand, nav
// from lib/sitecontext.js, language switch to the same path, CTA), <main>,
// the 5-column footer and the copyright line. Every string that comes from
// the DB or a caller is escaped here or by the caller's renderer.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../config.js';
import { esc, attr, jsonForScript } from '../lib/html.js';
import { toFaDigits } from '../lib/normalize.js';
import { getSiteContext, otherLang } from '../lib/sitecontext.js';

const FONT_URL = '/assets/vazirmatn-var.woff2';
const LOGO = '/assets/logo-mark-160.png';
const OG_DEFAULT = '/og.jpg';

// cache-busting version of the two site assets: their mtime at boot (a
// deploy restarts the process). Falls back to '1' when the site dir has no
// assets (tests) so the URL is still well-formed.
function assetVersion() {
  let v = 0;
  for (const f of ['pages.css', 'pages.js']) {
    try { v = Math.max(v, Math.floor(statSync(join(config.siteDir, 'assets', 'site', f)).mtimeMs)); } catch { /* missing asset */ }
  }
  return v ? v.toString(36) : '1';
}
export const ASSET_V = assetVersion();

const STR = {
  fa: {
    skip: 'پرش به محتوا', menu: 'منو', cta: 'شروع پروژه', lang: 'EN', langTitle: 'English',
    services: 'خدمات', links: 'SysaiQ', legal: 'قوانین و اعتماد', contact: 'تماس',
    contactHome: 'تماس با ما', home: 'خانه', work: 'نمونه‌کارها',
    tagline: 'مستقر در قزوین، خدمت‌رسانی به سراسر ایران و خارج از کشور.',
    rights: 'همهٔ حقوق محفوظ است.',
    email: 'ایمیل', landline: 'تلفن ثابت', mobile: 'موبایل', address: 'نشانی', hours: 'ساعات کاری',
  },
  en: {
    skip: 'Skip to content', menu: 'Menu', cta: 'Start a project', lang: 'FA', langTitle: 'فارسی',
    services: 'Services', links: 'SysaiQ', legal: 'Legal and trust', contact: 'Contact',
    contactHome: 'Contact us', home: 'Home', work: 'Work',
    tagline: 'Based in Qazvin, serving clients across Iran and abroad.',
    rights: 'All rights reserved.',
    email: 'Email', landline: 'Landline', mobile: 'Mobile', address: 'Address', hours: 'Hours',
  },
};

// '028-33323002' → '+982833323002'; an explicit E.164 from site info wins
export function telHref(display, explicit) {
  if (explicit && /^\+\d{6,15}$/.test(explicit)) return explicit;
  const d = String(display || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0098')) return `+${d.slice(2)}`;
  if (d.startsWith('98') && d.length >= 11) return `+${d}`;
  if (d.startsWith('0')) return `+98${d.slice(1)}`;
  return `+98${d}`;
}

// the same page in the other language: swap the leading /xx/ segment
export function switchPath(canonicalPath, lang) {
  const p = String(canonicalPath || `/${lang}/`);
  return p.replace(/^\/(?:en|fa)(?=\/|$)/, `/${otherLang(lang)}`);
}

const year = lang => (lang === 'fa'
  ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric' }).format(new Date())
  : String(new Date().getFullYear()));

const link = (href, label, cls = '') => `<a${cls ? ` class="${cls}"` : ''} href="${attr(href)}">${esc(label)}</a>`;

function contactColumn(lang, info, t) {
  const rows = [];
  const num = s => (lang === 'fa' ? toFaDigits(s) : s);
  if (info.email) rows.push(`<li><span class="k">${t.email}</span><a href="mailto:${attr(info.email)}" dir="ltr">${esc(info.email)}</a></li>`);
  if (info.landline) rows.push(`<li><span class="k">${t.landline}</span><a href="tel:${attr(telHref(info.landline, info.landline_tel))}" dir="ltr">${esc(num(info.landline))}</a></li>`);
  if (info.mobile) rows.push(`<li><span class="k">${t.mobile}</span><a href="tel:${attr(telHref(info.mobile, info.mobile_tel))}" dir="ltr">${esc(num(info.mobile))}</a></li>`);
  if (info.address) rows.push(`<li><span class="k">${t.address}</span><span>${esc(info.address)}</span></li>`);
  if (info.hours) rows.push(`<li><span class="k">${t.hours}</span><span>${esc(num(info.hours))}</span></li>`);
  return rows.join('');
}

export function renderLayout({
  lang = 'fa', title = '', description = '', canonicalPath = `/${lang}/`,
  head = '', body = '', noindex = false, jsonld = null, bodyClass = '', ogImage = '',
} = {}) {
  lang = lang === 'en' ? 'en' : 'fa';
  const fa = lang === 'fa';
  const t = STR[lang];
  const ctx = getSiteContext(lang);
  const base = config.publicBaseUrl;
  const altPath = switchPath(canonicalPath, lang);
  const faPath = fa ? canonicalPath : altPath;
  const enPath = fa ? altPath : canonicalPath;
  const fullTitle = title ? `${title} — SysaiQ` : 'SysaiQ';
  const og = ogImage || OG_DEFAULT;
  const ogUrl = /^https?:\/\//i.test(og) ? og : base + og;
  const jsonldBlocks = (Array.isArray(jsonld) ? jsonld : jsonld ? [jsonld] : [])
    .map(o => `<script type="application/ld+json">${jsonForScript(o)}</script>`).join('\n');

  const navLinks = ctx.nav.map(n => link(n.href, n.label)).join('');
  // the footer's SysaiQ column ends with the contact page (/:lang/contact,
  // rendered from site info — never a pages row: the slug is reserved), so
  // the link is added once and only when no nav entry already points there
  const contactPath = `/${lang}/contact`;
  const siteLinks = [
    ...ctx.nav.map(n => link(n.href, n.label)),
    ...(ctx.nav.some(n => n.href === contactPath) ? [] : [link(contactPath, t.contactHome)]),
  ].join('');
  const serviceLinks = ctx.services.map(s => link(s.href, s.label)).join('');
  const legalLinks = ctx.footerPages.map(p => link(p.href, p.label)).join('');
  const contactRows = contactColumn(lang, ctx.siteInfo, t);

  return `<!DOCTYPE html>
<html lang="${lang}" dir="${fa ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>
<meta name="description" content="${attr(description)}">
${noindex ? '<meta name="robots" content="noindex">\n' : ''}<link rel="canonical" href="${attr(base + canonicalPath)}">
<link rel="alternate" hreflang="fa" href="${attr(base + faPath)}">
<link rel="alternate" hreflang="en" href="${attr(base + enPath)}">
<link rel="alternate" hreflang="x-default" href="${attr(base + faPath)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SysaiQ">
<meta property="og:locale" content="${fa ? 'fa_IR' : 'en_US'}">
<meta property="og:locale:alternate" content="${fa ? 'en_US' : 'fa_IR'}">
<meta property="og:title" content="${attr(fullTitle)}">
<meta property="og:description" content="${attr(description)}">
<meta property="og:url" content="${attr(base + canonicalPath)}">
<meta property="og:image" content="${attr(ogUrl)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${attr(fullTitle)}">
<meta name="twitter:description" content="${attr(description)}">
<meta name="twitter:image" content="${attr(ogUrl)}">
<link rel="icon" href="/assets/favicon-64.png" type="image/png">
<meta name="theme-color" content="#070a12">
${fa ? `<link rel="preload" href="${FONT_URL}" as="font" type="font/woff2" crossorigin>
<style>@font-face{font-family:'Vazirmatn';src:url(${FONT_URL}) format('woff2-variations'),url(${FONT_URL}) format('woff2');font-weight:100 900;font-display:swap;}</style>
` : ''}<link rel="stylesheet" href="/assets/site/pages.css?v=${ASSET_V}">
<script src="/assets/site/pages.js?v=${ASSET_V}" defer></script>
${jsonldBlocks}
${head}
</head>
<body class="site${bodyClass ? ` ${esc(bodyClass)}` : ''}">
<a class="skip" href="#main">${t.skip}</a>
<header class="site-header">
  <div class="wrap">
    <a class="brand" href="/${lang}/"><img src="${LOGO}" alt="" width="27" height="27"><span>SysaiQ</span></a>
    <button class="nav-toggle" type="button" data-nav-toggle aria-controls="site-nav" aria-expanded="false" aria-label="${t.menu}"><span></span><span></span><span></span></button>
    <nav class="site-nav" id="site-nav" aria-label="${fa ? 'ناوبری اصلی' : 'Main navigation'}">
      ${navLinks}
    </nav>
    <div class="top-actions">
      <a class="lang-switch" href="${attr(altPath)}" hreflang="${otherLang(lang)}" lang="${otherLang(lang)}" title="${t.langTitle}" dir="ltr">${t.lang}</a>
      <a class="btn btn-primary btn-sm" href="/${lang}/#contact">${t.cta}</a>
    </div>
  </div>
</header>
<main id="main" class="site-main">
${body}
</main>
<footer class="site-footer">
  <div class="wrap">
    <div class="foot-grid">
      <div class="foot-col foot-brand">
        <a class="brand" href="/${lang}/"><img src="${LOGO}" alt="" width="27" height="27"><span>SysaiQ</span></a>
        <p class="foot-tagline">${t.tagline}</p>
        ${ctx.badgesHtml ? `<div class="foot-trust">${ctx.badgesHtml}</div>` : ''}
      </div>
      ${serviceLinks ? `<div class="foot-col"><h2 class="foot-h">${t.services}</h2><nav class="foot-links" aria-label="${t.services}">${serviceLinks}</nav></div>` : ''}
      <div class="foot-col"><h2 class="foot-h">${t.links}</h2><nav class="foot-links" aria-label="${t.links}">${siteLinks}</nav></div>
      ${legalLinks ? `<div class="foot-col"><h2 class="foot-h">${t.legal}</h2><nav class="foot-links" aria-label="${t.legal}">${legalLinks}</nav></div>` : ''}
      ${contactRows ? `<div class="foot-col"><h2 class="foot-h">${t.contact}</h2><ul class="foot-contact">${contactRows}</ul></div>` : ''}
    </div>
    <div class="foot-base">
      <span>© ${year(lang)} SysaiQ · ${t.rights}</span>
      <span class="mono" dir="ltr">SYSAIQ.COM</span>
    </div>
  </div>
</footer>
</body>
</html>`;
}
