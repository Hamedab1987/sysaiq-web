// Route auto-discovery: every *.routes.js in a folder default-exports
//   { basePath: '/api/leads', order: 100, router, gate?: true }
// and is mounted in ascending `order` (ties: file name). Workstreams add a
// file; nobody edits a shared index.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export async function discoverRoutes(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.routes.js')).sort();
  const mods = [];
  for (const file of files) {
    const mod = (await import(pathToFileURL(join(dir, file)).href)).default;
    if (!mod || typeof mod.router !== 'function') throw new Error(`[routes] ${file}: default export must be {basePath, order, router}`);
    mods.push({
      file,
      basePath: typeof mod.basePath === 'string' ? mod.basePath : '/',
      order: Number.isFinite(mod.order) ? mod.order : 100,
      gate: mod.gate !== false,
      router: mod.router,
    });
  }
  return mods.sort((a, b) => a.order - b.order || a.file.localeCompare(b.file));
}
