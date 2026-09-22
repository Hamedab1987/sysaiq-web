---
name: sysaiq-deploy
description: Safe deployment runbook for sysaiq.com (backup → rsync → npm ci → nginx -t → restart → smoke test → rollback). Only the master agent deploys; read before touching the production server.
---

# SysaiQ deploy runbook

**Who may deploy:** the master agent only, after the supervisor approved the wave and the
owner-visible behaviour was verified locally. Subagents never touch the server.

Server: `root@104.237.232.226` (Ubuntu 24.04, Node 20), key `~/.ssh/id_ed25519`,
always `-o BatchMode=yes`. App `/var/www/sysaiq/app` (systemd unit `sysaiq`, user www-data,
DB `data/sysaiq.db`, `.env`), static site `/var/www/sysaiq/site`, backups `/var/backups/sysaiq/`.
nginx config is **certbot-managed** — it differs from `server/deploy/nginx-sysaiq.conf`.

## Never
- Never print `.env` values or secrets (check presence with `grep -c '^NAME=' .env`).
- Never `rsync --delete` into `/var/www/sysaiq/app` (it holds `data/`, `.env`, `node_modules`).
- Never edit nginx without `nginx -T` dump + timestamped backup + `nginx -t` before reload.
- Never deploy with a dirty `npm test`.

## Procedure
1. **Local gate:** `cd server && npm test` green; `python3 vesper-project/build.py` clean; commit.
2. **Backup (server):**
   `TS=$(date +%Y%m%d-%H%M%S); sqlite3 data/sysaiq.db ".backup /var/backups/sysaiq/sysaiq-$TS.db"; chmod 600 /var/backups/sysaiq/*.db; cp -a src /var/backups/sysaiq/src-$TS; cp -a admin /var/backups/sysaiq/admin-$TS`
3. **Env prerequisites** (first deploy of W1+): `.env` must contain `SECRETS_KEY`
   (`openssl rand -base64 32`, generated ON the server, appended without echoing),
   `PUBLIC_BASE_URL=https://sysaiq.com`, a strong `JWT_SECRET`. `.env` → `root:root 0600`.
   Record in DEPLOY.md that `SECRETS_KEY` must be backed up separately from the DB —
   losing it means re-entering every API key.
4. **Migration dry run:** copy the fresh backup to a temp dir on the server and boot the new
   code against it (`DATA_DIR=/tmp/… node -e "import('./src/db/index.js')"`) before touching
   the live DB. Inspect the output.
5. **Sync:** `rsync -az server/src server/admin server/templates server/content server/scripts
   server/package.json server/package-lock.json root@…:/var/www/sysaiq/app/` and the static
   site per DEPLOY.md (`vesper-project/{en,fa,index.html,assets,og.jpg,robots.txt}` →
   `/var/www/sysaiq/site/`, `--delete` allowed there only).
6. **Dependencies:** only when the lockfile hash changed: keep `node_modules.prev`, then
   `npm ci --omit=dev` (better-sqlite3 is native — must build on the server's Node 20).
7. `chown -R www-data:www-data /var/www/sysaiq/app && systemctl restart sysaiq` →
   `systemctl is-active sysaiq` + `journalctl -u sysaiq -n 20 --no-pager`.
8. **Smoke test (from the laptop):**
   - `/healthz` ok · `/fa/` `/en/` `/fa/work` `/fa/work/accounting` `/admin/` → 200
   - `/api/content` contains no `ai_config`, no `openai_key`, no `sk-[A-Za-z0-9_-]{20,}`
   - CSP header present on `/api/*`, `/admin/`, SSR pages · `/sitemap.xml`, `/robots.txt`
   - marker string of the latest content edit visible on `/fa/`
9. **Rollback:** restore `src-$TS`/`admin-$TS` (and `node_modules.prev` if deps changed),
   restart. Migrations are additive, so old code runs on the new schema. Restore the DB
   backup only if data was damaged.

## nginx cutover (M1, once)
`ssh … 'nginx -T' > scratch/live-nginx.conf` → reconcile → edit ONLY `location` lines inside
the 443 `server{}` block (leave `# managed by Certbot` lines and the port-80 block alone):
`/fa/` and `/en/` → proxy to Node with `proxy_intercept_errors on; error_page 500 502 503 504
=200 /fa/index.html` (baked fallback, `internal`), `^/(en|fa)/.+` → Node, `/p/` → Node,
`/sitemap.xml` → Node, `/assets/` `expires 7d`. `nginx -t` → `systemctl reload nginx` →
smoke test → on failure restore the backup and reload. Verify the fallback once by stopping
the `sysaiq` unit and fetching `/fa/` (must still be 200), then start it again.

## M3 connectivity test (gateways / SMS)
From the server: `curl -m 15 -s -o /dev/null -w '%{http_code}'` against each provider API host.
Timeouts ⇒ configure the relay on the owner's Iranian server (`server/deploy/relay-nginx.conf`:
fixed upstream map, `X-Relay-Key` shared secret, source-IP allowlist = production IP) and
register the relay's IP with the providers.
