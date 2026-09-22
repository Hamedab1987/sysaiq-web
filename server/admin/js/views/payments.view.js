// «پرداخت‌ها» — every gateway attempt across invoices, with «بررسی مجدد»
// (server-side re-verify with the stored amount) and the reconcile pass.
//   GET /invoices/payments?status · POST /invoices/payments/:id/reverify · POST /invoices/payments/reconcile
import { h, icon, clear, pageHeader, card, badge, statusBadge, toast, modal, errorState, skeleton, filterBar, matchesQuery, dataTable, formatToman, formatJalali } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const T = {
  title: 'پرداخت‌ها', eyebrow: '[ SYSAIQ—ADMIN / PAYMENTS ]',
  subtitle: 'هر تلاش پرداخت از درگاه یا ثبت دستی. «نیازمند بررسی» یعنی پول رسیده ولی با فاکتور نمی‌خواند یا فاکتور قبلاً تسویه شده — باید دستی استرداد شود.',
  reconcile: 'اجرای تطبیق', reconciled: r => `تطبیق انجام شد: ${r.checked} بررسی، ${r.verified} تأیید، ${r.expired} منقضی`,
  reverify: 'بررسی مجدد', reverified: o => `نتیجه: ${PAYMENT_STATUS[o]?.label || o}`,
  search: 'جستجو در شمارهٔ فاکتور، مشتری یا کد پیگیری…', all: 'همهٔ وضعیت‌ها', empty: 'هنوز پرداختی ثبت نشده است', loadError: 'بارگذاری پرداخت‌ها ممکن نشد',
  cols: { id: '#', invoice: 'فاکتور', customer: 'مشتری', gateway: 'درگاه', amount: 'مبلغ', status: 'وضعیت', ref: 'کد پیگیری', created: 'زمان' },
  detail: 'جزئیات پرداخت', authority: 'شناسهٔ درگاه', card: 'کارت', fee: 'کارمزد', error: 'خطا', claimed: 'claim', verified: 'تأیید در', already: 'قبلاً تأیید شده بود', invoiceStatus: 'وضعیت فاکتور', openInvoice: 'بازکردن فاکتور',
};
// same maps as invoices.view.js (views import only ui/api/strings)
const INVOICE_STATUS = {
  draft: { label: 'پیش‌نویس', kind: 'warn', icon: 'pencil' }, sent: { label: 'ارسال‌شده', kind: 'info', icon: 'send' }, paid: { label: 'پرداخت‌شده', kind: 'ok', icon: 'check-circle' },
  cancelled: { label: 'لغوشده', kind: null, icon: 'x' }, expired: { label: 'منقضی', kind: 'danger', icon: 'clock' },
};
const PAYMENT_STATUS = {
  initiated: { label: 'آغازشده', kind: null, icon: 'clock' }, pending: { label: 'در انتظار', kind: 'warn', icon: 'clock' }, verifying: { label: 'در حال تأیید', kind: 'warn', icon: 'refresh-cw' },
  succeeded: { label: 'موفق', kind: 'ok', icon: 'check-circle' }, failed: { label: 'ناموفق', kind: 'danger', icon: 'alert-circle' }, cancelled: { label: 'انصراف', kind: null, icon: 'x' },
  expired: { label: 'منقضی', kind: null, icon: 'clock' }, orphaned: { label: 'نیازمند بررسی (استرداد)', kind: 'danger', icon: 'alert-triangle' },
};
const GATEWAY_LABEL = { zarinpal: 'زرین‌پال', payping: 'پی‌پینگ', zibal: 'زیبال', mock: 'آزمایشی', manual: 'واریز بانکی' };
const money = n => formatToman(Number(n) || 0);
const canReverify = p => p.gateway !== 'manual' && p.authority && p.status !== 'succeeded';

