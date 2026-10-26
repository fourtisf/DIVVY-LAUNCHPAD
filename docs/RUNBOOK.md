# Divvy operations runbook

How to deploy, roll back and handle incidents on the production VPS. One-time server setup is in [`deploy/setup-vps.md`](../deploy/setup-vps.md); database restores are in [`deploy/backup/pg-restore.md`](../deploy/backup/pg-restore.md).

**Where the build is.** Phases 0 and 1 are done (HANDOFF §11). Some steps below depend on later phases. They are marked *available once Phase N lands* and give no commands, because the commands don't exist yet. Until Phase 2 lands, `divvy-api` refuses to start in production: mock mode refuses `NODE_ENV=production`, and live mode isn't built.

**Rules that always apply (CLAUDE.md):**

- No mainnet spend without the owner's explicit approval in chat. That covers funding or topping up wallets, sweeping funds, turning off payout dry-run, and PlatformConfig changes.
- Key material never goes in the repo, the database, logs, chats or tickets.
- Creates go only through Jito bundles. Never rebroadcast one through an RPC, and never reveal a mint address before its create lands.
- Every transaction that gets signed is logged with its purpose and signature (the `SignedTx` table, plus the ops log for anything done by hand).

---

## Quick reference

| What | Where |
|---|---|
| Web | PM2 `divvy-web`, cluster ×2, `127.0.0.1:3000` |
| API | PM2 `divvy-api`, cluster ×1, `127.0.0.1:4000`, WebSocket `/api/live` |
| Worker | PM2 `divvy-worker`, fork ×1, **never more than one**. Cron (UTC): payouts `0 * * * *`, reserved tickers `17 3 * * *`, indexer heartbeat `*/5 * * * *`. |
| Process file | `/srv/divvy/current/deploy/ecosystem.config.cjs` |
| Code | `/srv/divvy/releases/<UTC stamp>-<sha>/`, with `/srv/divvy/current` pointing at the live one. Git mirror at `/srv/divvy/repo.git`. |
| Config and secrets | `/etc/divvy/divvy.env` (600, divvy), keypairs in `/etc/divvy/keys/*.json` (600, divvy), public keys in `/etc/divvy/keys/pubkeys.txt` |
| App logs | `/var/log/divvy/{web,api,worker}.{out,err}.log`, `/var/log/divvy/backup.log` |
| Nginx | `/etc/nginx/sites-available/divvy.conf`, logs `/var/log/nginx/divvy.{access,error}.log` |
| PostgreSQL 16 | `127.0.0.1:5432`, database `divvy`, role `divvy` (password in `/home/divvy/.pgpass`) |
| Redis 7 | `127.0.0.1:6379`, password in `REDIS_URL`. Keys: `divvy:lock:<job>` (job locks), `divvy:siws:<nonce>` |
| Backups | `/var/backups/divvy/`, cron 03:40 UTC, 14 days local, offsite via `RCLONE_REMOTE` |
| Launch pause switch | `/etc/nginx/divvy-launches-paused` (see "Pausing launches") |

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
```

`pm2d jlist | jq -r '.[] | "\(.name) \(.pm2_env.status) restarts=\(.pm2_env.restart_time)"'` is the quickest health view.

---

## Deploy

CI must be green on the commit you deploy. Deploys are zero-downtime for web and API (PM2 cluster reload). The worker restarts, so time it:

- **Not while a payout round runs.** Check with `rcli EXISTS divvy:lock:payouts`; it must print `0`. A worker killed mid-round leaves its lock behind for up to 75 minutes, and that skips the next hour's round (see "Payout round late or failed").
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
curl -fsS http://127.0.0.1:4001/api/health && echo " api ok"
curl -fsS -o /dev/null -w 'web %{http_code}\n' http://127.0.0.1:3001/     # web 200
```

