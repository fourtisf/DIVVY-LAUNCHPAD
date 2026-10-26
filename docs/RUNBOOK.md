# Divvy operations runbook

How to deploy, roll back and handle incidents on the production VPS. One-time server setup is in [`deploy/setup-vps.md`](../deploy/setup-vps.md); database restores are in [`deploy/backup/pg-restore.md`](../deploy/backup/pg-restore.md).

**What runs.** `divvy-web` serves the site. `divvy-api` runs in live mode (PostgreSQL, Redis and the Solana RPC) and holds no private keys. `divvy-worker` holds the three hot-wallet keys and runs everything that signs: the launch pipeline, the claim builder, the indexer, the hourly dividend engine and the small ops jobs. Two values in `/etc/divvy/divvy.env` decide what the worker may send:

- `PAYOUTS_DRY_RUN` (default `true`). Dry-run computes every round from real chain data and signs nothing. Turning it off needs the owner's approval ("Payouts: dry-run and going live").
- `DIVVY_MAINNET_ENABLED` (default `false`), the mainnet gate. With `SOLANA_CLUSTER=mainnet-beta` and the gate off, nothing is signed and sent: launches fail with "Launches aren't open yet", claims answer "Claims aren't open yet", and live payout runs stop. Dry-run payouts still run. Devnet is always allowed.

**Rules that always apply (CLAUDE.md):**

- No mainnet spend without the owner's explicit approval in chat. That covers funding or topping up wallets, sweeping funds, turning off payout dry-run, turning on the mainnet gate, raising the Jito tip or the launcher's hourly cap, and PlatformConfig changes.
- Key material never goes in the repo, the database, logs, chats or tickets. An admin's `divvy_session` cookie is a credential too.
- Creates go only through Jito bundles. Never rebroadcast one through an RPC, and never reveal a mint address or a create signature before its create lands.
- Never edit or delete `PayoutRound`, `PayoutItem`, `VaultClaim`, `FeeAllocation`, `SwapBatch`, `Credit`, `PayoutTransfer` or `Claim` rows by hand, never move an `IndexerCursor`, and never send tokens by hand. Every engine step is idempotent and resumes on its own; a hand edit breaks the ledger.
- Every transaction that gets signed is logged with its purpose and signature (the `SignedTx` table, plus the ops log for anything done by hand).

---

## Quick reference

