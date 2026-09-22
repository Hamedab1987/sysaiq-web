// One `pages` row → a readable 760px article on the shared layout:
// markdown body (escape-first, {{site.*}} tokens from site info), a table of
// contents built from the h2s, and for kind=legal the framework notice from
// the content guide plus the version / effective-date line.
import { config } from '../config.js';
import { esc, attr } from '../lib/html.js';
import { renderMarkdown } from '../lib/markdown.js';
import { toFaDigits } from '../lib/normalize.js';
import { getSiteContext } from '../lib/sitecontext.js';
import { renderLayout } from './layout.js';
import { stripTags, decodeEntities as decode, plainText } from './text.js';

const STR = {
  fa: {
    home: 'خانه', toc: 'در این صفحه', version: 'نسخهٔ', effective: 'تاریخ اجرا', reviewed: 'بازبینی حقوقی',
    notice: 'این متن چارچوب عمومی همکاری با SysaiQ را توضیح می‌دهد. در هر پروژه، قرارداد امضاشده میان طرفین حاکم است و در صورت تفاوت، متن قرارداد ملاک خواهد بود.',
    authoritative: '',
    draft: 'پیش‌نویس',
  },
  en: {
    home: 'Home', toc: 'On this page', version: 'Version', effective: 'Effective from', reviewed: 'Legal review',
    notice: 'This page describes the general framework of working with SysaiQ. In every project, the signed contract between the parties governs; where the two differ, the contract text prevails.',
    authoritative: 'The Persian version of this page is authoritative.',
    draft: 'draft',
  },
};

// ---- helpers -------------------------------------------------------------
// SQLite's datetime('now') is UTC without a designator ("2026-09-22 11:19:30");
// JSON-LD consumers read a bare timestamp as local time, so it gets its Z
export function isoUtc(s) {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)$/.exec(String(s ?? '').trim());
  return m ? `${m[1]}T${m[2]}Z` : String(s ?? '');
}

// id for a heading: letters/digits of any script, dashes between; unique per
// page. ZWNJ (نیم‌فاصله) is dropped rather than turned into a dash so
// «تعریف‌ها» stays one word in the fragment.
function headingId(text, used) {
  let id = decode(stripTags(text)).toLowerCase().normalize('NFC').replace(/‌/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 64) || 'section';
  const base = id;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  used.add(id);
  return id;
}

// give every <h2> an id and return the TOC entries
export function addHeadingIds(html) {
  const used = new Set();
  const toc = [];
  const out = html.replace(/<h2>([^]*?)<\/h2>/g, (_, inner) => {
    const id = headingId(inner, used);
    toc.push({ id, text: stripTags(inner) });
    return `<h2 id="${attr(id)}">${inner}</h2>`;
  });
  return { html: out, toc };
}

export function formatDate(iso, lang) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const jalali = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
  if (lang === 'fa') return jalali;
  const greg = new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(d);
  return `${greg} (${jalali})`;
}

// first paragraph, plain text, for the meta description when none is set
function excerpt(html, max = 160) {
  const m = /<p>([^]*?)<\/p>/.exec(html);
  const text = m ? plainText(m[1]) : '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// the article without the chrome — also what the admin preview shows
export function renderPageBody(page, lang, { tokens } = {}) {
  const fa = lang === 'fa';
  const t = STR[lang];
  const raw = fa ? page.body_fa : page.body_en;
  const { html, toc } = addHeadingIds(renderMarkdown(raw, { tokens: tokens || {} }));
  const legal = page.kind === 'legal';

  const meta = [];
  if (legal && page.version) meta.push(`<span>${t.version} ${esc(fa ? toFaDigits(page.version) : page.version)}</span>`);
  if (legal && page.effective_at) meta.push(`<span>${t.effective}: ${esc(formatDate(page.effective_at, lang))}</span>`);
  if (legal && page.legal_reviewed_at) meta.push(`<span>${t.reviewed}: ${esc(formatDate(page.legal_reviewed_at, lang))}</span>`);

  return `<header class="page-head">
    <h1>${esc(fa ? page.title_fa : page.title_en)}</h1>
    ${meta.length ? `<p class="page-meta">${meta.join('<span class="sep" aria-hidden="true">·</span>')}</p>` : ''}
  </header>
  ${legal ? `<aside class="notice" role="note">${t.notice}${t.authoritative ? ` ${t.authoritative}` : ''}</aside>` : ''}
  ${toc.length > 1 ? `<nav class="toc" aria-label="${t.toc}"><p class="toc-h">${t.toc}</p><ol>${toc.map(h => `<li><a href="#${attr(h.id)}">${h.text}</a></li>`).join('')}</ol></nav>` : ''}
  <div class="prose">${html}</div>`;
}

export function renderPage(page, lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const fa = lang === 'fa';
  const t = STR[lang];
  const ctx = getSiteContext(lang);
  const title = (fa ? page.title_fa : page.title_en) || page.title_en || page.slug;
  const inner = renderPageBody(page, lang, { tokens: ctx.tokens });
  const description = (fa ? page.meta_desc_fa : page.meta_desc_en) || excerpt(inner);
  const path = `/${lang}/${page.slug}`;

  const body = `<article class="wrap page-article">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${esc(t.home)}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(title)}</span></nav>
  ${inner}
</article>`;

  return renderLayout({
    lang, title, description, canonicalPath: path, body, bodyClass: `page-${page.kind === 'legal' ? 'legal' : 'custom'}`,
    noindex: !!page.noindex,
    jsonld: [
      {
        '@context': 'https://schema.org', '@type': 'WebPage', name: title, description,
        url: config.publicBaseUrl + path, inLanguage: lang,
        ...(page.kind === 'legal' && page.effective_at ? { datePublished: page.effective_at } : {}),
        ...(page.updated_at ? { dateModified: isoUtc(page.updated_at) } : {}),
      },
      {
        '@context': 'https://schema.org', '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: t.home, item: `${config.publicBaseUrl}/${lang}/` },
          { '@type': 'ListItem', position: 2, name: title, item: config.publicBaseUrl + path },
        ],
      },
    ],
  });
}
