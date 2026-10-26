# Restoring the Divvy database

Backups come from `deploy/backup/pg-backup.sh` (cron runs its installed copy `/usr/local/bin/divvy-pg-backup` as `divvy-backup`, daily at 03:40 UTC). Each one is a custom-format `pg_dump` at `/var/backups/divvy/divvy-<UTC timestamp>.dump` with a `.sha256` beside it. Local copies are kept for 14 days. When `RCLONE_REMOTE` is set, each dump is also copied offsite.

**Always restore into a scratch database first.** Production is only replaced by renaming databases after the checks pass, so the database being replaced is kept until you drop it.

Last rehearsal: 2026-10-26, on PostgreSQL 16.15 from the Ubuntu 24.04 packages, using a seeded copy of the current schema. It covered the backup, the checksum, a restore into a scratch database as the app role, the checks in step 3, and the rename swap in step 4.

## Before you start

- Run this from an admin shell on the VPS. Commands run as `postgres` (superuser, peer auth) or as the OS user `divvy-backup`, which owns the dumps and connects as the app role `divvy` (owner of the `divvy` database). `sudo -u divvy-backup -H` makes libpq read `/home/divvy-backup/.pgpass` (set up in `deploy/setup-vps.md` §5), so no password goes on a command line.
- Free disk: allow about 5 times the dump size under `/var/lib/postgresql` (`df -h /var/lib/postgresql`).
- To restore production (step 4), tell the owner first. A restore rewinds the ledger, and step 5 is not optional.

Set these once in the admin shell. Every block below uses them:

```bash
NAME=divvy-20261026T034000Z.dump                 # the dump you picked in step 1
DUMP=/var/backups/divvy/$NAME
SCRATCH=divvy_restore_$(date -u +%Y%m%d)
as_backup() { sudo -u divvy-backup -H "$@"; }
```

## 1. Pick and verify a dump

```bash
sudo ls -lt /var/backups/divvy/ | head
as_backup bash -c 'cd /var/backups/divvy && sha256sum -c "$0.sha256"' "$NAME"
as_backup pg_restore --list "$DUMP" | head -12
```

Expected output (the creation time is the point you are rewinding to):

```
divvy-20261026T034000Z.dump: OK
;
; Archive created at 2026-10-26 03:40:02 UTC
;     dbname: divvy
;     TOC Entries: 173
;     Compression: gzip
;     Dump Version: 1.15-0
;     Format: CUSTOM
;     ...
;     Dumped from database version: 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
;     Dumped by pg_dump version: 16.15 (Ubuntu 16.15-0ubuntu0.24.04.1)
```

A checksum mismatch or a `pg_restore --list` error means the file is damaged. Pick the previous day's dump.

**Restoring from offsite**, for example on a new server or when the local copies are gone:

```bash
REMOTE=$(sudo grep -E '^RCLONE_REMOTE=' /etc/divvy/backup.env | tail -n 1 | cut -d= -f2-)
as_backup rclone lsl "$REMOTE" | sort -k2,3 | tail -5
as_backup rclone copy "$REMOTE/$NAME" /var/backups/divvy/
as_backup rclone copy "$REMOTE/$NAME.sha256" /var/backups/divvy/
```

Then run the checksum again.

## 2. Restore into a scratch database

```bash
sudo -u postgres createdb --owner=divvy "$SCRATCH"
as_backup pg_restore --host=127.0.0.1 --username=divvy --dbname="$SCRATCH" \
  --no-owner --exit-on-error --jobs=2 "$DUMP"
echo "pg_restore exit: $?"            # must be 0
```

`--no-owner` makes `divvy` own everything it restores, whatever role owned it on the source. The `pg_trgm` extension in the dump is a trusted extension, so the database owner can create it without superuser.

## 3. Check the restored copy

```bash
cat > /tmp/divvy-restore-check.sql <<'SQL'
SELECT
  (SELECT count(*) FROM "User")             AS users,
  (SELECT count(*) FROM "Coin")             AS coins,
  (SELECT count(*) FROM "Launch")           AS launches,
  (SELECT count(*) FROM "PayoutRound")      AS rounds,
  (SELECT max(hour) FROM "PayoutRound")     AS last_round_hour,
  (SELECT max("createdAt") FROM "SignedTx") AS last_signed_tx,
  (SELECT count(*) FROM "ReservedTicker")   AS reserved_tickers;
SQL
chmod 644 /tmp/divvy-restore-check.sql
as_backup psql -h 127.0.0.1 -U divvy -d "$SCRATCH" -X -f /tmp/divvy-restore-check.sql
as_backup psql -h 127.0.0.1 -U divvy -d divvy     -X -f /tmp/divvy-restore-check.sql   # production, if it is still up
```

- The scratch counts should be at or below production's. `last_round_hour` and `last_signed_tx` should sit just before the dump's creation time.
- An empty table where production has rows means the wrong dump or a broken restore. Stop here.

Compare the migrations in the copy with the ones the running release ships:

```bash
as_backup psql -h 127.0.0.1 -U divvy -d "$SCRATCH" -XAt \
  -c 'SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY 1' \
  > /tmp/db-migrations.txt
ls -1 /srv/divvy/current/packages/db/prisma/migrations | grep -v '\.toml$' > /tmp/release-migrations.txt
diff /tmp/release-migrations.txt /tmp/db-migrations.txt && echo "migrations match"
```

- `migrations match`: nothing more to do here.
- Lines starting with `<` are migrations the release has and the dump doesn't. That's normal for an older dump; `pnpm db:deploy` applies them in step 4.
- Lines starting with `>` mean the dump is newer than the release. Deploy the matching release first (RUNBOOK, "Rollback" in reverse).

**For a drill, stop here.** Drop the copy and write the date, the dump name and the counts in the ops log:

```bash
sudo -u postgres dropdb "$SCRATCH"
```

## 4. Promote the copy (production restore only)

1. Stop new money from moving: pause launches, and keep payouts in dry-run until step 5 is done. Dry-run also closes holder claims. The API and the worker both read `PAYOUTS_DRY_RUN`, so set it in both files.
   ```bash
   sudo touch /etc/nginx/divvy-launches-paused
   sudo sed -i 's/^PAYOUTS_DRY_RUN=.*/PAYOUTS_DRY_RUN=true/' /etc/divvy/api.env /etc/divvy/worker.env
   sudo grep -H '^PAYOUTS_DRY_RUN=' /etc/divvy/api.env /etc/divvy/worker.env   # both must print PAYOUTS_DRY_RUN=true
   ```
2. Stop the apps, each under its own user's PM2. The site is down from here until step 4.5.
   ```bash
   for u in divvy-worker divvy-api divvy-web; do sudo -iu "$u" pm2 stop "$u"; done
   ```
3. Swap the databases. The current one is renamed, not dropped. If production no longer exists (for example on a new server), leave out the first `ALTER`.
   ```bash
   STAMP=$(date -u +%Y%m%d%H%M)
   sudo -u postgres psql -X -v ON_ERROR_STOP=1 \
     -c "SELECT count(pg_terminate_backend(pid)) AS terminated FROM pg_stat_activity WHERE datname IN ('divvy', '$SCRATCH') AND pid <> pg_backend_pid()" \
     -c "ALTER DATABASE divvy RENAME TO divvy_before_restore_$STAMP" \
     -c "ALTER DATABASE $SCRATCH RENAME TO divvy"
   ```
   `DATABASE_URL` names the database `divvy`, so nothing in the env files changes.
4. Bring the schema up to the running release (this applies any `<` migrations from step 3), with the API's database URL:
   ```bash
   cd /srv/divvy/current/packages/db && sudo -u divvy-api -H node --env-file=/etc/divvy/api.env ./node_modules/prisma/build/index.js migrate deploy; cd
   ```
5. Start the apps. The worker starts in dry-run because of step 1.
   ```bash
   for u in divvy-api divvy-web divvy-worker; do sudo -iu "$u" pm2 start "$u"; done
   curl -fsS http://127.0.0.1:4000/api/health && curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/
   ```

## 5. Reconcile with the chain before resuming

Anything that happened on chain after the dump's creation time is missing from the restored database. The chain is the source of truth.

- **Launches that landed after the dump.** The coins exist on chain, but their `Coin` and `Launch` rows don't. Backfill them from the indexer. *Available once Phase 3 lands.*
- **Fee claims and payout rounds after the dump.** List the signatures of the launcher, payout vault and fee claimer wallets since the dump time, and compare them with `SignedTx`. Never delete `PayoutRound` rows to make a round run again. *Tooling available once Phase 4 lands.*
- **Claims (credit + claim model, HANDOFF §3.4).** `Credit` balances are back to the dump time, so a holder who claimed after it could claim again. Keep claims closed until every confirmed claim transfer since the dump is booked. *Available once Phase 4 lands.*
- If the old database (`divvy_before_restore_<stamp>`) is intact, the missing rows are in it. Copy them across table by table, inside a transaction, after checking each against the chain.

After reconciliation, and only with the owner's approval for live payouts (CLAUDE.md rule 3):

```bash
sudo sed -i 's/^PAYOUTS_DRY_RUN=.*/PAYOUTS_DRY_RUN=false/' /etc/divvy/api.env /etc/divvy/worker.env
sudo -iu divvy-api pm2 reload /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-api --update-env
sudo -iu divvy-worker pm2 restart /srv/divvy/current/deploy/ecosystem.config.cjs --only divvy-worker --update-env
sudo rm /etc/nginx/divvy-launches-paused
```

## 6. Clean up

Keep the renamed database for about a week, then drop it:

```bash
sudo -u postgres psql -XAt -c "SELECT datname FROM pg_database WHERE datname LIKE 'divvy_before_restore_%'"
sudo -u postgres dropdb divvy_before_restore_<stamp>
rm -f /tmp/divvy-restore-check.sql /tmp/db-migrations.txt /tmp/release-migrations.txt
```

## Monthly drill

Once a month, run steps 1 to 3 against the newest local dump and against one fetched from offsite, then drop the scratch database. A backup that has never been restored doesn't count as a backup.
