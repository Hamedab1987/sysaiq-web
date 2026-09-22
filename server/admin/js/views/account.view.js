// Account & security: change password (POST /account/password) and
// "log out everywhere" when the server supports it (404 → explained).
import { h, icon, pageHeader, card, field, createForm, submitButton, toast, confirm, formatJalali, validators, badge } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const A = STR.account;

export default {
  title: A.title,
  async mount(root, ctx) {
    root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / ACCOUNT ]', title: A.title, subtitle: A.subtitle }));
    let acct = ctx.store.get('session') || {};
    try { acct = await api.get('/account'); ctx.store.set('session', acct); } catch { /* /me fallback already in the store */ }
    if (!root.isConnected) return;

    const info = h('dl.a-dl',
      h('dt', A.username), h('dd', h('span', { dir: 'ltr' }, acct.username || '—')),
      h('dt', A.lastLogin), h('dd', acct.last_login_at ? formatJalali(acct.last_login_at, { style: 'datetime' }) : A.never),
      h('dt', A.pwdChanged), h('dd', acct.pwd_changed_at ? formatJalali(acct.pwd_changed_at, { style: 'datetime' }) : badge(A.never, { kind: 'warn', icon: 'alert-triangle' })),
    );
    const warn = acct.default_password_suspected ? h('div.a-form__banner', icon('alert-triangle'), h('div', A.defaultWarn)) : null;

    const current = field({ name: 'current', label: A.current, type: 'password', required: true, autocomplete: 'current-password', dir: 'ltr', lang: 'en' });
    const next = field({ name: 'next', label: A.next, type: 'password', required: true, autocomplete: 'new-password', dir: 'ltr', lang: 'en', hint: A.rule, minLength: 10, rules: [validators.pattern(/\p{L}/u, A.rule), validators.pattern(/\p{Nd}/u, A.rule), validators.max(72)] });
    const again = field({ name: 'again', label: A.confirm, type: 'password', required: true, autocomplete: 'new-password', dir: 'ltr', lang: 'en', rules: [validators.same('next')] });
    const form = createForm({
      fields: [{ fields: [current, next, again] }], dirtyToken: 'account-password',
      async onSubmit(values) {
        if (values.current === values.next) { form.setErrors({ next: A.sameAsCurrent }); return false; }
        await api.post('/account/password', { current: values.current, next: values.next });
        toast(A.changed);
        form.setValues({ current: '', next: '', again: '' });
        try { const a = await api.get('/account'); ctx.store.set('session', a); pwd.textContent = formatJalali(a.pwd_changed_at, { style: 'datetime' }); warn?.remove(); } catch { /* fine */ }
        return true;
      },
    });
    const pwd = info.children[5];
    const pwCard = card({ title: A.changePassword, body: [warn, form.el], footer: [submitButton(form, { label: A.changePassword, icon: 'key' })] });

    const logoutAllBtn = h('button.a-btn.a-btn--danger', { type: 'button' }, icon('log-out'), A.logoutAll);
    logoutAllBtn.addEventListener('click', async () => {
      if (!(await confirm({ title: A.logoutAll, message: A.logoutAllHint, confirmLabel: A.logoutAll, danger: true }))) return;
      logoutAllBtn.disabled = true;
      try {
        await api.post('/account/logout-all');
        toast(STR.auth.loggedOut); location.reload();
      } catch (e) {
        if (e.status === 404) toast.info(A.logoutAllUnsupported, { timeout: 6000 });
        else toast.error(e.message);
      } finally { logoutAllBtn.disabled = false; }
    });
    const sessionsCard = card({ title: A.sessions, body: [info, h('p.a-hint', A.logoutAllHint)], footer: [logoutAllBtn] });

    root.appendChild(h('div.a-grid-2', pwCard, sessionsCard));
    return () => form.destroy();
  },
};