export default {
  title: T.title,
  async mount(root, ctx) {
    let rows = [];
    const holder = h('div');
    const reconcileBtn = h('button.a-btn', { type: 'button', onclick: async () => {
      reconcileBtn.disabled = true;
      try { const r = await api.post('/invoices/payments/reconcile', {}); toast(T.reconciled(r)); await load(); } catch (e) { toast.error(e?.message || STR.errors.generic); } finally { reconcileBtn.disabled = false; }
    } }, icon('refresh-cw'), T.reconcile);
    root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle, actions: [reconcileBtn] }));
    root.appendChild(holder);

    const reverify = async p => {
      try { const r = await api.post(`/invoices/payments/${p.id}/reverify`, {}); toast(T.reverified(r.outcome), { kind: r.outcome === 'succeeded' || r.outcome === 'replayed' ? 'success' : 'info' }); await load(); } catch (e) { toast.error(e?.message || STR.errors.generic); }
    };
    const detail = p => modal({ title: `${T.detail} #${p.id}`, body: h('dl.a-dl',
      h('dt', T.cols.invoice), h('dd', h('a', { href: `#/invoices/${p.invoice_id}` }, h('code', { dir: 'ltr' }, p.invoice_number)), ' ', statusBadge(p.invoice_status, { map: INVOICE_STATUS })),
      h('dt', T.cols.customer), h('dd', p.customer_name),
      h('dt', T.cols.gateway), h('dd', GATEWAY_LABEL[p.gateway] || p.gateway),
      h('dt', T.cols.amount), h('dd', money(p.amount_toman)),
      h('dt', T.cols.status), h('dd', statusBadge(p.status, { map: PAYMENT_STATUS }), p.already_verified ? badge(T.already, { kind: 'info' }) : null),
      h('dt', T.authority), h('dd', h('code', { dir: 'ltr' }, p.authority || '—')),
      h('dt', T.cols.ref), h('dd', h('code', { dir: 'ltr' }, p.ref_id || '—')),
      p.card_pan ? h('dt', T.card) : null, p.card_pan ? h('dd', h('code', { dir: 'ltr' }, p.card_pan)) : null,
      p.fee_toman !== null && p.fee_toman !== undefined ? h('dt', T.fee) : null, p.fee_toman !== null && p.fee_toman !== undefined ? h('dd', money(p.fee_toman)) : null,
      p.error_code ? h('dt', T.error) : null, p.error_code ? h('dd', h('code', { dir: 'ltr' }, p.error_code), ' ', p.error_message) : null,
      h('dt', T.cols.created), h('dd', formatJalali(p.created_at, { style: 'datetime' })),
      p.verified_at ? h('dt', T.verified) : null, p.verified_at ? h('dd', formatJalali(p.verified_at, { style: 'datetime' })) : null),
    actions: [{ label: STR.actions.close, kind: 'ghost' }, { label: T.openInvoice, kind: 'ghost', onClick: () => ctx.router.navigate(`/invoices/${p.invoice_id}`) }, ...(canReverify(p) ? [{ label: T.reverify, kind: 'primary', onClick: () => reverify(p) }] : [])] }).open();

    const table = dataTable({
      columns: [
        { key: 'id', label: T.cols.id, num: true },
        { key: 'invoice_number', label: T.cols.invoice, ltr: true, mono: true },
        { key: 'customer_name', label: T.cols.customer, primary: true },
        { key: 'gateway', label: T.cols.gateway, render: r => GATEWAY_LABEL[r.gateway] || r.gateway },
        { key: 'amount_toman', label: T.cols.amount, num: true, render: r => money(r.amount_toman) },
        { key: 'status', label: T.cols.status, render: r => statusBadge(r.status, { map: PAYMENT_STATUS }) },
        { key: 'ref_id', label: T.cols.ref, ltr: true, mono: true },
        { key: 'created_at', label: T.cols.created, render: r => formatJalali(r.created_at, { style: 'datetime' }) },
      ],
      rows: [], sortable: true, sort: { key: 'id', dir: 'desc' },
      onRowClick: detail,
      actions: r => [{ icon: 'eye', label: STR.actions.view, onClick: () => detail(r) }, ...(canReverify(r) ? [{ icon: 'refresh-cw', label: T.reverify, onClick: () => reverify(r) }] : [])],
      empty: { icon: 'credit-card', title: T.empty },
    });
    const fb = filterBar({
      search: { placeholder: T.search },
      filters: [{ name: 'status', label: T.all, options: Object.entries(PAYMENT_STATUS).map(([value, v]) => ({ value, label: v.label })) }],
      onChange: v => { const list = rows.filter(r => matchesQuery(r, v.q, ['invoice_number', 'customer_name', 'ref_id', 'authority']) && (!v.status || r.status === v.status)); table.setRows(list); fb.setCount(list.length, rows.length); },
    });
    async function load() {
      try {
        rows = await api.get('/invoices/payments?limit=500');
        clear(holder);
        holder.append(card({ body: h('div.a-stack.a-stack--sm', fb.el, table.el), flush: true }));
        table.setRows(rows);
        fb.setCount(rows.length);
      } catch (e) {
        clear(holder);
        holder.appendChild(errorState({ title: T.loadError, error: e, retry: load }));
      }
    }
    holder.appendChild(skeleton({ kind: 'table' }));
    await load();
    return () => {};
  },
};
