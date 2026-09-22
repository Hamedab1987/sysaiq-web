// lib/trust.js — snippet parsing, host pinning, canonical badge markup, head-meta allowlist.
// Pure unit tests: no app, no db.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSnippet, renderBadge, trustUrl, httpsUrl, validateHeadMeta, renderHeadMeta,
  TRUST_HOSTS, HEAD_META_NAMES,
} from '../../src/lib/trust.js';
import { HttpError } from '../../src/lib/errors.js';

// the shapes the authorities hand out (ids/codes are placeholders)
const ENAMAD = `<a referrerpolicy='origin' target='_blank' href='https://trustseal.enamad.ir/?id=123456&Code=Ab9XyZ12Qw34'><img referrerpolicy='origin' src='https://trustseal.enamad.ir/logo.aspx?id=123456&Code=Ab9XyZ12Qw34' alt='' style='cursor:pointer' code='Ab9XyZ12Qw34'></a>`;
const SAMANDEHI = `<img referrerpolicy='origin' id='jzpeoeukjzpesizpjxlzsizp' style='cursor:pointer' onclick='window.open("https://logo.samandehi.ir/Verify.aspx?id=345678&p=xlaoaodsxlaoaods", "Popup","toolbar=no, scrollbars=no, location=no, statusbar=no, menubar=no, resizable=0, width=450, height=630, top=30")' alt='logo-samandehi' src='https://logo.samandehi.ir/logo.aspx?id=345678&p=aqgwrfthaqgwrfth'/>`;

const rejects = (kind, snippet, re) => {
  assert.throws(() => parseSnippet(kind, snippet), e => e instanceof HttpError && e.status === 422 && (re ? re.test(JSON.stringify(e.fields)) : true), `${kind}: ${String(snippet).slice(0, 60)}`);
};

test('parseSnippet: a real-shaped eNamad snippet → id/code + rebuilt URLs (nothing from the snippet is kept)', () => {
  const p = parseSnippet('enamad', ENAMAD);
  assert.deepEqual(p, {
    kind: 'enamad', seal_id: '123456', seal_code: 'Ab9XyZ12Qw34',
    link_url: 'https://trustseal.enamad.ir/?id=123456&Code=Ab9XyZ12Qw34',
    img_url: 'https://trustseal.enamad.ir/logo.aspx?id=123456&Code=Ab9XyZ12Qw34',
  });
  // copied from page source: &amp; and lowercase code=
  const p2 = parseSnippet('enamad', 'href="https://trustseal.enamad.ir/?id=7&amp;code=abcd1234"');
  assert.equal(p2.seal_id, '7');
  assert.equal(p2.seal_code, 'abcd1234');
  assert.equal(p2.link_url, 'https://trustseal.enamad.ir/?id=7&Code=abcd1234');
});

test('parseSnippet: samandehi keeps the Verify code for the link and the logo code for the image; onclick never survives', () => {
  const p = parseSnippet('samandehi', SAMANDEHI);
  assert.equal(p.kind, 'samandehi');
  assert.equal(p.seal_id, '345678');
  assert.equal(p.seal_code, 'xlaoaodsxlaoaods');
  assert.equal(p.link_url, 'https://logo.samandehi.ir/Verify.aspx?id=345678&p=xlaoaodsxlaoaods');
  assert.equal(p.img_url, 'https://logo.samandehi.ir/logo.aspx?id=345678&p=aqgwrfthaqgwrfth');
  assert.ok(!JSON.stringify(p).includes('onclick'));
  // verify id ≠ logo id is refused (a hand-edited snippet)
  rejects('samandehi', SAMANDEHI.replace('logo.aspx?id=345678', 'logo.aspx?id=999'), /شناسه/);
});

