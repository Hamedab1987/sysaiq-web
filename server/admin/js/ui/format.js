// Display formatting: Persian digits, «٬» thousands, toman, Jalali dates,
// mobile numbers, bytes, truncation. DOM-free (Node-testable). Everything
// STORED stays Latin — these run on the way to the screen only.
import { faDigits, enDigits, parseServerDate, formatJalali as _formatJalali, jalaliParts } from '../lib/jalali.js';

export const toFaDigits = faDigits;
export const toEnDigits = enDigits;
export { parseServerDate, jalaliParts };
export const formatJalali = _formatJalali;

const FA_SEP = '٬'; // ٬ Arabic thousands separator (the Persian convention)

// integer/decimal → grouped digits. {digits:'fa'|'en', sep, decimals}
export function formatNumber(n, { digits = 'fa', sep = FA_SEP, decimals } = {}) {
  if (n === null || n === undefined || n === '') return '';
  const num = typeof n === 'number' ? n : Number(enDigits(String(n)).replace(/[,٬\s]/g, ''));
  if (!Number.isFinite(num)) return '';
  const fixed = decimals === undefined ? String(num) : num.toFixed(decimals);
  const [intPart, frac] = fixed.split('.');
  const sign = intPart.startsWith('-') ? '-' : '';
  const grouped = intPart.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const out = sign + grouped + (frac ? `${digits === 'fa' ? '٫' : '.'}${frac}` : '');
  return digits === 'fa' ? faDigits(out) : out;
}

// integer toman → «۱۲٬۵۰۰٬۰۰۰ تومان»; null/invalid → '' ; {unit:false} drops the word
export function formatToman(n, { unit = true, digits = 'fa' } = {}) {
  const s = formatNumber(n, { digits });
  if (!s) return '';
  return unit ? `${s} تومان` : s;
}

// '09125130505' | '+989125130505' | '۰۹۱۲…' → «۰۹۱۲ ۵۱۳ ۰۵۰۵»; other inputs
// are returned with Persian digits and no regrouping.
export function formatMobile(s, { digits = 'fa' } = {}) {
  let d = enDigits(String(s ?? '')).replace(/[\s\-.()‌]/g, '');
  if (!d) return '';
  if (d.startsWith('+98')) d = `0${d.slice(3)}`;
  else if (d.startsWith('0098')) d = `0${d.slice(4)}`;
  else if (/^98\d{10}$/.test(d)) d = `0${d.slice(2)}`;
  else if (/^9\d{9}$/.test(d)) d = `0${d}`;
  const out = /^09\d{9}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : String(s);
  return digits === 'fa' ? faDigits(out) : out;
}

// landline like 02833323002 → «۰۲۸-۳۳۳۲۳۰۰۲»
export function formatLandline(s, { digits = 'fa' } = {}) {
  const d = enDigits(String(s ?? '')).replace(/[\s\-.()]/g, '');
  const out = /^0\d{9,10}$/.test(d) ? `${d.slice(0, 3)}-${d.slice(3)}` : String(s ?? '');
  return digits === 'fa' ? faDigits(out) : out;
}

const UNITS = ['بایت', 'کیلوبایت', 'مگابایت', 'گیگابایت'];
export function formatBytes(n, { digits = 'fa' } = {}) {
  let v = Number(n);
  if (!Number.isFinite(v) || v < 0) return '';
  let i = 0;
  while (v >= 1024 && i < UNITS.length - 1) { v /= 1024; i++; }
  const s = i === 0 ? String(Math.round(v)) : v.toFixed(v < 10 ? 1 : 0);
  return `${formatNumber(s, { digits })} ${UNITS[i]}`;
}

export function truncate(s, max = 80, ellipsis = '…') {
  const t = String(s ?? '').trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(1, max - 1)).trimEnd()}${ellipsis}`;
}

// 'YYYY-MM-DD HH:MM:SS' ↔ local day key for grouping ("today" counters)
export function localDayKey(date) {
  const d = parseServerDate(date);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export const isToday = date => localDayKey(date) === localDayKey(new Date());

// percentage 0–100 → «۴۵٪»
export const formatPercent = (n, { digits = 'fa' } = {}) => (Number.isFinite(Number(n)) ? `${formatNumber(Math.round(Number(n)), { digits })}٪` : '');
