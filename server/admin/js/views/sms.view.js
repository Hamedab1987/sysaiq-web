// «پنل پیامک» — #/sms/:tab (settings | templates | send | log).
//   GET/PUT /sms/config · POST /sms/test · GET /sms/credit?provider=&force=1
//   GET/POST /sms/templates · PUT/DELETE /sms/templates/:key
//   POST /sms/send · GET /sms/log · POST /sms/log/:id/refresh-status · POST /sms/log/:id/retry
// Secrets come back as {configured, hint} only; the secret inputs stay empty
// and an empty value keeps the stored key. Automatic messages should use a
// provider pattern (reaches blacklisted numbers); free text is manual only.
import { h, icon, clear, pageHeader, card, tabs, badge, statusBadge, dataTable, filterBar, confirm, toast, modal, drawer, createForm, submitButton, stickyActionBar, makeField, field, textareaField, selectField, switchField, numberField, secretField, codeField, tagsField, bilingualField, skeleton, errorState, emptyState, toFaDigits, toEnDigits, formatJalali, formatMobile, formatNumber, registerShortcut } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/sms.css';
const TABS = ['settings', 'templates', 'send', 'log'];
// GSM-7 basic set + extension: a message entirely inside it packs 160/153, otherwise 70/67 (same table as sms/templates.js)
const GSM7 = new Set('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\fÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€'.split(''));
export function countSegments(text) {
  const chars = [...String(text ?? '')];
  const n = chars.length;
  const gsm = chars.every(c => GSM7.has(c));
  const single = gsm ? 160 : 70, multi = gsm ? 153 : 67;
  if (!n) return { chars: 0, segments: 0, encoding: gsm ? 'gsm' : 'unicode', perSegment: single };
  return { chars: n, segments: n <= single ? 1 : Math.ceil(n / multi), encoding: gsm ? 'gsm' : 'unicode', perSegment: n <= single ? single : multi };
}
export const placeholdersOf = body => [...new Set([...String(body ?? '').matchAll(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g)].map(m => m[1]))];

