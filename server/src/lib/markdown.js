// Escape-first Markdown subset for long bodies (pages, services, sections).
//   renderMarkdown(md, { tokens: { 'site.mobile': '0912…' } })
// Subset: h2–h4 (# and ## both give h2 — the page owns its h1), paragraphs,
// ul/ol (nested by indentation), blockquote, hr, tables, strong/em/code,
// links (see lib/inline.js safeHref) and {{fact.tokens}}. The source is
// HTML-escaped as the very first step; every tag below is ours.
// Untrusted input (the M4 news pipeline) must not be able to pin the
// process: every regex here is linear in the line length, the input and
// each line are capped, and nesting stops at LIMITS.depth.
import { esc } from './html.js';
import { inlineFromEscaped, protectEscapes, unstash } from './inline.js';

const TOKEN = /\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Hard caps (characters / levels). Longer input is truncated, deeper
// list/quote nesting is rendered as plain paragraph text. Exported so
// validators can refuse upstream instead of silently losing content.
export const LIMITS = Object.freeze({ input: 256 * 1024, line: 8 * 1024, depth: 8 });

export function renderMarkdown(md, { tokens = null } = {}) {
  let s = String(md ?? '').replace(/\r\n?/g, '\n').replace(/\u0000/g, '');
  if (s.length > LIMITS.input) s = s.slice(0, LIMITS.input);
  if (s.length > LIMITS.line) s = s.split('\n').map(l => (l.length > LIMITS.line ? l.slice(0, LIMITS.line) : l)).join('\n');
  s = esc(s);
  if (tokens && typeof tokens === 'object') {
    // unknown tokens stay visible so the owner notices a typo
    s = s.replace(TOKEN, (m, k) => (hasOwn(tokens, k) ? esc(String(tokens[k] ?? '')) : m));
  }
  const store = [];
  s = protectEscapes(s, store);
  return unstash(store, renderBlocks(s.split('\n'), store, 0));
}

// ---- block level ----------------------------------------------------------
// Lines never contain '\n', so `(.*)` with the s flag always runs to the end
// and `$` can't force a backtrack; trailing whitespace and the optional
// closing '#' run are stripped in JS (headingText) — a `\s*#*\s*$` tail
// backtracks catastrophically on long runs of spaces or hashes.
const RE = {
  heading: /^ {0,3}(#{1,6})[ \t]+(.*)$/s,
  hr: /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/,
  quote: /^ {0,3}&gt; ?/,               // '>' is already escaped
  item: /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/s,
  sep: /^\s*(?:\|\s*)?:?-+:?\s*(?:\|\s*:?-+:?\s*)*(?:\|\s*)?$/,
};
const startsBlock = l => RE.heading.test(l) || RE.hr.test(l) || RE.quote.test(l) || RE.item.test(l);

// "foo ##" → "foo"; "foo#" keeps its hash (CommonMark: a closing run must
// follow a space); "###" alone is an empty heading.
function headingText(raw) {
  const t = raw.trimEnd();
  let end = t.length;
  while (end > 0 && t[end - 1] === '#') end--;
  if (end === t.length) return t;
  if (end === 0) return '';
  if (t[end - 1] !== ' ' && t[end - 1] !== '\t') return t;
  return t.slice(0, end).trimEnd();
}

function renderBlocks(lines, store, depth) {
  const inline = t => inlineFromEscaped(t, store);
  if (depth > LIMITS.depth) return paragraphsOnly(lines, inline);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    let m;
    if ((m = RE.heading.exec(line))) {
      const lvl = Math.min(Math.max(m[1].length, 2), 4);
      out.push(`<h${lvl}>${inline(headingText(m[2]))}</h${lvl}>`);
      i++; continue;
    }
    if (RE.hr.test(line)) { out.push('<hr>'); i++; continue; }
    if (RE.quote.test(line)) {
      const buf = [];
      while (i < lines.length && RE.quote.test(lines[i])) buf.push(lines[i++].replace(RE.quote, ''));
      out.push(`<blockquote>\n${renderBlocks(buf, store, depth + 1)}\n</blockquote>`);
      continue;
    }
    if ((m = RE.item.exec(line))) {
      const r = parseList(lines, i, m[1].length, /\d/.test(m[2]), store, depth);
      out.push(r.html); i = r.next;
      continue;
    }
    if (isTableStart(lines, i)) {
      const r = parseTable(lines, i, store);
      out.push(r.html); i = r.next;
      continue;
    }
    // paragraph: consecutive non-blank lines that don't open another block
    const buf = [line.trim()];
    i++;
    while (i < lines.length && lines[i].trim() && !startsBlock(lines[i]) && !isTableStart(lines, i)) buf.push(lines[i++].trim());
    out.push(`<p>${inline(buf.join('\n'))}</p>`);
  }
  return out.join('\n');
}

