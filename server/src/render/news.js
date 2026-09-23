// AI & tech news on the shared layout:
//   renderNewsIndex(lang, {category, page}) → /:lang/news (category chips ?c=, 12 per page)
//   renderNewsArticle(item, lang)          → /:lang/news/:slug
//   renderNewsFeed(lang)                   → /:lang/news/feed.xml (RSS 2.0, latest 30)
// Only status='published' rows are ever read here. No source image is ever
// shown or hotlinked: every card and article carries a brand cover drawn in
// inline SVG + CSS, one design per category. Source links are http(s) only
// and leave with rel="nofollow noopener noreferrer". All text is escaped.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db/index.js';
import { config } from '../config.js';
import { esc, attr, J } from '../lib/html.js';
import { toFaDigits } from '../lib/normalize.js';
import { professionalService, breadcrumb } from '../lib/jsonld.js';
import { renderLayout } from './layout.js';
import { NEWS_CATEGORIES as CATS } from '../db/migrations/400_news.js';

export const PER_PAGE = 12;
export const FEED_SIZE = 30;
export const NEWS_CATEGORIES = CATS;

// news.css is cache-busted by its own mtime (the layout's ASSET_V only
// tracks pages.css / pages.js)
const CSS_V = (() => {
  try { return Math.floor(statSync(join(config.siteDir, 'assets', 'site', 'news.css')).mtimeMs).toString(36); } catch { return '1'; }
})();

const STR = {
  fa: {
    home: 'خانه', news: 'اخبار', title: 'اخبار هوش مصنوعی و فناوری',
    sub: 'خلاصهٔ کوتاه و دوزبانهٔ خبرهای مهم AI و فناوری، هرکدام با لینک منبع اصلی؛ هر خبر پیش از انتشار بازبینی می‌شود.',
    all: 'همه', filter: 'دسته‌بندی اخبار', empty: 'هنوز خبری منتشر نشده است.', emptyCat: 'در این دسته هنوز خبری منتشر نشده است.',
    more: 'ادامهٔ خبر', prev: 'صفحهٔ قبل', next: 'صفحهٔ بعد', pager: 'صفحه‌بندی', pageOf: (p, n) => `صفحهٔ ${toFaDigits(p)} از ${toFaDigits(n)}`,
    why: 'چرا مهم است؟', source: 'منبع', readSource: 'خواندن خبر در منبع اصلی',
    note: 'این خلاصه با کمک AI از متن منبع تهیه و پیش از انتشار بازبینی شده است؛ جزئیات کامل را در منبع اصلی بخوانید.',
    ctaTitle: 'می‌خواهید این قابلیت را در کسب‌وکارتان داشته باشید؟',
    ctaText: 'بنویسید کسب‌وکارتان چیست و چه کاری را می‌خواهید ساده‌تر یا هوشمندتر کنید؛ پیش از هر تعهدی، پیشنهاد کتبی دریافت می‌کنید.',
    ctaServices: 'مشاهدهٔ خدمات', ctaStart: 'شروع پروژه',
    related: 'خبرهای مرتبط', allNews: 'همهٔ اخبار', feed: 'خوراک RSS',
    feedTitle: 'SysaiQ — اخبار هوش مصنوعی و فناوری',
    cats: { models: 'مدل‌ها', tools: 'ابزارها', devices: 'دستگاه‌ها', tech: 'فناوری', industry: 'صنعت' },
  },
  en: {
    home: 'Home', news: 'News', title: 'AI and technology news',
    sub: 'Short bilingual briefs on the AI and technology news that matters, each linked to its original source and reviewed before publication.',
    all: 'All', filter: 'News categories', empty: 'No news has been published yet.', emptyCat: 'Nothing has been published in this category yet.',
    more: 'Read the brief', prev: 'Previous', next: 'Next', pager: 'Pagination', pageOf: (p, n) => `Page ${p} of ${n}`,
    why: 'Why it matters', source: 'Source', readSource: 'Read the original story',
    note: 'This brief was prepared with AI assistance from the source text and reviewed before publication; see the original source for full details.',
    ctaTitle: 'Want this capability in your business?',
    ctaText: 'Tell us about your business and what you want to automate or make smarter; you receive a written proposal before any commitment.',
    ctaServices: 'See our services', ctaStart: 'Start a project',
    related: 'Related news', allNews: 'All news', feed: 'RSS feed',
    feedTitle: 'SysaiQ — AI and technology news',
    cats: { models: 'Models', tools: 'Tools', devices: 'Devices', tech: 'Tech', industry: 'Industry' },
  },
};