Anything else: read `/tmp/smoke-api.log` and `/tmp/smoke-web.log`, fix the problem, and don't go further. Both processes exit on their own (`timeout`). They serve no public traffic. The API's startup is read-only today, because jobs run in the worker.

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
curl -fsS http://127.0.0.1:4000/api/health; echo
curl -fsS -o /dev/null -w '%{http_code}\n' https://divvy.example/
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

- **Most values in `/etc/divvy/divvy.env`:** `sudoedit` the file, then run the reload and restart from step 4 (no new release). The env file is read again on every process start.
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

## Incident playbooks

Each playbook gives the signs, what to check, and the fix. Write every incident in the ops log: what happened, the times in UTC, what was done, and any signatures.

**Alerts** (HANDOFF §8, Telegram). Payout late or failed alerts are *available once Phase 4 lands*. Hot wallet low, Jito failure rate and indexer lag alerts are *available once Phase 5 lands*. Until then:

- An external uptime check watches `https://divvy.example/api/health`.
- The backup script sends its own Telegram alert on failure when `TELEGRAM_*` is set.
- Use the checks in these playbooks and the "Routine checks" at the end.

### Payout round late or failed

The SLA is a finished round within 60 minutes of the hour, plus 15 minutes of grace. After that the round is `late`, shows red on the coin and global meters, and the owner is alerted (HANDOFF §3.3).

**Signs:** a meter shows late, the last round in `/api/stats` is old, or an alert (Phase 4).

**Check:**

1. Exactly one worker, and stable:
   ```bash
   pm2d describe divvy-worker | grep -E 'status|restarts|uptime'
   pgrep -af 'apps/worker/dist/index.js'                 # exactly one line
   ```
2. Did the cron fire, and what did it say?
   ```bash
   grep '"msg":"payouts' /var/log/divvy/worker.out.log | tail -5
   ```
   - `payouts: round start` at minute 0 is normal.
   - `payouts: another worker holds the lock, skipping` means a stale lock (see Fix).
   - `payouts: failed` carries the error.
3. The lock:
   ```bash
   rcli GET divvy:lock:payouts; rcli PTTL divvy:lock:payouts   # PTTL in ms; -2 means no lock
   ```
4. This hour's rounds (*available once Phase 4 lands*; the table exists today but stays empty):
   ```bash
   dbq -c "SELECT r.status, r.step, count(*) FROM \"PayoutRound\" r
           WHERE r.hour = date_trunc('hour', now() AT TIME ZONE 'UTC') AND NOT r.\"dryRun\" GROUP BY 1, 2"
   dbq -c "SELECT c.ticker, r.status, r.step, r.error FROM \"PayoutRound\" r JOIN \"Coin\" c ON c.id = r.\"coinId\"
           WHERE r.hour = date_trunc('hour', now() AT TIME ZONE 'UTC') AND r.status IN ('late', 'failed')"
   ```
5. Usual causes, each with its own playbook: RPC down, Redis down (no lock means no round), payout vault low on SOL, or a Jupiter swap stopped by the slippage or price-impact cap. That last one stops the round by design.

**Fix:**

- **Stale lock.** A worker that is killed mid-round never releases `divvy:lock:payouts`, which has a 75-minute TTL. First make sure step 1 shows exactly one worker and nothing for this hour is still running in its log. Then run `rcli DEL divvy:lock:payouts`.
- **Re-running a round.** Rounds are idempotent per coin and hour, and resume from their last completed step (`RoundStep`). A manual re-run command is *available once Phase 4 lands*. Never delete or edit `PayoutRound` or `PayoutItem` rows to force a run, and never send tokens by hand.
- **Not fixable within the grace period.** The round stays `late`. Tell the owner. The holders' bucket isn't lost: it carries into the next round.

### Launch stuck in "bundling"

**Signs:** the launch modal sits on step 2, or a `Launch` row stays `step = 'bundling'` for more than 2 minutes.

**Check:**

