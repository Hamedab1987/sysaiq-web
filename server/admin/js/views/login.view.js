// Login. Mounted by main.js either as the full page (no session) or inside
// a modal when a session expires mid-work ({embedded: true}); in both cases
// ctx.onSuccess() is called after POST /login answers 200.
import { h, icon, field, createForm, submitButton } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

export default {
  title: STR.auth.title,
  async mount(root, ctx = {}) {
    const { embedded = false, message, onSuccess } = ctx;
    const errorBox = h('div.a-form__banner', { role: 'alert', hidden: true });
    const notice = message ? h('div.a-hint', { role: 'status' }, message) : null;

    const user = field({ name: 'username', label: STR.auth.username, required: true, autocomplete: 'username', dir: 'ltr', lang: 'en', autofocus: true, maxLength: 80, spellcheck: false });
    const pass = field({ name: 'password', label: STR.auth.password, type: 'password', required: true, autocomplete: 'current-password', dir: 'ltr', lang: 'en' });

    // show / hide password (aria-pressed, no inline handlers)
    const input = pass.control;
    let shown = false;
    const eye = h('button.a-input-wrap__btn', { type: 'button', 'aria-label': STR.auth.showPassword, 'aria-pressed': 'false' }, icon('eye', { size: 'sm' }));
    eye.addEventListener('click', () => {
      shown = !shown; input.type = shown ? 'text' : 'password';
      eye.setAttribute('aria-pressed', String(shown)); eye.setAttribute('aria-label', shown ? STR.auth.hidePassword : STR.auth.showPassword);
      eye.replaceChildren(icon(shown ? 'eye-off' : 'eye', { size: 'sm' }));
      input.focus();
    });
    const wrap = h('div.a-input-wrap');
    input.replaceWith(wrap); wrap.append(input, eye);

    const showError = msg => { errorBox.replaceChildren(icon('alert-circle'), h('div', msg)); errorBox.hidden = false; };
    const form = createForm({
      fields: [user, pass], submitOnEnter: true, dirtyToken: 'login',
      async onSubmit(values) {
        errorBox.hidden = true;
        try {
          await api.post('/login', { username: values.username.trim(), password: values.password });
        } catch (e) {
          if (e.status === 401) showError(STR.auth.invalid);
          else if (e.status === 429) showError(STR.auth.tooMany);
          else showError(e.message || STR.states.error);
          pass.value = ''; pass.focus();
          return false;
        }
        await onSuccess?.();
        return true;
      },
    });
    form.el.prepend(errorBox);
    form.el.append(submitButton(form, { label: STR.auth.signIn, icon: 'log-in', busyLabel: STR.auth.signingIn }));
    form.el.querySelector('button[type="submit"]').classList.add('a-btn--block');
    // the login form is never "dirty" for the navigation guard
    form.setDirtyState = () => {};

    if (embedded) {
      root.append(notice || '', form.el);
    } else {
      root.appendChild(h('div.a-auth',
        h('div.a-auth__card',
          h('div.a-auth__head', h('div.a-brand__name.a-gradtext', { dir: 'ltr' }, 'SysaiQ'), h('h1', STR.auth.title), h('p.a-hint', STR.auth.subtitle)),
          notice, form.el,
          h('p.a-auth__foot', STR.auth.footer))));
    }
    requestAnimationFrame(() => user.focus());
    return () => form.destroy();
  },
};
