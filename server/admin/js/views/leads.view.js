// Leads: table + detail drawer. The legacy API is read + delete only
// (GET /leads · DELETE /leads/:id); the pipeline/notes UI arrives with the
// leads workstream and will use the same table.
import { h, icon, pageHeader, dataTable, filterBar, matchesQuery, statusBadge, badge, confirm, toast, drawer, formatJalali, formatMobile, truncate, copyToClipboard, toFaDigits } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const T = {
  title: 'سرنخ‌ها', subtitle: 'درخواست‌های فرم تماس و سرنخ‌هایی که دستیار هوشمند ثبت کرده است.',
  search: 'جستجو در نام، ایمیل، تلفن، شرکت…', allSources: 'همهٔ منابع', allLangs: 'همهٔ زبان‌ها', allStatus: 'همهٔ وضعیت‌ها',
  colName: 'نام', colContact: 'تماس', colSource: 'منبع', colStatus: 'وضعیت', colDate: 'تاریخ',
  noName: '(بدون نام)', detail: 'جزئیات سرنخ',
  name: 'نام', email: 'ایمیل', phone: 'تلفن', company: 'شرکت', type: 'نوع پروژه', message: 'پیام', summary: 'خلاصهٔ دستیار', lang: 'زبان', source: 'منبع', page: 'صفحه', score: 'امتیاز', date: 'تاریخ ثبت', business: 'نوع کسب‌وکار', service: 'خدمت', pref: 'روش تماس ترجیحی', session: 'گفت‌وگو',
  call: 'تماس', mail: 'ایمیل', openChat: 'مشاهدهٔ گفت‌وگو',
  archivedHint: 'حذف سرنخ، اطلاعات شخصی آن را برای همیشه پاک می‌کند.',
};

const contactCell = l => h('div.a-stack', { style: null },
  l.phone ? h('a.a-link', { href: `tel:${String(l.phone).replace(/[^\d+]/g, '')}`, dir: 'ltr' }, formatMobile(l.phone)) : null,
  l.email ? h('a.a-link.a-small', { href: `mailto:${l.email}`, dir: 'ltr' }, l.email) : null,
  !l.phone && !l.email ? '—' : null);

