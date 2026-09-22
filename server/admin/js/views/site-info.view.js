// «اطلاعات تماس و هویت» — the single source of the owner's identity + contact
// facts (settings.site_info). Save = publish: the PUT replaces the whole
// object and every page (contact block, footer, legal pages, JSON-LD) reads
// it on the next request.
//   GET /site-info → {site_info, complete, options}
//   PUT /site-info  {…site_info}  → {ok, site_info, complete}  · 422 {fields}
// Phones are typed nationally with Persian or Latin digits and stored as
// E.164; the display strings are generated once and stay editable.
import { h, icon, pageHeader, card, tabs, badge, toast, errorState, skeleton, stickyActionBar, createForm, submitButton, makeField, field, selectField, switchField, numberField, bilingualField, repeater, validators, toFaDigits, toEnDigits, formatMobile, formatLandline } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/site-info.css';
const DAYS = [['Sa', 'شنبه'], ['Su', 'یکشنبه'], ['Mo', 'دوشنبه'], ['Tu', 'سه‌شنبه'], ['We', 'چهارشنبه'], ['Th', 'پنجشنبه'], ['Fr', 'جمعه']];
const SOCIAL_LABELS = { whatsapp: 'واتس‌اپ', telegram: 'تلگرام', instagram: 'اینستاگرام', linkedin: 'LinkedIn', github: 'GitHub', x: 'X (توییتر)' };
const SOCIAL_HINT = { whatsapp: 'https://wa.me/989…', telegram: 'https://t.me/…', instagram: 'https://instagram.com/…', linkedin: 'https://linkedin.com/in/…', github: 'https://github.com/…', x: 'https://x.com/…' };
const MAP_LABELS = { neshan: 'نشان', balad: 'بلد', google: 'Google Maps' };
const SHOW_KEYS = ['address', 'landline', 'mobile', 'email', 'hours', 'map', 'socials'];

