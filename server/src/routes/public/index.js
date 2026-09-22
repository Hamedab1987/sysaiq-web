// Mounts every routes/public/*.routes.js at its basePath, lowest order first.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { discoverRoutes } from '../discover.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export async function mountPublicRoutes(app) {
  const mods = await discoverRoutes(__dirname);
  for (const m of mods) app.use(m.basePath, m.router);
  return mods.map(m => ({ file: m.file, basePath: m.basePath, order: m.order }));
}
