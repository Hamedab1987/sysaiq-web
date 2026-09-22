// Kitchen sink — every ui.js export rendered with sample data. This is the
// executable reference for view authors: copy the call shown under each demo.
// Reachable at #/_ui (not in the sidebar).
import * as U from '../ui.js';
import { STR } from '../strings.js';

const { h, icon, pageHeader, card, tabs, stickyActionBar, statCard, checklist, progressRing, badge, statusBadge, emptyState, errorState, skeleton, toast, modal, drawer, confirm, dataTable, filterBar, createForm, submitButton, field, textareaField, selectField, switchField, numberField, moneyField, dateFieldJalali, tagsField, slugField, secretField, codeField, markdownField, imageField, bilingualField, repeater, copyToClipboard, registerShortcut, debounce, toFaDigits, toEnDigits, formatNumber, formatToman, formatJalali, parseServerDate, formatMobile, formatBytes, truncate, validators, validate, extLink } = U;

const demo = (title, call, ...nodes) => h('section.a-stack.a-stack--sm', { id: `demo-${title.replace(/\W+/g, '-')}` },
  h('h3', title), h('code.a-small.a-muted', { dir: 'ltr' }, call), ...nodes);

export default {
  title: 'مرجع اجزای رابط',
  async mount(root) {
    const now = new Date();
    root.appendChild(pageHeader({
      eyebrow: '[ SYSAIQ—ADMIN / UI KIT ]', title: 'مرجع اجزای رابط کاربری', subtitle: 'هر خروجی ui.js با دادهٔ نمونه. نمای زنده + فراخوانی دقیق زیر هر نمونه.',
      crumbs: [{ label: 'داشبورد', href: '#/' }, { label: '_ui' }],
      actions: [h('button.a-btn', { type: 'button', onclick: () => toast('نمونهٔ پیام موفق') }, icon('check'), 'toast()'), h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => toast.error('نمونهٔ پیام خطا') }, 'toast.error()')],
    }));

    // ---- formatting ----
    const fmtRows = [
      ['toFaDigits("1405/06/31")', toFaDigits('1405/06/31')],
      ['toEnDigits("۰۹۱۲۵۱۳۰۵۰۵")', toEnDigits('۰۹۱۲۵۱۳۰۵۰۵')],
      ['formatNumber(12500000)', formatNumber(12500000)],
      ['formatToman(12500000)', formatToman(12500000)],
      ['formatMobile("09125130505")', formatMobile('09125130505')],
      ['formatBytes(8388608)', formatBytes(8388608)],
      ['parseServerDate("2026-09-22 10:30:00").toISOString()', parseServerDate('2026-09-22 10:30:00').toISOString()],
      ['formatJalali("2026-09-22 10:30:00")', formatJalali('2026-09-22 10:30:00')],
      ['formatJalali(d, {style:"datetime"})', formatJalali('2026-09-22 10:30:00', { style: 'datetime' })],
      ['formatJalali(d, {style:"long"})', formatJalali('2026-09-22 10:30:00', { style: 'long' })],
      ['formatJalali(d, {style:"numeric"})', formatJalali('2026-09-22 10:30:00', { style: 'numeric' })],
      ['formatJalali(now - 3h, {style:"relative"})', formatJalali(new Date(now - 3 * 3600e3), { style: 'relative' })],
      ['truncate("متن بسیار طولانی…", 12)', truncate('متن بسیار طولانی برای آزمایش کوتاه‌سازی', 12)],
      ['validate({m:[validators.mobile()]}, {m:"0912"})', JSON.stringify(validate({ m: [validators.mobile()] }, { m: '0912' }))],
    ];
    root.appendChild(card({ title: 'قالب‌بندی — format', body: h('dl.a-dl', fmtRows.flatMap(([k, v]) => [h('dt', h('code', { dir: 'ltr' }, k)), h('dd', { dir: 'auto' }, v)])) }));

    // ---- feedback ----
    const ring = progressRing({ value: 6, max: 9, label: 'راه‌اندازی' });
    root.appendChild(card({ title: 'بازخورد — feedback', body: [
      demo('badge / statusBadge', "badge('متن', {kind:'ok'|'warn'|'danger'|'info'|'violet', icon}) · statusBadge('published'|'draft'|'new'|…)",
        h('div.a-row', badge('پیش‌فرض'), badge('موفق', { kind: 'ok', icon: 'check' }), badge('هشدار', { kind: 'warn', icon: 'alert-triangle' }), badge('خطر', { kind: 'danger' }), badge('اطلاع', { kind: 'info' }), badge('بنفش', { kind: 'violet' }), badge('QUANT · PYTHON', { ltr: true })),
        h('div.a-row', ...['published', 'draft', 'enabled', 'disabled', 'configured', 'missing', 'new', 'contacted', 'qualified', 'won', 'lost', 'spam', 'form', 'ai', 'pending'].map(s => statusBadge(s)))),
      demo('statCard', "statCard({label, value, icon, hint, href, delta})", h('div.a-stats', statCard({ label: 'سرنخ‌ها', value: toFaDigits(42), icon: 'users', hint: 'در ۳۰ روز گذشته', href: '#/leads', delta: '+۵ امروز' }), statCard({ label: 'گفت‌وگوها', value: toFaDigits(7), icon: 'message-square', delta: '−۲', deltaDown: true }), statCard({ label: 'در حال بارگذاری', icon: 'clock', loading: true }))),
      demo('progressRing + checklist', "progressRing({value:6, max:9, label}) · checklist({items:[{label, hint, done, href}]})",
        h('div.a-row', { style: null }, ring, h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => ring.setValue(9, 9) }, 'ring.setValue(9, 9)')),
        checklist({ items: [{ label: 'کلید OpenAI', hint: 'تنظیم شده', done: true, href: '#/ai' }, { label: 'اطلاعات تماس', hint: 'نشانی و تلفن', done: false, href: '#/site-info' }, { label: 'بدون لینک', done: false }] })),
      demo('emptyState / errorState / skeleton', "emptyState({icon, title, hint, action}) · errorState({error, retry}) · skeleton({kind:'lines'|'form'|'table'|'cards'|'page'})",
        h('div.a-grid-2', emptyState({ icon: 'inbox', title: STR.states.empty, hint: STR.states.emptyHint, action: { label: STR.actions.add, icon: 'plus', onClick: () => toast.info('action') } }), errorState({ retry: () => toast.info('retry') })),
        h('div.a-grid-2', skeleton({ kind: 'lines' }), skeleton({ kind: 'form' })), skeleton({ kind: 'cards' })),
      demo('toast', "toast(msg, {kind:'success'|'error'|'warn'|'info', timeout, action:{label,onClick}})", h('div.a-row', ...['success', 'error', 'warn', 'info'].map(k => h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => toast(`پیام ${k}`, { kind: k, action: { label: 'اقدام', onClick: () => toast.info('اقدام زده شد') } }) }, k)))),
      demo('copyToClipboard', "copyToClipboard('hello@sysaiq.com')", h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => copyToClipboard('hello@sysaiq.com') }, icon('copy', { size: 'sm' }), 'کپی ایمیل')),
    ] }));

    // ---- overlays ----
    root.appendChild(card({ title: 'پنجره‌ها — overlay', body: demo('modal / drawer / confirm', "modal({title, body, actions, size}).open() · drawer({title, body, wide}).open() · await confirm({title, message, danger})",
      h('div.a-row',
        h('button.a-btn', { type: 'button', onclick: () => modal({ title: 'نمونهٔ پنجره', body: h('p', 'بدنهٔ پنجره. Esc یا کلیک بیرون آن را می‌بندد.'), actions: [{ label: STR.actions.cancel, kind: 'ghost' }, { label: STR.actions.confirm, kind: 'primary', onClick: () => toast('تأیید شد') }] }).open() }, 'modal'),
        h('button.a-btn', { type: 'button', onclick: () => drawer({ title: 'نمونهٔ کشو', body: h('p', 'کشو از سمت چپ (inline-end) باز می‌شود.'), actions: [{ label: STR.actions.close, kind: 'ghost' }] }).open() }, 'drawer'),
        h('button.a-btn.a-btn--danger', { type: 'button', onclick: async () => toast(await confirm({ message: STR.confirm.deleteMessage('نمونه'), confirmLabel: STR.confirm.deleteConfirm, danger: true }) ? 'حذف تأیید شد' : 'انصراف') }, 'confirm (danger)'),
      )) }));

    // ---- table + filters ----
    const rows = [
      { id: 1, title_fa: 'پلتفرم مدیریت رستوران', slug: 'restaurant', tags: 'OPERATIONS · REAL-TIME', sort: 1, published: 1, updated_at: '2026-09-20 08:10:00' },
      { id: 2, title_fa: 'CRM آژانس املاک', slug: 'realestate', tags: 'CRM · AI MATCHING', sort: 2, published: 0, updated_at: '2026-09-21 14:00:00' },
      { id: 3, title_fa: 'ترمینال معاملاتی AI', slug: 'trading', tags: 'QUANT · BACKTESTING', sort: 3, published: 1, updated_at: '2026-09-22 09:30:00' },
    ];
    const table = dataTable({
      columns: [
        { key: 'title_fa', label: 'عنوان', primary: true },
        { key: 'slug', label: 'نامک', ltr: true, mono: true },
        { key: 'tags', label: 'برچسب‌ها', ltr: true },
        { key: 'sort', label: 'ترتیب', num: true },
        { key: 'published', label: 'وضعیت', render: r => statusBadge(r.published ? 'published' : 'draft') },
        { key: 'updated_at', label: 'به‌روزرسانی', render: r => formatJalali(r.updated_at, { style: 'relative' }) },
      ],
      rows, sortable: true, sort: { key: 'sort', dir: 'asc' },
      onRowClick: r => toast.info(`ردیف ${toFaDigits(r.id)}`),
      actions: r => [{ icon: 'pencil', label: STR.actions.edit, onClick: () => toast.info(`ویرایش ${r.slug}`) }, { icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => toast.warn(`حذف ${r.slug}`) }],
    });
    const fb = filterBar({ search: { placeholder: 'جستجو…' }, filters: [{ name: 'status', label: 'همهٔ وضعیت‌ها', options: [{ value: '1', label: 'منتشرشده' }, { value: '0', label: 'پیش‌نویس' }] }], onChange: v => { const list = rows.filter(r => U.matchesQuery(r, v.q, ['title_fa', 'slug']) && (!v.status || String(r.published) === v.status)); table.setRows(list); fb.setCount(list.length, rows.length); } });
    fb.setCount(rows.length);
    root.appendChild(card({ title: 'جدول و فیلتر — table', body: demo('dataTable + filterBar', "dataTable({columns:[{key,label,render,ltr,mono,num,primary}], rows, sortable, onRowClick, actions, empty, pageSize}) · filterBar({search, filters, onChange})", fb.el, table.el,
      h('div.a-row', h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => table.setLoading(true) }, 'setLoading(true)'), h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => table.setRows(rows) }, 'setRows(rows)'), h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => table.setRows([]) }, 'setRows([])'), h('button.a-btn.a-btn--sm', { type: 'button', onclick: () => table.setError(new Error('نمونهٔ خطا'), () => table.setRows(rows)) }, 'setError()'))) }));

    // ---- form ----
    const title = bilingualField({ name: 'title', label: 'عنوان (bilingualField flat)', flat: true, required: true, maxLength: 120 });
    const slug = slugField({ name: 'slug', label: 'نامک', prefix: '/fa/work/', required: true, unique: s => s !== 'taken' });
    slug.followField(title.en);
    const fields = [
      { title: 'فیلدهای پایه', columns: 2, fields: [
        field({ name: 'name', label: 'نام', required: true, placeholder: 'مثال: حامد', hint: 'field({type:"text"})' }),
        field({ name: 'email', label: 'ایمیل', type: 'email', dir: 'ltr', lang: 'en', placeholder: 'name@example.com' }),
        field({ name: 'mobile', label: 'موبایل', type: 'tel', dir: 'ltr', placeholder: '۰۹۱۲…', hint: 'type:"tel" → validators.mobile' }),
        field({ name: 'site', label: 'وب‌سایت', type: 'url', dir: 'ltr', lang: 'en' }),
        selectField({ name: 'status', label: 'وضعیت', options: [{ value: 'new', label: 'جدید' }, { value: 'won', label: 'بسته شد' }], placeholder: STR.actions.select }),
        switchField({ name: 'active', label: 'فعال باشد', hint: 'switchField → boolean' }),
        numberField({ name: 'sort', label: 'ترتیب', min: 0, max: 999, hint: 'numberField → عدد لاتین در خروجی' }),
        moneyField({ name: 'price', label: 'مبلغ', hint: 'moneyField → تومان صحیح' }),
        dateFieldJalali({ name: 'due', label: 'تاریخ پیگیری', hint: 'dateFieldJalali → YYYY-MM-DD میلادی' }),
        tagsField({ name: 'tags', label: 'برچسب‌ها', ltr: true, join: ' · ', hint: "tagsField({ltr, join:' · '})" }),
      ] },
      { title: 'فیلدهای ویژه', fields: [
        title, slug,
        secretField({ name: 'api_key', label: 'کلید API', configured: true, maskHint: '••••1a2b', hint: 'secretField — مقدار خالی یعنی حفظ کلید فعلی' }),
        imageField({ name: 'image', label: 'تصویر', hint: 'imageField — بارگذاری واقعی به /api/admin/upload' }),
        codeField({ name: 'json', label: 'JSON', json: true, rows: 4, hint: 'codeField({json:true})' }),
        markdownField({ name: 'body', label: 'متن بلند', rows: 6 }),
        bilingualField({ name: 'summary', label: 'خلاصه (bilingualField textarea)', type: 'textarea', rows: 3 }),
        textareaField({ name: 'note', label: 'یادداشت', maxLength: 200, rows: 3, hint: 'textareaField({maxLength}) با شمارنده' }),
      ] },
      { title: 'تکرارشونده', fields: [
        repeater({ name: 'features', label: 'قابلیت‌ها', addLabel: 'افزودن قابلیت', itemLabel: 'قابلیت', max: 6, empty: { title_fa: '', title_en: '', desc_fa: '', desc_en: '' },
          item: () => [bilingualField({ name: 'title', flat: true, label: 'عنوان', requiredFa: true }), bilingualField({ name: 'desc', flat: true, label: 'توضیح', type: 'textarea', rows: 2 })] }),
      ] },
    ];
    const out = codeField({ name: '_out', label: 'خروجی getValues()', rows: 10 });
    const form = createForm({
      fields, dirtyToken: '_ui-demo',
      values: { name: 'حامد', email: 'hello@sysaiq.com', mobile: '09125130505', status: 'new', active: true, sort: 3, price: 12500000, due: '2026-09-22', tags: 'QUANT · PYTHON', title_fa: 'نمونه', title_en: 'Sample', slug: 'sample', json: { a: 1 }, body: '## تیتر\n\nمتن **پررنگ**', features: [{ title_fa: 'اول', title_en: 'First', desc_fa: '', desc_en: '' }] },
      onChange: v => { out.value = JSON.stringify(v, null, 2); },
      onSubmit: async v => { out.value = JSON.stringify(v, null, 2); toast(STR.states.saved); },
      onDirty: d => bar.setDirty(d),
    });
    out.value = JSON.stringify(form.getValues(), null, 2);
    const bar = stickyActionBar({ actions: [h('button.a-btn.a-btn--ghost', { type: 'button', onclick: () => form.reset() }, STR.actions.reset), h('button.a-btn.a-btn--ghost', { type: 'button', onclick: () => form.setErrors({ name: 'خطای نمونه از سرور', nope: 'فیلد ناشناخته' }, { message: STR.errors.validation }) }, 'setErrors()'), submitButton(form)] });
    root.appendChild(card({ title: 'فرم — form', hint: 'createForm({fields, values, onSubmit, onChange, onDirty}) · ⌘/Ctrl+S ذخیره می‌کند · تغییر ناذخیره، شمارندهٔ نوار بالا و محافظ خروج را فعال می‌کند', body: [form.el, out.el], footer: null }));
    root.appendChild(bar);

    // ---- layout ----
    root.appendChild(card({ title: 'چیدمان — layout', body: [
      demo('tabs', "tabs({items:[{id, label, icon, badge, panel}], remember:'key', onChange})", tabs({ items: [{ id: 'a', label: 'اول', icon: 'home', panel: h('p', 'پنل اول') }, { id: 'b', label: 'دوم', icon: 'star', badge: 3, panel: () => h('p', 'پنل دوم (تنبل)') }] })),
      demo('card', "card({title, hint, body, footer, actions, glow, flush})", card({ title: 'کارت نمونه', hint: 'زیرعنوان', body: h('p', 'بدنه'), footer: [h('button.a-btn.a-btn--sm', { type: 'button' }, 'دکمه')], actions: [badge('نشان')] })),
      demo('pageHeader', "pageHeader({eyebrow, title, subtitle, actions, crumbs})", pageHeader({ eyebrow: '[ SYSAIQ—NAME / SYS.01 ]', title: 'عنوان صفحه', subtitle: 'زیرعنوان صفحه', actions: [h('button.a-btn.a-btn--primary', { type: 'button' }, icon('plus'), 'دکمهٔ اصلی')] })),
      demo('buttons', ".a-btn · .a-btn--primary · .a-btn--ghost · .a-btn--subtle · .a-btn--danger · .a-btn--sm · .a-btn--icon", h('div.a-row', h('button.a-btn.a-btn--primary', { type: 'button' }, icon('save'), 'اصلی'), h('button.a-btn', { type: 'button' }, 'پیش‌فرض'), h('button.a-btn.a-btn--ghost', { type: 'button' }, 'شبح'), h('button.a-btn.a-btn--subtle', { type: 'button' }, 'کم‌رنگ'), h('button.a-btn.a-btn--danger', { type: 'button' }, icon('trash'), 'خطر'), h('button.a-btn.a-btn--sm', { type: 'button' }, 'کوچک'), h('button.a-btn.a-btn--icon', { type: 'button', 'aria-label': 'آیکن' }, icon('settings')), h('button.a-btn', { type: 'button', disabled: true }, 'غیرفعال'))),
      demo('icons', 'icon("name", {size:"sm"|"lg", label})', h('div.a-row', ...['home', 'type', 'layout', 'file-text', 'briefcase', 'folder', 'help-circle', 'image', 'newspaper', 'users', 'message-square', 'send', 'receipt', 'credit-card', 'landmark', 'id-card', 'shield-check', 'search', 'sparkles', 'book-open', 'lock', 'database', 'history', 'menu', 'x', 'external-link', 'log-out', 'save', 'trash', 'plus', 'chevron-down', 'chevron-left', 'check', 'check-circle', 'alert-circle', 'alert-triangle', 'info', 'eye', 'eye-off', 'copy', 'upload', 'arrow-up', 'arrow-down', 'grip-vertical', 'pencil', 'refresh-cw', 'user', 'clock', 'filter', 'key', 'bot', 'settings', 'star', 'link', 'list', 'calendar', 'zap', 'palette', 'globe', 'phone', 'mail'].map(n => h('span', { title: n }, icon(n))))),
      demo('extLink', "extLink(href, text)", extLink('https://sysaiq.com/fa/', 'sysaiq.com/fa')),
      demo('shortcuts', "registerShortcut('mod+s', fn) · registerShortcut('mod+k', fn) · debounce(fn, 250)", h('p.a-hint', `⌘/Ctrl+S فرم فعال را ذخیره می‌کند؛ ${U.modKeyLabel}+K پالت پرش را باز می‌کند؛ Esc پنجره‌ها را می‌بندد.`)),
    ] }));

    const off = registerShortcut('mod+shift+u', () => toast.info('میان‌بر آزمایشی'), { inFields: true });
    return () => { off(); form.destroy(); };
  },
};
