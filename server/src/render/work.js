// Server-rendered portfolio on the shared layout: /:lang/work (index) and
// /:lang/work/:slug (detail). Content and copy are the ones projectPage.js
// rendered — the projects redesign is a later wave; only the chrome and the
// stylesheet moved (pages.css).
import { db } from '../db/index.js';
import { esc, attr, J } from '../lib/html.js';
import { config } from '../config.js';
import { professionalService, breadcrumb } from '../lib/jsonld.js';
import { renderLayout } from './layout.js';

export function findProject(slug) {
  return db.prepare('SELECT * FROM projects WHERE slug=? AND published=1').get(String(slug));
}
export function allProjects() {
  return db.prepare('SELECT * FROM projects WHERE published=1 ORDER BY sort, id').all();
}

const STR = {
  fa: {
    title: 'همهٔ پروژه‌ها', sub: 'نمونه‌کارهای SysaiQ — سیستم‌ها و وب‌سایت‌هایی برای صنف‌ها و شرکت‌های مختلف',
    home: 'صفحهٔ اصلی', cta: 'شروع پروژه', open: 'مشاهدهٔ پروژه', crumbWork: 'نمونه‌کارها',
    back: 'بازگشت به پروژه‌ها', overview: 'معرفی', industries: 'صنایع هدف',
    features: 'قابلیت‌های متمایز', featuresSub: 'چیزهایی که در محصولات مشابه معمولاً نیست',
    pages: 'صفحات و رابط کاربری', ctaTitle: 'پروژه‌ای مشابه می‌خواهید؟', ui: 'نمای رابط کاربری',
    empty: 'هنوز پروژه‌ای منتشر نشده است.',
  },
  en: {
    title: 'All work', sub: 'SysaiQ portfolio — systems and websites across industries and trades',
    home: 'Home', cta: 'Start a project', open: 'View project', crumbWork: 'Work',
    back: 'Back to work', overview: 'Overview', industries: 'Target industries',
    features: 'What makes it different', featuresSub: "Capabilities you won't usually find in similar products",
    pages: 'Screens & UI', ctaTitle: 'Want something like this?', ui: 'Interface preview',
    empty: 'No project has been published yet.',
  },
};

const arrow = lang => (lang === 'fa' ? '←' : '→');
const backArrow = lang => (lang === 'fa' ? '→' : '←');

// [[name, path], …] → BreadcrumbList (lib/jsonld.js makes the urls absolute)
const crumbs = items => breadcrumb(items.map(([name, url]) => ({ name, url })));

// /:lang/work — the full portfolio grid
export function renderWorkIndex(lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const fa = lang === 'fa';
  const t = STR[lang];
  const projects = allProjects();

  const cards = projects.map(p => {
    const title = fa ? p.title_fa : p.title_en;
    const tag = fa ? (p.tagline_fa || p.desc_fa) : (p.tagline_en || p.desc_en);
    return `<a class="card work-card" href="/${lang}/work/${attr(p.slug)}">
      <span class="thumb"><img src="${attr(p.image || p.cover_en)}" alt="${attr(title)}" loading="lazy"></span>
      <span class="cbody"><b>${esc(title)}</b><p>${esc(tag)}</p>
      <i><span class="mono" dir="ltr">${esc(p.tags)}</span></i><em>${esc(t.open)} ${arrow(lang)}</em></span>
    </a>`;
  }).join('');

  const body = `<div class="wrap page-work">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${esc(t.home)}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(t.crumbWork)}</span></nav>
  <h1>${esc(t.title)}</h1>
  <p class="sub">${esc(t.sub)}</p>
  ${cards ? `<div class="grid work-grid">${cards}</div>` : `<p class="empty">${esc(t.empty)}</p>`}
</div>`;

  return renderLayout({
    lang, title: t.title, description: t.sub, canonicalPath: `/${lang}/work`, body, bodyClass: 'page-work',
    ogImage: projects[0]?.image || projects[0]?.cover_en || '',
    jsonld: [
      crumbs([[t.home, `/${lang}/`], [t.crumbWork, `/${lang}/work`]]),
      {
        '@context': 'https://schema.org', '@type': 'ItemList', name: t.title,
        itemListElement: projects.map((p, i) => ({ '@type': 'ListItem', position: i + 1, name: fa ? p.title_fa : p.title_en, url: `${config.publicBaseUrl}/${lang}/work/${p.slug}` })),
      },
    ],
  });
}

