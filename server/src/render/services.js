// Services on the shared layout: /:lang/services (index grid) and
// /:lang/services/:slug (detail: hero, audience, problems, deliverables
// checklist, process rail, timeline + cost approach — which print «در پیشنهاد
// کتبی اعلام می‌شود» when the owner has not written them — FAQs, related
// projects, CTA) with Service + FAQPage + BreadcrumbList JSON-LD. The
// provider is the site's ProfessionalService entity from lib/jsonld.js
// (SysaiQ is a natural person's brand, not an Organization): the page emits
// that block and the Service references it by @id.
import { db } from '../db/index.js';
import { config } from '../config.js';
import { esc, attr, J } from '../lib/html.js';
import { renderInline } from '../lib/inline.js';
import { renderMarkdown } from '../lib/markdown.js';
import { getSiteContext } from '../lib/sitecontext.js';
import { professionalService, breadcrumb, faqPage } from '../lib/jsonld.js';
import { renderLayout } from './layout.js';
import { markdownToText } from './text.js';

export function findService(slug) {
  return db.prepare('SELECT * FROM services WHERE slug=? AND published=1').get(String(slug));
}
export function allServices() {
  return db.prepare('SELECT * FROM services WHERE published=1 ORDER BY sort, id').all();
}

const STR = {
  fa: {
    home: 'خانه', services: 'خدمات', title: 'خدمات SysaiQ',
    sub: 'وب‌سایت و وب‌اپلیکیشن اختصاصی، AI Agent، اتوماسیون، سیستم‌های حسابداری و نرم‌افزار معاملاتی — هر پروژه با محدودهٔ کار مکتوب و پیشنهاد کتبی شروع می‌شود.',
    open: 'جزئیات خدمت', empty: 'هنوز خدمتی منتشر نشده است.',
    audience: 'این خدمت برای چه کسانی است', problems: 'چه مسئله‌هایی را حل می‌کند', deliverables: 'تحویل‌دادنی‌ها',
    process: 'مراحل انجام کار', timeline: 'زمان‌بندی', price: 'نحوهٔ محاسبهٔ هزینه', faqs: 'سؤالات متداول',
    related: 'نمونه‌کارهای مرتبط', viewProject: 'مشاهدهٔ پروژه',
    proposal: 'در پیشنهاد کتبی اعلام می‌شود.', pricingPage: 'دربارهٔ نحوهٔ محاسبهٔ هزینه بیشتر بخوانید',
    ctaTitle: 'دربارهٔ پروژه‌تان صحبت کنیم', ctaText: 'چند خط دربارهٔ کسب‌وکارتان و مسئله‌ای که می‌خواهید حل شود بنویسید؛ پیش از هر تعهدی، پیشنهاد کتبی دریافت می‌کنید.',
    cta: 'شروع پروژه', allServices: 'همهٔ خدمات',
  },
  en: {
    home: 'Home', services: 'Services', title: 'SysaiQ services',
    sub: 'Custom websites and web apps, AI agents, automation, accounting systems and trading software — every project starts with a written scope and a written proposal.',
    open: 'Service details', empty: 'No service has been published yet.',
    audience: 'Who this is for', problems: 'Problems it solves', deliverables: 'Deliverables',
    process: 'How the work runs', timeline: 'Timeline', price: 'How cost is calculated', faqs: 'Frequently asked questions',
    related: 'Related work', viewProject: 'View project',
    proposal: 'Stated in the written proposal.', pricingPage: 'Read more about how cost is calculated',
    ctaTitle: 'Let us talk about your project', ctaText: 'Write a few lines about your business and the problem you want solved; you receive a written proposal before any commitment.',
    cta: 'Start a project', allServices: 'All services',
  },
};

const pick = (row, key, lang) => (lang === 'fa' ? row[`${key}_fa`] : row[`${key}_en`]) || '';
const arrow = lang => (lang === 'fa' ? '←' : '→');

// [[name, path], …] → BreadcrumbList (lib/jsonld.js makes the urls absolute)
const crumbs = items => breadcrumb(items.map(([name, url]) => ({ name, url })));

