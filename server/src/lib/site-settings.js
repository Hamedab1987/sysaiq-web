// The settings keys that hold public site copy, registered once with the
// registry. Everything else in the settings table (ai_config, future
// gateway/SMS config…) is private: it is never served by a public route nor
// read/written through the generic settings API.
import { registerSetting, publicSettings as publicKeys } from './registry.js';
import { allSettings } from '../db/index.js';

for (const key of ['hero_h1', 'hero_note_l', 'hero_note_r', 'about_1', 'about_2', 'contact_email']) {
  registerSetting({ key, public: true, schema: 'bilingual' });
}

// {key: {en, fa}} for every registered public key that has a row
export function publicSettingValues() {
  const all = allSettings();
  const out = {};
  for (const k of publicKeys()) if (k in all) out[k] = all[k];
  return out;
}
