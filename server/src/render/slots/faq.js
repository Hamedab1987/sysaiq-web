// SLOT:FAQ — the #faq section of the home page: FAQ_H2 from content and one
// .qa accordion item per row of faqs WHERE published=1 AND show_on_home=1
// ORDER BY sort,id (the first item open). Markup mirrors vesper.src.html's
// FAQ region (.qa / .qa-q / .qa-a are what the accordion script binds to).
// Questions are plain text (esc); answers go through renderInline so a
// line break or *emphasis* typed in the admin works, never raw HTML.
// Without any FAQ the section is omitted entirely.
import { db } from '../../db/index.js';
import { esc } from '../../lib/html.js';
import { renderInline } from '../../lib/inline.js';
import { getContent } from '../../lib/content.js';

export function homeFaqs() {
  return db.prepare('SELECT id, q_en, q_fa, a_en, a_fa FROM faqs WHERE published=1 AND show_on_home=1 ORDER BY sort, id').all();
}

export function renderFaqSlot(lang) {
  const l = lang === 'en' ? 'en' : 'fa';
  const rows = homeFaqs();
  if (!rows.length) return '';
  const c = getContent(l);
  const items = rows.map((r, i) => `      <div class="qa${i ? '' : ' open'}">
        <button class="qa-q">${esc(r[`q_${l}`] || '')} <span class="sign">+</span></button>
        <div class="qa-a"><p>${renderInline(r[`a_${l}`] || '')}</p></div>
      </div>`).join('\n');
  return `<section id="faq" class="light" data-phase="3">
  <div class="wrap">
    <span class="faq-star rv">✳</span>
    <h2 class="rv d1">${esc(c.FAQ_H2 ?? '')}</h2>
    <div class="faq-list rv d2">
${items}
    </div>
  </div>
</section>`;
}

export const renderSlot = renderFaqSlot;
export const render = ({ lang = 'fa' } = {}) => renderFaqSlot(lang);
export default renderFaqSlot;
