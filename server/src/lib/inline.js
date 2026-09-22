// Escape-first mini-markup for short copy (hero notes, taglines, card text).
//   renderInline('Line one\n**bold** and *em* — [site](/fa/services)')
// The whole input is HTML-escaped before any pattern runs, and every tag in
// the output is generated here — raw HTML from the admin can never pass
// through. Supported: \n→<br>, **strong**, *em*, `code`, [text](url) and
// backslash escapes (\* \_ \[ …). URLs are validated by safeHref().
import { esc } from './html.js';

// Placeholders keep generated tags (and code-span contents) out of reach of
// later regexes. NUL is stripped from the input first so it can't collide.
const PH = '\u0000';
export const stash = (store, html) => { store.push(html); return `${PH}${store.length - 1}${PH}`; };
export function unstash(store, s) {
  // stashed items can contain earlier placeholders (a link around a code span)
  for (let n = 0; n < 20 && s.includes(PH); n++) {
    s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => store[Number(i)] ?? '');
  }
  return s;
}

// Markdown punctuation that may be escaped with a backslash. These are all
// untouched by HTML escaping, so protecting them after esc() is safe.
const ESCAPABLE = /\\([\\`*_{}[\]()#+\-.!|])/g;
export const protectEscapes = (s, store) => s.replace(ESCAPABLE, (_, c) => stash(store, c));

// Characters browsers ignore inside a URL (so "java\tscript:" is a scheme)
// plus zero-width/bidi marks that only serve to disguise one.
const URL_JUNK = /[\u0000-\u0020\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\ufeff]/g;

// Validate a link target. Returns {href, external} or null.
// Accepts the entity-escaped form produced by the escape-first pipeline (the
// scheme prefix is identical either way; anything that starts with an entity
// is rejected because it starts with '&'). Callers passing a raw URL must
// attr()-escape the returned href themselves.
export function safeHref(raw) {
  if (typeof raw !== 'string') return null;
  // No real URL carries NUL or angle brackets. In the escape-first pipeline
  // a NUL is a stash placeholder and '<' is a tag we generated (a code span
  // written inside the link target) — either way it is not a link.
  if (/[\u0000<>]/.test(raw)) return null;
  const href = raw.replace(URL_JUNK, '');
  if (!href || href.length > 2048) return null;
  const lower = href.toLowerCase();
  if (/^https?:\/\/[^/?#\\]/.test(lower)) return { href, external: true };
  if (/^(?:mailto|tel):./.test(lower)) return { href, external: false };
  // site-relative only: "//host" is protocol-relative and "/\host" resolves the same way
  if (/^\/(?![/\\])/.test(href)) return { href, external: false };
  if (/^#./.test(href)) return { href, external: false };
  return null;
}

function linkTag(h, innerHtml) {
  const rel = h.external ? ' rel="noopener noreferrer" target="_blank"' : '';
  return `<a href="${h.href}"${rel}>${innerHtml}</a>`;
}

function emStrong(s) {
  return s
    .replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*([^\n]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+?)\*/g, '<em>$1</em>');
}

// Inline pass over text that is ALREADY escaped (and escape-protected).
export function inlineFromEscaped(s, store, { links = true, br = true } = {}) {
  // code spans first: their contents are literal
  s = s.replace(/`([^`\n]+)`/g, (_, code) => stash(store, `<code>${code}</code>`));
  if (links) {
    s = s.replace(/\[([^[\]\n]+)\]\(([^()\n ]*)\)/g, (_, text, url) => {
      // a backslash-escaped char inside the URL is a placeholder by now:
      // restore it BEFORE validation so "\*" is a literal "*" and the
      // placeholder index never leaks into the href
      const h = safeHref(unstash(store, url));
      // a rejected URL keeps its text and drops the link, never the raw markup
      return h ? stash(store, linkTag(h, emStrong(text))) : text;
    });
  }
  s = emStrong(s);
  if (br) s = s.replace(/\n/g, '<br>');
  return s;
}

export function renderInline(text, opts = {}) {
  const store = [];
  let s = esc(String(text ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, ''));
  s = protectEscapes(s, store);
  s = inlineFromEscaped(s, store, opts);
  return unstash(store, s);
}
