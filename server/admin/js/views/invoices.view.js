// «فاکتورها» — list + editor. Customer can be prefilled from a lead, items
// are a repeater with live totals, and the side panel drives the workflow:
// send (SMS / email), copy link, QR, reminder, manual mark-paid, cancel,
// duplicate, plus the timeline of payments and SMS rows.
//   GET  /invoices?status&q · GET /invoices/stats · POST /invoices · GET/PUT/DELETE /invoices/:id
//   POST /invoices/:id/{send,remind,mark-paid,cancel,duplicate} · GET /invoices/:id/qr.svg
import { h, icon, clear, pageHeader, card, badge, statusBadge, toast, confirm, modal, emptyState, errorState, skeleton, stickyActionBar, filterBar, matchesQuery, dataTable, statCard, field, textareaField, selectField, moneyField, numberField, dateFieldJalali, repeater, createForm, submitButton, copyToClipboard, toFaDigits, formatToman, formatJalali, formatMobile } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/invoices.css';
const T = {
  title: 'فاکتورها', eyebrow: '[ SYSAIQ—ADMIN / INVOICES ]',
  subtitle: 'هر مرحلهٔ پروژه یک فاکتور با لینک پرداخت آنلاین یا واریز بانکی. مبلغ‌ها به تومان و بدون اعشار.',
  newInvoice: 'فاکتور جدید', search: 'جستجو در شماره، نام، موبایل یا عنوان…', all: 'همهٔ وضعیت‌ها',
  empty: 'هنوز فاکتوری ثبت نشده است', emptyHint: 'اولین فاکتور را بسازید و لینک پرداخت را برای مشتری بفرستید.',
  loadError: 'بارگذاری فاکتورها ممکن نشد',
  cols: { number: 'شماره', customer: 'مشتری', title: 'عنوان', amount: 'مبلغ', status: 'وضعیت', created: 'ایجاد', due: 'سررسید' },
  stats: { draft: 'پیش‌نویس', sent: 'در انتظار پرداخت', paid: 'پرداخت‌شده', attention: 'نیازمند توجه' },
  editor: { newTitle: 'فاکتور جدید', editTitle: n => `فاکتور ${n}`, crumb: 'فاکتورها' },
  sec: { customer: 'مشتری', invoice: 'مشخصات فاکتور', items: 'اقلام', totals: 'جمع‌بندی' },
  f: {
    lead: 'پرکردن از سرنخ', leadHint: 'با انتخاب سرنخ، نام، موبایل، ایمیل و شرکت پر می‌شود.', leadNone: '— بدون سرنخ —',
    name: 'نام مشتری', phone: 'موبایل', phoneHint: 'برای ارسال لینک با پیامک', email: 'ایمیل', company: 'شرکت', lang: 'زبان صفحهٔ پرداخت',
    title: 'عنوان فاکتور', titleHint: 'مثال: وب‌سایت شرکتی — مرحلهٔ ۱ (پیش‌پرداخت)', desc: 'توضیحات (روی صفحهٔ پرداخت دیده می‌شود)', note: 'یادداشت داخلی (فقط برای شما)',
    due: 'تاریخ سررسید', dueHint: 'خالی = مهلت پیش‌فرض تنظیمات درگاه‌ها هنگام ارسال', discount: 'تخفیف', tax: 'مالیات بر ارزش افزوده (درصد)', taxHint: '۰ یعنی بدون مالیات',
    item: 'شرح', qty: 'تعداد', unit: 'مبلغ واحد', addItem: 'افزودن قلم', itemLabel: 'قلم',
  },
  tot: { subtotal: 'جمع اقلام', discount: 'تخفیف', tax: 'مالیات', payable: 'مبلغ قابل پرداخت' },
  side: {
    status: 'وضعیت', number: 'شماره', short: 'لینک کوتاه (پیامک)', link: 'لینک پرداخت', copy: 'کپی', open: 'بازکردن', qr: 'کد QR', qrHint: 'برای چاپ روی پیش‌فاکتور یا نمایش در جلسه',
    send: 'ارسال لینک پرداخت', resend: 'ارسال دوباره', remind: 'یادآوری', markPaid: 'ثبت پرداخت دستی', cancel: 'لغو فاکتور', duplicate: 'تکثیر', del: 'حذف پیش‌نویس',
    sendTitle: 'ارسال لینک پرداخت', sendHint: 'فاکتور به وضعیت «ارسال‌شده» می‌رود و لینک برای مشتری فرستاده می‌شود. مهلت پرداخت از همین لحظه محاسبه می‌شود.',
    channel: 'روش ارسال', chSms: 'پیامک', chEmail: 'ایمیل', chBoth: 'پیامک و ایمیل', chNone: 'فقط تغییر وضعیت (لینک را خودم می‌فرستم)',
    noPhone: 'این فاکتور شماره‌همراه ندارد؛ پیامک فرستاده نمی‌شود.', noEmail: 'این فاکتور ایمیل ندارد؛ ایمیل فرستاده نمی‌شود.',
    sent: 'ارسال شد', reminded: 'یادآوری فرستاده شد',
    paidTitle: 'ثبت پرداخت دستی', paidHint: 'برای واریز بانکی یا پرداخت حضوری. فاکتور «پرداخت‌شده» می‌شود و رسید برای مشتری می‌رود.',
    ref: 'شمارهٔ پیگیری / رسید بانکی', amount: 'مبلغ دریافتی', amountHint: 'خالی = مبلغ فاکتور', paidNote: 'یادداشت', paidDone: 'پرداخت ثبت شد',
    cancelTitle: 'لغو فاکتور', cancelMsg: n => `فاکتور ${n} لغو می‌شود و لینک پرداخت آن از کار می‌افتد. این کار برگشت‌پذیر نیست.`, cancelConfirm: 'بله، لغو شود', cancelled: 'فاکتور لغو شد',
    delMsg: n => `پیش‌نویس ${n} برای همیشه حذف می‌شود.`, deleted: 'حذف شد', duplicated: 'نسخهٔ جدید ساخته شد',
    locked: 'قفل ویرایش', lockedHint: 'پرداختی برای این فاکتور ثبت یا در جریان است؛ مبلغ و اقلام دیگر تغییر نمی‌کنند. فقط یادداشت داخلی قابل ویرایش است.',
    timeline: 'پرداخت‌ها', sms: 'پیامک‌ها', noPayments: 'هنوز پرداختی ثبت نشده است.', noSms: 'هنوز پیامکی برای این فاکتور ارسال نشده است.',
    paidVia: 'روش', ref2: 'کد پیگیری', card: 'کارت',
  },
  saved: 'ذخیره شد', created: 'فاکتور ساخته شد — حالا لینک را ارسال کنید.',
};