// the pricing page link is shown only once that page is published
function pricingLink(lang, t) {
  const ctx = getSiteContext(lang);
  const p = ctx.footerPages.find(x => x.href === `/${lang}/pricing`);
  return p ? `<p class="more"><a href="${attr(p.href)}">${t.pricingPage} ${arrow(lang)}</a></p>` : '';
}

// ---- index ---------------------------------------------------------------
export function renderServicesIndex(lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const t = STR[lang];
  const services = allServices();
  const cards = services.map((s, i) => `<a class="card svc-card" href="/${lang}/services/${attr(s.slug)}">
    <span class="idx"><span class="mono" dir="ltr">[ ${String(i + 1).padStart(2, '0')} ]</span></span>
    <b>${esc(pick(s, 'title', lang))}</b>
    ${pick(s, 'summary', lang) || pick(s, 'tagline', lang) ? `<p>${renderInline(pick(s, 'summary', lang) || pick(s, 'tagline', lang))}</p>` : ''}
    <em>${t.open} ${arrow(lang)}</em>
  </a>`).join('');

  const body = `<div class="wrap page-services">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${t.home}</a><span aria-hidden="true">/</span><span aria-current="page">${t.services}</span></nav>
  <p class="eyebrow mono" dir="ltr">[ SYSAIQ—SERVICES / SYS.02 ]</p>
  <h1>${t.title}</h1>
  <p class="sub">${t.sub}</p>
  ${cards ? `<div class="grid svc-grid">${cards}</div>` : `<p class="empty">${t.empty}</p>`}
</div>`;

  return renderLayout({
    lang, title: t.services, description: t.sub, canonicalPath: `/${lang}/services`, body, bodyClass: 'page-services',
    jsonld: [
      crumbs([[t.home, `/${lang}/`], [t.services, `/${lang}/services`]]),
      {
        '@context': 'https://schema.org', '@type': 'ItemList', name: t.title,
        itemListElement: services.map((s, i) => ({ '@type': 'ListItem', position: i + 1, name: pick(s, 'title', lang), url: `${config.publicBaseUrl}/${lang}/services/${s.slug}` })),
      },
    ],
  });
}

// ---- detail --------------------------------------------------------------
function relatedProjects(slugs, lang) {
  const list = J(slugs).filter(s => typeof s === 'string').slice(0, 12);
  if (!list.length) return [];
  const rows = db.prepare(`SELECT slug, title_en, title_fa, image, cover_en, tags FROM projects
    WHERE published=1 AND slug IN (${list.map(() => '?').join(',')})`).all(...list);
  // keep the owner's order
  return list.map(s => rows.find(r => r.slug === s)).filter(Boolean).map(r => ({
    slug: r.slug, title: (lang === 'fa' ? r.title_fa : r.title_en) || r.title_en, image: r.image || r.cover_en, tags: r.tags,
  }));
}

