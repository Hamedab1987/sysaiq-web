// AI assistant configuration: OpenAI key (stored encrypted; never shown
// again) + model, and a live test against the public /api/ai/chat.
//   GET /ai-config → {configured, key_hint, model, source} · PUT /ai-config {openai_key?, model?}
import { h, icon, pageHeader, card, createForm, submitButton, secretField, selectField, field, toast, statusBadge, badge, skeleton, errorState, extLink } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const T = {
  title: 'دستیار هوشمند', subtitle: 'اتصال دستیار گفت‌وگوی سایت به OpenAI. کلید روی سرور رمزنگاری می‌شود و دیگر نمایش داده نمی‌شود.',
  connection: 'اتصال', keyF: 'کلید API اوپن‌ای‌آی', modelF: 'مدل', modelHint: 'اگر مطمئن نیستید، gpt-4o-mini را نگه دارید (ارزان و سریع).',
  keyHint: 'برای تنظیم یا جایگزینی، کلید را اینجا وارد کنید. برای حفظ کلید فعلی خالی بگذارید. کلید را از platform.openai.com/api-keys بگیرید.',
  sourcePanel: 'ذخیره‌شده از پنل', sourceEnv: 'از تنظیمات سرور (.env)', sourceUnreadable: 'کلید ذخیره‌شده قابل خواندن نیست — دوباره وارد کنید', sourceNone: 'کلیدی ثبت نشده',
  test: 'آزمایش دستیار', testing: 'در حال آزمایش…', testQ: 'در یک جملهٔ کوتاه، SysaiQ چیست؟', testOk: 'دستیار پاسخ داد:', testFail: 'آزمایش انجام نشد.',
  how: 'دستیار چگونه پاسخ می‌دهد؟', howBody: 'دستیار فقط بر اساس مدخل‌های «پایگاه دانش» پاسخ می‌دهد؛ برای آموزش‌دادن دربارهٔ خدمات، پروژه‌ها و فرایند کار، آنجا مدخل اضافه کنید. زبان بازدیدکننده (فارسی/انگلیسی) به‌طور خودکار تشخیص داده می‌شود.',
  goKb: 'رفتن به پایگاه دانش', saved: 'تنظیمات دستیار ذخیره شد',
};
const MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini', 'gpt-4.1'];

export default {
  title: T.title,
  async mount(root, ctx) {
    root.appendChild(pageHeader({ eyebrow: '[ SYSAIQ—ADMIN / AI ]', title: T.title, subtitle: T.subtitle }));
    const holder = h('div', skeleton({ kind: 'form' }));
    root.appendChild(holder);
    let cfg;
    try { cfg = await api.get('/ai-config'); } catch (e) { holder.replaceChildren(errorState({ error: e, retry: () => ctx.router.reload() })); return; }
    if (!root.isConnected) return;

    const sourceLabel = s => ({ panel: T.sourcePanel, env: T.sourceEnv, unreadable: T.sourceUnreadable, none: T.sourceNone }[s] || s);
    const status = h('div.a-row', statusBadge(cfg.configured ? 'configured' : 'missing'), badge(sourceLabel(cfg.source), { kind: cfg.source === 'unreadable' ? 'danger' : null }));
    const key = secretField({ name: 'openai_key', label: T.keyF, configured: !!cfg.configured, maskHint: cfg.key_hint || '', hint: T.keyHint, rules: [v => (v && (/\s/.test(v) || v.length < 12) ? STR.fields.invalid : null)] });
    const model = selectField({ name: 'model', label: T.modelF, hint: T.modelHint, options: [...new Set([cfg.model, ...MODELS].filter(Boolean))] });
    const form = createForm({
      fields: [key, model], dirtyToken: 'ai-config', values: { openai_key: '', model: cfg.model || MODELS[0] },
      async onSubmit(values) {
        const body = { model: values.model };
        if (values.openai_key) body.openai_key = values.openai_key;
        await api.put('/ai-config', body);
        toast(T.saved);
        cfg = await api.get('/ai-config');
        status.replaceChildren(statusBadge(cfg.configured ? 'configured' : 'missing'), badge(sourceLabel(cfg.source), { kind: cfg.source === 'unreadable' ? 'danger' : null }));
        key.setStatus(!!cfg.configured, cfg.key_hint || '');
        key.value = '';
        form.setValues({ openai_key: '', model: cfg.model || values.model });
        return true;
      },
    });

    const testOut = h('div.a-hint', { role: 'status', 'aria-live': 'polite' });
    const testBtn = h('button.a-btn', { type: 'button' }, icon('sparkles'), T.test);
    testBtn.addEventListener('click', async () => {
      testBtn.disabled = true; testOut.textContent = T.testing; testOut.className = 'a-hint';
      try {
        const r = await api.post('/api/ai/chat', { message: T.testQ });
        testOut.replaceChildren(icon(r.configured ? 'check-circle' : 'alert-triangle', { size: 'sm' }), ' ', r.configured ? T.testOk : '', ' ', h('span', { dir: 'auto' }, String(r.reply || '')));
        testOut.className = r.configured ? 'a-hint a-ok' : 'a-hint a-warn';
      } catch (e) { testOut.textContent = `${T.testFail} ${e.message || ''}`; testOut.className = 'a-hint a-danger'; }
      finally { testBtn.disabled = false; }
    });

    holder.replaceChildren(
      card({ title: T.connection, body: [status, form.el, testOut], footer: [submitButton(form), testBtn] }),
      card({ title: T.how, body: [h('p', T.howBody), h('div', h('a.a-btn.a-btn--sm', { href: '#/knowledge' }, icon('book-open', { size: 'sm' }), T.goKb), ' ', extLink('https://platform.openai.com/api-keys', 'platform.openai.com/api-keys', { class: 'a-small' }))] }),
    );
    return () => form.destroy();
  },
};
