import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, LIMITS } from '../../src/lib/markdown.js';

const TAB = String.fromCharCode(9), NUL = String.fromCharCode(0), CR = String.fromCharCode(13), LF = String.fromCharCode(10), ZWSP = String.fromCharCode(0x200b);
const noTag = (html, tag) => assert.ok(!new RegExp(`<${tag}[\\s>]`, 'i').test(html), `no <${tag}> in ${html}`);
const noHandler = html => assert.ok(!/<[^>]*\son\w+\s*=/i.test(html), `no on*= inside a tag in ${html}`);
const noJsHref = html => assert.ok(!/href="[^"]*script:/i.test(html.replace(/[^\x20-\x7e]/g, '')), `no script: href in ${html}`);

test('raw HTML is escaped, never passed through', () => {
  const html = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n<a href="javascript:x">y</a> <b>bold</b>');
  noTag(html, 'script'); noTag(html, 'img'); noTag(html, 'a'); noTag(html, 'b');
  noHandler(html);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('javascript: links are dropped in every disguise', () => {
  const cases = [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', `java${TAB}script:alert(1)`, `java${NUL}script:alert(1)`,
    `${TAB}javascript:alert(1)`, `java${ZWSP}script:alert(1)`, `java${LF}script:alert(1)`, 'vbscript:x', 'data:text/html;base64,AAAA',
    '//evil.com/x', '/\\evil.com', 'javascript&#58;alert(1)', 'JAVASCRIPT:alert(1)',
  ];
  for (const url of cases) {
    const html = renderMarkdown(`[click](${url})`);
    noTag(html, 'a');
    noJsHref(html);
    assert.ok(html.includes('click'), `text kept for ${JSON.stringify(url)}`);
  }
});

test('allowed link schemes render, external ones get noopener', () => {
  const html = renderMarkdown('[a](https://example.com/x?y=1&z=2) [b](http://e.com) [c](mailto:x@y.z) [d](tel:+989121234567) [e](/fa/services) [f](#faq)');
  assert.ok(html.includes('<a href="https://example.com/x?y=1&amp;z=2" rel="noopener noreferrer" target="_blank">a</a>'));
  assert.ok(html.includes('<a href="http://e.com" rel="noopener noreferrer" target="_blank">b</a>'));
  assert.ok(html.includes('<a href="mailto:x@y.z">c</a>'));
  assert.ok(html.includes('<a href="tel:+989121234567">d</a>'));
  assert.ok(html.includes('<a href="/fa/services">e</a>'));
  assert.ok(html.includes('<a href="#faq">f</a>'));
});

test('a quote inside a link URL cannot break out of the attribute', () => {
  const html = renderMarkdown('[x](/a"onmouseover="alert(1))');
  noHandler(html);
  assert.ok(html.includes('href="/a&quot;onmouseover=&quot;alert(1)"') || !html.includes('<a'));
});

test('headings, paragraphs, hr, blockquote', () => {
  const html = renderMarkdown('# One\n## Two\n### Three\n#### Four\n##### Five\n\nline a\nline b\n\n---\n\n> q1\n> q2');
  assert.ok(html.includes('<h2>One</h2>'));
  assert.ok(html.includes('<h2>Two</h2>'));
  assert.ok(html.includes('<h3>Three</h3>'));
  assert.ok(html.includes('<h4>Four</h4>'));
  assert.ok(html.includes('<h4>Five</h4>'));
  assert.ok(html.includes('<p>line a<br>line b</p>'));
  assert.ok(html.includes('<hr>'));
  assert.ok(html.includes('<blockquote>\n<p>q1<br>q2</p>\n</blockquote>'));
});

test('lists: unordered, ordered with start, nested', () => {
  const html = renderMarkdown('- a\n- b\n  - b1\n  - b2\n- c\n\n3. x\n4. y');
  assert.ok(html.includes('<ul>\n<li>a</li>\n<li>b\n<ul>\n<li>b1</li>\n<li>b2</li>\n</ul></li>\n<li>c</li>\n</ul>'));
  assert.ok(html.includes('<ol start="3">\n<li>x</li>\n<li>y</li>\n</ol>'));
});

test('tables with alignment and escaped pipes', () => {
  const html = renderMarkdown('| H1 | H2 | H3 |\n|:---|:--:|---:|\n| a | **b** | c \\| d |\n| 1 | 2 |');
  assert.ok(html.startsWith('<table>'));
  assert.ok(html.includes('<thead><tr><th class="ta-start">H1</th><th class="ta-center">H2</th><th class="ta-end">H3</th></tr></thead>'));
  assert.ok(html.includes('<td class="ta-center"><strong>b</strong></td>'));
  assert.ok(html.includes('<td class="ta-end">c | d</td>'));
  assert.ok(html.includes('<tr><td class="ta-start">1</td><td class="ta-center">2</td><td class="ta-end"></td></tr>'));
});

test('inline: strong, em, code, backslash escapes', () => {
  const html = renderMarkdown('**b** *i* ***bi*** `co*de*` \\*lit\\* \\# not heading');
  assert.ok(html.includes('<strong>b</strong> <em>i</em> <strong><em>bi</em></strong> <code>co*de*</code> *lit* # not heading'));
});

test('tokens are substituted and escaped; unknown tokens stay visible', () => {
  const html = renderMarkdown('Call {{site.mobile}} or {{ site.email }} — {{nope}} {{constructor}}',
    { tokens: { 'site.mobile': '0912 <b>x</b>', 'site.email': 'a@b.c' } });
  assert.ok(html.includes('0912 &lt;b&gt;x&lt;/b&gt;'));
  assert.ok(html.includes('a@b.c'));
  assert.ok(html.includes('{{nope}}'));
  assert.ok(html.includes('{{constructor}}'));
  noTag(html, 'b');
});

test('CRLF, NUL and empty input', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(`a${CR}\nb`), '<p>a<br>b</p>');
  assert.equal(renderMarkdown(`a${NUL}b`), '<p>ab</p>');
  assert.equal(renderMarkdown(`${NUL}${NUL}*x*${NUL}`), '<p><em>x</em></p>');
});

