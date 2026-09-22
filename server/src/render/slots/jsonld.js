// SLOT:JSONLD — structured data for the home page: ProfessionalService
// (identity, Qazvin address, both phones) plus a FAQPage built from the
// published faqs when there are any. One <script type="application/ld+json">
// per object; jsonForScript() keeps "</script>" harmless.
import { db } from '../../db/index.js';
import { professionalService, faqPage, jsonLdScript } from '../../lib/jsonld.js';

export function homeFaqs(lang) {
  const l = lang === 'fa' ? 'fa' : 'en';
  return db.prepare('SELECT q_en, q_fa, a_en, a_fa FROM faqs WHERE published=1 ORDER BY sort, id').all()
    .map(r => ({ q: r[`q_${l}`], a: r[`a_${l}`] }))
    .filter(x => x.q && x.a);
}

export function homeJsonLd(lang) {
  const objs = [professionalService(lang)];
  const faqs = homeFaqs(lang);
  if (faqs.length) objs.push(faqPage(faqs));
  return objs;
}

export function renderJsonLdSlot(lang) {
  return jsonLdScript(homeJsonLd(lang));
}

export function render({ lang = 'fa' } = {}) {
  return renderJsonLdSlot(lang);
}
export default render;
