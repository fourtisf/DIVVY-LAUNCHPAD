# One-time VPS setup

This sets up a fresh Hostinger VPS to run Divvy with PM2 and Nginx (CLAUDE.md, "Stack"). Do it once per server, top to bottom. Routine operations (deploys, rollbacks, incidents) are in [`docs/RUNBOOK.md`](../docs/RUNBOOK.md).

**Target:** Ubuntu 24.04 LTS. Its own packages give the versions the stack expects: PostgreSQL 16, Redis 7.0 and nginx 1.24. On 22.04 you'd need the PGDG and Redis repositories, so prefer 24.04.

**Placeholders:** `divvy.example` is the domain, `rpc.divvy.example` is the origin of the browser RPC, and `OWNER/REPO` is the GitHub repository. Replace all three. No real values belong in this file.

**Rules that apply throughout (CLAUDE.md):**

- Private keys never go in the repo, the database, logs or client bundles. On this server they live only in `/etc/divvy/keys/` (§8).
- Nothing in this setup spends SOL. Funding the hot wallets needs the owner's explicit approval in chat (rule 3).
- `divvy-api` runs with `API_MODE=live` (mock mode refuses `NODE_ENV=production`). The API and the worker both refuse to start until `DATABASE_URL`, `REDIS_URL`, `SOLANA_RPC_URL` and `DIVVY_PLATFORM_CONFIG` are set. Divvy's PlatformConfig is created once, with the owner's approval (`packages/solana/scripts/phase0/create-platform-config.ts`, see `docs/VERIFIED.md`). Sections 1 to 9 don't need it.

---

## 1. Base system

Log in as your sudo admin user, not root, with an SSH key.

```bash
sudo apt-get update && sudo apt-get -y full-upgrade
sudo apt-get install -y git curl ca-certificates gnupg jq unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades          # security updates on

# UTC everywhere: payout hours are UTC, and cron.d, the logs and backup names all assume it.
sudo timedatectl set-timezone Etc/UTC
timedatectl | grep -E 'Time zone|synchronized'            # Etc/UTC, System clock synchronized: yes
```

**Swap.** `next build` needs about 1.5 GB of RAM. On a 4 GB plan or smaller, add 2 GB of swap:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**SSH.** First confirm that key login works in a second session. Then edit `/etc/ssh/sshd_config` with `sudoedit`, set `PasswordAuthentication no` and `PermitRootLogin no`, and run `sudo systemctl reload ssh`.

## 2. Firewall

Allow only SSH, HTTP and HTTPS. PostgreSQL, Redis and the app ports (3000, 4000) also listen on loopback only, so the firewall is a second line of defence for them.

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status verbose
```

If Hostinger's panel firewall is on, give it the same three rules. **Behind Cloudflare** (Nginx geo option B), replace the two web rules with one rule per Cloudflare range (<https://www.cloudflare.com/ips/>), for example `sudo ufw allow proto tcp from <range> to any port 80,443`. Otherwise anyone can reach the origin directly and forge `CF-IPCountry`.

## 3. The `divvy` user and directories

Everything runs as the system user `divvy`. It has no password and can't log in over SSH; admins use `sudo -iu divvy`.

```bash
sudo adduser --system --group --home /home/divvy --shell /bin/bash divvy

sudo install -d -o divvy -g divvy -m 755 /srv/divvy /srv/divvy/releases   # code: releases/<stamp>-<sha>, current -> one of them
sudo install -d -o divvy -g divvy -m 750 /var/log/divvy                   # PM2 and backup logs
sudo install -d -o divvy -g divvy -m 700 /var/backups/divvy               # pg_dump files
sudo install -d -o root  -g divvy -m 750 /etc/divvy                       # config; divvy can read, not create
sudo install -d -o divvy -g divvy -m 700 /etc/divvy/keys                  # hot wallet keypairs
```

## 4. Node.js 22, pnpm and PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource_setup.sh
less /tmp/nodesource_setup.sh                    # read it before running it as root
sudo bash /tmp/nodesource_setup.sh
sudo apt-get install -y nodejs
node --version                                   # v22.9 or later (the package scripts use --env-file-if-exists)

sudo npm install -g pnpm@10.28.0 pm2@7           # pnpm matches "packageManager" in package.json
pnpm --version && pm2 --version
```

## 5. PostgreSQL 16

