// «پشتیبان‌گیری» — where the data lives, system status and the exact
// commands to back up / restore. There is no download endpoint on the server
// (routes/admin/system.routes.js has GET /system and cache purge only), so
// this page never pretends to have one; backups are taken on the server.
//   GET /system → {node, schema_version, uptime_s, env} · POST /system/cache/purge
//   GET /setup-status → {backup_recent, …}
import { h, icon, clear, pageHeader, card, badge, statusBadge, toast, confirm, statCard, copyToClipboard, skeleton, errorState, toFaDigits, formatJalali } from '../ui.js';
import { STR } from '../strings.js';
import { api } from '../api.js';

const CSS_HREF = '/admin/css/views/backup.css';
// paths from the deploy runbook (.claude/skills/sysaiq-deploy): app dir, DB, uploads, backups
const P = { app: '/var/www/sysaiq/app', db: 'data/sysaiq.db', uploads: 'data/uploads', env: '.env', backups: '/var/backups/sysaiq' };
const CMD = {
  backup: `cd ${P.app}\nTS=$(date +%Y%m%d-%H%M%S)\nsqlite3 ${P.db} ".backup ${P.backups}/sysaiq-$TS.db"\ntar -czf ${P.backups}/uploads-$TS.tgz ${P.uploads}\nchmod 600 ${P.backups}/*`,
  list: `ls -lh ${P.backups}/`,
  download: `scp root@104.237.232.226:${P.backups}/sysaiq-<تاریخ>.db ~/Downloads/`,
  restore: `cd ${P.app}\nsystemctl stop sysaiq\ncp ${P.db} ${P.backups}/before-restore-$(date +%Y%m%d-%H%M%S).db\ncp ${P.backups}/sysaiq-<تاریخ>.db ${P.db}\nrm -f ${P.db}-wal ${P.db}-shm\nchown www-data:www-data ${P.db}\nsystemctl start sysaiq`,
};

const T = {
  title: 'پشتیبان‌گیری', subtitle: 'پایگاه دادهٔ سایت یک فایل SQLite است؛ همراه پوشهٔ تصاویر و فایل .env همهٔ چیزی است که برای بازگردانی لازم است.',
  eyebrow: '[ SYSAIQ—ADMIN / BACKUP ]',
  noEndpoint: 'دانلود پشتیبان از پنل هنوز فعال نیست؛ پشتیبان‌گیری روی سرور و با دستورهای زیر انجام می‌شود. (پشتیبان‌گیری خودکار شبانه در فاز بعدی اضافه می‌شود.)',
  where: 'داده‌ها کجا هستند', whereHint: 'مسیرها روی سرور Ubuntu، مطابق runbook استقرار.',
  items: { db: 'پایگاه داده (SQLite)', uploads: 'تصاویر بارگذاری‌شده', env: 'تنظیمات محرمانه (.env)', backups: 'پوشهٔ پشتیبان‌ها' },
  envNote: 'کلیدهای رمزگذاری‌شدهٔ جدول secrets فقط با SECRETS_KEY همان .env بازمی‌شوند؛ .env را جدا و امن نگه دارید.',
  system: 'وضعیت سیستم', node: 'نسخهٔ Node', schema: 'نسخهٔ پایگاه داده', uptime: 'مدت روشن‌بودن', env: 'محیط اجرا', recent: 'پشتیبان اخیر (۲۴ ساعت)', recentNo: 'ثبت نشده', recentYes: 'موجود',
  purge: 'پاک‌کردن کش صفحات', purged: 'کش پاک شد', purgeMsg: 'صفحات سایت در درخواست بعدی دوباره ساخته می‌شوند. برای وقتی که تغییری روی سایت دیده نمی‌شود.',
  how: 'چطور پشتیبان بگیرم', howHint: 'با SSH وارد سرور شوید و دستورها را به ترتیب اجرا کنید.',
  s1: 'گرفتن پشتیبان', s1h: 'با ‎.backup‎ خود SQLite (سازگار با WAL؛ فایل را مستقیم کپی نکنید).',
  s2: 'دیدن پشتیبان‌های موجود',
  s3: 'دانلود به رایانهٔ خودتان', s3h: 'برای نگهداری خارج از سرور — به‌جای <تاریخ> نام فایل را بگذارید.',
  s4: 'بازگردانی', s4h: 'قبل از بازگردانی، از نسخهٔ فعلی هم پشتیبان گرفته می‌شود.',
  copy: 'کپی دستور',
  uptimeFmt: s => { const d = Math.floor(s / 86400), hh = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); return d ? `${toFaDigits(d)} روز و ${toFaDigits(hh)} ساعت` : hh ? `${toFaDigits(hh)} ساعت و ${toFaDigits(m)} دقیقه` : `${toFaDigits(m)} دقیقه`; },
};

