// «گزارش تغییرات» — the audit trail, read-only.
//   GET /audit?entity=&action=&page= → {rows, page, per_page, total}
import { h, icon, clear, pageHeader, card, badge, dataTable, filterBar, modal, skeleton, toFaDigits, formatJalali } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/audit.css';
const ENTITIES = { pages: 'صفحات', services: 'خدمات', sections: 'بخش‌ها', projects: 'پروژه‌ها', faqs: 'سؤالات متداول', content: 'متن‌های سایت', site_info: 'اطلاعات تماس', badges: 'نمادها', head_meta: 'تگ‌های تأیید', sms: 'پیامک', sms_log: 'گزارش پیامک', sms_templates: 'قالب‌های پیامک', leads: 'سرنخ‌ها', knowledge: 'پایگاه دانش', settings: 'تنظیمات', secrets: 'کلیدها', admins: 'مدیران', session: 'نشست', uploads: 'رسانه‌ها', system: 'سیستم' };
const ACTIONS = { create: { label: 'ایجاد', kind: 'ok', icon: 'plus' }, update: { label: 'ویرایش', kind: 'info', icon: 'pencil' }, delete: { label: 'حذف', kind: 'danger', icon: 'trash' }, publish: { label: 'انتشار', kind: 'ok', icon: 'globe' }, unpublish: { label: 'لغو انتشار', kind: 'warn', icon: 'eye-off' }, login: { label: 'ورود', kind: 'violet', icon: 'log-in' }, logout: { label: 'خروج', kind: null, icon: 'log-out' }, write: { label: 'نوشتن', kind: 'info', icon: 'save' } };
const actionMeta = a => ACTIONS[a] || { label: a, kind: a?.startsWith('sms') ? 'info' : null, icon: a?.startsWith('sms') ? 'send' : 'activity' };

const T = {
  title: 'گزارش تغییرات', subtitle: 'هر تغییری که از پنل انجام شده: چه کسی، چه زمانی، روی چه چیزی. این گزارش فقط‌خواندنی است.',
  eyebrow: '[ SYSAIQ—ADMIN / AUDIT ]',
  allEntities: 'همهٔ بخش‌ها', allActions: 'همهٔ عملیات',
  colWhen: 'زمان', colWho: 'مدیر', colAction: 'عملیات', colEntity: 'بخش', colSummary: 'شرح', colIp: 'IP',
  empty: 'هنوز تغییری ثبت نشده است', prev: 'قبلی', next: 'بعدی', details: 'جزئیات', meta: 'دادهٔ همراه',
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
const parseMeta = m => { if (!m) return null; if (typeof m === 'object') return m; try { return JSON.parse(m); } catch { return { raw: String(m) }; } };

async function mount(root) {
  ensureStylesheet(CSS_HREF);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle }));
  let page = 1;
  let data = { rows: [], total: 0, page: 1, per_page: 50 };
  const table = dataTable({
    columns: [
      { key: 'created_at', label: T.colWhen, render: r => h('span.a-nowrap', formatJalali(r.created_at, { style: 'datetime' })) },
      { key: 'admin_name', label: T.colWho, render: r => r.admin_name || (r.admin_id ? `#${toFaDigits(r.admin_id)}` : '—') },
      { key: 'action', label: T.colAction, render: r => { const m = actionMeta(r.action); return badge(m.label, { kind: m.kind, icon: m.icon }); } },
      { key: 'entity', label: T.colEntity, render: r => h('span.a-row', h('span', ENTITIES[r.entity] || r.entity || '—'), r.entity_id ? h('span.a-small.a-muted.a-mono', { dir: 'ltr' }, String(r.entity_id)) : null) },
      { key: 'summary', label: T.colSummary, render: r => h('span.au-summary', { dir: 'auto' }, r.summary || '—') },
      { key: 'ip', label: T.colIp, ltr: true, mono: true },
    ],
    onRowClick: r => details(r),
    empty: { icon: 'history', title: T.empty },
  });
  const filters = filterBar({
    filters: [
      { name: 'entity', label: T.allEntities, options: Object.entries(ENTITIES).map(([value, label]) => ({ value, label })) },
      { name: 'action', label: T.allActions, options: Object.entries(ACTIONS).map(([value, m]) => ({ value, label: m.label })) },
    ],
    onChange: () => { page = 1; load(); },
  });
  const pager = h('div.a-table__foot', { hidden: true });
  let seq = 0;
  async function load() {
    const my = ++seq;
    table.setLoading(true);
    const qs = new URLSearchParams({ page: String(page) });
    if (filters.values.entity) qs.set('entity', filters.values.entity);
    if (filters.values.action) qs.set('action', filters.values.action);
    try {
      const r = await api.get(`/audit?${qs}`);
      if (my !== seq || !root.isConnected) return;
      data = r;
      table.setRows(r.rows);
      filters.setCount(r.rows.length, r.total);
      const pages = Math.max(1, Math.ceil(r.total / r.per_page));
      clear(pager);
      pager.append(
        h('button.a-btn.a-btn--sm', { type: 'button', disabled: page <= 1, onclick: () => { page--; load(); } }, icon('chevron-right', { size: 'sm' }), T.prev),
        h('span', STR.states.of(page, pages)),
        h('button.a-btn.a-btn--sm', { type: 'button', disabled: page >= pages, onclick: () => { page++; load(); } }, T.next, icon('chevron-left', { size: 'sm' })),
        h('span.a-grow'), h('span', STR.states.items(r.total)));
      pager.hidden = pages <= 1;
    } catch (e) { if (my === seq) table.setError(e, load); }
  }
  function details(r) {
    const meta = parseMeta(r.meta);
    const m = actionMeta(r.action);
    const rows = [[T.colWhen, formatJalali(r.created_at, { style: 'datetime' })], [T.colWho, r.admin_name || '—'], [T.colAction, m.label], [T.colEntity, `${ENTITIES[r.entity] || r.entity || '—'}${r.entity_id ? ` (${r.entity_id})` : ''}`], [T.colIp, r.ip || '—']];
    modal({
      title: `${T.details} — ${toFaDigits(r.id)}`,
      body: h('div.a-stack', h('div.au-text', { dir: 'auto' }, r.summary || '—'), h('dl.a-dl', rows.flatMap(([k, v]) => [h('dt', k), h('dd', { dir: 'auto' }, String(v))])), meta ? h('div', h('div.a-label', T.meta), h('pre.au-meta', { dir: 'ltr' }, JSON.stringify(meta, null, 2))) : null),
      actions: [{ label: STR.actions.close, kind: 'ghost' }],
    }).open();
  }
  root.append(card({ body: [filters.el, table.el, pager] }));
  await load();
}

export default { title: T.title, mount };