const T = {
  title: 'اطلاعات تماس و هویت',
  subtitle: 'نشانی، تلفن‌ها، ایمیل و ساعات کاری که در بخش تماس، پانویس، صفحات حقوقی و دادهٔ ساختاریافتهٔ سایت استفاده می‌شوند. ذخیره یعنی انتشار.',
  eyebrow: '[ SYSAIQ—ADMIN / IDENTITY ]',
  enamadWarn: 'این اطلاعات باید دقیقاً با اطلاعات ثبت‌شده در سامانهٔ اینماد یکسان باشد.',
  enamadWarnHint: 'نشانی، تلفن ثابت و ایمیل در بررسی اینماد با همین مقادیر مقایسه می‌شوند.',
  incomplete: 'برای تکمیل راه‌اندازی، نشانی در هر دو زبان، دست‌کم یک تلفن و ایمیل لازم است.',
  secIdentity: 'هویت', secIdentityHint: 'نام برند و نام صاحب کسب‌وکار (شخص حقیقی) که در پانویس و صفحات حقوقی می‌آید.',
  secAddress: 'نشانی', secAddressHint: 'نشانی کامل دفتر به فارسی و انگلیسی؛ همان نشانی‌ای که در اینماد ثبت شده است.',
  secPhones: 'تلفن‌ها', secPhonesHint: 'شماره را با صفر و کد شهر بنویسید؛ ارقام فارسی هم پذیرفته می‌شود. متن نمایش خودکار ساخته می‌شود و قابل ویرایش است.',
  secEmail: 'ایمیل',
  secHours: 'ساعات کاری', secHoursHint: 'متن آزاد برای نمایش روی سایت، و در صورت تمایل، جدول دقیق روز/ساعت برای دادهٔ ساختاریافته (Google).',
  secMap: 'مسیریابی', secMapHint: 'لینک اشتراک‌گذاری مکان از نشان، بلد یا Google Maps؛ نقشه به‌صورت لینک نمایش داده می‌شود، نه iframe.',
  secSocials: 'شبکه‌های اجتماعی', secSocialsHint: 'هر شبکه فقط یک بار. واتس‌اپ و تلگرام روی همان شمارهٔ موبایل؟ لینک wa.me و t.me را بگذارید.',
  brand: 'نام برند', brandHint: 'مثال: SysaiQ',
  legalName: 'نام صاحب کسب‌وکار', legalNameHint: 'شخص حقیقی؛ همان‌طور که در اینماد ثبت شده است.',
  address: 'نشانی کامل', city: 'شهر', region: 'استان', country: 'کشور', countryHint: 'کد دوحرفی ISO، مثل IR',
  postal: 'کد پستی', postalHint: '۱۰ رقم، بدون فاصله (اختیاری)',
  geoLat: 'عرض جغرافیایی (lat)', geoLng: 'طول جغرافیایی (lng)', geoHint: 'اختیاری؛ برای پین نقشه در دادهٔ ساختاریافته. از لینک نقشه قابل برداشتن است.',
  phoneType: 'نوع', landline: 'تلفن ثابت', mobile: 'موبایل',
  phoneNumber: 'شماره', phoneNumberHint: 'مثال: ۰۲۸۳۳۳۲۳۰۰۲ یا ۰۹۱۲۵۱۳۰۵۰۵',
  displayFa: 'متن نمایش (فارسی)', displayEn: 'متن نمایش (انگلیسی)',
  addPhone: 'افزودن شماره', phoneItem: 'شماره',
  mobileInvalid: 'شمارهٔ موبایل باید ۱۱ رقم و با ۰۹ شروع شود (مثال: ۰۹۱۲۵۱۳۰۵۰۵)',
  landlineInvalid: 'شمارهٔ ثابت باید ۱۱ رقم و با ۰ و کد شهر شروع شود (مثال: ۰۲۸۳۳۳۲۳۰۰۲)',
  intlInvalid: 'شمارهٔ بین‌المللی باید با + و کد کشور شروع شود و ۸ تا ۱۵ رقم داشته باشد',
  email: 'ایمیل تماس', emailHint: 'روی سایت به‌صورت لینک mailto نمایش داده می‌شود.',
  hoursText: 'متن ساعات کاری', hoursTextHint: 'مثال: شنبه تا چهارشنبه، ۹ تا ۱۷ — خالی بماند، «اعلام‌نشده» نمایش داده می‌شود.',
  hoursSpec: 'جدول ساعات کاری', addHours: 'افزودن بازه', hoursItem: 'بازه', days: 'روزها', opens: 'از ساعت', closes: 'تا ساعت',
  hhmm: 'ساعت را به شکل ۰۹:۰۰ بنویسید', daysRequired: 'حداقل یک روز را انتخاب کنید', closesAfter: 'ساعت پایان باید بعد از ساعت شروع باشد',
  socialKind: 'شبکه', socialUrl: 'نشانی (https)', addSocial: 'افزودن شبکه', socialItem: 'شبکه', socialDup: 'هر شبکه فقط یک بار می‌تواند ثبت شود',
  showAddress: 'نمایش نشانی در سایت', showLandline: 'نمایش تلفن ثابت در سایت', showMobile: 'نمایش موبایل در سایت', showEmail: 'نمایش ایمیل در سایت', showHours: 'نمایش ساعات کاری در سایت', showMap: 'نمایش لینک نقشه در سایت', showSocials: 'نمایش شبکه‌های اجتماعی در سایت',
  preview: 'پیش‌نمایش بخش تماس', previewHint: 'همان چیزی که بازدیدکننده در بخش تماس و پانویس می‌بیند (تقریبی).',
  pvAddress: 'نشانی', pvHours: 'ساعات کاری', pvMap: 'مسیریابی', pvUnset: 'اعلام‌نشده', pvHidden: 'پنهان', pvNoPhone: 'هنوز شماره‌ای ثبت نشده است.',
  saved: 'ذخیره و منتشر شد', viewSite: 'مشاهده در سایت',
  loadError: 'اطلاعات تماس بارگذاری نشد.',
  complete: 'اطلاعات تماس کامل است', notComplete: 'اطلاعات تماس ناقص است',
};