function ensureStylesheet(href) {
  if (document.head.querySelector(`link[data-view-css="${href}"]`)) return;
  document.head.appendChild(h('link', { rel: 'stylesheet', href, 'data-view-css': href }));
}
const cmd = text => h('pre.bk-cmd', { dir: 'ltr' }, text, h('button.a-btn.a-btn--subtle.a-btn--icon.a-btn--sm.bk-copy', { type: 'button', 'aria-label': T.copy, title: T.copy, onclick: () => copyToClipboard(text) }, icon('copy', { size: 'sm' })));
const step = (n, title, hint, text) => h('div.bk-step', h('div.bk-step__title', h('span.bk-step__num', toFaDigits(n)), title), hint ? h('div.a-hint', hint) : null, cmd(text));

async function mount(root) {
  ensureStylesheet(CSS_HREF);
  root.appendChild(pageHeader({ eyebrow: T.eyebrow, title: T.title, subtitle: T.subtitle }));
  root.appendChild(h('div.a-form__banner', icon('info'), h('div', T.noEndpoint)));

  const stats = h('div.a-stats', statCard({ label: T.node, icon: 'zap', loading: true }), statCard({ label: T.schema, icon: 'database', loading: true }), statCard({ label: T.uptime, icon: 'clock', loading: true }), statCard({ label: T.recent, icon: 'history', loading: true }));
  const purgeBtn = h('button.a-btn', { type: 'button', onclick: async () => {
    if (!(await confirm({ title: T.purge, message: T.purgeMsg, confirmLabel: T.purge }))) return;
    try { await api.post('/system/cache/purge', {}); toast(T.purged); } catch (e) { toast.error(e.message); }
  } }, icon('refresh-cw'), T.purge);
  const sysCard = card({ title: T.system, actions: [purgeBtn], body: stats });

  const whereCard = card({ title: T.where, hint: T.whereHint, body: [
    h('dl.a-dl',
      h('dt', T.items.db), h('dd', h('code', { dir: 'ltr' }, `${P.app}/${P.db}`)),
      h('dt', T.items.uploads), h('dd', h('code', { dir: 'ltr' }, `${P.app}/${P.uploads}`)),
      h('dt', T.items.env), h('dd', h('code', { dir: 'ltr' }, `${P.app}/${P.env}`)),
      h('dt', T.items.backups), h('dd', h('code', { dir: 'ltr' }, P.backups))),
    h('div.a-hint', icon('alert-triangle', { size: 'sm' }), ' ', T.envNote),
  ] });
  const howCard = card({ title: T.how, hint: T.howHint, body: h('div.a-stack',
    step(1, T.s1, T.s1h, CMD.backup), step(2, T.s2, null, CMD.list), step(3, T.s3, T.s3h, CMD.download), step(4, T.s4, T.s4h, CMD.restore)) });

  root.append(h('div.bk-grid', sysCard, whereCard), howCard);

  try {
    const [sys, setup] = await Promise.allSettled([api.get('/system'), api.get('/setup-status')]);
    if (!root.isConnected) return;
    const s = sys.status === 'fulfilled' ? sys.value : null;
    const cards = stats.children;
    const set = (i, v) => { const c = cards[i].querySelector('.a-stat__value'); clear(c); c.append(v instanceof Node ? v : String(v)); };
    if (s) {
      set(0, h('span', { dir: 'ltr' }, s.node));
      set(1, toFaDigits(s.schema_version));
      set(2, T.uptimeFmt(Number(s.uptime_s) || 0));
      set(3, setup.status === 'fulfilled' && setup.value.backup_recent ? statusBadge('ok', { label: T.recentYes }) : badge(T.recentNo, { kind: 'warn', icon: 'alert-triangle' }));
      stats.appendChild(statCard({ label: T.env, icon: 'settings', value: s.env }));
    } else stats.replaceChildren(errorState({ error: sys.reason }));
  } catch (e) { stats.replaceChildren(errorState({ error: e })); }
}

export default { title: T.title, mount };
