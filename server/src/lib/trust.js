// Trust seals (eNamad, samandehi, a custom image) and verification meta tags.
// The owner pastes the snippet the authority gave them; parseSnippet() keeps
// only the seal id + code and rebuilds the canonical markup in renderBadge()
// from those fields — the pasted HTML (and its onclick=) is never stored or
// echoed. Every URL that reaches the page is rebuilt through new URL() and
// pinned to https + an exact TRUST_HOSTS host with no userinfo or port.
import { HttpError } from './errors.js';
import { esc, attr } from './html.js';
import { registerCspSource } from './registry.js';

export const TRUST_HOSTS = Object.freeze(['trustseal.enamad.ir', 'logo.samandehi.ir', 'ecunion.ir']);
export const BADGE_KINDS = Object.freeze(['enamad', 'samandehi', 'custom_image']);
export const PLACEMENTS = Object.freeze(['footer', 'contact', 'both']);

const ENAMAD_HOST = 'trustseal.enamad.ir';
const SAMANDEHI_HOST = 'logo.samandehi.ir';
// exactly the shapes the authorities hand out; `&amp;` is what a pasted
// snippet copied from a page source looks like. The lookbehind requires the
// URL to START an attribute value (quote, paren, space…): a trust-host URL
// buried in another URL's query (?next=https://trustseal…) does not count.
const URL_START = '(?<![A-Za-z0-9=/?&.:_%-])';
const ENAMAD_RE = new RegExp(`${URL_START}https:\\/\\/trustseal\\.enamad\\.ir\\/\\?id=(\\d{1,10})&(?:amp;)?[Cc]ode=([A-Za-z0-9]{4,64})`, 'g');
const SAMANDEHI_RE = new RegExp(`${URL_START}https:\\/\\/logo\\.samandehi\\.ir\\/(Verify|logo)\\.aspx\\?id=(\\d{1,10})&(?:amp;)?p=([A-Za-z0-9]{4,64})`, 'g');
const UPLOAD_RE = /^\/uploads\/[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/;
const MAX_SNIPPET = 8000;

const fail = (fieldMsg, field = 'snippet') => new HttpError(422, 'validation', 'Validation failed', { [field]: fieldMsg });

// img-src already allows https:, so this is belt and braces for the day the
// page policy is narrowed. Registered on first use (not at import) because the
// Foundation CSP tests assert the bare page policy — the registry is a Set,
// so calling it on every render costs nothing.
let cspDone = false;
export function ensureTrustCsp() {
  if (cspDone) return;
  cspDone = true;
  for (const h of TRUST_HOSTS) registerCspSource('img-src', `https://${h}`);
}

// https + exact host + no credentials/port; returns the normalised href
export function trustUrl(raw, host) {
  let u;
  try { u = new URL(String(raw ?? '')); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== host || u.username || u.password || u.port) return null;
  return u.href;
}
// any https URL for a custom badge's link (no credentials, no port games)
export function httpsUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? '')); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || !u.hostname.includes('.')) return null;
  if (u.href.length > 2048) return null;
  return u.href;
}

const enamadLink = (id, code) => `https://${ENAMAD_HOST}/?id=${id}&Code=${code}`;
const enamadImg = (id, code) => `https://${ENAMAD_HOST}/logo.aspx?id=${id}&Code=${code}`;
const samandehiLink = (id, p) => `https://${SAMANDEHI_HOST}/Verify.aspx?id=${id}&p=${p}`;
const samandehiImg = (id, p) => `https://${SAMANDEHI_HOST}/logo.aspx?id=${id}&p=${p}`;

function parseEnamad(snippet) {
  const m = [...snippet.matchAll(ENAMAD_RE)];
  if (!m.length) throw fail('لینک اینماد در این کد پیدا نشد. کد را دقیقاً از پنل اینماد کپی کنید (باید حاوی trustseal.enamad.ir/?id=…&Code=… باشد).');
  const [, id, code] = m[0];
  return { kind: 'enamad', seal_id: id, seal_code: code, link_url: enamadLink(id, code), img_url: enamadImg(id, code) };
}

