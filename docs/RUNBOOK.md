# Divvy operations runbook

How to deploy, roll back and handle incidents on the production VPS. One-time server setup is in [`deploy/setup-vps.md`](../deploy/setup-vps.md); database restores are in [`deploy/backup/pg-restore.md`](../deploy/backup/pg-restore.md).

**What runs.** Each app runs as its own OS user, under its own PM2 daemon, with its own env file (`deploy/setup-vps.md`, "How the server is split"). `divvy-web` serves the site. `divvy-api` runs in live mode (PostgreSQL, Redis and the Solana RPC) and holds no private keys. `divvy-worker` holds the three hot-wallet keys and runs everything that signs: the launch pipeline, the claim builder, the indexer, the hourly dividend engine and the small ops jobs. The user `divvy` owns the releases and runs nothing. Two values, set the same in `/etc/divvy/api.env` and `/etc/divvy/worker.env`, decide what the worker may send:

- `PAYOUTS_DRY_RUN` (default `true`). Dry-run computes every round from real chain data and signs nothing, and holder claims are refused. Turning it off needs the owner's approval ("Payouts: dry-run and going live").
- `DIVVY_MAINNET_ENABLED` (default `false`), the mainnet gate. With `SOLANA_CLUSTER=mainnet-beta` and the gate off, nothing is signed and sent: launches fail with "Launches aren't open yet", claims answer "Claims aren't open yet", and live payout runs stop. Dry-run payouts still run. Devnet is always allowed. Neither the API nor the worker starts if the RPC isn't on `SOLANA_CLUSTER` ("Worker or API won't start").

**Rules that always apply (CLAUDE.md):**

- No mainnet spend without the owner's explicit approval in chat. That covers funding or topping up wallets, sweeping funds, turning off payout dry-run, turning on the mainnet gate, raising the Jito tip, the launcher's hourly cap, the swap and send caps or the largest swap size, and PlatformConfig changes.
- Key material never goes in the repo, the database, logs, chats or tickets. An admin's `divvy_session` cookie is a credential too.
- Creates go only through Jito bundles. Never rebroadcast one through an RPC, and never reveal a mint address or a create signature before its create lands.
- Never edit or delete `PayoutRound`, `PayoutItem`, `VaultClaim`, `FeeAllocation`, `SwapBatch`, `Credit`, `PayoutTransfer`, `Claim` or `Trade` rows by hand, never move an `IndexerCursor`, and never send tokens by hand. Every engine step is idempotent and resumes on its own; a hand edit breaks the ledger.
- Every transaction that gets signed is logged with its purpose and signature (the `SignedTx` table, plus the ops log for anything done by hand).

---

## Quick reference

| What | Where |
|---|---|
| Web | PM2 `divvy-web` (user `divvy-web`), cluster ×2, `127.0.0.1:3000` |
| API | PM2 `divvy-api` (user `divvy-api`), cluster ×1, `127.0.0.1:4000`, WebSocket `/api/live`. Live mode, no keys. |
| Worker | PM2 `divvy-worker` (user `divvy-worker`), fork ×1, **never more than one**. Jobs, in UTC (`apps/worker/src/index.ts`): payouts every 10 minutes (`*/10 * * * *`: each tick first finishes every unfinished earlier hour, then runs the current hour, which minute 0 starts); the mid-hour presnapshot check, the launch, claim and transfer reconcilers, prices, hot-wallet status and market stats every minute; reserved tickers `17 3 * * *`. The indexer polls every `INDEXER_POLL_MS` (4 s) and also wakes on PlatformConfig logs. On SIGINT or SIGTERM it stops taking jobs, scheduled or queued, and waits up to 120 s for running ones; PM2 kills it at 130 s (`kill_timeout`). |
| PM2 | One daemon per app user, brought back at boot by `pm2-divvy-web`, `pm2-divvy-api` and `pm2-divvy-worker` (systemd). Always pass `--only <app>` with the process file. |
| Admin | `https://divvy.example/admin`, signed in with a wallet listed in `ADMIN_WALLETS`, or the admin API with curl ("Admin API") |
| Process file | `/srv/divvy/current/deploy/ecosystem.config.cjs` |
| Code | `/srv/divvy/releases/<UTC stamp>-<sha>/`, owned by `divvy` and read-only for the apps (except `apps/web/.next/cache`, owned by `divvy-web`), with `/srv/divvy/current` pointing at the live one. Git mirror at `/srv/divvy/repo.git`. |
| Config and secrets | `/etc/divvy/web.env`, `api.env` and `worker.env` (600, each owned by its app's user), `build.env` (600, `divvy`, `NEXT_PUBLIC_*` only), `backup.env` (600, `divvy-backup`). Keypairs in `/etc/divvy/keys/*.json` (400, `divvy-worker`; the folder is 700), public keys in `/etc/divvy/keys/pubkeys.txt`. Only `worker.env` names keypair files. |
| Media | `/var/lib/divvy/media` (`STORAGE_DIR`; 2770, group `divvy-media`): the API writes pictures under `img/`, the worker writes token metadata under `meta/`, and the API serves both at `/api/media/files/`. Or an S3 bucket. Not in the database backups. |
| App logs | `/var/log/divvy/web/web.{out,err}.log`, `/var/log/divvy/api/api.{out,err}.log`, `/var/log/divvy/worker/worker.{out,err}.log` (the worker writes one JSON object per line), `/var/log/divvy/backup/backup.log`. The `adm` group can read them. |
| Nginx | `/etc/nginx/sites-available/divvy.conf`, logs `/var/log/nginx/divvy.{access,error}.log`. Rate limits per client IP: pages 20 r/s (burst 120; `/_next/static/` unlimited), `/api/` 20 r/s (burst 60), uploads 10 a minute, `POST /api/launch` 4 a minute. Over the limit answers HTTP 429 `RATE_LIMITED`. Any `/api` spelling other than lowercase `/api/...` answers 404. |
| PostgreSQL 16 | `127.0.0.1:5432`, database `divvy`, role `divvy` (password in `/home/divvy-backup/.pgpass`) |
| Redis 7 | `127.0.0.1:6379`, password in `REDIS_URL`. Keys: `divvy:lock:<job>` (job locks), `divvy:alert:<key>` (alert throttle), `divvy:prices` (1 h TTL), `divvy:status` (10 min TTL), `divvy:presnap:<round hour>:<coinId>`, `divvy:presnap-minute:<round hour>` and `divvy:presnap-done:<round hour>` (mid-hour snapshot, secret), `divvy:swap-spend:<payout hour>` and `divvy:push-usd:<UTC hour>` (spend caps), `divvy:swap-limit:<live|dry>:<assetId>` (largest swap per asset), `divvy:push-blocked-at:<assetId>` (push blocklist, a hash of wallet and time), `divvy:claim-backoff:<wallet>:<assetId>`, `divvy:launcher-spend:<UTC hour>`, `divvy:launch-cooldown:<wallet>`, `divvy:launch-lock:<wallet>`, `divvy:siws:<nonce>`, `divvy:x-oauth:<state>`, `divvy-rl:*` (API rate limits), `bull:divvy-launch:*` and `bull:divvy-claims:*` (queues). Pub/sub channel `divvy:live`. |
| Backups | `/var/backups/divvy/` (owned by `divvy-backup`), cron 03:40 UTC running `/usr/local/bin/divvy-pg-backup` (an installed copy of `deploy/backup/pg-backup.sh`), 14 days local, offsite via `RCLONE_REMOTE` |
| Launch pause | The admin pause (`launchesOpen`), or the Nginx switch `/etc/nginx/divvy-launches-paused` (see "Pausing launches") |

Job locks and their TTLs: `payouts` 15 minutes, `presnapshot` and `reserved-tickers` 30 minutes, `launch:<launchId>` 10 minutes, and 55 seconds for the per-minute jobs `launch-reconcile`, `claims-reconcile`, `transfers-reconcile`, `market-stats`, `prices` and `status`. A running job renews its lock every third of its TTL, so a lock outlives its TTL only while its job is still running.

**Shell helpers.** Run everything from your admin shell (a sudo user in the `adm` group). Paste these first:

```bash
ECO=/srv/divvy/current/deploy/ecosystem.config.cjs
pm2as()     { local u="$1"; shift; sudo -iu "$u" pm2 "$@"; }                  # pm2as divvy-worker describe divvy-worker
pm2all()    { local u; for u in divvy-web divvy-api divvy-worker; do echo "== $u" >&2; pm2as "$u" "$@"; done; }   # pm2all ls
divvy_env() { sudo grep -E "^$2=" "/etc/divvy/$1.env" | tail -n 1 | cut -d= -f2-; }   # divvy_env worker SOLANA_RPC_URL
dbq()       { sudo -u divvy-backup -H psql -h 127.0.0.1 -U divvy -d divvy -X "$@"; }  # dbq -c 'select 1'
rcli()      { REDISCLI_AUTH="$(divvy_env worker REDIS_URL | sed -E 's#^redis://[^:]*:([^@]*)@.*#\1#')" redis-cli -h 127.0.0.1 "$@"; }
rpc()       { printf 'url = "%s"\n' "$(divvy_env worker SOLANA_RPC_URL)" |    # URL on stdin: the API key stays out of `ps`
              curl -fsS -m 10 -K - -H 'content-type: application/json' \
                -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}"; echo; }
admin()     { : "${DIVVY_SESSION:?run: read -rs DIVVY_SESSION}"                # see "Admin API"
              printf 'cookie = "divvy_session=%s"\n' "$DIVVY_SESSION" |       # cookie on stdin, not in `ps`
                curl -sS -m 30 -K - -X "$1" ${3:+-H 'content-type: application/json' --data-raw "$3"} \
                  -w '%{stderr}HTTP %{http_code}\n' "http://127.0.0.1:4000$2"; echo; }
envcheck()  { local k='^(DATABASE_URL|REDIS_URL|STORAGE_[A-Z_]+|PUBLIC_MEDIA_BASE|S3_[A-Z_]+|SOLANA_CLUSTER|DIVVY_PLATFORM_CONFIG|LAUNCHLAB_GLOBAL_CONFIG|DIVVY_MAINNET_ENABLED|FEE_[A-Z_]+|PAYOUT_DELIVERY|PAYOUTS_DRY_RUN|MIN_ROUND_USD|MIN_HOLDER_USD|AUTO_PUSH_MIN_USD|LATE_AFTER_SEC|MAX_SWAP_IMPACT_BPS|SWAP_SLIPPAGE_BPS|LAUNCHES_PER_[A-Z_]+|LAUNCH_COOLDOWN_SEC|LAUNCH_MIN_WALLET_LAMPORTS|LAUNCHER_HOURLY_CAP_LAMPORTS|BLOCKED_COUNTRIES|ADMIN_WALLETS)='
              diff <(sudo grep -E "$k" /etc/divvy/api.env | sort) <(sudo grep -E "$k" /etc/divvy/worker.env | sort) && echo "api.env and worker.env agree"; }
```

`pm2all jlist 2>/dev/null | jq -r '.[] | "\(.name) \(.pm2_env.status) restarts=\(.pm2_env.restart_time)"'` is the quickest health view. For the worker's own view, `rcli GET divvy:status | jq '{at: (.at / 1000 | todate), indexerSlot, indexerLagSec, wallets}'` (written every minute; empty when the status job has stopped for 10 minutes). `envcheck` prints the lines where `api.env` and `worker.env` disagree on a value both apps read.

---

## Deploy

CI must be green on the commit you deploy. Deploys are zero-downtime for web and API (PM2 cluster reload). The worker restarts, so time it:

- **Not while a payout run is in progress.** Ticks start at minutes 0, 10, 20, 30, 40 and 50 UTC, and the one at minute 0 does the most work (claim, swaps, snapshots, deliveries). Wait until the lock is free and the newest run has finished:
  ```bash
  rcli EXISTS divvy:lock:payouts                                                                     # 0
  grep -E '"msg":"payouts: (run|failed)"' /var/log/divvy/worker/worker.out.log | tail -1 | jq -r .t   # after the last tick
  ```
  On a restart the worker stops taking new jobs, scheduled or queued, and waits up to 120 seconds for running ones to finish. A run that takes longer is cut off when PM2 kills the worker at 130 seconds and leaves its lock behind for up to 15 minutes, so the next tick skips; a later tick resumes where the run stopped.
- **Not while a launch is sending.** `dbq -c "SELECT step, count(*) FROM \"Launch\" WHERE step IN ('checking', 'bundling') GROUP BY 1"` should print no rows. A launch cut off mid-send is recovered by the launch reconciler (see "Launch stuck in bundling"), but its user waits longer. In a busy period, pause launches first.
- **Not between 03:30 and 04:15 UTC.** The backup holds read locks, and a migration's `ALTER TABLE` would wait behind them while blocking every query that comes after it.

### 1. Build a new release (as divvy)

```bash
sudo -iu divvy
SHA=<full commit sha>                                  # the commit CI passed
git -C /srv/divvy/repo.git fetch --prune origin
git -C /srv/divvy/repo.git cat-file -e "$SHA^{commit}" && echo "commit found"
REL=/srv/divvy/releases/$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}
mkdir "$REL"
git -C /srv/divvy/repo.git archive "$SHA" | tar -x -C "$REL"
echo "$SHA" > "$REL/REVISION"
ln -s /etc/divvy/build.env "$REL/.env"                 # the build reads ../../.env: NEXT_PUBLIC_* only, no secrets
cd "$REL"
pnpm install --frozen-lockfile                         # also runs prisma generate
pnpm build                                             # NEXT_PUBLIC_* values are inlined here
echo "$REL"; exit
```

Back in your admin shell, give the web app its cache folder. Next.js writes it at run time; the rest of the release stays read-only for the apps.

```bash
REL=/srv/divvy/releases/<the folder printed above>
sudo mkdir -p "$REL/apps/web/.next/cache" && sudo chown -R divvy-web:divvy-web "$REL/apps/web/.next/cache"
```

### 2. Migrate (only if the release adds migrations)

```bash
diff <(ls -1 /srv/divvy/current/packages/db/prisma/migrations) <(ls -1 "$REL/packages/db/prisma/migrations")
# Any ">" line means new migrations. Back up first, then apply them with the API's database URL:
sudo -u divvy-backup -H /usr/local/bin/divvy-pg-backup
cd "$REL/packages/db" && sudo -u divvy-api -H node --env-file=/etc/divvy/api.env ./node_modules/prisma/build/index.js migrate deploy; cd
```

Migrate before the smoke test: the new release's queries need its new columns, and against the old schema its board fails with a 500 (2026-10-28, the dev buy's columns). Migrations must be **backward compatible** (expand, then contract). The old release keeps running against the new schema until the reload, also when the smoke test then fails, and a rollback never undoes a migration. Ship a column drop or rename in a later release, once no running code uses the old shape.

