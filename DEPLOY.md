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
rsync -az -e "ssh -i ~/.ssh/id_ed25519" server/src server/admin \
  root@104.237.232.226:/var/www/sysaiq/app/
ssh -i ~/.ssh/id_ed25519 root@104.237.232.226 \
  'chown -R www-data:www-data /var/www/sysaiq/app && systemctl restart sysaiq'
```

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