function parseSamandehi(snippet) {
  const m = [...snippet.matchAll(SAMANDEHI_RE)];
  if (!m.length) throw fail('لینک ساماندهی در این کد پیدا نشد. کد را دقیقاً از پنل ساماندهی کپی کنید (باید حاوی logo.samandehi.ir/…aspx?id=…&p=… باشد).');
  // the verify link (from onclick) and the logo image carry different p codes
  const verify = m.find(x => x[1] === 'Verify') || m[0];
  const logo = m.find(x => x[1] === 'logo') || m[0];
  if (verify[2] !== logo[2]) throw fail('شناسهٔ لینک تأیید و تصویر ساماندهی با هم فرق دارند؛ کد را دوباره از پنل ساماندهی کپی کنید.');
  const id = verify[2];
  return { kind: 'samandehi', seal_id: id, seal_code: verify[3], link_url: samandehiLink(id, verify[3]), img_url: samandehiImg(id, logo[3]) };
}

function parseCustom(input) {
  let img = '', link = '';
  if (input && typeof input === 'object') {
    img = String(input.img_url ?? '').trim();
    link = String(input.link_url ?? '').trim();
  } else {
    const s = String(input ?? '');
    img = (/\bsrc=["']([^"']+)["']/i.exec(s) || [])[1] || '';
    link = (/\bhref=["']([^"']+)["']/i.exec(s) || [])[1] || '';
  }
  if (!UPLOAD_RE.test(img)) throw fail('تصویر نماد باید از بخش رسانه‌ها آپلود شده باشد (نشانی /uploads/…).', 'img_url');
  const href = httpsUrl(link);
  if (!href) throw fail('لینک نماد باید یک نشانی کامل https باشد.', 'link_url');
  return { kind: 'custom_image', seal_id: '', seal_code: '', link_url: href, img_url: img };
}

// → {kind, seal_id, seal_code, link_url, img_url}; throws HttpError 422
// (Persian message) on anything it does not recognise
export function parseSnippet(kind, snippet) {
  if (!BADGE_KINDS.includes(kind)) throw fail('نوع نماد نامعتبر است.', 'kind');
  if (kind === 'custom_image') return parseCustom(snippet);
  const s = String(snippet ?? '').trim();
  if (!s) throw fail('کد نماد را وارد کنید.');
  if (s.length > MAX_SNIPPET) throw fail('کد نماد بیش از حد طولانی است.');
  const out = kind === 'enamad' ? parseEnamad(s) : parseSamandehi(s);
  // the regexes are host-anchored, but rebuild through URL anyway so the
  // stored values are exactly what will be rendered
  const host = kind === 'enamad' ? ENAMAD_HOST : SAMANDEHI_HOST;
  out.link_url = trustUrl(out.link_url, host);
  out.img_url = trustUrl(out.img_url, host);
  if (!out.link_url || !out.img_url) throw fail('نشانی نماد معتبر نیست.');
  return out;
}

const dims = row => {
  const w = Number(row.width) | 0, h = Number(row.height) | 0;
  return (w > 0 && w <= 2000 ? ` width="${w}"` : '') + (h > 0 && h <= 2000 ? ` height="${h}"` : '');
};

