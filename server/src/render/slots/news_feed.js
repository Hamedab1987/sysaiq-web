// Home-page slot NEWS_FEED: a newsroom carousel right under the FAQ — the
// 10 latest published briefs, newest first, each one card linking to its
// /:lang/news/<slug> page. Lives beside the #news block (slots/news.js,
// after WORK), which stays as it is.
//   renderSlot('fa') → <section id="news-feed" class="light" data-phase="3" …>…</section>
//                      or '' when nothing is published (never an empty section)
// Server-rendered on purpose: the home script captures [data-phase]
// sections and the .light HUD occluders once at load.
// The track is a CSS scroll-snap row that swipes/scrolls without any
// script; /assets/site/news-feed.js (external — the home CSP only hashes the
// template's own inline script) adds buttons, dots, keys and a gentle,
// pausable autoplay. Its strings travel as data-* attributes.
// Covers: the owner's uploaded image when set, else the category's brand
// cover in a per-item composition (render/news.js cover()) — never a source
// image. Every string is escaped.
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../../config.js';
import { esc, attr } from '../../lib/html.js';
import { toFaDigits } from '../../lib/normalize.js';
import { latestNews, cover, formatDate, NEWS_CATEGORIES } from '../news.js';

export const FEED_COUNT = 10;

const STR = {
  fa: {
    h2: 'آخرین خبرهای <em>هوش مصنوعی</em> و فناوری',
    updated: 'آخرین به‌روزرسانی',
    all: 'همهٔ اخبار', more: 'ادامهٔ خبر', arrow: '←',
    prev: 'خبر قبلی', next: 'خبر بعدی', dots: 'انتخاب خبر',
    goto: 'نمایش خبر {i} از {n}', status: 'خبر {i} از {n}',
    pause: 'توقف نمایش خودکار خبرها', play: 'ادامهٔ نمایش خودکار خبرها',
    slide: (i, n) => `${toFaDigits(i)} از ${toFaDigits(n)}`,
    cats: { models: 'مدل‌ها', tools: 'ابزارها', devices: 'دستگاه‌ها', tech: 'فناوری', industry: 'صنعت' },
  },
  en: {
    h2: 'Latest in <em>AI</em> &amp; technology',
    updated: 'Last updated',
    all: 'All news', more: 'Read more', arrow: '→',
    prev: 'Previous story', next: 'Next story', dots: 'Choose a story',
    goto: 'Show story {i} of {n}', status: 'Story {i} of {n}',
    pause: 'Pause automatic scrolling', play: 'Resume automatic scrolling',
    slide: (i, n) => `${i} of ${n}`,
    cats: { models: 'Models', tools: 'Tools', devices: 'Devices', tech: 'Tech', industry: 'Industry' },
  },
};

// ?v= = the asset's content hash, re-read only when its mtime changes
const versions = new Map(); // file → {mtimeMs, v}
export function assetVersion(file) {
  const path = join(config.siteDir, 'assets', 'site', file);
  try {
    const st = statSync(path);
    const hit = versions.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.v;
    const v = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 10);
    versions.set(file, { mtimeMs: st.mtimeMs, v });
    return v;
  } catch { return '1'; }
}

const pick = (row, key, lang) => String((lang === 'fa' ? row[`${key}_fa`] : row[`${key}_en`]) || '');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s; };
const isoOf = s => {
  if (!s) return '';
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};
const catOf = c => (NEWS_CATEGORIES.includes(c) ? c : 'industry');
const timeTag = (s, lang) => {
  const iso = isoOf(s);
  return iso ? `<time datetime="${attr(iso)}">${esc(formatDate(s, lang))}</time>` : '';
};

