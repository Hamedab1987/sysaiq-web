// Site identity + contact facts (settings.site_info, migration 005).
//   getSiteInfo('fa')  → render-ready view (display strings, tel:/mailto:, map links…)
//   tokens('fa')       → {'site.address', 'site.landline', …} for renderMarkdown()
//   publicSiteInfo()   → the stored object, normalised to the schema (admin GET only)
//   publicSiteInfoView() → publicSiteInfo() with the owner's show.* flags applied:
//                        what /api/public/site and the JSON-LD may expose
//   validateSiteInfo(body) → cleaned object or HttpError 422 (admin PUT)
// The stored row is normalised on every read (missing keys ← defaults,
// wrong types ← defaults) so a hand-edited or half-migrated row can never
// crash a page render.
import { getSetting } from '../db/index.js';
import { registerSetting } from './registry.js';
import { v, validate } from './validate.js';
import { HttpError } from './errors.js';
import { toLatinDigits, toFaDigits } from './normalize.js';
import { SITE_INFO_DEFAULTS, SITE_INFO_KEY } from '../db/migrations/005_site_info.js';

export { SITE_INFO_DEFAULTS, SITE_INFO_KEY };

export const PHONE_TYPES = Object.freeze(['landline', 'mobile']);
export const SOCIAL_KINDS = Object.freeze(['whatsapp', 'telegram', 'instagram', 'linkedin', 'github', 'x']);
export const MAP_KEYS = Object.freeze(['neshan', 'balad', 'google']);
export const SHOW_KEYS = Object.freeze(['address', 'landline', 'mobile', 'email', 'hours', 'map', 'socials']);
const DAYS = Object.freeze(['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']);
const E164_RE = /^\+[1-9]\d{6,14}$/;

// business types offered by the lead form = the assistant's "Pitch" industries + other
export const BUSINESS_TYPES = Object.freeze([
  { value: 'restaurant-cafe', fa: 'رستوران و کافه', en: 'Restaurant & cafe' },
  { value: 'supermarket-retail', fa: 'سوپرمارکت و خرده‌فروشی', en: 'Supermarket & retail' },
  { value: 'clothing-boutique', fa: 'پوشاک و بوتیک', en: 'Clothing & boutique' },
  { value: 'real-estate', fa: 'مشاور املاک', en: 'Real-estate agency' },
  { value: 'medical-clinic', fa: 'مطب و کلینیک پزشکی', en: 'Medical clinic' },
  { value: 'dental-beauty-clinic', fa: 'کلینیک دندان‌پزشکی و زیبایی', en: 'Dental & beauty clinic' },
  { value: 'salon-barbershop', fa: 'سالن زیبایی و آرایشگاه', en: 'Beauty salon & barbershop' },
  { value: 'gym-fitness', fa: 'باشگاه ورزشی', en: 'Gym & fitness studio' },
  { value: 'law-firm', fa: 'وکالت و دفتر حقوقی', en: 'Lawyers & law firms' },
  { value: 'architects-construction', fa: 'معماری و ساختمان', en: 'Architects & construction' },
  { value: 'hotels', fa: 'هتل و اقامتگاه', en: 'Hotels & guesthouses' },
  { value: 'education', fa: 'مدرسه و آموزشگاه', en: 'Schools & training institutes' },
  { value: 'distribution-fmcg', fa: 'پخش و FMCG', en: 'Distribution & FMCG' },
  { value: 'manufacturing', fa: 'کارخانه و تولیدی', en: 'Factories & manufacturers' },
  { value: 'traders-investors', fa: 'تریدر و سرمایه‌گذار', en: 'Traders & investors' },
  { value: 'ecommerce', fa: 'فروشگاه اینترنتی و اینستاگرامی', en: 'E-commerce & Instagram shops' },
  { value: 'other', fa: 'سایر', en: 'Other' },
]);

