# deploy/

Production runs on one Hostinger VPS (Ubuntu 24.04) with PM2 and Nginx (CLAUDE.md, "Stack").

| File | What it is |
|---|---|
| [`setup-vps.md`](setup-vps.md) | One-time server setup: users, firewall, Node, PostgreSQL, Redis, Nginx, TLS, env files and keys, PM2 at boot, backups, and moving a server from the older single-user layout |
| [`ecosystem.config.cjs`](ecosystem.config.cjs) | PM2 apps `divvy-web` (cluster ×2), `divvy-api` (cluster ×1) and `divvy-worker` (fork, exactly one). Each runs as the OS user of the same name, under its own PM2 daemon, as `node --env-file=/etc/divvy/<web\|api\|worker>.env`, and logs to `/var/log/divvy/<web\|api\|worker>/`. Always started with `--only <app>`. |
| [`nginx/divvy.conf`](nginx/divvy.conf) | TLS, the proxy to :3000 and :4000 (WebSocket `/api/live`), CSP and security headers, `X-Geo-Country`, per-IP rate limits (pages, API, uploads, launches), 404 for any `/api` spelling but lowercase, the launch pause switch |
| [`backup/pg-backup.sh`](backup/pg-backup.sh) | Daily `pg_dump -Fc` to `/var/backups/divvy`, 14-day rotation, optional rclone offsite copy. Runs as `divvy-backup` from an installed copy, `/usr/local/bin/divvy-pg-backup`, with `/etc/divvy/backup.env`. |
| [`backup/pg-restore.md`](backup/pg-restore.md) | Restore procedure: scratch database first, checks, rename swap, reconciling with the chain |
| [`../docs/RUNBOOK.md`](../docs/RUNBOOK.md) | Deploy, rollback, the admin API, alerts, how the payout engine behaves, payout dry-run and going live, incident playbooks |
| [`../.github/workflows/ci.yml`](../.github/workflows/ci.yml) | CI: typecheck, lint, test and build against Postgres 16 and Redis 7, then Playwright e2e on the mock API |

Each process runs as its own OS user with its own env file. `divvy` owns the releases and builds them, holds no secrets, and runs nothing. `divvy-web` serves the site. `divvy-api` runs with `API_MODE=live` (`NODE_ENV=production` refuses `API_MODE=mock`) and holds no keys: its env file names no keypair. `divvy-worker` is the only user that can read `/etc/divvy/keys`; it runs the launch pipeline, the claim builder, the indexer, the hourly dividend engine and the ops jobs. The API and the worker refuse to start without `DATABASE_URL`, `REDIS_URL`, `SOLANA_RPC_URL` and `DIVVY_PLATFORM_CONFIG`, or with a `STORAGE_DIR` inside the release or a `PUBLIC_MEDIA_BASE` that isn't public https; the worker also refuses an RPC that isn't on `SOLANA_CLUSTER`. The worker starts with payouts in dry-run (`PAYOUTS_DRY_RUN=true`), and nothing is sent on mainnet until `DIVVY_MAINNET_ENABLED=true`.

How these files were checked:

- **Nginx:** `nginx -t` on nginx 1.24 with the GeoIP2 module, plus live requests for headers, geo, rate limits, upload size, the pause switch and the WebSocket upgrade.
- **PM2:** run under PM2 7.1.1 with the built API and worker, including a zero-downtime reload, a failed-boot reload and a `current` symlink switch.
- **Backups:** the backup script and the restore steps were run against PostgreSQL 16.
- **CI:** `ci.yml` passes actionlint.

The split into per-app users and env files (`setup-vps.md` §3 and §8) came after those checks. Rehearse it on a staging server, including a reboot, before relying on it in production.

**CI actions are pinned to version tags** (for example `actions/checkout@v7`), not to commit SHAs, so a moved tag would change what runs. That's an accepted risk for now: the workflow has read-only repository permissions, holds no secrets and never deploys. Pin every action to a full commit SHA before mainnet.