function slide(item, i, n, lang) {
  const t = STR[lang];
  const c = catOf(item.category);
  const id = Number(item.id) || i + 1;
  const summary = pick(item, 'summary', lang);
  return `      <div class="nf-slide" role="group" aria-roledescription="slide" aria-label="${attr(t.slide(i + 1, n))}">
        <a class="nf-card" href="/${lang}/news/${attr(item.slug)}" aria-labelledby="nf-t-${id}"${summary ? ` aria-describedby="nf-s-${id}"` : ''}>
          <div class="nf-media">${cover(c, { image: item.image, seed: `${id}:${c}`, uid: `f${id}`, tag: String(id).padStart(3, '0') })}</div>
          <div class="nf-body">
            <p class="nf-meta"><span class="nf-cat nf-k-${c}">${esc(t.cats[c])}</span>${timeTag(item.published_at, lang)}</p>
            <h3 class="nf-title" id="nf-t-${id}">${esc(pick(item, 'title', lang))}</h3>
            ${summary ? `<p class="nf-sum" id="nf-s-${id}">${esc(clip(summary, 320))}</p>` : ''}
            <span class="nf-more">${t.more} <span class="nf-arrow" aria-hidden="true">${t.arrow}</span></span>
          </div>
        </a>
      </div>`;
}

const ICON = {
  chev: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pause: '<svg class="nf-i-pause" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M9 6v12M15 6v12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  play: '<svg class="nf-i-play" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M8.5 6.2v11.6L18 12z" fill="currentColor"/></svg>',
};

export function renderSlot(lang) {
  lang = lang === 'en' ? 'en' : 'fa';
  const t = STR[lang];
  const items = latestNews(FEED_COUNT).filter(it => it.slug && pick(it, 'title', lang));
  if (!items.length) return '';
  const n = items.length;
  const data = {
    'data-nf': '', 'data-l-goto': t.goto, 'data-l-status': t.status, 'data-l-pause': t.pause, 'data-l-play': t.play,
  };
  const dataAttrs = Object.entries(data).map(([k, v]) => (v ? `${k}="${attr(v)}"` : k)).join(' ');
  const updated = timeTag(items[0].published_at, lang);
  return `<link rel="stylesheet" href="/assets/site/news-feed.css?v=${assetVersion('news-feed.css')}">
<section id="news-feed" class="light" data-phase="3" aria-roledescription="carousel" aria-labelledby="nf-h" ${dataAttrs}>
  <div class="wrap nf-head">
    <h2 id="nf-h" class="rv">${t.h2}</h2>
    <span class="eyebrow mono rv d1" dir="ltr">[ SYSAIQ—NEWSROOM / SYS.07 ]</span>
    ${updated ? `<p class="nf-live rv d1"><span class="nf-pulse" aria-hidden="true"></span>${t.updated}: ${updated}</p>` : ''}
    <a class="nf-all rv d1" href="/${lang}/news">${t.all} <span class="nf-arrow" aria-hidden="true">${t.arrow}</span></a>
  </div>
  <div class="nf-stage rv d2">
    <div class="nf-track" id="nf-track">
${items.map((it, i) => slide(it, i, n, lang)).join('\n')}
    </div>
    <div class="wrap nf-bar">
      <span class="nf-timer" aria-hidden="true"></span>
      <div class="nf-ctrl" hidden>
        <button class="nf-btn nf-play" type="button" aria-controls="nf-track" aria-label="${attr(t.pause)}">${ICON.pause}${ICON.play}</button>
        <div class="nf-dots" role="group" aria-label="${attr(t.dots)}"></div>
        <span class="nf-count" aria-hidden="true"></span>
        <span class="nf-grow"></span>
        <button class="nf-btn nf-prev" type="button" aria-controls="nf-track" aria-label="${attr(t.prev)}">${ICON.chev}</button>
        <button class="nf-btn nf-next" type="button" aria-controls="nf-track" aria-label="${attr(t.next)}">${ICON.chev}</button>
      </div>
      <p class="nf-sr" aria-live="polite"></p>
    </div>
  </div>
</section>
<script src="/assets/site/news-feed.js?v=${assetVersion('news-feed.js')}" defer></script>`;
}
export default renderSlot;
