// news/parse.js + news/dedupe.js: pure functions, no app needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed, htmlToText, looksLikeFeed, MAX_SUMMARY } from '../../src/news/parse.js';
import { normalizeUrl, urlHash, isFresh, titleSimilarity, findSimilar, MAX_AGE_DAYS } from '../../src/news/dedupe.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/">
<channel><title>Lab &amp; Co News</title><link>https://lab.example.com/</link>
<item>
  <title><![CDATA[Model X ships <b>today</b>]]></title>
  <link>https://lab.example.com/news/model-x?utm_source=rss</link>
  <pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate>
  <description>&lt;p&gt;The &lt;strong&gt;new&lt;/strong&gt; model &amp;amp; API.&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;</description>
</item>
<item>
  <title>Relative link item</title>
  <link>/news/relative</link>
  <dc:date>2026-09-21T08:00:00Z</dc:date>
  <content:encoded><![CDATA[<p>Body&nbsp;text ${'long '.repeat(600)}</p>]]></content:encoded>
</item>
<item><title>Guid only</title><guid isPermaLink="true">https://lab.example.com/g/1</guid></item>
<item><title>Non-perma guid</title><guid isPermaLink="false">tag:lab,2026:1</guid></item>
<item><title>Bad scheme</title><link>javascript:alert(1)</link></item>
</channel></rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title type="text">Verge-ish AI</title>
  <entry>
    <title type="html">Chip &amp;lt;news&amp;gt; arrives</title>
    <link rel="alternate" type="text/html" href="https://news.example.org/2026/9/22/chip"/>
    <link rel="enclosure" href="https://cdn.example.org/a.jpg"/>
    <published>2026-09-22T12:00:00-04:00</published>
    <summary type="html">&lt;p&gt;A new AI chip.&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>Only updated</title>
    <link href="https://news.example.org/2026/9/20/b"/>
    <updated>2026-09-20T00:00:00Z</updated>
    <content type="html">&lt;div&gt;Content body&lt;/div&gt;</content>
  </entry>
</feed>`;

test('RSS 2.0: titles, links, dates and plain-text summaries', () => {
  const f = parseFeed(RSS, { baseUrl: 'https://lab.example.com/feed' });
  assert.equal(f.kind, 'rss');
  assert.equal(f.title, 'Lab & Co News');
  assert.equal(f.items.length, 3, 'the non-permalink guid and the javascript: link are dropped');
  const [a, b, c] = f.items;
  assert.equal(a.title, 'Model X ships today');
  assert.equal(a.link, 'https://lab.example.com/news/model-x?utm_source=rss');
  assert.equal(a.date, '2026-09-22T10:00:00.000Z');
  assert.equal(a.summary, 'The new model & API.');
  assert.doesNotMatch(a.summary, /[<>]|alert|onerror/);
  assert.equal(b.link, 'https://lab.example.com/news/relative', 'relative links resolve against the feed URL');
  assert.equal(b.date, '2026-09-21T08:00:00.000Z');
  assert.ok(b.summary.length <= MAX_SUMMARY && b.summary.endsWith('…'), 'long bodies are clipped');
  assert.match(b.summary, /^Body text long/);
  assert.equal(c.link, 'https://lab.example.com/g/1');
  assert.equal(c.date, null);
});

test('Atom: alternate link, published/updated, html summary', () => {
  const f = parseFeed(ATOM);
  assert.equal(f.kind, 'atom');
  assert.equal(f.title, 'Verge-ish AI');
  assert.equal(f.items.length, 2);
  assert.equal(f.items[0].title, 'Chip news arrives', 'a literal "<news>" in an html title becomes text, never a tag');
  assert.equal(f.items[0].link, 'https://news.example.org/2026/9/22/chip');
  assert.equal(f.items[0].date, '2026-09-22T16:00:00.000Z');
  assert.equal(f.items[0].summary, 'A new AI chip.');
  assert.equal(f.items[1].date, '2026-09-20T00:00:00.000Z');
  assert.equal(f.items[1].summary, 'Content body');
});

test('refuses entity declarations, HTML pages and garbage', () => {
  const bomb = `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;">]><rss><channel><item><title>&lol2;</title><link>https://a.example/x</link></item></channel></rss>`;
  assert.throws(() => parseFeed(bomb), /unsafe_xml/);
  assert.throws(() => parseFeed('<!doctype html><html><body>hi</body></html>'), /not_a_feed|bad_xml/);
  assert.throws(() => parseFeed(''), /empty_feed/);
  assert.equal(looksLikeFeed(RSS), true);
  assert.equal(looksLikeFeed(ATOM), true);
  assert.equal(looksLikeFeed('<html><head></head></html>'), false);
});

test('htmlToText: no markup survives, entities decoded once or twice', () => {
  assert.equal(htmlToText('<p>A &amp;amp; B</p><style>x{}</style><script>bad()</script> &#x41;&#66;'), 'A & B AB');
  assert.equal(htmlToText('x &lt;script&gt;y'), 'x script y');
  assert.doesNotMatch(htmlToText('&lt;img src=x onerror=alert(1)&gt;'), /[<>]/);
});

test('normalizeUrl / urlHash: tracking params, fragments, trailing slash, scheme', () => {
  assert.equal(normalizeUrl('https://Example.com/a/b/?utm_source=x&b=2&a=1#frag'), 'https://example.com/a/b?a=1&b=2');
  assert.equal(normalizeUrl('ftp://example.com/x'), '');
  assert.equal(normalizeUrl('not a url'), '');
  assert.equal(urlHash('http://example.com/a?utm_medium=rss'), urlHash('https://example.com/a/'));
  assert.notEqual(urlHash('https://example.com/a'), urlHash('https://example.com/b'));
  assert.match(urlHash('https://example.com/a'), /^[0-9a-f]{32}$/);
});

test('isFresh: items older than the window are dropped, undated ones kept', () => {
  const now = Date.parse('2026-09-23T00:00:00Z');
  assert.equal(isFresh('2026-09-20T00:00:00Z', now), true);
  assert.equal(isFresh(new Date(now - (MAX_AGE_DAYS + 1) * 864e5).toISOString(), now), false);
  assert.equal(isFresh(null, now), true);
});

test('title similarity catches the same story syndicated twice', () => {
  assert.ok(titleSimilarity('OpenAI releases GPT-6 with better prompt caching', 'OpenAI releases GPT-6, with better prompt caching') >= 0.8);
  assert.ok(titleSimilarity('OpenAI releases GPT-6', 'NVIDIA unveils a new robotics chip') < 0.3);
  const recent = [{ id: 7, title: 'Google DeepMind introduces Gemini 3.8 Live' }];
  assert.equal(findSimilar('Google DeepMind introduces Gemini 3.8 Live!', recent)?.id, 7);
  assert.equal(findSimilar('Mistral and Mozilla partner on open models', recent), null);
});
