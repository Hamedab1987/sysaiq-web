// Server-rendered portfolio on the shared layout (same URLs as before):
//   /:lang/work        cinematic index — featured project (first by sort) as a
//                      wide card, category filter chips (work.js) with counts,
//                      16:9 cards, ItemList + BreadcrumbList JSON-LD
//   /:lang/work/:slug  case study — cover hero, key-facts bar, the story
//                      «مسئله → راه‌حل → نتیجه» (markdown, each beat omitted
//                      when empty), features, screens, gallery with a CSP-safe
//                      <dialog> lightbox (work.js), technical approach,
//                      industries, related service (only when published),
//                      related projects (same category), prev/next, CTA,
//                      CreativeWork + BreadcrumbList JSON-LD
// Every admin string reaches HTML through esc()/attr() or renderMarkdown();
// every image URL through safeSrc() (site-relative or https only).
// Extra assets (/assets/site/work.css + work.js) go in through the layout's
// `head` option; they are versioned by mtime like pages.css.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/index.js';
import { esc, attr, J } from '../lib/html.js';
import { config } from '../config.js';
import { toFaDigits } from '../lib/normalize.js';
import { renderMarkdown } from '../lib/markdown.js';
import { getSiteContext } from '../lib/sitecontext.js';
import { professionalService, breadcrumb } from '../lib/jsonld.js';
import { CATEGORIES, CATEGORY_BY_SLUG } from '../db/migrations/013_projects_story.js';
import { renderLayout } from './layout.js';

export function findProject(slug) {
  return db.prepare('SELECT * FROM projects WHERE slug=? AND published=1').get(String(slug));
}
export function allProjects() {
  return db.prepare('SELECT * FROM projects WHERE published=1 ORDER BY sort, id').all();
}

function assetVersion() {
  let v = 0;
  for (const f of ['work.css', 'work.js']) {
    try { v = Math.max(v, Math.floor(statSync(join(config.siteDir, 'assets', 'site', f)).mtimeMs)); } catch { /* missing asset (tests) */ }
  }
  return v ? v.toString(36) : '1';
}
const V = assetVersion();
export const WORK_CSS = `/assets/site/work.css?v=${V}`;
export const WORK_JS = `/assets/site/work.js?v=${V}`;
const HEAD = `<link rel="stylesheet" href="${WORK_CSS}">\n<script src="${WORK_JS}" defer></script>`;

const CAT_LABEL = {
  fa: { 'business-systems': 'سیستم‌های کسب‌وکار', 'profession-landing': 'لندینگ مشاغل', 'ai-automation': 'هوش مصنوعی و اتوماسیون', 'finance-trading': 'مالی و معاملاتی' },
  en: { 'business-systems': 'Business systems', 'profession-landing': 'Profession landing pages', 'ai-automation': 'AI & automation', 'finance-trading': 'Finance & trading' },
};

