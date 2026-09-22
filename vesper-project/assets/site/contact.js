/* SysaiQ — lead form (home #contact slot + /:lang/contact page).
   Posts JSON to /api/leads, shows inline fa/en validation messages, disables
   the button while sending, and swaps the fields for a success message in
   place (no redirect). No inline handlers: CSP script-src 'self'. */
(function () {
  'use strict';

  var STR = {
    fa: {
      name: 'نام را وارد کنید.',
      one_of: 'شمارهٔ موبایل یا ایمیل را وارد کنید (حداقل یکی).',
      phone: 'شمارهٔ موبایل معتبر نیست.',
      email: 'ایمیل معتبر نیست.',
      consent: 'برای ارسال، با سیاست حریم خصوصی موافقت کنید.',
      sending: 'در حال ارسال…',
      ok: 'درخواست شما ثبت شد. در اولین فرصت با شما تماس می‌گیریم.',
      fail: 'ارسال انجام نشد. لطفاً دوباره تلاش کنید یا مستقیم تماس بگیرید.',
      rate: 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید.',
      fix: 'لطفاً موارد مشخص‌شده را اصلاح کنید.'
    },
    en: {
      name: 'Please enter your name.',
      one_of: 'Enter a mobile number or an email (at least one).',
      phone: 'This mobile number does not look valid.',
      email: 'This email does not look valid.',
      consent: 'Please agree to the privacy policy to send.',
      sending: 'Sending…',
      ok: 'Your request has been received. We will get back to you shortly.',
      fail: 'Sending failed. Please try again or call us directly.',
      rate: 'Too many requests; please try again a little later.',
      fix: 'Please correct the highlighted fields.'
    }
  };

  var FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹', AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  function latinDigits(s) {
    return String(s || '').replace(/[۰-۹٠-٩]/g, function (c) {
      var i = FA_DIGITS.indexOf(c); return String(i >= 0 ? i : AR_DIGITS.indexOf(c));
    });
  }
  function cleanPhone(s) {
    var d = latinDigits(s).replace(/[\s\-.()‌]/g, '');
    if (d.indexOf('00') === 0) d = '+' + d.slice(2);
    return d;
  }
  var PHONE_RE = /^\+?\d{7,15}$/;
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function fieldOf(form, name) {
    var el = form.elements[name];
    if (el && el.length && !el.tagName) el = el[0]; // RadioNodeList → first
    return el && el.closest ? el.closest('.ct-field') : null;
  }
  function setError(form, name, msg) {
    var box = fieldOf(form, name);
    if (!box) return;
    var err = box.querySelector('.ct-err');
    if (msg) { box.classList.add('is-invalid'); if (err) err.textContent = msg; }
    else { box.classList.remove('is-invalid'); if (err) err.textContent = ''; }
  }
  function clearErrors(form) {
    var boxes = form.querySelectorAll('.ct-field.is-invalid');
    for (var i = 0; i < boxes.length; i++) { boxes[i].classList.remove('is-invalid'); }
    var errs = form.querySelectorAll('.ct-err');
    for (var j = 0; j < errs.length; j++) { errs[j].textContent = ''; }
  }
  function message(form, kind, text) {
    var m = form.querySelector('.ct-msg');
    if (!m) return;
    m.className = 'ct-msg' + (kind ? ' ' + kind : '');
    m.textContent = text || '';
    m.hidden = !text;
  }

  function collect(form) {
    var f = form.elements;
    var val = function (n) { var el = f[n]; return el && typeof el.value === 'string' ? el.value.trim() : ''; };
    var pref = form.querySelector('input[name="contact_pref"]:checked');
    var body = {
      name: val('name'),
      phone: cleanPhone(val('phone')),
      email: val('email'),
      business_type: val('business_type'),
      service_slug: val('service_slug'),
      message: val('message'),
      contact_pref: pref ? pref.value : '',
      language: val('language') || (form.getAttribute('data-lang') || 'fa'),
      page: val('page') || location.pathname,
      website: val('website'),
      consent: !!(f.consent && f.consent.checked)
    };
    // empty optionals are left out so the server's "optional" rules apply
    var out = {};
    for (var k in body) if (body[k] !== '' && body[k] !== undefined) out[k] = body[k];
    if (!out.website) out.website = ''; // the honeypot is always sent (empty for humans)
    return out;
  }

  function validateLocal(form, body, T) {
    var ok = true;
    clearErrors(form);
    if (!body.name) { setError(form, 'name', T.name); ok = false; }
    if (!body.phone && !body.email) { setError(form, 'phone', T.one_of); ok = false; }
    if (body.phone && !PHONE_RE.test(body.phone)) { setError(form, 'phone', T.phone); ok = false; }
    if (body.email && !EMAIL_RE.test(body.email)) { setError(form, 'email', T.email); ok = false; }
    if (!body.consent) { setError(form, 'consent', T.consent); ok = false; }
    return ok;
  }

  function focusFirstError(form) {
    var box = form.querySelector('.ct-field.is-invalid');
    var el = box && box.querySelector('input,select,textarea');
    if (el && el.focus) el.focus();
  }

  function submit(form) {
    var lang = form.getAttribute('data-lang') === 'en' ? 'en' : 'fa';
    var T = STR[lang];
    var body = collect(form);
    if (!validateLocal(form, body, T)) { message(form, 'err', T.fix); focusFirstError(form); return; }
    var btn = form.querySelector('.ct-submit');
    var label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = T.sending; }
    message(form, '', '');
    // body.consent is true here (validateLocal refused otherwise): sent so the
    // lead record can evidence the privacy consent (leads.consent_at)
    fetch(form.getAttribute('action') || '/api/leads', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      credentials: 'same-origin'
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, json: j }; });
    }).then(function (res) {
      if (res.status === 200 && res.json && res.json.ok) {
        form.classList.add('is-done');
        message(form, 'ok', T.ok);
        var m = form.querySelector('.ct-msg');
        if (m && m.focus) { m.setAttribute('tabindex', '-1'); m.focus(); }
        return;
      }
      if (res.status === 422 && res.json && res.json.fields) {
        var fields = res.json.fields, any = false;
        for (var k in fields) {
          // the API's messages are English; the three fields a visitor can fix get the local text
          var msg = k === 'email' ? T.email : k === 'phone' ? T.phone : k === 'name' ? T.name : String(fields[k]);
          if (fieldOf(form, k)) { setError(form, k, msg); any = true; }
        }
        message(form, 'err', any ? T.fix : T.fail);
        focusFirstError(form);
        return;
      }
      message(form, 'err', res.status === 429 ? T.rate : T.fail);
    }).catch(function () {
      message(form, 'err', T.fail);
    }).then(function () {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    });
  }

  function init() {
    var forms = document.querySelectorAll('form[data-lead-form]');
    for (var i = 0; i < forms.length; i++) {
      (function (form) {
        if (form.getAttribute('data-ready')) return;
        form.setAttribute('data-ready', '1');
        form.addEventListener('submit', function (e) { e.preventDefault(); submit(form); });
        // clear a field's error as soon as the visitor edits it
        form.addEventListener('input', function (e) {
          var box = e.target && e.target.closest ? e.target.closest('.ct-field') : null;
          if (box) box.classList.remove('is-invalid');
        });
      })(forms[i]);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