### 3. Smoke-test it on spare ports

This step is not optional. If a new instance fails to boot, `pm2 reload` still prints ✓: it waits `listen_timeout` (15 s), stops the healthy old instance anyway, and the new one crash-loops. That was tested with PM2 7.1.1. Boot the new build next to the old one first, each app as its own user with its own env file:

```bash
sudo -v                                                 # cache sudo, so the background starts don't wait for a password
cd "$REL/apps/api" && (sudo -u divvy-api -H env NODE_ENV=production API_PORT=4001 timeout 40 \
  node --env-file=/etc/divvy/api.env dist/server.js > /tmp/smoke-api.log 2>&1 &)
cd "$REL/apps/web" && (sudo -u divvy-web -H env NODE_ENV=production API_INTERNAL_URL=http://127.0.0.1:4001 timeout 35 \
  node --env-file=/etc/divvy/web.env node_modules/next/dist/bin/next start -p 3001 -H 127.0.0.1 > /tmp/smoke-web.log 2>&1 &)
sleep 12
curl -fsS http://127.0.0.1:4001/api/health | jq -e '.ok and .mode == "live"'   # true
curl -fsS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:3001/          # web 200
# The worker with no roles: it parses the env, checks the RPC's cluster, prints its settings and runs no jobs.
cd "$REL/apps/worker" && sudo -u divvy-worker -H env NODE_ENV=production WORKER_ROLES=none timeout 10 \
  node --env-file=/etc/divvy/worker.env dist/index.js > /tmp/smoke-worker.log 2>&1
grep '"msg":"worker started"' /tmp/smoke-worker.log || cat /tmp/smoke-worker.log
cd
```

The worker line must show `"roles":["none"]` and the `cluster`, `mainnetEnabled`, `payoutsDryRun` and `delivery` you expect. `/api/health` answers HTTP 200 even when it reports `"ok":false`, which is why the check reads the body.

Anything else: read `/tmp/smoke-api.log`, `/tmp/smoke-web.log` and `/tmp/smoke-worker.log` ("Worker or API won't start" lists the start checks), fix the problem, and don't go further. All three exit on their own (`timeout`) and serve no public traffic. The smoke API holds no keys and runs no jobs, and the worker with `WORKER_ROLES=none` starts nothing, so neither changes anything.

### 4. Switch and reload

```bash
sudo -u divvy ln -sfn "$REL" /srv/divvy/current.next && sudo -u divvy mv -Tf /srv/divvy/current.next /srv/divvy/current   # atomic
pm2as divvy-web reload "$ECO" --only divvy-web --update-env
pm2as divvy-api reload "$ECO" --only divvy-api --update-env
rcli EXISTS divvy:lock:payouts        # must print 0 before the next line (helpers above)
pm2as divvy-worker restart "$ECO" --only divvy-worker --update-env
pm2all reset all                      # zero the restart counters
```

PM2 cwds go through `/srv/divvy/current`, so each new process starts in the new release; the old releases stay intact. For a few seconds the two web instances serve different builds, so a browser can miss a JS chunk and reload. WebSocket clients are disconnected when the API instance swaps, and reconnect.

### 5. Verify, then save

```bash
sleep 30; pm2all ls                                     # all online, restarts still 0
curl -fsS http://127.0.0.1:4000/api/health | jq -c .   # "ok":true, "db":true, "redis":true
curl -fsS -o /dev/null -w '%{http_code}\n' https://divvy.example/
grep '"msg":"worker started"' /var/log/divvy/worker/worker.out.log | tail -1
cat /srv/divvy/current/REVISION
pm2all logs --lines 30 --nostream
pm2all save                                             # what systemd brings back after a reboot
```

If the restart counts climb or health fails, **roll back now** (next section) and debug afterwards.

### 6. Prune old releases (keep five)

The web cache folders belong to `divvy-web`, so this needs sudo:

```bash
cd /srv/divvy/releases && ls -1dt */ | tail -n +6 | while read -r d; do
  [ "$(readlink -f "$d")" = "$(readlink -f /srv/divvy/current)" ] || sudo rm -rf -- "/srv/divvy/releases/${d%/}"
done; cd
```

### Config-only changes

- **One app's settings:** `sudoedit` its file (`/etc/divvy/web.env`, `api.env` or `worker.env`), then reload or restart that app as in step 4 (no new release). The env file is read again on every process start.
- **Values both the API and the worker read:** the business block (`FEE_*`, `PAYOUT_DELIVERY`, `PAYOUTS_DRY_RUN`, `MIN_*`, `ADMIN_WALLETS` and the rest), the database, Redis, storage, `SOLANA_CLUSTER`, the PlatformConfig and the mainnet gate. Edit both `api.env` and `worker.env`, run `envcheck`, then reload the API and restart the worker together.
- **`NEXT_PUBLIC_*` values:** they live in `/etc/divvy/build.env` and are inlined at build time, so deploy the same SHA again (steps 1 to 5). A new browser RPC origin also has to go into the CSP in the Nginx site first.
- **Nginx:** edit `/etc/nginx/sites-available/divvy.conf`, then `sudo nginx -t && sudo systemctl reload nginx`. When `deploy/nginx/divvy.conf` changes in the repo, diff it against the installed copy and carry the changes over by hand. Keep `ws://localhost:*` in `connect-src` (the Android Mobile Wallet Adapter needs it) and don't add `upgrade-insecure-requests` (it would break that socket; HSTS keeps the site on HTTPS).
- **The backup script:** cron runs the installed copy `/usr/local/bin/divvy-pg-backup`. When `deploy/backup/pg-backup.sh` changes, diff the two, then install it again (`deploy/setup-vps.md` §11).

---

## Rollback

Every release in `/srv/divvy/releases` is fully built, so rolling back takes seconds:

```bash
ls -1dt /srv/divvy/releases/*/ | head -5; echo "current: $(readlink -f /srv/divvy/current)"
PREV=/srv/divvy/releases/<the release before>
sudo -u divvy ln -sfn "$PREV" /srv/divvy/current.next && sudo -u divvy mv -Tf /srv/divvy/current.next /srv/divvy/current
pm2as divvy-web reload "$ECO" --only divvy-web --update-env
pm2as divvy-api reload "$ECO" --only divvy-api --update-env
pm2as divvy-worker restart "$ECO" --only divvy-worker --update-env
pm2all save; cat /srv/divvy/current/REVISION
```

A release built before the per-app split ships a process file that reads `/etc/divvy/divvy.env`, which no longer exists. To roll back to one, set `ECO` to a newer release's `deploy/ecosystem.config.cjs` first.

**The database is not rolled back.** Expand/contract migrations keep the previous release working on the newer schema.

- **A migration failed halfway.** The migrate command errored, or the next one reports P3009, "failed migrations". Find the migration with `dbq -c 'SELECT migration_name, started_at, logs FROM _prisma_migrations WHERE finished_at IS NULL'`. Return the schema to its pre-migration state by hand, or finish the migration by hand. Then mark it with `cd "$REL/packages/db" && sudo -u divvy-api -H node --env-file=/etc/divvy/api.env ./node_modules/prisma/build/index.js migrate resolve --rolled-back <name>` (or `--applied <name>`), and deploy again.
- **A completed migration destroyed data.** Prefer a forward fix. Restoring the pre-deploy backup is the last resort, and it rewinds the ledger ([`pg-restore.md`](../deploy/backup/pg-restore.md), including step 5).

---

## Admin API

Admins are wallets listed in `ADMIN_WALLETS` (comma-separated, in `api.env` and, to keep `envcheck` clean, `worker.env`; the API reads it at start, so reload the API after changing it). The admin page at `https://divvy.example/admin` covers the daily work: the launch switch with a reason, hot-wallet balances, late rounds, indexer lag, and the report queue with hide, resolve and dismiss. Use the API with curl when the page can't do it (hiding a coin nobody reported) or from the server:

1. Sign in on the site with the admin wallet.
2. In the browser's developer tools (Application or Storage, then Cookies), copy the value of `divvy_session`. It's a sign-in for 7 days, with admin powers for the first 12 hours (after that, sign out and in again): never paste it into a chat, a ticket or a file.
3. On the server, paste the shell helpers, then run `read -rs DIVVY_SESSION` and paste the value (nothing is echoed). The `admin` helper passes it to curl on stdin, so it never shows up in `ps` or the shell history.
4. When you're done, `unset DIVVY_SESSION` and sign out on the site (that deletes the session).

| Call | What it does |
|---|---|
| `admin GET /api/admin/overview \| jq` | `launchesOpen`, `launchesPausedReason`, `wallets` (from `divvy:status`), `pendingLaunches`, `openReports`, `lateRounds` (last 24 h, dry-run rounds included), `indexerLagSec`, `mainnetEnabled`, `dryRun` |
| `admin POST /api/admin/settings '{"launchesOpen":false,"reason":"<shown on the create page, 200 characters at most>"}'` | Pauses launches ("Pausing launches"). `'{"launchesOpen":true}'` opens them again. |
| `admin POST /api/admin/coins/<mint>/hide '{"hidden":true,"reason":"<why>"}'` | Hides a coin: it leaves the board and its pages answer 404 (past payout receipts still list it). Trading on chain, indexing and payouts carry on. `'{"hidden":false}'` shows it again. |
| `admin GET /api/admin/reports \| jq -r '.items[] \| "\(.id) \(.coin.ticker) \(.coin.mint) \(.reason) \(.details)"'` | Open reports, newest first (up to 200) |
| `admin POST /api/admin/reports/<id> '{"status":"resolved"}'` | Closes a report. Also `"dismissed"`, or `"open"` to reopen it. |

A session that isn't an admin's gets HTTP 403 "Admins only"; an invalid body gets HTTP 400. Every change is written to `AdminAction`:

```bash
dbq -c "SELECT \"createdAt\", \"adminWallet\", action, target, payload FROM \"AdminAction\" ORDER BY \"createdAt\" DESC LIMIT 20"
```

---

## Alerts

