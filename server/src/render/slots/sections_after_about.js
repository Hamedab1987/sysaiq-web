// Home-page slot SECTIONS_AFTER_ABOUT — and the section engine the two
// sibling slots (sections_after_work.js, sections_after_faq.js) import.
//   renderSectionsAfterAbout('fa') → html of every published section whose
//   placement is after_about, in sort order
// Each section is self-contained: <section id="<slug>" class="light|solid"
// data-phase="3"> with its own #slug-scoped <style> (the home page's CSP
// allows inline styles, never inline scripts), so it renders correctly
// inside the home template without touching the template's stylesheet.
// Type patterns (design system): richtext · cards · steps rail · stats ·
// cta banner · pricing table. Every string is escaped by renderInline /
// renderMarkdown / esc — items come straight from the admin.
import { db } from '../../db/index.js';
import { esc, attr, J } from '../../lib/html.js';
import { renderInline, safeHref } from '../../lib/inline.js';
import { renderMarkdown } from '../../lib/markdown.js';
import { toFaDigits } from '../../lib/normalize.js';
import { getSiteContext } from '../../lib/sitecontext.js';

export const PLACEMENTS = Object.freeze(['after_about', 'after_work', 'after_faq']);
export const TYPES = Object.freeze(['richtext', 'cards', 'steps', 'stats', 'cta', 'pricing']);
export const THEMES = Object.freeze(['light', 'dark']);

const STR = {
  fa: { proposal: 'در پیشنهاد کتبی اعلام می‌شود.', featured: 'پیشنهادی' },
  en: { proposal: 'Stated in the written proposal.', featured: 'Recommended' },
};

const pick = (o, key, lang) => String((lang === 'fa' ? o?.[`${key}_fa`] : o?.[`${key}_en`]) || o?.[`${key}_en`] || '');
// a feature line is either 'text' or {en, fa}
const bilingual = (x, lang) => (typeof x === 'string' ? x : String(x?.[lang] || x?.en || x?.fa || ''));
const num = (s, lang) => (lang === 'fa' ? toFaDigits(s) : String(s));

export function publishedSections(placement) {
  return db.prepare('SELECT * FROM sections WHERE published=1 AND placement=? ORDER BY sort, id').all(placement);
}

// ---- scoped css ----------------------------------------------------------
// One block per section, every selector prefixed with #<id>. Colours use the
// home template's tokens (--paper, --ink-d, --line-d on light; --ink, --dim,
// --line on dark) with literal fallbacks so the block also works alone.
// an id starting with a digit is refused by the admin; a row that still has
// one (older data) gets the CSS escape (#\31 st) so the block is not dropped
const cssId = id => `#${String(id).replace(/^(\d)/, (_, d) => `\\3${d} `)}`;

