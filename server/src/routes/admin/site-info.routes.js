// Admin «اطلاعات تماس و هویت» — GET/PUT /api/admin/site-info.
// PUT takes the whole object and stores exactly the validated shape
// (E.164 phones, https URLs, enum socials, length caps, Persian digits
// normalised). The generic settings API never sees this key: it is
// registered non-public with its own schema (lib/siteinfo.js).
import express from 'express';
import { setSetting } from '../../db/index.js';
import { audit } from '../../lib/audit.js';
import { publicSiteInfo, validateSiteInfo, isContactComplete, SITE_INFO_KEY, BUSINESS_TYPES, SOCIAL_KINDS, PHONE_TYPES, MAP_KEYS } from '../../lib/siteinfo.js';

const router = express.Router();

router.get('/', (_req, res) => res.json({
  site_info: publicSiteInfo(),
  complete: isContactComplete(),
  options: { phone_types: PHONE_TYPES, social_kinds: SOCIAL_KINDS, map_keys: MAP_KEYS, business_types: BUSINESS_TYPES },
}));

router.put('/', (req, res) => {
  const before = publicSiteInfo();
  const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
  // accept both {site_info: {...}} and the bare object
  const clean = validateSiteInfo(body.site_info && typeof body.site_info === 'object' ? body.site_info : body);
  setSetting(SITE_INFO_KEY, clean);
  const changed = Object.keys(clean).filter(k => JSON.stringify(clean[k]) !== JSON.stringify(before[k]));
  // field names only — the values are the owner's contact details
  audit(req, 'update', 'site_info', SITE_INFO_KEY, `site_info: ${changed.join(', ') || 'no change'}`, { changed });
  res.json({ ok: true, site_info: clean, complete: isContactComplete() });
});

export default { basePath: '/site-info', order: 40, router };