```bash
dbq -c "SELECT id, \"bundleId\", \"createdAt\", (now() AT TIME ZONE 'UTC') - \"createdAt\" AS age
        FROM \"Launch\" WHERE step = 'bundling' ORDER BY \"createdAt\""
```

Ask Jito about the bundle (docs/verified/jito-jupiter-xstocks.md §1.1, §1.7 and §1.9). `getInflightBundleStatuses` covers the last 5 minutes and answers `Invalid`, `Pending`, `Failed` or `Landed`. `getBundleStatuses` returns `null` until the bundle lands. Stay under 1 request per second per region. If `JITO_BLOCK_ENGINE_URL` already ends in `/api/v1`, drop that part from the URL below.

```bash
curl -fsS "$(divvy_env JITO_BLOCK_ENGINE_URL)/api/v1/getInflightBundleStatuses" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"getInflightBundleStatuses","params":[["<bundleId>"]]}'
```

Also check the launcher wallet's balance ("Hot wallet below threshold").

**Fix:**

- **`Landed`.** The create is on chain. The coin should move to `landed`, then `indexed`. If it doesn't, the indexer is behind ("Indexer lag"). Don't edit the row.
- **`Invalid` or `Failed`, or no status after 5 minutes.** The bundle was dropped. The launch has to be marked failed so the user can retry; a retry uses a fresh mint keypair, because the old secret was only ever held in memory. Marking failed and retrying is *available once Phase 2 lands*.
- **Never** resend the create through an RPC, and never post the pending mint address anywhere (CLAUDE.md rule 6).
- **Many stuck at once.** Go to "Jito bundle failure rate high", and consider pausing launches.

### Indexer lag above 60 seconds

*Available once Phase 3 lands*: today the indexer job only logs a heartbeat.

**Signs:** trades, candles or curve progress stop moving, or an alert (Phase 5).

**Check:**

```bash
dbq -c "SELECT name, \"lastSlot\", (now() AT TIME ZONE 'UTC') - \"updatedAt\" AS since_update FROM \"IndexerCursor\""
rpc getSlot                                   # chain tip; (tip - lastSlot) × ~0.4 s ≈ seconds behind
grep -i indexer /var/log/divvy/worker.out.log | tail -5
```

**Fix:**

- **The RPC or Helius stream is failing.** See "RPC down".
- **The worker is stuck.** Restart it, but only once `rcli EXISTS divvy:lock:payouts` prints `0`, because the indexer and payouts share one process: `pm2d restart divvy-worker`.
- Catch-up and backfill from the cursor are *available once Phase 3 lands*.
- **Before the next round:** per-coin fee attribution comes from indexed trades (docs/VERIFIED.md item 6). A round must not spend on a stale index; the engine will refuse once Phase 4 lands. Until the lag is cleared, check `VaultClaim."unattributedLamports"` after each claim.

### Hot wallet below threshold

The three hot wallets:

- **Launcher:** create rent and Jito tips.
- **Payout vault:** swaps and recipient token accounts.
- **Fee claimer:** claim transactions.

Thresholds and hourly spend caps are the owner's call (HANDOFF §9).

**Check:**

```bash
sudo cat /etc/divvy/keys/pubkeys.txt
rpc getBalance '["<pubkey>"]'                 # result.value is in lamports (1 SOL = 1e9)
```

**Fix:**

- **Top-ups need the owner's approval in chat, every time** (CLAUDE.md rule 3). Auto top-up only with approval (HANDOFF §9). Funds come from the owner's treasury wallet, which never lives on this server. Write the signature and purpose in the ops log.
- **Launcher low:** pause launches until it's funded ("Pausing launches"), because creates would fail.
- **Payout vault low:** rounds can't swap or send and will go late. Tell the owner.
- **A drop that doesn't match recent activity:** treat it as a compromised key and go straight to "Rotating a compromised hot wallet key".

