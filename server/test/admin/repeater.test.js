// ui/repeater.js: after a failed validate(), focus() lands on the row field
// that failed (the invalid «0912513» number in row 2), not on the first row's
// first control — createForm.validate() calls first.focus() on the repeater,
// so keyboard users must land on the control that carries the error.
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { installFakeDom } from './fake-dom.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const UI = join(__dirname, '..', '..', 'admin', 'js', 'ui');

let repeater, field, selectField, createForm, document;
before(async () => {
  ({ document } = installFakeDom());
  ({ repeater } = await import(pathToFileURL(join(UI, 'repeater.js')).href));
  ({ field, selectField, createForm } = await import(pathToFileURL(join(UI, 'form.js')).href));
});

const MOBILE_MSG = 'شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ شروع شود';
const LANDLINE_MSG = 'شمارهٔ ثابت باید ۱۱ رقم و با ۰ شروع شود';
// row rules see the row's values (type + number), like the site-info phone repeater
const numberRule = (v, row) => (row?.type === 'landline'
  ? (/^0[1-8]\d{9}$/.test(String(v || '')) ? null : LANDLINE_MSG)
  : (/^09\d{9}$/.test(String(v || '')) ? null : MOBILE_MSG));
const phones = () => repeater({
  name: 'phones', label: 'تلفن‌ها',
  item: () => [
    selectField({ name: 'type', label: 'نوع', options: [{ value: 'mobile', label: 'موبایل' }, { value: 'landline', label: 'ثابت' }] }),
    field({ name: 'number', label: 'شماره', required: true, dir: 'ltr', rules: [numberRule] }),
  ],
});

test('focus() after a failed validate() targets the invalid row field, not rows[0].fields[0]', () => {
  const rep = phones();
  rep.value = [{ type: 'mobile', number: '09125130505' }, { type: 'mobile', number: '0912513' }];
  assert.equal(rep.rows.length, 2);
  const firstControl = rep.rows[0].fields[0].control;      // row 1 type <select> (the old target)
  const badInput = rep.rows[1].fields[1].control;          // row 2 number <input>
  assert.equal(badInput.tagName, 'INPUT');

  assert.equal(rep.validate(rep.value), MOBILE_MSG);
  assert.equal(rep.rows[1].fields[1].el.classList.contains('is-invalid'), true, 'row field shows the error');
  assert.equal(rep.rows[0].fields[1].el.classList.contains('is-invalid'), false);

  rep.focus();
  assert.equal(document.activeElement, badInput, 'focus lands on the invalid number input');
  assert.notEqual(document.activeElement, firstControl);
  assert.equal(rep.focusInvalid(), true);

  // fixed → validate passes → focus goes back to the first control (default behaviour)
  rep.rows[1].fields[1].value = '09120001122';
  assert.equal(rep.validate(rep.value), null);
  assert.equal(rep.focusInvalid(), false);
  rep.focus();
  assert.equal(document.activeElement, firstControl);
});

test('the first invalid row wins; clearError() forgets it', () => {
  const rep = phones();
  rep.value = [{ type: 'mobile', number: '' }, { type: 'mobile', number: '0912513' }];
  assert.equal(rep.validate(rep.value), 'این فیلد الزامی است');
  rep.focus();
  assert.equal(document.activeElement, rep.rows[0].fields[1].control, 'row 1 number (required) before row 2');

  rep.clearError();
  document.activeElement = null;
  rep.focus();
  assert.equal(document.activeElement, rep.rows[0].fields[0].control, 'after clearError the default target is back');
});

test('an empty required repeater still focuses the add button', () => {
  const rep = repeater({ name: 'links', label: 'پیوندها', required: true, item: () => [field({ name: 'url', label: 'نشانی' })] });
  assert.equal(rep.validate([]), 'این فیلد الزامی است');
  rep.focus();
  assert.equal(document.activeElement.tagName, 'BUTTON');
  assert.match(document.activeElement.textContent, /افزودن/);
});

test('createForm.validate() puts the keyboard user on the invalid row input', () => {
  const rep = phones();
  const brand = field({ name: 'brand', label: 'برند', required: true });
  const form = createForm({ fields: [brand, rep], values: { brand: 'SysaiQ', phones: [{ type: 'landline', number: '02833323002' }, { type: 'mobile', number: '0912513' }] } });
  document.activeElement = null;
  assert.equal(form.validate(), false);
  assert.equal(document.activeElement, rep.rows[1].fields[1].control, 'the «0912513» input has focus');
  // a 422 from the server keyed on the repeater name still highlights the repeater
  form.setErrors({ 'phones[1].e164': 'bad number' });
  assert.equal(rep.el.classList.contains('is-invalid'), true);
  form.destroy();
});