| What | Where |
|---|---|
| Web | PM2 `divvy-web`, cluster ×2, `127.0.0.1:3000` |
| API | PM2 `divvy-api`, cluster ×1, `127.0.0.1:4000`, WebSocket `/api/live`. Live mode, no keys. |
| Worker | PM2 `divvy-worker`, fork ×1, **never more than one**. Jobs, in UTC (`apps/worker/src/index.ts`): payouts every 10 minutes (`*/10 * * * *`: minute 0 starts the hour's run, the other ticks resume it); the launch, claim and transfer reconcilers, prices, hot-wallet status and market stats every minute; reserved tickers `17 3 * * *`. The indexer polls every `INDEXER_POLL_MS` (4 s) and also wakes on PlatformConfig logs. |
| Admin | `https://divvy.example/admin`, signed in with a wallet listed in `ADMIN_WALLETS`, or the admin API with curl ("Admin API") |
| Process file | `/srv/divvy/current/deploy/ecosystem.config.cjs` |
| Code | `/srv/divvy/releases/<UTC stamp>-<sha>/`, with `/srv/divvy/current` pointing at the live one. Git mirror at `/srv/divvy/repo.git`. |
| Config and secrets | `/etc/divvy/divvy.env` (600, divvy), keypairs in `/etc/divvy/keys/*.json` (600, divvy), public keys in `/etc/divvy/keys/pubkeys.txt` |
| App logs | `/var/log/divvy/{web,api,worker}.{out,err}.log` (the worker writes one JSON object per line), `/var/log/divvy/backup.log` |
| Nginx | `/etc/nginx/sites-available/divvy.conf`, logs `/var/log/nginx/divvy.{access,error}.log` |
| PostgreSQL 16 | `127.0.0.1:5432`, database `divvy`, role `divvy` (password in `/home/divvy/.pgpass`) |
| Redis 7 | `127.0.0.1:6379`, password in `REDIS_URL`. Keys: `divvy:lock:<job>` (job locks), `divvy:alert:<key>` (alert throttle), `divvy:prices` (1 h TTL), `divvy:status` (10 min TTL), `divvy:launcher-spend:<UTC hour>`, `divvy:launch-cooldown:<wallet>`, `divvy:siws:<nonce>`, `divvy:x-oauth:<state>`, `divvy-rl:*` (API rate limits), `bull:divvy-launch:*` and `bull:divvy-claims:*` (queues). Pub/sub channel `divvy:live`. |
| Backups | `/var/backups/divvy/`, cron 03:40 UTC, 14 days local, offsite via `RCLONE_REMOTE` |
| Launch pause | The admin pause (`launchesOpen`), or the Nginx switch `/etc/nginx/divvy-launches-paused` (see "Pausing launches") |

Job locks and their TTLs: `payouts` 15 minutes, `reserved-tickers` 30 minutes, `launch:<launchId>` 10 minutes, and 55 seconds for the per-minute jobs `launch-reconcile`, `claims-reconcile`, `transfers-reconcile`, `market-stats`, `prices` and `status`.

**Shell helpers.** Paste these into your shell before using the commands below. They work both from your admin shell and from `sudo -iu divvy`:

```bash
as_divvy()  { if [ "$(id -un)" = divvy ]; then "$@"; else sudo -u divvy -H "$@"; fi; }   # run as the service user
pm2d()      { as_divvy pm2 "$@"; }                                            # PM2 as divvy
divvy_env() { as_divvy grep -E "^$1=" /etc/divvy/divvy.env | tail -n 1 | cut -d= -f2-; }
dbq()       { as_divvy psql -h 127.0.0.1 -U divvy -d divvy -X "$@"; }         # dbq -c 'select 1'
rcli()      { REDISCLI_AUTH="$(divvy_env REDIS_URL | sed -E 's#^redis://[^:]*:([^@]*)@.*#\1#')" redis-cli -h 127.0.0.1 "$@"; }
rpc()       { printf 'url = "%s"\n' "$(divvy_env SOLANA_RPC_URL)" |          # URL on stdin: the API key stays out of `ps`
              curl -fsS -m 10 -K - -H 'content-type: application/json' \
                -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"$1\",\"params\":${2:-[]}}"; echo; }
admin()     { : "${DIVVY_SESSION:?run: read -rs DIVVY_SESSION}"                # see "Admin API"
              printf 'cookie = "divvy_session=%s"\n' "$DIVVY_SESSION" |       # cookie on stdin, not in `ps`
                curl -sS -m 30 -K - -X "$1" ${3:+-H 'content-type: application/json' --data-raw "$3"} \
                  -w '%{stderr}HTTP %{http_code}\n' "http://127.0.0.1:4000$2"; echo; }
```

`pm2d jlist | jq -r '.[] | "\(.name) \(.pm2_env.status) restarts=\(.pm2_env.restart_time)"'` is the quickest health view. For the worker's own view, `rcli GET divvy:status | jq '{at: (.at / 1000 | todate), indexerSlot, indexerLagSec, wallets}'` (written every minute; empty when the status job has stopped for 10 minutes).

---

## Deploy

CI must be green on the commit you deploy. Deploys are zero-downtime for web and API (PM2 cluster reload). The worker restarts, so time it:

- **Not while a payout run is in progress.** Ticks start at minutes 0, 10, 20, 30, 40 and 50 UTC, and the one at minute 0 does the most work (claim, swaps, snapshots, deliveries). Wait until the lock is free and the newest run has finished:
  ```bash
  rcli EXISTS divvy:lock:payouts                                                              # 0
  grep -E '"msg":"payouts: (run|failed)"' /var/log/divvy/worker.out.log | tail -1 | jq -r .t   # after the last tick
  ```
  A worker killed mid-run leaves its lock behind for up to 15 minutes, so the next tick skips; a later tick resumes where the run stopped.
- **Not while a launch is sending.** `dbq -c "SELECT step, count(*) FROM \"Launch\" WHERE step IN ('checking', 'bundling') GROUP BY 1"` should print no rows. PM2 gives the worker 30 seconds to stop. A launch cut off mid-send is recovered by the launch reconciler (see "Launch stuck in bundling"), but its user waits longer. In a busy period, pause launches first.
- **Not between 03:30 and 04:15 UTC.** The backup holds read locks, and a migration's `ALTER TABLE` would wait behind them while blocking every query that comes after it.

### 1. Build a new release

```bash
sudo -iu divvy
SHA=<full commit sha>                                  # the commit CI passed
git -C /srv/divvy/repo.git fetch --prune origin
git -C /srv/divvy/repo.git cat-file -e "$SHA^{commit}" && echo "commit found"
REL=/srv/divvy/releases/$(date -u +%Y%m%d%H%M%S)-${SHA:0:7}
mkdir "$REL"
git -C /srv/divvy/repo.git archive "$SHA" | tar -x -C "$REL"
echo "$SHA" > "$REL/REVISION"
ln -s /etc/divvy/divvy.env "$REL/.env"                 # the package scripts read ../../.env (build, db:deploy)
cd "$REL"
pnpm install --frozen-lockfile                         # also runs prisma generate
pnpm build                                             # NEXT_PUBLIC_* values are inlined here
```

### 2. Smoke-test it on spare ports

This step is not optional. If a new instance fails to boot, `pm2 reload` still prints ✓: it waits `listen_timeout` (15 s), stops the healthy old instance anyway, and the new one crash-loops. That was tested with PM2 7.1.1. Boot the new build next to the old one first:

```bash
cd "$REL/apps/api" && (NODE_ENV=production API_PORT=4001 timeout 40 node --env-file=/etc/divvy/divvy.env dist/server.js > /tmp/smoke-api.log 2>&1 &)
cd "$REL/apps/web" && (NODE_ENV=production API_INTERNAL_URL=http://127.0.0.1:4001 timeout 35 \
  node --env-file=/etc/divvy/divvy.env node_modules/next/dist/bin/next start -p 3001 -H 127.0.0.1 > /tmp/smoke-web.log 2>&1 &)
sleep 12
curl -fsS http://127.0.0.1:4001/api/health | jq -e '.ok and .mode == "live"'   # true
curl -fsS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:3001/          # web 200
# The worker with no roles: it parses the env, prints its settings and runs no jobs.
cd "$REL/apps/worker" && NODE_ENV=production WORKER_ROLES=none timeout 10 node --env-file=/etc/divvy/divvy.env dist/index.js > /tmp/smoke-worker.log 2>&1
grep '"msg":"worker started"' /tmp/smoke-worker.log || cat /tmp/smoke-worker.log
```

The worker line must show `"roles":["none"]` and the `cluster`, `mainnetEnabled`, `payoutsDryRun` and `delivery` you expect. `/api/health` answers HTTP 200 even when it reports `"ok":false`, which is why the check reads the body.

Anything else: read `/tmp/smoke-api.log`, `/tmp/smoke-web.log` and `/tmp/smoke-worker.log`, fix the problem, and don't go further. All three exit on their own (`timeout`) and serve no public traffic. The smoke API holds no keys and runs no jobs, and the worker with `WORKER_ROLES=none` starts nothing, so neither changes anything.

### 3. Migrate (only if the release adds migrations)

```bash
diff <(ls -1 /srv/divvy/current/packages/db/prisma/migrations) <(ls -1 "$REL/packages/db/prisma/migrations")
# Any ">" line means new migrations. Back up first, then apply:
/bin/bash "$REL/deploy/backup/pg-backup.sh"
cd "$REL" && pnpm db:deploy
```

Migrations must be **backward compatible** (expand, then contract). The old release keeps running against the new schema until the reload, and a rollback never undoes a migration. Ship a column drop or rename in a later release, once no running code uses the old shape.

### 4. Switch and reload

```bash
ln -sfn "$REL" /srv/divvy/current.next && mv -Tf /srv/divvy/current.next /srv/divvy/current   # atomic
pm2 reload  /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-web,divvy-api --update-env
rcli EXISTS divvy:lock:payouts        # must print 0 before the next line (helpers above)
pm2 restart /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-worker --update-env
pm2 reset all                                                                                    # zero the restart counters
```

PM2 cwds go through `/srv/divvy/current`, so each new process starts in the new release; the old releases stay intact. For a few seconds the two web instances serve different builds, so a browser can miss a JS chunk and reload. WebSocket clients are disconnected when the API instance swaps, and reconnect.

### 5. Verify, then save

```bash
sleep 30; pm2 ls                                        # all online, restarts still 0
curl -fsS http://127.0.0.1:4000/api/health | jq -c .   # "ok":true, "db":true, "redis":true
curl -fsS -o /dev/null -w '%{http_code}\n' https://divvy.example/
grep '"msg":"worker started"' /var/log/divvy/worker.out.log | tail -1
cat /srv/divvy/current/REVISION
pm2 logs --lines 30 --nostream
pm2 save                                                # what systemd brings back after a reboot
```

If the restart counts climb or health fails, **roll back now** (next section) and debug afterwards.

### 6. Prune old releases (keep five)

```bash
cd /srv/divvy/releases && ls -1dt */ | tail -n +6 | while read -r d; do
  [ "$(readlink -f "$d")" = "$(readlink -f /srv/divvy/current)" ] || rm -rf -- "$d"
done
```

### Config-only changes

- **Most values in `/etc/divvy/divvy.env`:** `sudoedit` the file, then run the reload and restart from step 4 (no new release). The env file is read again on every process start. The business values (`FEE_*`, `PAYOUT_DELIVERY`, `PAYOUTS_DRY_RUN`, `MIN_*`, `ADMIN_WALLETS` and the rest of that block) are read by both the API and the worker, so always do both.
- **`NEXT_PUBLIC_*` values:** these are inlined at build time, so deploy the same SHA again (steps 1 to 5). A new browser RPC origin also has to go into the CSP in the Nginx site first.
- **Nginx:** edit `/etc/nginx/sites-available/divvy.conf`, then `sudo nginx -t && sudo systemctl reload nginx`. When `deploy/nginx/divvy.conf` changes in the repo, diff it against the installed copy and carry the changes over by hand.

---

## Rollback

Every release in `/srv/divvy/releases` is fully built, so rolling back takes seconds:

```bash
sudo -iu divvy
ls -1dt /srv/divvy/releases/*/ | head -5; echo "current: $(readlink -f /srv/divvy/current)"
PREV=/srv/divvy/releases/<the release before>
ln -sfn "$PREV" /srv/divvy/current.next && mv -Tf /srv/divvy/current.next /srv/divvy/current
pm2 reload  /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-web,divvy-api --update-env
pm2 restart /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-worker --update-env
pm2 save; cat /srv/divvy/current/REVISION
```

**The database is not rolled back.** Expand/contract migrations keep the previous release working on the newer schema.

- **A migration failed halfway.** `pnpm db:deploy` errored, or the next one reports P3009, "failed migrations". Find the migration with `dbq -c 'SELECT migration_name, started_at, logs FROM _prisma_migrations WHERE finished_at IS NULL'`. Return the schema to its pre-migration state by hand, or finish the migration by hand. Then mark it with `cd "$REL/packages/db" && node --env-file=/etc/divvy/divvy.env ./node_modules/prisma/build/index.js migrate resolve --rolled-back <name>` (or `--applied <name>`), and deploy again.
- **A completed migration destroyed data.** Prefer a forward fix. Restoring the pre-deploy backup is the last resort, and it rewinds the ledger ([`pg-restore.md`](../deploy/backup/pg-restore.md), including step 5).

---

## Admin API

Admins are wallets listed in `ADMIN_WALLETS` (comma-separated; the API reads it at start, so reload the API after changing it). The admin page at `https://divvy.example/admin` covers the daily work: the launch switch with a reason, hot-wallet balances, late rounds, indexer lag, and the report queue with hide, resolve and dismiss. Use the API with curl when the page can't do it (hiding a coin nobody reported) or from the server:

1. Sign in on the site with the admin wallet.
2. In the browser's developer tools (Application or Storage, then Cookies), copy the value of `divvy_session`. It's a sign-in for 7 days: never paste it into a chat, a ticket or a file.
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

The worker sends alerts to Telegram when `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` are set. Each message reads "Divvy: \<text\>" after a red (critical), orange (warning) or blue dot. The same alert is sent at most once per window (30 minutes unless the table says otherwise); the throttle key is `divvy:alert:<key>`, and deleting it re-arms the alert. Every alert is also logged, with or without Telegram:

```bash
grep '"msg":"alert: ' /var/log/divvy/worker.out.log | tail -20 | jq -r '"\(.t) \(.severity) \(.key) \(.msg)"'
```

`alert: telegram refused` or `alert: telegram unreachable` in that output means the message didn't reach Telegram: check the token and chat ID.

### Payouts

| Alert text | What it means | What to do |
|---|---|---|
| Payouts stopped: on-chain fee rates {…} don't match the configured split {…} | Every payout run stops before the claim, dry-run included. The rates implied by `FEE_*` differ from LaunchLab's GlobalConfig (protocol rate) or Divvy's PlatformConfig on chain. Critical, hourly. | Compare the two objects. Don't change `FEE_*` or the PlatformConfig to make it pass: the split is the owner's call, and an on-chain change needs rules 2 and 3. Runs resume on the next tick once they match. |
| Payouts stopped: PlatformConfig.platform_fee_wallet is not the fee claimer key | `FEE_CLAIMER_KEYPAIR_PATH` loads a key that isn't the PlatformConfig's fee wallet. Critical, hourly. | Check the path against `pubkeys.txt`. After a key rotation, the PlatformConfig update has to land first ("Rotating a compromised hot wallet key", step 5). |
| Payouts stopped: no SOL price in the cache | `divvy:prices` is gone (1-hour TTL), so the prices job has been failing for about an hour. Critical, hourly. | "Prices missing". |
| Vault claim \<sig\> didn't land; fees roll into the next hour | A live vault claim failed on chain, or wasn't seen 5 minutes after it was signed. Its row is reset; the fees stay in the vault for the next hour's claim. | Confirm with `rpc getSignatureStatuses '[["<sig>"], {"searchTransactionHistory": true}]'`. If it repeats, check the fee claimer's SOL and the RPC. |
| Indexer is behind the vault claim (slot \<n\>); payouts wait for it | A live claim landed past the indexer's `platform` cursor, and attribution waited 3 minutes for it. Critical. | Fix the indexer ("Indexer lag above 60 seconds"). Each tick retries, but only until that hour ends (see "Limits of automatic recovery"). |
| Vault claim \<sig\>: paid less than indexed fees | The claim brought in less than the indexed platform fees for its slot range, so each coin's share was scaled down pro rata. A trade in the claim's own slot causes a small one; the rest arrives with the next claim. Live only in practice. | If it repeats or is large, look for a claim nobody recorded (a vault claim made outside the worker, or a `VaultClaim` row with no `attributedAt`) and tell the owner. |
| Vault claim \<sig\>: \<n\> lamports not tied to any trade | The claim brought in more than the indexed fees, by more than 1% of the claim or 0.01 SOL, whichever is larger. The surplus stays with Divvy and isn't paid to holders. Usually missed trades. Live only in practice. | Check the indexer (cursor, "Trade on an unknown pool" alerts) and tell the owner. Never edit `FeeAllocation`. |
| \<SYMBOL\> swap for \<hour\> not done: \<reason\>. Holders' share carries to the next round. | The asset's swap batch is skipped (`SwapBatch.status = 'skipped'`), its rounds become `carried` with the reason in `error`, and the lamports go back to the pool for the next hour. Reasons: the token is paused by its issuer; the transfer hook is enabled (critical); no route; price impact over `MAX_SWAP_IMPACT_BPS`; the quote is off the reference price (critical, also sent when the price cache has no price for the asset); the swap failed on chain or expired. | Nothing, if it's one hour. If it repeats, check the asset's route on Jupiter and its price in `divvy:prices`. Don't raise `MAX_SWAP_IMPACT_BPS` or `SWAP_SLIPPAGE_BPS` without the owner. |
| Fee claimer holds less SOL than the holders' share it must swap | The fee claimer's balance is under the swap amount plus 0.02 SOL. The run stops at the swap (rounds stay `allocated`) and every tick retries. The claimed fees should be sitting in that wallet, so SOL has left it. Critical. | Compare its balance with the unswapped holders' share ("Hot wallet below threshold"). A drop you can't explain is a compromised key. Top-ups need the owner. |
| \<n\> payout round(s) for \<hour\> are late | Rounds not delivered by the hour + 60 minutes + `LATE_AFTER_SEC` (15 minutes) are marked `late` and show red. "(dry-run)" at the end means dry-run rounds. Critical. | "Payout round late or failed". |
| No \<SYMBOL\> price; deliveries for it wait | Live delivery can't apply its USD thresholds without the asset's price. Credits stay where they are. | "Prices missing". Deliveries resume once the price is back. |
| \<SYMBOL\> is paused by its issuer; deliveries wait (or: is using a transfer hook) | The asset's Token-2022 mint is paused or has a transfer hook. No pushes and no claims for it (claims answer that the asset is paused or can't be claimed). Credits stay. Critical. | Tell the owner and watch the issuer's notices. A transfer hook needs code support before payouts of that asset can go out. |
| Payout vault holds \<n\> \<SYMBOL\> base units but owes \<m\> for this delivery; sends stopped | The ledger owes more of that asset than the payout vault holds. Pushes of that asset stop. Critical. | Stop and tell the owner. Run the credits check in "Switching dry-run to live". Never send tokens by hand or edit `Credit`. If it can't be explained, go back to dry-run. |