// ---- helpers ------------------------------------------------------------
function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
const stripPhone = s => toEnDigits(String(s ?? '')).replace(/[\s\-().‌]/g, '');
// any of the usual shapes → national '0…' for Iranian numbers, '+…' kept for foreign ones, '' when empty
function nationalPhone(s) {
  let d = stripPhone(s);
  if (!d) return '';
  if (d.startsWith('00')) d = `+${d.slice(2)}`;
  if (d.startsWith('+98')) return `0${d.slice(3)}`;
  if (/^98\d{10}$/.test(d)) return `0${d.slice(2)}`;
  if (/^9\d{9}$/.test(d)) return `0${d}`;
  return d;
}
const toE164 = n => (n.startsWith('+') ? n : n.startsWith('0') ? `+98${n.slice(1)}` : n ? `+98${n}` : '');
function phoneMessage(type, raw) {
  const n = nationalPhone(raw);
  if (!n) return STR.fields.required;
  if (n.startsWith('+')) return /^\+[1-9]\d{6,14}$/.test(n) ? null : T.intlInvalid;
  if (type === 'mobile') return /^09\d{9}$/.test(n) ? null : T.mobileInvalid;
  return /^0[1-8]\d{9}$/.test(n) ? null : T.landlineInvalid;
}
const displayFaFor = (type, n) => (n.startsWith('+') ? toFaDigits(n) : type === 'mobile' ? formatMobile(n) : formatLandline(n));
function displayEnFor(type, n) {
  if (n.startsWith('+')) return n;
  const rest = n.slice(1);
  if (type === 'mobile' && rest.length === 10) return `+98 ${rest.slice(0, 3)} ${rest.slice(3, 6)} ${rest.slice(6)}`;
  if (rest.length === 10) return `+98 ${rest.slice(0, 2)} ${rest.slice(2, 6)} ${rest.slice(6)}`;
  return `+98 ${rest}`;
}
const hhmmOk = v => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(toEnDigits(String(v || '')).replace(/[٫.]/g, ':'));
// the preview links only what the field validators (and the server) would accept; anything else is shown as text
const httpsOk = validators.url({ https: true });
const emailOk = validators.email();
const linkableUrl = u => { const s = String(u ?? '').trim(); return s && httpsOk(s) === null ? s : null; };
const linkableEmail = e => { const s = String(e ?? '').trim(); return s && emailOk(s) === null ? s : null; };

// server object ↔ flat form values
function toForm(si) {
  const s = si || {};
  const v = {
    brand: s.brand || '', legal_name: s.legal_name || { fa: '', en: '' }, address: s.address || { fa: '', en: '' },
    city: s.city || { fa: '', en: '' }, region: s.region || { fa: '', en: '' }, country: s.country || 'IR', postal_code: s.postal_code || '',
    geo_lat: s.geo?.lat ?? null, geo_lng: s.geo?.lng ?? null,
    phones: (s.phones || []).map(p => ({ type: p.type, number: nationalPhone(p.e164), display_fa: p.display_fa || '', display_en: p.display_en || '' })),
    email: s.email || '', hours: s.hours || { fa: '', en: '' },
    hours_spec: (s.hours_spec || []).map(x => ({ days: [...(x.days || [])], opens: x.opens || '', closes: x.closes || '' })),
    socials: (s.socials || []).map(x => ({ kind: x.kind, url: x.url })),
    map_neshan: s.map_url?.neshan || '', map_balad: s.map_url?.balad || '', map_google: s.map_url?.google || '',
  };
  for (const k of SHOW_KEYS) v[`show_${k}`] = s.show ? s.show[k] !== false : true;
  return v;
}
function toServer(v) {
  const num = x => (x === null || x === undefined || x === '' || Number.isNaN(Number(x)) ? null : Math.round(Number(x) * 1e6) / 1e6);
  const lat = num(v.geo_lat), lng = num(v.geo_lng);
  const out = {
    brand: v.brand, legal_name: v.legal_name, address: v.address, city: v.city, region: v.region,
    country: String(v.country || 'IR').toUpperCase(), postal_code: toEnDigits(v.postal_code || ''),
    geo: lat !== null && lng !== null ? { lat: String(lat), lng: String(lng) } : null,
    phones: (v.phones || []).map(p => { const n = nationalPhone(p.number); return { type: p.type, e164: toE164(n), display_fa: p.display_fa || displayFaFor(p.type, n), display_en: p.display_en || displayEnFor(p.type, n) }; }),
    email: v.email, hours: v.hours,
    hours_spec: (v.hours_spec || []).map(x => ({ days: x.days, opens: toEnDigits(x.opens).replace(/[٫.]/g, ':'), closes: toEnDigits(x.closes).replace(/[٫.]/g, ':') })),
    socials: (v.socials || []).map(x => ({ kind: x.kind, url: x.url })),
    map_url: { neshan: v.map_neshan || '', balad: v.map_balad || '', google: v.map_google || '' },
    show: {},
  };
  for (const k of SHOW_KEYS) out.show[k] = !!v[`show_${k}`];
  return out;
}