test('parseSnippet: look-alike hosts, userinfo, host-in-query, javascript: and garbage are all 422 with a Persian message', () => {
  const bad = [
    ['enamad', `<a href="https://trustseal.enamad.ir.evil.com/?id=1&Code=abcd"></a>`],
    ['enamad', `<a href="https://evil.com/?u=https://trustseal.enamad.ir/?id=1&Code=abcd"></a>`], // host in query
    ['enamad', `<a href="https://user:pw@trustseal.enamad.ir/?id=1&Code=abcd"></a>`],
    ['enamad', `<a href="http://trustseal.enamad.ir/?id=1&Code=abcd"></a>`],
    ['enamad', `<a href="javascript:alert(1)//trustseal.enamad.ir/?id=1&Code=abcd"></a>`],
    ['enamad', `<a href="https://trustseal.enamad.ir/?id=1&Code=abc"></a>`], // code too short
    ['enamad', `<a href="https://trustseal.enamad.ir/?id=12345678901&Code=abcd"></a>`], // id too long
    ['enamad', ''],
    ['enamad', 'x'.repeat(9000)],
    ['enamad', SAMANDEHI],
    ['samandehi', ENAMAD],
    ['samandehi', `onclick='window.open("https://logo.samandehi.ir.evil.io/Verify.aspx?id=1&p=abcd")'`],
    ['samandehi', `src='https://logo.samandehi.ir/other.aspx?id=1&p=abcd'`],
    ['custom_image', { img_url: 'https://evil.com/x.png', link_url: 'https://ok.example/' }],
    ['custom_image', { img_url: '/uploads/../admin/x.png', link_url: 'https://ok.example/' }],
    ['custom_image', { img_url: '/uploads/x.png', link_url: 'http://ok.example/' }],
    ['custom_image', { img_url: '/uploads/x.png', link_url: 'javascript:alert(1)' }],
    ['custom_image', { img_url: '/uploads/x.png', link_url: 'https://a:b@ok.example/' }],
    ['nope', ENAMAD],
  ];
  for (const [kind, snippet] of bad) rejects(kind, snippet);
  // the messages are Persian
  try { parseSnippet('enamad', 'nothing here'); } catch (e) { assert.match(e.fields.snippet, /[؀-ۿ]/); }
  // host-in-query: the trust URL must start an attribute value, not sit inside another URL
  rejects('enamad', `https://evil.com/?next=https://trustseal.enamad.ir/?id=1&Code=abcd1234`);
  rejects('samandehi', `<a href="https://evil.com/r?u=https://logo.samandehi.ir/Verify.aspx?id=1&p=abcd1234">`);
  // whereas the bare URL, a quoted attribute and a window.open("…") all count
  for (const s of ['https://trustseal.enamad.ir/?id=1&Code=abcd1234', ` href="https://trustseal.enamad.ir/?id=1&Code=abcd1234"`, `x('https://trustseal.enamad.ir/?id=1&Code=abcd1234')`]) {
    assert.equal(parseSnippet('enamad', s).seal_id, '1', s);
  }
});