### Launches, indexer and wallets

| Alert text | What it means | What to do |
|---|---|---|
| Launch create attempt failed (\<reason\>) | One create attempt didn't land: `bundle Invalid`, `bundle Failed` or `bundle timed out` on mainnet. The worker tries 3 times with the same mint. At most once per 15 minutes. | If it repeats, "Jito bundle failure rate high". |
| Launcher hourly spend cap reached; launches are being refused | This UTC hour's reserved launcher spend (an estimated 0.04 SOL plus `JITO_TIP_LAMPORTS` per launch) passed `LAUNCHER_HOURLY_CAP_LAMPORTS`. New launches fail with "Launches are busy right now". The count resets at the next UTC hour. | `rcli GET "divvy:launcher-spend:$(date -u +%Y-%m-%dT%H)"` shows the lamports reserved this hour. Real demand: raising the cap is the owner's call (env change, then restart the worker). Otherwise look for abuse and consider pausing launches. |
| Indexer is \<n\>s behind | The newest PlatformConfig transaction has waited more than 60 seconds to be indexed. Critical, every 15 minutes. | "Indexer lag above 60 seconds". |
| Indexer stopped on \<sig\>: \<error\>. Fee attribution is paused until this is fixed. | A transaction the decoder can't read. The cursor stops on purpose, because fees must be exact. Critical, hourly. | "Indexer lag above 60 seconds", the decoder case. |
| Trade on an unknown pool \<pool\> (\<sig\>) | A LaunchLab trade under Divvy's PlatformConfig on a pool that no `Coin` row has. The trade isn't stored, so its platform fee will show up as unattributed in the next live claim. Once a day per pool. | `dbq -c "SELECT id, ticker, status FROM \"Coin\" WHERE \"poolState\" = '<pool>'"`. No row: the pool was created outside Divvy, or its coin row was lost (a database restore, or a launch marked failed whose create landed later). Tell the owner. |
| \<role\> hot wallet is low: \<x\> SOL | `launcher`, `payout_vault` or `fee_claimer` holds less than `HOT_WALLET_MIN_SOL` (0.5 SOL by default). Every 6 hours. | "Hot wallet below threshold". |
| Jupiter returned no SOL price; the previous cache stays until it expires | One prices run got no SOL price. The cache lasts an hour. | If it repeats, "Prices missing". |

