// Jalali (Solar Hijri) ↔ Gregorian, plus Persian formatting via Intl.
// DOM-free so it is testable in Node. The converter is the compact
// jalaali-js arithmetic (Behrooz Kamali / Kamalinia, MIT) — exact for
// 1178–3177 SH, no lookup tables beyond the 33-year cycle breaks.
//   toJalali(2026, 3, 21)        → [1405, 1, 1]
//   toGregorian(1405, 6, 31)     → [2026, 9, 22]
//   parseServerDate('2026-09-22 10:30:00') → Date (UTC)
//   formatJalali(date, { style: 'datetime' }) → '۳۱ شهریور ۱۴۰۵، ۱۴:۰۰'

const div = (a, b) => ~~(a / b);
const mod = (a, b) => a - ~~(a / b) * b;
const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

function jalCal(jy) {
  const gy = jy + 621;
  let leapJ = -14, jp = BREAKS[0], jump = 0;
  if (jy < jp || jy >= BREAKS[BREAKS.length - 1]) throw new RangeError(`Jalali year out of range: ${jy}`);
  for (let i = 1; i < BREAKS.length; i++) {
    const jm = BREAKS[i]; jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}
function g2d(gy, gm, gd) {
  let d = div((gy + div(gm - 8, 6) + 100100) * 1461, 4) + div(153 * mod(gm + 9, 12) + 2, 5) + gd - 34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}
function d2g(jdn) {
  let j = 4 * jdn + 139361631;
  j = j + div(div(4 * jdn + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const gd = div(mod(i, 153), 5) + 1;
  const gm = mod(div(i, 153), 12) + 1;
  const gy = div(j, 1461) - 100100 + div(8 - gm, 6);
  return [gy, gm, gd];
}
function j2d(jy, jm, jd) {
  const r = jalCal(jy);
  return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}
function d2j(jdn) {
  const gy = d2g(jdn)[0];
  let jy = gy - 621;
  const r = jalCal(jy);
  let k = jdn - g2d(gy, 3, r.march);
  if (k >= 0) {
    if (k <= 185) return [jy, 1 + div(k, 31), mod(k, 31) + 1];
    k -= 186;
  } else {
    jy -= 1; k += 179;
    if (r.leap === 1) k += 1;
  }
  return [jy, 7 + div(k, 30), mod(k, 30) + 1];
}

export const toJalali = (gy, gm, gd) => d2j(g2d(gy, gm, gd));
export const toGregorian = (jy, jm, jd) => d2g(j2d(jy, jm, jd));
export const isLeapJalali = jy => jalCal(jy).leap === 0;
export const jalaliMonthLength = (jy, jm) => (jm <= 6 ? 31 : jm <= 11 ? 30 : isLeapJalali(jy) ? 30 : 29);
export function isValidJalali(jy, jm, jd) {
  return Number.isInteger(jy) && Number.isInteger(jm) && Number.isInteger(jd)
    && jy >= -61 && jy < 3178 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= jalaliMonthLength(jy, jm);
}

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
// Saturday-first week, as Persian calendars are laid out
export const JALALI_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const JALALI_WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
export const faDigits = s => String(s ?? '').replace(/[0-9]/g, d => FA_DIGITS[d]);
export const enDigits = s => String(s ?? '').replace(/[۰-۹]/g, c => String(FA_DIGITS.indexOf(c))).replace(/[٠-٩]/g, c => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c)));

// SQLite datetime('now') → 'YYYY-MM-DD HH:MM:SS' in UTC with no zone marker.
// Also accepts ISO strings, 'YYYY-MM-DD' (treated as a UTC midnight) and
// Date/number. Returns null for anything unparseable.
export function parseServerDate(v) {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') { const d = new Date(v); return Number.isNaN(d.getTime()) ? null : d; }
  const s = enDigits(String(v)).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0), +(m[7] ? m[7].padEnd(3, '0') : 0)));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Intl parts → {jy, jm, jd, hour, minute, weekday} in the given zone