### Jito bundle failure rate high

**Signs:** launches fail or stick in bundling, or an alert above the owner's threshold (Phase 5).

**Check:**

```bash
dbq -c "SELECT step, count(*) FROM \"Launch\" WHERE \"createdAt\" > (now() AT TIME ZONE 'UTC') - interval '1 hour' GROUP BY 1"
curl -fsS https://bundles.jito.wtf/api/v1/bundles/tip_floor; echo        # tip levels (docs/verified/jito-jupiter-xstocks.md §1.5)
grep -iE 'jito|bundle|429' /var/log/divvy/api.out.log /var/log/divvy/worker.out.log | tail -20
```

- Is Jito's status page reporting trouble in our region (regions: same file, §1.8)?
- Are we over 1 request per second per IP per region (HTTP 429)?
- Is our tip below the 50th to 75th percentile of the floor?
- Is the launcher short of SOL, so simulation fails?

**Fix:**

- **Region trouble or 429s:** point `JITO_BLOCK_ENGINE_URL` at another region in `/etc/divvy/divvy.env`, then reload the API and restart the worker (the commands in Deploy step 4).
- **Tip too low:** raise the tip, staying within the owner's cap. The tip setting is *available once Phase 2 lands*.
- **Failures continue:** pause launches. **Never** fall back to sending creates through an RPC.

### RPC down

**Signs:** trade-box build errors, indexer lag, payout swaps failing.

**Check:**

```bash
rpc getHealth          # "ok"
rpc getSlot            # should advance between calls
```

Look at the provider's status page.

**Fix:**

- **Server side.** Switch `SOLANA_RPC_URL` (and `HELIUS_API_KEY`, if the provider changes) in `/etc/divvy/divvy.env` to the backup provider. Keep that provider's details in the ops log beforehand. Then reload the API and restart the worker (Deploy step 4, minding the payout lock).
- **Browser side.** `NEXT_PUBLIC_SOLANA_RPC_URL` is baked into the web build:
  1. Add the new origin, as both `https://` and `wss://`, to `connect-src` in the Nginx CSP, then run `sudo nginx -t && sudo systemctl reload nginx`.
  2. Change the value in the env file.
  3. Redeploy the same SHA (Deploy steps 1 to 5).

### Redis down

**What breaks:**

- Sign-in: SIWS nonces live in Redis.
- Worker jobs: they can't take their locks, so no payout round runs.
- Queues, live events and rate limits, as those features land.

**Check:**

```bash
systemctl status redis-server --no-pager; sudo journalctl -u redis-server -n 50 --no-pager
rcli ping
rcli INFO persistence | grep -E 'rdb_last_bgsave_status|aof_last_write_status'
rcli INFO memory | grep -E 'used_memory_human|maxmemory_human'
df -h /var/lib/redis
```

**Fix:**

- **Stopped or crashed:** run `sudo systemctl restart redis-server`. The apps reconnect on their own; confirm with `pm2d logs --lines 30 --nostream`.
- **`MISCONF ... RDB snapshots`:** the disk is full or failing. Free space, then run `rcli BGSAVE`; Redis accepts writes again after a good save.
- **`OOM command not allowed`:** `maxmemory` is reached under `noeviction`. Find the large keys with `rcli --bigkeys`, raise `maxmemory` in `/etc/redis/redis.conf`, and restart Redis. Never switch to an evicting policy: locks, nonces and queues must not vanish silently.
- **Afterwards:** check that the next payout round ran (the payout playbook). Losing Redis data is acceptable, because correctness lives in Postgres (unique coin + hour).

### Pausing launches

