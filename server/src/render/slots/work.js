// SLOT:WORK — the #work section of the home page: heading row (WORK_H2 /
// WORK_HINT from content), the cinematic showcase (#showcase: #sc-stage
// cross-fading .sc-slide images + #sc-bar, #sc-list index of .sc-row rows;
// the first item carries `on`) and the "all work" button (WORK_ALL).
// Rows: projects WHERE published=1 AND show_on_home=1 ORDER BY sort,id LIMIT 9.
// The markup mirrors vesper.src.html's WORK region exactly — the page CSS
// and the showcase script key off those ids/classes. Without any project
// the #showcase block is omitted (the script bails out cleanly on a missing
// #showcase); the heading and the button still render.
import { db } from '../../db/index.js';
import { esc, attr } from '../../lib/html.js';
import { getContent } from '../../lib/content.js';

export const HOME_LIMIT = 9;

export function homeProjects(limit = HOME_LIMIT) {
  return db.prepare(`SELECT id, slug, title_en, title_fa, desc_en, desc_fa, tags, image, cover_en, cover_fa
    FROM projects WHERE published=1 AND show_on_home=1 ORDER BY sort, id LIMIT ?`).all(limit);
}

// The cover for one language: cover_<lang> (the seed ships "-fa-full.jpg"
// screenshots of the Persian UI for most showcase projects), else cover_en,
// else the generic image. The seed stored covers as "../assets/…" relative
// to the baked page; the SSR page lives at /<lang>/ so they must be
// site-absolute. Only a site-relative path or an http(s) URL is accepted.
export function imageSrc(p, lang = 'en') {
  const l = lang === 'fa' ? 'fa' : 'en';
  const raw = String(p[`cover_${l}`] || p.cover_en || p.image || '').trim().replace(/^(?:\.\.\/)+assets\//, '/assets/');
  if (/^\/(?![/\\])/.test(raw) || /^https?:\/\/[^/?#\\]/i.test(raw)) return raw;
  return '';
}

export function renderWorkSlot(lang) {
  const l = lang === 'en' ? 'en' : 'fa';
  const c = getContent(l);
  const rows = homeProjects();
  const href = p => (p.slug ? `/${l}/work/${attr(p.slug)}` : `/${l}/work`);
  const title = p => (l === 'fa' ? p.title_fa : p.title_en) || (l === 'fa' ? p.title_en : p.title_fa) || '';
  const desc = p => (l === 'fa' ? p.desc_fa : p.desc_en) || '';

  const slides = rows.map((p, i) => {
    const src = imageSrc(p, l);
    const img = src ? `<img src="${attr(src)}" alt="${attr(title(p))}"${i ? ' loading="lazy"' : ''}>` : '';
    return `          <a class="sc-slide${i ? '' : ' on'}" href="${href(p)}">${img}</a>`;
  }).join('\n');

  const list = rows.map((p, i) => `        <a class="sc-row${i ? '' : ' on'}" href="${href(p)}">
          <span class="sc-num">${String(i + 1).padStart(2, '0')}</span>
          <span class="sc-titles"><b>${esc(title(p))}</b><em class="sc-desc">${esc(desc(p))}</em><i>${esc(p.tags || '')}</i></span>
          <span class="sc-arrow">→</span>
        </a>`).join('\n');

  const showcase = rows.length ? `    <div class="showcase rv d1" id="showcase">
      <div class="sc-stagewrap">
        <div class="sc-stage" id="sc-stage">
${slides}
          <span class="sc-bar" id="sc-bar"></span>
        </div>
      </div>
      <nav class="sc-list" id="sc-list">
${list}
      </nav>
    </div>
` : '';

  return `<section id="work" class="light" data-phase="3">
  <div class="wrap">
    <div class="work-head">
      <h2 class="rv">${esc(c.WORK_H2 ?? '')}</h2>
      <span class="work-hint mono rv d1">${esc(c.WORK_HINT ?? '')}</span>
    </div>
  </div>
  <div class="wrap">
${showcase}    <div class="work-all rv d2"><a class="work-all-btn" href="/${l}/work">${esc(c.WORK_ALL ?? '')}</a></div>
  </div>
</section>`;
}

export const renderSlot = renderWorkSlot;
export const render = ({ lang = 'fa' } = {}) => renderWorkSlot(lang);
export default renderWorkSlot;