// (default: the browser's). Latin digits: 'en' numbering keeps parsing safe.
const cache = new Map();
function partsFormatter(timeZone) {
  const key = timeZone || 'local';
  if (!cache.has(key)) {
    cache.set(key, new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
      year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      hour12: false, weekday: 'long', ...(timeZone ? { timeZone } : {}),
    }));
  }
  return cache.get(key);
}
export function jalaliParts(date, { timeZone } = {}) {
  const d = parseServerDate(date);
  if (!d) return null;
  const out = {};
  for (const p of partsFormatter(timeZone).formatToParts(d)) {
    if (p.type === 'year') out.jy = Number(p.value.replace(/\D/g, '')); // "1405 AP" in some engines
    else if (p.type === 'month') out.jm = Number(p.value);
    else if (p.type === 'day') out.jd = Number(p.value);
    else if (p.type === 'hour') out.hour = Number(p.value) % 24;
    else if (p.type === 'minute') out.minute = Number(p.value);
    else if (p.type === 'second') out.second = Number(p.value);
    else if (p.type === 'weekday') out.weekday = p.value;
  }
  return out;
}

const pad2 = n => String(n).padStart(2, '0');
const WEEKDAY_FA = { Saturday: 'شنبه', Sunday: 'یکشنبه', Monday: 'دوشنبه', Tuesday: 'سه‌شنبه', Wednesday: 'چهارشنبه', Thursday: 'پنجشنبه', Friday: 'جمعه' };

// styles: 'date' (۳۱ شهریور ۱۴۰۵) · 'datetime' (…، ۱۴:۰۰) · 'time' (۱۴:۰۰)
// · 'numeric' (۱۴۰۵/۰۶/۳۱) · 'long' (سه‌شنبه ۳۱ شهریور ۱۴۰۵) · 'relative'
// (۳ ساعت پیش — falls back to 'date' beyond 7 days). Persian digits unless
// {digits:'en'}.
export function formatJalali(date, { style = 'date', digits = 'fa', timeZone, now } = {}) {
  const d = parseServerDate(date);
  if (!d) return '';
  const p = jalaliParts(d, { timeZone });
  if (!p) return '';
  const D = digits === 'en' ? (s => String(s)) : faDigits;
  const time = `${D(pad2(p.hour))}:${D(pad2(p.minute))}`;
  const dateStr = `${D(p.jd)} ${JALALI_MONTHS[p.jm - 1]} ${D(p.jy)}`;
  switch (style) {
    case 'time': return time;
    case 'numeric': return D(`${p.jy}/${pad2(p.jm)}/${pad2(p.jd)}`);
    case 'datetime': return `${dateStr}، ${time}`;
    case 'long': return `${WEEKDAY_FA[p.weekday] || ''} ${dateStr}`.trim();
    case 'relative': {
      const ref = now instanceof Date ? now : new Date();
      const diff = Math.round((ref.getTime() - d.getTime()) / 1000);
      const abs = Math.abs(diff);
      const ago = diff >= 0;
      const w = (n, unit) => (ago ? `${D(n)} ${unit} پیش` : `${D(n)} ${unit} دیگر`);
      if (abs < 45) return 'همین حالا';
      if (abs < 3600) return w(Math.max(1, Math.round(abs / 60)), 'دقیقه');
      if (abs < 86400) return w(Math.round(abs / 3600), 'ساعت');
      if (abs < 7 * 86400) return w(Math.round(abs / 86400), 'روز');
      return dateStr;
    }
    default: return dateStr;
  }
}

// 'YYYY-MM-DD' (Gregorian, Latin) ↔ '1405/06/31' style input (either digit set)
export function isoToJalaliInput(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(enDigits(String(iso || '')));
  if (!m) return '';
  const [jy, jm, jd] = toJalali(+m[1], +m[2], +m[3]);
  return faDigits(`${jy}/${pad2(jm)}/${pad2(jd)}`);
}
export function jalaliInputToIso(text) {
  const m = /^\s*(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*$/.exec(enDigits(String(text || '')));
  if (!m) return null;
  const jy = +m[1], jm = +m[2], jd = +m[3];
  if (!isValidJalali(jy, jm, jd)) return null;
  const [gy, gm, gd] = toGregorian(jy, jm, jd);
  return `${gy}-${pad2(gm)}-${pad2(gd)}`;
}
export function todayJalali() {
  const n = new Date();
  return toJalali(n.getFullYear(), n.getMonth() + 1, n.getDate());
}