Two alerts come from outside the worker:

- **The backup script:** "Divvy database backup failed on \<host\>: \<reason\>. Check /var/log/divvy/backup.log." Go to "Backup failed".
- **The external uptime check** on `https://divvy.example/api/health`. Go to "Web or API returns 502/504".

---

## Payouts: dry-run and going live

**What a run does.** Every 10 minutes the worker runs the current hour and, if any of the previous hour's rounds aren't `delivered`, resumes that hour first (`apps/worker/src/payouts/engine.ts`):

1. **Checks.** The on-chain fee rates and fee wallet must match the config (`Payouts stopped: …`), and the price cache must have a SOL price. A live run also passes the mainnet gate.
2. **Claim.** One vault claim per hour (`VaultClaim`, unique per hour and mode). Live: `claim_platform_fee_from_vault`, signed by the fee claimer; the row is written before the transaction is sent, so a crash can't lose a claim. Dry-run: nothing is signed. The claim is simulated as exactly the indexed fees since the previous dry-run claim, and the real vault balance is logged next to it (`payouts: dry-run vault claim`).
3. **Attribution.** The claim is split per coin from the indexed `Trade."platformFee"` (curve trades in `fromSlot < slot <= toSlot`) into `FeeAllocation` rows (holders' and Divvy's buckets). A live claim waits for the indexer to reach its slot.
4. **Rounds.** Per coin, a holders' bucket under `MIN_ROUND_USD` becomes a `carried` round and stays in the pool. Otherwise a `PayoutRound` opens at step `allocated` (unique per coin, hour and mode).
5. **Swaps.** One Jupiter swap per dividend asset (`SwapBatch`), shared pro rata between its rounds. Dry-run takes the quote. A refused swap carries the bucket to the next hour (see the swap alert).
6. **Snapshot.** Holders are read from the chain (Helius DAS, falling back to `getProgramAccounts`), excluded wallets and holders under `MIN_HOLDER_USD` are left out (`HolderBalance."excludedReason"`), and entitlements are written as `PayoutItem` rows. Live rounds also add to each wallet's `Credit`.
7. **Delivery** (live only). Credits move out of the payout vault in batches of `PUSH_BATCH_SIZE`. A credit is debited in the same database transaction that records the `PayoutTransfer`, before sending; the transfer reconciler confirms it, or gives the credit back once its blockhash expires. Both models send to wallets that already hold the asset's token account once the credit passes `AUTO_PUSH_MIN_USD`. Push also creates the account for the others once their credit passes `PUSH_NEW_ATA_MIN_USD`; under claim, they claim from their page and pay their own account rent.
8. **Finish.** Rounds become `delivered`, with status `late` past the deadline.

Dry-run still loads the fee claimer and payout vault keys: the first to check the PlatformConfig fee wallet, the second to quote swaps into its token account. It never signs with them.

### First dry-run hours: what to check

Do this as divvy (`sudo -iu divvy`, then paste the helpers). These checks should pass for every hour of the dry-run period before you ask the owner to go live.

1. **The worker runs dry-run with every role.**
   ```bash
   grep '"msg":"worker started"' /var/log/divvy/worker.out.log | tail -1
   grep -E '"msg":"payouts: (run|failed)"' /var/log/divvy/worker.out.log | tail -6 | jq -c '{t, msg, hour, dryRun, claimedLamports, rounds, error}'
   ```
   Expect `"payoutsDryRun":true`, all seven roles, and a `payouts: run` line every 10 minutes with `"dryRun":true`.
2. **The simulated claims add up to the real vault.** Each hour logs the real vault balance next to the simulated claim:
   ```bash
   grep '"msg":"payouts: dry-run vault claim"' /var/log/divvy/worker.out.log | tail -6 | jq -c '{t, hour, toSlot, indexed, vaultBalance}'
   dbq -c "SELECT hour, lamports, sum(lamports) OVER (ORDER BY hour) AS cumulative, \"unattributedLamports\", \"fromSlot\", \"toSlot\"
           FROM \"VaultClaim\" WHERE \"dryRun\" ORDER BY hour DESC LIMIT 6"
   ```
   While nothing has ever claimed the vault, each hour's `cumulative` (every indexed platform fee since slot 0) should match that hour's `vaultBalance`, give or take the trades that landed between the cursor read and the balance read. Those show up in the next hour. A gap that grows hour after hour means fees reach the vault that the indexer doesn't see: tell the owner before going live. `vaultBalance` of `-1` means the balance read failed.
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
- The fee claimer holds SOL for its transaction fees, and each swap needs 0.02 SOL of headroom over its amount (the claimed fees fund the swaps themselves). The payout vault holds SOL for its transaction fees and, under push, for new holders' token accounts. Funding needs the owner's approval.
- The delivery model in `PAYOUT_DELIVERY` is the one the owner chose (HANDOFF §3.4).
- **The owner knows the size of the first round.** Live claims start from slot 0 (no live claim exists yet), and nothing has claimed the vault during dry-run. So the first live run sweeps everything the vault has collected since launch, and its rounds pay the holders' share of all of it to whoever holds at that snapshot. The amount is the latest `vaultBalance` in step 2 above.

