// Bilingual 404 on the shared layout, sent by routes/public/notfound.routes.js
// once every site route has passed with next(). `lang` defaults to fa (the
// site's default).
import { renderLayout } from './layout.js';

const STR = {
  fa: {
    title: 'صفحه پیدا نشد', code: '404',
    text: 'نشانی‌ای که وارد کرده‌اید وجود ندارد یا جابه‌جا شده است.',
    home: 'صفحهٔ اصلی', work: 'نمونه‌کارها', services: 'خدمات', contact: 'تماس با ما',
  },
  en: {
    title: 'Page not found', code: '404',
    text: 'The address you entered does not exist or has moved.',
    home: 'Home', work: 'Work', services: 'Services', contact: 'Contact us',
  },
};

export function renderNotFound(lang = 'fa') {
  lang = lang === 'en' ? 'en' : 'fa';
  const t = STR[lang];
  const body = `<div class="wrap page-404">
  <p class="eyebrow mono" dir="ltr">[ SYSAIQ—ERROR / ${t.code} ]</p>
  <h1>${t.title}</h1>
  <p class="sub">${t.text}</p>
  <div class="actions">
    <a class="btn btn-primary" href="/${lang}/">${t.home}</a>
    <a class="btn btn-ghost" href="/${lang}/services">${t.services}</a>
    <a class="btn btn-ghost" href="/${lang}/work">${t.work}</a>
    <a class="btn btn-ghost" href="/${lang}/contact">${t.contact}</a>
  </div>
</div>`;
  return renderLayout({
    lang, title: t.title, description: t.text, noindex: true, bodyClass: 'page-notfound',
    // the canonical is the home page: a 404 must not advertise its own URL
    canonicalPath: `/${lang}/`, body,
  });
}
