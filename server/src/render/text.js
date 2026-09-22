// Plain text out of rendered HTML — for JSON-LD, meta descriptions and
// heading ids, where markup (and markdown syntax) must not leak through.
// Always go through renderMarkdown first: it is the only path from admin
// text to HTML, so markdownToText inherits its link/script rules for free.
import { renderMarkdown } from '../lib/markdown.js';

// block boundaries become a space so "para one</p><p>para two" stays readable
const BLOCK_END = /<\/(?:p|li|h[1-6]|blockquote|tr|td|th|div|ul|ol|table)>|<br\s*\/?>|<hr\s*\/?>/gi;

export const stripTags = s => String(s ?? '').replace(/<[^>]*>/g, '');
export const decodeEntities = s => String(s ?? '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#96;/g, '`');

// rendered HTML → one line of plain text
export function plainText(html) {
  return decodeEntities(stripTags(String(html ?? '').replace(BLOCK_END, ' '))).replace(/\s+/g, ' ').trim();
}

// markdown subset (+ {{site.*}} tokens) → plain text
export function markdownToText(md, { tokens = null } = {}) {
  return plainText(renderMarkdown(md, { tokens }));
}
