// admin/js/lib/jalali.js + admin/js/ui/format.js are DOM-free: exercise them in Node.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JS = join(__dirname, '..', '..', 'admin', 'js');
const jalali = await import(pathToFileURL(join(JS, 'lib', 'jalali.js')).href);
const fmt = await import(pathToFileURL(join(JS, 'ui', 'format.js')).href);

test('Jalali ↔ Gregorian conversion (known dates, leap years, round trip, Intl cross-check)', () => {
  assert.deepEqual(jalali.toJalali(2026, 3, 21), [1405, 1, 1]);
  assert.deepEqual(jalali.toJalali(2026, 9, 22), [1405, 6, 31]);
  assert.deepEqual(jalali.toJalali(2024, 3, 20), [1403, 1, 1]);
  assert.deepEqual(jalali.toJalali(2025, 3, 20), [1403, 12, 30]);
  assert.deepEqual(jalali.toGregorian(1405, 6, 31), [2026, 9, 22]);
  assert.deepEqual(jalali.toGregorian(1403, 12, 30), [2025, 3, 20]);
  assert.equal(jalali.isLeapJalali(1403), true);
  assert.equal(jalali.isLeapJalali(1404), false);
  assert.equal(jalali.jalaliMonthLength(1404, 12), 29);
  assert.equal(jalali.jalaliMonthLength(1403, 12), 30);
  assert.equal(jalali.jalaliMonthLength(1405, 1), 31);
  assert.equal(jalali.isValidJalali(1405, 12, 30), false);
  assert.equal(jalali.isValidJalali(1403, 12, 30), true);

  const intl = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC' });
  let seed = 42;
  const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 2000; i++) {
    const d = new Date(Date.UTC(1930 + rnd(170), rnd(12), 1 + rnd(28)));
    const parts = {};
    for (const p of intl.formatToParts(d)) parts[p.type] = p.value;
    const expect = [Number(parts.year.replace(/\D/g, '')), Number(parts.month), Number(parts.day)];
    const got = jalali.toJalali(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    assert.deepEqual(got, expect, d.toISOString());
    assert.deepEqual(jalali.toGregorian(...got), [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()], `round trip ${d.toISOString()}`);
  }
});

test('parseServerDate: SQLite UTC "YYYY-MM-DD HH:MM:SS", ISO, date-only, Persian digits, garbage', () => {
  assert.equal(fmt.parseServerDate('2026-09-22 10:30:00').toISOString(), '2026-09-22T10:30:00.000Z');
  assert.equal(fmt.parseServerDate('2026-09-22T10:30:00Z').toISOString(), '2026-09-22T10:30:00.000Z');
  assert.equal(fmt.parseServerDate('2026-09-22').toISOString(), '2026-09-22T00:00:00.000Z');
  assert.equal(fmt.parseServerDate('۲۰۲۶-۰۹-۲۲ ۱۰:۳۰:۰۰').toISOString(), '2026-09-22T10:30:00.000Z');
  assert.equal(fmt.parseServerDate(''), null);
  assert.equal(fmt.parseServerDate(null), null);
  assert.equal(fmt.parseServerDate('nope'), null);
  const d = new Date(0);
  assert.equal(fmt.parseServerDate(d), d);
});

