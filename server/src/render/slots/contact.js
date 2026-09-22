// Home-page CONTACT slot: the inner row of #contact (the template keeps its
// own eyebrow + h2). Left: the lead form posting JSON to /api/leads through
// /assets/site/contact.js. Right: click-to-call phones, e-mail, address,
// hours, map links, WhatsApp/Telegram and the charter link — all from
// settings.site_info. No inline handlers, no inline script; styles come from
// /assets/site/contact.css (glass panels over the letterforms).
//   render({lang})            → full slot HTML (link + row)
//   renderContactRow(lang, o) → the row only (the /contact page reuses it)
import { statSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../../db/index.js';
import { config } from '../../config.js';
import { esc, attr } from '../../lib/html.js';
import { getSiteInfo, BUSINESS_TYPES } from '../../lib/siteinfo.js';

// cache-busting version of the two contact assets, same recipe as
// render/layout.js's ASSET_V (mtime at boot; a deploy restarts the process):
// nginx serves /assets/ with a 7-day expiry, so a changed contact.css/js
// must get a new URL. '1' when the site dir has no assets (tests).
function assetVersion() {
  let v = 0;
  for (const f of ['contact.css', 'contact.js']) {
    try { v = Math.max(v, Math.floor(statSync(join(config.siteDir, 'assets', 'site', f)).mtimeMs)); } catch { /* missing asset */ }
  }
  return v ? v.toString(36) : '1';
}
export const CONTACT_ASSET_V = assetVersion();
export const CONTACT_CSS = `/assets/site/contact.css?v=${CONTACT_ASSET_V}`;
export const CONTACT_JS = `/assets/site/contact.js?v=${CONTACT_ASSET_V}`;

const CONTACT_PREFS = ['phone', 'email', 'whatsapp', 'telegram'];

const STR = {
  fa: {
    form_title: 'درخواست مشاوره و پیشنهاد کتبی',
    form_lead: 'چند خط دربارهٔ کسب‌وکارتان بنویسید؛ پیش از هر تعهدی، پیشنهاد کتبی می‌گیرید.',
    name: 'نام و نام خانوادگی', phone: 'شمارهٔ موبایل', email: 'ایمیل',
    business_type: 'نوع کسب‌وکار', service: 'خدمت موردنظر', message: 'پیام',
    choose: 'انتخاب کنید', pref: 'روش تماس ترجیحی',
    pref_phone: 'تماس تلفنی', pref_email: 'ایمیل', pref_whatsapp: 'واتس‌اپ', pref_telegram: 'تلگرام',
    consent_a: 'با ', consent_link: 'سیاست حریم خصوصی', consent_b: ' موافقم و می‌دانم اطلاعاتم فقط برای پاسخ به همین درخواست استفاده می‌شود.',
    submit: 'ارسال درخواست', required: 'الزامی', one_of: 'موبایل یا ایمیل، حداقل یکی',
    info_title: 'راه‌های تماس', charter_a: 'پیش از شروع، ', charter_link: 'شیوه‌نامهٔ ارائهٔ خدمات', charter_b: ' را بخوانید.',
    privacy_path: '/fa/privacy', charter_path: '/fa/charter',
    whatsapp_btn: 'گفت‌وگو در واتس‌اپ', telegram_btn: 'پیام در تلگرام',
    js_note: 'برای ارسال فرم، JavaScript مرورگر باید فعال باشد؛ در غیر این صورت با ما تماس بگیرید.',
  },
  en: {
    form_title: 'Request a consultation and written proposal',
    form_lead: 'Tell us a little about your business; you receive a written proposal before any commitment.',
    name: 'Full name', phone: 'Mobile number', email: 'Email',
    business_type: 'Type of business', service: 'Service', message: 'Message',
    choose: 'Choose', pref: 'Preferred way to reach you',
    pref_phone: 'Phone call', pref_email: 'Email', pref_whatsapp: 'WhatsApp', pref_telegram: 'Telegram',
    consent_a: 'I agree to the ', consent_link: 'privacy policy', consent_b: ' and understand my details are used only to answer this request.',
    submit: 'Send request', required: 'required', one_of: 'mobile or email, at least one',
    info_title: 'How to reach us', charter_a: 'Before we start, read the ', charter_link: 'service charter', charter_b: '.',
    privacy_path: '/en/privacy', charter_path: '/en/charter',
    whatsapp_btn: 'Chat on WhatsApp', telegram_btn: 'Message on Telegram',
    js_note: 'Sending the form needs JavaScript; otherwise call or email us.',
  },
};

// small inline icons (currentColor); no external requests, CSP-clean
const ICON = {
  phone: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1A17 17 0 0 1 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.6.1.3 0 .7-.2 1z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M3 6.5h18v11H3z"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="m3 7 9 6 9-6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 21s-6-5.7-6-11a6 6 0 0 1 12 0c0 5.3-6 11-6 11z"/><circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path fill="none" stroke="currentColor" stroke-width="1.6" d="M12 7.5V12l3 2"/></svg>',
  map: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.6" d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/></svg>',
  whatsapp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2.2a9.8 9.8 0 0 0-8.4 14.8L2.2 22l5.2-1.4A9.8 9.8 0 1 0 12 2.2zm0 1.8a8 8 0 1 1-4.1 14.9l-.3-.2-3 .8.8-2.9-.2-.3A8 8 0 0 1 12 4zm-3 4.3c-.2 0-.5 0-.7.3-.3.3-1 1-1 2.4s1 2.8 1.2 3c.1.2 2 3.2 5 4.4 2.5 1 3 .8 3.5.7.5 0 1.7-.7 1.9-1.4.2-.7.2-1.3.2-1.4l-.6-.3-2-.9c-.3-.1-.5-.2-.7.1l-.9 1.1c-.2.2-.3.2-.6.1a6.6 6.6 0 0 1-3.3-2.9c-.2-.4.3-.4.7-1.3.1-.2 0-.4 0-.5l-.9-2.2c-.2-.6-.5-.5-.7-.5z"/></svg>',
  telegram: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M21.5 4.6 18.6 19c-.2 1-.8 1.2-1.6.8l-4.4-3.3-2.1 2c-.2.3-.4.5-.9.5l.3-4.5 8.1-7.3c.4-.3-.1-.5-.5-.2L7.4 13.4 3.1 12c-.9-.3-1-.9.2-1.4l16.9-6.5c.8-.3 1.5.2 1.3 1.5z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.8" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="17" cy="7" r="1" fill="currentColor"/></svg>',
  linkedin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M4.5 3.5a1.9 1.9 0 1 1 0 3.8 1.9 1.9 0 0 1 0-3.8zM3 9h3v11H3zm6 0h2.9v1.5c.4-.8 1.5-1.7 3.1-1.7 3.3 0 3.9 2.2 3.9 5V20h-3v-5.3c0-1.3 0-2.9-1.8-2.9s-2.1 1.4-2.1 2.8V20H9z"/></svg>',
  github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2a10 10 0 0 0-3.2 19.5c.5.1.7-.2.7-.5v-1.8c-2.8.6-3.4-1.2-3.4-1.2-.4-1.1-1.1-1.4-1.1-1.4-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.2-.2-4.6-1.1-4.6-4.9 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.8 1a9.5 9.5 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.8-2.3 4.7-4.6 4.9.4.3.7 1 .7 1.9v2.9c0 .3.2.6.7.5A10 10 0 0 0 12 2z"/></svg>',
  x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.5 3h3l-7 8 8.2 10h-6.4l-5-6.5L4.6 21h-3l7.5-8.6L1.3 3h6.5l4.5 6z"/></svg>',
};

// published services for the "service" select, when that table exists (other owner)
function services(lang) {
  try {
    const has = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='services'").get();
    if (!has) return [];
    const rows = db.prepare('SELECT * FROM services WHERE published=1 ORDER BY sort, id').all();
    return rows
      .filter(r => typeof r.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(r.slug))
      .map(r => ({ slug: r.slug, title: String(r[`title_${lang}`] || r.title_fa || r.title_en || r.slug) }));
  } catch {
    return []; // a schema we don't know: the select is simply left out
  }
}

const field = (id, label, input, { hint = '', full = false } = {}) =>
  `<div class="ct-field${full ? ' ct-full' : ''}"><label for="${id}">${esc(label)}${hint ? ` <small>${esc(hint)}</small>` : ''}</label>${input}<small class="ct-err" id="${id}-err" role="alert"></small></div>`;

const select = (id, name, options, placeholder) =>
  `<select id="${id}" name="${name}"><option value="">${esc(placeholder)}</option>` +
  options.map(o => `<option value="${attr(o.value)}">${esc(o.label)}</option>`).join('') + '</select>';

export function renderLeadForm(lang, { page = `/${lang}/`, compact = false } = {}) {
  const l = lang === 'fa' ? 'fa' : 'en';
  const T = STR[l];
  const svc = services(l);
  const id = k => `ct-${k}`;
  return `<form class="ct-form glass" id="lead-form" action="/api/leads" method="post" novalidate data-lead-form data-lang="${l}">
  <input type="hidden" name="language" value="${l}">
  <input type="hidden" name="page" value="${attr(page)}">
  <div class="ct-hp" aria-hidden="true"><label for="${id('website')}">Website</label><input id="${id('website')}" type="text" name="website" tabindex="-1" autocomplete="off"></div>
  ${compact ? '' : `<h3 class="ct-title">${esc(T.form_title)}</h3><p class="ct-lead">${esc(T.form_lead)}</p>`}
  <div class="ct-grid">
    ${field(id('name'), T.name, `<input id="${id('name')}" name="name" type="text" required maxlength="120" autocomplete="name">`, { hint: T.required })}
    ${field(id('phone'), T.phone, `<input id="${id('phone')}" name="phone" type="tel" inputmode="tel" dir="ltr" maxlength="24" autocomplete="tel">`, { hint: T.one_of })}
    ${field(id('email'), T.email, `<input id="${id('email')}" name="email" type="email" dir="ltr" maxlength="254" autocomplete="email">`)}
    ${field(id('business'), T.business_type, select(id('business'), 'business_type', BUSINESS_TYPES.map(b => ({ value: b.value, label: b[l] })), T.choose))}
    ${svc.length ? field(id('service'), T.service, select(id('service'), 'service_slug', svc.map(s => ({ value: s.slug, label: s.title })), T.choose)) : ''}
    ${field(id('message'), T.message, `<textarea id="${id('message')}" name="message" rows="4" maxlength="5000"></textarea>`, { full: true })}
    <fieldset class="ct-pref ct-full"><legend>${esc(T.pref)}</legend>
      ${CONTACT_PREFS.map((p, i) => `<label><input type="radio" name="contact_pref" value="${p}"${i === 0 ? ' checked' : ''}> <span>${esc(T[`pref_${p}`])}</span></label>`).join('')}
    </fieldset>
    <div class="ct-field ct-full ct-consent"><label for="${id('consent')}"><input id="${id('consent')}" type="checkbox" name="consent" value="1" required> <span>${esc(T.consent_a)}<a href="${T.privacy_path}">${esc(T.consent_link)}</a>${esc(T.consent_b)}</span></label><small class="ct-err" id="${id('consent')}-err" role="alert"></small></div>
  </div>
  <p class="ct-msg" id="ct-msg" aria-live="polite" hidden></p>
  <div class="ct-actions"><button type="submit" class="ct-submit">${esc(T.submit)}</button></div>
  <noscript><p class="ct-noscript">${esc(T.js_note)}</p></noscript>
</form>`;
}

const item = (icon, label, body) => `<li class="ct-item"><span class="ct-ico">${ICON[icon]}</span><span class="ct-body"><span class="ct-label">${esc(label)}</span>${body}</span></li>`;

export function renderContactInfo(lang, { title = true } = {}) {
  const l = lang === 'fa' ? 'fa' : 'en';
  const T = STR[l];
  const s = getSiteInfo(l);
  const items = [];
  for (const p of s.phones) {
    if (!p.visible) continue;
    items.push(item('phone', p.label, `<a class="ct-tel" href="${attr(p.tel)}" dir="ltr"><bdi>${esc(p.display)}</bdi></a>`));
  }
  if (s.email) items.push(item('mail', s.labels.email, `<a class="ct-mail" href="${attr(s.mailto)}" dir="ltr">${esc(s.email)}</a>`));
  if (s.address) items.push(item('pin', s.labels.address, `<address class="ct-addr">${esc(s.address)}${s.postal_code ? `<br><span dir="ltr">${esc(s.postal_code_display)}</span>` : ''}</address>`));
  if (s.hours) items.push(item('clock', s.labels.hours, `<span>${esc(s.hours)}</span>`));
  if (s.show.map && s.map_links.length) {
    items.push(item('map', s.labels.map, `<span class="ct-maps">${s.map_links.map(m =>
      `<a href="${attr(m.url)}" target="_blank" rel="noopener noreferrer">${esc(m.label)}</a>`).join('')}</span>`));
  }
  const chat = [];
  if (s.whatsapp) chat.push(`<a class="ct-chat ct-wa" href="${attr(s.whatsapp)}" target="_blank" rel="noopener noreferrer">${ICON.whatsapp}<span>${esc(T.whatsapp_btn)}</span></a>`);
  if (s.telegram) chat.push(`<a class="ct-chat ct-tg" href="${attr(s.telegram)}" target="_blank" rel="noopener noreferrer">${ICON.telegram}<span>${esc(T.telegram_btn)}</span></a>`);
  const others = s.show.socials ? s.socials.filter(x => x.kind !== 'whatsapp' && x.kind !== 'telegram') : [];
  return `<aside class="ct-info glass" aria-label="${attr(T.info_title)}">
  ${title ? `<h3 class="ct-title">${esc(T.info_title)}</h3>` : ''}
  <ul class="ct-list">${items.join('')}</ul>
  ${chat.length ? `<div class="ct-chats">${chat.join('')}</div>` : ''}
  ${others.length ? `<div class="ct-socials">${others.map(x => `<a href="${attr(x.url)}" target="_blank" rel="noopener noreferrer" aria-label="${attr(x.label)}" title="${attr(x.label)}">${ICON[x.icon] || ''}</a>`).join('')}</div>` : ''}
  <p class="ct-charter">${esc(T.charter_a)}<a href="${T.charter_path}">${esc(T.charter_link)}</a>${esc(T.charter_b)}</p>
</aside>`;
}

// the whole row: form + info column
export function renderContactRow(lang, opts = {}) {
  return `<div class="ct-row">${renderLeadForm(lang, opts)}${renderContactInfo(lang, opts)}</div>`;
}

// SLOT:CONTACT — replaces the mailto button row inside #contact .wrap
export function renderContactSlot(lang) {
  const l = lang === 'fa' ? 'fa' : 'en';
  return `<link rel="stylesheet" href="${CONTACT_CSS}">
<div class="rv d2">${renderContactRow(l, { page: `/${l}/` })}</div>
<script src="${CONTACT_JS}" defer></script>`;
}

export function render({ lang = 'fa' } = {}) {
  return renderContactSlot(lang);
}
export default render;