const T = {
  title: 'پنل پیامک', subtitle: 'سرویس‌دهنده، قالب‌ها، ارسال دستی و گزارش تحویل پیامک‌های سایت.',
  eyebrow: '[ SYSAIQ—ADMIN / SMS ]',
  tabs: { settings: 'تنظیمات', templates: 'قالب‌ها', send: 'ارسال دستی', log: 'گزارش ارسال' },
  // settings
  secProvider: 'سرویس‌دهنده', secProviderHint: 'سرویس‌دهندهٔ فعال پیام‌ها را می‌فرستد؛ پشتیبان فقط هنگام خطای گذرا به کار می‌آید.', activeF: 'سرویس‌دهندهٔ فعال', fallbackF: 'سرویس‌دهندهٔ پشتیبان', off: 'خاموش (ارسال نمی‌شود)', none: 'بدون پشتیبان',
  secKeys: 'کلیدها و خط ارسال', secretHint: 'برای تغییر، مقدار جدید را وارد کنید', secKeysHint: 'کلیدها رمزگذاری‌شده ذخیره می‌شوند و هرگز نمایش داده نمی‌شوند.',
  secOwner: 'مالک و رویدادها', ownerF: 'شمارهٔ همراه مالک', ownerHint: 'هشدار سرنخ و پرداخت به این شماره می‌رود.',
  events: { lead_owner: 'سرنخ جدید → هشدار به مالک', lead_customer: 'سرنخ جدید → تأیید به مشتری', invoice_link: 'ارسال لینک پرداخت فاکتور', invoice_reminder: 'یادآوری فاکتور', payment_customer: 'رسید پرداخت → مشتری', payment_owner: 'پرداخت → هشدار به مالک' },
  secCaps: 'سقف‌ها', dailyF: 'سقف روزانهٔ کل', perNumberF: 'سقف روزانهٔ هر شماره', capsHint: 'پیام‌های خودکار بیش از سقف ارسال نمی‌شوند (در گزارش با وضعیت «رد شد» می‌آیند).',
  secRelay: 'رله (اختیاری)', relayHint: 'اگر سرور به سرویس‌دهنده دسترسی ندارد، یک رلهٔ ایرانی با نشانی https و کلید تنظیم کنید.', relayBaseF: 'نشانی رله', relayKeyF: 'کلید رله',
  credit: 'اعتبار', creditRefresh: 'به‌روزرسانی اعتبار', creditNone: 'نامشخص', creditErr: 'اعتبار خوانده نشد', creditCached: 'کش ۶۰ ثانیه',
  usage: (n, cap) => `${toFaDigits(n)} از ${toFaDigits(cap)} پیام در ۲۴ ساعت گذشته`,
  test: 'ارسال آزمایشی', testTitle: 'ارسال پیامک آزمایشی', testTo: 'شمارهٔ گیرنده', testMode: 'روش', modeSimple: 'متن ساده', modePattern: 'الگو (pattern)', testTemplate: 'قالب', testProvider: 'سرویس‌دهنده', testSent: 'پیام آزمایشی ارسال شد', testLang: 'زبان',
  saved: 'تنظیمات ذخیره شد', envNote: env => (env === 'production' ? '' : `محیط ${env}: سرویس‌دهندهٔ آزمایشی (mock) در دسترس است و چیزی واقعاً ارسال نمی‌شود.`),
  // templates
  tplAdd: 'قالب جدید', tplEdit: 'ویرایش قالب', tplKey: 'کلید', tplLabel: 'نام قالب', tplBody: 'متن پیام', tplVars: 'متغیرها', tplVarsHint: 'نام متغیرها (لاتین، کوچک). متغیرهای داخل متن به‌طور خودکار افزوده می‌شوند.', tplMap: 'نگاشت الگوی سرویس‌دهنده', tplMapHint: 'برای ارسال با الگو (رسیدن به شماره‌های لیست سیاه) لازم است. JSON مطابق راهنمای هر سرویس‌دهنده.', tplEnabled: 'فعال', tplSystem: 'سیستمی',
  tplKeyHint: 'با حرف لاتین شروع شود؛ فقط حروف کوچک، رقم و _ (۲ تا ۴۰ نویسه).', tplInsert: 'درج متغیر:', tplSaved: 'قالب ذخیره شد', tplCreated: 'قالب ساخته شد',
  colKey: 'کلید', colLabel: 'نام', colBody: 'متن فارسی', colVars: 'متغیرها', colMap: 'الگو', colStatus: 'وضعیت',
  segs: c => `${toFaDigits(c.chars)} نویسه · ${toFaDigits(c.segments)} پیامک (${toFaDigits(c.perSegment)} نویسه‌ای)`,
  mapNone: 'بدون الگو', mapSet: n => `${toFaDigits(n)} سرویس‌دهنده`,
  // send
  sendTitle: 'ارسال پیامک دستی', sendTo: 'شمارهٔ گیرنده', sendLead: 'یا شناسهٔ سرنخ', sendLeadHint: 'اگر شناسهٔ سرنخ را بدهید، شماره از پروندهٔ سرنخ خوانده می‌شود.', sendTemplate: 'قالب', freeText: 'متن آزاد (بدون قالب)', sendText: 'متن پیام', sendLang: 'زبان', sendParams: 'مقادیر متغیرها', sendBtn: 'ارسال', sent: s => `ارسال شد — وضعیت: ${s}`,
  blacklist: 'متن آزاد به شماره‌هایی که «دریافت پیامک تبلیغاتی» را غیرفعال کرده‌اند نمی‌رسد. برای اطمینان از تحویل، از قالبی با الگوی سرویس‌دهنده استفاده کنید.',
  // log
  filters: { status: 'همهٔ وضعیت‌ها', provider: 'همهٔ سرویس‌دهنده‌ها', kind: 'همهٔ انواع' }, kinds: { auto: 'خودکار', manual: 'دستی', test: 'آزمایشی' },
  status: { queued: 'در صف', sent: 'ارسال شد', delivered: 'تحویل شد', undelivered: 'تحویل نشد', failed: 'ناموفق', blocked: 'مسدود', skipped: 'رد شد' },
  logSearch: 'جستجو در متن، خطا یا شناسهٔ پیام…', logTo: 'شمارهٔ گیرنده',
  colWhen: 'زمان', colTo: 'گیرنده', colKind: 'نوع', colTemplate: 'قالب', colProvider: 'سرویس‌دهنده', colSegs: 'پیامک', colCost: 'هزینه', colError: 'خطا',
  refreshStatus: 'به‌روزرسانی وضعیت', retry: 'ارسال مجدد', retried: 'دوباره ارسال شد', statusNow: s => `وضعیت: ${s}`, logEmpty: 'هنوز پیامکی ارسال نشده است', prev: 'قبلی', next: 'بعدی', details: 'جزئیات',
  loadErr: 'بارگذاری نشد.',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
const LOG_STATUS = { queued: { label: 'در صف', kind: 'info', icon: 'clock' }, sent: { label: 'ارسال شد', kind: 'info', icon: 'send' }, delivered: { label: 'تحویل شد', kind: 'ok', icon: 'check-circle' }, undelivered: { label: 'تحویل نشد', kind: 'warn', icon: 'alert-triangle' }, failed: { label: 'ناموفق', kind: 'danger', icon: 'alert-circle' }, blocked: { label: 'مسدود', kind: 'danger', icon: 'x' }, skipped: { label: 'رد شد', kind: null, icon: 'minus' } };
const statusPill = s => statusBadge(s, { map: LOG_STATUS });
const segCounter = ta => { const el = h('div.a-hint.sm-segs'); const upd = () => { el.textContent = T.segs(countSegments(ta.value)); }; ta.addEventListener('input', upd); upd(); return { el, update: upd }; };

// ------------------------------------------------------------ settings ----
async function mountSettings(panel, ctx) {
  panel.appendChild(skeleton({ kind: 'form' }));
  let view;
  try { view = await api.get('/sms/config'); } catch (e) { panel.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return () => {}; }
  if (!panel.isConnected) return () => {};
  const { config: cfg, providers, relay_key, events, env, usage } = view;
  const provOpts = providers.map(p => ({ value: p.id, label: p.label_fa }));
  const active = selectField({ name: 'active', label: T.activeF, options: [{ value: '', label: T.off }, ...provOpts] });
  const fallback = selectField({ name: 'fallback', label: T.fallbackF, options: [{ value: '', label: T.none }, ...provOpts] });
  const provFields = [];   // [{p, f, key}]
  const provCards = providers.map(p => {
    const inner = p.configFields.map(cf => {
      const name = `providers.${p.id}.${cf.key}`;
      const f = cf.type === 'secret'
        ? secretField({ name, label: cf.label_fa, configured: !!p.secret?.configured, maskHint: p.secret?.hint || '', hint: p.secret?.configured ? T.secretHint : cf.help_fa, placeholder: '…' })
        : field({ name, label: cf.label_fa, dir: 'ltr', mono: true, maxLength: cf.key === 'sender' ? 40 : 80, hint: cf.help_fa });
      provFields.push({ p, f, key: cf.key, type: cf.type });
      return f;
    });
    const creditEl = h('span.sm-credit');
    const creditBtn = h('button.a-btn.a-btn--subtle.a-btn--sm', { type: 'button', 'aria-label': T.creditRefresh, title: T.creditRefresh, onclick: () => loadCredit(p.id, creditEl, creditBtn, true) }, icon('refresh-cw', { size: 'sm' }));
    return { p, el: card({ title: p.label_fa, actions: [creditEl, creditBtn, p.supportsPattern ? badge('الگو', { kind: 'info', icon: 'zap' }) : null, p.secret ? statusBadge(p.secret.configured ? 'configured' : 'missing') : null], body: h('div.a-form__grid.a-form__grid--2', inner.map(f => f.el)) }), creditEl, creditBtn };
  });
  async function loadCredit(pid, el, btn, force) {
    clear(el); el.append(icon('loader', { size: 'sm' }), ` ${T.credit}…`); btn.disabled = true;
    try { const r = await api.get(`/sms/credit?provider=${encodeURIComponent(pid)}${force ? '&force=1' : ''}`); clear(el); el.append(`${T.credit}: `, h('b', r.amount === null ? T.creditNone : `${formatNumber(r.amount)} ${r.unit || ''}`), r.cached ? h('span.a-small.a-muted', ` (${T.creditCached})`) : null); }
    catch (e) { clear(el); el.append(badge(T.creditErr, { kind: 'warn', icon: 'alert-triangle' })); el.title = e.message; }
    finally { btn.disabled = false; }
  }
  const owner = field({ name: 'owner_mobile', label: T.ownerF, type: 'tel', dir: 'ltr', required: true, hint: T.ownerHint });
  const evFields = events.map(k => switchField({ name: `events.${k}`, label: T.events[k] || k }));
  const daily = numberField({ name: 'daily_cap', label: T.dailyF, min: 1, max: 100000, nullable: false });
  const perNumber = numberField({ name: 'per_number_daily_cap', label: T.perNumberF, min: 1, max: 1000, nullable: false });
  const relayBase = field({ name: 'relay_base', label: T.relayBaseF, type: 'url', dir: 'ltr', placeholder: 'https://relay.example.ir', rules: [v => (!v || /^https:\/\//.test(v) ? null : STR.fields.https)] });
  const relayKey = secretField({ name: 'relay_key', label: T.relayKeyF, configured: !!relay_key?.configured, maskHint: relay_key?.hint || '', hint: relay_key?.configured ? T.secretHint : undefined, placeholder: '…' });

  const values = { active: cfg.active, fallback: cfg.fallback, owner_mobile: cfg.owner_mobile, daily_cap: cfg.daily_cap, per_number_daily_cap: cfg.per_number_daily_cap, relay_base: cfg.relay_base, relay_key: '' };
  for (const k of events) values[`events.${k}`] = cfg.events?.[k] !== false;
  for (const { p, key, type } of provFields) values[`providers.${p.id}.${key}`] = type === 'secret' ? '' : (cfg.providers?.[p.id]?.[key] || '');

  const form = createForm({
    fields: [active, fallback, ...provFields.map(x => x.f), owner, ...evFields, daily, perNumber, relayBase, relayKey],
    dirtyToken: 'sms-config',
    render: () => h('div.a-stack',
      env !== 'production' ? h('div.a-form__banner.sm-note', icon('info'), h('div', T.envNote(env))) : null,
      h('section.a-form__section', h('h3', T.secProvider), h('div.a-hint', T.secProviderHint), h('div.a-form__grid.a-form__grid--2', active.el, fallback.el), h('div.a-hint', T.usage(usage.sent_24h, usage.daily_cap))),
      h('section.a-form__section', h('h3', T.secKeys), h('div.a-hint', T.secKeysHint), h('div.a-stack', provCards.map(c => c.el))),
      h('section.a-form__section', h('h3', T.secOwner), owner.el, h('div.a-form__grid.a-form__grid--2', evFields.map(f => f.el))),
      h('section.a-form__section', h('h3', T.secCaps), h('div.a-hint', T.capsHint), h('div.a-form__grid.a-form__grid--2', daily.el, perNumber.el)),
      h('section.a-form__section', h('h3', T.secRelay), h('div.a-hint', T.relayHint), h('div.a-form__grid.a-form__grid--2', relayBase.el, relayKey.el))),
    values,
    async onSubmit(v) {
      const body = { active: v.active, fallback: v.fallback, owner_mobile: v.owner_mobile, daily_cap: Number(v.daily_cap) || 1, per_number_daily_cap: Number(v.per_number_daily_cap) || 1, relay_base: v.relay_base || '', events: {}, providers: {} };
      for (const k of events) body.events[k] = !!v[`events.${k}`];
      for (const { p, key, type } of provFields) {
        const val = v[`providers.${p.id}.${key}`];
        if (type === 'secret' && !val) continue;   // empty = keep the stored key
        (body.providers[p.id] ||= {})[key] = val;
      }
      if (v.relay_key) body.relay_key = v.relay_key;
      const r = await api.put('/sms/config', body);
      for (const x of provFields) if (x.type === 'secret') { const np = r.providers?.find(q => q.id === x.p.id); x.f.setStatus(!!np?.secret?.configured, np?.secret?.hint || ''); x.f.value = ''; }
      relayKey.setStatus(!!r.relay_key?.configured, r.relay_key?.hint || ''); relayKey.value = '';
      toast(T.saved);
      return true;
    },
    onDirty: d => bar?.setDirty(d),
  });
  const testBtn = h('button.a-btn', { type: 'button', onclick: () => openTest(providers, active.value) }, icon('send'), T.test);
  const bar = stickyActionBar({ actions: [testBtn, submitButton(form)] });
  panel.replaceChildren(card({ body: form.el }), bar);
  for (const c of provCards) if (c.p.id === cfg.active || c.p.id === cfg.fallback) loadCredit(c.p.id, c.creditEl, c.creditBtn, false);
  return () => form.destroy();
}

async function openTest(providers, activeId) {
  let templates = [];
  try { templates = (await api.get('/sms/templates')).items.filter(t => t.enabled); } catch { /* the select stays empty */ }
  const to = field({ name: 'to', label: T.testTo, type: 'tel', dir: 'ltr', required: true, placeholder: '۰۹۱۲…' });
  const mode = selectField({ name: 'mode', label: T.testMode, options: [{ value: 'simple', label: T.modeSimple }, { value: 'pattern', label: T.modePattern }] });
  const tpl = selectField({ name: 'template_key', label: T.testTemplate, options: templates.map(t => ({ value: t.key, label: `${t.label_fa || t.key} (${t.key})` })), placeholder: STR.actions.select });
  const prov = selectField({ name: 'provider', label: T.testProvider, options: providers.map(p => ({ value: p.id, label: p.label_fa })), placeholder: STR.actions.select });
  const lang = selectField({ name: 'lang', label: T.testLang, options: [{ value: 'fa', label: STR.fields.faLabel }, { value: 'en', label: STR.fields.enLabel }] });
  mode.onChange(v => { tpl.el.hidden = v !== 'pattern'; });
  tpl.el.hidden = true;
  const form = createForm({
    fields: [to, mode, tpl, prov, lang], dirtyToken: 'sms-test', values: { to: '', mode: 'simple', template_key: '', provider: activeId || '', lang: 'fa' },
    async onSubmit(v) {
      const r = await api.post('/sms/test', { to: v.to, mode: v.mode, template_key: v.mode === 'pattern' ? v.template_key : '', provider: v.provider, lang: v.lang });
      toast(`${T.testSent} — ${LOG_STATUS[r.log?.status]?.label || r.log?.status || ''}`);
      dlg.close(true);
      return true;
    },
  });
  const dlg = modal({ title: T.testTitle, size: 'sm', body: form.el, actions: [{ label: STR.actions.cancel, kind: 'ghost', value: false }, { label: T.test, kind: 'primary', icon: 'send', close: false, onClick: async () => { await form.submit(); return false; } }], onClose: () => form.destroy() });
  dlg.open();
}

// ----------------------------------------------------------- templates ----
async function mountTemplates(panel, ctx) {
  panel.appendChild(skeleton({ kind: 'table' }));
  let data;
  const load = async () => { data = await api.get('/sms/templates'); };
  try { await load(); } catch (e) { panel.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return () => {}; }
  if (!panel.isConnected) return () => {};
  const table = dataTable({
    columns: [
      { key: 'key', label: T.colKey, render: r => h('span.a-row', h('span.a-mono', { dir: 'ltr' }, r.key), r.is_system ? badge(T.tplSystem, { icon: 'lock' }) : null) },
      { key: 'label_fa', label: T.colLabel, primary: true },
      { key: 'body_fa', label: T.colBody, render: r => h('span.sm-body', r.body_fa || r.body_en || '—') },
      { key: 'variables', label: T.colVars, render: r => h('span.a-row', (r.placeholders || []).map(v => badge(`{{${v}}}`, { ltr: true }))) },
      { key: 'provider_map', label: T.colMap, render: r => { const n = Object.keys(r.provider_map || {}).length; return n ? badge(T.mapSet(n), { kind: 'info', icon: 'zap' }) : h('span.a-muted', T.mapNone); } },
      { key: 'enabled', label: T.colStatus, render: r => statusBadge(r.enabled ? 'enabled' : 'disabled') },
    ],
    onRowClick: r => openEditor(r),
    actions: r => [
      { icon: 'pencil', label: STR.actions.edit, onClick: () => openEditor(r) },
      ...(r.is_system ? [] : [{ icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => remove(r) }]),
    ],
    empty: { icon: 'send', title: STR.states.empty },
  });
  const refresh = async () => { try { await load(); table.setRows(data.items); } catch (e) { toast.error(e.message); } };
  async function remove(r) {
    if (!(await confirm({ message: STR.confirm.deleteMessage(r.label_fa || r.key), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
    try { await api.del(`/sms/templates/${encodeURIComponent(r.key)}`); toast(STR.states.deleted); await refresh(); } catch (e) { toast.error(e.message); }
  }
  function openEditor(existing) {
    const isEdit = !!existing;
    const varLabels = data.variable_labels || {};
    const key = field({ name: 'key', label: T.tplKey, dir: 'ltr', mono: true, required: !isEdit, disabled: isEdit, maxLength: 40, hint: T.tplKeyHint, rules: [v => (!v || /^[a-z][a-z0-9_]{1,39}$/.test(v) ? null : T.tplKeyHint)] });
    const label = bilingualField({ name: 'label', label: T.tplLabel, flat: true, maxLength: 120 });
    const body = bilingualField({ name: 'body', label: T.tplBody, flat: true, type: 'textarea', rows: 4, maxLength: data.limits?.bodyChars || 1000 });
    const counters = { fa: segCounter(body.fa.control), en: segCounter(body.en.control) };
    body.fa.el.appendChild(counters.fa.el); body.en.el.appendChild(counters.en.el);
    const vars = tagsField({ name: 'variables', label: T.tplVars, ltr: true, hint: T.tplVarsHint, maxLength: 40, suggestions: Object.keys(varLabels) });
    let last = body.fa.control;
    for (const l of ['fa', 'en']) body[l].control.addEventListener('focus', () => { last = body[l].control; });
    const insert = v => { const s = last.selectionStart ?? last.value.length; last.setRangeText(`{{${v}}}`, s, last.selectionEnd ?? s, 'end'); last.focus(); last.dispatchEvent(new Event('input', { bubbles: true })); };
    const chips = h('div.sm-chips', h('span.a-small.a-muted', T.tplInsert), ...Object.entries(varLabels).map(([k, l]) => h('button.sm-chip', { type: 'button', title: l.fa, onclick: () => insert(k) }, h('span', { dir: 'ltr' }, `{{${k}}}`), ' ', h('span.a-muted', l.fa))));
    const mapFields = (data.providers || []).filter(p => p.supportsPattern).map(p => codeField({ name: `provider_map.${p.id}`, label: `${p.label_fa} (${p.id})`, json: true, rows: 3, placeholder: '{ "template": "…" }', hint: p.map_help?.fa || '' }));
    const enabled = switchField({ name: 'enabled', label: T.tplEnabled });
    const values = existing ? { key: existing.key, label_fa: existing.label_fa, label_en: existing.label_en, body_fa: existing.body_fa, body_en: existing.body_en, variables: existing.variables || [], enabled: !!existing.enabled } : { key: '', label_fa: '', label_en: '', body_fa: '', body_en: '', variables: [], enabled: true };
    for (const p of data.providers || []) values[`provider_map.${p.id}`] = existing?.provider_map?.[p.id] ?? null;
    const form = createForm({
      fields: [key, label, body, vars, ...mapFields, enabled], dirtyToken: `sms-tpl-${existing?.key || 'new'}`,
      render: () => h('div.a-stack', key.el, label.el, body.el, chips, vars.el, h('section.a-form__section', h('h3', T.tplMap), h('div.a-hint', T.tplMapHint), mapFields.map(f => f.el)), enabled.el),
      values,
      async onSubmit(v) {
        const provider_map = {};
        for (const p of data.providers || []) { const m = v[`provider_map.${p.id}`]; if (m && typeof m === 'object') provider_map[p.id] = m; else provider_map[p.id] = null; }
        const b = { label_fa: v.label_fa, label_en: v.label_en, body_fa: v.body_fa, body_en: v.body_en, variables: [...new Set([...v.variables, ...placeholdersOf(v.body_fa), ...placeholdersOf(v.body_en)])], provider_map, enabled: !!v.enabled };
        try {
          if (isEdit) { await api.put(`/sms/templates/${encodeURIComponent(existing.key)}`, b); toast(T.tplSaved); }
          else { await api.post('/sms/templates', { key: v.key, ...b }); toast(T.tplCreated); }
        } catch (e) {
          if (e?.fields) { form.setErrors(e.fields, { message: e.message }); return false; }
          throw e;
        }
        dlg.close(true);
        await refresh();
        return true;
      },
    });
    const dlg = drawer({ title: isEdit ? `${T.tplEdit} — ${existing.label_fa || existing.key}` : T.tplAdd, wide: true, body: form.el, actions: [{ label: STR.actions.cancel, kind: 'ghost', value: false }, { label: STR.actions.save, kind: 'primary', icon: 'save', close: false, onClick: async () => { await form.submit(); return false; } }], onClose: () => form.destroy() });
    dlg.open();
  }
  panel.replaceChildren(h('div.a-row.a-row--end', h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => openEditor(null) }, icon('plus'), T.tplAdd)), table.el);
  table.setRows(data.items);
  return () => {};
}

// ---------------------------------------------------------------- send ----
async function mountSend(panel, ctx) {
  panel.appendChild(skeleton({ kind: 'form' }));
  let data;
  try { data = await api.get('/sms/templates'); } catch (e) { panel.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return () => {}; }
  if (!panel.isConnected) return () => {};
  const templates = (data.items || []).filter(t => t.enabled);
  const varLabels = data.variable_labels || {};
  const to = field({ name: 'to', label: T.sendTo, type: 'tel', dir: 'ltr', placeholder: '۰۹۱۲…' });
  const leadId = numberField({ name: 'lead_id', label: T.sendLead, min: 1, hint: T.sendLeadHint });
  const tpl = selectField({ name: 'template_key', label: T.sendTemplate, options: [{ value: '', label: T.freeText }, ...templates.map(t => ({ value: t.key, label: `${t.label_fa || t.key} (${t.key})` }))] });
  const text = textareaField({ name: 'text', label: T.sendText, rows: 5, maxLength: data.limits?.textChars || 500 });
  const counter = segCounter(text.control);
  text.el.appendChild(counter.el);
  const lang = selectField({ name: 'lang', label: T.sendLang, options: [{ value: 'fa', label: STR.fields.faLabel }, { value: 'en', label: STR.fields.enLabel }] });
  const warn = h('div.sm-warn', { role: 'note' }, icon('alert-triangle'), h('div', T.blacklist));
  const paramsBox = h('div.a-form__grid.a-form__grid--2');
  let paramFields = [];
  const paramsSection = h('section.a-form__section', { hidden: true }, h('h3', T.sendParams), paramsBox);
  const rebuildParams = () => {
    const t = templates.find(x => x.key === tpl.value);
    for (const f of paramFields) f.dispose();
    clear(paramsBox); paramFields = [];
    const free = !t;
    text.el.hidden = !free; warn.hidden = !free; paramsSection.hidden = free || !t.placeholders.length;
    if (t) for (const v of t.placeholders) { const f = field({ name: `params.${v}`, label: varLabels[v]?.fa || v, maxLength: data.limits?.varChars || 120 }); paramFields.push(f); paramsBox.appendChild(f.el); }
  };
  tpl.onChange(rebuildParams);
  const form = createForm({
    fields: [to, leadId, tpl, text, lang], dirtyToken: 'sms-send',
    render: () => h('div.a-stack', h('div.a-form__grid.a-form__grid--2', to.el, leadId.el), h('div.a-form__grid.a-form__grid--2', tpl.el, lang.el), text.el, warn, paramsSection),
    values: { to: '', lead_id: null, template_key: '', text: '', lang: 'fa' },
    async onSubmit(v) {
      const params = {};
      for (const f of paramFields) params[f.name.slice(7)] = f.value;
      const body = { template_key: v.template_key || '', text: v.template_key ? '' : v.text, params, lang: v.lang };
      if (v.lead_id) body.lead_id = v.lead_id; else body.to = v.to;
      const r = await api.post('/sms/send', body);
      toast(T.sent(LOG_STATUS[r.log?.status]?.label || r.log?.status || ''), { action: { label: T.tabs.log, onClick: () => ctx.router.navigate('/sms/log') } });
      text.value = ''; counter.update(); form.markClean();
      return true;
    },
  });
  rebuildParams();
  panel.replaceChildren(card({ title: T.sendTitle, body: form.el, footer: [submitButton(form, { label: T.sendBtn, icon: 'send' })] }));
  return () => form.destroy();
}

// ----------------------------------------------------------------- log ----
async function mountLog(panel, ctx) {
  let page = 1;
  let data = { items: [], total: 0, page: 1, per_page: 50 };
  let providers = [];
  try { providers = (await api.get('/sms/config')).providers; } catch { /* filter falls back to free text */ }
  const table = dataTable({
    columns: [
      { key: 'created_at', label: T.colWhen, render: r => h('span.a-nowrap', formatJalali(r.created_at, { style: 'datetime' })) },
      { key: 'to_number', label: T.colTo, render: r => h('span.a-mono', { dir: 'ltr' }, formatMobile(r.to_number)) },
      { key: 'kind', label: T.colKind, render: r => T.kinds[r.kind] || r.kind },
      { key: 'template_key', label: T.colTemplate, render: r => (r.template_key ? h('span.a-mono', { dir: 'ltr' }, r.template_key) : h('span.a-muted', T.freeText)) },
      { key: 'provider', label: T.colProvider, render: r => (providers.find(p => p.id === r.provider)?.label_fa || r.provider || '—') },
      { key: 'status', label: T.colStatus, render: r => statusPill(r.status) },
      { key: 'segments', label: T.colSegs, num: true },
      { key: 'cost', label: T.colCost, render: r => (r.cost === null || r.cost === undefined ? '—' : formatNumber(r.cost)) },
      { key: 'error_label', label: T.colError, render: r => (r.error_label ? h('span.a-small', { title: r.error_message || '' }, r.error_label) : '—') },
    ],
    onRowClick: r => showDetails(r),
    actions: r => [
      { icon: 'refresh-cw', label: T.refreshStatus, onClick: () => refreshStatus(r) },
      { icon: 'send', label: T.retry, onClick: () => retry(r) },
    ],
    empty: { icon: 'send', title: T.logEmpty },
  });
  const filters = filterBar({
    search: { placeholder: T.logSearch },
    filters: [
      { name: 'status', label: T.filters.status, options: Object.entries(T.status).map(([value, label]) => ({ value, label })) },
      { name: 'provider', label: T.filters.provider, options: providers.map(p => ({ value: p.id, label: p.label_fa })) },
      { name: 'kind', label: T.filters.kind, options: Object.entries(T.kinds).map(([value, label]) => ({ value, label })) },
    ],
    actions: [h('input.a-input.sm-to', { type: 'search', placeholder: T.logTo, 'aria-label': T.logTo, dir: 'ltr', oninput: e => { toFilter = toEnDigits(e.target.value); page = 1; toTimer = debounceLoad(); } })],
    onChange: () => { page = 1; load(); },
  });
  let toFilter = '';
  let toTimer = null;
  const debounceLoad = () => { clearTimeout(toTimer); return setTimeout(load, 250); };
  const pager = h('div.a-table__foot');
  let loading = 0;
  async function load() {
    const my = ++loading;
    table.setLoading(true);
    const v = filters.values;
    const qs = new URLSearchParams({ page: String(page), per_page: '50' });
    if (v.q) qs.set('q', v.q); if (v.status) qs.set('status', v.status); if (v.provider) qs.set('provider', v.provider); if (v.kind) qs.set('kind', v.kind); if (toFilter) qs.set('to', toFilter);
    try {
      const r = await api.get(`/sms/log?${qs}`);
      if (my !== loading || !panel.isConnected) return;
      data = r;
      table.setRows(r.items);
      filters.setCount(r.items.length, r.total);
      const pages = Math.max(1, Math.ceil(r.total / r.per_page));
      clear(pager);
      pager.append(
        h('button.a-btn.a-btn--sm', { type: 'button', disabled: page <= 1, onclick: () => { page--; load(); } }, icon('chevron-right', { size: 'sm' }), T.prev),
        h('span', STR.states.of(page, pages)),
        h('button.a-btn.a-btn--sm', { type: 'button', disabled: page >= pages, onclick: () => { page++; load(); } }, T.next, icon('chevron-left', { size: 'sm' })),
        h('span.a-grow'), h('span', STR.states.items(r.total)));
      pager.hidden = pages <= 1;
    } catch (e) { if (my === loading) table.setError(e, load); }
  }
  async function refreshStatus(r) {
    try { const res = await api.post(`/sms/log/${r.id}/refresh-status`, {}); Object.assign(r, res.log || {}); toast(T.statusNow(LOG_STATUS[res.state]?.label || res.state), { kind: 'info' }); table.setRows(data.items); } catch (e) { toast.error(e.message); }
  }
  async function retry(r) {
    if (!(await confirm({ title: T.retry, message: `${formatMobile(r.to_number)} — ${r.text ? r.text.slice(0, 80) : r.template_key}`, confirmLabel: T.retry }))) return;
    try { await api.post(`/sms/log/${r.id}/retry`, {}); toast(T.retried); page = 1; load(); } catch (e) { toast.error(e.message); }
  }
  function showDetails(r) {
    const rows = [['#', toFaDigits(r.id)], [T.colWhen, formatJalali(r.created_at, { style: 'datetime' })], [T.colTo, formatMobile(r.to_number)], [T.colKind, T.kinds[r.kind] || r.kind], [T.colTemplate, r.template_key || T.freeText], [T.colProvider, r.provider || '—'], ['mode', r.mode], [T.colStatus, LOG_STATUS[r.status]?.label || r.status], [T.colSegs, toFaDigits(r.segments)], [T.colCost, r.cost ?? '—'], ['message_id', r.message_id || '—'], [T.colError, r.error_label ? `${r.error_label}${r.error_message ? ` — ${r.error_message}` : ''}` : '—'], ['admin', r.admin_user || '—']];
    modal({ title: `${T.details} — ${toFaDigits(r.id)}`, body: h('div.a-stack', h('div.sm-text', { dir: 'auto' }, r.text || '—'), h('dl.a-dl', rows.flatMap(([k, v]) => [h('dt', k), h('dd', { dir: 'auto' }, String(v))]))), actions: [{ label: STR.actions.close, kind: 'ghost' }] }).open();
  }
  panel.replaceChildren(filters.el, table.el, pager);
  await load();
  return () => {};
}

const MOUNTS = { settings: mountSettings, templates: mountTemplates, send: mountSend, log: mountLog };

async function mount(root, ctx) {
  ensureStylesheet(CSS_HREF);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle }));
  const start = TABS.includes(ctx.params?.tab) ? ctx.params.tab : 'settings';
  const panels = Object.fromEntries(TABS.map(t => [t, h('div.a-stack')]));
  const cleanups = {};
  const mounted = new Set();
  const activate = async id => {
    if (!mounted.has(id)) { mounted.add(id); cleanups[id] = await MOUNTS[id](panels[id], ctx); }
  };
  const tabEl = tabs({
    active: start,
    items: TABS.map(t => ({ id: t, label: T.tabs[t], icon: { settings: 'settings', templates: 'list', send: 'send', log: 'history' }[t], panel: panels[t] })),
    onChange: id => { history.replaceState(null, '', `#/sms/${id}`); activate(id); },
  });
  root.appendChild(tabEl);
  await activate(start);
  return () => { for (const c of Object.values(cleanups)) c?.(); };
}

export default { title: T.title, mount };