The worker sends alerts to Telegram when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` are set in `worker.env`. Each message reads "Divvy: \<text\>" after a red (critical), orange (warning) or blue dot. The same alert is sent at most once per window (30 minutes unless the table says otherwise); the throttle key is `divvy:alert:<key>`, and deleting it re-arms the alert. Every alert is also logged, with or without Telegram:

```bash
grep '"msg":"alert: ' /var/log/divvy/worker/worker.out.log | tail -20 | jq -r '"\(.t) \(.severity) \(.key) \(.msg)"'
```

`alert: telegram refused` or `alert: telegram unreachable` in that output means the message didn't reach Telegram: check the token and chat ID.

### Payouts

| Alert text | What it means | What to do |
|---|---|---|
| Payouts stopped: on-chain fee rates {…} don't match the configured split {…} | Every payout run stops before the claim, dry-run included. The rates implied by `FEE_*` differ from LaunchLab's GlobalConfig (protocol rate) or Divvy's PlatformConfig on chain. Critical, hourly. | Compare the two objects. Don't change `FEE_*` or the PlatformConfig to make it pass: the split is the owner's call, and an on-chain change needs rules 2 and 3. Runs resume on the next tick once they match. |
| Payouts stopped: PlatformConfig.platform_fee_wallet is not the fee claimer key | `FEE_CLAIMER_KEYPAIR_PATH` loads a key that isn't the PlatformConfig's fee wallet. Critical, hourly. | Check the path against `pubkeys.txt`. After a key rotation, the PlatformConfig update has to land first ("Rotating a compromised hot wallet key", step 5). |
| Payouts stopped: no SOL price in the cache | `divvy:prices` is gone (1-hour TTL), so the prices job has been failing for about an hour. Critical, hourly. | "Prices missing". |
| The platform fee vault is empty, but indexed trades owe it \<n\> lamports since the last claim. Fees may not be reaching the vault (docs/AUDIT.md R2). | The shared platform vault is empty while the curve trades indexed since the last claim owe it at least 0.01 SOL. Dry-run included. This is how a no-go on audit check R2 shows up in production: the fees stay in each pool, and no holder would ever be paid. Critical, every 6 hours. | Stop and tell the owner. Don't go live, or go back to dry-run, until R2 has been checked (`docs/AUDIT.md`, R2). In live mode nothing is lost meanwhile: an empty claim covers no trades, so they stay in the next claim's range. |
| Vault claim \<sig\> didn't land; fees roll into the next claim | A live vault claim failed on chain, or had no status 5 minutes after it was signed. Its row is reset to cover no trades; the fees stay in the vault for the next claim. | Confirm with `rpc getSignatureStatuses '[["<sig>"], {"searchTransactionHistory": true}]'`. If it repeats, check the fee claimer's SOL and the RPC. |
| Indexer hasn't reached vault claim \<sig\>; payouts wait for it | A live claim landed, but the indexer hasn't reached its transaction, and attribution waited 3 minutes for it. Until it does, no new claim is made and no new rounds open; rounds already open carry on. Critical. | Fix the indexer ("Indexer lag above 60 seconds"). Every tick retries ("Vault claims and trade markers"). |
| Vault claim \<sig\> wasn't seen in the PlatformConfig stream; attributed by slot (trades in its own slot may shift by one claim) | The indexer moved past the claim's slot without matching its signature, so the claim was placed after the last indexed trade at or before its slot. | Nothing for a one-off. If it repeats, tell the owner. |
| \<n\> indexed trade(s) never finalized and were removed before attributing claim \<sig\> | Trades in the claim's range whose transactions are missing or failed at finality (a dropped fork) were deleted, so they take no share of the claim. Critical. | Tell the owner. Never re-insert trades by hand. |
| Vault claim \<sig\>: paid less than indexed fees | The claim brought in less than the indexed platform fees of its trades, so each coin's share was scaled down pro rata. Expected after a claim placed by slot; the rest arrives with the next claim. Live only in practice. | If it repeats or is large, look for a claim nobody recorded (a vault claim made outside the worker, or a `VaultClaim` row with no `attributedAt`) and tell the owner. |
| Vault claim \<sig\>: \<n\> lamports not tied to any trade | The claim brought in more than the indexed fees, by more than 1% of the claim or 0.01 SOL, whichever is larger. The surplus stays with Divvy and isn't paid to holders. Usually missed trades. Live only in practice. | Check the indexer (cursor, "Indexer stopped" alerts) and tell the owner. Never edit `FeeAllocation`. |
| \<SYMBOL\> swap for \<hour\> not done: \<reason\>. Holders' share carries to the next round. | The asset's swap batch is skipped (`SwapBatch.status = 'skipped'`), its rounds become `carried` with the reason in `error`, and the lamports go back to the pool for the next hour. Reasons: the token is paused by its issuer; the transfer hook is enabled (critical); no route; price impact over `MAX_SWAP_IMPACT_BPS`; the quote is off the reference price (critical, also sent when the price cache has no price for the asset); after either of those two, the asset's next swap is half the size ("Spend caps"); over the hourly swap cap (critical; a backstop, since rounds are already sized to the cap); `swap refused: …` (critical, "Swap guard"); the swap failed on chain. | Nothing, if it's one hour. If it repeats, check the asset's route on Jupiter and its price in `divvy:prices`. Don't raise `MAX_SWAP_IMPACT_BPS` or `SWAP_SLIPPAGE_BPS` without the owner. |
| Holders' money waiting for asset \<assetId\> (\<n\> lamports) is over this hour's swap budget (\<b\>); paying part now, the rest carries | The coins paying in that asset have more waiting than this hour's swap may take, so each gets a pro-rata part of the budget and the rest stays carried. Once per asset per hour. | Nothing if it clears within a few hours. If it comes back every hour, "Spend caps". |
| \<SYMBOL\> swap \<sig\> delivered \<n\>, below its minimum \<m\> | A live swap landed with less than Jupiter's minimum output. The rounds still go on with what arrived. Critical. | Tell the owner. Look at the transaction on an explorer. |
| Fee claimer holds less SOL than the holders' share it must swap | The fee claimer's balance is under the swap amount plus 0.02 SOL. The run stops at the swap (rounds stay `allocated`) and every tick retries. The claimed fees should be sitting in that wallet, so SOL has left it. Critical. | Compare its balance with the unswapped holders' share ("Hot wallet below threshold"). A drop you can't explain is a compromised key. Top-ups need the owner. |
| \<n\> payout round(s) for \<hour\> are late | Rounds not delivered by the hour + 60 minutes + `LATE_AFTER_SEC` (15 minutes) are marked `late` and show red. "(dry-run)" at the end means dry-run rounds. Critical. | "Payout round late or failed". |
| No \<SYMBOL\> price; deliveries for it wait | Live delivery can't apply its USD thresholds without the asset's price. Credits stay where they are. | "Prices missing". Deliveries resume once the price is back. |
| \<SYMBOL\> is paused by its issuer; deliveries wait (or: is using a transfer hook) | The asset's Token-2022 mint is paused or has a transfer hook. No pushes and no claims for it (claims answer that the asset is paused or can't be claimed). Credits stay. Critical. | Tell the owner and watch the issuer's notices. A transfer hook needs code support before payouts of that asset can go out. |
| Payout vault holds \<n\> lamports but its \<SYMBOL\> sends need \<m\> for account rent and fees; sends wait | The payout vault pays new holders' account rent and the network fees in SOL (repaid in stock, `PayoutTransfer."feeAmount"`), and it's running out. Sends of that asset wait; nothing is blocked. Critical, hourly. | Top up the payout vault from the fee claimer (the owner's OK, rule 3). Then check what uspad has kept: `dbq -c 'SELECT a.symbol, sum(t."feeAmount"), sum(t."rentLamports") FROM "PayoutTransfer" t JOIN "DividendAsset" a ON a.id = t."assetId" WHERE t.status = '"'"'confirmed'"'"' GROUP BY 1'`. |
| Payout vault holds \<n\> \<SYMBOL\> base units but owes \<m\> more on top of \<r\> in flight; sends stopped | The ledger owes more of that asset than the payout vault holds, counting pending transfers and claims. Pushes of that asset stop. Critical. | Stop and tell the owner. Run the credits check in "Switching dry-run to live". Never send tokens by hand or edit `Credit`. If it can't be explained, go back to dry-run. |
| Payout vault hourly send cap ($\<n\>) reached: \<k\> \<SYMBOL\> sends wait for the next hour | The sends that fit under `PUSH_HOURLY_CAP_USD` this UTC hour went out; these credits wait, and the count starts over at the next UTC hour. Critical. | "Spend caps". |
| Sending \<SYMBOL\> to \<wallet\> keeps failing; its credit waits and is retried once a day | A send to that wallet alone was refused or failed on chain, so the wallet is skipped for 24 hours. Once a day per wallet. | Usually nothing: the holder's token account is frozen or needs a memo. "Push blocklist". |
| Payout rounds for \<hour\> are still unfinished after a day; their coins get no new rounds until they finish (RUNBOOK "Stuck rounds") | Rounds of that hour still aren't `delivered` 24 hours later. Every tick still resumes them, but those coins' new fees wait. Critical, every 6 hours. | "Stuck rounds". |

### Launches, indexer and wallets

| Alert text | What it means | What to do |
|---|---|---|
| Launch create attempt failed (\<reason\>) | One create attempt didn't land: `bundle Invalid`, `bundle Failed` or `bundle timed out` on mainnet. The worker tries 3 times with the same mint. At most once per 15 minutes. | If it repeats, "Jito bundle failure rate high". |
| Launcher hourly spend cap reached; launches are being refused | This UTC hour's reserved launcher spend (an estimated 0.04 SOL plus `JITO_TIP_LAMPORTS` per launch) passed `LAUNCHER_HOURLY_CAP_LAMPORTS`. New launches fail with "Launches are busy right now". The count resets at the next UTC hour. | `rcli GET "divvy:launcher-spend:$(date -u +%Y-%m-%dT%H)"` shows the lamports reserved this hour. Real demand: raising the cap is the owner's call (change it in `api.env` and `worker.env`, then reload the API and restart the worker). Otherwise look for abuse and consider pausing launches. |
| A launch marked failed landed on chain anyway (coin \<id\>, \<sig\>); its trades are indexed but it needs a manual decision | The reconciler failed a launch whose create landed later. The coin row kept its mint and pool, so its trades are indexed, but it is `failed` and its ticker, picture and X account were released. Critical, once a day. | Tell the owner. Don't edit the rows. |
| Indexer is \<n\>s behind | The oldest PlatformConfig transaction the indexer hasn't processed has waited more than 60 seconds. Critical, every 15 minutes. | "Indexer lag above 60 seconds". |
| Indexer stopped on \<sig\>: \<error\>. Fee attribution is paused until this is fixed. | A transaction the decoder can't read. The cursor stops on purpose, because fees must be exact. Critical, hourly. | "Indexer lag above 60 seconds", the decoder case. |
| Indexer (\<name\>) is stuck: the RPC keeps returning no transaction for \<sig\> | `getTransaction` returned nothing 15 times in a row for one signature, and the cursor waits on it. Critical, hourly. | "RPC down". A different provider usually serves it. |
| \<TICKER\>: an account at the CPMM pool address doesn't look like LaunchLab's migration pool; waiting for the migration transaction | A graduating coin's expected CPMM pool address holds an account that fails the checks, so the coin isn't marked graduated from it. Once a day per coin. | If it doesn't clear once the migration transaction is indexed, tell the owner. |
| \<TICKER\>: CPMM pool corrected from \<a\> to \<b\> by migration \<sig\> | The migration transaction named a different pool than the one recorded; the transaction wins. | Nothing. |
| CPMM logs truncated in \<sig\>; a swap on \<TICKER\> may be missing from volume and candles | Volume and candles only. Fees after graduation come from claims, not from these logs. | Nothing unless it's frequent. |
| \<role\> hot wallet is low: \<x\> SOL | `launcher`, `payout_vault` or `fee_claimer` holds less than `HOT_WALLET_MIN_SOL` (0.5 SOL by default). Every 6 hours. | "Hot wallet below threshold". |
| Jupiter returned no SOL price; the previous cache stays until it expires | One prices run got no SOL price. The cache lasts an hour. | If it repeats, "Prices missing". |

Two alerts come from outside the worker:

- **The backup script:** "Divvy database backup failed on \<host\>: \<reason\>. Check /var/log/divvy/backup/backup.log." (only when `backup.env` has the Telegram values). Go to "Backup failed".
- **The external uptime check** on `https://divvy.example/api/health`. Go to "Web or API returns 502/504".

---

## Payouts: dry-run and going live

**What a run does.** Every 10 minutes the worker first finishes every earlier hour whose rounds aren't all `delivered` (oldest first, in the current mode; after a day it also alerts, "Stuck rounds"), then runs the current hour (`apps/worker/src/payouts/engine.ts`):

