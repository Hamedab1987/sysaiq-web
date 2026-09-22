// Assistant conversations: GET /conversations (last 500 messages) grouped
// into sessions; a drawer shows one session as a chat transcript.
import { h, pageHeader, dataTable, filterBar, matchesQuery, badge, drawer, formatJalali, truncate, toFaDigits, emptyState } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const T = {
  title: 'گفت‌وگوهای دستیار', subtitle: 'آخرین گفت‌وگوهای بازدیدکنندگان با دستیار هوشمند سایت (جدیدترین اول).',
  search: 'جستجو در متن پیام‌ها…', allLangs: 'همهٔ زبان‌ها',
  colStart: 'شروع', colFirst: 'اولین پیام', colCount: 'پیام‌ها', colLang: 'زبان',
  visitor: 'بازدیدکننده', assistant: 'دستیار', transcript: 'متن گفت‌وگو',
  empty: 'هنوز گفت‌وگویی ثبت نشده است', emptyHint: 'وقتی بازدیدکننده‌ای با دستیار صحبت کند، اینجا نمایش داده می‌شود.',
};

function groupSessions(msgs) {
  const map = new Map();
  for (const m of msgs) {
    if (!map.has(m.session_id)) map.set(m.session_id, { session_id: m.session_id, messages: [], language: m.language || '' });
    const s = map.get(m.session_id);
    s.messages.push(m);
    if (!s.language && m.language) s.language = m.language;
  }
  const out = [];
  for (const s of map.values()) {
    s.messages.sort((a, b) => a.id - b.id);
    s.started_at = s.messages[0].created_at;
    s.last_at = s.messages[s.messages.length - 1].created_at;
    s.first = s.messages.find(m => m.role === 'user')?.content || s.messages[0].content;
    s.count = s.messages.length;
    s.text = s.messages.map(m => m.content).join('\n');
    out.push(s);
  }
  return out.sort((a, b) => String(b.last_at).localeCompare(String(a.last_at)));
}

export default {
  title: T.title,
  async mount(root, ctx) {
    root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / ASSISTANT LOG ]', title: T.title, subtitle: T.subtitle }));
    let sessions = [];
    let openDrawer = null;
    const table = dataTable({
      columns: [
        { key: 'started_at', label: T.colStart, render: s => h('span', { title: formatJalali(s.started_at, { style: 'datetime' }) }, formatJalali(s.started_at, { style: 'datetime' })) },
        { key: 'first', label: T.colFirst, render: s => h('span', { dir: 'auto' }, truncate(s.first, 90)) },
        { key: 'count', label: T.colCount, num: true },
        { key: 'language', label: T.colLang, render: s => badge(s.language === 'fa' ? 'فارسی' : s.language ? s.language.toUpperCase() : '—', { ltr: s.language && s.language !== 'fa' }) },
      ],
      onRowClick: s => show(s),
      actions: s => [{ icon: 'eye', label: STR.actions.view, onClick: () => show(s) }],
      empty: { icon: 'message-square', title: T.empty, hint: T.emptyHint },
      pageSize: 40,
    });
    const filters = filterBar({ search: { placeholder: T.search }, filters: [{ name: 'language', label: T.allLangs, options: [{ value: 'fa', label: 'فارسی' }, { value: 'en', label: 'English' }] }], onChange: apply });
    function apply(v = filters.values) {
      const rows = sessions.filter(s => matchesQuery(s, v.q, ['text']) && (!v.language || s.language === v.language));
      table.setRows(rows); filters.setCount(rows.length, sessions.length);
    }
    const load = async () => { try { const msgs = await api.get('/conversations'); sessions = groupSessions(Array.isArray(msgs) ? msgs : []); if (root.isConnected) apply(); } catch (e) { table.setError(e, load); } };
    function show(s) {
      const body = h('div.a-chat', s.messages.map(m => h('div', { class: ['a-chat__msg', m.role === 'user' ? 'a-chat__msg--user' : 'a-chat__msg--assistant'], dir: 'auto' },
        h('div.a-chat__meta', h('span', m.role === 'user' ? T.visitor : T.assistant), h('span', formatJalali(m.created_at, { style: 'time' }))),
        h('div', m.content))));
      const d = drawer({ title: `${T.transcript} — ${formatJalali(s.started_at, { style: 'datetime' })}`, body: body.children.length ? body : emptyState({ title: T.empty }), actions: [{ label: STR.actions.close, kind: 'ghost' }], onClose: () => { openDrawer = null; } });
      openDrawer = d; d.open();
    }
    root.append(filters.el, table.el);
    table.setLoading(true);
    await load();
    if (ctx.params?.sid) { const s = sessions.find(x => x.session_id === ctx.params.sid); if (s) show(s); }
    return () => openDrawer?.close('force');
  },
};