export const INVOICE_STATUS = {
  draft: { label: 'پیش‌نویس', kind: 'warn', icon: 'pencil' },
  sent: { label: 'ارسال‌شده', kind: 'info', icon: 'send' },
  paid: { label: 'پرداخت‌شده', kind: 'ok', icon: 'check-circle' },
  cancelled: { label: 'لغوشده', kind: null, icon: 'x' },
  expired: { label: 'منقضی', kind: 'danger', icon: 'clock' },
};
export const PAYMENT_STATUS = {
  initiated: { label: 'آغازشده', kind: null, icon: 'clock' },
  pending: { label: 'در انتظار', kind: 'warn', icon: 'clock' },
  verifying: { label: 'در حال تأیید', kind: 'warn', icon: 'refresh-cw' },
  succeeded: { label: 'موفق', kind: 'ok', icon: 'check-circle' },
  failed: { label: 'ناموفق', kind: 'danger', icon: 'alert-circle' },
  cancelled: { label: 'انصراف', kind: null, icon: 'x' },
  expired: { label: 'منقضی', kind: null, icon: 'clock' },
  orphaned: { label: 'نیازمند بررسی (استرداد)', kind: 'danger', icon: 'alert-triangle' },
};
const SMS_STATUS = { queued: 'در صف', sent: 'ارسال شد', delivered: 'تحویل شد', undelivered: 'تحویل نشد', failed: 'ناموفق', blocked: 'مسدود', skipped: 'رد شد' };
const GATEWAY_LABEL = { zarinpal: 'زرین‌پال', payping: 'پی‌پینگ', zibal: 'زیبال', mock: 'آزمایشی', manual: 'واریز بانکی' };