1. **Checks.** The on-chain fee rates and fee wallet must match the config (`Payouts stopped: …`), and the price cache must have a SOL price. A live run also passes the mainnet gate.
2. **Older claims.** Every vault claim not yet attributed is finished first, oldest first ("Vault claims and trade markers").
3. **Claim.** One vault claim per hour (`VaultClaim`, unique per hour and mode). Live: `claim_platform_fee_from_vault`, signed by the fee claimer; the row is written before the transaction is sent, so a crash can't lose a claim. Dry-run: nothing is signed. The claim is simulated as exactly the indexed fees since the previous dry-run claim, and the real vault balance is logged next to it (`payouts: dry-run vault claim`).
4. **Attribution.** The claim covers the curve trades between the previous claim's marker and its own (`fromTradeId < Trade.id <= toTradeId`). Their `platformFee` is split per coin into `FeeAllocation` rows (holders' and Divvy's buckets). A live claim waits for the indexer to place it, and only finalized trades count.
4b. **Graduated coins** (`apps/worker/src/payouts/poolfees.ts`). Everything a graduated coin earns goes to the fee claimer first and is split 50 : 15 : 10 between holders, creator and uspad (owner decision of 2026-10-26):
   - **CPMM creator fee** (live, `CPMM_CREATOR_FEES=true`; needs `platform_cp_creator` = fee claimer).
   - **Locked-LP fees.** The worker finds each coin's Fee Key once (`Coin."feeKeyMint"`; alert "no Fee Key" if the fee claimer holds none an hour after graduation). The claimable amount comes from Raydium's API, and every amount is simulated before signing. While `LOCKED_LP_FEES=false`, or in dry-run, it only simulates and logs `payouts: locked-LP fees (simulated, nothing signed)`.
   - **Memecoin sales** (live, when either of the two above is on). The memecoin part of those fees is sold for SOL in the coin's own pool: at most 1% of the pool's coin reserve per run, with a minimum out from the reserves minus `SWAP_SLIPPAGE_BPS`.
   - A failure here (Raydium's API, an RPC error) alerts for that coin and doesn't hold up the rest of the run.
5. **Rounds.** Per coin, a holders' bucket under `MIN_ROUND_USD` becomes a `carried` round and stays in the pool. Otherwise a `PayoutRound` opens at step `allocated` (unique per coin, hour and mode). A coin whose earlier round isn't `delivered` yet gets no new round: its money waits in the pool. Each dividend asset has a swap budget for the hour; a coin's bucket over its share is paid in part and the rest stays in the pool ("Spend caps").
6. **Swaps.** One Jupiter swap per dividend asset (`SwapBatch`), shared pro rata between its rounds. Dry-run takes the quote. A live swap passes the hourly cap and the swap guard, and on mainnet goes out as a Jito bundle. A refused swap carries the bucket to the next hour (see the swap alert).
7. **Snapshot.** Holders are read from the chain (Helius DAS, falling back to `getProgramAccounts`) and each balance is capped by the mid-hour presnapshot ("Mid-hour presnapshot"). Excluded wallets and holders under `MIN_HOLDER_USD` are left out (`HolderBalance."excludedReason"`), and entitlements are written as `PayoutItem` rows. Live rounds also add to each wallet's `Credit`.
8. **Delivery** (live only). Each send keeps `DELIVERY_FEE_USD` of the credit, plus the new account's rent when it creates one (owner decision 2026-10-27); the holder gets the rest. Credits move out of the payout vault in batches of `PUSH_BATCH_SIZE`, up to the hourly send cap (the rest waits for the next hour), skipping wallets on the push blocklist. A credit is debited in the same database transaction that records the `PayoutTransfer`, before sending; the transfer reconciler confirms it, or gives the credit back once its blockhash has expired. Both models send to wallets that already hold the asset's token account once the credit passes `AUTO_PUSH_MIN_USD`. Push also creates the account for the others once their credit passes `PUSH_NEW_ATA_MIN_USD`; under claim, they claim from their page and pay their own account rent.
9. **Finish.** Rounds become `delivered`, with status `late` past the deadline.
10. **Creators' shares** (live only). Once a coin's creator is owed at least `CREATOR_FORWARD_MIN_LAMPORTS` from post-graduation fees, the fee claimer sends it in SOL (`CreatorTransfer`, purpose `fees.forward_creator`). The row is written at signing; one a crash left unconfirmed is kept if it landed and undone (owed again) if it never did.

Earlier hours run in resume-only mode: steps 1, 2 and 6 to 9, with no new claim and no new rounds, since new money always goes to the current hour. A failure there is logged as `payouts: resume failed`, and the tick goes on to the current hour.

Dry-run still loads the fee claimer and payout vault keys: the first to check the PlatformConfig fee wallet, the second to quote swaps into its token account. It never signs with them.

### Vault claims and trade markers

Each claim covers a range of indexed trades, not slots. Its start is the previous claim's marker; its end (`VaultClaim."toTradeId"`) is set like this:

- **Dry-run:** the highest `Trade.id` when the claim is made.
- **Live:** when the indexer reaches the claim's own transaction in the PlatformConfig stream, it sets the marker to the highest trade id indexed so far (`markClaim` in `apps/worker/src/indexer.ts`). Every trade before it was swept by that claim; trades after it, even in the same slot, belong to the next claim. A claim whose transaction failed on chain swept nothing and gets no marker.
- **Fallback:** if the indexer has moved past the claim's slot without matching the signature, attribution places the claim after the last trade at or before its slot, and alerts "attributed by slot".

Attribution then waits up to 60 seconds for the claim's slot to be finalized and checks every fee-paying trade in the range. Trades not finalized yet stop the tick ("some trades in the claim aren't finalized yet; retrying later"); trades whose transactions are missing or failed are deleted, with a critical alert.

**Claims go in order.** Older claims are attributed first, and a claim waiting for its marker holds every later one. No new claim is made while the newest one has no marker ("previous vault claim isn't placed in the trade stream yet"). So one live claim the indexer can't reach stops new claims and new rounds for every coin; rounds already open still swap, snapshot and deliver.

**After a crash.** A live claim row with no amount and no marker is checked against the chain on the next tick: landed means its amount and slot are filled in (the indexer still sets the marker); failed, or no status 5 minutes after signing, means the row is reset to cover no trades and the fees roll into the next claim's range ("Vault claim \<sig\> didn't land"); otherwise the tick waits ("vault claim \<sig\> still pending; retrying later").

```bash
dbq -c "SELECT hour, \"dryRun\", sig, lamports, \"fromTradeId\", \"toTradeId\", \"toSlot\", \"attributedAt\", \"createdAt\"
        FROM \"VaultClaim\" WHERE \"attributedAt\" IS NULL ORDER BY \"createdAt\""
dbq -c "SELECT \"lastSlot\", \"updatedAt\" FROM \"IndexerCursor\" WHERE name = 'platform'"
```

An unattributed live row with an empty `toTradeId` and a `toSlot` above the cursor's `lastSlot` is waiting for the indexer: "Indexer lag above 60 seconds". Never set a marker by hand.

### Mid-hour presnapshot

Once an hour, at a random minute between :05 and :54, the worker records the balances of every coin that may pay at the next hour: coins traded in the last 2 hours, or with fees waiting for a round (`apps/worker/src/payouts/presnapshot.ts`). The round then pays each wallet on the smaller of that balance and its balance at the round snapshot, so a wallet has to hold across both moments. A wallet missing from the presnapshot gets nothing from that round.

- Redis: the minute in `divvy:presnap-minute:<round hour>`, a done flag in `divvy:presnap-done:<round hour>`, and the balances in the hash `divvy:presnap:<round hour>:<coinId>`, deleted once the round has its own snapshot or is carried, and kept 26 hours at most. `<round hour>` is the ISO time of the next full hour, for example `2026-10-26T15:00:00.000Z`.
- **The minute is secret.** Anyone who knows it can time a buy. Never post it or these keys' contents.
- Logs: `presnapshot: taken` with the round hour and the number of coins, once an hour; `presnapshot: failed` with a coin and the error.
- A coin without a presnapshot (it failed, Redis lost it, or the worker was down at that minute) is paid on its round snapshot alone. So is a round resumed more than a day after its hour, once the hash has expired.

```bash
grep -E '"msg":"presnapshot: (taken|failed)"' /var/log/divvy/worker/worker.out.log | tail -5 | jq -c '{t, msg, roundHour, coins, coinId, error}'
rcli EXISTS "divvy:presnap-done:$(date -u -d '+1 hour' +%Y-%m-%dT%H:00:00.000Z)"    # 1 once this hour's presnapshot has run
```

If `presnapshot: taken` is missing for an hour, that hour's rounds pay on the round snapshot only. Check the RPC ("RPC down") and tell the owner if it repeats. There is no command to take one by hand.

### Spend caps

Hourly limits bound what the hot wallets can move (HANDOFF §9). The swap budget shapes dry-run rounds too (dry-run keeps its own size limits), so dry-run shows what live would do; the send cap and the swap backstop count live sends only. Raising any of them is the owner's call (rule 3).

**Swaps.** When rounds open (step 5), each dividend asset gets a budget for the hour, the smaller of two amounts: its size limit less what this hour's rounds of that asset already hold, and what's left of `SWAP_HOURLY_CAP_LAMPORTS` (100 SOL) after every round opened this hour.

- If the coins paying in that asset have more waiting than the budget, each gets a pro-rata part ("Holders' money waiting for asset … is over this hour's swap budget", a warning). The oldest money goes first, and the `FeeAllocation` row that crosses the line is split: the part that fits funds the round, and the rest becomes a new row with no `vaultClaimId` and `lamports` 0 that stays in the pool. Those rows are carried money, not errors. A part under `MIN_ROUND_USD` makes the whole bucket a `carried` round.
- **Size limit.** `SWAP_BATCH_MAX_LAMPORTS` (20 SOL) per asset per hour. After a swap is refused for price impact or a quote off the reference price, the asset's limit becomes half that swap's size (at least 0.01 SOL), kept in `divvy:swap-limit:<live|dry>:<assetId>` for 7 days. Each good swap grows it by half again, up to the maximum, and then the key is deleted.
- At swap time, `divvy:swap-spend:<payout hour>` still counts every live swap against `SWAP_HOURLY_CAP_LAMPORTS` as a backstop ("…not done: over the hourly swap cap…").

**Sends.** Each tick sends the credits that fit under what's left of `PUSH_HOURLY_CAP_USD` ($25,000) this UTC hour, largest first, and the rest wait for the next hour ("Payout vault hourly send cap … reached: \<k\> … sends wait", critical). The count is `divvy:push-usd:<YYYY-MM-DDTHH>`. A single credit worth more than the whole cap never goes: raising the cap is the only way it moves.

**Launches.** `LAUNCHER_HOURLY_CAP_LAMPORTS` (3 SOL) for the launcher's creates and tips, counted in `divvy:launcher-spend:<YYYY-MM-DDTHH>`. New launches are refused until the next UTC hour (see the launcher alert).

```bash
rcli GET "divvy:swap-spend:$(date -u +%Y-%m-%dT%H):00:00.000Z"   # lamports reserved for this hour's swaps
rcli GET "divvy:push-usd:$(date -u +%Y-%m-%dT%H)"                  # USD sent or reserved this UTC hour
dbq -c "SELECT id, symbol FROM \"DividendAsset\" ORDER BY symbol"
rcli GET divvy:swap-limit:live:<assetId>; rcli TTL divvy:swap-limit:live:<assetId>   # empty: the full SWAP_BATCH_MAX_LAMPORTS
dbq -c "SELECT c.ticker, sum(f.\"holdersLamports\") AS waiting FROM \"FeeAllocation\" f JOIN \"Coin\" c ON c.id = f.\"coinId\"
        WHERE f.\"roundId\" IS NULL AND NOT f.\"dryRun\" GROUP BY 1 ORDER BY 2 DESC LIMIT 20"
```

A budget or send-cap alert that clears within a few hours is a busy period. One that comes back every hour means the cap or limit is below the real volume, for example on the first live run or after a pause, and the backlog only shrinks by one budget an hour. If trading doesn't explain the volume, stop and tell the owner before anything else. Otherwise, with the owner's approval, set the new value in `worker.env` and restart the worker (Deploy step 4, minding the payout lock). After the price-impact cause is gone (a pool refilled, a bad route fixed), `rcli DEL divvy:swap-limit:live:<assetId>` puts the asset back at its full size; repeated impact refusals mean the asset can't absorb that much per hour, so leave the limit to adapt.

### Swap guard

The fee claimer signs swap transactions that Jupiter's API builds, so every live swap is checked before signing (`apps/worker/src/payouts/swapguard.ts` and `chain.ts`). The transaction that gets signed is checked, not the earlier quote:

- **Amounts.** The same input and output mints and the same amount as asked, price impact within `MAX_SWAP_IMPACT_BPS`, and a minimum output at or above the reference floor (the reference price less the impact cap).
- **Instruction allowlist.** Compute budget; Jupiter's program; a System transfer only into the fee claimer's own WSOL account; token `SyncNative`, and `CloseAccount` only back to the fee claimer; associated token accounts created only for the fee claimer or the payout vault. No signer other than the fee claimer. Anything else is refused.
- **Simulation.** The fee claimer may spend at most the swap amount plus 0.03 SOL (plus the tip), and the payout vault must receive at least the minimum output.
- **Sending.** On mainnet the signed swap goes out only as a Jito bundle (with a `JITO_TIP_LAMPORTS` tip), never through the RPC, so it can't be sandwiched. Devnet uses the RPC. A swap whose outcome is unknown stays `sent`; the next tick asks the chain, and after 5 minutes without a landed transaction it's built again.

A refusal signs nothing: the batch is skipped, its rounds are carried, and a critical alert reads "\<SYMBOL\> swap for \<hour\> not done: swap refused: \<reason\>". A one-off `simulation failed` is usually liquidity: wait. "unexpected program", "a System instruction other than wrapping SOL", "an associated token account for someone else", "an instruction needs another signer" or "Jupiter built a swap for other mints" can mean a tampered API response: tell the owner, check `JUP_BASE_URL` and the server's DNS and outbound traffic. Never widen the allowlist without a reviewed code change (rule 2).

### Push blocklist

When a send to one wallet alone fails (refused by the preflight simulation, or failed on chain, for example a frozen token account or one that requires a memo), the wallet goes into the Redis hash `divvy:push-blocked-at:<assetId>` with the time. A failing batch is first retried one wallet at a time, so one bad recipient doesn't hold up the others. Delivery skips the wallet for 24 hours, then tries again; a refused send costs nothing, because preflight refuses it before it's broadcast. Its credit stays in `Credit` meanwhile, and under claim the holder can still claim. A warning ("Sending \<SYMBOL\> to \<wallet\> keeps failing…") goes out once a day per wallet.

```bash
dbq -c "SELECT id, symbol FROM \"DividendAsset\" ORDER BY symbol"
rcli HGETALL divvy:push-blocked-at:<assetId>      # wallet, then the time it was blocked (ms since 1970)
grep '"msg":"deliver: send refused"' /var/log/divvy/worker/worker.out.log | tail -5 | jq -c '{t, sig, error}'
rcli HDEL divvy:push-blocked-at:<assetId> <wallet>  # retry on the next tick, once the cause is gone
```

### Holder claims (claim model)

The API queues each claim and the worker builds it (`apps/worker/src/claims.ts`): the payout vault pays the network fee and signs a transfer of the holder's whole credit, and the holder signs and sends it. The worker refuses with:

- "Payouts are sent automatically; there's nothing to claim" under push;
- "Claims aren't open yet" in dry-run, and on mainnet while the gate is off;
- "Your last claim failed. Try again in an hour." for one hour after that wallet's claim of that asset failed on chain (`divvy:claim-backoff:<wallet>:<assetId>`), because the vault pays every attempt's fee;
- "You have a claim waiting…" while one is pending;
- "There's nothing to claim yet";
- "\<SYMBOL\> claims are paused while its price updates…" (`NO_PRICE`) while the price cache has no price for the asset ("Prices missing");
- "You can claim once it's worth $\<n\>" below `AUTO_PUSH_MIN_USD`;
- a paused asset, or one with a transfer hook.

A built claim reserves the whole credit until the transaction confirms, or until the chain is 150 blocks past its `lastValidBlockHeight`, when the credit comes back. To lift a backoff early, once the holder has fixed the cause: `rcli DEL divvy:claim-backoff:<wallet>:<assetId>`.

### First dry-run hours: what to check

Do this from your admin shell, with the helpers pasted. These checks should pass for every hour of the dry-run period before you ask the owner to go live.

1. **The worker runs dry-run with every role, and the presnapshot runs every hour.**
   ```bash
   grep '"msg":"worker started"' /var/log/divvy/worker/worker.out.log | tail -1
   grep -E '"msg":"payouts: (run|failed)"' /var/log/divvy/worker/worker.out.log | tail -6 | jq -c '{t, msg, hour, dryRun, claimedLamports, rounds, error}'
   grep -c '"msg":"presnapshot: taken"' /var/log/divvy/worker/worker.out.log
   ```
   Expect `"payoutsDryRun":true`, all seven roles, a `payouts: run` line every 10 minutes with `"dryRun":true`, and one `presnapshot: taken` per hour.
2. **The simulated claims add up to the real vault.** Each hour logs the real vault balance next to the simulated claim:
   ```bash
   grep '"msg":"payouts: dry-run vault claim"' /var/log/divvy/worker/worker.out.log | tail -6 | jq -c '{t, hour, toTradeId, indexed, vaultBalance}'
   dbq -c "SELECT hour, lamports, sum(lamports) OVER (ORDER BY hour) AS cumulative, \"unattributedLamports\", \"fromTradeId\", \"toTradeId\"
           FROM \"VaultClaim\" WHERE \"dryRun\" ORDER BY hour DESC LIMIT 6"
   ```
   A "The platform fee vault is empty…" alert here means stop: it's audit check R2 failing (see that alert). While nothing has ever claimed the vault, each hour's `cumulative` (every indexed platform fee so far) should match that hour's `vaultBalance`, give or take the trades that landed between the trade read and the balance read. Those show up in the next hour. A gap that grows hour after hour means fees reach the vault that the indexer doesn't see: tell the owner before going live. `vaultBalance` of `-1` means the balance read failed.
3. **`unattributedLamports`.** In dry-run it is 0 by construction (the simulated claim is the indexed fees), so step 2 is the real test. It becomes the number to watch in live mode.
4. **Rounds finish on time and look right.**
   ```bash
   dbq -c "SELECT r.hour, c.ticker, r.status, r.step, r.\"solIn\", r.\"carriedInLamports\", r.\"carriedOutLamports\", r.\"assetOut\", r.\"dustCarried\", r.\"holdersPaid\", r.error
           FROM \"PayoutRound\" r JOIN \"Coin\" c ON c.id = r.\"coinId\"
           WHERE r.\"dryRun\" AND r.hour >= date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '3 hours'
           ORDER BY r.hour DESC, c.ticker"
   dbq -c "SELECT b.hour, a.symbol, b.status, b.\"lamportsIn\", b.\"assetOut\", b.\"minOut\", b.\"priceImpactBps\", b.error
           FROM \"SwapBatch\" b JOIN \"DividendAsset\" a ON a.id = b.\"assetId\"
           WHERE b.\"dryRun\" AND b.hour >= date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '3 hours' ORDER BY b.hour DESC"
   ```
   Every round of an hour should be `delivered` by a quarter past the next hour, with status `ok` or `carried`. `ok` rounds have `holdersPaid` above 0. `carried` rounds hold their lamports in `carriedOutLamports` (and their reason in `error` if a swap was refused). Check the quoted `assetOut` against `lamportsIn` and the prices in `divvy:prices`.
5. **Entitlements add up.** Per round, the `PayoutItem` amounts equal `assetOut` plus the dust carried in from the coin's previous round, minus this round's `dustCarried` (a few base units):
   ```bash
   dbq -c "SELECT r.hour, c.ticker, r.\"assetOut\", sum(i.\"amountAsset\") AS entitled, r.\"dustCarried\", count(i.id) AS wallets
           FROM \"PayoutRound\" r JOIN \"Coin\" c ON c.id = r.\"coinId\" JOIN \"PayoutItem\" i ON i.\"roundId\" = r.id
           WHERE r.\"dryRun\" AND r.hour >= date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '3 hours'
           GROUP BY r.id, r.hour, c.ticker, r.\"assetOut\", r.\"dustCarried\" ORDER BY r.hour DESC"
   dbq -c "SELECT c.ticker, h.\"excludedReason\", count(*) FROM \"HolderBalance\" h JOIN \"Coin\" c ON c.id = h.\"coinId\"
           WHERE h.\"snapshotHour\" = date_trunc('hour', now() AT TIME ZONE 'UTC') GROUP BY 1, 2 ORDER BY 1, 2"
   ```
   The excluded rows should be the curve's vault (`curve`), a graduated coin's pool (`pool`), and any Divvy wallet (`launcher`, `divvy`) or burn address (`burn`) that holds the coin, plus `small` for holders under `MIN_HOLDER_USD`. An empty `excludedReason` is an eligible holder.
6. **No critical alerts** ("Alerts").

### Switching dry-run to live

**Before you start:**

- The owner has approved this switch in chat (rule 3).
- On mainnet, `DIVVY_MAINNET_ENABLED=true` is already set, which itself needs `docs/MAINNET_CHECKLIST.md` complete and signed off by the owner. Without it the live run stops with `payouts: failed` ("Refusing to send "payouts" on mainnet").
- The dry-run checks above pass, and there are no `Payouts stopped` alerts.
- The fee claimer holds SOL for its transaction fees (and, on mainnet, the Jito tip per swap), and each swap needs 0.02 SOL of headroom over its amount (the claimed fees fund the swaps themselves). The payout vault holds SOL for its transaction fees and, under push, for new holders' token accounts. Funding needs the owner's approval.
- The delivery model in `PAYOUT_DELIVERY` is the one the owner chose (HANDOFF §3.4), and `SWAP_HOURLY_CAP_LAMPORTS`, `SWAP_BATCH_MAX_LAMPORTS` and `PUSH_HOURLY_CAP_USD` are the values the owner set.
- **The owner knows the size of the first round.** Live claims start from trade 0 (no live claim exists yet), and nothing has claimed the vault during dry-run. So the first live run sweeps everything the vault has collected since launch, and its rounds pay the holders' share of all of it to whoever holds at that snapshot. The amount is the latest `vaultBalance` in step 2 above. A holders' share bigger than the swap budget is paid over several hours, at most one budget per asset per hour; the rest stays carried until then ("Spend caps").

**Steps.** Do this between minutes 20 and 50 of an hour, so the switch doesn't meet the minute-0 run.

1. `sudoedit /etc/divvy/api.env /etc/divvy/worker.env` and set `PAYOUTS_DRY_RUN=false` in both. Run `envcheck`.
2. Check the new settings, then reload and restart:
   ```bash
   rcli EXISTS divvy:lock:payouts                         # 0
   cd /srv/divvy/current/apps/worker && sudo -u divvy-worker -H env NODE_ENV=production WORKER_ROLES=none timeout 10 \
     node --env-file=/etc/divvy/worker.env dist/index.js 2>&1 | grep '"worker started"'; cd
   #   expect "payoutsDryRun":false and, on mainnet, "mainnetEnabled":true
   pm2as divvy-api reload "$ECO" --only divvy-api --update-env
   pm2as divvy-worker restart "$ECO" --only divvy-worker --update-env
   ```

The next tick runs the current hour live. Then check:

```bash
grep -E '"msg":"payouts: (run|failed)"' /var/log/divvy/worker/worker.out.log | tail -1 | jq -c .     # "dryRun":false
dbq -c "SELECT purpose, signer, signature, \"createdAt\" FROM \"SignedTx\"
        WHERE \"createdAt\" > (now() AT TIME ZONE 'UTC') - interval '2 hours' ORDER BY \"createdAt\""
dbq -c "SELECT hour, sig, lamports, \"unattributedLamports\", \"fromTradeId\", \"toTradeId\", \"toSlot\", \"attributedAt\"
        FROM \"VaultClaim\" WHERE NOT \"dryRun\" ORDER BY hour DESC LIMIT 3"
dbq -c "SELECT r.hour, c.ticker, r.status, r.step, r.\"solIn\", r.\"assetOut\", r.\"holdersPaid\", r.\"swapSig\", r.error
        FROM \"PayoutRound\" r JOIN \"Coin\" c ON c.id = r.\"coinId\" WHERE NOT r.\"dryRun\" ORDER BY r.hour DESC, c.ticker LIMIT 30"
dbq -c "SELECT status, count(*), count(DISTINCT sig) AS transactions FROM \"PayoutTransfer\" GROUP BY 1"
```

- `SignedTx` shows `fees.claim_platform` and `payout.swap` (signer `fee_claimer`), then `payout.send` (signer `payout_vault`) once credits pass their thresholds. Write the signatures in the ops log.
- The first live `VaultClaim` has `fromTradeId` 0, a `toTradeId` set by the indexer, and `lamports` close to the last dry-run `vaultBalance`. `unattributedLamports` stays small; anything over the tolerance raises an alert.
- **Credits are covered by the vault.** For each asset, the payout vault's token balance must be at least the credits plus the pending transfers and claims (the small excess is flooring dust and swapped output not yet snapshotted):
  ```bash
  dbq -c "SELECT a.symbol, a.mint,
            (SELECT coalesce(sum(amount), 0) FROM \"Credit\" WHERE \"assetId\" = a.id) AS credits,
            (SELECT coalesce(sum(amount), 0) FROM \"PayoutTransfer\" WHERE \"assetId\" = a.id AND status = 'pending') AS pending_transfers,
            (SELECT coalesce(sum(amount), 0) FROM \"Claim\" WHERE \"assetId\" = a.id AND status = 'pending') AS pending_claims
          FROM \"DividendAsset\" a ORDER BY a.symbol"
  rpc getTokenAccountsByOwner '["<payout vault pubkey>", {"mint": "<asset mint>"}, {"encoding": "jsonParsed"}]' \
    | jq -r '.result.value[].account.data.parsed.info.tokenAmount.amount'
  ```

### Switching between push and claim

`PAYOUT_DELIVERY` is the owner's decision (HANDOFF §3.4). The API and the worker both read it, and the site's copy follows it through `/api/config`: "paid" under push, "credited" under claim.

1. Wait for a free payout lock, as above.
2. Set `PAYOUT_DELIVERY=claim` (or `push`) in both `api.env` and `worker.env` and run `envcheck`. Then reload the API and restart the worker (Deploy step 4). Do both together: while they disagree, claim requests are refused by one side or the other.
3. Check `curl -fsS http://127.0.0.1:4000/api/config | jq .payouts.delivery` and the `"delivery"` field in the new `worker started` line.

Credits carry over in `Credit` either way. Transfers and claims already pending settle on their own: the transfer reconciler runs with the `payouts` role and the claim reconciler with the `claims` role, whatever the mode.

### Back to dry-run

Set `PAYOUTS_DRY_RUN=true` in both `api.env` and `worker.env`, then reload the API and restart the worker (Deploy step 4). From the next tick:

- No vault claims, swaps or pushes. Live rounds that aren't `delivered` stop where they are, and resume when live mode is back (with the "still unfinished after a day" alert if that's more than 24 hours later).
- Holder claims are refused ("Claims aren't open yet"); credits stay in `Credit`.
- Pending `PayoutTransfer` and `Claim` rows still settle, because the reconcilers don't depend on the mode.

