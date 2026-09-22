// Admin audit trail → audit_log (migration 003).
//   audit(req, 'update', 'projects', id, 'renamed to X', { fields: [...] })
// Never throws and never stores request bodies or secret values: `summary`
// and `meta` are what the caller chooses to say, capped in size.
import { db } from '../db/index.js';

const MAX_SUMMARY = 500;
const MAX_META = 4000;

let insert = null;
function stmt() {
  return insert ||= db.prepare(`INSERT INTO audit_log
    (admin_id, admin_name, action, entity, entity_id, summary, meta, ip)
    VALUES (?,?,?,?,?,?,?,?)`);
}

export function audit(req, action, entity, entityId, summary = '', meta = null) {
  try {
    const a = req?.admin || {};
    let metaJson = '{}';
    if (meta && typeof meta === 'object') {
      metaJson = JSON.stringify(meta);
      if (metaJson.length > MAX_META) metaJson = JSON.stringify({ truncated: true });
    }
    stmt().run(
      Number.isInteger(a.uid) ? a.uid : null,
      String(a.u || ''),
      String(action || '').slice(0, 40),
      String(entity || '').slice(0, 40),
      entityId === undefined || entityId === null ? '' : String(entityId).slice(0, 64),
      String(summary || '').slice(0, MAX_SUMMARY),
      metaJson,
      String(req?.ip || '').slice(0, 64),
    );
    return true;
  } catch (e) {
    console.error('[audit]', e?.message || e);
    return false;
  }
}
