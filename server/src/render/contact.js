// /:lang/contact — the contact page: same lead form + the full info column,
// map links and ProfessionalService JSON-LD, inside the shared render/layout.js
// chrome. Synchronous, so routes can wrap it in lib/cache.js's cached().
import { esc } from '../lib/html.js';
import { professionalService, breadcrumb } from '../lib/jsonld.js';
import { renderLayout } from './layout.js';
import { renderContactRow, CONTACT_CSS, CONTACT_JS } from './slots/contact.js';
import { renderTrustStrip, TRUST_CSS } from './slots/footer_trust.js';

const STR = {
  fa: {
    title: 'تماس با ما', eyebrow: '[ SYSAIQ—CONTACT / SYS.06 ]',
    h1: 'گفت‌وگو را <em>شروع</em> کنیم',
    lead: 'مستقر در قزوین، خدمت‌رسانی به سراسر ایران و خارج از کشور. فرم را پر کنید یا مستقیم تماس بگیرید؛ پیش از هر تعهدی، پیشنهاد کتبی می‌گیرید.',
    // "office" is not a confirmed fact (FACTS: natural person, residential-style address)
    description: 'راه‌های تماس با SysaiQ: فرم درخواست مشاوره، تلفن ثابت و موبایل، ایمیل و نشانی در قزوین.',
    home: 'صفحهٔ اصلی', crumb: 'تماس',
  },
  en: {
    title: 'Contact', eyebrow: '[ SYSAIQ—CONTACT / SYS.06 ]',
    h1: 'Let’s <em>start</em> the conversation',
    lead: 'Based in Qazvin, serving clients across Iran and abroad. Fill in the form or call directly; you receive a written proposal before any commitment.',
    description: 'How to reach SysaiQ: consultation request form, landline and mobile numbers, email and the address in Qazvin.',
    home: 'Home', crumb: 'Contact',
  },
};

// same skeleton as render/page.js so pages.css styles it: wrap > crumbs, page-head, content
function pageBody(lang) {
  const T = STR[lang];
  const trust = renderTrustStrip(lang, 'contact');
  return `<article class="wrap page-article page-contact">
  <nav class="crumbs" aria-label="breadcrumb"><a href="/${lang}/">${esc(T.home)}</a><span aria-hidden="true">/</span><span aria-current="page">${esc(T.crumb)}</span></nav>
  <header class="page-head">
    <span class="eyebrow mono" dir="ltr">${esc(T.eyebrow)}</span>
    <h1>${T.h1}</h1>
    <p class="lead">${esc(T.lead)}</p>
  </header>
  ${renderContactRow(lang, { page: `/${lang}/contact` })}
  ${trust ? `${TRUST_CSS}${trust}` : ''}
</article>`;
}

function jsonld(lang) {
  const T = STR[lang];
  return [professionalService(lang), breadcrumb([{ name: T.home, url: `/${lang}/` }, { name: T.crumb, url: `/${lang}/contact` }])];
}

const head = () => `<link rel="stylesheet" href="${CONTACT_CSS}">\n<script src="${CONTACT_JS}" defer></script>`;

export function renderContactPage(lang) {
  const l = lang === 'fa' ? 'fa' : 'en';
  const T = STR[l];
  // canonicalPath carries the language prefix: the layout derives the
  // hreflang alternates and the header language switch by swapping it
  return renderLayout({
    lang: l,
    title: T.title,
    description: T.description,
    canonicalPath: `/${l}/contact`,
    head: head(),
    body: pageBody(l),
    noindex: false,
    jsonld: jsonld(l),
    bodyClass: 'page-contact',
  });
}