test('trustUrl/httpsUrl pin scheme + exact host and refuse userinfo and ports', () => {
  assert.equal(trustUrl('https://trustseal.enamad.ir/?id=1&Code=abcd', 'trustseal.enamad.ir'), 'https://trustseal.enamad.ir/?id=1&Code=abcd');
  for (const u of ['http://trustseal.enamad.ir/', 'https://trustseal.enamad.ir:8443/', 'https://a@trustseal.enamad.ir/', 'https://trustseal.enamad.ir.x.com/', 'https://xtrustseal.enamad.ir/', 'javascript:1', 'not a url', '']) {
    assert.equal(trustUrl(u, 'trustseal.enamad.ir'), null, u);
  }
  assert.equal(httpsUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  for (const u of ['http://example.com/', 'https://user@example.com/', 'https://localhost/', 'javascript:x', '//example.com/']) assert.equal(httpsUrl(u), null, u);
  assert.deepEqual([...TRUST_HOSTS], ['trustseal.enamad.ir', 'logo.samandehi.ir', 'ecunion.ir']);
});

test('renderBadge: canonical eNamad markup carries referrerpolicy, rel, code and lazy loading; samandehi onclick becomes the href', () => {
  const row = { id: 1, ...parseSnippet('enamad', ENAMAD), width: 120, height: 140, label_fa: 'اینماد', label_en: 'eNamad', enabled: 1 };
  const html = renderBadge(row, 'fa');
  assert.equal(html,
    `<a class="badge badge-enamad" referrerpolicy="origin" target="_blank" rel="noopener" href="https://trustseal.enamad.ir/?id=123456&amp;Code=Ab9XyZ12Qw34">` +
    `<img referrerpolicy="origin" src="https://trustseal.enamad.ir/logo.aspx?id=123456&amp;Code=Ab9XyZ12Qw34" alt="اینماد" width="120" height="140" loading="lazy" code="Ab9XyZ12Qw34"></a>`);
  assert.ok(!html.includes('onclick') && !html.includes('<script'));

  const s = renderBadge({ ...parseSnippet('samandehi', SAMANDEHI), width: 0, height: 0 }, 'en');
  assert.ok(s.startsWith('<a class="badge badge-samandehi" referrerpolicy="origin" target="_blank" rel="noopener" href="https://logo.samandehi.ir/Verify.aspx?id=345678&amp;p=xlaoaodsxlaoaods">'));
  assert.ok(s.includes('src="https://logo.samandehi.ir/logo.aspx?id=345678&amp;p=aqgwrfthaqgwrfth"'));
  assert.ok(!s.includes('width='), 'zero dims are omitted');
  assert.ok(!s.includes('onclick'));

  // a tampered row fails closed
  assert.equal(renderBadge({ ...row, seal_code: 'x"><script>' }), '');
  assert.equal(renderBadge({ ...row, seal_id: 'abc' }), '');
  assert.equal(renderBadge({ kind: 'samandehi', link_url: 'https://evil.com/Verify.aspx?id=1&p=abcd', img_url: 'https://logo.samandehi.ir/logo.aspx?id=1&p=abcd' }), '');
  assert.equal(renderBadge({ kind: 'custom_image', link_url: 'https://ok.example/', img_url: 'https://cdn.example/x.png' }), '');
  assert.equal(renderBadge({ kind: 'weird' }), '');
  const c = renderBadge({ kind: 'custom_image', link_url: 'https://ok.example/', img_url: '/uploads/seal.png', label_en: 'Seal "1"' }, 'en');
  assert.ok(c.includes('rel="noopener noreferrer"') && c.includes('alt="Seal &quot;1&quot;"') && c.includes('src="/uploads/seal.png"'));
});

test('head meta: names come from the allowlist, content from the character class', () => {
  assert.deepEqual([...HEAD_META_NAMES], ['enamad', 'samandehi', 'google-site-verification', 'msvalidate.01', 'yandex-verification', 'facebook-domain-verification', 'p:domain_verify']);
  assert.deepEqual(validateHeadMeta({ name: ' enamad ', content: ' 12345678 ' }), { name: 'enamad', content: '12345678' });
  assert.deepEqual(validateHeadMeta({ name: 'google-site-verification', content: 'abc_DEF-123=+/.:' }), { name: 'google-site-verification', content: 'abc_DEF-123=+/.:' });
  for (const body of [
    { name: 'viewport', content: 'x' }, { name: 'refresh', content: '0;url=https://evil' }, { name: 'ENAMAD', content: 'x' },
    { name: 'enamad', content: '' }, { name: 'enamad', content: 'a"><script>' }, { name: 'enamad', content: 'x'.repeat(201) },
    { name: 'enamad', content: 'اینماد' }, {}, null,
  ]) {
    assert.throws(() => validateHeadMeta(body), e => e instanceof HttpError && e.status === 422, JSON.stringify(body));
  }
  const html = renderHeadMeta([
    { name: 'enamad', content: '12345678', enabled: 1 },
    { name: 'google-site-verification', content: 'abc', enabled: 0 },
    { name: 'refresh', content: '0', enabled: 1 },
    { name: 'msvalidate.01', content: 'x"><script>', enabled: 1 },
  ]);
  assert.equal(html, '<meta name="enamad" content="12345678">');
});
