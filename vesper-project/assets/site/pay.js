/* SysaiQ — pay-link page behaviour (no inline script; CSP script-src 'self').
   Gateway form: fetch POST /api/pay/:token/start {gateway} → location.assign(redirectUrl).
   Without JS the same form posts as urlencoded and the server answers 303. */
(function () {
  'use strict';
  var form = document.querySelector('[data-pay-form]');
  if (form) {
    var btn = form.querySelector('.pay-submit');
    var err = form.querySelector('[data-pay-error]');
    var label = btn ? btn.textContent : '';
    var busy = false;
    var fail = function (msg) {
      busy = false;
      if (btn) { btn.disabled = false; btn.textContent = label; }
      if (err) { err.textContent = msg; err.hidden = false; }
    };
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      if (busy) return;
      var picked = form.querySelector('input[name="gateway"]:checked');
      if (!picked) return fail(document.documentElement.lang === 'en' ? 'Choose a gateway.' : 'یک درگاه انتخاب کنید.');
      busy = true;
      if (err) err.hidden = true;
      if (btn) { btn.disabled = true; btn.textContent = form.getAttribute('data-redirecting') || '…'; }
      fetch(form.getAttribute('action'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-requested-with': 'fetch' },
        body: JSON.stringify({ gateway: picked.value }),
        credentials: 'omit'
      }).then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, j: j }; }, function () { return { ok: false, j: {} }; });
      }).then(function (x) {
        if (x.ok && x.j && x.j.redirectUrl) { location.assign(x.j.redirectUrl); return; }
        var m = (x.j && (x.j.fields && x.j.fields.gateway)) || (x.j && x.j.message) || (document.documentElement.lang === 'en' ? 'Could not start the payment. Please try again.' : 'شروع پرداخت ممکن نشد؛ لطفاً دوباره تلاش کنید.');
        fail(m);
      }).catch(function () {
        fail(document.documentElement.lang === 'en' ? 'Network error. Please try again.' : 'خطای شبکه؛ لطفاً دوباره تلاش کنید.');
      });
    });
  }
  var print = document.querySelector('[data-print]');
  if (print) print.addEventListener('click', function () { window.print(); });
})();
