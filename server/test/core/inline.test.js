import test from 'node:test';
import assert from 'node:assert/strict';
import { renderInline, safeHref } from '../../src/lib/inline.js';

const TAB = String.fromCharCode(9), NUL = String.fromCharCode(0);

test('escape → br / em / strong', () => {
  assert.equal(renderInline('a\nb'), 'a<br>b');
  assert.equal(renderInline('*em* and **strong**'), '<em>em</em> and <strong>strong</strong>');
  assert.equal(renderInline('a < b & c > d "q" \'s\''), 'a &lt; b &amp; c &gt; d &quot;q&quot; &#39;s&#39;');
  assert.equal(renderInline(''), '');
  assert.equal(renderInline(undefined), '');
});

test('raw HTML, script and handlers are neutralised', () => {
  const html = renderInline('<script>alert(1)</script><img src=x onerror=alert(1)><b>x</b>');
  assert.equal(html, '&lt;script&gt;alert(1)&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt;&lt;b&gt;x&lt;/b&gt;');
});

test('links: allowed schemes only; javascript in any disguise is dropped', () => {
  assert.equal(renderInline('[x](/fa/a)'), '<a href="/fa/a">x</a>');
  assert.equal(renderInline('[x](https://e.com/?a=1&b=2)'), '<a href="https://e.com/?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">x</a>');
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', `java${TAB}script:alert(1)`, `java${NUL}script:x`, ' javascript:x', '//evil.com', '/\\evil.com', 'data:x', 'ftp://x']) {
    const html = renderInline(`[x](${u})`);
    assert.ok(!html.includes('<a'), `dropped: ${JSON.stringify(u)} → ${html}`);
    assert.ok(html.includes('x'));
  }
});

test('code spans protect their content; escapes yield literals', () => {
  assert.equal(renderInline('`*not em*`'), '<code>*not em*</code>');
  assert.equal(renderInline('\\*lit\\*'), '*lit*');
  assert.equal(renderInline('[**b** `c`](/p)'), '<a href="/p"><strong>b</strong> <code>c</code></a>');
});

test('escapes inside a link URL are literals; the placeholder index never leaks into the href', () => {
  assert.equal(renderInline('[z](/p\\*q)'), '<a href="/p*q">z</a>');
  assert.equal(renderInline('[z](/a\\)b)'), '<a href="/a)b">z</a>');
  assert.ok(!/href="[^"]*\d[^"]*"/.test(renderInline('[z](/\\_)')), 'no stash index in href');
  // restoring escapes cannot smuggle a bad scheme or a protocol-relative URL past safeHref
  for (const u of ['/\\\\evil.com', 'java\\.script:x', '\\/\\/evil.com', '`a`']) {
    const html = renderInline(`[x](${u})`);
    assert.ok(!html.includes('<a'), `dropped: ${JSON.stringify(u)} → ${html}`);
  }
});

test('a code span inside a link target is not a link (no generated tag ever lands in an href)', () => {
  for (const md of ['[x](https://a.b/`x`)', '[x](/p/`q`/r)', '[x](`https://a.b/`)', '[x](https://a.b/`a`\\*`b`)']) {
    const html = renderInline(md);
    assert.ok(!html.includes('<a'), `dropped: ${md} → ${html}`);
    assert.ok(!html.includes('href='), md);
    assert.ok(!html.includes('\u0000'), `no placeholder leaks: ${md} → ${html}`);
    assert.ok(html.includes('x'), md);
  }
  // a code span next to the link, or in its text, still works
  assert.equal(renderInline('`c` [x](/p)'), '<code>c</code> <a href="/p">x</a>');
  assert.equal(renderInline('[`x`](/p)'), '<a href="/p"><code>x</code></a>');
});

test('safeHref', () => {
  assert.deepEqual(safeHref('https://a.b/c'), { href: 'https://a.b/c', external: true });
  // NUL is the stash placeholder and '<' a generated tag; neither belongs in a URL
  assert.equal(safeHref(`https://a.b/${NUL}0${NUL}`), null);
  assert.equal(safeHref('https://a.b/<code>x</code>'), null);
  assert.equal(safeHref('/a>b'), null);
  assert.deepEqual(safeHref('mailto:a@b.c'), { href: 'mailto:a@b.c', external: false });
  assert.deepEqual(safeHref('/x'), { href: '/x', external: false });
  assert.deepEqual(safeHref('#top'), { href: '#top', external: false });
  assert.equal(safeHref(`java${TAB}script:x`), null);
  assert.equal(safeHref('JAVASCRIPT:x'), null);
  assert.equal(safeHref('//evil'), null);
  assert.equal(safeHref('/\\evil'), null);
  assert.equal(safeHref('https://'), null);
  assert.equal(safeHref(''), null);
  assert.equal(safeHref(null), null);
  assert.equal(safeHref('x'.repeat(3000)), null);
});