---

## Incident playbooks

Each playbook gives the signs, what to check, and the fix. Write every incident in the ops log: what happened, the times in UTC, what was done, and any signatures.

Besides the Telegram alerts ("Alerts"), an external uptime check watches `https://divvy.example/api/health`, and the backup script reports its own failures.

### Payout round late or failed

The SLA is a finished round within 60 minutes of the hour, plus `LATE_AFTER_SEC` (15 minutes) of grace. After that the round is `late`, shows red on the coin and global meters, and the owner is alerted (HANDOFF §3.3).

**Signs:** the alert "\<n\> payout round(s) for \<hour\> are late", a red meter, `lateRounds` above 0 on the admin page, or `payouts: failed` in the worker log.

**Check:**

1. Exactly one worker, and stable:
   ```bash
   pm2as divvy-worker describe divvy-worker | grep -E 'status|restarts|uptime'
   pgrep -af 'apps/worker/dist/index.js'                 # exactly one line
   ```
2. What the runs said:
   ```bash
   grep '"msg":"payouts' /var/log/divvy/worker/worker.out.log | tail -20 | jq -c '{t, msg, hour, dryRun, rounds, error, coinId, asset}'
   ```
   - `payouts: run` ends every successful tick, with the hour's counts.
   - `payouts: resuming an earlier hour` comes before it for each unfinished earlier hour, and `payouts: resume failed` carries the error that stopped one. The tick still goes on to the current hour.
   - `payouts: failed` carries the error that stopped the current hour.
   - `payouts: another worker holds the lock, skipping` means the lock is held (see Fix).
   - `payouts: snapshot failed, will retry` names a coin, and `payouts: swap not confirmed` an asset, that the next tick retries.