const pick = (row, key, lang) => (lang === 'fa' ? row[`${key}_fa`] : row[`${key}_en`]) || '';
const arrow = lang => (lang === 'fa' ? '←' : '→');
const iso = s => {
  if (!s) return '';
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};
export function formatDate(s, lang) {
  const i = iso(s);
  if (!i) return '';
  return new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Tehran' }).format(new Date(i));
}
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s; };
const safeHref = u => (/^https?:\/\/[^\s"'<>]+$/i.test(String(u || '')) ? String(u) : '');
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const tagsOf = row => J(row.tags).filter(t => typeof t === 'string' && /^[a-z0-9.+ -]{1,40}$/i.test(t)).slice(0, 5);

// ---- data --------------------------------------------------------------------
export function findNews(slug) {
  return db.prepare("SELECT * FROM news_items WHERE slug=? AND status='published'").get(String(slug));
}
export function listNews({ category = '', page = 1, perPage = PER_PAGE } = {}) {
  const cat = CATS.includes(category) ? category : '';
  const where = `WHERE status='published' AND slug IS NOT NULL${cat ? ' AND category=?' : ''}`;
  const args = cat ? [cat] : [];
  const total = db.prepare(`SELECT COUNT(*) c FROM news_items ${where}`).get(...args).c;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const items = db.prepare(`SELECT * FROM news_items ${where} ORDER BY published_at DESC, id DESC LIMIT ? OFFSET ?`)
    .all(...args, perPage, (page - 1) * perPage);
  return { items, total, pages, page, category: cat };
}
// for the home page's #news slot (owned elsewhere): latest n published
export const latestNews = (n = 3) => db.prepare(
  "SELECT * FROM news_items WHERE status='published' AND slug IS NOT NULL ORDER BY published_at DESC, id DESC LIMIT ?").all(n);

function relatedNews(item, n = 3) {
  const same = db.prepare(`SELECT * FROM news_items WHERE status='published' AND slug IS NOT NULL AND id<>? AND category=?
    ORDER BY published_at DESC, id DESC LIMIT ?`).all(item.id, item.category, n);
  if (same.length >= n) return same;
  const more = db.prepare(`SELECT * FROM news_items WHERE status='published' AND slug IS NOT NULL AND id<>? AND category<>?
    ORDER BY published_at DESC, id DESC LIMIT ?`).all(item.id, item.category, n - same.length);
  return [...same, ...more];
}

// ---- brand covers (one per category; never a source image) ---------------------
const GLYPH = {
  models: `<g fill="none" stroke="currentColor"><circle cx="200" cy="112" r="30"/><circle cx="200" cy="112" r="58" opacity=".5"/><circle cx="200" cy="112" r="90" opacity=".22"/><path d="M104 64L200 112l94-50M200 112l-52 70M200 112l74 60M104 64l44 118M294 62l-20 110" opacity=".45"/></g><g fill="currentColor"><circle cx="200" cy="112" r="5"/><circle cx="104" cy="64" r="3.5"/><circle cx="294" cy="62" r="3.5"/><circle cx="148" cy="182" r="3.5"/><circle cx="274" cy="172" r="3.5"/></g>`,
  tools: `<g fill="none" stroke="currentColor"><rect x="152" y="64" width="96" height="96" rx="20"/><rect x="172" y="84" width="56" height="56" rx="12" opacity=".55"/><path d="M128 78l-24 34 24 34M272 78l24 34-24 34" stroke-width="2"/><path d="M40 40h320M40 184h320" opacity=".14"/><path d="M200 84v56M172 112h56" opacity=".35"/></g>`,
  devices: `<g fill="none" stroke="currentColor"><rect x="158" y="70" width="84" height="84" rx="10"/><rect x="178" y="90" width="44" height="44" rx="4" opacity=".6"/><path d="${[0, 1, 2, 3, 4].map(i => { const p = 170 + i * 15; return `M${p} 70v-18M${p} 154v18M158 ${p - 88}h-18M242 ${p - 88}h18`; }).join('')}" opacity=".7"/><path d="M60 112h80M260 112h80" opacity=".2" stroke-dasharray="3 6"/></g><circle cx="200" cy="112" r="4" fill="currentColor"/>`,
  tech: `<g fill="none" stroke="currentColor"><path d="M-10 112C40 52 90 52 140 112s100 60 150 0 100-60 150 0"/><path d="M-10 112C40 72 90 72 140 112s100 40 150 0 100-40 150 0" opacity=".5"/><path d="M-10 112C40 92 90 92 140 112s100 20 150 0 100-20 150 0" opacity=".25"/><path d="M140 40v144M290 40v144" opacity=".12"/></g><circle cx="140" cy="112" r="4" fill="currentColor"/><circle cx="290" cy="112" r="4" fill="currentColor"/>`,
  industry: `<g fill="currentColor" opacity=".22"><rect x="112" y="142" width="22" height="42" rx="3"/><rect x="152" y="124" width="22" height="60" rx="3"/><rect x="192" y="104" width="22" height="80" rx="3"/><rect x="232" y="86" width="22" height="98" rx="3"/><rect x="272" y="62" width="22" height="122" rx="3"/></g><g fill="none" stroke="currentColor"><path d="M100 150L162 118l40-12 40-22 44-34" stroke-width="2"/><path d="M90 184h230" opacity=".35"/></g><circle cx="286" cy="50" r="5" fill="currentColor"/>`,
};
export function cover(category, { large = false } = {}) {
  const c = CATS.includes(category) ? category : 'industry';
  return `<div class="nw-cover nw-c-${c}${large ? ' nw-cover-lg' : ''}" aria-hidden="true">
    <svg viewBox="0 0 400 225" preserveAspectRatio="xMidYMid slice" focusable="false">${GLYPH[c]}</svg>
    <span class="nw-cover-tag mono" dir="ltr">[ ${c.toUpperCase()} ]</span>
  </div>`;
}

// ---- pieces ----------------------------------------------------------------------
const catChip = (c, lang, link = false) => {
  const label = esc(STR[lang].cats[c] || c);
  return link ? `<a class="nw-cat nw-k-${c}" href="/${lang}/news?c=${c}">${label}</a>` : `<span class="nw-cat nw-k-${c}">${label}</span>`;
};
const timeTag = (s, lang) => {
  const i = iso(s);
  return i ? `<time datetime="${attr(i)}">${esc(formatDate(s, lang))}</time>` : '';
};

function card(item, lang, { lead = false, h = 'h2' } = {}) {
  const t = STR[lang];
  const title = pick(item, 'title', lang);
  const summary = pick(item, 'summary', lang);
  return `<a class="card nw-card${lead ? ' nw-lead' : ''}" href="/${lang}/news/${attr(item.slug)}">
    ${cover(item.category)}
    <div class="nw-card-body">
      <p class="nw-meta">${catChip(item.category, lang)}${timeTag(item.published_at, lang)}</p>
      <${h} class="nw-title">${esc(title)}</${h}>
      ${summary ? `<p class="nw-sum">${esc(clip(summary, lead ? 320 : 200))}</p>` : ''}
      <span class="nw-more">${t.more} ${arrow(lang)}</span>
    </div>
  </a>`;
}

const listPath = (lang, c, page) => {
  const q = [];
  if (c) q.push(`c=${c}`);
  if (page > 1) q.push(`page=${page}`);
  return `/${lang}/news${q.length ? `?${q.join('&')}` : ''}`;
};
const feedLink = lang => `<link rel="alternate" type="application/rss+xml" title="${attr(STR[lang].feedTitle)}" href="/${lang}/news/feed.xml">`;
const cssLink = `<link rel="stylesheet" href="/assets/site/news.css?v=${CSS_V}">`;

// ---- index -------------------------------------------------------------------------
export function renderNewsIndex(lang, { category = '', page = 1 } = {}) {
  lang = lang === 'en' ? 'en' : 'fa';
  const t = STR[lang];
  const data = listNews({ category, page });
  const c = data.category;

  const chips = [`<a class="nw-chip" href="/${lang}/news"${c ? '' : ' aria-current="page"'}>${t.all}</a>`,
    ...CATS.map(k => `<a class="nw-chip nw-k-${k}" href="/${lang}/news?c=${k}"${c === k ? ' aria-current="page"' : ''}>${esc(t.cats[k])}</a>`)].join('');
  const cards = data.items.map((it, i) => card(it, lang, { lead: i === 0 && page === 1 && !c })).join('');
  const pager = data.pages > 1 ? `<nav class="nw-pager" aria-label="${t.pager}">
    ${page > 1 ? `<a class="btn btn-ghost btn-sm" rel="prev" href="${attr(listPath(lang, c, page - 1))}">${lang === 'fa' ? '→' : '←'} ${t.prev}</a>` : '<span></span>'}
    <span class="nw-pageof">${esc(t.pageOf(page, data.pages))}</span>
    ${page < data.pages ? `<a class="btn btn-ghost btn-sm" rel="next" href="${attr(listPath(lang, c, page + 1))}">${t.next} ${arrow(lang)}</a>` : '<span></span>'}
  </nav>` : '';

  const heading = c ? `${t.title} — ${t.cats[c]}` : t.title;
  const body = `<div class="wrap page-news">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${t.home}</a><span aria-hidden="true">/</span>${c ? `<a href="/${lang}/news">${t.news}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(t.cats[c])}</span>` : `<span aria-current="page">${t.news}</span>`}</nav>
  <header class="nw-head">
    <p class="eyebrow mono" dir="ltr">[ SYSAIQ—NEWS / SYS.07 ]</p>
    <h1>${esc(heading)}</h1>
    <p class="sub">${t.sub}</p>
    <nav class="nw-filters" aria-label="${t.filter}">${chips}</nav>
  </header>
  ${cards ? `<div class="nw-grid">${cards}</div>` : `<p class="empty">${c ? t.emptyCat : t.empty}</p>`}
  ${pager}
  <p class="nw-feed"><a href="/${lang}/news/feed.xml" dir="ltr"><span class="mono">RSS</span></a> <span>${t.feed}</span></p>
</div>`;

  const path = listPath(lang, c, page);
  const crumbs = [{ name: t.home, url: `/${lang}/` }, { name: t.news, url: `/${lang}/news` }];
  if (c) crumbs.push({ name: t.cats[c], url: `/${lang}/news?c=${c}` });
  return renderLayout({
    lang, title: page > 1 ? `${heading} — ${t.pageOf(page, data.pages)}` : heading, description: t.sub,
    canonicalPath: path, body, bodyClass: 'page-news', head: `${cssLink}\n${feedLink(lang)}`,
    jsonld: [
      breadcrumb(crumbs),
      {
        '@context': 'https://schema.org', '@type': 'ItemList', name: heading,
        itemListElement: data.items.map((it, i) => ({ '@type': 'ListItem', position: (page - 1) * PER_PAGE + i + 1, url: `${config.publicBaseUrl}/${lang}/news/${it.slug}` })),
      },
    ],
  });
}

// ---- article -------------------------------------------------------------------------
export function renderNewsArticle(item, lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const t = STR[lang];
  const base = config.publicBaseUrl;
  const title = pick(item, 'title', lang);
  const summary = pick(item, 'summary', lang);
  const why = pick(item, 'why', lang);
  const path = `/${lang}/news/${item.slug}`;
  const src = safeHref(item.url);
  const srcName = item.source_name || hostOf(src) || t.source;
  const tags = tagsOf(item);
  const related = relatedNews(item, 3);

  const body = `<article class="wrap nw-article">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${t.home}</a><span aria-hidden="true">/</span><a href="/${lang}/news">${t.news}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(clip(title, 60))}</span></nav>
  <header class="nw-hero">
    <p class="eyebrow mono" dir="ltr">[ SYSAIQ—NEWS / ${esc(item.category.toUpperCase())} ]</p>
    <p class="nw-meta">${catChip(item.category, lang, true)}${timeTag(item.published_at, lang)}</p>
    <h1>${esc(title)}</h1>
  </header>
  ${cover(item.category, { large: true })}
  <div class="nw-body">
    ${summary ? `<p class="nw-lede">${esc(summary)}</p>` : ''}
    ${why ? `<section class="nw-why" aria-labelledby="nw-why-h"><h2 id="nw-why-h">${t.why}</h2><p>${esc(why)}</p></section>` : ''}
    ${src ? `<p class="nw-source"><span class="k">${t.source}:</span> <a href="${attr(src)}" rel="nofollow noopener noreferrer" target="_blank">${esc(srcName)} <span aria-hidden="true">↗</span><span class="sr-only"> — ${t.readSource}</span></a></p>` : ''}
    ${tags.length ? `<p class="nw-tags" dir="ltr">${tags.map(x => `<span class="mono">#${esc(x)}</span>`).join('')}</p>` : ''}
    <p class="nw-note">${t.note}</p>
  </div>
  <section class="cta-box">
    <h2>${t.ctaTitle}</h2>
    <p>${t.ctaText}</p>
    <a class="btn btn-primary" href="/${lang}/services">${t.ctaServices}</a>
    <a class="btn btn-ghost" href="/${lang}/#contact">${t.ctaStart}</a>
  </section>
  ${related.length ? `<section class="nw-related" aria-labelledby="nw-rel-h">
    <h2 class="blk-h" id="nw-rel-h">${t.related}</h2>
    <div class="nw-grid nw-grid-3">${related.map(r => card(r, lang, { h: 'h3' })).join('')}</div>
  </section>` : ''}
  <p class="more"><a href="/${lang}/news">${t.allNews} ${arrow(lang)}</a></p>
</article>`;

  const org = professionalService(lang);
  return renderLayout({
    lang, title, description: clip(summary || title, 160), canonicalPath: path, body, bodyClass: 'page-news-article',
    head: `${cssLink}\n${feedLink(lang)}\n<meta property="article:published_time" content="${attr(iso(item.published_at))}">`,
    jsonld: [
      org,
      breadcrumb([{ name: t.home, url: `/${lang}/` }, { name: t.news, url: `/${lang}/news` }, { name: title, url: path }]),
      {
        '@context': 'https://schema.org',
        '@type': 'NewsArticle',
        headline: clip(title, 110),
        description: clip(summary, 300),
        inLanguage: lang === 'fa' ? 'fa-IR' : 'en',
        datePublished: iso(item.published_at),
        dateModified: iso(item.updated_at) || iso(item.published_at),
        mainEntityOfPage: { '@type': 'WebPage', '@id': base + path },
        url: base + path,
        image: [`${base}/og.jpg`],
        articleSection: t.cats[item.category] || item.category,
        ...(tags.length ? { keywords: tags.join(', ') } : {}),
        ...(src ? { isBasedOn: src } : {}),
        author: { '@id': org['@id'] },
        publisher: { '@id': org['@id'] },
      },
    ],
  });
}

// ---- RSS -------------------------------------------------------------------------------
// XML 1.0 forbids most C0 controls even when escaped
const x = s => esc(String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, ''));
const rfc822 = s => { const i = iso(s); return i ? new Date(i).toUTCString() : ''; };

