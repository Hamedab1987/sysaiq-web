// Navigation registry — every admin route is declared here, including views
// that do not exist yet (they get the «به‌زودی» placeholder until a
// views/<view>.view.js lands; nothing else needs to change).
//   item: { id, label, icon, path, view, routes?: ['/x/:id'], badge?: (state) => number|string|null,
//           quick?: true (bottom bar on phones), legacy?: true (exists in the old panel), hidden?: true }
import { STR } from './strings.js';

const G = STR.nav.groups;

export const NAV = [
  { id: 'home', label: null, items: [
    { id: 'dashboard', label: STR.nav.dashboard, icon: 'home', path: '/', view: 'dashboard', quick: true },
  ] },
  { id: 'content', label: G.content, items: [
    { id: 'content', label: 'متن‌های سایت', icon: 'type', path: '/content', view: 'content', legacy: true },
    { id: 'sections', label: 'بخش‌های صفحهٔ اصلی', icon: 'layout', path: '/sections', view: 'sections', routes: ['/sections/:id'] },
    { id: 'pages', label: 'صفحات', icon: 'file-text', path: '/pages', view: 'pages', routes: ['/pages/:id'] },
    { id: 'services', label: 'خدمات', icon: 'briefcase', path: '/services', view: 'services', routes: ['/services/:id'] },
    { id: 'projects', label: 'پروژه‌ها', icon: 'folder', path: '/projects', view: 'projects', routes: ['/projects/:id'], legacy: true, quick: true },
    { id: 'faqs', label: 'سؤالات متداول', icon: 'help-circle', path: '/faqs', view: 'faqs', routes: ['/faqs/:id'], legacy: true },
    { id: 'media', label: 'رسانه‌ها', icon: 'image', path: '/media', view: 'media' },
    { id: 'news', label: 'اخبار', icon: 'newspaper', path: '/news', view: 'news', routes: ['/news/:tab', '/news/:tab/:id'], badge: s => s.counters?.newsPending || null },
  ] },
  { id: 'customers', label: G.customers, items: [
    { id: 'leads', label: 'سرنخ‌ها', icon: 'users', path: '/leads', view: 'leads', routes: ['/leads/:id'], legacy: true, quick: true, badge: s => s.counters?.newLeads || null },
    { id: 'conversations', label: 'گفت‌وگوهای دستیار', icon: 'message-square', path: '/conversations', view: 'conversations', routes: ['/conversations/:sid'], legacy: true },
    { id: 'sms', label: 'پنل پیامک', icon: 'send', path: '/sms', view: 'sms', routes: ['/sms/:tab'] },
  ] },
  { id: 'finance', label: G.finance, items: [
    { id: 'invoices', label: 'فاکتورها', icon: 'receipt', path: '/invoices', view: 'invoices', routes: ['/invoices/:id'] },
    { id: 'payments', label: 'پرداخت‌ها', icon: 'credit-card', path: '/payments', view: 'payments', routes: ['/payments/:id'] },
    { id: 'gateways', label: 'درگاه‌های پرداخت', icon: 'landmark', path: '/gateways', view: 'gateways' },
  ] },
  { id: 'trust', label: G.trust, items: [
    { id: 'site-info', label: 'اطلاعات تماس و هویت', icon: 'id-card', path: '/site-info', view: 'site-info' },
    { id: 'trust', label: 'اینماد و نمادها', icon: 'shield-check', path: '/trust', view: 'trust' },
    { id: 'seo', label: 'سئو و تگ‌های تأیید', icon: 'search', path: '/seo', view: 'seo' },
  ] },
  { id: 'ai', label: G.ai, items: [
    { id: 'ai', label: 'دستیار هوشمند', icon: 'sparkles', path: '/ai', view: 'ai', legacy: true },
    { id: 'knowledge', label: 'پایگاه دانش', icon: 'book-open', path: '/knowledge', view: 'knowledge', routes: ['/knowledge/:id'], legacy: true },
  ] },
  { id: 'settings', label: G.settings, items: [
    { id: 'account', label: 'حساب و امنیت', icon: 'lock', path: '/account', view: 'account', quick: true },
    { id: 'backup', label: 'پشتیبان‌گیری', icon: 'database', path: '/backup', view: 'backup' },
    { id: 'audit', label: 'گزارش تغییرات', icon: 'history', path: '/audit', view: 'audit' },
  ] },
  // developer reference — reachable by URL only
  { id: 'dev', label: null, hidden: true, items: [
    { id: '_ui', label: 'مرجع اجزای رابط', icon: 'palette', path: '/_ui', view: '_ui', hidden: true },
  ] },
];

export const LEGACY_URL = '/admin/legacy.html';

// flat list of items, in sidebar order
export const NAV_ITEMS = NAV.flatMap(g => g.items);
export const QUICK_ITEMS = NAV_ITEMS.filter(i => i.quick);

// every route pattern → its item (item.path first, then extra routes)
export const ROUTES = NAV_ITEMS.flatMap(i => [{ pattern: i.path, item: i }, ...(i.routes || []).map(pattern => ({ pattern, item: i }))]);

export const itemById = id => NAV_ITEMS.find(i => i.id === id) || null;
