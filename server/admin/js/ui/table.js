// dataTable + filterBar. Cells carry data-label so admin.css can collapse
// the table into cards ≤ 720px. Values are text nodes unless a column
// `render(row)` returns a Node.
//   const t = dataTable({
//     columns: [{ key: 'title_fa', label: 'عنوان', primary: true }, { key: 'slug', label: 'نامک', ltr: true, mono: true },
//               { key: 'published', label: 'وضعیت', render: r => statusBadge(r.published ? 'published' : 'draft') }],
//     rows, rowKey: 'id', onRowClick: row => …, sortable: true, sort: { key: 'sort', dir: 'asc' },
//     actions: row => [{ icon: 'pencil', label: 'ویرایش', onClick }, { icon: 'trash', label: 'حذف', danger: true, onClick }],
//     empty: { title, hint, action }, pageSize: 50,
//   });
//   t.setRows(rows) · t.setLoading(true) · t.setError(err, retry) · t.el
import { h, icon, clear } from './dom.js';
import { STR } from '../strings.js';
import { toFaDigits } from './format.js';
import { emptyState, errorState, skeleton } from './feedback.js';

export function dataTable(opts = {}) {
  const { columns = [], rowKey = 'id', onRowClick, actions, empty = {}, dense, sortable = false, pageSize = 0, caption } = opts;
  let rows = opts.rows || [];
  let sort = opts.sort ? { ...opts.sort } : null;
  let page = 0;
  let state = 'ready';
  const table = h('table', { class: ['a-table', dense && 'a-table--dense'] });
  const thead = h('thead');
  const tbody = h('tbody');
  const wrap = h('div.a-table-wrap', table);
  const foot = h('div.a-table__foot');
  const el = h('div.a-stack.a-stack--sm', wrap);
  if (caption) table.appendChild(h('caption.a-sr', caption));
  table.append(thead, tbody);

  const sortRows = list => {
    if (!sort) return list;
    const col = columns.find(c => c.key === sort.key);
    const get = col?.sortValue || (r => r[sort.key]);
    const dir = sort.dir === 'desc' ? -1 : 1;
    return [...list].sort((a, b) => { const x = get(a), y = get(b); if (x === y) return 0; if (x === null || x === undefined) return 1; if (y === null || y === undefined) return -1; return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'fa')) * dir; });
  };
  const renderHead = () => {
    clear(thead);
    const tr = h('tr');
    for (const c of columns) {
      const canSort = sortable && c.sortable !== false;
      const th = h('th', { scope: 'col', class: [c.ltr && 'a-ltr', c.align === 'end' && 'a-end'], 'aria-sort': canSort ? (sort?.key === c.key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : 'none') : null, style: null });
      if (c.width) th.setAttribute('width', c.width);
      if (canSort) th.appendChild(h('button', { type: 'button', onclick: () => { sort = sort?.key === c.key ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: 'asc' }; render(); } }, c.label, sort?.key === c.key ? icon(sort.dir === 'desc' ? 'chevron-down' : 'chevron-up', { size: 'sm' }) : null));
      else th.textContent = c.label;
      tr.appendChild(th);
    }
    if (actions) tr.appendChild(h('th', { scope: 'col' }, h('span.a-sr', 'عملیات')));
    thead.appendChild(tr);
  };
  const cell = (c, r) => {
    const td = h('td', { class: [c.ltr && 'a-ltr', c.num && 'a-num', c.cls], dataset: { label: c.label || '' } });
    const v = c.render ? c.render(r) : r[c.key];
    if (v instanceof Node) td.appendChild(v);
    else if (v !== null && v !== undefined && v !== '') {
      const text = c.fa === false || c.ltr ? String(v) : toFaDigits(String(v));
      if (c.primary) td.appendChild(h('span.a-table__primary', text));
      else if (c.ltr) td.appendChild(h('span', { dir: 'ltr', class: c.mono && 'a-mono' }, text));
      else td.textContent = text;
    } else td.textContent = STR.states.none;
    return td;
  };
  const render = () => {
    renderHead();
    clear(tbody);
    foot.remove();
    if (state !== 'ready') return;
    const sorted = sortRows(rows);
    const start = pageSize ? page * pageSize : 0;
    const slice = pageSize ? sorted.slice(start, start + pageSize) : sorted;
    for (const r of slice) {
      const tr = h('tr', { class: onRowClick && 'is-clickable', dataset: { key: r[rowKey] }, tabindex: onRowClick ? '0' : null });
      for (const c of columns) tr.appendChild(cell(c, r));
      if (actions) {
        const list = actions(r) || [];
        tr.appendChild(h('td.a-table__actions', { dataset: { label: '' } }, list.map(a => h('button', { type: 'button', class: ['a-btn', 'a-btn--sm', a.icon && !a.label ? 'a-btn--icon' : null, a.danger ? 'a-btn--danger' : 'a-btn--subtle'], 'aria-label': a.label, title: a.label, onclick: e => { e.stopPropagation(); a.onClick(r, e); } }, a.icon ? icon(a.icon, { size: 'sm' }) : null, a.showLabel ? a.label : null))));
      }
      if (onRowClick) {
        tr.addEventListener('click', e => { if (e.target.closest('button, a, input, select, textarea')) return; onRowClick(r, e); });
        tr.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === tr) { e.preventDefault(); onRowClick(r, e); } });
      }
      tbody.appendChild(tr);
    }
    if (!rows.length) { wrap.hidden = true; el.appendChild(emptyState({ icon: empty.icon, title: empty.title || STR.states.empty, hint: empty.hint, action: empty.action })); }
    else { wrap.hidden = false; for (const x of el.querySelectorAll('.a-empty')) x.remove(); }
    if (pageSize && rows.length > pageSize) {
      const pages = Math.ceil(rows.length / pageSize);
      clear(foot);
      foot.append(
        h('button.a-btn.a-btn--sm', { type: 'button', disabled: page === 0, onclick: () => { page--; render(); } }, icon('chevron-right', { size: 'sm' }), 'قبلی'),
        h('span', STR.states.of(page + 1, pages)),
        h('button.a-btn.a-btn--sm', { type: 'button', disabled: page >= pages - 1, onclick: () => { page++; render(); } }, 'بعدی', icon('chevron-left', { size: 'sm' })),
        h('span.a-grow'), h('span', STR.states.items(rows.length)));
      wrap.appendChild(foot);
    }
  };
  const api = {
    el, table,
    setRows(list) { rows = Array.isArray(list) ? list : []; state = 'ready'; page = Math.min(page, pageSize ? Math.max(0, Math.ceil(rows.length / pageSize) - 1) : 0); for (const x of el.querySelectorAll('.a-empty, .a-skel')) x.remove(); render(); },
    get rows() { return rows; },
    setLoading(on = true) { if (!on) return api.setRows(rows); state = 'loading'; clear(tbody); wrap.hidden = true; for (const x of el.querySelectorAll('.a-empty, .a-skel')) x.remove(); el.appendChild(skeleton({ kind: 'table', rows: 5 })); },
    setError(error, retry) { state = 'error'; clear(tbody); wrap.hidden = true; for (const x of el.querySelectorAll('.a-empty, .a-skel')) x.remove(); el.appendChild(errorState({ error, retry })); },
    setSort(s) { sort = s; render(); },
    rowEl(key) { return tbody.querySelector(`tr[data-key="${CSS.escape(String(key))}"]`); },
  };
  render();
  return api;
}