function ensureCss(href = CSS_HREF) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
const money = n => formatToman(Number(n) || 0);
const invStatus = s => statusBadge(s, { map: INVOICE_STATUS });
const payStatus = s => statusBadge(s, { map: PAYMENT_STATUS });

// ---- list -------------------------------------------------------------------
async function mountList(root, ctx) {
  root.appendChild(pageHeader({
    eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle,
    actions: [h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => ctx.router.navigate('/invoices/new') }, icon('plus'), T.newInvoice)],
  }));
  const stats = h('div.a-stats');
  root.appendChild(stats);
  const holder = h('div');
  root.appendChild(holder);
  holder.appendChild(skeleton({ kind: 'table' }));
  let rows = [];
  const table = dataTable({
    columns: [
      { key: 'number', label: T.cols.number, ltr: true, mono: true },
      { key: 'customer_name', label: T.cols.customer, primary: true, render: r => h('span', h('span.a-table__primary', r.customer_name), r.customer_phone ? h('span.a-small.a-muted', { dir: 'ltr' }, ` ${formatMobile(r.customer_phone)}`) : null) },
      { key: 'title', label: T.cols.title },
      { key: 'amount_toman', label: T.cols.amount, num: true, render: r => money(r.amount_toman) },
      { key: 'status', label: T.cols.status, render: r => invStatus(r.status) },
      { key: 'due_at', label: T.cols.due, render: r => (r.due_at ? formatJalali(r.due_at) : '—') },
      { key: 'created_at', label: T.cols.created, render: r => formatJalali(r.created_at, { style: 'relative' }) },
    ],
    rows: [], sortable: true, sort: { key: 'created_at', dir: 'desc' },
    onRowClick: r => ctx.router.navigate(`/invoices/${r.id}`),
    actions: r => [{ icon: 'eye', label: STR.actions.view, onClick: () => ctx.router.navigate(`/invoices/${r.id}`) }],
    empty: { icon: 'receipt', title: T.empty, hint: T.emptyHint, action: { label: T.newInvoice, icon: 'plus', onClick: () => ctx.router.navigate('/invoices/new') } },
  });
  const fb = filterBar({
    search: { placeholder: T.search },
    filters: [{ name: 'status', label: T.all, options: Object.entries(INVOICE_STATUS).map(([value, v]) => ({ value, label: v.label })) }],
    onChange: v => { const list = rows.filter(r => matchesQuery(r, v.q, ['number', 'customer_name', 'customer_phone', 'title', 'short_code']) && (!v.status || r.status === v.status)); table.setRows(list); fb.setCount(list.length, rows.length); },
  });
  try {
    const [list, st] = await Promise.all([api.get('/invoices?limit=500'), api.get('/invoices/stats')]);
    rows = list;
    clear(holder);
    holder.append(fb.el, table.el);
    table.setRows(rows);
    fb.setCount(rows.length);
    const by = st.by_status || {};
    const n = k => toFaDigits(by[k]?.count || 0);
    stats.append(
      statCard({ label: T.stats.draft, value: n('draft'), icon: 'pencil' }),
      statCard({ label: T.stats.sent, value: n('sent'), icon: 'send', hint: by.sent ? money(by.sent.sum) : '' }),
      statCard({ label: T.stats.paid, value: n('paid'), icon: 'check-circle', hint: by.paid ? money(by.paid.sum) : '' }),
      statCard({ label: T.stats.attention, value: toFaDigits(st.attention || 0), icon: 'alert-triangle', href: '#/payments' }),
    );
  } catch (e) {
    clear(holder);
    holder.appendChild(errorState({ title: T.loadError, error: e, retry: () => ctx.router.reload() }));
  }
  return () => {};
}