```bash
sudo apt-get install -y postgresql               # PostgreSQL 16 on Ubuntu 24.04
pg_lsclusters                                    # 16 main 5432 online; listens on localhost only by default

DB_PASS=$(openssl rand -hex 24)                  # hex: safe in a URL without escaping
sudo -u postgres psql -X -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE divvy LOGIN PASSWORD '$DB_PASS';
CREATE DATABASE divvy OWNER divvy;
SQL

# Lets the divvy user run psql, pg_dump and pg_restore without a password on the command line.
echo "127.0.0.1:5432:*:divvy:$DB_PASS" | sudo -u divvy bash -c 'umask 077; cat > /home/divvy/.pgpass'
sudo -u divvy -H psql -h 127.0.0.1 -U divvy -d divvy -XAtc 'select current_user'   # prints: divvy

echo "DATABASE_URL=postgresql://divvy:$DB_PASS@127.0.0.1:5432/divvy?schema=public"   # goes into divvy.env in §8
```

Notes:

- `divvy` owns the database but is not a superuser and can't create databases. The migrations need `CREATE EXTENSION pg_trgm`, which the database owner is allowed to run because `pg_trgm` is a trusted extension. This was checked by applying every migration as such a role.
- The restore procedure creates scratch databases as `postgres` (`deploy/backup/pg-restore.md`).

## 6. Redis

```bash
sudo apt-get install -y redis-server
REDIS_PASS=$(openssl rand -hex 32)
sudo cp /etc/redis/redis.conf /etc/redis/redis.conf.orig
sudo tee -a /etc/redis/redis.conf > /dev/null <<EOF

# --- Divvy (later lines override earlier ones) ---
bind 127.0.0.1 -::1
protected-mode yes
port 6379
requirepass $REDIS_PASS
maxmemory 512mb
# Job locks, SIWS nonces and queues must never be evicted silently. Writes fail at the cap instead.
maxmemory-policy noeviction
EOF
sudo systemctl restart redis-server
REDISCLI_AUTH="$REDIS_PASS" redis-cli -h 127.0.0.1 ping       # PONG
redis-cli -h 127.0.0.1 ping                                    # NOAUTH ... (expected)

echo "REDIS_URL=redis://default:$REDIS_PASS@127.0.0.1:6379/0"  # goes into divvy.env in §8
```

## 7. Nginx, GeoIP and TLS

```bash
sudo apt-get install -y nginx certbot libnginx-mod-http-geoip2
sudo rm -f /etc/nginx/sites-enabled/default      # divvy.conf brings its own default_server
sudo install -d -m 755 /var/www/certbot
```

**Country database (Nginx geo option A).** `deploy/nginx/divvy.conf` reads `/var/lib/GeoIP/GeoLite2-Country.mmdb`, and Nginx won't start without it. Pick one source:

- MaxMind GeoLite2 needs a free MaxMind account. Install `geoipupdate` (`sudo apt-get install -y geoipupdate`). Put the account ID and licence key in `/etc/GeoIP.conf`, with `EditionIDs GeoLite2-Country` and `DatabaseDirectory /var/lib/GeoIP`. Run `sudo geoipupdate`, then refresh it weekly:
  ```bash
  echo '17 4 * * 3 root /usr/bin/geoipupdate && /usr/bin/systemctl reload nginx' | sudo tee /etc/cron.d/geoipupdate
  ```
- DB-IP "IP to Country Lite" needs no account, but its CC BY 4.0 licence requires attribution. Download the monthly `.mmdb`, gunzip it to the same path, and refresh it monthly.

If Cloudflare sits in front (option B in `divvy.conf`), skip the database and follow the comments in that file.

**Certificate (webroot, so certbot never edits our config).** Serve the ACME challenge first with a temporary site:

```bash
sudo tee /etc/nginx/sites-available/divvy-bootstrap.conf > /dev/null <<'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name divvy.example;
    location ^~ /.well-known/acme-challenge/ { root /var/www/certbot; }
    location / { return 404; }
}
EOF
sudo ln -sf /etc/nginx/sites-available/divvy-bootstrap.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo certbot certonly --webroot -w /var/www/certbot -d divvy.example \
  --email ops@divvy.example --agree-tos --no-eff-email \
  --deploy-hook 'systemctl reload nginx'
sudo rm /etc/nginx/sites-enabled/divvy-bootstrap.conf

systemctl list-timers certbot.timer              # renewal timer from the certbot package
sudo certbot renew --dry-run
```

