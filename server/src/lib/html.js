// HTML escaping helpers shared by every renderer.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// text node context
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

// double-quoted attribute value context (also neutralises backticks)
export const attr = s => esc(s).replace(/`/g, '&#96;');

// JSON for a <script type="application/json"> block: `<` becomes \u003c so
// "</script>" inside a string can never close the element; U+2028/2029 are
// escaped because they are line terminators in older JS parsers.
export const jsonForScript = obj => JSON.stringify(obj ?? null)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');

// tolerant JSON.parse for columns that store JSON text
export const J = (str, dflt = []) => {
  if (str === null || str === undefined || str === '') return dflt;
  if (typeof str !== 'string') return str;
  try { return JSON.parse(str); } catch { return dflt; }
};