// ---- editor -----------------------------------------------------------------
async function mountEditor(root, ctx, id) {
  const isNew = id === 'new';
  let inv = null;
  let leads = [];
  const holder = h('div');
  root.appendChild(holder);
  holder.appendChild(skeleton({ kind: 'form' }));
  try {
    [inv, leads] = await Promise.all([isNew ? null : api.get(`/invoices/${id}`), api.get('/leads').catch(() => [])]);
  } catch (e) {
    clear(holder);
    holder.appendChild(errorState({ title: T.loadError, error: e, retry: () => ctx.router.reload() }));
    return () => {};
  }
  clear(holder);
  const locked = !!inv?.locked;
  const dis = k => (locked && k !== 'note_internal');

  root.insertBefore(pageHeader({
    eyebrow: T.eyebrow, title: isNew ? T.editor.newTitle : T.editor.editTitle(inv.number),
    crumbs: [{ label: T.editor.crumb, href: '#/invoices' }, { label: isNew ? STR.actions.new : inv.number }],
    actions: inv ? [invStatus(inv.status), locked ? badge(T.side.locked, { kind: 'warn', icon: 'lock' }) : null] : [],
  }), holder);

  // customer-from-lead prefill
  const leadOptions = [{ value: '', label: T.f.leadNone }, ...leads.slice(0, 300).map(l => ({ value: String(l.id), label: `${l.name || l.email || l.phone || `#${l.id}`}${l.phone ? ` — ${formatMobile(l.phone)}` : ''}` }))];
  const leadSel = selectField({ name: 'lead_id', label: T.f.lead, hint: T.f.leadHint, options: leadOptions, disabled: dis('lead_id') });
  const fName = field({ name: 'customer_name', label: T.f.name, required: true, maxLength: 120, disabled: dis('customer_name') });
  const fPhone = field({ name: 'customer_phone', label: T.f.phone, type: 'tel', dir: 'ltr', hint: T.f.phoneHint, disabled: dis('customer_phone') });
  const fEmail = field({ name: 'customer_email', label: T.f.email, type: 'email', dir: 'ltr', lang: 'en', disabled: dis('customer_email') });
  const fCompany = field({ name: 'customer_company', label: T.f.company, maxLength: 120, disabled: dis('customer_company') });
  leadSel.onChange(v => {
    const l = leads.find(x => String(x.id) === String(v));
    if (!l) return;
    if (l.name) fName.value = l.name;
    if (l.phone) fPhone.value = l.phone;
    if (l.email) fEmail.value = l.email;
    if (l.company) fCompany.value = l.company;
    form.checkDirty();
  });

  const totalsEl = h('dl.inv-totals');
  const renderTotals = v => {
    const items = Array.isArray(v.items) ? v.items : [];
    const subtotal = items.reduce((n, it) => n + (Number(it.qty) || 0) * (Number(it.unit_toman) || 0), 0);
    const discount = Math.min(Math.max(0, Number(v.discount_toman) || 0), subtotal);
    const tax = Math.round((subtotal - discount) * (Number(v.tax_percent) || 0) / 100);
    clear(totalsEl);
    totalsEl.append(...[
      h('dt', T.tot.subtotal), h('dd', money(subtotal)),
      discount ? h('dt', T.tot.discount) : null, discount ? h('dd', `−${money(discount)}`) : null,
      tax ? h('dt', `${T.tot.tax} (${toFaDigits(v.tax_percent)}٪)`) : null, tax ? h('dd', money(tax)) : null,
      h('dt.inv-totals__total', T.tot.payable), h('dd.inv-totals__total', money(subtotal - discount + tax)),
    ].filter(Boolean));   // DOM append() would print "null"
  };

  const fields = [
    { title: T.sec.customer, columns: 2, fields: [leadSel, fName, fPhone, fEmail, fCompany, selectField({ name: 'language', label: T.f.lang, options: [{ value: 'fa', label: 'فارسی' }, { value: 'en', label: 'English' }], disabled: dis('language') })] },
    { title: T.sec.invoice, columns: 2, fields: [
      field({ name: 'title', label: T.f.title, required: true, maxLength: 160, hint: T.f.titleHint, disabled: dis('title') }),
      dateFieldJalali({ name: 'due_at', label: T.f.due, hint: T.f.dueHint, disabled: dis('due_at') }),
      moneyField({ name: 'discount_toman', label: T.f.discount, disabled: dis('discount_toman') }),
      numberField({ name: 'tax_percent', label: T.f.tax, min: 0, max: 25, suffix: '٪', hint: T.f.taxHint, disabled: dis('tax_percent') }),
      textareaField({ name: 'description', label: T.f.desc, rows: 3, maxLength: 2000, disabled: dis('description') }),
      textareaField({ name: 'note_internal', label: T.f.note, rows: 3, maxLength: 2000 }),
    ] },
    { title: T.sec.items, fields: [
      repeater({ name: 'items', label: T.sec.items, addLabel: T.f.addItem, itemLabel: T.f.itemLabel, max: 40, min: 1, empty: { title: '', qty: 1, unit_toman: null },
        summary: row => row.title, item: () => [field({ name: 'title', label: T.f.item, required: true, maxLength: 200, disabled: locked }), numberField({ name: 'qty', label: T.f.qty, min: 1, max: 10000, disabled: locked }), moneyField({ name: 'unit_toman', label: T.f.unit, disabled: locked })] }),
      h('section.a-form__section', h('h3', T.sec.totals), totalsEl),
    ] },
  ];
  const values = inv ? { lead_id: inv.lead_id ? String(inv.lead_id) : '', customer_name: inv.customer_name, customer_phone: inv.customer_phone, customer_email: inv.customer_email, customer_company: inv.customer_company, language: inv.language, title: inv.title, due_at: inv.due_at ? inv.due_at.slice(0, 10) : '', discount_toman: inv.discount_toman, tax_percent: inv.tax_percent, description: inv.description, note_internal: inv.note_internal, items: inv.items.map(({ title, qty, unit_toman }) => ({ title, qty, unit_toman })) }
    : { language: 'fa', tax_percent: 0, discount_toman: null, items: [{ title: '', qty: 1, unit_toman: null }] };
  const form = createForm({
    fields, values, dirtyToken: 'invoice',
    onChange: renderTotals,
    onDirty: d => bar.setDirty(d),
    onSubmit: async v => {
      const body = locked ? { note_internal: v.note_internal } : { ...v, lead_id: v.lead_id || null, due_at: v.due_at || '' };
      const saved = isNew ? await api.post('/invoices', body) : await api.put(`/invoices/${inv.id}`, body);
      toast(isNew ? T.created : T.saved);
      form.markClean();
      if (isNew) ctx.router.navigate(`/invoices/${saved.id}`, { replace: true });
      else { inv = saved; renderSide(); }
    },
  });
  renderTotals(form.getValues());
  const bar = stickyActionBar({ actions: [h('a.a-btn.a-btn--ghost', { href: '#/invoices' }, STR.actions.back), submitButton(form, { label: isNew ? STR.actions.create : STR.actions.save })] });

  // ---- side panel ----
  const side = h('aside.inv-side');
  const layout = h('div.inv-layout', h('div.inv-main', card({ body: form.el, hint: locked ? T.side.lockedHint : null }), bar), side);
  holder.appendChild(layout);

  const reload = async () => { inv = await api.get(`/invoices/${inv.id}`); renderSide(); };
  const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); await reload(); } catch (e) { toast.error(e?.message || STR.errors.generic); } };
  const sendDialog = (reminder = false) => {
    const opts = [{ value: 'sms', label: T.side.chSms }, { value: 'email', label: T.side.chEmail }, { value: 'both', label: T.side.chBoth }, ...(reminder ? [] : [{ value: 'none', label: T.side.chNone }])];
    const ch = selectField({ name: 'channel', label: T.side.channel, options: opts });
    ch.value = inv.customer_phone ? 'sms' : inv.customer_email ? 'email' : 'none';
    const warn = h('div.a-stack.a-stack--sm', !inv.customer_phone ? h('div.a-hint.a-warn', T.side.noPhone) : null, !inv.customer_email ? h('div.a-hint', T.side.noEmail) : null);
    const m = modal({ title: reminder ? T.side.remind : T.side.sendTitle, body: h('div.a-stack', h('p', T.side.sendHint), ch.el, warn),
      actions: [{ label: STR.actions.cancel, kind: 'ghost' }, { label: reminder ? T.side.remind : T.side.send, kind: 'primary', onClick: () => act(() => api.post(`/invoices/${inv.id}/${reminder ? 'remind' : 'send'}`, { channel: ch.value }), reminder ? T.side.reminded : T.side.sent) }] });
    m.open();
  };
  const markPaidDialog = () => {
    const ref = field({ name: 'ref', label: T.side.ref, dir: 'ltr', maxLength: 120 });
    const amount = moneyField({ name: 'amount', label: T.side.amount, hint: T.side.amountHint });
    const note = textareaField({ name: 'note', label: T.side.paidNote, rows: 2, maxLength: 500 });
    const m = modal({ title: T.side.paidTitle, body: h('div.a-stack', h('p', T.side.paidHint), ref.el, amount.el, note.el),
      actions: [{ label: STR.actions.cancel, kind: 'ghost' }, { label: T.side.markPaid, kind: 'primary', onClick: () => act(() => api.post(`/invoices/${inv.id}/mark-paid`, { ref: ref.value, amount: amount.value ?? '', note: note.value }), T.side.paidDone) }] });
    m.open();
  };

  function renderSide() {
    clear(side);
    if (!inv) { side.appendChild(card({ title: T.side.status, body: h('p.a-muted', 'پس از ایجاد فاکتور، لینک پرداخت و عملیات این‌جا ظاهر می‌شود.') })); return; }
    const linkRow = (label, url) => h('div.inv-link', h('span.a-small.a-muted', label), h('code', { dir: 'ltr' }, url),
      h('div.a-row', h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => copyToClipboard(url) }, icon('copy', { size: 'sm' }), T.side.copy), h('a.a-btn.a-btn--sm.a-btn--ghost', { href: url, target: '_blank', rel: 'noopener' }, icon('external-link', { size: 'sm' }), T.side.open)));
    const s = inv.status;
    const btn = (label, ic, onclick, cls = '') => h(`button.a-btn${cls}`, { type: 'button', onclick }, icon(ic, { size: 'sm' }), label);
    const actions = [
      ['draft', 'sent', 'expired'].includes(s) ? btn(s === 'draft' ? T.side.send : T.side.resend, 'send', () => sendDialog(false), '.a-btn--primary') : null,
      s === 'sent' ? btn(T.side.remind, 'clock', () => sendDialog(true)) : null,
      ['draft', 'sent', 'expired'].includes(s) ? btn(T.side.markPaid, 'check-circle', markPaidDialog) : null,
      btn(T.side.duplicate, 'copy', () => act(async () => { const d = await api.post(`/invoices/${inv.id}/duplicate`); ctx.router.navigate(`/invoices/${d.id}`); }, T.side.duplicated)),
      ['draft', 'sent', 'expired'].includes(s) ? btn(T.side.cancel, 'x', async () => { if (await confirm({ title: T.side.cancelTitle, message: T.side.cancelMsg(inv.number), confirmLabel: T.side.cancelConfirm, danger: true })) act(() => api.post(`/invoices/${inv.id}/cancel`, {}), T.side.cancelled); }, '.a-btn--danger') : null,
      s === 'draft' && !inv.payments.length ? btn(T.side.del, 'trash', async () => { if (await confirm({ message: T.side.delMsg(inv.number), confirmLabel: STR.confirm.deleteConfirm, danger: true })) { try { await api.del(`/invoices/${inv.id}`); toast(T.side.deleted); ctx.router.navigate('/invoices'); } catch (e) { toast.error(e?.message); } } }, '.a-btn--ghost') : null,
    ];
    side.append(
      card({ title: T.side.status, actions: [invStatus(s)], body: h('div.a-stack.a-stack--sm',
        h('dl.a-dl', h('dt', T.side.number), h('dd', h('code', { dir: 'ltr' }, inv.number)), h('dt', T.tot.payable), h('dd', h('strong', money(inv.amount_toman))),
          inv.due_at ? h('dt', T.f.due) : null, inv.due_at ? h('dd', formatJalali(inv.due_at)) : null,
          inv.paid_at ? h('dt', 'پرداخت در') : null, inv.paid_at ? h('dd', formatJalali(inv.paid_at, { style: 'datetime' })) : null),
        h('div.a-row.a-wrap', actions)) }),
      card({ title: T.side.link, body: h('div.a-stack.a-stack--sm', linkRow(T.side.short, inv.short_url), linkRow(T.side.link, inv.pay_url),
        h('div.inv-qr', h('img', { src: `/api/admin/invoices/${inv.id}/qr.svg?v=${Date.now()}`, alt: T.side.qr, width: 160, height: 160 }), h('div.a-small.a-muted', T.side.qrHint))) }),
      card({ title: T.side.timeline, body: inv.payments.length ? h('ul.inv-timeline', inv.payments.map(p => h('li', { class: `inv-timeline__${p.status}` },
        h('div.a-row', payStatus(p.status), h('span', GATEWAY_LABEL[p.gateway] || p.gateway), h('strong', money(p.amount_toman))),
        h('div.a-small.a-muted', formatJalali(p.created_at, { style: 'datetime' }), p.ref_id ? h('span', { dir: 'ltr' }, ` · ${T.side.ref2}: ${p.ref_id}`) : null, p.card_pan ? h('span', { dir: 'ltr' }, ` · ${p.card_pan}`) : null),
        p.error_message ? h('div.a-small.a-danger', p.error_message) : null))) : h('p.a-muted', T.side.noPayments) }),
      card({ title: T.side.sms, body: inv.sms?.length ? h('ul.inv-timeline', inv.sms.map(m => h('li', h('div.a-row', badge(SMS_STATUS[m.status] || m.status, { kind: m.status === 'sent' || m.status === 'delivered' ? 'ok' : m.status === 'failed' || m.status === 'blocked' ? 'danger' : 'warn' }), h('span', m.template_key), h('span', { dir: 'ltr' }, formatMobile(m.to_number))), h('div.a-small.a-muted', formatJalali(m.created_at, { style: 'datetime' }), m.error_message ? ` · ${m.error_message}` : '')))) : h('p.a-muted', T.side.noSms) }),
    );
  }
  renderSide();
  return () => form.destroy();
}

export default {
  title: T.title,
  async mount(root, ctx) {
    ensureCss();
    const id = ctx.params?.id;
    return id ? mountEditor(root, ctx, id) : mountList(root, ctx);
  },
};
