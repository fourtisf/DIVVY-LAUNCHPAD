# deploy/

Production runs on one Hostinger VPS (Ubuntu 24.04) with PM2 and Nginx (CLAUDE.md, "Stack").

| File | What it is |
|---|---|
| [`setup-vps.md`](setup-vps.md) | One-time server setup: users, firewall, Node, PostgreSQL, Redis, Nginx, TLS, secrets, PM2 at boot, backups |
| [`ecosystem.config.cjs`](ecosystem.config.cjs) | PM2 apps `divvy-web` (cluster ×2), `divvy-api` (cluster ×1) and `divvy-worker` (fork, exactly one), each started as `node --env-file=/etc/divvy/divvy.env` |
| [`nginx/divvy.conf`](nginx/divvy.conf) | TLS, the proxy to :3000 and :4000 (WebSocket `/api/live`), CSP and security headers, `X-Geo-Country`, rate limits, the launch pause switch |
| [`backup/pg-backup.sh`](backup/pg-backup.sh) | Daily `pg_dump -Fc` to `/var/backups/divvy`, 14-day rotation, optional rclone offsite copy |
| [`backup/pg-restore.md`](backup/pg-restore.md) | Restore procedure: scratch database first, checks, rename swap, reconciling with the chain |
| [`../docs/RUNBOOK.md`](../docs/RUNBOOK.md) | Deploy, rollback and incident playbooks |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI: typecheck, lint, test and build against Postgres 16 and Redis 7, then Playwright e2e on the mock API |

Until Phase 2 lands, `divvy-api` won't start under PM2. `NODE_ENV=production` refuses `API_MODE=mock`, and `API_MODE=live` isn't built yet. The server can be set up now; the first real deploy waits for Phase 2.

How these files were checked:

- **Nginx:** `nginx -t` on nginx 1.24 with the GeoIP2 module, plus live requests for headers, geo, rate limits, upload size, the pause switch and the WebSocket upgrade.
- **PM2:** run under PM2 7.1.1 with the built API and worker, including a zero-downtime reload, a failed-boot reload and a `current` symlink switch.
- **Backups:** the backup script and the restore steps were run against PostgreSQL 16.
- **CI:** `ci.yml` passes actionlint.
