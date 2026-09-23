// Duplicate / freshness checks for collected items.
//   normalizeUrl(u)   → canonical form stored in news_items.url (UNIQUE)
//   urlHash(u)        → 32 hex chars of sha256(normalizeUrl(u))
//   isFresh(iso, now) → false when older than MAX_AGE_DAYS (undated items are fresh:
//                       the feed just listed them)
//   titleTokens / titleSimilarity / findSimilar → the same story syndicated by two
//                       outlets under slightly different URLs
import { createHash } from 'node:crypto';

export const MAX_AGE_DAYS = 10;
export const SIMILAR_AT = 0.8;

// tracking parameters that never change the article
const TRACKING = /^(utm_[a-z_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid|igshid|ref|ref_src|ref_url|cmpid|ncid|guccounter|_hsenc|_hsmi|mkt_tok|yclid|oly_[a-z_]+)$/i;

export function normalizeUrl(raw) {
  let u;
  try { u = new URL(String(raw || '').trim()); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  u.hash = '';
  u.username = ''; u.password = '';
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  const keep = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => a.localeCompare(b));
  u.search = keep.length ? `?${new URLSearchParams(keep).toString()}` : '';
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.href;
}

// http and https copies of one article are the same article
export const urlHash = raw => createHash('sha256')
  .update((normalizeUrl(raw) || String(raw || '')).replace(/^http:/, 'https:')).digest('hex').slice(0, 32);

export function isFresh(iso, now = Date.now()) {
  if (!iso) return true;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return now - t <= MAX_AGE_DAYS * 864e5;
}

const STOP = new Set('a an and are as at be by for from has have in into is it its new now of on or our the their this to up with will you your how why what when who we us vs via after over more than just about'.split(' '));

export function titleTokens(title) {
  return new Set(String(title || '').toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]s\b/g, '')
    .split(/[^\p{L}\p{N}.]+/u)
    .map(w => w.replace(/^\.+|\.+$/g, ''))
    .filter(w => w.length >= 2 && !STOP.has(w)));
}

// Jaccard over significant words; two very short titles need an exact match
export function titleSimilarity(a, b) {
  const A = a instanceof Set ? a : titleTokens(a);
  const B = b instanceof Set ? b : titleTokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  if (Math.min(A.size, B.size) < 3) return inter === union ? 1 : 0;
  return inter / union;
}

// recent: [{id, title}] (titles of items collected in the freshness window)
export function findSimilar(title, recent, threshold = SIMILAR_AT) {
  const T = titleTokens(title);
  for (const r of recent) {
    const R = r.tokens || (r.tokens = titleTokens(r.title));
    if (titleSimilarity(T, R) >= threshold) return r;
  }
  return null;
}
