// Versioned, additive-only migrations.
// Files live in ./migrations as NNN_name.js and export { version, name, up(db, ctx) }.
// Every unapplied version runs in ascending order, each inside its own
// transaction, and is recorded in schema_migrations — so a late-arriving lower
// number (another workstream's range) is still picked up on the next boot.
//
// Optional export `afterCommit(db, ctx)` runs right after the migration's
// transaction commits, for statements SQLite refuses inside one (VACUUM,
// wal_checkpoint, PRAGMA secure_delete). It must be safe to skip: if it throws,
// the migration stays applied and the error is only logged.
import { readdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = join(__dirname, 'migrations');
const FILE_RE = /^(\d{3})_([a-z0-9_]+)\.js$/;
const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function makeCtx(db) {
  const ident = s => {
    if (!IDENT_RE.test(String(s))) throw new Error(`[migrate] bad identifier: ${s}`);
    return s;
  };
  const hasTable = table =>
    !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(String(table));
  const hasColumn = (table, col) =>
    hasTable(table) && db.prepare(`PRAGMA table_info(${ident(table)})`).all().some(c => c.name === col);
  // ALTER TABLE … ADD COLUMN, skipped when the column is already there
  const addColumn = (table, col, ddl) => {
    if (hasColumn(table, col)) return false;
    db.exec(`ALTER TABLE ${ident(table)} ADD COLUMN ${ident(col)} ${ddl}`);
    return true;
  };
  return { hasTable, hasColumn, addColumn };
}

export async function loadMigrations(dir = DEFAULT_DIR) {
  const out = [];
  for (const file of readdirSync(dir).sort()) {
    const m = FILE_RE.exec(file);
    if (!m) continue;
    const mod = await import(pathToFileURL(join(dir, file)).href);
    if (mod.version !== Number(m[1])) throw new Error(`[migrate] ${file}: exported version must equal ${Number(m[1])}`);
    if (typeof mod.up !== 'function') throw new Error(`[migrate] ${file}: missing up(db, ctx)`);
    if (out.some(x => x.version === mod.version)) throw new Error(`[migrate] duplicate migration version ${mod.version}`);
    out.push({ version: mod.version, name: mod.name || m[2], up: mod.up, afterCommit: mod.afterCommit, file });
  }
  return out.sort((a, b) => a.version - b.version);
}

export async function runMigrations(db, { dir = DEFAULT_DIR, log = console.log } = {}) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version    INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);
  const migrations = await loadMigrations(dir);
  const done = new Set(db.prepare('SELECT version FROM schema_migrations').all().map(r => r.version));
  const ctx = makeCtx(db);
  const record = db.prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)');
  const applied = [];
  for (const m of migrations) {
    if (done.has(m.version)) continue;
    db.transaction(() => {
      m.up(db, ctx);
      record.run(m.version, m.name);
    })();
    if (typeof m.afterCommit === 'function') {
      try { m.afterCommit(db, ctx); } catch (e) { console.error(`[migrate] ${m.file} afterCommit: ${e.message}`); }
    }
    applied.push({ version: m.version, name: m.name });
    log(`[migrate] applied ${String(m.version).padStart(3, '0')} ${m.name}`);
  }
  return applied;
}

// highest applied version — reported by /healthz
export function schemaVersion(db) {
  return db.prepare('SELECT COALESCE(MAX(version), 0) v FROM schema_migrations').get().v;
}