test('sources stay diffable text: the NUL the renderers strip is written as \\u0000, never as a raw byte', async () => {
  // a raw 0x00 inside a regex literal made git treat markdown.js as binary
  // (no diff, blame or review possible) — so every file under src/ is checked
  const { readFile, readdir } = await import('node:fs/promises');
  const src = new URL('../../src/', import.meta.url);
  const files = (await readdir(src, { recursive: true })).filter(f => f.endsWith('.js'));
  assert.ok(files.length > 30, `found ${files.length} source files`);
  for (const f of files) {
    const bytes = await readFile(new URL(f, src));
    assert.ok(!bytes.includes(0), `src/${f} contains a raw NUL byte`);
    assert.ok(!/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(bytes.toString('latin1')), `src/${f} contains a raw control byte`);
  }
  for (const f of ['markdown.js', 'inline.js']) {
    assert.ok((await readFile(new URL(`lib/${f}`, src), 'utf8')).includes('\\u0000'), `${f} spells the NUL as an escape`);
  }
});

// ---- denial of service: the renderer will see external text (news) ------
const fast = (label, md, opts, budgetMs = 200) => {
  const t0 = performance.now();
  let html;
  assert.doesNotThrow(() => { html = renderMarkdown(md, opts); }, label);
  const ms = performance.now() - t0;
  assert.ok(ms < budgetMs, `${label} took ${ms.toFixed(0)} ms`);
  return html;
};

test('heading regex is linear: long runs of spaces or hashes render instantly', () => {
  assert.equal(fast('spaces', '# a' + ' '.repeat(20000) + 'x'), '<h2>a</h2>'); // line cap trims the tail
  fast('hashes 20k', '# a ' + '#'.repeat(20000) + 'x');
  fast('hashes 100k', '# a ' + '#'.repeat(100000) + 'x');
  assert.equal(fast('hashes short', '# a ' + '#'.repeat(30) + 'x'), `<h2>a ${'#'.repeat(30)}x</h2>`);
  fast('hr spaces', '-' + ' '.repeat(100000) + 'x');
  fast('table sep spaces', 'a|b\n' + ' '.repeat(4000) + '|' + ' '.repeat(4000) + '-x');
  fast('token spaces', '{{' + ' '.repeat(100000) + 'a'.repeat(100000), { tokens: {} });
  fast('unclosed strong', '**' + ' a'.repeat(100000));
  fast('unclosed link', '[' + 'a'.repeat(200000));
});

test('list and blockquote nesting is capped instead of overflowing the stack', () => {
  fast('nested list 5000', '- '.repeat(5000) + 'x');
  fast('nested quote 5000', '>'.repeat(5000) + ' x');
  fast('indented list 2000', Array.from({ length: 2000 }, (_, i) => ' '.repeat(i * 2) + '- x').join('\n'));
  const ul = renderMarkdown('- '.repeat(12) + 'x');
  assert.equal((ul.match(/<ul>/g) || []).length, LIMITS.depth + 1, 'top level + LIMITS.depth nested lists');
  assert.ok(ul.includes('<li>- - - x</li>'), 'deeper content is kept as text');
  const bq = renderMarkdown('>'.repeat(12) + ' x');
  assert.equal((bq.match(/<blockquote>/g) || []).length, LIMITS.depth + 1);
  assert.ok(bq.includes('<p>&gt;&gt;&gt; x</p>'));
  // the cap does not touch ordinary nesting
  assert.ok(renderMarkdown('- a\n  - b\n    - c').includes('<li>c</li>'));
});

test('input and line caps: oversized bodies are truncated, never rejected', () => {
  const big = fast('2 MB body', 'x'.repeat(2 * 1024 * 1024));
  assert.equal(big.length, LIMITS.line + '<p></p>'.length);
  // honest work on a 256 KB body (not a regex pathology): a looser budget, still bounded
  const many = fast('80k items', '- x\n'.repeat(80000), undefined, 1500);
  assert.equal((many.match(/<li>/g) || []).length, 256 * 1024 / 4);
  const lines = renderMarkdown('a'.repeat(LIMITS.line + 5) + '\nb');
  assert.equal(lines, `<p>${'a'.repeat(LIMITS.line)}<br>b</p>`);
  assert.equal(renderMarkdown('a'.repeat(LIMITS.line)), `<p>${'a'.repeat(LIMITS.line)}</p>`);
});

test('heading edge cases: closing hashes, empty, tab, seven hashes', () => {
  assert.equal(renderMarkdown('# a ##'), '<h2>a</h2>');
  assert.equal(renderMarkdown('# a#'), '<h2>a#</h2>');
  assert.equal(renderMarkdown('#'), '<p>#</p>');
  assert.equal(renderMarkdown('## ###'), '<h2></h2>');
  assert.equal(renderMarkdown('#######x'), '<p>#######x</p>');
  assert.equal(renderMarkdown('#\tt'), '<h2>t</h2>');
  assert.equal(renderMarkdown('# a b'), '<h2>a b</h2>');
});

test('Persian body renders with RTL text intact', () => {
  const html = renderMarkdown('## خدمات ما\n\n- طراحی **وب‌سایت**\n- اپلیکیشن');
  assert.ok(html.includes('<h2>خدمات ما</h2>'));
  assert.ok(html.includes('<li>طراحی <strong>وب‌سایت</strong></li>'));
});