const STR = {
  fa: {
    title: 'همهٔ پروژه‌ها', sub: 'نمونه‌کارهای SysaiQ — سیستم‌ها و وب‌سایت‌هایی برای صنف‌ها و شرکت‌های مختلف',
    home: 'صفحهٔ اصلی', crumbWork: 'نمونه‌کارها', open: 'مشاهدهٔ پروژه', featured: 'پروژهٔ شاخص',
    filter: 'فیلتر بر اساس دسته', all: 'همه', count: n => `${n} پروژه`, empty: 'هنوز پروژه‌ای منتشر نشده است.',
    overview: 'معرفی', problem: 'مسئله', solution: 'راه‌حل', outcome: 'نتیجه', story: 'روایت پروژه',
    features: 'قابلیت‌های متمایز', featuresSub: 'چیزهایی که در محصولات مشابه معمولاً نیست',
    pages: 'صفحات و اسکرین‌ها', gallery: 'گالری تصاویر', galleryHint: 'برای بزرگ‌نمایی روی هر تصویر بزنید.',
    tech: 'رویکرد فنی', industries: 'صنایع هدف', service: 'خدمت مرتبط', serviceMore: 'جزئیات این خدمت',
    related: 'پروژه‌های مرتبط', others: 'پروژه‌های دیگر', prev: 'پروژهٔ قبلی', next: 'پروژهٔ بعدی',
    ctaTitle: 'پروژه‌ای مشابه می‌خواهید؟', ctaText: 'چند خط دربارهٔ کسب‌وکارتان و مسئله‌ای که می‌خواهید حل شود بنویسید؛ پیش از هر تعهدی، پیشنهاد کتبی دریافت می‌کنید.',
    cta: 'شروع پروژه', allWork: 'همهٔ پروژه‌ها',
    factCategory: 'دسته', factService: 'خدمت مرتبط', factIndustries: 'صنایع هدف', industriesN: n => `${n} صنعت`, factLangs: 'زبان‌ها',
    uiEn: 'تصویر: رابط انگلیسی', zoom: 'بزرگ‌نمایی', dialog: 'نمایش تصویر', close: 'بستن', prevImg: 'تصویر قبلی', nextImg: 'تصویر بعدی',
  },
  en: {
    title: 'All work', sub: 'SysaiQ portfolio — systems and websites across industries and trades',
    home: 'Home', crumbWork: 'Work', open: 'View project', featured: 'Featured',
    filter: 'Filter by category', all: 'All', count: n => `${n} ${n === 1 ? 'project' : 'projects'}`, empty: 'No project has been published yet.',
    overview: 'Overview', problem: 'The problem', solution: 'The solution', outcome: 'The outcome', story: 'Project story',
    features: 'What makes it different', featuresSub: "Capabilities you won't usually find in similar products",
    pages: 'Pages and screens', gallery: 'Gallery', galleryHint: 'Select an image to enlarge it.',
    tech: 'Technical approach', industries: 'Target industries', service: 'Related service', serviceMore: 'About this service',
    related: 'Related projects', others: 'More projects', prev: 'Previous project', next: 'Next project',
    ctaTitle: 'Want something like this?', ctaText: 'Write a few lines about your business and the problem you want solved; you receive a written proposal before any commitment.',
    cta: 'Start a project', allWork: 'All work',
    factCategory: 'Category', factService: 'Related service', factIndustries: 'Target industries', industriesN: n => `${n} ${n === 1 ? 'industry' : 'industries'}`, factLangs: 'Languages',
    uiEn: 'Screenshot: English UI', zoom: 'Enlarge', dialog: 'Image viewer', close: 'Close', prevImg: 'Previous image', nextImg: 'Next image',
  },
};

// in RTL the "forward" direction points left
const fwd = lang => (lang === 'fa' ? '←' : '→');
const bwd = lang => (lang === 'fa' ? '→' : '←');
const num = (lang, n) => (lang === 'fa' ? toFaDigits(String(n)) : String(n));
const idx = (lang, i) => {
  const s = String(i + 1).padStart(2, '0');
  return lang === 'fa' ? `<span class="w-idx">[ ${toFaDigits(s)} ]</span>` : `<span class="w-idx mono" dir="ltr">[ ${s} ]</span>`;
};
const pick = (row, key, lang) => String((lang === 'fa' ? row[`${key}_fa`] : row[`${key}_en`]) || '').trim();

// [[name, path], …] → BreadcrumbList (lib/jsonld.js makes the urls absolute)
const crumbs = items => breadcrumb(items.map(([name, url]) => ({ name, url })));