function css(id, theme) {
  const s = cssId(id);
  const light = theme === 'light';
  const ink = light ? 'var(--ink-d,#101012)' : 'var(--ink,#eceaf6)';
  const dim = light ? 'var(--dim-d,rgba(16,16,18,.6))' : 'rgba(236,234,246,.6)';
  const faint = light ? 'rgba(16,16,18,.45)' : 'rgba(236,234,246,.4)';
  const line = light ? 'var(--line-d,rgba(16,16,18,.14))' : 'var(--line,rgba(236,234,246,.12))';
  const card = light ? 'rgba(16,16,18,.035)' : 'var(--panel,#0e1422)';
  const accent = light ? '#5a3fe0' : 'var(--mint,#7dffd9)';
  return `<style>
${s}{position:relative;z-index:2;padding:110px 0;${light ? 'background:var(--paper,#ececea);color:var(--ink-d,#101012);' : 'background:#070a12;color:var(--ink,#eceaf6);'}}
${s} .wrap{max-width:1200px;margin:0 auto;padding-inline:40px}
${s} .sx-head{display:flex;align-items:baseline;justify-content:space-between;gap:24px;margin-bottom:48px;flex-wrap:wrap}
${s} h2{font-size:clamp(36px,4.8vw,64px);font-weight:300;line-height:1.04;letter-spacing:-.025em;color:${ink};margin:0;max-width:820px}
${s} h2 em{font-style:normal;background:linear-gradient(135deg,var(--mint,#7dffd9),var(--violet,#8b6bff));-webkit-background-clip:text;background-clip:text;color:transparent}
[dir="rtl"] ${s} h2{letter-spacing:0}
${s} .eyebrow{font-family:"SF Mono",ui-monospace,"Cascadia Mono",Menlo,Consolas,monospace;font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:${faint};direction:ltr;unicode-bidi:isolate;display:inline-block}
${s} [dir="ltr"]{unicode-bidi:isolate}
${s} .sx-body{max-width:760px;font-size:15px;line-height:1.85;color:${dim};margin-bottom:40px}
${s} .sx-body p{margin:0 0 14px}${s} .sx-body ul,${s} .sx-body ol{padding-inline-start:22px;margin:0 0 14px}
${s} .sx-body a{color:${accent};text-decoration:underline;text-underline-offset:3px}
${s} .sx-body h2,${s} .sx-body h3,${s} .sx-body h4{color:${ink};font-weight:500;margin:22px 0 8px;font-size:17px;line-height:1.4;max-width:none}
${s} .sx-body h2{font-size:19px;letter-spacing:0}
${s} .sx-cta{margin-top:40px}
${s} .btn{display:inline-block;background:linear-gradient(135deg,var(--mint,#7dffd9),var(--violet,#8b6bff));color:#06101f;font-weight:600;padding:13px 28px;border-radius:10px;font-size:14px;text-decoration:none}
${s} .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:28px 32px}
${s} .card{border-top:1px solid ${line};padding-top:18px}
${s} .card .idx{display:block;font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:10.5px;letter-spacing:.16em;color:${light ? faint : 'var(--mint,#7dffd9)'};margin-bottom:12px}
${s} .card h3{font-size:16.5px;font-weight:500;margin:0 0 8px;color:${ink}}
${s} .card p{font-size:13.5px;line-height:1.75;color:${dim};margin:0}
${s} .steps{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:28px;counter-reset:step}
${s} .step{position:relative;padding-top:22px;border-top:1px solid ${line}}
${s} .step::before{content:"";position:absolute;top:-1px;inset-inline-start:0;width:44px;height:1px;background:linear-gradient(90deg,var(--mint,#7dffd9),var(--violet,#8b6bff))}
${s} .step .n{display:block;font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:11px;letter-spacing:.16em;color:${light ? faint : 'var(--mint,#7dffd9)'};margin-bottom:12px}
${s} .step h3{font-size:16px;font-weight:500;margin:0 0 8px;color:${ink}}
${s} .step p{font-size:13.5px;line-height:1.75;color:${dim};margin:0}
${s} .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:2px;border-block:1px solid ${line}}
${s} .stat{padding:28px 20px;border-inline-start:1px solid ${line}}
${s} .stat:first-child{border-inline-start:0}
${s} .stat b{display:block;font-size:clamp(34px,4.6vw,56px);font-weight:300;line-height:1;letter-spacing:-.02em;color:${ink};font-variant-numeric:tabular-nums}
[dir="rtl"] ${s} .stat b{letter-spacing:0}
${s} .stat span{display:block;margin-top:10px;font-size:13px;color:${dim}}
${s} .banner{border:1px solid ${line};border-radius:18px;padding:48px 32px;text-align:center;background:linear-gradient(160deg,rgba(139,107,255,.12),rgba(125,255,217,.06))}
${s} .banner h2{font-size:clamp(26px,3.6vw,40px);margin:0 auto 14px}
${s} .banner .sx-body{margin:0 auto 26px}
${s} .plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}
${s} .plan{border:1px solid ${line};border-radius:16px;padding:26px 24px;background:${card};display:flex;flex-direction:column;gap:14px;position:relative}
${s} .plan.featured{border-color:transparent;background:linear-gradient(${light ? '#fff,#fff' : '#0e1422,#0e1422'}) padding-box,linear-gradient(135deg,var(--mint,#7dffd9),var(--violet,#8b6bff)) border-box}
${s} .plan .tag{align-self:flex-start;font-size:11px;padding:4px 10px;border-radius:100px;border:1px solid ${line};color:${dim}}
${s} .plan h3{font-size:18px;font-weight:500;margin:0;color:${ink}}
${s} .plan .price{font-size:15px;color:${ink};font-weight:500}
${s} .plan .price.proposal{font-weight:400;color:${dim}}
${s} .plan p{font-size:13.5px;line-height:1.7;color:${dim};margin:0}
${s} .plan ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px;font-size:13.5px;color:${dim}}
${s} .plan li{padding-inline-start:18px;position:relative}
${s} .plan li::before{content:"";position:absolute;inset-inline-start:0;top:.62em;width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,var(--mint,#7dffd9),var(--violet,#8b6bff))}
@media (max-width:900px){${s}{padding:80px 0}${s} .wrap{padding-inline:24px}${s} .sx-head{margin-bottom:32px}${s} .stats{grid-template-columns:repeat(2,1fr)}${s} .stat{border-inline-start:0;border-top:1px solid ${line}}}
@media (prefers-reduced-motion:no-preference){${s} .card,${s} .plan{transition:transform .3s cubic-bezier(.2,.6,.2,1)}${s} .plan:hover{transform:translateY(-4px)}}
</style>`;
}

