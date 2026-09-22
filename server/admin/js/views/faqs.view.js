// FAQ: list + drawer editor. Legacy API unchanged:
//   GET /faqs · POST /faqs · PUT /faqs/:id · DELETE /faqs/:id
import { h, icon, pageHeader, dataTable, filterBar, matchesQuery, statusBadge, confirm, toast, createForm, submitButton, drawer, bilingualField, numberField, switchField, truncate } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const T = {
  title: 'سؤالات متداول', subtitle: 'پرسش‌هایی که در بخش FAQ سایت نمایش داده می‌شوند.',
  add: 'سؤال جدید', edit: 'ویرایش سؤال', search: 'جستجو در سؤال و پاسخ…', all: 'همهٔ وضعیت‌ها',
  colQ: 'سؤال', colSort: 'ترتیب', colStatus: 'وضعیت',
  qF: 'سؤال', aF: 'پاسخ', sortF: 'ترتیب نمایش', publishedF: 'منتشرشده',
  saved: 'سؤال ذخیره شد',
};

export default {
  title: T.title,
  async mount(root, ctx) {
    root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / FAQ ]', title: T.title, subtitle: T.subtitle, actions: [h('button.a-btn.a-btn--primary', { type: 'button', onclick: () => edit(null) }, icon('plus'), T.add)] }));
    let all = [];
    let openDrawer = null;
    const table = dataTable({
      columns: [
        { key: 'q_fa', label: T.colQ, render: r => h('div', h('div.a-table__primary', r.q_fa || '—'), h('div.a-table__secondary', { dir: 'ltr', lang: 'en' }, truncate(r.q_en || '', 80))) },
        { key: 'sort', label: T.colSort, num: true },
        { key: 'published', label: T.colStatus, render: r => statusBadge(r.published ? 'published' : 'draft') },
      ],
      sortable: true, sort: { key: 'sort', dir: 'asc' },
      onRowClick: r => edit(r),
      actions: r => [
        { icon: 'pencil', label: STR.actions.edit, onClick: () => edit(r) },
        { icon: 'trash', label: STR.actions.delete, danger: true, onClick: () => remove(r) },
      ],
      empty: { icon: 'help-circle', title: STR.states.empty, hint: STR.states.emptyHint, action: { label: T.add, icon: 'plus', onClick: () => edit(null) } },
    });
    const filters = filterBar({ search: { placeholder: T.search }, filters: [{ name: 'status', label: T.all, options: [{ value: 'published', label: STR.states.published }, { value: 'draft', label: STR.states.draft }] }], onChange: apply });
    function apply(v = filters.values) {
      const rows = all.filter(r => matchesQuery(r, v.q, ['q_fa', 'q_en', 'a_fa', 'a_en']) && (!v.status || (v.status === 'published') === !!r.published));
      table.setRows(rows); filters.setCount(rows.length, all.length);
    }
    const load = async () => { try { all = await api.get('/faqs'); if (!Array.isArray(all)) all = []; if (root.isConnected) apply(); } catch (e) { table.setError(e, load); } };
    async function remove(r) {
      if (!(await confirm({ message: STR.confirm.deleteMessage(truncate(r.q_fa || r.q_en, 60)), confirmLabel: STR.confirm.deleteConfirm, danger: true }))) return;
      try { await api.del(`/faqs/${r.id}`); toast(STR.states.deleted); all = all.filter(x => x.id !== r.id); apply(); } catch (e) { toast.error(e.message); }
    }
    function edit(row) {
      const isNew = !row;
      const q = bilingualField({ name: 'q', label: T.qF, flat: true, required: true, maxLength: 1000 });
      const a = bilingualField({ name: 'a', label: T.aF, flat: true, type: 'textarea', rows: 5, required: true, maxLength: 10000 });
      const sort = numberField({ name: 'sort', label: T.sortF, nullable: false });
      const published = switchField({ name: 'published', label: T.publishedF, onText: STR.states.published, offText: STR.states.draft });
      const form = createForm({
        fields: [q, a, h('div.a-form__grid.a-form__grid--2', sort.el, published.el)], dirtyToken: `faq-${row?.id || 'new'}`,
        values: row ? { ...row } : { q_fa: '', q_en: '', a_fa: '', a_en: '', sort: (all.length + 1), published: 1 },
        async onSubmit(values) {
          const body = { ...values, published: values.published ? 1 : 0, sort: Number(values.sort) || 0 };
          if (isNew) await api.post('/faqs', body); else await api.put(`/faqs/${row.id}`, body);
          toast(T.saved); await load(); d.close('saved'); return true;
        },
      });
      const d = drawer({
        title: isNew ? T.add : T.edit, body: form.el,
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
    if (ctx.params?.id && ctx.params.id !== 'new') { const r = all.find(x => String(x.id) === ctx.params.id); if (r) edit(r); }
    else if (ctx.params?.id === 'new') edit(null);
    return () => openDrawer?.close('force');
  },
};
