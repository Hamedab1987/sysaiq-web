// Compat shim — authentication moved to middleware/auth.js.
// seed.js and any older import of './auth.js' keep working.
export { createAdmin, verifyLogin, issueCookie, clearCookie, requireAdmin, COOKIE } from './middleware/auth.js';