**Steps.** Do this between minutes 20 and 50 of an hour, so the switch doesn't meet the minute-0 run.

1. From your admin shell: `sudoedit /etc/divvy/divvy.env` and set `PAYOUTS_DRY_RUN=false`.
2. As divvy, check the new settings, then reload and restart:
   ```bash
   rcli EXISTS divvy:lock:payouts                         # 0
   cd /srv/divvy/current/apps/worker && NODE_ENV=production WORKER_ROLES=none timeout 10 node --env-file=/etc/divvy/divvy.env dist/index.js 2>&1 | grep '"worker started"'
   #   expect "payoutsDryRun":false and, on mainnet, "mainnetEnabled":true
   pm2 reload  /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-web,divvy-api --update-env
   pm2 restart /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-worker --update-env
   ```

The next tick runs the current hour live. Then check:

```bash
grep -E '"msg":"payouts: (run|failed)"' /var/log/divvy/worker.out.log | tail -1 | jq -c .     # "dryRun":false
dbq -c "SELECT purpose, signer, signature, \"createdAt\" FROM \"SignedTx\"
        WHERE \"createdAt\" > (now() AT TIME ZONE 'UTC') - interval '2 hours' ORDER BY \"createdAt\""
dbq -c "SELECT hour, sig, lamports, \"unattributedLamports\", \"fromSlot\", \"toSlot\", \"attributedAt\"
        FROM \"VaultClaim\" WHERE NOT \"dryRun\" ORDER BY hour DESC LIMIT 3"
dbq -c "SELECT r.hour, c.ticker, r.status, r.step, r.\"solIn\", r.\"assetOut\", r.\"holdersPaid\", r.\"swapSig\", r.error
        FROM \"PayoutRound\" r JOIN \"Coin\" c ON c.id = r.\"coinId\" WHERE NOT r.\"dryRun\" ORDER BY r.hour DESC, c.ticker LIMIT 30"
dbq -c "SELECT status, count(*), count(DISTINCT sig) AS transactions FROM \"PayoutTransfer\" GROUP BY 1"
```

- `SignedTx` shows `fees.claim_platform` and `payout.swap` (signer `fee_claimer`), then `payout.send` (signer `payout_vault`) once credits pass their thresholds. Write the signatures in the ops log.
- The first live `VaultClaim` has `fromSlot` 0, and its `lamports` are close to the last dry-run `vaultBalance`. `unattributedLamports` stays small; anything over the tolerance raises an alert.
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
2. Set `PAYOUT_DELIVERY=claim` (or `push`) in the env file, then reload the API and restart the worker (Deploy step 4). Do both together: while they disagree, claim requests are refused by one side or the other.
3. Check `curl -fsS http://127.0.0.1:4000/api/config | jq .payouts.delivery` and the `"delivery"` field in the new `worker started` line.

Credits carry over in `Credit` either way. Transfers and claims already pending settle on their own: the transfer reconciler runs with the `payouts` role and the claim reconciler with the `claims` role, whatever the mode.

### Back to dry-run

Set `PAYOUTS_DRY_RUN=true`, then reload the API and restart the worker (Deploy step 4). From the next tick:

- No vault claims, swaps or pushes. Live rounds of the current and previous hour stop where they are. They resume only if live mode is back within that window ("Limits of automatic recovery").
- Pending `PayoutTransfer` and `Claim` rows still settle, because the reconcilers don't depend on the mode.
- Under claim, holders can still claim their existing credits: the claim builder doesn't look at dry-run. To stop that too, drop `claims` from `WORKER_ROLES` (claim requests then fail with "Building the claim took too long"), or turn off the mainnet gate.

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
   pm2d describe divvy-worker | grep -E 'status|restarts|uptime'
   pgrep -af 'apps/worker/dist/index.js'                 # exactly one line
   ```
2. What the runs said:
   ```bash
   grep '"msg":"payouts' /var/log/divvy/worker.out.log | tail -20 | jq -c '{t, msg, hour, dryRun, rounds, error, coinId, asset}'
   ```
   - `payouts: run` ends every successful tick, with the hour's counts.
   - `payouts: resuming the previous hour` comes before it when the previous hour wasn't finished.
   - `payouts: failed` carries the error that stopped the tick.
   - `payouts: another worker holds the lock, skipping` means the lock is held (see Fix).
   - `payouts: snapshot failed, will retry` and `payouts: swap outcome unknown, will check next run` name a coin or an asset that the next tick retries.
3. The lock:
   ```bash
   rcli GET divvy:lock:payouts; rcli PTTL divvy:lock:payouts   # PTTL in ms; -2 means no lock
   ```
4. Where the hour stopped:
   ```bash
   dbq -c "SELECT hour, \"dryRun\", sig, lamports, \"unattributedLamports\", \"fromSlot\", \"toSlot\", \"attributedAt\"
           FROM \"VaultClaim\" ORDER BY hour DESC, \"dryRun\" LIMIT 6"
   dbq -c "SELECT r.hour, r.\"dryRun\", r.status, r.step, count(*) FROM \"PayoutRound\" r
           WHERE r.hour >= date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '2 hours'
           GROUP BY 1, 2, 3, 4 ORDER BY 1 DESC, 2"
   dbq -c "SELECT b.hour, a.symbol, b.\"dryRun\", b.status, b.\"lamportsIn\", b.sig, b.error, b.\"updatedAt\"
           FROM \"SwapBatch\" b JOIN \"DividendAsset\" a ON a.id = b.\"assetId\"
           WHERE b.hour >= date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '2 hours' ORDER BY b.hour DESC"
   ```

   | What you see | Where the run stops |
   |---|---|
   | No `VaultClaim` row for the hour | Before the claim: the rates check, no SOL price, the mainnet gate, or no tick ran at all (lock, Redis, worker). The error is in `payouts: failed`. |
   | `VaultClaim` without `attributedAt` | Attribution is waiting for the indexer ("Indexer lag above 60 seconds"). |
   | Rounds at `allocated` | The swap. `SwapBatch` `sent`: waiting for the swap's outcome. `pending`: the fee claimer is short, or the run failed before signing. |
   | Rounds at `swapped` | The holder snapshot: look for `payouts: snapshot failed, will retry` and check the RPC. |
   | Rounds at `snapshotted` | Live delivery failed before the finish step; the error is in `payouts: failed`. |

5. Usual causes, each with its own playbook: RPC down, Redis down (no lock means no tick), prices missing, the indexer behind, the fee claimer short of SOL, or a Jupiter swap refused by the impact or quote check. That last one carries the bucket by design; it doesn't make a round late.

**Fix:**

- **Stale lock.** A worker killed mid-run never releases `divvy:lock:payouts`; it expires 15 minutes after it was taken. The lock is stale when it's older than the worker process: it was taken 900 000 ms minus its `PTTL` ago, and `pm2d describe divvy-worker` shows the uptime. If it's older, run `rcli DEL divvy:lock:payouts`; the next tick runs normally.
- **Re-running.** There is no manual command. The worker resumes on its own every 10 minutes from the last completed step, for the current hour and the previous one. Fix the cause, and the next tick finishes the round (marked `late` if it's past the deadline). Never delete or edit `PayoutRound`, `PayoutItem` or the other ledger rows to force a run, and never send tokens by hand.
- **Not fixable within the grace period.** The round stays `late` and is still finished once the cause is fixed, as long as that happens within the window below. Tell the owner.

**Limits of automatic recovery.** These need the owner and a code change, not a row edit:

- Only the current and the previous hour are resumed. A round that still isn't `delivered` two hours after its hour stays at its step, and its lamports or swapped tokens stay with it.
- A previous hour is resumed only when it has `PayoutRound` rows. A live `VaultClaim` that was never attributed (the indexer stayed behind past the end of its hour) isn't retried: its lamports stay in the fee claimer, and the next hour's attribution reports "paid less than indexed fees".
- When resuming the previous hour fails, that tick doesn't run the current hour either.

```bash
dbq -c "SELECT hour, \"dryRun\", sig, lamports, \"createdAt\" FROM \"VaultClaim\" WHERE \"attributedAt\" IS NULL ORDER BY hour"
dbq -c "SELECT r.hour, r.\"dryRun\", r.step, count(*) FROM \"PayoutRound\" r
        WHERE r.step <> 'delivered' AND r.hour < date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '1 hour'
        GROUP BY 1, 2, 3 ORDER BY 1"
