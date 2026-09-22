// Knowledge base (feeds the AI assistant): list + drawer editor.
//   GET /knowledge · POST /knowledge · PUT /knowledge/:id · DELETE /knowledge/:id
import { h, icon, pageHeader, dataTable, filterBar, matchesQuery, statusBadge, confirm, toast, createForm, submitButton, drawer, field, tagsField, bilingualField, switchField, truncate, formatJalali, badge } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const T = {
  title: 'پایگاه دانش', subtitle: 'هر مدخل یک واقعیت است که دستیار هوشمند می‌تواند در پاسخ به بازدیدکنندگان از آن استفاده کند. غیرفعال‌کردن، مدخل را بدون حذف کنار می‌گذارد.',
  add: 'مدخل جدید', edit: 'ویرایش مدخل', search: 'جستجو در عنوان، برچسب و متن…', all: 'همهٔ وضعیت‌ها',
  colTitle: 'عنوان', colTags: 'برچسب‌ها', colStatus: 'وضعیت', colUpdated: 'به‌روزرسانی',
  titleF: 'عنوان (داخلی)', tagsF: 'برچسب‌ها', bodyF: 'متن', enabledF: 'فعال',
  bodyHint: 'کوتاه و دقیق بنویسید؛ دستیار فقط از همین متن‌ها پاسخ می‌سازد. هیچ قیمت یا عدد تأییدنشده‌ای ننویسید.',
  saved: 'مدخل ذخیره شد',
};

export default {
  title: T.title,
  async mount(root, ctx) {
    root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / KNOWLEDGE ]', title: T.title, subtitle: T.subtitle, actions: [h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => edit(null) }, icon('plus'), T.add)] }));
    let all = [];
    let openDrawer = null;
    const table = dataTable({
      columns: [
        { key: 'title', label: T.colTitle, render: r => h('div', h('div.a-table__primary', { dir: 'auto' }, r.title || '—'), h('div.a-table__secondary', truncate(r.body_fa || r.body_en || '', 90))) },
        { key: 'tags', label: T.colTags, render: r => h('div.a-row', { style: null }, String(r.tags || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 4).map(t => badge(t, { ltr: /^[\x00-\x7f]+$/.test(t) }))) },
        { key: 'enabled', label: T.colStatus, render: r => statusBadge(r.enabled ? 'enabled' : 'disabled') },
        { key: 'updated_at', label: T.colUpdated, render: r => formatJalali(r.updated_at, { style: 'relative' }) },
      ],
      onRowClick: r => edit(r),
      actions: r => [
        { icon: 'pencil', label: STR.actions.edit, onClick: () => edit(r) },
        { icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => remove(r) },
      ],
      empty: { icon: 'book-open', title: STR.states.empty, hint: STR.states.emptyHint, action: { label: T.add, icon: 'plus', onClick: () => edit(null) } },
      pageSize: 50,
    });
    const filters = filterBar({ search: { placeholder: T.search }, filters: [{ name: 'status', label: T.all, options: [{ value: 'on', label: STR.states.enabled }, { value: 'off', label: STR.states.disabled }] }], onChange: apply });
    function apply(v = filters.values) {
      const rows = all.filter(r => matchesQuery(r, v.q, ['title', 'tags', 'body_fa', 'body_en']) && (!v.status || (v.status === 'on') === !!r.enabled));
      table.setRows(rows); filters.setCount(rows.length, all.length);
    }
    const load = async () => { try { all = await api.get('/knowledge'); if (!Array.isArray(all)) all = []; if (root.isConnected) apply(); } catch (e) { table.setError(e, load); } };
    async function remove(r) {
      if (!(await confirm({ message: STR.confirm.deleteMessage(truncate(r.title, 60)), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
      try { await api.del(`/knowledge/${r.id}`); toast(STR.states.deleted); all = all.filter(x => x.id !== r.id); apply(); } catch (e) { toast.error(e.message); }
    }
    function edit(row) {
      const isNew = !row;
      const title = field({ name: 'title', label: T.titleF, required: true, maxLength: 300 });
      const tags = tagsField({ name: 'tags', label: T.tagsF, join: ',', maxLength: 40, suggestions: [...new Set(all.flatMap(k => String(k.tags || '').split(',').map(s => s.trim()).filter(Boolean)))] });
      const body = bilingualField({ name: 'body', label: T.bodyF, flat: true, type: 'textarea', rows: 8, requiredFa: true, maxLength: 50000, hint: T.bodyHint });
      const enabled = switchField({ name: 'enabled', label: T.enabledF, onText: STR.states.enabled, offText: STR.states.disabled });
      const form = createForm({
        fields: [title, tags, body, enabled], dirtyToken: `kb-${row?.id || 'new'}`,
        values: row ? { ...row } : { title: '', tags: '', body_fa: '', body_en: '', enabled: 1 },
        async onSubmit(values) {
          const payload = { ...values, enabled: values.enabled ? 1 : 0 };
          if (isNew) await api.post('/knowledge', payload); else await api.put(`/knowledge/${row.id}`, payload);
          toast(T.saved); await load(); d.close('saved'); return true;
        },
      });
      const d = drawer({
        title: isNew ? T.add : T.edit, body: form.el, wide: true,
        actions: [{ label: STR.actions.cancel, kind: 'ghost', value: 'cancel' }],
        beforeClose: r => {
          if (r === 'saved' || r === 'force' || r === 'discard' || !form.isDirty()) return true;
          confirm({ title: STR.confirm.leaveTitle, message: STR.confirm.leaveMessage, confirmLabel: STR.actions.discard, danger: true }).then(ok => { if (ok) { form.markClean(); d.close('discard'); } });
          return false;
        },
        onClose: () => { form.destroy(); openDrawer = null; },
      });
      d.box.querySelector('.a-modal__foot').appendChild(submitButton(form));
      openDrawer = d;
      d.open();
    }
    root.append(filters.el, table.el);
    table.setLoading(true);
    await load();
    if (ctx.params?.id === 'new') edit(null);
    else if (ctx.params?.id) { const r = all.find(x => String(x.id) === ctx.params.id); if (r) edit(r); }
    return () => openDrawer?.close('force');
  },
};
