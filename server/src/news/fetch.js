// Outbound fetches for the news pipeline — feeds, and article pages for
// "draft from URL" / excerpt enrichment. Everything goes through
// lib/http.js: https only, credentials refused, every hop's host resolved
// and refused when private/loopback/link-local (SSRF), 10 s timeout, 2 MB
// cap, and the log line is {provider:'news', op, status, ms} — no URLs.
// Redirects are followed by hand (lib/http.js uses redirect:'manual') so
// each hop is vetted again. Conditional GET (ETag / Last-Modified) is sent
// when the caller has validators from the previous run.
import { httpRequest, HttpRequestError } from '../lib/http.js';
import { htmlToText, clip, decodeEntities, MAX_SUMMARY } from './parse.js';

export const FETCH_TIMEOUT_MS = 10_000;
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
const UA = 'Mozilla/5.0 (compatible; SysaiQ-NewsBot/1.0; +https://sysaiq.com)';
const FEED_ACCEPT = 'application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.9, */*;q=0.5';
const PAGE_ACCEPT = 'text/html, application/xhtml+xml;q=0.9, application/rss+xml;q=0.8, application/atom+xml;q=0.8, */*;q=0.5';

// tests (and the local demo script) swap the transport to serve fixtures;
// production always uses lib/http.js
let transport = httpRequest;
export function setTransport(fn) { transport = typeof fn === 'function' ? fn : httpRequest; }

//   fetchText(url, {etag, lastModified, kind:'feed'|'page'})
//   → { status: 200|304, text, etag, lastModified, url (final), contentType }
export async function fetchText(url, { etag = '', lastModified = '', kind = 'feed' } = {}) {
  let current = String(url || '');
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const headers = { 'user-agent': UA, accept: kind === 'page' ? PAGE_ACCEPT : FEED_ACCEPT, 'accept-language': 'en;q=0.9, *;q=0.5' };
    if (etag) headers['if-none-match'] = etag;
    if (lastModified) headers['if-modified-since'] = lastModified;
    const r = await transport({
      url: current, method: 'GET', headers, timeoutMs: FETCH_TIMEOUT_MS, maxBytes: FETCH_MAX_BYTES,
      provider: 'news', op: kind,
    });
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers?.get?.('location');
      if (!loc) throw new HttpRequestError('bad_redirect', 'redirect without a location');
      try { current = new URL(loc, current).href; } catch { throw new HttpRequestError('bad_redirect', 'redirect to an invalid URL'); }
      continue;
    }
    if (r.status === 304) return { status: 304, text: '', etag, lastModified, url: current, contentType: '' };
    if (!r.ok) throw new HttpRequestError(`http_${r.status}`, `HTTP ${r.status}`);
    return {
      status: r.status,
      text: r.text || '',
      etag: String(r.headers?.get?.('etag') || '').slice(0, 200),
      lastModified: String(r.headers?.get?.('last-modified') || '').slice(0, 100),
      url: current,
      contentType: String(r.headers?.get?.('content-type') || ''),
    };
  }
  throw new HttpRequestError('too_many_redirects', `more than ${MAX_REDIRECTS} redirects`);
}

// a short, log-safe code for any fetch/parse failure (stored on the source)
export function errorCode(e) {
  if (e instanceof HttpRequestError) {
    if (e.code === 'bad_url') return /private/.test(e.message) ? 'private_host' : /https/.test(e.message) ? 'https_required' : 'bad_url';
    return String(e.code || 'network').slice(0, 40);
  }
  const m = String(e?.message || '');
  return /^[a-z_0-9]{2,40}$/.test(m) ? m : 'error';
}

// ---- article pages ----------------------------------------------------------
const metaContent = (html, re) => {
  const m = re.exec(html);
  return m ? decodeEntities(m[1] || m[2] || '').trim() : '';
};
// <meta property="og:x" content="…"> in either attribute order
const metaRe = key => new RegExp(
  `<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']*)["']|<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${key}["']`, 'i');

//   pageSummary(html) → { title, description, siteName, text }  (all plain text)
export function pageSummary(html) {
  const h = String(html || '').slice(0, FETCH_MAX_BYTES);
  const title = htmlToText(metaContent(h, metaRe('og:title')) || (/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] || ''));
  const description = htmlToText(metaContent(h, metaRe('og:description')) || metaContent(h, metaRe('description')));
  const siteName = htmlToText(metaContent(h, metaRe('og:site_name')));
  // body text: the <article> when there is one, else the page; paragraphs only
  const scope = /<article\b[\s\S]*?<\/article>/i.exec(h)?.[0] || h;
  const paras = [];
  let len = 0;
  for (const m of scope.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const p = htmlToText(m[1]);
    if (p.length < 40) continue;          // bylines, captions, cookie notes
    paras.push(p);
    len += p.length;
    if (len > MAX_SUMMARY * 2) break;
  }
  const pub = Date.parse(metaContent(h, metaRe('article:published_time')));
  return {
    title: clip(title, 300), description: clip(description, 600), siteName: clip(siteName, 120), text: paras.join(' '),
    published: Number.isNaN(pub) ? null : new Date(pub).toISOString(),
  };
}

// best plain-text excerpt for the summariser: description first, then body
export function pageExcerpt(p) {
  const parts = [];
  if (p.description) parts.push(p.description);
  if (p.text && (!p.description || !p.text.startsWith(p.description.slice(0, 60)))) parts.push(p.text);
  return clip(parts.join(' ').replace(/\s+/g, ' ').trim(), MAX_SUMMARY);
}