// ---- custom fields ----------------------------------------------------------
// LTR input that shows Persian digits while typing and yields Latin digits;
// `clean` turns the typed text into the stored value
function digitField({ name, label, hint, required, rules = [], placeholder, inputmode = 'numeric', maxLength, clean = toEnDigits, type = 'text' }) {
  const input = h('input.a-input.a-ltr.a-num', { type: 'text', inputmode, dir: 'ltr', autocomplete: 'off', placeholder, maxlength: maxLength || null });
  const f = makeField({ name, label, hint, required, control: input, focusEl: input, type, rules,
    get: () => clean(input.value), set: v => { input.value = toFaDigits(v ?? ''); } });
  input.addEventListener('input', () => { const pos = input.selectionStart; input.value = toFaDigits(input.value); try { input.setSelectionRange(pos, pos); } catch { /* n/a */ } if (f.el.classList.contains('is-invalid')) f.validate(); f.emit(); });
  input.addEventListener('blur', () => { if (f.value) f.validate(); });
  return f;
}
// national phone: 0 + area code, Persian or Latin digits, +… for foreign numbers
const phoneField = ({ name, label, hint, typeOf }) => digitField({ name, label, hint, required: true, inputmode: 'tel', placeholder: '۰۲۸…', type: 'tel', clean: stripPhone, rules: [v => phoneMessage(typeOf(), v)] });
// HH:MM
const timeField = ({ name, label }) => digitField({ name, label, required: true, placeholder: '۰۹:۰۰', maxLength: 5, type: 'time', clean: v => toEnDigits(v).replace(/[٫.]/g, ':'), rules: [v => (hhmmOk(v) ? null : T.hhmm)] });
// week-day chips → ['Sa', 'Mo', …] in Persian week order
function daysField({ name, label }) {
  const boxes = new Map();
  const control = h('div.si-days', { role: 'group', 'aria-label': label });
  for (const [code, fa] of DAYS) {
    const cb = h('input', { type: 'checkbox', value: code });
    boxes.set(code, cb);
    control.appendChild(h('label.si-day', cb, h('span', fa)));
  }
  const f = makeField({ name, label, control, labelFor: false, type: 'days', rules: [v => (v.length ? null : T.daysRequired)],
    get: () => DAYS.map(([c]) => c).filter(c => boxes.get(c).checked), set: v => { const set = new Set(Array.isArray(v) ? v : []); for (const [c, cb] of boxes) cb.checked = set.has(c); } });
  control.addEventListener('change', () => { if (f.el.classList.contains('is-invalid')) f.validate(); f.emit(); });
  f.focus = () => boxes.get('Sa').focus();
  return f;
}

