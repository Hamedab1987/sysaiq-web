// Home-page slot NEWS: the three latest published AI & tech briefs.
//   renderSlot('fa') → <section id="news" class="solid" data-phase="3">…</section>,
//                      or '' when nothing is published (never an empty section)
// Must stay server-rendered: the home script captures [data-phase] sections
// and the .solid HUD occluders once at load.
// Cards use the news pages' own markup and stylesheet (/assets/site/news.css:
// .nw-card, .nw-cover, .nw-meta…); the #news-scoped <style> only adds what
// the home page lacks — the pages.css tokens and .card chrome — plus the
// section head. The brand cover comes from render/news.js when it exports
// cover(); until then a glyph-less cover in the same classes stands in.
// Only status='published' rows are read (latestNews); every string is escaped.
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.js';
import { esc, attr } from '../../lib/html.js';
import * as newsPages from '../news.js';

export const HOME_NEWS_COUNT = 3;
const CATS = newsPages.NEWS_CATEGORIES;

const STR = {
  fa: {
    h2: 'تازه‌های <em>AI</em> و فناوری',
    sub: 'خلاصهٔ کوتاه و دوزبانهٔ خبرهای مهم، هرکدام با لینک منبع اصلی و پس از بازبینی.',
    more: 'ادامهٔ خبر', all: 'همهٔ اخبار', arrow: '←',
    cats: { models: 'مدل‌ها', tools: 'ابزارها', devices: 'دستگاه‌ها', tech: 'فناوری', industry: 'صنعت' },
  },
  en: {
    h2: 'AI &amp; tech <em>signal</em>',
    sub: 'Short bilingual briefs on the news that matters, each linked to its original source and reviewed before publication.',
    more: 'Read the brief', all: 'All news', arrow: '→',
    cats: { models: 'Models', tools: 'Tools', devices: 'Devices', tech: 'Tech', industry: 'Industry' },
  },
};

// news.css is cache-busted by its own mtime, like the news pages do
const CSS_V = (() => {
  try { return Math.floor(statSync(join(config.siteDir, 'assets', 'site', 'news.css')).mtimeMs).toString(36); } catch { return '1'; }
})();

const pick = (row, key, lang) => String((lang === 'fa' ? row[`${key}_fa`] : row[`${key}_en`]) || '');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s; };
const isoOf = s => {
  if (!s) return '';
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};
const catOf = c => (CATS.includes(c) ? c : 'industry');

function fallbackCover(category) {
  const c = catOf(category);
  return `<div class="nw-cover nw-c-${c}" aria-hidden="true"><span class="nw-cover-tag mono" dir="ltr">[ ${c.toUpperCase()} ]</span></div>`;
}
const cover = c => (typeof newsPages.cover === 'function' ? newsPages.cover(catOf(c)) : fallbackCover(c));

function card(item, lang) {
  const t = STR[lang];
  const c = catOf(item.category);
  const iso = isoOf(item.published_at);
  const summary = pick(item, 'summary', lang);
  return `<a class="card nw-card" href="/${lang}/news/${attr(item.slug)}">
      ${cover(c)}
      <div class="nw-card-body">
        <p class="nw-meta"><span class="nw-cat nw-k-${c}">${esc(t.cats[c])}</span>${iso ? `<time datetime="${attr(iso)}">${esc(newsPages.formatDate(item.published_at, lang))}</time>` : ''}</p>
        <h3 class="nw-title">${esc(pick(item, 'title', lang))}</h3>
        ${summary ? `<p class="nw-sum">${esc(clip(summary, 200))}</p>` : ''}
        <span class="nw-more">${t.more} ${t.arrow}</span>
      </div>
    </a>`;
}

// what pages.css gives the news pages, scoped to #news, + the section head
const CSS = `<style>
#news{padding:110px 0;--panel:#0e1422;--body:rgba(236,234,246,.72);--grad:linear-gradient(135deg,var(--mint,#7dffd9),var(--violet,#8b6bff));--nw-models:#8b6bff;--nw-tools:#7dffd9;--nw-devices:#7db8ff;--nw-tech:#b9a8ff;--nw-industry:#ffc46b}
#news::before{content:"";position:absolute;inset-inline:0;inset-block-start:0;height:420px;pointer-events:none;background:radial-gradient(120% 80% at 50% -10%,rgba(139,107,255,.10),transparent 55%)}
#news .wrap{position:relative}
#news .nx-head{display:flex;align-items:baseline;justify-content:space-between;gap:24px;flex-wrap:wrap;margin-bottom:18px}
#news h2{font-size:clamp(36px,4.8vw,64px);font-weight:300;line-height:1.04;letter-spacing:-.025em;color:var(--ink,#eceaf6);max-width:820px}
#news h2 em{font-style:normal;background:var(--grad);-webkit-background-clip:text;background-clip:text;color:transparent}
[dir="rtl"] #news h2{letter-spacing:0;line-height:1.3}
#news .eyebrow{direction:ltr;unicode-bidi:isolate}
#news .nx-sub{max-width:640px;font-size:14.5px;line-height:1.8;color:var(--body);margin-bottom:44px}
[dir="rtl"] #news .nx-sub{line-height:2}
#news .card{background:var(--panel);border:1px solid var(--line,rgba(236,234,246,.12));border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:transform .3s cubic-bezier(.2,.6,.2,1),box-shadow .3s,border-color .3s}
#news .card:hover,#news .card:focus-visible{transform:translateY(-6px);box-shadow:0 30px 60px -28px rgba(139,107,255,.55);border-color:rgba(236,234,246,.2)}
#news .card:focus-visible{outline:2px solid var(--mint,#7dffd9);outline-offset:2px}
#news .nx-all{margin-top:40px;display:flex;justify-content:center}
#news .nx-all a{display:inline-flex;align-items:center;gap:8px;min-height:44px;padding:10px 24px;border-radius:100px;border:1px solid rgba(236,234,246,.22);background:rgba(236,234,246,.04);color:var(--ink,#eceaf6);font-size:13.5px;text-decoration:none;transition:border-color .25s,color .25s}
#news .nx-all a:hover{border-color:var(--mint,#7dffd9);color:var(--mint,#7dffd9)}
#news .nx-all a:focus-visible{outline:2px solid var(--mint,#7dffd9);outline-offset:2px}
@media (max-width:900px){#news{padding:80px 0}#news .wrap{padding-inline:24px}#news .nx-sub{margin-bottom:32px}}
@media (prefers-reduced-motion:reduce){#news .card{transition:none}#news .card:hover{transform:none}}
</style>`;

export function renderSlot(lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const items = newsPages.latestNews(HOME_NEWS_COUNT).filter(it => it.slug && pick(it, 'title', lang));
  if (!items.length) return '';
  const t = STR[lang];
  return `<link rel="stylesheet" href="/assets/site/news.css?v=${CSS_V}">
${CSS}
<section id="news" class="solid" data-phase="3" aria-labelledby="news-h">
  <div class="wrap">
    <div class="nx-head">
      <h2 id="news-h" class="rv">${t.h2}</h2>
      <span class="eyebrow mono rv d1" dir="ltr">[ SYSAIQ—SIGNAL / SYS.06 ]</span>
    </div>
    <p class="nx-sub rv d1">${esc(t.sub)}</p>
    <div class="nw-grid rv d2">
    ${items.map(it => card(it, lang)).join('\n    ')}
    </div>
    <div class="nx-all rv d3"><a href="/${lang}/news">${t.all} ${t.arrow}</a></div>
  </div>
</section>`;
}
export default renderSlot;