```

### Payout transfers or claims stuck pending

**Signs:** a holder says a payout didn't arrive, a claim answers "You have a claim waiting", or `PayoutTransfer` or `Claim` rows stay `pending`.

Every minute, `transfers-reconcile` (the `payouts` role) and `claims-reconcile` (the `claims` role) settle them from the chain:

- **Confirmed:** the wallet's credited `PayoutItem` rows for that asset become `sent` (a transfer) or `claimed` (a claim).
- **Failed, or expired** (no status once the chain is past `lastValidBlockHeight`): the credit is given back (`deliver: transfer expired, credit restored`) and the next delivery tries again.

**Check:**

```bash
dbq -c "SELECT sig, count(*) AS wallets, sum(amount) AS amount, min(\"createdAt\") AS since, \"lastValidBlockHeight\"
        FROM \"PayoutTransfer\" WHERE status = 'pending' GROUP BY sig, \"lastValidBlockHeight\" ORDER BY since"
dbq -c "SELECT id, wallet, amount, sig, \"lastValidBlockHeight\", \"createdAt\" FROM \"Claim\" WHERE status = 'pending' ORDER BY \"createdAt\""
rpc getBlockHeight
rpc getSignatureStatuses '[["<sig>"], {"searchTransactionHistory": true}]'
grep -E '"msg":"(transfers-reconcile|claims-reconcile|deliver)' /var/log/divvy/worker.out.log | tail -10
```

**Fix:** nothing by hand. Rows still pending well past their block height mean the reconcilers aren't running or can't reach the RPC (`transfers-reconcile: failed`, `claims-reconcile: failed`): see "RPC down". Never re-send, and never edit `Credit`.

**One holder's payouts:**

```bash
W='<wallet address>'
dbq -c "SELECT r.hour, c.ticker, i.\"amountAsset\", i.status, i.\"sendSig\" FROM \"PayoutItem\" i
        JOIN \"PayoutRound\" r ON r.id = i.\"roundId\" JOIN \"Coin\" c ON c.id = r.\"coinId\"
        WHERE i.wallet = '$W' AND NOT r.\"dryRun\" ORDER BY r.hour DESC LIMIT 20"
dbq -c "SELECT a.symbol, cr.amount FROM \"Credit\" cr JOIN \"DividendAsset\" a ON a.id = cr.\"assetId\" WHERE cr.wallet = '$W'"
dbq -c "SELECT c.ticker, h.\"snapshotHour\", h.balance, h.\"excludedReason\" FROM \"HolderBalance\" h JOIN \"Coin\" c ON c.id = h.\"coinId\"
        WHERE h.wallet = '$W' ORDER BY h.\"snapshotHour\" DESC LIMIT 20"
```

`excludedReason = 'small'` means the holding was under `MIN_HOLDER_USD` at the snapshot. A `credited` item with a `Credit` balance is waiting for a threshold: `AUTO_PUSH_MIN_USD` for a wallet that holds the asset's token account, `PUSH_NEW_ATA_MIN_USD` for one that doesn't (push), or for the holder to claim (claim).

### Launch stuck in "bundling"

**Signs:** the launch modal sits on step 2, or a `Launch` row stays `step = 'bundling'` for more than 5 minutes. Up to about 4 minutes is normal: the worker makes 3 attempts with the same mint, each polling Jito for up to 60 seconds.

**Check:**

```bash
dbq -c "SELECT id, step, attempts, \"bundleId\", \"lastValidBlockHeight\", (now() AT TIME ZONE 'UTC') - \"updatedAt\" AS since_update
        FROM \"Launch\" WHERE step IN ('checking', 'bundling') ORDER BY \"createdAt\""
rpc getBlockHeight                       # past lastValidBlockHeight: that create can no longer land
grep -E '"msg":"launch(-reconcile)?: ' /var/log/divvy/worker.out.log | tail -20
```

Ask Jito about the bundle (docs/verified/jito-jupiter-xstocks.md §1.1, §1.7 and §1.9). `getInflightBundleStatuses` covers the last 5 minutes and answers `Invalid`, `Pending`, `Failed` or `Landed`. Stay under 1 request per second per region; the worker uses the same budget. The worker appends `/api/v1/…` to `JITO_BLOCK_ENGINE_URL`, so that value is a bare host (empty means `https://mainnet.block-engine.jito.wtf`).

```bash
JITO=$(divvy_env JITO_BLOCK_ENGINE_URL)
curl -fsS "${JITO:-https://mainnet.block-engine.jito.wtf}/api/v1/getInflightBundleStatuses" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getInflightBundleStatuses","params":[["<bundleId>"]]}'
```

Also check the launcher wallet's balance ("Hot wallet below threshold").

**Fix:**

- **Let the reconciler finish it.** Every minute, `launch-reconcile` looks at launches that have sat in `bundling` for 90 seconds: if the mint account exists, the launch is marked landed and the coin goes live; once the chain is past `lastValidBlockHeight` without it, the launch is marked failed. A failed launch releases its ticker, picture and X account, so the user can launch again (with a new mint). Launches stuck in `checking` for 5 minutes are re-queued. Don't edit the rows.
- **Rows stay in `bundling` well past the block height.** The reconciler isn't running or can't reach the RPC: look for `launch-reconcile: failed` and see "RPC down".
- **Never** resend the create through an RPC, and never post the pending mint address or signature anywhere (CLAUDE.md rule 6).
- **Many stuck at once.** Go to "Jito bundle failure rate high", and consider pausing launches.