// filterBar({ search: { placeholder, value }, filters: [{ name, label, options: [{value,label}], value }],
//             actions: [Node], onChange(values), count })
// → { el, values, setCount(n), reset() }
export function filterBar(opts = {}) {
  const { search, filters = [], actions = [], onChange, debounceMs = 200 } = opts;
  const values = {};
  const el = h('div.a-filters', { role: 'search' });
  let timer = null;
  const fire = () => { clearTimeout(timer); timer = setTimeout(() => onChange?.({ ...values }), debounceMs); };
  let searchInput = null;
  if (search) {
    values.q = search.value || '';
    searchInput = h('input.a-input', { type: 'search', placeholder: search.placeholder || STR.actions.search, value: values.q, 'aria-label': search.placeholder || STR.actions.search, oninput: e => { values.q = e.target.value; fire(); } });
    el.appendChild(h('div.a-filters__search', icon('search'), searchInput));
  }
  const selects = [];
  for (const f of filters) {
    values[f.name] = f.value ?? '';
    const sel = h('select.a-select', { 'aria-label': f.label, onchange: e => { values[f.name] = e.target.value; fire(); } },
      h('option', { value: '' }, f.label), (f.options || []).map(o => h('option', { value: String(o.value), selected: String(o.value) === String(values[f.name]) }, o.label)));
    selects.push([f, sel]);
    el.appendChild(sel);
  }
  const count = h('span.a-filters__count');
  el.append(h('span.a-filters__spacer'), count, ...actions);
  return {
    el, values,
    setCount(n, total) { count.textContent = n === undefined ? '' : (total !== undefined && total !== n ? `${STR.states.of(n, total)}` : STR.states.items(n)); },
    reset() { if (searchInput) { searchInput.value = ''; values.q = ''; } for (const [f, sel] of selects) { sel.value = ''; values[f.name] = ''; } onChange?.({ ...values }); },
    focus() { searchInput?.focus(); },
  };
}

// simple in-memory text filter helper: matches any of the given keys (fa/en digits normalised)
export function matchesQuery(row, q, keys) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  const norm = s => String(s ?? '').toLowerCase().replace(/[۰-۹]/g, c => '۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/ي/g, 'ی').replace(/ك/g, 'ک');
  const n = norm(needle);
  return keys.some(k => norm(typeof k === 'function' ? k(row) : row[k]).includes(n));
}