// ---- preview ------------------------------------------------------------------
function renderPreview(box, v, lang) {
  const s = toServer(v);
  const pick = o => (o && (o[lang] || o[lang === 'fa' ? 'en' : 'fa'])) || '';
  const L = lang === 'fa'
    ? { landline: 'تلفن ثابت', mobile: 'موبایل', email: 'ایمیل', address: T.pvAddress, hours: T.pvHours, map: T.pvMap, unset: T.pvUnset, hidden: T.pvHidden }
    : { landline: 'Landline', mobile: 'Mobile', email: 'Email', address: 'Address', hours: 'Hours', map: 'Directions', unset: 'not specified', hidden: 'hidden' };
  const row = (ic, label, value, { hidden = false, ltr = false } = {}) => h('div', { class: ['si-pv__row', hidden && 'is-hidden'] },
    h('span.si-pv__k', icon(ic, { size: 'sm' }), label, hidden ? badge(L.hidden, { icon: 'eye-off' }) : null),
    h('span', { class: ['si-pv__v', ltr && 'a-ltr'], lang: ltr ? 'en' : lang, dir: ltr ? 'ltr' : null }, value));
  const rows = [];
  rows.push(h('div.si-pv__brand', h('span.si-pv__mark', { 'aria-hidden': 'true' }, 'SQ'), h('span', h('div.si-pv__name', { dir: 'ltr' }, s.brand || 'SysaiQ'), h('div.si-pv__owner', pick(s.legal_name)))));
  rows.push(row('layers', L.address, pick(s.address) || h('span.a-muted', L.unset), { hidden: !s.show.address }));
  const phones = s.phones.filter(p => p.e164);
  if (!phones.length) rows.push(row('phone', L.mobile, h('span.a-muted', T.pvNoPhone)));
  for (const p of phones) rows.push(row('phone', L[p.type], h('a.a-link', { href: `tel:${p.e164}`, dir: 'ltr' }, lang === 'fa' ? p.display_fa : p.display_en), { hidden: !s.show[p.type], ltr: true }));
  rows.push(row('mail', L.email, s.email ? (linkableEmail(s.email) ? h('a.a-link', { href: `mailto:${linkableEmail(s.email)}`, dir: 'ltr' }, s.email) : h('span', { dir: 'ltr' }, s.email)) : h('span.a-muted', L.unset), { hidden: !s.show.email, ltr: true }));
  rows.push(row('clock', L.hours, pick(s.hours) || h('span.a-muted', L.unset), { hidden: !s.show.hours }));
  const maps = Object.entries(s.map_url).filter(([, u]) => u);
  if (maps.length) rows.push(row('globe', L.map, h('span.si-pv__links', maps.map(([k, u]) => (linkableUrl(u) ? h('a.a-link', { href: linkableUrl(u), target: '_blank', rel: 'noopener noreferrer' }, MAP_LABELS[k]) : h('span.a-muted', MAP_LABELS[k])))), { hidden: !s.show.map }));
  const socials = s.socials.filter(x => x.kind && x.url);
  if (socials.length) rows.push(h('div', { class: ['si-pv__socials', !s.show.socials && 'is-hidden'] }, socials.map(x => badge(SOCIAL_LABELS[x.kind] || x.kind, { icon: 'link' })), !s.show.socials ? badge(L.hidden, { icon: 'eye-off' }) : null));
  box.replaceChildren(...rows);
}