// ---- type patterns -------------------------------------------------------
function cards(items, lang) {
  return `<div class="cards">${items.map((it, i) => `<div class="card">
    <span class="idx"><span dir="ltr">[ ${String(i + 1).padStart(2, '0')} ]</span></span>
    <h3>${renderInline(pick(it, 'title', lang))}</h3>
    ${pick(it, 'desc', lang) ? `<p>${renderInline(pick(it, 'desc', lang))}</p>` : ''}
  </div>`).join('')}</div>`;
}
function steps(items, lang) {
  return `<ol class="steps">${items.map((it, i) => `<li class="step">
    <span class="n"><span dir="ltr">${String(i + 1).padStart(2, '0')}</span></span>
    <h3>${renderInline(pick(it, 'title', lang))}</h3>
    ${pick(it, 'desc', lang) ? `<p>${renderInline(pick(it, 'desc', lang))}</p>` : ''}
  </li>`).join('')}</ol>`;
}
function stats(items, lang) {
  return `<div class="stats">${items.map(it => `<div class="stat">
    <b>${esc(num(it?.value ?? '', lang))}</b>
    <span>${renderInline(pick(it, 'label', lang))}</span>
  </div>`).join('')}</div>`;
}
function pricing(items, lang) {
  const t = STR[lang];
  return `<div class="plans">${items.map(it => {
    const price = pick(it, 'price', lang).trim();
    const feats = Array.isArray(it?.features) ? it.features.map(f => bilingual(f, lang)).filter(Boolean) : [];
    return `<div class="plan${it?.featured ? ' featured' : ''}">
    ${it?.featured ? `<span class="tag">${t.featured}</span>` : ''}
    <h3>${renderInline(pick(it, 'name', lang))}</h3>
    <div class="price${price ? '' : ' proposal'}">${price ? renderInline(price) : t.proposal}</div>
    ${pick(it, 'desc', lang) ? `<p>${renderInline(pick(it, 'desc', lang))}</p>` : ''}
    ${feats.length ? `<ul>${feats.map(f => `<li>${renderInline(f)}</li>`).join('')}</ul>` : ''}
  </div>`;
  }).join('')}</div>`;
}

function ctaLink(sec, lang, cls = 'btn') {
  const label = pick(sec, 'cta_label', lang).trim();
  const h = safeHref(String(sec.cta_href || '').trim());
  if (!label || !h) return '';
  const rel = h.external ? ' rel="noopener noreferrer" target="_blank"' : '';
  return `<a class="${cls}" href="${attr(h.href)}"${rel}>${renderInline(label)}</a>`;
}

// one section → html; exported for tests and the admin preview
export function renderSection(sec, lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const id = String(sec.slug || `section-${sec.id}`);
  const theme = sec.theme === 'dark' ? 'dark' : 'light';
  const type = TYPES.includes(sec.type) ? sec.type : 'richtext';
  const ctx = getSiteContext(lang);
  const title = pick(sec, 'title', lang);
  const bodyMd = pick(sec, 'body', lang);
  const items = J(sec.items).filter(x => x && typeof x === 'object').slice(0, 24);
  const eyebrow = String(sec.eyebrow || '').trim();
  const body = bodyMd.trim() ? `<div class="sx-body">${renderMarkdown(bodyMd, { tokens: ctx.tokens })}</div>` : '';

  let inner;
  if (type === 'cta') {
    inner = `<div class="banner">
      ${eyebrow ? `<p class="eyebrow">${esc(eyebrow)}</p>` : ''}
      ${title ? `<h2>${renderInline(title)}</h2>` : ''}
      ${body}
      ${ctaLink(sec, lang)}
    </div>`;
  } else {
    const pattern = type === 'cards' ? cards(items, lang)
      : type === 'steps' ? steps(items, lang)
        : type === 'stats' ? stats(items, lang)
          : type === 'pricing' ? pricing(items, lang) : '';
    const cta = ctaLink(sec, lang);
    inner = `${title || eyebrow ? `<div class="sx-head">${title ? `<h2>${renderInline(title)}</h2>` : ''}${eyebrow ? `<span class="eyebrow">${esc(eyebrow)}</span>` : ''}</div>` : ''}
      ${body}
      ${items.length ? pattern : ''}
      ${cta ? `<div class="sx-cta">${cta}</div>` : ''}`;
  }

  return `<section id="${attr(id)}" class="${theme === 'light' ? 'light' : 'solid'} sx sx-${type}" data-phase="3" data-section="${attr(id)}">
${css(id, theme)}
<div class="wrap">
${inner}
</div>
</section>`;
}

export function renderSectionsFor(placement, lang) {
  if (!PLACEMENTS.includes(placement)) return '';
  return publishedSections(placement).map(s => renderSection(s, lang)).join('\n');
}

export const renderSectionsAfterAbout = lang => renderSectionsFor('after_about', lang);
export default renderSectionsAfterAbout;