- **Admin pause.** This is the proper switch, *available once Phase 2 lands*. An admin sets `launchesOpen` to false with a reason (the runtime `Setting`). `/api/config` then reports `launchesOpen: false` and `launchesPausedReason`, and the create page disables the button and shows the reason.
- **Nginx switch.** Works today, with no deploy and no reload:
  ```bash
  sudo touch /etc/nginx/divvy-launches-paused       # pause: POST /api/launch answers 503 "Launches are paused."
  curl -s -o /dev/null -w '%{http_code}\n' -X POST https://divvy.example/api/launch   # 503
  sudo rm /etc/nginx/divvy-launches-paused          # resume
  ```
  The create page still shows its normal button; the launch then fails with that message. Launches already in flight carry on. Status polling (`GET /api/launch/:id`) isn't affected.

Pause for:

- a Jito outage;
- a launcher wallet that is low or compromised;
- an anti-vamp bypass being exploited;
- a legal request.

Write the reason in the ops log.

### Rotating a compromised hot wallet key

1. **Contain it, within minutes.**
   - Launcher: pause launches.
   - Payout vault or fee claimer: set `PAYOUTS_DRY_RUN=true` in `/etc/divvy/divvy.env`, then `pm2d restart divvy-worker --update-env`. Dry-run sends nothing.
   - Tell the owner now. Moving the remaining funds and funding a new wallet are both spends (rule 3).
2. **Create a new keypair** under a new file name, for example `/etc/divvy/keys/launcher-20261026.json`, with the command in `deploy/setup-vps.md` §8. Append its public key to `pubkeys.txt`.
3. **With the owner's approval,** sweep what's left in the compromised wallet to the owner's treasury (speed matters), then fund the new wallet minimally. Log both signatures.
4. **Point the app at the new key:** change the matching `*_KEYPAIR_PATH` in `/etc/divvy/divvy.env`, reload the API and restart the worker (Deploy step 4).
5. **On-chain roles.** If the wallet is named in Divvy's PlatformConfig (`platform_fee_wallet`, `platform_nft_wallet`, `platform_cp_creator`; docs/verified/launchlab.md), the PlatformConfig admin has to update it, and any Fee Key NFTs the old wallet holds have to move.
   - Confirm the exact instruction against the SDK and log it in `docs/VERIFIED.md` before sending (rule 2). Updates may be rate-limited per epoch (open question 8 in launchlab.md).
   - Send only with the owner's approval.
6. **Remove the old file:** `sudo shred -u /etc/divvy/keys/<old>.json`. This is best effort on SSDs. The key is burned either way; its encrypted offline copy is now worthless too.
7. **Find the leak.**
   - Check who could read `/etc/divvy/keys` and who logged in (`last`, `/var/log/auth.log`).
   - Check whether key material ever reached logs, shell history, backups or CI.
   - If root on the server may be compromised, rotate everything: database and Redis passwords, every session (`DELETE FROM "Session";` signs everyone out), the hot-wallet keys (move funds to fresh keys first), the RPC, Jito, Jupiter and Telegram keys, and the GitHub deploy key. Then **rebuild the VPS from scratch** (`deploy/setup-vps.md`) instead of cleaning it in place.
8. **Switch payouts back on** (`PAYOUTS_DRY_RUN=false`) only with the owner's approval.

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
curl -fsS http://127.0.0.1:4000/api/health; curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
pm2d logs divvy-api --lines 100 --nostream
sudo tail -50 /var/log/nginx/divvy.error.log
df -h / /var/lib/postgresql; free -m
```

- **Right after a deploy, or with restart counts climbing:** roll back first.
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
  - The last line of `backup.log` reads `done`.
  - Disk use is under 80% (`df -h`).
- **Weekly:**
  - `sudo certbot certificates`: more than 30 days left.
  - Hot wallet balances against the thresholds.
  - `sudo apt-get update && sudo apt-get -y upgrade`. After a reboot, check that `pm2d ls` came back on its own.
- **Monthly:**
  - A restore drill (pg-restore.md, steps 1 to 3) from a local dump and from an offsite one.
  - Prune old releases.
  - Re-read this runbook for steps that have since become available as phases land.