// /:lang/work/:slug — one project (row from findProject)
export function renderProjectPage(p, lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const fa = lang === 'fa';
  const t = STR[lang];
  const title = fa ? p.title_fa : p.title_en;
  const tagline = fa ? p.tagline_fa : p.tagline_en;
  const overview = fa ? p.overview_fa : p.overview_en;
  const cover = (fa ? p.cover_fa : p.cover_en) || p.cover_en || p.image;
  const industries = J(p.industries).map(x => (fa ? x?.fa || x?.en : x?.en)).filter(Boolean);
  const features = J(p.features).filter(f => f && typeof f === 'object');
  const pages = J(p.pages).filter(f => f && typeof f === 'object');

  const body = `<article class="wrap page-project">
  <a class="back" href="/${lang}/#work">${backArrow(lang)} ${esc(t.back)}</a>
  <h1>${esc(title)}</h1>
  <p class="tagline">${esc(tagline)}</p>
  <p class="tags"><span class="mono" dir="ltr">${esc(p.tags)}</span></p>

  <figure class="hero-fig">
    <img class="hero-img" src="${attr(cover)}" alt="${attr(title)} UI" loading="eager">
    <figcaption class="hero-cap mono">${esc(t.ui)}${fa && p.slug === 'trading' ? ' · EN' : ''}</figcaption>
  </figure>

  <section class="blk">
    <h2 class="blk-h">${esc(t.overview)}</h2>
    <p class="lead">${esc(overview)}</p>
  </section>

  ${industries.length ? `<section class="blk">
    <h2 class="blk-h">${esc(t.industries)}</h2>
    <div class="chips">${industries.map(i => `<span class="chip">${esc(i)}</span>`).join('')}</div>
  </section>` : ''}

  ${features.length ? `<section class="blk">
    <h2 class="blk-h">${esc(t.features)}</h2>
    <p class="lead lead-sm">${esc(t.featuresSub)}</p>
    <div class="feat-grid">${features.map((f, i) => `
      <div class="feat"><div class="n"><span class="mono" dir="ltr">[ ${String(i + 1).padStart(2, '0')} ]</span></div>
        <h3>${esc(fa ? f.title_fa : f.title_en)}</h3>
        <p>${esc(fa ? f.desc_fa : f.desc_en)}</p></div>`).join('')}</div>
  </section>` : ''}

  ${pages.length ? `<section class="blk">
    <h2 class="blk-h">${esc(t.pages)}</h2>
    <div class="pages-list">${pages.map(pg => `
      <div class="pg"><div class="pn">${esc(fa ? pg.name_fa : pg.name_en)}</div>
        <div class="pd">${esc(fa ? pg.desc_fa : pg.desc_en)}</div></div>`).join('')}</div>
  </section>` : ''}

  <div class="cta-box">
    <h2>${esc(t.ctaTitle)}</h2>
    <a class="btn btn-primary" href="/${lang}/#contact">${esc(t.cta)}</a>
  </div>
</article>`;

  const org = professionalService(lang);
  return renderLayout({
    lang, title, description: tagline, canonicalPath: `/${lang}/work/${p.slug}`, body, bodyClass: 'page-project',
    ogImage: cover,
    jsonld: [
      crumbs([[t.home, `/${lang}/`], [t.crumbWork, `/${lang}/work`], [title, `/${lang}/work/${p.slug}`]]),
      // the creator is the site's ProfessionalService entity (a natural
      // person's brand, not an Organization), emitted once and referenced by @id
      org,
      {
        '@context': 'https://schema.org', '@type': 'CreativeWork', name: title, description: tagline,
        url: `${config.publicBaseUrl}/${lang}/work/${p.slug}`, inLanguage: lang,
        image: /^https?:\/\//i.test(cover) ? cover : config.publicBaseUrl + cover,
        creator: { '@id': org['@id'] },
      },
    ],
  });
}
