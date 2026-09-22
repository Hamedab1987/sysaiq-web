// Persian-aware input normalisation. Everything is stored with Latin digits;
// the admin UI shows Persian digits (toFaDigits) on the way out.

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';   // U+06F0–06F9 (Persian)
const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';   // U+0660–0669 (Arabic-Indic — Arabic keyboards)

export function toLatinDigits(s) {
  return String(s ?? '').replace(/[۰-۹٠-٩]/g, c => {
    const i = FA_DIGITS.indexOf(c);
    return String(i >= 0 ? i : AR_DIGITS.indexOf(c));
  });
}

export function toFaDigits(s) {
  return String(s ?? '').replace(/[0-9]/g, d => FA_DIGITS[Number(d)]);
}

// Iranian mobile in any of the usual shapes → '09xxxxxxxxx', else null:
//   09121234567 · 9121234567 · +989121234567 · 989121234567 · 00989121234567
//   with spaces / dashes / dots / parentheses and Persian or Arabic digits.
export function normalizeMobile(s) {
  let d = toLatinDigits(s).replace(/[\s\-.()\u200c]/g, '');
  if (!/^\+?\d+$/.test(d)) return null;
  d = d.replace(/^\+/, '');
  if (d.startsWith('0098')) d = d.slice(4);
  else if (d.startsWith('98') && d.length === 12) d = d.slice(2);
  else if (d.startsWith('0') && d.length === 11) d = d.slice(1);
  return /^9\d{9}$/.test(d) ? `0${d}` : null;
}

// '09121234567' → '+989121234567' (accepts any input normalizeMobile does)
export function toE164(m) {
  const n = normalizeMobile(m);
  return n ? `+98${n.slice(1)}` : null;
}

// Amount typed by the owner ('۱,۵۰۰,۰۰۰', '1,500,000 تومان', '1500000') →
// integer toman, or null when empty / negative / fractional / not a number.
export function parseTomanInput(s) {
  let t = toLatinDigits(s).trim();
  t = t.replace(/تومان|ریال|toman|rial|irt|irr/gi, '').trim();
  t = t.replace(/[,\u066c\u060c\s\u200c_']/g, '');   // separators: comma, Arabic thousands sep (U+066C), Arabic comma (U+060C), spaces
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}
