// SLOT:HEAD_META — enabled verification tags (<meta name content>) from the
// head_meta table (migration 010). Names and values are re-checked against
// the allowlist at render time by lib/trust.js.
import { db } from '../../db/index.js';
import { renderHeadMeta } from '../../lib/trust.js';

export function headMetaRows() {
  return db.prepare('SELECT id, name, content, enabled FROM head_meta WHERE enabled=1 ORDER BY id').all();
}

export function renderHeadMetaSlot() {
  return renderHeadMeta(headMetaRows());
}

export function render() {
  return renderHeadMetaSlot();
}
export default render;
