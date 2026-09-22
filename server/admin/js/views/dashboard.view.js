// Dashboard: stat cards from the existing APIs + the setup checklist from
// GET /setup-status with a gradient progress ring. Every call is optional:
// a missing or failing API leaves its card at «—» instead of breaking the page.
import { h, icon, pageHeader, card, statCard, checklist, progressRing, skeleton, toast, toFaDigits, formatJalali, localDayKey, badge } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const D = STR.dashboard;
const settle = p => p.then(v => ({ ok: true, v }), e => ({ ok: false, e }));

function uptime(s) {
  const n = Number(s) || 0;
  const d = Math.floor(n / 86400), hh = Math.floor((n % 86400) / 3600), mm = Math.floor((n % 3600) / 60);
  return toFaDigits(d ? `${d} روز و ${hh} ساعت` : hh ? `${hh} ساعت و ${mm} دقیقه` : `${mm} دقیقه`);
}

export default {
  title: D.title,
  async mount(root, ctx) {
    const session = ctx.store.get('session');
    root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / SYS.00 ]', title: STR.auth.welcome(session?.username), subtitle: D.subtitle }));

    const stats = h('div.a-stats',
      statCard({ label: D.leads, icon: 'users', loading: true, href: '#/leads' }),
      statCard({ label: D.conversationsToday, icon: 'message-square', loading: true, href: '#/conversations' }),
      statCard({ label: D.projects, icon: 'folder', loading: true, href: '#/projects' }),
      statCard({ label: D.faqs, icon: 'help-circle', loading: true, href: '#/faqs' }),
    );
    const setupBody = h('div', skeleton({ lines: 5 }));
    const systemBody = h('div', skeleton({ lines: 3 }));
    const setupCard = card({ title: D.setupTitle, hint: D.setupHint, body: setupBody, glow: true });
    const systemCard = card({ title: D.system, body: systemBody, actions: [h('button.a-btn.a-btn--sm', { type: 'button', onclick: purge }, icon('refresh-cw', { size: 'sm' }), D.purgeCache)] });
    root.append(stats, h('div.a-grid-2', setupCard, systemCard));

    async function purge(e) {
      const btn = e.currentTarget; btn.disabled = true;
      try { await api.post('/system/cache/purge'); toast(D.cachePurged); } catch (err) { toast.error(err.message); } finally { btn.disabled = false; }
    }

    const [leads, convs, projects, faqs, setup, system] = await Promise.all([
      settle(api.get('/leads')), settle(api.get('/conversations')), settle(api.get('/projects')), settle(api.get('/faqs')),
      settle(api.get('/setup-status')), settle(api.get('/system')),
    ]);
    if (!root.isConnected) return;

    const [cLeads, cConv, cProj, cFaq] = stats.children;
    if (leads.ok && Array.isArray(leads.v)) {
      const fresh = leads.v.filter(l => (l.status || 'new') === 'new' && !l.archived_at).length;
      statCard.set(cLeads, toFaDigits(leads.v.length));
      if (fresh) cLeads.appendChild(h('div.a-stat__delta', `${toFaDigits(fresh)} ${D.newLeads}`));
      ctx.store.update('counters', c => ({ ...c, leads: leads.v.length, newLeads: fresh }));
    } else statCard.set(cLeads, STR.states.none);
    if (convs.ok && Array.isArray(convs.v)) {
      const today = localDayKey(new Date());
      const sessions = new Set(convs.v.filter(m => localDayKey(m.created_at) === today).map(m => m.session_id));
      statCard.set(cConv, toFaDigits(sessions.size));
      const total = new Set(convs.v.map(m => m.session_id)).size;
      cConv.appendChild(h('div.a-stat__hint', `${toFaDigits(total)} گفت‌وگو در ${toFaDigits(convs.v.length)} پیام اخیر`));
    } else statCard.set(cConv, STR.states.none);
    if (projects.ok && Array.isArray(projects.v)) {
      statCard.set(cProj, toFaDigits(projects.v.length));
      const pub = projects.v.filter(p => p.published).length;
      cProj.appendChild(h('div.a-stat__hint', `${toFaDigits(pub)} ${STR.states.published}`));
    } else statCard.set(cProj, STR.states.none);
    if (faqs.ok && Array.isArray(faqs.v)) statCard.set(cFaq, toFaDigits(faqs.v.length)); else statCard.set(cFaq, STR.states.none);

    // ---- setup checklist --------------------------------------------------
    setupBody.replaceChildren();
    if (setup.ok && setup.v && typeof setup.v === 'object') {
      const items = [];
      for (const [key, meta] of Object.entries(D.setup)) {
        if (!(key in setup.v)) continue;
        const raw = !!setup.v[key];
        items.push({ label: meta.label, hint: meta.hint, done: meta.invert ? !raw : raw, href: meta.href });
      }
      const done = items.filter(i => i.done).length;
      const ring = progressRing({ value: done, max: items.length || 1, size: 104, label: STR.states.of(done, items.length) });
      setupBody.append(
        h('div.a-row', { style: null }, ring, h('div.a-grow', h('div', { class: 'a-small a-muted' }, done === items.length ? D.setupDone : D.setupHint), h('div.a-row.a-mt-1', badge(`${toFaDigits(done)} انجام‌شده`, { kind: 'ok', icon: 'check' }), badge(`${toFaDigits(items.length - done)} باقی‌مانده`, { kind: items.length - done ? 'warn' : null, icon: 'clock' })))),
        checklist({ items: items.sort((a, b) => Number(a.done) - Number(b.done)) }),
      );
    } else {
      setupBody.appendChild(ctx.ui.errorState({ error: setup.e, retry: () => ctx.router.reload() }));
    }

    // ---- system -------------------------------------------------------------
    systemBody.replaceChildren();
    if (system.ok && system.v) {
      const s = system.v;
      systemBody.appendChild(h('dl.a-dl',
        h('dt', D.node), h('dd', h('code', { dir: 'ltr' }, String(s.node || '—'))),
        h('dt', D.schema), h('dd', toFaDigits(String(s.schema_version ?? '—'))),
        h('dt', D.uptime), h('dd', uptime(s.uptime_s)),
        h('dt', D.env), h('dd', h('code', { dir: 'ltr' }, String(s.env || '—'))),
        h('dt', STR.account.lastLogin), h('dd', session?.last_login_at ? formatJalali(session.last_login_at, { style: 'datetime' }) : STR.account.never),
      ));
      if (session?.default_password_suspected) systemBody.appendChild(h('div.a-form__banner', icon('alert-triangle'), h('div', STR.account.defaultWarn, ' ', h('a.a-link', { href: '#/account' }, STR.account.changePassword))));
    } else systemBody.appendChild(ctx.ui.errorState({ error: system.e }));
  },
};