3. The lock:
   ```bash
   rcli GET divvy:lock:payouts; rcli PTTL divvy:lock:payouts   # PTTL in ms; -2 means no lock
   ```
4. Where the hour stopped:
   ```bash
   dbq -c "SELECT hour, \"dryRun\", sig, lamports, \"unattributedLamports\", \"fromTradeId\", \"toTradeId\", \"toSlot\", \"attributedAt\"
           FROM \"VaultClaim\" ORDER BY hour DESC, \"dryRun\" LIMIT 6"
   dbq -c "SELECT r.hour, r.\"dryRun\", r.status, r.step, count(*) FROM \"PayoutRound\" r
           WHERE r.hour >= date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '24 hours'
           GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 2"
   dbq -c "SELECT b.hour, a.symbol, b.\"dryRun\", b.status, b.\"lamportsIn\", b.sig, b.error, b.\"updatedAt\"
           FROM \"SwapBatch\" b JOIN \"DividendAsset\" a ON a.id = b.\"assetId\"
           WHERE b.hour >= date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '2 hours' ORDER BY b.hour DESC"
   ```

   | What you see | Where the run stops |
   |---|---|
   | No `VaultClaim` row for the hour | Before the claim: the rates check, no SOL price, the mainnet gate, an older claim not yet attributed ("Vault claims and trade markers"), or no tick ran at all (lock, Redis, worker). The error is in `payouts: failed`. |
   | `VaultClaim` without `attributedAt` | Attribution is waiting: for the indexer to set `toTradeId` ("Indexer lag above 60 seconds"), or for the claim's trades to finalize ("some trades in the claim aren't finalized yet; retrying later"). |
   | Rounds at `allocated` | The swap. `SwapBatch` `sent`: waiting for the swap's outcome. `pending`: the fee claimer is short, or the run failed before signing. |
   | Rounds at `swapped` | The holder snapshot: look for `payouts: snapshot failed, will retry` and check the RPC. |
   | Rounds at `snapshotted` | Live delivery failed before the finish step; the error is in `payouts: failed`. |

5. Usual causes, each with its own playbook: RPC down, Redis down (no lock means no tick), prices missing, the indexer behind a vault claim, the fee claimer short of SOL, or a Jupiter swap refused by the impact, quote, cap or guard checks. That last one carries the bucket by design; it doesn't make a round late.

**Fix:**

- **Stale lock.** A worker killed mid-run never releases `divvy:lock:payouts`. A running worker renews it every 5 minutes, so a live lock's `PTTL` stays between 600 000 and 900 000 ms. Well under 600 000 means nobody is renewing it: check there is exactly one worker (Check 1), then `rcli DEL divvy:lock:payouts`, or let it expire. The next tick runs normally.
- **Re-running.** There is no manual command. Every 10 minutes the worker resumes from the last completed step, for the current hour and every unfinished earlier hour. Fix the cause, and the next tick finishes the round (marked `late` if it's past the deadline). Never delete or edit `PayoutRound`, `PayoutItem` or the other ledger rows to force a run, and never send tokens by hand.
- **Not fixable within the grace period.** The round stays `late` and is still finished once the cause is fixed. Tell the owner. After a day, "Stuck rounds".

**Limits of automatic recovery:**

- Only rounds in the current mode are resumed. Rounds left unfinished by a switch between dry-run and live stay where they are until that mode is back.
- A coin gets no new round while an earlier one is open, so a round that can't finish holds back that coin's new fees. After a day the worker alerts: "Stuck rounds".

```bash
dbq -c "SELECT hour, \"dryRun\", sig, lamports, \"toTradeId\", \"createdAt\" FROM \"VaultClaim\" WHERE \"attributedAt\" IS NULL ORDER BY \"createdAt\""
```

### Stuck rounds

**Signs:** the alert "Payout rounds for \<hour\> are still unfinished after a day…", or `lateRounds` that never goes back to 0. Every tick still resumes these rounds, but their coins get no new rounds, so those coins' new fees wait in the pool, until the old ones are `delivered`.

**Find them:**

```bash
dbq -c "SELECT r.hour, r.\"dryRun\", c.ticker, a.symbol, r.status, r.step, r.\"solIn\", r.\"assetOut\", r.error, r.\"startedAt\"
        FROM \"PayoutRound\" r JOIN \"Coin\" c ON c.id = r.\"coinId\" JOIN \"DividendAsset\" a ON a.id = c.\"dividendAssetId\"
        WHERE r.step <> 'delivered' AND r.hour < date_trunc('hour', now() AT TIME ZONE 'UTC')
        ORDER BY r.hour, c.ticker"
dbq -c "SELECT b.hour, a.symbol, b.\"dryRun\", b.status, b.\"lamportsIn\", b.sig, b.error, b.\"updatedAt\"
        FROM \"SwapBatch\" b JOIN \"DividendAsset\" a ON a.id = b.\"assetId\"
        WHERE b.status IN ('pending', 'sent') ORDER BY b.hour"
grep -E '"msg":"payouts: (resuming an earlier hour|resume failed|snapshot failed, will retry|swap not confirmed)"' /var/log/divvy/worker/worker.out.log | tail -10 | jq -c '{t, msg, hour, coinId, asset, error}'
```

A round whose `dryRun` doesn't match `PAYOUTS_DRY_RUN` only moves once that mode is back: leave it and tell the owner. Otherwise the step says what it's waiting for:

| Step | Waiting for | What clears it |
|---|---|---|
| `allocated` | The asset's swap. Its `SwapBatch` is `pending` (the fee claimer is short of SOL, or a run failed before signing) or `sent` (the outcome is being checked; after 5 minutes without a landed transaction it's built again). | The fee claimer's SOL ("Hot wallet below threshold"), the RPC, and Jupiter. A swap that gets refused also clears it: its rounds become `carried` and the money returns to the pool. |
| `swapped` | The holder snapshot (`payouts: snapshot failed, will retry` names the coin). | The RPC (DAS or `getProgramAccounts`). |
| `snapshotted` | The finish step, which comes after live delivery; `payouts: resume failed` carries the error. Credits are already booked. | Whatever that error names, usually the RPC. |

**Safe options:**

- Fix the cause. The next tick, within 10 minutes, resumes from the last completed step; every step is idempotent.
- Check the run's preconditions too: a rates mismatch, no SOL price or the mainnet gate stops resumed hours as well (`payouts: resume failed`).
- Never delete or edit `PayoutRound`, `FeeAllocation`, `SwapBatch`, `PayoutItem` or `Credit` rows to unblock a coin, and never send tokens by hand. If the cause can't be fixed, stop and tell the owner: it needs a reviewed code change.

### Payout transfers or claims stuck pending

**Signs:** a holder says a payout didn't arrive, a claim answers "You have a claim waiting", or `PayoutTransfer` or `Claim` rows stay `pending`.

Every minute, `transfers-reconcile` (the `payouts` role) and `claims-reconcile` (the `claims` role) settle them from the chain:

- **Confirmed:** the wallet's credited `PayoutItem` rows for that asset become `sent` (a transfer) or `claimed` (a claim).
- **Failed, or expired** (no status once the chain is 150 blocks past `lastValidBlockHeight`): the credit is given back (`deliver: transfer expired, credit restored` for transfers) and the next delivery or claim tries again. A claim that failed on chain also starts the one-hour claim backoff ("Holder claims").

**Check:**

```bash
dbq -c "SELECT sig, count(*) AS wallets, sum(amount) AS amount, min(\"createdAt\") AS since, \"lastValidBlockHeight\"
        FROM \"PayoutTransfer\" WHERE status = 'pending' GROUP BY sig, \"lastValidBlockHeight\" ORDER BY since"
dbq -c "SELECT id, wallet, amount, sig, \"lastValidBlockHeight\", \"createdAt\" FROM \"Claim\" WHERE status = 'pending' ORDER BY \"createdAt\""
rpc getBlockHeight
rpc getSignatureStatuses '[["<sig>"], {"searchTransactionHistory": true}]'
grep -E '"msg":"(transfers-reconcile|claims-reconcile|deliver)' /var/log/divvy/worker/worker.out.log | tail -10
```

**Fix:** nothing by hand. Rows still pending well past their block height mean the reconcilers aren't running or can't reach the RPC (`transfers-reconcile: failed`, `claims-reconcile: failed`): see "RPC down". Never re-send, and never edit `Credit`.

**One holder's payouts:**

```bash
W='<wallet address>'
dbq -c "SELECT r.hour, c.ticker, i.\"amountAsset\", i.status, i.\"sendSig\" FROM \"PayoutItem\" i
        JOIN \"PayoutRound\" r ON r.id = i.\"roundId\" JOIN \"Coin\" c ON c.id = r.\"coinId\"
        WHERE i.wallet = '$W' AND NOT r.\"dryRun\" ORDER BY r.hour DESC LIMIT 20"
dbq -c "SELECT a.id, a.symbol, cr.amount FROM \"Credit\" cr JOIN \"DividendAsset\" a ON a.id = cr.\"assetId\" WHERE cr.wallet = '$W'"
dbq -c "SELECT c.ticker, h.\"snapshotHour\", h.balance, h.\"excludedReason\" FROM \"HolderBalance\" h JOIN \"Coin\" c ON c.id = h.\"coinId\"
        WHERE h.wallet = '$W' ORDER BY h.\"snapshotHour\" DESC LIMIT 20"
rcli HGET divvy:push-blocked-at:<assetId> "$W"            # a time: on the push blocklist for 24 h from then
```