export function renderServicePage(s, lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const fa = lang === 'fa';
  const t = STR[lang];
  const ctx = getSiteContext(lang);
  const md = key => renderMarkdown(pick(s, key, lang), { tokens: ctx.tokens });
  const title = pick(s, 'title', lang) || s.title_en || s.slug;
  const tagline = pick(s, 'tagline', lang);
  const description = pick(s, 'meta_desc', lang) || pick(s, 'summary', lang) || tagline;
  const path = `/${lang}/services/${s.slug}`;

  const deliverables = J(s.deliverables).filter(d => d && typeof d === 'object').map(d => (fa ? d.fa : d.en) || d.en || '').filter(Boolean);
  const process = J(s.process).filter(p => p && typeof p === 'object');
  const faqs = J(s.faqs).filter(f => f && typeof f === 'object').map(f => ({ q: (fa ? f.q_fa : f.q_en) || '', a: (fa ? f.a_fa : f.a_en) || '' })).filter(f => f.q && f.a);
  const related = relatedProjects(s.related_projects, lang);

  const section = (id, heading, inner, cls = '') => `<section class="blk${cls ? ` ${cls}` : ''}" id="${id}" aria-labelledby="${id}-h">
    <h2 class="blk-h" id="${id}-h">${heading}</h2>${inner}</section>`;

  // owner policy values that are not decided yet are never invented: an
  // empty timeline / cost section prints the proposal line instead
  const proposalOr = key => (pick(s, key, lang).trim() ? `<div class="prose">${md(key)}</div>` : `<p class="proposal">${t.proposal}</p>`);

  const body = `<article class="wrap page-service">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${t.home}</a><span aria-hidden="true">/</span><a href="/${lang}/services">${t.services}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(title)}</span></nav>
  <header class="svc-hero">
    <p class="eyebrow mono" dir="ltr">[ SYSAIQ—SERVICE / ${esc(s.slug.toUpperCase())} ]</p>
    <h1>${esc(title)}</h1>
    ${tagline ? `<p class="tagline">${renderInline(tagline)}</p>` : ''}
    <a class="btn btn-primary" href="/${lang}/#contact">${t.cta}</a>
  </header>

  ${pick(s, 'audience', lang).trim() ? section('audience', t.audience, `<div class="prose">${md('audience')}</div>`) : ''}
  ${pick(s, 'problems', lang).trim() ? section('problems', t.problems, `<div class="prose">${md('problems')}</div>`) : ''}
  ${deliverables.length ? section('deliverables', t.deliverables, `<ul class="checklist">${deliverables.map(d => `<li>${renderInline(d)}</li>`).join('')}</ul>`) : ''}
  ${process.length ? section('process', t.process, `<ol class="steps">${process.map((p, i) => `<li class="step">
      <span class="step-n"><span class="mono" dir="ltr">${String(i + 1).padStart(2, '0')}</span></span>
      <div><h3>${esc((fa ? p.title_fa : p.title_en) || p.title_en || '')}</h3>${(fa ? p.desc_fa : p.desc_en) ? `<p>${renderInline(fa ? p.desc_fa : p.desc_en)}</p>` : ''}</div>
    </li>`).join('')}</ol>`) : ''}
  <div class="two-col">
    ${section('timeline', t.timeline, proposalOr('timeline'), 'col')}
    ${section('price', t.price, proposalOr('price_approach') + pricingLink(lang, t), 'col')}
  </div>
  ${faqs.length ? section('faqs', t.faqs, `<div class="faq-list">${faqs.map((f, i) => `<div class="qa">
      <button class="qa-q" type="button" data-qa-toggle aria-expanded="false" aria-controls="qa-${i + 1}"><span>${renderInline(f.q)}</span><span class="sign" aria-hidden="true">+</span></button>
      <div class="qa-a" id="qa-${i + 1}"><div class="prose">${renderMarkdown(f.a, { tokens: ctx.tokens })}</div></div>
    </div>`).join('')}</div>`) : ''}
  ${related.length ? section('related', t.related, `<div class="grid work-grid related-grid">${related.map(r => `<a class="card work-card" href="/${lang}/work/${attr(r.slug)}">
      <span class="thumb"><img src="${attr(r.image)}" alt="${attr(r.title)}" loading="lazy"></span>
      <span class="cbody"><b>${esc(r.title)}</b><i><span class="mono" dir="ltr">${esc(r.tags)}</span></i><em>${t.viewProject} ${arrow(lang)}</em></span>
    </a>`).join('')}</div>`) : ''}

  <div class="cta-box">
    <h2>${t.ctaTitle}</h2>
    <p>${t.ctaText}</p>
    <a class="btn btn-primary" href="/${lang}/#contact">${t.cta}</a>
    <a class="btn btn-ghost" href="/${lang}/services">${t.allServices}</a>
  </div>
</article>`;

  // areaServed is left to the provider entity: the tagline says «ایران و
  // خارج از کشور», so the Service itself must not narrow it
  const org = professionalService(lang);
  const jsonld = [
    crumbs([[t.home, `/${lang}/`], [t.services, `/${lang}/services`], [title, path]]),
    org,
    {
      '@context': 'https://schema.org', '@type': 'Service', name: title, description, url: config.publicBaseUrl + path,
      inLanguage: lang, serviceType: title,
      provider: { '@id': org['@id'] },
    },
  ];
  // crawlers get the answer as plain text (rendered, then stripped) — never
  // the markdown source with its syntax or a rejected link target
  if (faqs.length) jsonld.push(faqPage(faqs.map(f => ({ q: markdownToText(f.q), a: markdownToText(f.a, { tokens: ctx.tokens }) }))));

  return renderLayout({ lang, title, description, canonicalPath: path, body, bodyClass: 'page-service', jsonld });
}
