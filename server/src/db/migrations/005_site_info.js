// settings.site_info — the single source of the owner's identity + contact
// facts (address, phones, email, hours, socials, map links). The FACTS.md
// values are SITE_INFO_DEFAULTS. The row is seeded on a fresh install (empty
// settings table) and when there is legacy owner data to carry over (a
// contact_email edited away from hello@sysaiq.com in the old admin). An
// upgrade of a live database gets NO new row: Foundation's upgrade test
// guarantees that migrating an old database leaves every existing table's
// rows exactly as they were — lib/siteinfo.js serves the defaults whenever
// the row is missing, and the admin's first save writes it. Only
// lib/siteinfo.js may import from here; this file must stay free of
// db/index.js (see the migration import rule).
export const version = 5;
export const name = 'site_info';

export const SITE_INFO_KEY = 'site_info';
const LEGACY_EMAIL = 'hello@sysaiq.com';

// The strict shape every reader/writer agrees on. Keys never change meaning;
// unknown keys are dropped by lib/siteinfo.js on read and by the admin route on write.
export const SITE_INFO_DEFAULTS = Object.freeze({
  brand: 'SysaiQ',
  legal_name: { en: 'Hamed Abooali', fa: 'حامد ابوعلی' },
  address: {
    en: 'No. 25, Adel Babaei Alley, Ghavidel (Ashna) Alley, Tohid St., Qazvin, Iran',
    fa: 'قزوین، خیابان توحید، کوچه قویدل (آشنا)، کوچه عادل بابایی، پلاک ۲۵',
  },
  city: { en: 'Qazvin', fa: 'قزوین' },
  region: { en: 'Qazvin', fa: 'قزوین' },
  country: 'IR',
  postal_code: '',
  geo: null,
  phones: [
    { type: 'landline', e164: '+982833323002', display_fa: '۰۲۸-۳۳۳۲۳۰۰۲', display_en: '+98 28 3332 3002' },
    { type: 'mobile', e164: '+989125130505', display_fa: '۰۹۱۲ ۵۱۳ ۰۵۰۵', display_en: '+98 912 513 0505' },
  ],
  email: LEGACY_EMAIL,
  hours: { en: '', fa: '' },
  hours_spec: [],
  socials: [],
  map_url: { neshan: '', balad: '', google: '' },
  show: { address: true, landline: true, mobile: true, email: true, hours: true, map: true, socials: true },
});

// the pre-rebuild admin stored the contact e-mail as a bilingual copy key;
// if the owner changed it there, that value wins over the FACTS default
function legacyEmail(db) {
  const row = db.prepare("SELECT value FROM settings WHERE key='contact_email'").get();
  if (!row) return null;
  let v = null;
  try { v = JSON.parse(row.value); } catch { return null; }
  const s = typeof v === 'string' ? v : (v && typeof v === 'object' ? (v.en || v.fa) : '');
  const email = String(s || '').trim().toLowerCase();
  if (!email || email === LEGACY_EMAIL) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

export function up(db) {
  if (db.prepare('SELECT 1 FROM settings WHERE key=?').get(SITE_INFO_KEY)) return;
  const email = legacyEmail(db);
  // no settings rows at all = a fresh install (nothing to preserve); an
  // upgraded live database only gets a row when the legacy e-mail was edited
  const fresh = db.prepare('SELECT COUNT(*) c FROM settings').get().c === 0;
  if (!email && !fresh) return; // the defaults are served from code until the owner saves
  const info = { ...structuredClone(SITE_INFO_DEFAULTS), ...(email ? { email } : {}) };
  db.prepare("INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))")
    .run(SITE_INFO_KEY, JSON.stringify(info));
}