`excludedReason = 'small'` means the holding was under `MIN_HOLDER_USD` at the snapshot. A holder who bought after the hour's secret presnapshot, or sold before the round, is paid on the smaller balance ("Mid-hour presnapshot"). A `credited` item with a `Credit` balance is waiting for a threshold: `AUTO_PUSH_MIN_USD` for a wallet that holds the asset's token account, `PUSH_NEW_ATA_MIN_USD` for one that doesn't (push), or for the holder to claim (claim). A wallet on the push blocklist waits too ("Push blocklist").

### Launch stuck in "bundling"

**Signs:** the launch modal sits on step 2, or a `Launch` row stays `step = 'bundling'` for more than 5 minutes. Up to about 4 minutes is normal: the worker makes 3 attempts with the same mint, each polling Jito for up to 60 seconds. If none is confirmed, the worker logs `launch: not confirmed yet, left to the reconciler` and leaves the launch in `bundling` instead of failing it, because the create can still land until its blockhash expires.

**Check:**

```bash
dbq -c "SELECT id, step, attempts, \"bundleId\", \"lastValidBlockHeight\", (now() AT TIME ZONE 'UTC') - \"updatedAt\" AS since_update
        FROM \"Launch\" WHERE step IN ('checking', 'bundling') ORDER BY \"createdAt\""
rpc getBlockHeight                       # more than 150 past lastValidBlockHeight: that create can no longer land
grep -E '"msg":"launch(-reconcile)?: ' /var/log/divvy/worker/worker.out.log | tail -20
```

Ask Jito about the bundle (docs/verified/jito-jupiter-xstocks.md §1.1, §1.7 and §1.9). `getInflightBundleStatuses` covers the last 5 minutes and answers `Invalid`, `Pending`, `Failed` or `Landed`. Stay under 1 request per second per region; the worker uses the same budget. The worker appends `/api/v1/…` to `JITO_BLOCK_ENGINE_URL`, so that value is a bare host (empty means `https://mainnet.block-engine.jito.wtf`).

```bash
JITO=$(divvy_env worker JITO_BLOCK_ENGINE_URL)
curl -fsS "${JITO:-https://mainnet.block-engine.jito.wtf}/api/v1/getInflightBundleStatuses" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getInflightBundleStatuses","params":[["<bundleId>"]]}'
```

Also check the launcher wallet's balance ("Hot wallet below threshold").

**Fix:**

- **Let the reconciler finish it.** Every minute, `launch-reconcile` looks at launches that have sat in `bundling` for 90 seconds: if the mint account exists, the launch is marked landed and the coin goes live; once the chain is more than 150 blocks past `lastValidBlockHeight` without it, the launch is marked failed. A failed launch releases its ticker, picture and X account, so the user can launch again (with a new mint). The coin row keeps its mint and pool address, so if the create lands after all, the indexer still picks up its trades and alerts "A launch marked failed landed on chain anyway": tell the owner. Launches stuck in `checking` for 5 minutes are re-queued. Don't edit the rows.
- **Rows stay in `bundling` well past the block height.** The reconciler isn't running or can't reach the RPC: look for `launch-reconcile: failed` and see "RPC down".
- **A row in `landed` for more than a minute.** The create is on chain and the coin is live and listed, but the last steps (its stats row, `indexed`, the live event) were cut off, so the creator's modal still spins on "Live on chain". The reconciler finishes it within a minute. On 2026-10-28 one stopped there because the worker and the indexer wrote the coin's stats row at once (`Unique constraint failed on the fields: (coinId)`); stats writes no longer race (`putCoinStats`), and lint refuses an upsert with an empty update.
- **Never** resend the create through an RPC, and never post the pending mint address or signature anywhere (CLAUDE.md rule 6).
- **Many stuck at once.** Go to "Jito bundle failure rate high", and consider pausing launches.

### Indexer lag above 60 seconds

**Signs:** the alert "Indexer is \<n\>s behind", "Indexer stopped on …" or "Indexer (…) is stuck", trades, candles or curve progress stop moving, `indexerLagSec` on the admin page, or the payout alert "Indexer hasn't reached vault claim".

**Check:**

```bash
dbq -c "SELECT name, \"lastSlot\", \"lastSignature\", (now() AT TIME ZONE 'UTC') - \"updatedAt\" AS since_update FROM \"IndexerCursor\" ORDER BY name"
rpc getSlot                                   # chain tip; (tip - lastSlot) × ~0.4 s ≈ seconds behind
rcli GET divvy:status | jq '{at: (.at / 1000 | todate), indexerSlot, indexerLagSec}'
grep -E '"msg":"(indexer|market-stats)' /var/log/divvy/worker/worker.out.log | tail -10
grep -E '"msg":"alert: Indexer (stopped|\()' /var/log/divvy/worker/worker.out.log | tail -3
```

The `platform` cursor follows Divvy's PlatformConfig (every create, curve trade, migration and vault claim); `cpmm:<pool>` cursors follow graduated coins' pools. A cursor only moves when a new transaction arrives, so an old `since_update` on a quiet chain is fine; `indexerLagSec` (how long the oldest unprocessed transaction has waited) is the real measure.

**Fix:**

- **The RPC is failing** (`indexer: tick failed` or `indexer: follow failed` with RPC errors, or "Indexer (…) is stuck"). See "RPC down".
- **The decoder stopped on a transaction** ("Indexer stopped on \<sig\>: …"). The cursor stays on the last good transaction on purpose. Don't move or delete it: skipping a trade loses its fees. The decoder in `packages/solana/src/live` needs a fix confirmed against the IDL and logged in `docs/VERIFIED.md` (rule 2). Deploy it and restart the worker; the indexer resumes from the cursor. A restart without a fix stops on the same transaction again. While it's stopped, live payouts wait at attribution.
- **The worker is stuck.** Restart it, but only once `rcli EXISTS divvy:lock:payouts` prints `0`, because the indexer and payouts share one process: `pm2as divvy-worker restart divvy-worker`.
- **Catching up is automatic.** Each tick walks every signature since the cursor, oldest first, 1,000 per page. After an outage it catches up without help.
- **Before the next round:** per-coin fee attribution comes from indexed trades (docs/VERIFIED.md item 6), so a live claim isn't attributed until the `platform` cursor reaches the claim's own transaction and sets its marker ("Vault claims and trade markers"). Once the lag clears, check the claim's `unattributedLamports` and the attribution alerts.

### Prices missing

**Signs:** "Payouts stopped: no SOL price in the cache", "No \<SYMBOL\> price", "Jupiter returned no SOL price", or USD figures on the site reading 0.

```bash
rcli TTL divvy:prices                                      # seconds left; -2 means gone
rcli GET divvy:prices | jq '{solUsd, at: (.at / 1000 | todate), assets: (.byMint | length)}'
grep -E '"msg":"prices: ' /var/log/divvy/worker/worker.out.log | tail -5   # "prices: failed" carries Jupiter's error
```

The prices job reads Jupiter's Price API every minute and keeps the result for an hour. If Jupiter is down, wait; past the hour, payouts stop until a price is back. For a key problem, fix `JUP_API_KEY` in `worker.env` and restart the worker. The API uses its own key, `JUP_API_KEY_API` in `api.env`, for trades on graduated coins; reload the API if you change that one.

### Hot wallet below threshold

The three hot wallets:

- **Launcher:** create rent and Jito tips. Its spend is capped per UTC hour by `LAUNCHER_HOURLY_CAP_LAMPORTS`.
- **Payout vault:** holds the dividend tokens; pays transaction fees for pushes and claims, and token-account rent for new holders under push. Its sends are capped per hour by `PUSH_HOURLY_CAP_USD`.
- **Fee claimer:** signs vault claims and swaps (and pays the Jito tip for swaps on mainnet); holds the claimed SOL until it's swapped. Its swaps are capped per hour by `SWAP_HOURLY_CAP_LAMPORTS`, and per asset by `SWAP_BATCH_MAX_LAMPORTS`.

The alert threshold is `HOT_WALLET_MIN_SOL` (one value for all three). Thresholds and spend caps are the owner's call (HANDOFF §9).

**Check:**

```bash
rcli GET divvy:status | jq -r '.wallets[] | "\(.role) \(.address) \(.sol) SOL low=\(.lowBalance)"'
sudo cat /etc/divvy/keys/pubkeys.txt
rpc getBalance '["<pubkey>"]'                 # result.value is in lamports (1 SOL = 1e9)
# What the fee claimer must still hold for holders (it also keeps Divvy's share):
dbq -c "SELECT coalesce(sum(f.\"holdersLamports\"), 0) AS holders_unswapped FROM \"FeeAllocation\" f
        LEFT JOIN \"PayoutRound\" r ON r.id = f.\"roundId\"
        WHERE NOT f.\"dryRun\" AND (f.\"roundId\" IS NULL OR r.step = 'allocated')"
```

**Fix:**

- **Top-ups need the owner's approval in chat, every time** (CLAUDE.md rule 3). Auto top-up only with approval (HANDOFF §9). Funds come from the owner's treasury wallet, which never lives on this server. Write the signature and purpose in the ops log.
- **Launcher low:** pause launches until it's funded ("Pausing launches"), because creates would fail.
- **Payout vault low:** pushes and claims can't pay their fees, and new holders can't get token accounts. Tell the owner.
- **Fee claimer low:** vault claims and swaps can't pay their fees; below the holders' share above, swaps stop with "Fee claimer holds less SOL than the holders' share it must swap".
- **A drop that doesn't match recent activity** (compare `SignedTx`): treat it as a compromised key and go straight to "Rotating a compromised hot wallet key".

### Jito bundle failure rate high

**Signs:** the alert "Launch create attempt failed (…)" keeps coming back, launches fail or stick in bundling, or mainnet swaps stay `sent`.

**Check:**

```bash
dbq -c "SELECT step, count(*), round(avg(attempts), 2) AS avg_attempts FROM \"Launch\"
        WHERE \"createdAt\" > (now() AT TIME ZONE 'UTC') - interval '1 hour' GROUP BY 1"
dbq -c "SELECT error->>'code' AS code, error->>'message' AS message, count(*) FROM \"Launch\"
        WHERE step = 'failed' AND \"createdAt\" > (now() AT TIME ZONE 'UTC') - interval '1 hour' GROUP BY 1, 2"
grep '"msg":"launch: attempt failed"' /var/log/divvy/worker/worker.out.log | tail -20 | jq -c '{t, attempt, error}'
curl -fsS https://bundles.jito.wtf/api/v1/bundles/tip_floor; echo        # tip levels (docs/verified/jito-jupiter-xstocks.md §1.5)
grep -iE 'jito|429' /var/log/divvy/worker/worker.out.log | tail -20
```

- Is Jito's status page reporting trouble in our region (regions: same file, §1.8)?
- Are we over 1 request per second per IP per region (HTTP 429 in `jito sendBundle: HTTP …` errors)?
- Is `JITO_TIP_LAMPORTS` (default 100,000 lamports) below the 50th to 75th percentile of the floor?
- Is the launcher short of SOL, so simulation fails?

**Fix:**

- **Region trouble or 429s:** point `JITO_BLOCK_ENGINE_URL` at another region's host in `/etc/divvy/worker.env`, then restart the worker (only the worker talks to Jito).
- **Tip too low:** raise `JITO_TIP_LAMPORTS` in `worker.env` with the owner's approval, then restart the worker. Each launch counts its tip against the launcher's hourly cap, and on mainnet each payout swap pays the same tip.
- **Failures continue:** pause launches. **Never** fall back to sending creates through an RPC.

### RPC down

**Signs:** trade-box build errors, indexer lag, payout runs failing, `launch-reconcile: failed` or `transfers-reconcile: failed`, or an API or worker that won't start.

**Check:**

```bash
rpc getHealth          # "ok"
rpc getSlot            # should advance between calls
```

Look at the provider's status page.

**Fix:**

- **Server side.** Switch `SOLANA_RPC_URL` and `SOLANA_WS_URL` in `/etc/divvy/api.env` and `/etc/divvy/worker.env` to the backup provider. Keep that provider's details in the ops log beforehand. It must serve the same cluster: the API and the worker refuse to start otherwise ("Worker or API won't start"). Holder snapshots try Helius DAS first and fall back to `getProgramAccounts`, so a non-Helius backup works; set `HOLDERS_VIA_DAS=false` in `worker.env` to skip the failing DAS call. Then reload the API and restart the worker (Deploy step 4, minding the payout lock).
- **Browser side.** With `NEXT_PUBLIC_SOLANA_RPC_URL=/api/rpc` (uspad.fun) the browser goes through the API's relay to `SOLANA_RPC_URL`, so the server-side switch covers it. Only for a full URL: it is baked into the web build:
  1. Add the new origin, as both `https://` and `wss://`, to `connect-src` in the Nginx CSP (keep `ws://localhost:*`), then run `sudo nginx -t && sudo systemctl reload nginx`.
  2. Change the value in `/etc/divvy/build.env`.
  3. Redeploy the same SHA (Deploy steps 1 to 5).

