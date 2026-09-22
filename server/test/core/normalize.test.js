import test from 'node:test';
import assert from 'node:assert/strict';
import { toLatinDigits, toFaDigits, normalizeMobile, toE164, parseTomanInput } from '../../src/lib/normalize.js';

test('digits both ways', () => {
  assert.equal(toLatinDigits('۰۱۲۳۴۵۶۷۸۹'), '0123456789');
  assert.equal(toLatinDigits('٠١٢٣٤٥٦٧٨٩'), '0123456789');
  assert.equal(toLatinDigits('تلفن ۰۹۱۲'), 'تلفن 0912');
  assert.equal(toFaDigits('0912-1'), '۰۹۱۲-۱');
  assert.equal(toLatinDigits(null), '');
});

test('normalizeMobile: all six input forms', () => {
  const want = '09121234567';
  for (const s of [
    '09121234567',        // 0 + 10 digits
    '9121234567',         // bare 10 digits
    '+989121234567',      // E.164
    '989121234567',       // country code, no plus
    '00989121234567',     // international prefix
    '0912 123 4567',      // spaced
    '0912-123-4567',      // dashed
    '(0912) 123.4567',    // punctuation
    '۰۹۱۲۱۲۳۴۵۶۷',        // Persian digits
    '٠٩١٢١٢٣٤٥٦٧',        // Arabic-Indic digits
    '+۹۸ ۹۱۲ ۱۲۳ ۴۵۶۷',   // mixed
  ]) assert.equal(normalizeMobile(s), want, s);
});

test('normalizeMobile rejects what is not an Iranian mobile', () => {
  for (const s of ['', null, undefined, '02112345678', '0912123456', '091212345678', '+1 415 555 0100', '9812345', 'abc', '0912a234567', '+98 21 1234 5678', '00981234567890']) {
    assert.equal(normalizeMobile(s), null, JSON.stringify(s));
  }
});

test('toE164', () => {
  assert.equal(toE164('0912 123 4567'), '+989121234567');
  assert.equal(toE164('۰۹۱۲۱۲۳۴۵۶۷'), '+989121234567');
  assert.equal(toE164('nope'), null);
});

test('parseTomanInput', () => {
  assert.equal(parseTomanInput('1500000'), 1500000);
  assert.equal(parseTomanInput('1,500,000'), 1500000);
  assert.equal(parseTomanInput('۱٬۵۰۰٬۰۰۰'), 1500000);
  assert.equal(parseTomanInput('۱،۵۰۰،۰۰۰ تومان'), 1500000);
  assert.equal(parseTomanInput(' 250 000 '), 250000);
  assert.equal(parseTomanInput('0'), 0);
  for (const s of ['', null, '-5', '1.5', '1۵x', 'abc', '99999999999999999999']) assert.equal(parseTomanInput(s), null, JSON.stringify(s));
});