// A site-relative path (never protocol-relative, no backslash, no quotes or
// spaces) or an https URL; the seed's "../assets/…" covers are made
// site-absolute. Anything else renders no image.
export function safeSrc(s) {
  const raw = String(s ?? '').trim().replace(/^(?:\.\.\/)+assets\//, '/assets/');
  if (/^\/(?![/\\])[^\s"'<>\\]*$/.test(raw)) return raw;
  if (/^https:\/\/[^/?#\\\s"'<>@]+(?:[/?#][^\s"'<>\\]*)?$/i.test(raw)) return raw;
  return '';
}
const abs = src => (/^https?:\/\//i.test(src) ? src : config.publicBaseUrl + src);

// the category column, else the migration's map for the 17 seeded slugs
export function categoryOf(p) {
  return CATEGORIES.includes(p.category) ? p.category : (CATEGORY_BY_SLUG[p.slug] || '');
}
function coverOf(p, lang) {
  return (lang === 'fa' && safeSrc(p.cover_fa)) || safeSrc(p.cover_en) || safeSrc(p.image);
}
const thumbOf = (p, lang) => safeSrc(p.image) || coverOf(p, lang);
const tagline = (p, lang) => pick(p, 'tagline', lang) || pick(p, 'desc', lang);
const titleOf = (p, lang) => pick(p, 'title', lang) || p.title_en || p.slug;

// gallery column → [{src, caption}] (max 12, only safe images)
function galleryOf(p, lang) {
  return J(p.gallery).filter(g => g && typeof g === 'object').map(g => ({
    src: safeSrc(g.image),
    caption: String((lang === 'fa' ? g.caption_fa || g.caption_en : g.caption_en || g.caption_fa) || '').trim(),
  })).filter(g => g.src).slice(0, 12);
}

// «فارسی · English» is shown only with evidence the built system is
// bilingual: a Persian-UI screenshot, or bilingual/RTL named in its tags or
// features. Otherwise the fact is omitted — never guessed.
const FA_IMG = /-fa[-.]/i;
const BILINGUAL = /bilingual|\bRTL\b|دوزبانه/i;
function isBilingual(p) {
  if (FA_IMG.test(p.cover_fa || '') || J(p.gallery).some(g => FA_IMG.test(String(g?.image || '')))) return true;
  if (BILINGUAL.test(p.tags || '')) return true;
  return J(p.features).some(f => f && BILINGUAL.test(`${f.title_en || ''} ${f.title_fa || ''}`));
}

// one cinematic card; the featured one is wide and loads its image eagerly
function card(p, i, lang, t, { featured = false, eager = false } = {}) {
  const title = titleOf(p, lang);
  const cat = categoryOf(p);
  const img = featured ? coverOf(p, lang) : thumbOf(p, lang);
  return `<li class="w-item${featured ? ' is-featured' : ''}" data-category="${attr(cat)}"${featured ? ' data-featured' : ''}>
    <a class="w-card" href="/${lang}/work/${attr(p.slug)}">
      <div class="w-media">${img ? `<img src="${attr(img)}" alt="" width="1600" height="900" decoding="async"${eager ? ' fetchpriority="high"' : ' loading="lazy"'}>` : ''}</div>
      <div class="w-body">
        <div class="w-meta">${idx(lang, i)}${featured ? `<span class="w-flag">${t.featured}</span>` : ''}${cat ? `<span class="w-cat">${esc(CAT_LABEL[lang][cat])}</span>` : ''}</div>
        <b>${esc(title)}</b><p>${esc(tagline(p, lang))}</p>
        ${p.tags ? `<span class="w-tags"><span class="mono" dir="ltr">${esc(p.tags)}</span></span>` : ''}
        <em class="w-go">${t.open} <span aria-hidden="true">${fwd(lang)}</span></em>
      </div>
    </a>
  </li>`;
}

// ---- /:lang/work ------------------------------------------------------------
export function renderWorkIndex(lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const t = STR[lang];
  const projects = allProjects();

  const counts = {};
  for (const p of projects) { const c = categoryOf(p); if (c) counts[c] = (counts[c] || 0) + 1; }
  const cats = CATEGORIES.filter(c => counts[c]);
  const chip = (value, label, n, on) => `<button type="button" class="w-chip" data-filter="${value}" aria-pressed="${on}">${esc(label)} <span class="w-count">${num(lang, n)}</span></button>`;
  const filter = cats.length > 1 ? `<div class="w-filter" role="group" aria-label="${t.filter}" data-work-filter data-count-one="${attr(t.count(1))}" data-count-many="${attr(t.count('{n}'))}">
    ${chip('all', t.all, projects.length, true)}
    ${cats.map(c => chip(c, CAT_LABEL[lang][c], counts[c], false)).join('\n    ')}
  </div>
  <p class="w-status" role="status" aria-live="polite" data-work-status></p>` : '';

  const cards = projects.map((p, i) => card(p, i, lang, t, { featured: i === 0, eager: i === 0 })).join('');

  const body = `<div class="wrap w-index">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${esc(t.home)}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(t.crumbWork)}</span></nav>
  <header class="w-head">
    <p class="eyebrow mono" dir="ltr">[ SYSAIQ—WORK / SYS.03 ]</p>
    <h1>${esc(t.title)}</h1>
    <p class="sub">${esc(t.sub)}</p>
  </header>
  ${filter}
  ${cards ? `<ul class="w-list" data-work-list>${cards}</ul>` : `<p class="empty">${esc(t.empty)}</p>`}
</div>`;

  return renderLayout({
    lang, title: t.title, description: t.sub, canonicalPath: `/${lang}/work`, body, bodyClass: 'page-work', head: HEAD,
    ogImage: projects[0] ? coverOf(projects[0], lang) : '',
    jsonld: [
      crumbs([[t.home, `/${lang}/`], [t.crumbWork, `/${lang}/work`]]),
      {
        '@context': 'https://schema.org', '@type': 'ItemList', name: t.title,
        itemListElement: projects.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: titleOf(p, lang), url: `${config.publicBaseUrl}/${lang}/work/${p.slug}` })),
      },
    ],
  });
}

// ---- /:lang/work/:slug --------------------------------------------------------
// seo_title_* may already end in "— SysaiQ"; the layout appends it once
const seoTitle = s => s.replace(/\s+/g, ' ').replace(/\s*[—–|-]\s*SysaiQ\s*$/i, '').trim();

export function renderProjectPage(p, lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const fa = lang === 'fa';
  const t = STR[lang];
  const ctx = getSiteContext(lang);
  const md = key => renderMarkdown(pick(p, key, lang), { tokens: ctx.tokens });
  const title = titleOf(p, lang);
  const tag = pick(p, 'tagline', lang);
  const overview = pick(p, 'overview', lang);
  const cover = coverOf(p, lang);
  const cat = categoryOf(p);
  const path = `/${lang}/work/${p.slug}`;
  const industries = J(p.industries).map(x => (fa ? x?.fa || x?.en : x?.en || x?.fa)).filter(s => typeof s === 'string' && s.trim());
  const features = J(p.features).filter(f => f && typeof f === 'object' && (f.title_en || f.title_fa));
  const pages = J(p.pages).filter(f => f && typeof f === 'object' && (f.name_en || f.name_fa));
  const gallery = galleryOf(p, lang);
  const svc = ctx.services.find(s => p.service_slug && s.href === `/${lang}/services/${p.service_slug}`);
  // an English screenshot on the Persian page is labelled as such
  const uiEn = fa && cover && !FA_IMG.test(cover);

  // prev / next by sort, related = same category (up to 3)
  const all = allProjects();
  const at = all.findIndex(x => x.id === p.id);
  const prev = at > 0 ? all[at - 1] : null;
  const next = at >= 0 && at < all.length - 1 ? all[at + 1] : null;
  const related = cat ? all.filter(x => x.id !== p.id && categoryOf(x) === cat).slice(0, 3) : [];

  const facts = [
    cat && [t.factCategory, `<a href="/${lang}/work?cat=${cat}">${esc(CAT_LABEL[lang][cat])}</a>`],
    svc && [t.factService, `<a href="${attr(svc.href)}">${esc(svc.label)}</a>`],
    industries.length && [t.factIndustries, t.industriesN(num(lang, industries.length))],
    isBilingual(p) && [t.factLangs, '<span lang="fa">فارسی</span> · <span lang="en" dir="ltr">English</span>'],
  ].filter(Boolean);

  const beats = [['problem', 'PROBLEM'], ['solution', 'SOLUTION'], ['outcome', 'OUTCOME']].filter(([k]) => pick(p, k, lang));
  const story = beats.length ? `<div class="w-story" aria-label="${t.story}">${beats.map(([k, eyebrow], i) => `
    <section class="w-beat w-beat--${k}" id="${k}" aria-labelledby="${k}-h">
      <div class="w-beat__head">
        <span class="w-beat__n" aria-hidden="true">${num(lang, String(i + 1).padStart(2, '0'))}</span>
        <p class="w-beat__eyebrow mono" dir="ltr">${eyebrow}</p>
        <h2 id="${k}-h">${t[k]}</h2>
      </div>
      <div class="prose">${md(k)}</div>
    </section>`).join('')}
  </div>` : '';

  const sec = (id, heading, inner, { sub = '', cls = '' } = {}) => `<section class="w-sec${cls ? ` ${cls}` : ''}" id="${id}" aria-labelledby="${id}-h">
    <header class="w-sec__head"><h2 class="w-sec__h" id="${id}-h">${heading}</h2>${sub ? `<p class="w-sec__sub">${sub}</p>` : ''}</header>
    ${inner}
  </section>`;

  const galleryHtml = gallery.length ? sec('gallery', t.gallery, `<ul class="w-gal${gallery.length === 1 ? ' is-single' : ''}" data-gallery>${gallery.map((g, i) => `
      <li class="w-gal__item"><figure>
        <a class="w-gal__link" href="${attr(g.src)}" data-gal-index="${i}" data-caption="${attr(g.caption)}" aria-label="${attr(`${t.zoom}: ${g.caption || title}`)}"><img src="${attr(g.src)}" alt="${attr(g.caption || title)}" width="1600" height="900" loading="lazy" decoding="async"></a>
        ${g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : ''}
      </figure></li>`).join('')}
    </ul>
    <dialog class="w-lb" data-lightbox-dialog aria-label="${t.dialog}">
      <div class="w-lb__stage" data-lb-stage><figure class="w-lb__fig"><img class="w-lb__img" alt=""><figcaption class="w-lb__cap"></figcaption></figure></div>
      <div class="w-lb__bar"${gallery.length === 1 ? ' hidden' : ''}>
        <button type="button" class="w-lb__btn" data-lb-prev aria-label="${t.prevImg}"><span aria-hidden="true">${bwd(lang)}</span></button>
        <span class="w-lb__count" data-lb-count></span>
        <button type="button" class="w-lb__btn" data-lb-next aria-label="${t.nextImg}"><span aria-hidden="true">${fwd(lang)}</span></button>
      </div>
      <button type="button" class="w-lb__btn w-lb__close" data-lb-close aria-label="${t.close}"><span aria-hidden="true">×</span></button>
    </dialog>`, { sub: t.galleryHint }) : '';

  const pagerLink = (x, rel, label) => `<a class="w-pager__link w-pager__${rel}" href="/${lang}/work/${attr(x.slug)}" rel="${rel}">
      <span class="w-pager__k">${rel === 'prev' ? `<span aria-hidden="true">${bwd(lang)}</span> ` : ''}${label}${rel === 'next' ? ` <span aria-hidden="true">${fwd(lang)}</span>` : ''}</span>
      <span class="w-pager__t">${esc(titleOf(x, lang))}</span></a>`;

  const body = `<article class="wrap w-detail">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${esc(t.home)}</a><span aria-hidden="true">/</span><a href="/${lang}/work">${esc(t.crumbWork)}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(title)}</span></nav>
  <header class="w-hero">
    <p class="eyebrow mono" dir="ltr">[ SYSAIQ—WORK / ${esc(String(p.slug).toUpperCase())} ]</p>
    <h1>${esc(title)}</h1>
    ${tag ? `<p class="tagline">${esc(tag)}</p>` : ''}
    ${p.tags ? `<p class="w-hero__tags"><span class="mono" dir="ltr">${esc(p.tags)}</span></p>` : ''}
  </header>

  ${cover ? `<figure class="w-cover">
    <img src="${attr(cover)}" alt="${attr(title)} UI" class="w-cover__img" width="1600" height="900" fetchpriority="high" decoding="async">
    ${uiEn ? `<figcaption class="w-cover__badge">${t.uiEn}</figcaption>` : ''}
  </figure>` : ''}

  ${facts.length ? `<dl class="w-facts">${facts.map(([k, val]) => `<div class="w-fact"><dt>${k}</dt><dd>${val}</dd></div>`).join('')}</dl>` : ''}

  ${overview ? sec('overview', t.overview, `<p class="lead">${esc(overview)}</p>`, { cls: 'w-sec--overview' }) : ''}

  ${story}

  ${features.length ? sec('features', t.features, `<div class="w-feats">${features.map((f, i) => `
      <div class="w-feat">${idx(lang, i)}
        <h3>${esc((fa ? f.title_fa : f.title_en) || f.title_en || f.title_fa)}</h3>
        <p>${esc((fa ? f.desc_fa : f.desc_en) || '')}</p></div>`).join('')}
    </div>`, { sub: t.featuresSub }) : ''}

  ${pages.length ? sec('screens', t.pages, `<ol class="w-pages">${pages.map((pg, i) => `
      <li class="w-pg">${idx(lang, i)}<div class="pn">${esc((fa ? pg.name_fa : pg.name_en) || pg.name_en || pg.name_fa)}</div>
        <div class="pd">${esc((fa ? pg.desc_fa : pg.desc_en) || '')}</div></li>`).join('')}
    </ol>`) : ''}

  ${galleryHtml}

  ${pick(p, 'tech', lang) ? sec('tech', t.tech, `<div class="w-tech prose">${md('tech')}</div>`) : ''}

  ${industries.length || svc ? `<div class="w-duo">
    ${industries.length ? sec('industries', t.industries, `<div class="chips">${industries.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>`) : ''}
    ${svc ? sec('service', t.service, `<a class="w-svc" href="${attr(svc.href)}"><span class="w-svc__t">${esc(svc.label)}</span><span class="w-svc__go">${t.serviceMore} <span aria-hidden="true">${fwd(lang)}</span></span></a>`) : ''}
  </div>` : ''}

  ${related.length ? sec('related', t.related, `<ul class="w-list w-list--related">${related.map(r => card(r, all.indexOf(r), lang, t)).join('')}</ul>`) : ''}

  ${prev || next ? `<nav class="w-pager" aria-label="${t.others}">
    ${prev ? pagerLink(prev, 'prev', t.prev) : ''}
    ${next ? pagerLink(next, 'next', t.next) : ''}
  </nav>` : ''}

  <div class="w-cta">
    <h2>${esc(t.ctaTitle)}</h2>
    <p>${t.ctaText}</p>
    <div class="w-cta__actions"><a class="btn btn-primary" href="/${lang}/#contact">${esc(t.cta)}</a><a class="btn btn-ghost" href="/${lang}/work">${t.allWork}</a></div>
  </div>
</article>`;

  const description = pick(p, 'seo_desc', lang) || tag || pick(p, 'desc', lang);
  const images = [...new Set([cover, ...gallery.map(g => g.src)].filter(Boolean))].map(abs);
  const org = professionalService(lang);
  return renderLayout({
    lang, title: seoTitle(pick(p, 'seo_title', lang)) || title, description, canonicalPath: path, body, bodyClass: 'page-case', head: HEAD,
    ogImage: cover,
    jsonld: [
      crumbs([[t.home, `/${lang}/`], [t.crumbWork, `/${lang}/work`], [title, path]]),
      // the creator is the site's ProfessionalService entity (a natural
      // person's brand, not an Organization), emitted once and referenced by @id
      org,
      {
        '@context': 'https://schema.org', '@type': 'CreativeWork', name: title, headline: title, description,
        url: config.publicBaseUrl + path, inLanguage: lang,
        ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),
        ...(cat ? { genre: CAT_LABEL[lang][cat] } : {}),
        ...(p.tags ? { keywords: String(p.tags).split(/\s*·\s*/).filter(Boolean).join(', ') } : {}),
        creator: { '@id': org['@id'] },
      },
    ],
  });
}
