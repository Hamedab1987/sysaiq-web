# SysaiQ — deployment (Ubuntu server)

The live site now runs on the Ubuntu server, **not** GitHub Pages.

- **Server:** 104.237.232.226 (Ubuntu 24.04). SSH with the `id_ed25519` key
  (`ssh root@104.237.232.226`). Password login also works but key is preferred.
- **Live:** https://sysaiq.com (HTTPS via Let's Encrypt, auto-renew). `/fa/` and
  `/en/`; `/admin` = admin panel.
- **Stack:** nginx (reverse proxy + static) → Node/Express + SQLite (`sysaiq`
  systemd service). App dir: `/var/www/sysaiq/app`. Static site: `/var/www/sysaiq/site`.

## Redeploy the static site (after editing vesper-project)

```bash
cd vesper-project && python3 build.py && cd ..
rsync -az --delete -e "ssh -i ~/.ssh/id_ed25519" \
  --exclude 'design/' --exclude 'src/' --exclude 'build.py' --exclude '*.md' \
  vesper-project/en vesper-project/fa vesper-project/index.html \
  vesper-project/assets vesper-project/og.jpg \
  root@104.237.232.226:/var/www/sysaiq/site/
```

## Redeploy the backend (after editing server/)

```bash
rsync -az -e "ssh -i ~/.ssh/id_ed25519" server/src server/admin server/package.json server/package-lock.json \
  root@104.237.232.226:/var/www/sysaiq/app/
ssh -i ~/.ssh/id_ed25519 root@104.237.232.226 \
  'cd /var/www/sysaiq/app && npm ci --omit=dev && chown -R www-data:www-data /var/www/sysaiq/app && systemctl restart sysaiq'
```

**Before the first deploy of the new server code** (`src/config.js` fail-fast), the
server's `.env` must contain, or the service refuses to start:

- `NODE_ENV=production` — everything below hinges on it. Without it the app
  boots in development mode: it silently generates random `JWT_SECRET` /
  `SECRETS_KEY` values (every session and every API key saved from the admin
  panel becomes unreadable at the next restart), and migration 002 leaves the
  plaintext OpenAI key in `settings` with only a console warning. Check it
  next to the secrets:
  `ssh -i ~/.ssh/id_ed25519 root@104.237.232.226 'grep -q "^NODE_ENV=production" /var/www/sysaiq/app/.env && echo NODE_ENV ok'`
- `JWT_SECRET` — random, 24+ chars (not the old placeholder): `openssl rand -hex 32`
- `SECRETS_KEY` — exactly 32 random bytes, base64 or hex: `openssl rand -base64 32`
  (back it up: stored API keys are encrypted with it)
- `PUBLIC_BASE_URL=https://sysaiq.com` (optional; this is the production default)
- `ALLOWED_ORIGINS=https://www.sysaiq.com` — nginx serves both `sysaiq.com` and
  `www.sysaiq.com` without a redirect, and the admin CSRF check only accepts
  `PUBLIC_BASE_URL` plus this list; without it, opening https://www.sysaiq.com/admin/
  fails at login with `403 {"error":"csrf"}` (already in `.env.example`)

`ADMIN_PASS` is only checked when no admin exists yet. Schema migrations run at
boot (`journalctl -u sysaiq` shows `[migrate] applied …`); they are additive
(no DROP/RENAME), so the database always stays readable by older code. Back up
`data/sysaiq.db` before restarting.

**Post-deploy smoke check** — all three must hold:

```bash
ssh -i ~/.ssh/id_ed25519 root@104.237.232.226 \
  'journalctl -u sysaiq -n 40 --no-pager | grep -E "\[config\] production|\[migrate\]|SysaiQ server"'
# expect "[config] production: JWT_SECRET + SECRETS_KEY loaded from the environment"
# — "[config] development" or "not set — using random" means NODE_ENV/.env did not reach the service
curl -s http://127.0.0.1:3000/healthz        # → {"ok":true,"version":N}  (run on the server)
```

**Rolling back the code** (restore the previous `src/`): migration 002 moved
the OpenAI key out of `settings.ai_config` into the encrypted `secrets` table,
and the previous `ai.js` reads only `settings` / `OPENAI_API_KEY`, so after a
rollback the assistant answers with its "not configured" fallback until the
key is put back. Before restoring `src.prev`, either add `OPENAI_API_KEY=sk-…`
to `.env` or re-enter the key in the old panel's AI Assistant tab; the migrated
ciphertext row is simply ignored by the old code and picked up again on the
next roll-forward.

## Content editing (no code)

Most content is edited live from the **admin panel** at
https://sysaiq.com/admin — no redeploy needed. The static `vesper-project`
copy is only the initial seed; the DB is the source of truth once live.

## Admin panel

- URL: https://sysaiq.com/admin
- User: `hamed` (change the password from the panel or in `.env` → restart)
- Tabs: Content · Projects · FAQ · Knowledge Base · AI Assistant · Leads · AI Log
- **AI Assistant tab:** paste the OpenAI key + pick model (stored in DB).
- **Knowledge Base tab:** add/edit bilingual entries the assistant answers from.

## Service ops

```bash
systemctl status sysaiq        # health
journalctl -u sysaiq -n 50     # logs
systemctl restart sysaiq       # restart after .env change
```

## Note: GitHub Pages workflow is disabled

`.github/workflows/deploy.yml.disabled` — the domain points to the server now,
so Pages is no longer the deploy target. Re-enable only if reverting to Pages.