// Canonical markup from the parsed fields only. Returns '' for a row whose
// fields no longer validate (a tampered db row must fail closed, not render).
export function renderBadge(row, lang = 'fa') {
  if (!row || !BADGE_KINDS.includes(row.kind)) return '';
  ensureTrustCsp();
  const fa = lang === 'fa';
  const label = String((fa ? row.label_fa : row.label_en) || (fa ? row.label_en : row.label_fa) || '');
  if (row.kind === 'enamad') {
    const id = /^\d{1,10}$/.test(String(row.seal_id)) ? String(row.seal_id) : null;
    const code = /^[A-Za-z0-9]{4,64}$/.test(String(row.seal_code)) ? String(row.seal_code) : null;
    if (!id || !code) return '';
    const href = trustUrl(enamadLink(id, code), ENAMAD_HOST);
    const src = trustUrl(enamadImg(id, code), ENAMAD_HOST);
    if (!href || !src) return '';
    return `<a class="badge badge-enamad" referrerpolicy="origin" target="_blank" rel="noopener" href="${attr(href)}">` +
      `<img referrerpolicy="origin" src="${attr(src)}" alt="${attr(label || 'اینماد')}"${dims(row)} loading="lazy" code="${attr(code)}"></a>`;
  }
  if (row.kind === 'samandehi') {
    const href = trustUrl(row.link_url, SAMANDEHI_HOST);
    const src = trustUrl(row.img_url, SAMANDEHI_HOST);
    if (!href || !src || !/\/Verify\.aspx\?id=\d{1,10}&p=[A-Za-z0-9]{4,64}$/.test(href) || !/\/logo\.aspx\?id=\d{1,10}&p=[A-Za-z0-9]{4,64}$/.test(src)) return '';
    // the authority's snippet opens the verify page from onclick; a plain link does the same without script
    return `<a class="badge badge-samandehi" referrerpolicy="origin" target="_blank" rel="noopener" href="${attr(href)}">` +
      `<img referrerpolicy="origin" src="${attr(src)}" alt="${attr(label || 'نشان ساماندهی')}"${dims(row)} loading="lazy"></a>`;
  }
  const href = httpsUrl(row.link_url);
  if (!href || !UPLOAD_RE.test(String(row.img_url))) return '';
  return `<a class="badge badge-custom" target="_blank" rel="noopener noreferrer" href="${attr(href)}">` +
    `<img src="${attr(row.img_url)}" alt="${attr(label)}"${dims(row)} loading="lazy"></a>`;
}

// ---- verification meta tags ----------------------------------------------
export const HEAD_META_NAMES = Object.freeze([
  'enamad', 'samandehi', 'google-site-verification', 'msvalidate.01',
  'yandex-verification', 'facebook-domain-verification', 'p:domain_verify',
]);
export const HEAD_META_CONTENT_RE = /^[A-Za-z0-9_\-=.:+\/ ]{1,200}$/;

// → {name, content}; throws HttpError 422 with a Persian message
export function validateHeadMeta(body) {
  const b = body && typeof body === 'object' ? body : {};
  const name = String(b.name ?? '').trim();
  const content = String(b.content ?? '').trim();
  const fields = {};
  if (!HEAD_META_NAMES.includes(name)) fields.name = `نام تگ باید یکی از این‌ها باشد: ${HEAD_META_NAMES.join('، ')}`;
  if (!HEAD_META_CONTENT_RE.test(content)) fields.content = 'مقدار تگ فقط می‌تواند حروف لاتین، ارقام و نویسه‌های _ - = . : + / باشد (حداکثر ۲۰۰ نویسه).';
  if (Object.keys(fields).length) throw new HttpError(422, 'validation', 'Validation failed', fields);
  return { name, content };
}

// enabled rows → "<meta name content>" lines; a row that fails the allowlist is skipped
export function renderHeadMeta(rows) {
  const out = [];
  for (const r of rows || []) {
    if (r.enabled !== undefined && !r.enabled) continue;
    const name = String(r.name ?? ''), content = String(r.content ?? '');
    if (!HEAD_META_NAMES.includes(name) || !HEAD_META_CONTENT_RE.test(content)) continue;
    out.push(`<meta name="${attr(name)}" content="${attr(content)}">`);
  }
  return out.join('\n');
}

export const badgeLabel = (row, lang) => esc(lang === 'fa' ? (row.label_fa || row.label_en) : (row.label_en || row.label_fa));