// ---- validation schema (admin PUT) ---------------------------------------
const bilingual = max => v.json({ en: v.str({ max }), fa: v.str({ max }) });
const digits = rule => (x, key) => rule(toLatinDigits(x), key);
const e164 = digits((x, key) => v.str({ min: 8, max: 16, pattern: E164_RE })(String(x ?? '').replace(/[\s\-().‌]/g, ''), key));
const optHttps = v.default(v.optional(v.url({ https: true, max: 500 })), '');
// lat/lng as strings validated by range-checking patterns (no Fail class is exported by lib/validate.js)
const LAT_RE = /^-?(?:90(?:\.0{1,8})?|[1-8]?\d(?:\.\d{1,8})?)$/;
const LNG_RE = /^-?(?:180(?:\.0{1,8})?|1[0-7]\d(?:\.\d{1,8})?|[1-9]?\d(?:\.\d{1,8})?)$/;
const coord = re => digits((x, key) => Number(v.str({ min: 1, max: 12, pattern: re })(typeof x === 'number' ? String(x) : x, key)));
const dayList = v.array(v.oneOf(DAYS), { max: 7 });
const hhmm = digits(v.str({ pattern: /^(?:[01]\d|2[0-3]):[0-5]\d$/, max: 5, min: 5 }));

export const SITE_INFO_SCHEMA = {
  brand: v.default(v.str({ min: 1, max: 60 }), SITE_INFO_DEFAULTS.brand),
  legal_name: bilingual(120),
  address: bilingual(300),
  city: bilingual(80),
  region: bilingual(80),
  country: v.default(v.str({ pattern: /^[A-Z]{2}$/, min: 2, max: 2 }), 'IR'),
  postal_code: v.default(digits(v.str({ max: 20, pattern: /^[0-9-]{0,20}$/ })), ''),
  geo: v.optional(v.json({ lat: coord(LAT_RE), lng: coord(LNG_RE) })),
  phones: v.array(v.json({
    type: v.oneOf(PHONE_TYPES),
    e164,
    display_fa: v.str({ max: 40 }),
    display_en: v.str({ max: 40 }),
  }), { max: 6 }),
  email: v.email({ max: 254 }),
  hours: bilingual(200),
  hours_spec: v.array(v.json({ days: dayList, opens: hhmm, closes: hhmm }), { max: 14 }),
  socials: v.array(v.json({ kind: v.oneOf(SOCIAL_KINDS), url: v.url({ https: true, max: 500 }) }), { max: 8 }),
  map_url: v.default(v.json({ neshan: optHttps, balad: optHttps, google: optHttps }), { neshan: '', balad: '', google: '' }),
  show: v.default(v.json(Object.fromEntries(SHOW_KEYS.map(k => [k, v.default(v.bool(), true)]))), { ...SITE_INFO_DEFAULTS.show }),
};

registerSetting({ key: SITE_INFO_KEY, public: false, schema: SITE_INFO_SCHEMA });

// admin PUT body → the exact stored shape, or HttpError 422 {fields}
export function validateSiteInfo(body) {
  const out = validate(SITE_INFO_SCHEMA, body && typeof body === 'object' ? body : {});
  out.geo = out.geo ?? null;
  for (const p of out.phones) {
    if (!p.display_en) p.display_en = p.e164;
    if (!p.display_fa) p.display_fa = toFaDigits(nationalFormat(p.e164));
  }
  const kinds = new Set();
  for (const s of out.socials) {
    if (kinds.has(s.kind)) throw new HttpError(422, 'validation', 'Validation failed', { socials: `هر شبکه فقط یک بار: ${s.kind}` });
    kinds.add(s.kind);
  }
  return out;
}

// '+982833323002' → '02833323002' for Iranian numbers, else the e164 itself
const nationalFormat = e => (e.startsWith('+98') ? `0${e.slice(3)}` : e);

// ---- read side ------------------------------------------------------------
const isObj = x => x && typeof x === 'object' && !Array.isArray(x);
const str = (x, max = 500) => (typeof x === 'string' ? x.slice(0, max) : '');
const bi = (x, d) => (isObj(x) ? { en: str(x.en, 500) || '', fa: str(x.fa, 500) || '' } : { ...d });