// ---- view ---------------------------------------------------------------------
async function mount(root, ctx) {
  ensureStylesheet(CSS_HREF);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle }));
  const holder = h('div.si-holder', skeleton({ kind: 'form' }));
  root.appendChild(holder);

  let data;
  try { data = await api.get('/site-info'); } catch (e) {
    holder.replaceChildren(errorState({ title: T.loadError, error: e, retry: () => ctx.router.reload() }));
    return;
  }
  if (!root.isConnected) return;
  const socialKinds = (data.options?.social_kinds || Object.keys(SOCIAL_LABELS)).map(k => ({ value: k, label: SOCIAL_LABELS[k] || k }));

  // ---- fields ----
  const brand = field({ name: 'brand', label: T.brand, required: true, maxLength: 60, hint: T.brandHint, dir: 'ltr', lang: 'en' });
  const legalName = bilingualField({ name: 'legal_name', label: T.legalName, hint: T.legalNameHint, requiredFa: true, maxLength: 120 });
  const address = bilingualField({ name: 'address', label: T.address, type: 'textarea', rows: 2, maxLength: 300, requiredFa: true });
  const city = bilingualField({ name: 'city', label: T.city, maxLength: 80 });
  const region = bilingualField({ name: 'region', label: T.region, maxLength: 80 });
  const country = field({ name: 'country', label: T.country, hint: T.countryHint, dir: 'ltr', lang: 'en', mono: true, maxLength: 2, rules: [validators.pattern(/^[A-Za-z]{2}$/, STR.fields.invalid)] });
  country.control.addEventListener('input', () => { country.control.value = country.control.value.toUpperCase(); });
  const postal = digitField({ name: 'postal_code', label: T.postal, hint: T.postalHint, maxLength: 20, rules: [v => (/^[0-9-]{0,20}$/.test(String(v || '')) ? null : STR.fields.integer)] });
  const geoLat = numberField({ name: 'geo_lat', label: T.geoLat, integer: false, min: -90, max: 90 });
  const geoLng = numberField({ name: 'geo_lng', label: T.geoLng, integer: false, min: -180, max: 180, hint: T.geoHint });
  const showAddress = switchField({ name: 'show_address', label: T.showAddress });

  const phones = repeater({
    name: 'phones', label: T.secPhones, addLabel: T.addPhone, itemLabel: T.phoneItem, max: 6, empty: { type: 'mobile', number: '', display_fa: '', display_en: '' },
    item: () => {
      const type = selectField({ name: 'type', label: T.phoneType, options: [{ value: 'landline', label: T.landline }, { value: 'mobile', label: T.mobile }] });
      const number = phoneField({ name: 'number', label: T.phoneNumber, hint: T.phoneNumberHint, typeOf: () => type.value });
      const dfa = field({ name: 'display_fa', label: T.displayFa, maxLength: 40 });
      const den = field({ name: 'display_en', label: T.displayEn, maxLength: 40, dir: 'ltr', lang: 'en' });
      let touchedFa = false, touchedEn = false;
      dfa.control.addEventListener('input', () => { touchedFa = true; });
      den.control.addEventListener('input', () => { touchedEn = true; });
      // display strings follow the number until the owner edits them by hand, and only once the number is valid
      const regen = () => { const n = nationalPhone(number.value); if (!n || phoneMessage(type.value, n)) return; if (!touchedFa || !dfa.value) dfa.value = displayFaFor(type.value, n); if (!touchedEn || !den.value) den.value = displayEnFor(type.value, n); };
      const placeholder = () => { number.control.placeholder = type.value === 'mobile' ? '۰۹۱۲…' : '۰۲۸…'; };
      number.onChange(regen);
      type.onChange(() => { placeholder(); if (number.value) number.validate(); regen(); });
      queueMicrotask(placeholder); // the row's values are read right after item() returns
      return { fields: [type, number, dfa, den], render: () => h('div.a-form__grid.a-form__grid--2', type.el, number.el, dfa.el, den.el) };
    },
  });
  const showLandline = switchField({ name: 'show_landline', label: T.showLandline });
  const showMobile = switchField({ name: 'show_mobile', label: T.showMobile });

  const email = field({ name: 'email', label: T.email, type: 'email', required: true, maxLength: 254, dir: 'ltr', lang: 'en', hint: T.emailHint });
  const showEmail = switchField({ name: 'show_email', label: T.showEmail });

  const hours = bilingualField({ name: 'hours', label: T.hoursText, hint: T.hoursTextHint, maxLength: 200 });
  const hoursSpec = repeater({
    name: 'hours_spec', label: T.hoursSpec, addLabel: T.addHours, itemLabel: T.hoursItem, max: 14, empty: { days: [], opens: '09:00', closes: '17:00' },
    item: () => {
      const days = daysField({ name: 'days', label: T.days });
      const opens = timeField({ name: 'opens', label: T.opens });
      const closes = timeField({ name: 'closes', label: T.closes });
      closes.rules.push(v => (hhmmOk(v) && hhmmOk(opens.value) && closes.value <= opens.value ? T.closesAfter : null));
      return { fields: [days, opens, closes], render: () => h('div.a-stack.a-stack--sm', days.el, h('div.a-form__grid.a-form__grid--2', opens.el, closes.el)) };
    },
  });
  const showHours = switchField({ name: 'show_hours', label: T.showHours });

  const mapNeshan = field({ name: 'map_neshan', label: MAP_LABELS.neshan, type: 'url', dir: 'ltr', lang: 'en', placeholder: 'https://nshn.ir/…', rules: [validators.url({ https: true })] });
  const mapBalad = field({ name: 'map_balad', label: MAP_LABELS.balad, type: 'url', dir: 'ltr', lang: 'en', placeholder: 'https://balad.ir/…', rules: [validators.url({ https: true })] });
  const mapGoogle = field({ name: 'map_google', label: MAP_LABELS.google, type: 'url', dir: 'ltr', lang: 'en', placeholder: 'https://maps.app.goo.gl/…', rules: [validators.url({ https: true })] });
  const showMap = switchField({ name: 'show_map', label: T.showMap });

  const socials = repeater({
    name: 'socials', label: T.secSocials, addLabel: T.addSocial, itemLabel: T.socialItem, max: 8, empty: { kind: 'instagram', url: '' },
    rules: [v => (new Set(v.map(x => x.kind)).size !== v.length ? T.socialDup : null)],
    item: () => {
      const kind = selectField({ name: 'kind', label: T.socialKind, options: socialKinds });
      const url = field({ name: 'url', label: T.socialUrl, type: 'url', required: true, dir: 'ltr', lang: 'en', maxLength: 500, rules: [validators.url({ https: true })], placeholder: SOCIAL_HINT.instagram });
      kind.onChange(k => { url.control.placeholder = SOCIAL_HINT[k] || 'https://'; });
      return { fields: [kind, url], render: () => h('div.si-social', kind.el, url.el) };
    },
  });
  const showSocials = switchField({ name: 'show_socials', label: T.showSocials });

  // ---- preview card ----
  const pvFa = h('div.si-pv', { lang: 'fa' });
  const pvEn = h('div.si-pv', { lang: 'en', dir: 'ltr' });
  const completeBadge = h('div');
  const previewCard = card({
    title: T.preview, hint: T.previewHint, cls: 'si-preview', actions: [completeBadge],
    body: tabs({ remember: 'site-info-preview', items: [{ id: 'fa', label: STR.fields.faLabel, panel: pvFa }, { id: 'en', label: STR.fields.enLabel, panel: pvEn }] }),
  });
  const paintComplete = ok => completeBadge.replaceChildren(ok ? badge(T.complete, { kind: 'ok', icon: 'check-circle' }) : badge(T.notComplete, { kind: 'warn', icon: 'alert-triangle' }));
  const isComplete = v => !!(v.address?.fa && v.address?.en && (v.phones || []).some(p => nationalPhone(p.number)) && v.email);

  // ---- form ----
  let bar = null;
  const section = (title, hint, ...nodes) => h('section.a-form__section', h('h3', title), hint ? h('div.a-hint', hint) : null, ...nodes);
  const grid2 = (...els) => h('div.a-form__grid.a-form__grid--2', ...els);
  const paint = v => { renderPreview(pvFa, v, 'fa'); renderPreview(pvEn, v, 'en'); paintComplete(isComplete(v)); };
  const form = createForm({
    dirtyToken: 'site-info',
    fields: [brand, legalName, address, city, region, country, postal, geoLat, geoLng, showAddress, phones, showLandline, showMobile, email, showEmail, hours, hoursSpec, showHours, mapNeshan, mapBalad, mapGoogle, showMap, socials, showSocials],
    render: () => h('div.si-sections',
      section(T.secIdentity, T.secIdentityHint, brand.el, legalName.el),
      section(T.secAddress, T.secAddressHint, address.el, grid2(city.el, region.el), grid2(country.el, postal.el), grid2(geoLat.el, geoLng.el), showAddress.el),
      section(T.secPhones, T.secPhonesHint, phones.el, grid2(showLandline.el, showMobile.el)),
      section(T.secEmail, null, email.el, showEmail.el),
      section(T.secHours, T.secHoursHint, hours.el, hoursSpec.el, showHours.el),
      section(T.secMap, T.secMapHint, mapNeshan.el, mapBalad.el, mapGoogle.el, showMap.el),
      section(T.secSocials, T.secSocialsHint, socials.el, showSocials.el)),
    values: toForm(data.site_info),
    onChange: paint,
    onDirty: d => bar?.setDirty(d),
    async onSubmit(v) {
      try {
        const r = await api.put('/site-info', toServer(v));
        form.setValues(toForm(r.site_info));
        paint(form.getValues());
        paintComplete(!!r.complete);
        toast(T.saved, { action: { label: `${T.viewSite} ↗`, onClick: () => window.open('/fa/contact', '_blank', 'noopener') } });
        if (!r.complete) toast.warn(T.incomplete, { timeout: 5000 });
        return true;
      } catch (e) {
        if (e?.status === 422 && e.fields) { applyServerErrors(e.fields); return false; }
        throw e;
      }
    },
  });
  paint(form.getValues());
  paintComplete(!!data.complete);

  // 422 paths from lib/siteinfo.js → our field names (phones[0].e164 → that row's number field)
  function applyServerErrors(fields) {
    const mapped = {};
    for (const [k, msg] of Object.entries(fields)) {
      let m;
      if ((m = /^phones\[(\d+)\]\.(\w+)$/.exec(k))) { const row = phones.rows[Number(m[1])]; const f = row?.fields.find(x => x.name === (m[2] === 'e164' ? 'number' : m[2])); if (f) { f.setError(m[2] === 'e164' ? phoneMessage(row.fields[0].value, f.value) || msg : msg); continue; } }
      if ((m = /^socials\[(\d+)\]\.(\w+)$/.exec(k))) { const f = socials.rows[Number(m[1])]?.fields.find(x => x.name === m[2]); if (f) { f.setError(msg); continue; } }
      if ((m = /^hours_spec\[(\d+)\]\.(\w+)$/.exec(k))) { const f = hoursSpec.rows[Number(m[1])]?.fields.find(x => x.name === m[2]); if (f) { f.setError(msg); continue; } }
      if ((m = /^map_url\.(\w+)$/.exec(k))) { mapped[`map_${m[1]}`] = msg; continue; }
      if ((m = /^show\.(\w+)$/.exec(k))) { mapped[`show_${m[1]}`] = msg; continue; }
      if ((m = /^geo\.(\w+)$/.exec(k))) { mapped[`geo_${m[1]}`] = msg; continue; }
      if ((m = /^(legal_name|address|city|region|hours)\.(fa|en)$/.exec(k))) { const f = form.byName[m[1]]; if (f) { f[m[2]].setError(msg); continue; } }
      mapped[k] = msg;
    }
    form.setErrors(mapped, { message: STR.errors.validation });
    form.el.querySelector('.is-invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  const banner = h('div.si-warn', { role: 'note' }, icon('shield-check'), h('div', h('strong', T.enamadWarn), h('div.a-small', T.enamadWarnHint)));
  bar = stickyActionBar({ actions: [submitButton(form, { label: STR.actions.saveAndPublish })] });
  holder.replaceChildren(banner, h('div.si-layout', card({ body: form.el }), previewCard), bar);
  return () => form.destroy();
}

// pure helpers, exported for test/admin/content-view.test.js
export const helpers = { nationalPhone, toE164, phoneMessage, displayFaFor, displayEnFor, toForm, toServer, hhmmOk, linkableUrl, linkableEmail };

export default { title: T.title, mount };