### Indexer lag above 60 seconds

**Signs:** the alert "Indexer is \<n\>s behind" or "Indexer stopped on …", trades, candles or curve progress stop moving, `indexerLagSec` on the admin page, or the payout alert "Indexer is behind the vault claim".

**Check:**

```bash
dbq -c "SELECT name, \"lastSlot\", \"lastSignature\", (now() AT TIME ZONE 'UTC') - \"updatedAt\" AS since_update FROM \"IndexerCursor\" ORDER BY name"
rpc getSlot                                   # chain tip; (tip - lastSlot) × ~0.4 s ≈ seconds behind
rcli GET divvy:status | jq '{at: (.at / 1000 | todate), indexerSlot, indexerLagSec}'
grep -E '"msg":"(indexer|market-stats)' /var/log/divvy/worker.out.log | tail -10
grep '"msg":"alert: Indexer stopped' /var/log/divvy/worker.out.log | tail -3
```

The `platform` cursor follows Divvy's PlatformConfig (every create, curve trade and migration); `cpmm:<pool>` cursors follow graduated coins' pools. A cursor only moves when a new transaction arrives, so an old `since_update` on a quiet chain is fine; `indexerLagSec` is the real measure.

**Fix:**

- **The RPC is failing** (`indexer: tick failed` with RPC errors). See "RPC down".
- **The decoder stopped on a transaction** ("Indexer stopped on \<sig\>: …"). The cursor stays on the last good transaction on purpose. Don't move or delete it: skipping a trade loses its fees. The decoder in `packages/solana/src/live` needs a fix confirmed against the IDL and logged in `docs/VERIFIED.md` (rule 2). Deploy it and restart the worker; the indexer resumes from the cursor. A restart without a fix stops on the same transaction again. While it's stopped, live payouts wait at attribution.
- **The worker is stuck.** Restart it, but only once `rcli EXISTS divvy:lock:payouts` prints `0`, because the indexer and payouts share one process: `pm2d restart divvy-worker`.
- **Catching up is automatic.** Each tick walks every signature since the cursor, oldest first, 1,000 per page. After an outage it catches up without help.
- **Before the next round:** per-coin fee attribution comes from indexed trades (docs/VERIFIED.md item 6), so a live claim isn't attributed until the `platform` cursor reaches its slot. Once the lag clears, check the claim's `unattributedLamports` and the attribution alerts.

### Prices missing

**Signs:** "Payouts stopped: no SOL price in the cache", "No \<SYMBOL\> price", "Jupiter returned no SOL price", or USD figures on the site reading 0.

```bash
rcli TTL divvy:prices                                      # seconds left; -2 means gone
rcli GET divvy:prices | jq '{solUsd, at: (.at / 1000 | todate), assets: (.byMint | length)}'
grep -E '"msg":"prices: ' /var/log/divvy/worker.out.log | tail -5   # "prices: failed" carries Jupiter's error
```

The prices job reads Jupiter's Price API every minute and keeps the result for an hour. If Jupiter is down, wait; past the hour, payouts stop until a price is back. For a key problem, fix `JUP_API_KEY` in the env file, then reload the API (it uses Jupiter for trades on graduated coins) and restart the worker.

### Hot wallet below threshold

The three hot wallets:

- **Launcher:** create rent and Jito tips. Its spend is capped per UTC hour by `LAUNCHER_HOURLY_CAP_LAMPORTS`.
- **Payout vault:** holds the dividend tokens; pays transaction fees for pushes and claims, and token-account rent for new holders under push.
- **Fee claimer:** signs vault claims and swaps; holds the claimed SOL until it's swapped.

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

**Signs:** the alert "Launch create attempt failed (…)" keeps coming back, launches fail or stick in bundling.

**Check:**

```bash
dbq -c "SELECT step, count(*), round(avg(attempts), 2) AS avg_attempts FROM \"Launch\"
        WHERE \"createdAt\" > (now() AT TIME ZONE 'UTC') - interval '1 hour' GROUP BY 1"
dbq -c "SELECT error->>'code' AS code, error->>'message' AS message, count(*) FROM \"Launch\"
        WHERE step = 'failed' AND \"createdAt\" > (now() AT TIME ZONE 'UTC') - interval '1 hour' GROUP BY 1, 2"
grep '"msg":"launch: attempt failed"' /var/log/divvy/worker.out.log | tail -20 | jq -c '{t, attempt, error}'
curl -fsS https://bundles.jito.wtf/api/v1/bundles/tip_floor; echo        # tip levels (docs/verified/jito-jupiter-xstocks.md §1.5)
grep -iE 'jito|429' /var/log/divvy/worker.out.log | tail -20
```

- Is Jito's status page reporting trouble in our region (regions: same file, §1.8)?
- Are we over 1 request per second per IP per region (HTTP 429 in `jito sendBundle: HTTP …` errors)?
- Is `JITO_TIP_LAMPORTS` (default 100,000 lamports) below the 50th to 75th percentile of the floor?
- Is the launcher short of SOL, so simulation fails?

**Fix:**

- **Region trouble or 429s:** point `JITO_BLOCK_ENGINE_URL` at another region's host in `/etc/divvy/divvy.env`, then restart the worker (only the worker talks to Jito).
- **Tip too low:** raise `JITO_TIP_LAMPORTS` with the owner's approval, then restart the worker. Each launch counts its tip against the launcher's hourly cap.
- **Failures continue:** pause launches. **Never** fall back to sending creates through an RPC.

### RPC down

**Signs:** trade-box build errors, indexer lag, payout runs failing, `launch-reconcile: failed` or `transfers-reconcile: failed`.

**Check:**

```bash
rpc getHealth          # "ok"
rpc getSlot            # should advance between calls
```

Look at the provider's status page.

**Fix:**

- **Server side.** Switch `SOLANA_RPC_URL` and `SOLANA_WS_URL` in `/etc/divvy/divvy.env` to the backup provider. Keep that provider's details in the ops log beforehand. Holder snapshots try Helius DAS first and fall back to `getProgramAccounts`, so a non-Helius backup works; set `HOLDERS_VIA_DAS=false` to skip the failing DAS call. Then reload the API and restart the worker (Deploy step 4, minding the payout lock).
- **Browser side.** `NEXT_PUBLIC_SOLANA_RPC_URL` is baked into the web build:
  1. Add the new origin, as both `https://` and `wss://`, to `connect-src` in the Nginx CSP, then run `sudo nginx -t && sudo systemctl reload nginx`.
  2. Change the value in the env file.
  3. Redeploy the same SHA (Deploy steps 1 to 5).

### Redis down

**What breaks:**

- **The whole API.** Every request passes the rate limiter, which keeps its counters in Redis and doesn't skip on errors, so every route answers HTTP 500 ("Reached the max retries per request limit"), `/api/health` included. It recovers on its own when Redis is back.
- Sign-in (SIWS nonces) and X linking.
- Worker jobs: no job can take its lock, so no payout tick, reconciler, prices or status run (`<job>: failed`). The launch and claim queues are in Redis too.
- Live events, the price cache and the worker status.