// stored row (any shape) → exactly the schema, defaults filling the gaps
export function normalizeSiteInfo(raw) {
  const D = SITE_INFO_DEFAULTS;
  const r = isObj(raw) ? raw : {};
  const geo = isObj(r.geo) && Number.isFinite(Number(r.geo.lat)) && Number.isFinite(Number(r.geo.lng))
    ? { lat: Number(r.geo.lat), lng: Number(r.geo.lng) } : null;
  const phones = (Array.isArray(r.phones) ? r.phones : D.phones)
    .filter(p => isObj(p) && PHONE_TYPES.includes(p.type) && E164_RE.test(String(p.e164 || '')))
    .slice(0, 6)
    .map(p => ({
      type: p.type,
      e164: String(p.e164),
      display_fa: str(p.display_fa, 40) || toFaDigits(nationalFormat(String(p.e164))),
      display_en: str(p.display_en, 40) || String(p.e164),
    }));
  const socials = (Array.isArray(r.socials) ? r.socials : [])
    .filter(s => isObj(s) && SOCIAL_KINDS.includes(s.kind) && /^https:\/\/[^\s/?#@]+\.[^\s/?#@]+/.test(String(s.url || '')))
    .slice(0, 8)
    .map(s => ({ kind: s.kind, url: str(s.url, 500) }));
  const map_url = {};
  for (const k of MAP_KEYS) {
    const u = str(isObj(r.map_url) ? r.map_url[k] : '', 500);
    map_url[k] = /^https:\/\//.test(u) ? u : '';
  }
  const show = {};
  for (const k of SHOW_KEYS) show[k] = isObj(r.show) && k in r.show ? !!r.show[k] : D.show[k];
  const hours_spec = (Array.isArray(r.hours_spec) ? r.hours_spec : [])
    .filter(h => isObj(h) && Array.isArray(h.days) && /^\d{2}:\d{2}$/.test(String(h.opens)) && /^\d{2}:\d{2}$/.test(String(h.closes)))
    .slice(0, 14)
    .map(h => ({ days: h.days.filter(d => DAYS.includes(d)), opens: String(h.opens), closes: String(h.closes) }));
  const email = str(r.email, 254).toLowerCase();
  return {
    brand: str(r.brand, 60) || D.brand,
    legal_name: bi(r.legal_name, D.legal_name),
    address: bi(r.address, D.address),
    city: bi(r.city, D.city),
    region: bi(r.region, D.region),
    country: /^[A-Z]{2}$/.test(String(r.country || '')) ? r.country : D.country,
    postal_code: /^[0-9-]{0,20}$/.test(str(r.postal_code, 20)) ? str(r.postal_code, 20) : '',
    geo,
    phones,
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : D.email,
    hours: bi(r.hours, D.hours),
    hours_spec,
    socials,
    map_url,
    show,
  };
}

// the stored object, the schema and nothing else — the admin's editing view.
// Public surfaces must go through publicSiteInfoView() / getSiteInfo().
export function publicSiteInfo() {
  return normalizeSiteInfo(getSetting(SITE_INFO_KEY, null));
}

const emptyBi = () => ({ en: '', fa: '' });
const emptyMaps = () => Object.fromEntries(MAP_KEYS.map(k => [k, '']));

// show.* applied to a normalised object: a hidden phone is removed, hidden
// e-mail/address/hours are blanked, socials/map links are dropped. Geo and
// the postal code follow the address (they locate the owner just as well).
// Same shape as publicSiteInfo(), so a client can't tell "hidden" from "unset".
export function applyShow(info) {
  const { show } = info;
  return {
    ...info,
    address: show.address ? info.address : emptyBi(),
    postal_code: show.address ? info.postal_code : '',
    geo: show.address ? info.geo : null,
    phones: info.phones.filter(p => show[p.type]),
    email: show.email ? info.email : '',
    hours: show.hours ? info.hours : emptyBi(),
    hours_spec: show.hours ? info.hours_spec : [],
    socials: show.socials ? info.socials : [],
    map_url: show.map ? info.map_url : emptyMaps(),
  };
}

// the public JSON view (GET /api/public/site): visible data only
export function publicSiteInfoView() {
  return applyShow(publicSiteInfo());
}

const L = {
  fa: {
    landline: 'تلفن ثابت', mobile: 'موبایل', email: 'ایمیل', address: 'نشانی', hours: 'ساعات کاری',
    map: 'مسیریابی', neshan: 'نشان', balad: 'بلد', google: 'Google Maps',
    whatsapp: 'واتس‌اپ', telegram: 'تلگرام', instagram: 'اینستاگرام', linkedin: 'LinkedIn', github: 'GitHub', x: 'X',
    hoursUnset: 'اعلام‌نشده', country: 'ایران',
  },
  en: {
    landline: 'Landline', mobile: 'Mobile', email: 'Email', address: 'Address', hours: 'Hours',
    map: 'Directions', neshan: 'Neshan', balad: 'Balad', google: 'Google Maps',
    whatsapp: 'WhatsApp', telegram: 'Telegram', instagram: 'Instagram', linkedin: 'LinkedIn', github: 'GitHub', x: 'X',
    hoursUnset: 'not specified', country: 'Iran',
  },
};

// render-ready view for one language. Every string is plain text: callers escape.
// The flat keys (landline, mobile, landline_tel, mobile_tel, whatsapp, telegram,
// instagram, linkedin, map_url, hours, owner_name, email, address) are what
// lib/sitecontext.js reads for the shared page chrome; the richer objects
// (phones, landline_phone, map_links, socials…) are for the contact slot.
// Everything here already honours show.*; only the *_full keys (and
// landline_phone/mobile_phone, flagged `visible`) carry hidden values, for
// tokens() — a {{site.*}} token is placed by the owner on purpose.
export function getSiteInfo(lang = 'fa') {
  const l = lang === 'fa' ? 'fa' : 'en';
  const T = L[l];
  const raw = publicSiteInfo();
  const info = applyShow(raw);
  const pick = o => o[l] || o[l === 'fa' ? 'en' : 'fa'] || '';
  const phones = raw.phones.map(p => ({
    type: p.type,
    e164: p.e164,
    display: l === 'fa' ? p.display_fa : p.display_en,
    tel: `tel:${p.e164}`,
    label: T[p.type],
    visible: raw.show[p.type],
  }));
  const socials = info.socials.map(s => ({ kind: s.kind, url: s.url, label: T[s.kind], icon: s.kind }));
  const map_links = MAP_KEYS.filter(k => info.map_url[k]).map(k => ({ key: k, url: info.map_url[k], label: T[k] }));
  const hours = pick(raw.hours);
  const landline = phones.find(p => p.type === 'landline') || null;
  const mobile = phones.find(p => p.type === 'mobile') || null;
  const social = kind => socials.find(s => s.kind === kind)?.url || '';
  return {
    lang: l,
    brand: info.brand,
    legal_name: pick(info.legal_name),
    owner_name: pick(info.legal_name),
    address: pick(info.address),
    address_full: pick(raw.address),
    city: pick(info.city),
    region: pick(info.region),
    country: info.country,
    country_name: T.country,
    postal_code: info.postal_code,
    postal_code_display: l === 'fa' ? toFaDigits(info.postal_code) : info.postal_code,
    geo: info.geo,
    email: info.email,
    email_full: raw.email,
    mailto: `mailto:${raw.email}`,
    hours: pick(info.hours),
    hours_display: hours || T.hoursUnset,
    hours_spec: info.hours_spec,
    phones,
    landline_phone: landline,
    mobile_phone: mobile,
    // flat strings for the shared chrome ('' when hidden or unset)
    landline: landline && landline.visible ? landline.display : '',
    landline_tel: landline && landline.visible ? landline.e164 : '',
    mobile: mobile && mobile.visible ? mobile.display : '',
    mobile_tel: mobile && mobile.visible ? mobile.e164 : '',
    socials,
    whatsapp: social('whatsapp'),
    telegram: social('telegram'),
    instagram: social('instagram'),
    linkedin: social('linkedin'),
    github: social('github'),
    x: social('x'),
    map_links,
    map_url: map_links.length ? map_links[0].url : '',
    show: info.show,
    labels: T,
  };
}

// {{site.*}} tokens for renderMarkdown(md, {tokens: tokens(lang)})
export function tokens(lang = 'fa') {
  const s = getSiteInfo(lang);
  return {
    'site.address': s.address_full,
    'site.landline': s.landline_phone?.display || '',
    'site.mobile': s.mobile_phone?.display || '',
    'site.email': s.email_full,
    'site.hours': s.hours_display,
    'site.owner_name': s.owner_name,
    'site.brand': s.brand,
  };
}

// for the admin setup checklist: address in both languages, a phone, an email
export function isContactComplete() {
  const i = publicSiteInfo();
  return !!(i.address.fa && i.address.en && i.phones.length && i.email);
}
