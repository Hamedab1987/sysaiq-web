// Compat shim — the data layer moved to db/index.js (schema → db/migrations).
// Old imports (`./db.js` from ai.js, projectPage.js, seed.js…) keep working.
export { db, getSetting, setSetting, allSettings, schemaVersion } from './db/index.js';