### Redis down

**What breaks:**

- **The site.** `/api/config` reads the price cache from Redis and every page needs it, so pages fail. The API's own rate limiter steps aside while Redis is down (Nginx still limits), and `/api/health` answers HTTP 200 with `"ok":false` and `"redis":false`.
- Sign-in (SIWS nonces), X linking, launches (cooldowns and the queue) and claims (the queue).
- Worker jobs: no job can take its lock, so no payout tick, presnapshot, reconciler, prices or status run (`<job>: failed`).
- Live events, the price cache, the spend-cap counters and the worker status.

**Check:**

```bash
systemctl status redis-server --no-pager; sudo journalctl -u redis-server -n 50 --no-pager
rcli ping
rcli INFO persistence | grep -E 'rdb_last_bgsave_status|aof_last_write_status'
rcli INFO memory | grep -E 'used_memory_human|maxmemory_human'
df -h /var/lib/redis
```

**Fix:**

- **Stopped or crashed:** run `sudo systemctl restart redis-server`. The apps reconnect on their own; confirm with `pm2all logs --lines 30 --nostream` and `curl -fsS http://127.0.0.1:4000/api/health`.
- **`MISCONF ... RDB snapshots`:** the disk is full or failing. Free space, then run `rcli BGSAVE`; Redis accepts writes again after a good save.
- **`OOM command not allowed`:** `maxmemory` is reached under `noeviction`. Find the large keys with `rcli --bigkeys`, raise `maxmemory` in `/etc/redis/redis.conf`, and restart Redis. Never switch to an evicting policy: locks, nonces and queues must not vanish silently.
- **Afterwards:** check that the next payout tick ran (the payout playbook). Losing Redis data is acceptable, because correctness lives in Postgres (unique coin + hour). Lost launch jobs are re-queued by the launch reconciler after 5 minutes; a lost claim request just fails, and the holder tries again. A lost presnapshot means that hour pays on the round snapshot alone. Lost cap counters start from zero for the rest of the hour, lost swap limits go back to `SWAP_BATCH_MAX_LAMPORTS`, and wallets on the push blocklist are tried again.

### Worker or API won't start

**Signs:** restart counts climbing in `pm2all ls`, then `errored`; or the smoke test in Deploy step 3 fails.

```bash
pm2as divvy-worker logs divvy-worker --err --lines 40 --nostream
pm2as divvy-api logs divvy-api --err --lines 40 --nostream
```

| Error | Fix |
|---|---|
| `SOLANA_CLUSTER is "<cluster>" but the RPC's genesis hash is <hash>` (API or worker) | The mainnet gate and the transactions the API builds trust `SOLANA_CLUSTER`, so both apps check the RPC's genesis hash at start (the API in live mode) and refuse a mismatch. Correct whichever is wrong, in both `api.env` and `worker.env`. Never relabel the cluster to match a mainnet RPC: going to mainnet goes through `docs/MAINNET_CHECKLIST.md`. |
| An RPC or network error at start | The genesis check needs the RPC, so neither app starts while it's unreachable ("RPC down"). |
| `STORAGE_DIR must be an absolute path …`, `STORAGE_DIR must be outside the release folder …`, `PUBLIC_MEDIA_BASE must be https …` or `… a public host …` | Fix the storage block in both `api.env` and `worker.env` (`deploy/setup-vps.md` §8). "Inside the release" means under the folder that holds `pnpm-workspace.yaml`, by the path the app was started from or the real one, so `/srv/divvy/current/data/media` is refused. |
| A Node error naming `/etc/divvy/<app>.env` | The file is missing, or not owned by the app's user: `sudo ls -l /etc/divvy/`. |
| `API_MODE=mock … refusing to start with NODE_ENV=production` | Set `API_MODE=live` in `api.env`. |
| `API_MODE=live needs …`, or a validation error naming a variable | That variable is missing or malformed in the app's own env file. |
| `<role> keypair file must not be readable by group or others` (as `<job>: failed`, when a job first needs the key) | `sudo chmod 400 /etc/divvy/keys/<file>.json` and `sudo chown divvy-worker:divvy-worker` it. |

After the fix: `pm2as <user> reset <app> && pm2as <user> restart <app>` (user and app have the same name).

### Pausing launches

- **Admin pause.** This is the proper switch. On the admin page, write the reason and press "Pause launches"; or with curl ("Admin API"):
  ```bash
  admin POST /api/admin/settings '{"launchesOpen":false,"reason":"Launches are paused while we fix a network problem."}'
  curl -fsS https://divvy.example/api/config | jq '{launchesOpen, launchesPausedReason}'
  admin POST /api/admin/settings '{"launchesOpen":true}'     # resume
  ```
  `POST /api/launch` then answers 503 `LAUNCHES_PAUSED` with the reason, `/api/config` reports `launchesOpen: false` and `launchesPausedReason`, and the create page disables the button and shows the reason. Launches still waiting in the queue are failed with the same reason (their ticker and picture are released); launches already sending a bundle carry on. Status polling (`GET /api/launch/:id`) isn't affected.
- **Nginx switch.** Use it when the API or the admin sign-in is down. No deploy and no reload:
  ```bash
  sudo touch /etc/nginx/divvy-launches-paused       # pause: POST /api/launch answers 503 "Launches are paused."
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://divvy.example/api/launch   # 503
  sudo rm /etc/nginx/divvy-launches-paused          # resume
  ```
  The create page still shows its normal button; the launch then fails with that message. Launches already queued carry on.

Pause for:

- a Jito outage;
- a launcher wallet that is low or compromised;
- an anti-vamp bypass being exploited;
- a legal request.

Write the reason in the ops log.

### Rotating a compromised hot wallet key

1. **Contain it, within minutes.**
   - Launcher: pause launches.
   - Payout vault or fee claimer: set `PAYOUTS_DRY_RUN=true` in `/etc/divvy/worker.env` and `api.env`, then `pm2as divvy-worker restart divvy-worker --update-env` and reload the API. That stops vault claims, swaps, pushes and holder claims.
   - Everything at once, on mainnet: `DIVVY_MAINNET_ENABLED=false` in both files and restart the worker. Nothing is signed and sent after that.
   - Tell the owner now. Moving the remaining funds and funding a new wallet are both spends (rule 3).
2. **Create a new keypair** under a new file name, for example `/etc/divvy/keys/launcher-20261026.json`, with one of the commands in `deploy/setup-vps.md` §8 (for that one role). Its public key goes into `pubkeys.txt`.
3. **With the owner's approval,** sweep what's left in the compromised wallet to the owner's treasury (speed matters), then fund the new wallet minimally. Log both signatures.
4. **Point the app at the new key:** change the matching `*_KEYPAIR_PATH` in `/etc/divvy/worker.env` and restart the worker (no other app reads keys). Pending `PayoutTransfer` and `Claim` rows signed by the old payout vault still settle from the chain. A new payout vault starts without the dividend tokens that back the holders' credits, so pushes stop with "Payout vault holds … but owes …" until it holds them again (the owner's call, rule 3).
5. **On-chain roles.** If the wallet is named in Divvy's PlatformConfig (`platform_fee_wallet`, `platform_nft_wallet`, `platform_cp_creator`; docs/verified/launchlab.md), the PlatformConfig admin has to update it, and any Fee Key NFTs the old wallet holds have to move. Until `platform_fee_wallet` names the new fee claimer, every payout run stops with "PlatformConfig.platform_fee_wallet is not the fee claimer key".
   - Confirm the exact instruction against the SDK and log it in `docs/VERIFIED.md` before sending (rule 2). Updates may be rate-limited per epoch (open question 8 in launchlab.md).
   - Send only with the owner's approval.
6. **Remove the old file:** `sudo shred -u /etc/divvy/keys/<old>.json`. This is best effort on SSDs. The key is burned either way; its encrypted offline copy is now worthless too.
7. **Find the leak.**
   - Check who could read `/etc/divvy/keys` (only `divvy-worker` and root should: `sudo ls -la /etc/divvy/keys`) and who logged in (`last`, `/var/log/auth.log`).
   - Check whether key material ever reached logs, shell history, backups or CI.
   - If root or `divvy` (which owns the code the worker runs) may be compromised, rotate everything: database and Redis passwords, every session (`DELETE FROM "Session";` signs everyone out), the hot-wallet keys (move funds to fresh keys first), the RPC, Jito, Jupiter and Telegram keys, and the GitHub deploy key. Then **rebuild the VPS from scratch** (`deploy/setup-vps.md`) instead of cleaning it in place.
8. **Switch payouts back on** (`PAYOUTS_DRY_RUN=false` in both files) only with the owner's approval.

### Restoring a backup

Follow [`deploy/backup/pg-restore.md`](../deploy/backup/pg-restore.md). In short:

1. Verify the checksum.
2. Restore into a scratch database and check it.
3. Pause launches and force payout dry-run.
4. Swap databases by renaming, so the old one is kept.
5. Apply the release's migrations.
6. **Reconcile with the chain** before resuming launches, claims or live payouts.

### Web or API returns 502/504

```bash
pm2all jlist 2>/dev/null | jq -r '.[] | "\(.name) \(.pm2_env.status) restarts=\(.pm2_env.restart_time)"'
curl -sS http://127.0.0.1:4000/api/health; echo; curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
pm2as divvy-api logs divvy-api --lines 100 --nostream
tail -50 /var/log/divvy/web/web.err.log
sudo tail -50 /var/log/nginx/divvy.error.log
df -h / /var/lib/postgresql /var/lib/divvy; free -m
```

- **Right after a deploy, or with restart counts climbing:** roll back first.
- **Health answers `"ok":false`:** look at `db` and `redis` in the body. `"redis":false` is "Redis down".
- **An app shows `errored`:** it hit 30 fast restarts. See "Worker or API won't start".
- **Restarts every few minutes with nothing in the logs:** it's hitting `max_memory_restart` (web 700 MB, API and worker 512 MB). Look for a leak before raising the limit.
- **Visitors get 429 "Too many requests":** the per-IP limits in Nginx ("Quick reference"). `sudo grep 'limiting requests' /var/log/nginx/divvy.error.log | tail` shows which zone and address. Many different visitors limited at once behind Cloudflare means the `real_ip` block isn't enabled, so everyone shares Cloudflare's addresses (`deploy/nginx/divvy.conf`, option B).

### Backup failed

```bash
tail -30 /var/log/divvy/backup/backup.log
sudo -u divvy-backup -H /usr/local/bin/divvy-pg-backup     # run it by hand
```

Usual causes:

- the disk is full;
- the database password changed and `DATABASE_URL` in `backup.env` (and `/home/divvy-backup/.pgpass`) wasn't updated;
- `backup.env` or `/var/backups/divvy` isn't owned by `divvy-backup`, or someone ran the script as root (it refuses, and a root-owned lock file in `/var/backups/divvy` breaks later runs: remove it);
- the rclone remote's credentials expired (re-run `sudo -u divvy-backup -H rclone config`).

Older dumps are only rotated out after a successful run, so a failing job never deletes good backups.

---

## Routine checks

- **Daily:**
  - `pm2all ls`: everything online, with restart counts stable.
  - The admin page (or `admin GET /api/admin/overview`): launches open or paused as intended, no wallet low, `lateRounds` 0, `indexerLagSec` small, and `mainnetEnabled` and `dryRun` as the owner set them.
  - No critical alerts in the worker log since yesterday ("Alerts").
  - The last line of `/var/log/divvy/backup/backup.log` reads `done`.
  - Disk use is under 80% (`df -h / /var/lib/divvy`).
- **Weekly:**
  - `sudo certbot certificates`: more than 30 days left.
  - Hot wallet balances against the thresholds, and (live) the credits check in "Switching dry-run to live".
  - `sudo apt-get update && sudo apt-get -y upgrade`. After a reboot, check that `pm2all ls` came back on its own.
- **Monthly:**
  - A restore drill (pg-restore.md, steps 1 to 3) from a local dump and from an offsite one.
  - Prune old releases.
  - `envcheck`, and `sudo ls -l /etc/divvy /etc/divvy/keys`: owners and modes as in "Quick reference".
  - Re-read this runbook against the code: alert texts (`grep -rn 'alerts.send(' apps/worker/src`), job schedules (`apps/worker/src/index.ts`) and env names (`.env.example`).