// past LIMITS.depth: no more block parsing, just paragraphs split on blank lines
function paragraphsOnly(lines, inline) {
  const out = [];
  let buf = [];
  const flush = () => { if (buf.length) out.push(`<p>${inline(buf.join('\n'))}</p>`); buf = []; };
  for (const l of lines) (l.trim() ? buf.push(l.trim()) : flush());
  flush();
  return out.join('\n');
}

const isTableStart = (lines, i) =>
  lines[i].includes('|') && i + 1 < lines.length && lines[i + 1].includes('|') && RE.sep.test(lines[i + 1]);

function parseList(lines, i, indent, ordered, store, depth) {
  const items = [];
  let start = null;
  while (i < lines.length) {
    const l = lines[i];
    const m = RE.item.exec(l);
    if (m && m[1].length === indent && /\d/.test(m[2]) === ordered) {
      if (start === null && ordered) start = parseInt(m[2], 10);
      items.push({ width: m[2].length + 1, lines: [m[3]] });
      i++; continue;
    }
    if (!items.length) break;
    const cur = items[items.length - 1];
    if (!l.trim()) {
      // a blank line only continues the list if more indented content follows
      const nx = lines[i + 1];
      if (nx !== undefined && leading(nx) > indent) { cur.lines.push(''); i++; continue; }
      break;
    }
    if (leading(l) > indent) { cur.lines.push(l.slice(Math.min(leading(l), indent + cur.width))); i++; continue; }
    break;
  }
  const li = items.map(it => {
    let html = renderBlocks(it.lines, store, depth + 1);
    // tight list (no blank line inside the item): the leading paragraph is unwrapped
    if (!it.lines.some(l => !l.trim())) html = html.replace(/^<p>([^]*?)<\/p>/, '$1');
    return `<li>${html}</li>`;
  }).join('\n');
  const tag = ordered ? 'ol' : 'ul';
  const attrs = ordered && start !== null && start !== 1 ? ` start="${start}"` : '';
  return { html: `<${tag}${attrs}>\n${li}\n</${tag}>`, next: i };
}
const leading = l => l.length - l.trimStart().length;

function splitRow(l) {
  let t = l.trim();
  if (t.startsWith('|')) t = t.slice(1);
  if (t.endsWith('|')) t = t.slice(0, -1);
  return t.split('|').map(c => c.trim());
}
function parseTable(lines, i, store) {
  const inline = t => inlineFromEscaped(t, store);
  const head = splitRow(lines[i]);
  const aligns = splitRow(lines[i + 1]).map(c => {
    const l = c.startsWith(':'), r = c.endsWith(':');
    return l && r ? 'center' : r ? 'end' : l ? 'start' : '';
  });
  const cls = n => (aligns[n] ? ` class="ta-${aligns[n]}"` : '');
  const cells = (row, tag) => head.map((_, n) => `<${tag}${cls(n)}>${inline(row[n] ?? '')}</${tag}>`).join('');
  let html = `<table>\n<thead><tr>${cells(head, 'th')}</tr></thead>\n<tbody>`;
  i += 2;
  while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
    html += `\n<tr>${cells(splitRow(lines[i]), 'td')}</tr>`;
    i++;
  }
  html += '\n</tbody>\n</table>';
  return { html, next: i };
}
