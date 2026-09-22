// «درگاه‌های پرداخت» — one card per gateway (enable, sandbox, masked
// secret, callback URL to register in the provider panel, server-side test),
// the default gateway, the optional Iranian relay and the pay-page settings.
//   GET /gateways · PUT /gateways · POST /gateways/:id/test
import { h, icon, clear, pageHeader, card, badge, statusBadge, toast, errorState, skeleton, stickyActionBar, field, textareaField, selectField, switchField, numberField, secretField, createForm, submitButton, copyToClipboard, toFaDigits } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/invoices.css';
const T = {
  title: 'درگاه‌های پرداخت', eyebrow: '[ SYSAIQ—ADMIN / GATEWAYS ]',
  subtitle: 'کلیدها رمزگذاری‌شده ذخیره می‌شوند و هرگز به مرورگر برنمی‌گردند. «تست اتصال» از خود سرور اجرا می‌شود.',
  loadError: 'بارگذاری تنظیمات درگاه‌ها ممکن نشد', saved: 'تنظیمات درگاه‌ها ذخیره شد',
  enabled: 'فعال', sandbox: 'محیط آزمایشی', secret: 'کلید / شناسه', callback: 'آدرس بازگشت (callback) برای ثبت در پنل درگاه', copy: 'کپی',
  test: 'تست اتصال', testing: 'در حال تست…', testOk: 'اتصال برقرار است', testFail: 'اتصال برقرار نشد',
  unit: u => (u === 'IRR' ? 'واحد ارسال: ریال (×۱۰ خودکار)' : 'واحد ارسال: تومان'), limits: (a, b) => `از ${toFaDigits(a.toLocaleString('en-US'))} تا ${toFaDigits(b.toLocaleString('en-US'))} تومان`,
  mockNote: 'فقط در محیط توسعه؛ در سرور اصلی وجود ندارد.', noSecret: 'این درگاه کلیدی لازم ندارد.',
  general: 'تنظیمات عمومی', dflt: 'درگاه پیش‌فرض', dfltHint: 'اولین گزینه در صفحهٔ پرداخت. باید فعال باشد.', none: '— هیچ‌کدام —',
  relay: 'رلهٔ ایرانی (اختیاری)', relayHint: 'اگر سرور خارج از ایران به درگاه‌ها نمی‌رسد، آدرس VPS ایرانی با nginx قفل‌شده را این‌جا بگذارید. خالی = اتصال مستقیم.',
  relayBase: 'آدرس رله (https)', relayKey: 'کلید رله (X-Relay-Key)',
  pay: 'صفحهٔ پرداخت', dueDays: 'مهلت پرداخت پیش‌فرض (روز)', taxPercent: 'مالیات پیش‌فرض فاکتورهای جدید (درصد)', showEnamad: 'نمایش نشان اینماد روی صفحهٔ پرداخت (اگر ثبت شده باشد)',
  offlineFa: 'راهنمای واریز بانکی (فارسی)', offlineEn: 'راهنمای واریز بانکی (English)', offlineHint: 'روی صفحهٔ پرداخت زیر درگاه‌ها نمایش داده می‌شود. شماره‌حساب را فقط اگر مطمئنید بنویسید.',
  env: e => `محیط: ${e}`, base: 'آدرس عمومی سایت',
};

function ensureCss(href = CSS_HREF) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}

