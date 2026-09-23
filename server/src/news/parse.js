// RSS 2.0 / RSS 1.0 (RDF) / Atom → plain items.
//   parseFeed(xml, { baseUrl }) → { kind, title, items: [{ title, link, date, summary }] }
// Everything that leaves here is plain text: descriptions are HTML inside
// XML, so tags are stripped and entities decoded after the XML parse, and
// the summary is cut to MAX_SUMMARY characters. Links are absolute http(s)
// or the item is dropped. A document that declares its own entities is
// refused outright (entity-expansion bombs), and fast-xml-parser's own
// prototype-pollution guard stays on.
import { XMLParser } from 'fast-xml-parser';

export const MAX_SUMMARY = 1500;
export const MAX_TITLE = 300;
export const MAX_ITEMS = 200;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: true,
  // a lone <item>/<entry>/<link> would otherwise come back as an object
  isArray: (name, jpath) => ['rss.channel.item', 'rdf:RDF.item', 'feed.entry', 'feed.entry.link', 'rss.channel.item.category'].includes(jpath),
});

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', laquo: '«', raquo: '»', copy: '©', reg: '®', trade: '™', middot: '·', bull: '•' };
export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '';
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

// HTML fragment → one line of plain text
export function htmlToText(html) {
  let s = String(html ?? '');
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|iframe|svg|figure|figcaption)\b[\s\S]*?<\/\1\s*>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/blockquote)\b[^>]*>/gi, ' ')
    .replace(/<[^>]*>/g, ' ');
  s = decodeEntities(decodeEntities(s));   // feeds often double-escape (&amp;amp;)
  // a stray "<" left by the decode must not look like markup to anything downstream
  s = s.replace(/[<>]/g, ' ');
  return s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​﻿]/g, '').replace(/\s+/g, ' ').trim();
}

// cut at a word boundary and mark the cut
export function clip(s, max) {
  s = String(s || '');
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

const text = node => {
  if (node === null || node === undefined) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') return text(node['#text']);
  return '';
};

function absoluteHttp(href, baseUrl) {
  const h = String(href || '').trim();
  if (!h) return '';
  let u;
  try { u = baseUrl ? new URL(h, baseUrl) : new URL(h); } catch { return ''; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return '';
  if (u.username || u.password) return '';
  return u.href;
}

function isoDate(s) {
  const str = String(s || '').trim();
  if (!str) return null;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function atomLink(links, baseUrl) {
  const list = (Array.isArray(links) ? links : [links]).filter(Boolean);
  const pick = list.find(l => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate') && (!l['@_type'] || /html/i.test(l['@_type'])))
    || list.find(l => typeof l === 'object' && (!l['@_rel'] || l['@_rel'] === 'alternate'))
    || list[0];
  return absoluteHttp(typeof pick === 'string' ? pick : pick?.['@_href'], baseUrl);
}

function rssLink(it, baseUrl) {
  const link = absoluteHttp(text(it.link), baseUrl);
  if (link) return link;
  // <guid isPermaLink="true"> (the default when the attribute is absent)
  const g = it.guid;
  const perma = typeof g === 'object' ? g?.['@_isPermaLink'] !== 'false' : true;
  return perma ? absoluteHttp(text(g), baseUrl) : '';
}

const clean = (raw, max) => clip(htmlToText(raw), max);

export function parseFeed(xml, { baseUrl = '' } = {}) {
  const src = String(xml ?? '');
  if (!src.trim()) throw new Error('empty_feed');
  if (/<!ENTITY/i.test(src)) throw new Error('unsafe_xml');
  let doc;
  try { doc = parser.parse(src); } catch { throw new Error('bad_xml'); }
  if (!doc || typeof doc !== 'object') throw new Error('not_a_feed');

  let kind, title, raw;
  if (doc.rss?.channel) {
    kind = 'rss';
    const ch = Array.isArray(doc.rss.channel) ? doc.rss.channel[0] : doc.rss.channel;
    title = text(ch.title);
    raw = (ch.item || []).map(it => ({
      title: it.title,
      link: rssLink(it, baseUrl),
      date: it.pubDate ?? it['dc:date'] ?? it.published ?? it.updated,
      summary: it.description ?? it['content:encoded'] ?? it.summary,
    }));
  } else if (doc.feed) {
    kind = 'atom';
    title = text(doc.feed.title);
    raw = (doc.feed.entry || []).map(e => ({
      title: e.title,
      link: atomLink(e.link, baseUrl),
      date: e.published ?? e.updated ?? e.issued,
      summary: e.summary ?? e.content,
    }));
  } else if (doc['rdf:RDF']) {
    kind = 'rdf';
    title = text(doc['rdf:RDF'].channel?.title);
    raw = (doc['rdf:RDF'].item || []).map(it => ({
      title: it.title, link: absoluteHttp(text(it.link), baseUrl), date: it['dc:date'], summary: it.description,
    }));
  } else {
    throw new Error('not_a_feed');
  }

  const items = [];
  for (const r of raw.slice(0, MAX_ITEMS)) {
    const t = clean(text(r.title), MAX_TITLE);
    if (!t || !r.link) continue;
    items.push({ title: t, link: r.link, date: isoDate(text(r.date)), summary: clean(text(r.summary), MAX_SUMMARY) });
  }
  return { kind, title: clean(title, 200), items };
}

// true when a body looks like a feed rather than an HTML page
export const looksLikeFeed = s => /<(rss|feed|rdf:RDF)[\s>]/i.test(String(s || '').slice(0, 4000));
