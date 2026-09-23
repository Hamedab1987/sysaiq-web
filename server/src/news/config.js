// News settings (settings.news_config, admin-only):
//   { enabled, interval_hours, min_importance, daily_cap, model, auto_publish }
// auto_publish is kept in the shape but always false: the owner decided that
// every collected item waits for a human to publish it.
import { getSetting, setSetting } from '../db/index.js';
import { registerSetting } from '../lib/registry.js';
import { v, validate } from '../lib/validate.js';
import { HttpError } from '../lib/errors.js';
import { NEWS_CATEGORIES } from '../db/migrations/400_news.js';

export const CONFIG_KEY = 'news_config';
export const CATEGORIES = NEWS_CATEGORIES;
export const DEFAULT_CONFIG = Object.freeze({
  enabled: true, interval_hours: 6, min_importance: 3, daily_cap: 30, model: '', auto_publish: false,
});

registerSetting({
  key: CONFIG_KEY,
  public: false,
  schema: { enabled: 'bool', interval_hours: 'int 1..168', min_importance: 'int 1..5', daily_cap: 'int 0..500', model: 'text ≤ 60 ("" = assistant model)', auto_publish: 'always false' },
});

const RULES = {
  enabled: v.bool(),
  interval_hours: v.int({ min: 1, max: 168 }),
  min_importance: v.int({ min: 1, max: 5 }),
  daily_cap: v.int({ min: 0, max: 500 }),
  model: v.str({ max: 60, pattern: /^[A-Za-z0-9._:-]*$/ }),
  auto_publish: v.bool(),
};

// stored values are re-validated on read: a hand-edited row can't break the scheduler
export function getNewsConfig() {
  const raw = getSetting(CONFIG_KEY, {}) || {};
  const out = { ...DEFAULT_CONFIG };
  for (const [k, rule] of Object.entries(RULES)) {
    if (raw[k] === undefined) continue;
    try { out[k] = rule(raw[k], k); } catch { /* keep the default */ }
  }
  out.auto_publish = false;
  return out;
}

export function setNewsConfig(patch = {}) {
  const src = patch && typeof patch === 'object' ? patch : {};
  const schema = {};
  for (const k of Object.keys(RULES)) if (Object.hasOwn(src, k)) schema[k] = RULES[k];
  const b = validate(schema, src);
  if (b.auto_publish) {
    throw new HttpError(422, 'validation', 'Validation failed', { auto_publish: 'auto-publish is off by owner decision: every item is reviewed before publishing' });
  }
  const next = { ...getNewsConfig(), ...b, auto_publish: false };
  setSetting(CONFIG_KEY, next);
  return next;
}