export default {
  title: T.title,
  async mount(root, ctx) {
    ensureCss();
    root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle }));
    const holder = h('div');
    root.appendChild(holder);
    holder.appendChild(skeleton({ kind: 'form' }));
    let cfg;
    try { cfg = await api.get('/gateways'); } catch (e) {
      clear(holder);
      holder.appendChild(errorState({ title: T.loadError, error: e, retry: () => ctx.router.reload() }));
      return () => {};
    }
    clear(holder);

    // per-gateway fields, keyed so the PUT body can be assembled
    const gw = {};
    const cards = cfg.gateways.map(g => {
      const hasSandbox = (g.configFields || []).some(f => f.key === 'sandbox');
      const en = switchField({ name: `gw_${g.id}_enabled`, label: T.enabled });
      const sb = hasSandbox ? switchField({ name: `gw_${g.id}_sandbox`, label: T.sandbox, hint: (g.configFields || []).find(f => f.key === 'sandbox')?.help_fa }) : null;
      const sec = g.secretName ? secretField({ name: `gw_${g.id}_secret`, label: (g.configFields || []).find(f => f.type === 'secret')?.label_fa || T.secret, configured: !!g.secret?.configured, maskHint: g.secret?.hint || '', hint: (g.configFields || []).find(f => f.type === 'secret')?.help_fa, placeholder: '…' }) : null;
      gw[g.id] = { en, sb, sec };
      const testOut = h('div.a-small');
      const testBtn = h('button.a-btn.a-btn--sm', { type: 'button', onclick: async () => {
        testBtn.disabled = true; testOut.textContent = T.testing; testOut.className = 'a-small a-muted';
        try { const r = await api.post(`/gateways/${g.id}/test`, {}); testOut.textContent = r.message_fa || (r.ok ? T.testOk : T.testFail); testOut.className = `a-small ${r.ok ? 'a-ok' : 'a-danger'}`; if (r.ok) toast(T.testOk); else toast.error(T.testFail); }
        catch (e) { testOut.textContent = e?.message || T.testFail; testOut.className = 'a-small a-danger'; }
        finally { testBtn.disabled = false; }
      } }, icon('zap', { size: 'sm' }), T.test);
      return card({
        title: g.label_fa, hint: `${T.unit(g.wireUnit)} · ${T.limits(g.minToman, g.maxToman)}`,
        actions: [g.enabled ? statusBadge('enabled') : statusBadge('disabled'), g.secret ? (g.secret.configured ? statusBadge('configured') : statusBadge('missing')) : null, g.id === cfg.default ? badge(T.dflt, { kind: 'violet', icon: 'star' }) : null],
        body: h('div.a-stack', en.el, sb?.el, sec?.el || h('div.a-hint', g.id === 'mock' ? T.mockNote : T.noSecret),
          h('div.inv-link', h('span.a-small.a-muted', T.callback), h('code', { dir: 'ltr' }, g.callback_url), h('div.a-row', h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => copyToClipboard(g.callback_url) }, icon('copy', { size: 'sm' }), T.copy), testBtn)), testOut),
      });
    });

    const dflt = selectField({ name: 'default', label: T.dflt, hint: T.dfltHint, options: [{ value: '', label: T.none }, ...cfg.gateways.map(g => ({ value: g.id, label: g.label_fa }))] });
    const relayBase = field({ name: 'relay_base', label: T.relayBase, type: 'url', dir: 'ltr', lang: 'en', placeholder: 'https://relay.example.ir' });
    const relayKey = secretField({ name: 'relay_key', label: T.relayKey, configured: !!cfg.relay_key?.configured, maskHint: cfg.relay_key?.hint || '' });
    const payFields = [
      numberField({ name: 'due_days', label: T.dueDays, min: 1, max: 180, suffix: 'روز' }),
      numberField({ name: 'tax_percent', label: T.taxPercent, min: 0, max: 25, suffix: '٪' }),
      switchField({ name: 'show_enamad', label: T.showEnamad }),
      textareaField({ name: 'offline_fa', label: T.offlineFa, rows: 3, maxLength: 1000, hint: T.offlineHint }),
      textareaField({ name: 'offline_en', label: T.offlineEn, rows: 3, maxLength: 1000, dir: 'ltr', lang: 'en' }),
    ];
    const values = { default: cfg.default || '', relay_base: cfg.relay_base || '', ...cfg.pay };
    for (const g of cfg.gateways) { values[`gw_${g.id}_enabled`] = !!g.enabled; if (gw[g.id].sb) values[`gw_${g.id}_sandbox`] = !!g.sandbox; }

    const form = createForm({
      fields: [...Object.values(gw).flatMap(x => [x.en, x.sb, x.sec].filter(Boolean)), dflt, relayBase, relayKey, ...payFields],
      values, dirtyToken: 'gateways',
      render: () => h('div.a-stack', h('div.gw-grid', cards), h('section.a-form__section', h('h3', T.general), h('div.a-form__grid.a-form__grid--2', dflt.el, h('div.a-hint', `${T.base}: `, h('code', { dir: 'ltr' }, cfg.public_base_url), ' · ', T.env(cfg.env)))),
        h('section.a-form__section', h('h3', T.relay), h('div.a-hint', T.relayHint), h('div.a-form__grid.a-form__grid--2', relayBase.el, relayKey.el)),
        h('section.a-form__section', h('h3', T.pay), h('div.a-form__grid.a-form__grid--2', payFields.map(f => f.el)))),
      onDirty: d => bar.setDirty(d),
      onSubmit: async v => {
        const body = { gateways: {}, default: v.default || '', relay_base: v.relay_base || '', pay: { due_days: v.due_days, tax_percent: v.tax_percent, show_enamad: !!v.show_enamad, offline_fa: v.offline_fa || '', offline_en: v.offline_en || '' } };
        for (const g of cfg.gateways) {
          const e = { enabled: !!v[`gw_${g.id}_enabled`] };
          if (gw[g.id].sb) e.sandbox = !!v[`gw_${g.id}_sandbox`];
          if (gw[g.id].sec && v[`gw_${g.id}_secret`]) e.secret = v[`gw_${g.id}_secret`];
          body.gateways[g.id] = e;
        }
        if (v.relay_key) body.relay_key = v.relay_key;
        await api.put('/gateways', body);
        toast(T.saved);
        ctx.router.reload();
      },
    });
    const bar = stickyActionBar({ actions: [submitButton(form)] });
    holder.append(form.el, bar);
    return () => form.destroy();
  },
};