export function renderNewsFeed(lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const t = STR[lang];
  const base = config.publicBaseUrl;
  const items = latestNews(FEED_SIZE);
  const entries = items.map(it => {
    const link = `${base}/${lang}/news/${it.slug}`;
    const why = pick(it, 'why', lang);
    const desc = [pick(it, 'summary', lang), why ? `${t.why}${lang === 'en' ? ':' : ''} ${why}` : ''].filter(Boolean).join('\n\n');
    return `  <item>
    <title>${x(pick(it, 'title', lang))}</title>
    <link>${x(link)}</link>
    <guid isPermaLink="true">${x(link)}</guid>
    ${rfc822(it.published_at) ? `<pubDate>${rfc822(it.published_at)}</pubDate>` : ''}
    <category>${x(t.cats[it.category] || it.category)}</category>
    <description>${x(desc)}</description>
  </item>`;
  }).join('\n');
  const built = rfc822(items[0]?.published_at) || new Date().toUTCString();
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${x(t.feedTitle)}</title>
  <link>${x(`${base}/${lang}/news`)}</link>
  <description>${x(t.sub)}</description>
  <language>${lang === 'fa' ? 'fa-IR' : 'en'}</language>
  <atom:link href="${x(`${base}/${lang}/news/feed.xml`)}" rel="self" type="application/rss+xml"/>
  <lastBuildDate>${built}</lastBuildDate>
${entries}
</channel>
</rss>
`;
}