export default {
  title: T.title,
  async mount(root, ctx) {
    root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / LEADS ]', title: T.title, subtitle: T.subtitle }));
    let all = [];
    let openDrawer = null;
    const table = dataTable({
      columns: [
        { key: 'name', label: T.colName, render: l => h('div', h('div.a-table__primary', l.name || T.noName), l.company ? h('div.a-table__secondary', l.company) : null) },
        { key: 'phone', label: T.colContact, render: contactCell },
        { key: 'source', label: T.colSource, render: l => h('div.a-row', { style: null }, statusBadge(l.source || 'form'), badge(l.language === 'fa' ? 'فارسی' : 'EN', { ltr: l.language !== 'fa' })) },
        { key: 'status', label: T.colStatus, render: l => statusBadge(l.status || 'new') },
        { key: 'created_at', label: T.colDate, render: l => h('span', { title: formatJalali(l.created_at, { style: 'datetime' }) }, formatJalali(l.created_at, { style: 'relative' })) },
      ],
      onRowClick: l => show(l),
      actions: l => [
        { icon: 'eye', label: STR.actions.view, onClick: () => show(l) },
        { icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => remove(l) },
      ],
      empty: { icon: 'users', title: 'هنوز سرنخی ثبت نشده است', hint: 'وقتی کسی فرم تماس را پر کند یا دستیار هوشمند سرنخی ثبت کند، اینجا نمایش داده می‌شود.' },
      pageSize: 50,
    });
    const filters = filterBar({
      search: { placeholder: T.search },
      filters: [
        { name: 'status', label: T.allStatus, options: ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'].map(s => ({ value: s, label: ctx.ui.STATUS_MAP[s].label })) },
        { name: 'source', label: T.allSources, options: [{ value: 'form', label: 'فرم تماس' }, { value: 'ai', label: 'دستیار هوشمند' }] },
        { name: 'language', label: T.allLangs, options: [{ value: 'fa', label: 'فارسی' }, { value: 'en', label: 'English' }] },
      ],
      onChange: apply,
    });
    function apply(v = filters.values) {
      const rows = all.filter(l => matchesQuery(l, v.q, ['name', 'email', 'phone', 'company', 'message', 'project_type'])
        && (!v.status || (l.status || 'new') === v.status) && (!v.source || (l.source || 'form') === v.source) && (!v.language || l.language === v.language));
      table.setRows(rows); filters.setCount(rows.length, all.length);
    }
    const load = async () => {
      try { all = await api.get('/leads'); if (!Array.isArray(all)) all = []; if (root.isConnected) apply(); ctx.store.update('counters', c => ({ ...c, leads: all.length, newLeads: all.filter(l => (l.status || 'new') === 'new' && !l.archived_at).length })); }
      catch (e) { table.setError(e, load); }
    };
    async function remove(l) {
      if (!(await confirm({ message: `${STR.confirm.deleteMessage(l.name || l.email || l.phone)} ${T.archivedHint}`, confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
      try { await api.del(`/leads/${l.id}`); toast(STR.states.deleted); all = all.filter(x => x.id !== l.id); apply(); openDrawer?.close('force'); } catch (e) { toast.error(e.message); }
    }
    function show(l) {
      const row = (label, value, opts = {}) => (value ? [h('dt', label), h('dd', opts.ltr ? h('span', { dir: 'ltr' }, value) : value)] : []);
      const body = h('div.a-stack',
        h('div.a-row', statusBadge(l.status || 'new'), statusBadge(l.source || 'form'), badge(l.language === 'fa' ? 'فارسی' : 'English', { ltr: l.language !== 'fa' }), l.lead_score ? badge(`${T.score}: ${toFaDigits(l.lead_score)}`, { kind: 'violet', icon: 'star' }) : null),
        h('dl.a-dl',
          ...row(T.name, l.name), ...row(T.company, l.company),
          ...row(T.phone, l.phone ? h('a.a-link', { href: `tel:${String(l.phone).replace(/[^\d+]/g, '')}`, dir: 'ltr' }, formatMobile(l.phone)) : null),
          ...row(T.email, l.email ? h('a.a-link', { href: `mailto:${l.email}`, dir: 'ltr' }, l.email) : null),
          ...row(T.type, l.project_type), ...row(T.business, l.business_type), ...row(T.service, l.service_slug, { ltr: true }), ...row(T.pref, l.contact_pref),
          ...row(T.page, l.page, { ltr: true }), ...row(T.date, formatJalali(l.created_at, { style: 'datetime' })),
          ...row(T.session, l.session_id ? h('a.a-link', { href: `#/conversations/${encodeURIComponent(l.session_id)}` }, T.openChat) : null),
        ),
        l.message ? h('div', h('div.a-label', T.message), h('div.a-chat__msg.a-chat__msg--user', l.message)) : null,
        l.summary ? h('div', h('div.a-label', T.summary), h('div.a-chat__msg.a-chat__msg--assistant', l.summary)) : null,
      );
      const d = drawer({
        title: T.detail, body,
        actions: [
          l.email ? { label: STR.actions.copy + ' ' + T.email, kind: 'ghost', icon: 'copy', close: false, onClick: () => copyToClipboard(l.email) } : null,
          { label: STR.actions.delete, kind: 'danger', icon: 'trash', close: false, onClick: () => remove(l) },
          { label: STR.actions.close, kind: 'ghost', value: 'close' },
        ].filter(Boolean),
        onClose: () => { openDrawer = null; },
      });
      openDrawer = d; d.open();
    }
    root.append(filters.el, table.el);
    table.setLoading(true);
    await load();
    if (ctx.params?.id) { const l = all.find(x => String(x.id) === ctx.params.id); if (l) show(l); }
    return () => openDrawer?.close('force');
  },
};