test('formatJalali styles (Persian digits, month names, time, relative)', () => {
  const d = '2026-09-22 10:30:00';
  assert.equal(fmt.formatJalali(d, { timeZone: 'UTC' }), '۳۱ شهریور ۱۴۰۵');
  assert.equal(fmt.formatJalali(d, { style: 'datetime', timeZone: 'UTC' }), '۳۱ شهریور ۱۴۰۵، ۱۰:۳۰');
  assert.equal(fmt.formatJalali(d, { style: 'datetime', timeZone: 'Asia/Tehran' }), '۳۱ شهریور ۱۴۰۵، ۱۴:۰۰');
  assert.equal(fmt.formatJalali(d, { style: 'numeric', timeZone: 'UTC' }), '۱۴۰۵/۰۶/۳۱');
  assert.equal(fmt.formatJalali(d, { style: 'numeric', digits: 'en', timeZone: 'UTC' }), '1405/06/31');
  assert.equal(fmt.formatJalali(d, { style: 'long', timeZone: 'UTC' }), 'سه‌شنبه ۳۱ شهریور ۱۴۰۵');
  assert.equal(fmt.formatJalali(d, { style: 'time', timeZone: 'UTC' }), '۱۰:۳۰');
  const now = new Date('2026-09-22T13:30:00Z');
  assert.equal(fmt.formatJalali(d, { style: 'relative', now }), '۳ ساعت پیش');
  assert.equal(fmt.formatJalali('2026-09-22 13:29:50', { style: 'relative', now }), 'همین حالا');
  assert.equal(fmt.formatJalali('2026-09-20 13:30:00', { style: 'relative', now }), '۲ روز پیش');
  assert.equal(fmt.formatJalali('2026-08-01 13:30:00', { style: 'relative', now, timeZone: 'UTC' }), '۱۰ مرداد ۱۴۰۵');
  assert.equal(fmt.formatJalali('', {}), '');
  assert.equal(fmt.formatJalali('garbage'), '');
  assert.equal(jalali.isoToJalaliInput('2026-09-22'), '۱۴۰۵/۰۶/۳۱');
  assert.equal(jalali.jalaliInputToIso('۱۴۰۵/۰۶/۳۱'), '2026-09-22');
  assert.equal(jalali.jalaliInputToIso('1405/6/31'), '2026-09-22');
  assert.equal(jalali.jalaliInputToIso('1405/12/30'), null);
});

test('digits, numbers, toman, mobile, bytes, truncate', () => {
  assert.equal(fmt.toFaDigits('1405/06/31'), '۱۴۰۵/۰۶/۳۱');
  assert.equal(fmt.toFaDigits(42), '۴۲');
  assert.equal(fmt.toEnDigits('۰۹۱۲۵۱۳۰۵۰۵'), '09125130505');
  assert.equal(fmt.toEnDigits('٠٩١٢'), '0912'); // Arabic-Indic too
  assert.equal(fmt.formatNumber(12500000), '۱۲٬۵۰۰٬۰۰۰');
  assert.equal(fmt.formatNumber('۱۲۵۰۰۰۰۰'), '۱۲٬۵۰۰٬۰۰۰');
  assert.equal(fmt.formatNumber(-1234), '-۱٬۲۳۴');
  assert.equal(fmt.formatNumber(1234.5), '۱٬۲۳۴٫۵');
  assert.equal(fmt.formatNumber(1234567, { digits: 'en', sep: ',' }), '1,234,567');
  assert.equal(fmt.formatNumber('abc'), '');
  assert.equal(fmt.formatToman(12500000), '۱۲٬۵۰۰٬۰۰۰ تومان');
  assert.equal(fmt.formatToman(0), '۰ تومان');
  assert.equal(fmt.formatToman(null), '');
  assert.equal(fmt.formatToman(950000, { unit: false }), '۹۵۰٬۰۰۰');
  assert.equal(fmt.formatMobile('09125130505'), '۰۹۱۲ ۵۱۳ ۰۵۰۵');
  assert.equal(fmt.formatMobile('+989125130505'), '۰۹۱۲ ۵۱۳ ۰۵۰۵');
  assert.equal(fmt.formatMobile('۹۱۲۵۱۳۰۵۰۵'), '۰۹۱۲ ۵۱۳ ۰۵۰۵');
  assert.equal(fmt.formatMobile('02833323002'), '۰۲۸۳۳۳۲۳۰۰۲'); // not a mobile: digits only
  assert.equal(fmt.formatLandline('02833323002'), '۰۲۸-۳۳۳۲۳۰۰۲');
  assert.equal(fmt.formatMobile(''), '');
  assert.equal(fmt.formatBytes(8 * 1024 * 1024), '۸ مگابایت');
  assert.equal(fmt.formatBytes(1536), '۱٫۵ کیلوبایت');
  assert.equal(fmt.formatBytes(12), '۱۲ بایت');
  assert.equal(fmt.truncate('abcdefghij', 5), 'abcd…');
  assert.equal(fmt.truncate('short', 10), 'short');
  assert.equal(fmt.localDayKey('2026-09-22 23:59:00').length, 10);
});