**Check:**

```bash
systemctl status redis-server --no-pager; sudo journalctl -u redis-server -n 50 --no-pager
rcli ping
rcli INFO persistence | grep -E 'rdb_last_bgsave_status|aof_last_write_status'
rcli INFO memory | grep -E 'used_memory_human|maxmemory_human'
df -h /var/lib/redis
```

**Fix:**

- **Stopped or crashed:** run `sudo systemctl restart redis-server`. The apps reconnect on their own; confirm with `pm2d logs --lines 30 --nostream` and `curl -fsS http://127.0.0.1:4000/api/health`.
- **`MISCONF ... RDB snapshots`:** the disk is full or failing. Free space, then run `rcli BGSAVE`; Redis accepts writes again after a good save.
- **`OOM command not allowed`:** `maxmemory` is reached under `noeviction`. Find the large keys with `rcli --bigkeys`, raise `maxmemory` in `/etc/redis/redis.conf`, and restart Redis. Never switch to an evicting policy: locks, nonces and queues must not vanish silently.
- **Afterwards:** check that the next payout tick ran (the payout playbook). Losing Redis data is acceptable, because correctness lives in Postgres (unique coin + hour). Lost launch jobs are re-queued by the launch reconciler after 5 minutes; a lost claim request just fails, and the holder tries again.

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
   - Payout vault or fee claimer: set `PAYOUTS_DRY_RUN=true` in `/etc/divvy/divvy.env`, then `pm2d restart divvy-worker --update-env`. That stops vault claims, swaps and pushes. Under claim, the payout vault also signs holder claims; to stop those, drop `claims` from `WORKER_ROLES` before the restart.
   - Everything at once, on mainnet: `DIVVY_MAINNET_ENABLED=false` and restart the worker. Nothing is signed and sent after that.
   - Tell the owner now. Moving the remaining funds and funding a new wallet are both spends (rule 3).
2. **Create a new keypair** under a new file name, for example `/etc/divvy/keys/launcher-20261026.json`, with the command in `deploy/setup-vps.md` §8. Append its public key to `pubkeys.txt`.
3. **With the owner's approval,** sweep what's left in the compromised wallet to the owner's treasury (speed matters), then fund the new wallet minimally. Log both signatures.
4. **Point the app at the new key:** change the matching `*_KEYPAIR_PATH` in `/etc/divvy/divvy.env` and restart the worker (the API holds no keys). Pending `PayoutTransfer` and `Claim` rows signed by the old payout vault still settle from the chain. A new payout vault starts without the dividend tokens that back the holders' credits, so pushes stop with "Payout vault holds … but owes …" until it holds them again (the owner's call, rule 3).
5. **On-chain roles.** If the wallet is named in Divvy's PlatformConfig (`platform_fee_wallet`, `platform_nft_wallet`, `platform_cp_creator`; docs/verified/launchlab.md), the PlatformConfig admin has to update it, and any Fee Key NFTs the old wallet holds have to move. Until `platform_fee_wallet` names the new fee claimer, every payout run stops with "PlatformConfig.platform_fee_wallet is not the fee claimer key".
   - Confirm the exact instruction against the SDK and log it in `docs/VERIFIED.md` before sending (rule 2). Updates may be rate-limited per epoch (open question 8 in launchlab.md).
   - Send only with the owner's approval.
6. **Remove the old file:** `sudo shred -u /etc/divvy/keys/<old>.json`. This is best effort on SSDs. The key is burned either way; its encrypted offline copy is now worthless too.
7. **Find the leak.**
   - Check who could read `/etc/divvy/keys` and who logged in (`last`, `/var/log/auth.log`).
   - Check whether key material ever reached logs, shell history, backups or CI.
   - If root on the server may be compromised, rotate everything: database and Redis passwords, every session (`DELETE FROM "Session";` signs everyone out), the hot-wallet keys (move funds to fresh keys first), the RPC, Jito, Jupiter and Telegram keys, and the GitHub deploy key. Then **rebuild the VPS from scratch** (`deploy/setup-vps.md`) instead of cleaning it in place.
8. **Switch payouts back on** (`PAYOUTS_DRY_RUN=false`, and `claims` back in `WORKER_ROLES`) only with the owner's approval.

### Restoring a backup

Follow [`deploy/backup/pg-restore.md`](../deploy/backup/pg-restore.md). In short:

1. Verify the checksum.
2. Restore into a scratch database and check it.
3. Pause launches and force payout dry-run.
4. Swap databases by renaming, so the old one is kept.
5. Run `pnpm db:deploy`.
6. **Reconcile with the chain** before resuming launches, claims or live payouts.

### Web or API returns 502/504

```bash
pm2d ls; pm2d jlist | jq -r '.[] | "\(.name) \(.pm2_env.status) restarts=\(.pm2_env.restart_time)"'
curl -sS http://127.0.0.1:4000/api/health; echo; curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
pm2d logs divvy-api --lines 100 --nostream
sudo tail -50 /var/log/nginx/divvy.error.log
df -h / /var/lib/postgresql; free -m
```

- **Right after a deploy, or with restart counts climbing:** roll back first.
- **Health answers 500 "Reached the max retries per request limit":** Redis is down ("Redis down").
- **Health answers `"ok":false`:** look at `db` and `redis` in the body.
- **An app shows `errored`:** it hit 30 fast restarts. Fix the cause, then `pm2d reset <app> && pm2d restart <app>`.
- **Restarts every few minutes with nothing in the logs:** it's hitting `max_memory_restart` (web 700 MB, API and worker 512 MB). Look for a leak before raising the limit.

### Backup failed

```bash
tail -30 /var/log/divvy/backup.log
sudo -u divvy -H /bin/bash /srv/divvy/current/deploy/backup/pg-backup.sh     # run it by hand
```

Usual causes:

- the disk is full;
- the database password changed and `DATABASE_URL` wasn't updated;
- the rclone remote's credentials expired (re-run `rclone config` as divvy).

Older dumps are only rotated out after a successful run, so a failing job never deletes good backups.

---

## Routine checks

- **Daily:**
  - `pm2d ls`: everything online, with restart counts stable.
  - The admin page (or `admin GET /api/admin/overview`): launches open or paused as intended, no wallet low, `lateRounds` 0, `indexerLagSec` small, and `mainnetEnabled` and `dryRun` as the owner set them.
  - No critical alerts in the worker log since yesterday ("Alerts").
  - The last line of `backup.log` reads `done`.
  - Disk use is under 80% (`df -h`).
- **Weekly:**
  - `sudo certbot certificates`: more than 30 days left.
  - Hot wallet balances against the thresholds, and (live) the credits check in "Switching dry-run to live".
  - `sudo apt-get update && sudo apt-get -y upgrade`. After a reboot, check that `pm2d ls` came back on its own.
- **Monthly:**
  - A restore drill (pg-restore.md, steps 1 to 3) from a local dump and from an offsite one.
  - Prune old releases.
  - Re-read this runbook against the code: alert texts (`grep -rn 'alerts.send(' apps/worker/src`), job schedules (`apps/worker/src/index.ts`) and env names (`.env.example`).