**The Divvy site.** Copy the file in (don't symlink it into the release) and fill in the placeholders. Replace the RPC origin before the domain, because `rpc.divvy.example` contains `divvy.example`.

```bash
sudo cp /srv/divvy/current/deploy/nginx/divvy.conf /etc/nginx/sites-available/divvy.conf   # after the first deploy (§10)
sudoedit /etc/nginx/sites-available/divvy.conf
#   1. rpc.divvy.example -> the host of NEXT_PUBLIC_SOLANA_RPC_URL (origin only, never the API key)
#   2. divvy.example     -> your domain
#   3. pick geo option A or B
sudo ln -sf /etc/nginx/sites-available/divvy.conf /etc/nginx/sites-enabled/divvy.conf
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` failing with "Address family not supported" means IPv6 is off on this VPS. Delete the `listen [::]:...` lines.

## 8. Secrets: `/etc/divvy/divvy.env` and keypairs

**The env file.** One file, read by every app as `node --env-file=/etc/divvy/divvy.env` (`deploy/ecosystem.config.cjs`) and, through a `.env` symlink in each release, by the build and the migrations.

```bash
sudo install -o divvy -g divvy -m 600 /dev/null /etc/divvy/divvy.env
sudoedit /etc/divvy/divvy.env            # sudoedit keeps the owner and mode
sudo ls -l /etc/divvy/divvy.env          # -rw------- 1 divvy divvy
```

Start from `.env.example` in the repo, with these production values:

| Variable | Production value |
|---|---|
| `DATABASE_URL` | the URL printed in §5 |
| `REDIS_URL` | the URL printed in §6 |
| `API_MODE` | `live`. `mock` refuses `NODE_ENV=production`. |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `4000` |
| `WEB_ORIGIN` | `https://divvy.example` |
| `API_INTERNAL_URL` | `http://127.0.0.1:4000` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Inlined into the browser bundle at **build** time, so it's public. Use a key restricted to your domain, or a browser-only RPC plan. Changing it needs a rebuild and a CSP update. |
| `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `SOLANA_WS_URL`, `DIVVY_PLATFORM_CONFIG`, `JITO_BLOCK_ENGINE_URL`, `JUP_API_KEY` | `devnet` until the audit sign-off. `SOLANA_RPC_URL` and `DIVVY_PLATFORM_CONFIG` are required. A Helius RPC URL enables DAS holder snapshots; with another provider they fall back to `getProgramAccounts`. `JITO_BLOCK_ENGINE_URL` is a bare host, because the worker adds `/api/v1/…` (empty means `https://mainnet.block-engine.jito.wtf`). |
| `DIVVY_MAINNET_ENABLED` | `false`. Set `true` only after `docs/MAINNET_CHECKLIST.md` is complete and the owner has signed it off. While it's off, nothing is signed and sent on mainnet. |
| `STORAGE_DRIVER`, `STORAGE_DIR`, `PUBLIC_MEDIA_BASE`, `S3_*` | Where coin pictures and token metadata live. Metadata URIs are permanent: use durable storage. The API writes the pictures and the worker writes the metadata, each from its own release folder, so with `local` set `STORAGE_DIR` to an absolute path outside `/srv/divvy/releases`, writable by divvy (a relative path would split the two apps' files and disappear with old releases), and `PUBLIC_MEDIA_BASE` to `https://divvy.example/api/media/files`. The database backups (§11) don't include it. |
| `FEE_*` | Must give the rates on chain: `FEE_PROTOCOL_BPS` × 100 is LaunchLab's `trade_fee_rate`, (`FEE_HOLDERS_BPS` + `FEE_DIVVY_BPS`) × 100 the PlatformConfig's `fee_rate`, and `FEE_CREATOR_BPS` × 100 its `creator_fee_rate`. Every payout run stops while they differ. |
| `PAYOUT_DELIVERY` | `push` or `claim`, the owner's decision (HANDOFF §3.4). The site's copy follows it. |
| `LAUNCHER_HOURLY_CAP_LAMPORTS`, `JITO_TIP_LAMPORTS`, `HOT_WALLET_MIN_SOL` | The launcher's hourly spend cap, the Jito tip per create, and the low-balance alert threshold. The owner sets them; the defaults are in `.env.example`. |
| `WORKER_ROLES` | Leave the default: the one worker runs every role. |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` | X OAuth app (redirect `https://divvy.example/api/auth/x/callback`). Empty hides "Link X". |
| `ADMIN_WALLETS`, `BLOCKED_COUNTRIES` | Admin wallet addresses; ISO codes refused for launches and claims. |
| `LAUNCHER_KEYPAIR_PATH`, `PAYOUT_VAULT_KEYPAIR_PATH`, `FEE_CLAIMER_KEYPAIR_PATH` | Paths under `/etc/divvy/keys/` (below). Paths only, never key material. |
| `PAYOUTS_DRY_RUN` | `true`. Turning live payouts on needs the owner's approval (RUNBOOK "Switching dry-run to live"). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | Alerts from the worker (RUNBOOK "Alerts") and the backup script. Without them, alerts only go to the worker log. |
| `RCLONE_REMOTE` | Optional, read by the backup script (§11). |

Don't set `NODE_ENV` here: PM2 sets it per app, and the build sets its own. Values aren't expanded or sourced, so write them literally.

**Hot wallet keypairs** (HANDOFF §9: separate keys for the launcher, the payout vault and fee claims). Create them on the server, so the secret key never travels. The command uses `@solana/web3.js` from the deployed release, so it needs the first release built (§10, RUNBOOK "Deploy" step 1). It writes a standard keypair file (a JSON array of 64 bytes, the same format as `solana-keygen`) with mode 600, refuses to overwrite an existing file, and prints only the public key:

```bash
sudo -iu divvy
cd /srv/divvy/current/packages/solana
for role in launcher payout-vault fee-claimer; do
  node -e '
    const fs = require("fs"); const { Keypair } = require("@solana/web3.js");
    const [file, role] = process.argv.slice(1);
    const kp = Keypair.generate();
    fs.writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600, flag: "wx" });
    console.log(role + " " + kp.publicKey.toBase58());
  ' "/etc/divvy/keys/$role.json" "$role" | tee -a /etc/divvy/keys/pubkeys.txt
done
ls -l /etc/divvy/keys/                     # -rw------- divvy divvy for every file
exit
```

Then:

- Set `LAUNCHER_KEYPAIR_PATH=/etc/divvy/keys/launcher.json`, `PAYOUT_VAULT_KEYPAIR_PATH=/etc/divvy/keys/payout-vault.json` and `FEE_CLAIMER_KEYPAIR_PATH=/etc/divvy/keys/fee-claimer.json` in `divvy.env`. If the worker is already running, restart it so it loads them: `sudo -iu divvy pm2 restart divvy-worker --update-env`.
- The PlatformConfig's `platform_fee_wallet` (`FEE_WALLET` in the phase-0 script) must be the fee claimer's public key. Every payout run, dry-run included, checks it and stops with "PlatformConfig.platform_fee_wallet is not the fee claimer key" otherwise. Dry-run also needs the payout vault key, to quote swaps into its token account; it never signs with either.
- Give the owner the public keys from `pubkeys.txt`. Funding needs their approval (rule 3). Keep balances minimal: the launcher's hourly spend is capped (`LAUNCHER_HOURLY_CAP_LAMPORTS`), and the payout wallets only swap and send what the dividend engine has claimed and recorded.
- Keep an **encrypted** offline copy of each key file (for example `age` or `gpg` to the owner's key) on media the owner holds. This matters most if a wallet becomes `platform_fee_wallet` or `platform_nft_wallet` in the PlatformConfig, because losing it would strand fees. The database backups don't contain `/etc/divvy`. Keep it that way.
- Never paste key material into a terminal, a chat, a ticket or the env file.

## 9. Deploy key and code mirror

```bash
sudo -iu divvy
ssh-keygen -t ed25519 -N '' -f ~/.ssh/github_deploy -C 'divvy-vps (read-only deploy key)'
cat ~/.ssh/github_deploy.pub     # GitHub: OWNER/REPO, then Settings, Deploy keys, Add (leave write access off)
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_deploy
  IdentitiesOnly yes
EOF
ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts   # compare with GitHub's published SSH key fingerprints
git clone --mirror git@github.com:OWNER/REPO.git /srv/divvy/repo.git
exit
```

## 10. First deploy and PM2 at boot

Follow [`docs/RUNBOOK.md`](../docs/RUNBOOK.md), "Deploy", steps 1 to 5 (release, install, build, smoke test, migrate, switch). Two things go in between step 1 and step 2:

- **The keypairs (§8).** The command needs the packages step 1 installed. The worker starts without them, but launches and payouts fail until they're set.
- **`SOLANA_RPC_URL` and `DIVVY_PLATFORM_CONFIG` in `divvy.env`.** The smoke test in step 2 starts the API and the worker, and neither starts without them.

Then start PM2 instead of reloading it:

```bash
sudo -iu divvy pm2 start /srv/divvy/current/deploy/ecosystem.config.cjs
sudo -iu divvy pm2 save
sudo env PATH="$PATH" pm2 startup systemd -u divvy --hp /home/divvy   # creates and enables pm2-divvy.service
systemctl status pm2-divvy --no-pager
sudo reboot     # then: sudo -iu divvy pm2 ls  (everything back online?)
```

Now install the Nginx site (§7, last block). Check that the worker came up in dry-run: `sudo grep '"msg":"worker started"' /var/log/divvy/worker.out.log | tail -1` shows `"payoutsDryRun":true` and the cluster you expect.

**Log rotation.** PM2 keeps its log files open, so rotate them with `copytruncate`:

```bash
sudo tee /etc/logrotate.d/divvy > /dev/null <<'EOF'
/var/log/divvy/*.log {
    daily
    rotate 14
    maxsize 100M
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
    su divvy divvy
}
EOF
sudo logrotate -d /etc/logrotate.d/divvy
```

## 11. Backups

```bash
sudo tee /etc/cron.d/divvy-backup > /dev/null <<'EOF'
# Daily PostgreSQL backup at 03:40 UTC (deploy/backup/pg-backup.sh, restore: deploy/backup/pg-restore.md).
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
40 3 * * * divvy /bin/bash /srv/divvy/current/deploy/backup/pg-backup.sh >> /var/log/divvy/backup.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/divvy-backup

sudo -u divvy -H /bin/bash /srv/divvy/current/deploy/backup/pg-backup.sh    # run once now; it must end with "done"
```

**Offsite copy (recommended).** Install rclone (`sudo apt-get install -y rclone`). As `divvy`, run `rclone config`: add the bucket remote, then a `crypt` remote on top of it, so the dumps are encrypted before they leave the server. Set `RCLONE_REMOTE=<crypt-remote>:db` in `divvy.env`. Set the bucket's lifecycle rules to expire old dumps (the script only rotates local copies). Keep the rclone crypt passwords with the owner too: without them the offsite copies can't be read.

Then do a restore drill (`deploy/backup/pg-restore.md`, steps 1 to 3) before calling the server ready.

## 12. Monitoring

- **Telegram.** With `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` set (§8), the worker sends its alerts there (late or failed rounds, payouts stopped, low hot-wallet balances, Jito failures, indexer lag and the rest in the runbook's "Alerts"), and so does the backup script. Send one test message to check the bot and the chat (the token reaches curl on stdin, so it stays out of `ps`):
  ```bash
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$(sudo grep -E '^TELEGRAM_BOT_TOKEN=' /etc/divvy/divvy.env | tail -n 1 | cut -d= -f2-)" |
    curl -fsS -m 10 -K - -o /dev/null --data-urlencode "chat_id=$(sudo grep -E '^TELEGRAM_ALERT_CHAT_ID=' /etc/divvy/divvy.env | tail -n 1 | cut -d= -f2-)" \
      --data-urlencode "text=Divvy: test message from $(hostname)" && echo sent
  ```
- **Uptime.** Point an external uptime checker at `https://divvy.example/api/health`, every minute. It answers HTTP 200 with `"ok":false` when the database is unreachable (and HTTP 500 when Redis is down), so have the checker look for `"ok":true` in the body if it can.
- Follow the "Routine checks" in the runbook.

## Checklist

- [ ] `sudo ufw status` shows only 22, 80 and 443.
- [ ] `ss -tlnp` shows 5432, 6379, 3000 and 4000 on 127.0.0.1 or ::1 only.
- [ ] `/etc/divvy/divvy.env` and `/etc/divvy/keys/*.json` are `-rw------- divvy divvy`.
- [ ] `API_MODE=live`, `PAYOUTS_DRY_RUN=true` and `DIVVY_MAINNET_ENABLED=false`, and the worker's `worker started` log line agrees.
- [ ] The Telegram test message arrived (§12).
- [ ] `sudo -iu divvy pm2 ls` shows all three apps online, and they come back after a reboot.
- [ ] `curl -sI https://divvy.example` returns the security headers and a CSP with the real RPC origin.
- [ ] `certbot renew --dry-run` passes.
- [ ] One backup has been written and restored into a scratch database.
