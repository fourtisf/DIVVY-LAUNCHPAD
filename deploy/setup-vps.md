# One-time VPS setup

This sets up a fresh Hostinger VPS to run Divvy with PM2 and Nginx (CLAUDE.md, "Stack"). Do it once per server, top to bottom. Routine operations (deploys, rollbacks, incidents) are in [`docs/RUNBOOK.md`](../docs/RUNBOOK.md). A server set up earlier with a single `divvy` user and `/etc/divvy/divvy.env` moves over with "Moving from the single-user layout" at the end.

**Target:** Ubuntu 24.04 LTS. Its own packages give the versions the stack expects: PostgreSQL 16, Redis 7.0 and nginx 1.24. On 22.04 you'd need the PGDG and Redis repositories, so prefer 24.04.

**Placeholders:** `divvy.example` is the domain, `rpc.divvy.example` is the origin of the browser RPC, and `OWNER/REPO` is the GitHub repository. Replace all three. No real values belong in this file.

**Rules that apply throughout (CLAUDE.md):**

- Private keys never go in the repo, the database, logs or client bundles. On this server they live only in `/etc/divvy/keys/`, and only `divvy-worker` can read them (§8).
- Nothing in this setup spends SOL. Funding the hot wallets needs the owner's explicit approval in chat (rule 3).
- `divvy-api` runs with `API_MODE=live` (mock mode refuses `NODE_ENV=production`). The API and the worker both refuse to start until `DATABASE_URL`, `REDIS_URL`, `SOLANA_RPC_URL` and `DIVVY_PLATFORM_CONFIG` are set, the RPC is on `SOLANA_CLUSTER`, `STORAGE_DIR` is an absolute path outside the release, and `PUBLIC_MEDIA_BASE` is a public https URL. Divvy's PlatformConfig is created once, with the owner's approval (`packages/solana/scripts/phase0/create-platform-config.ts`, see `docs/VERIFIED.md`). Sections 1 to 9 don't need it.

**How the server is split.** One OS user per job, so a compromised web or API process can't read the worker's env file or keys, or signal its processes:

| User | Runs | Reads | Writes |
|---|---|---|---|
| `divvy` | Nothing. Builds releases. | `/etc/divvy/build.env` (public `NEXT_PUBLIC_*` values only) | `/srv/divvy`: the git mirror, the releases and `current` |
| `divvy-web` | PM2 app `divvy-web` | `/etc/divvy/web.env` | its logs, and `apps/web/.next/cache` in each release |
| `divvy-api` | PM2 app `divvy-api` | `/etc/divvy/api.env` (no keys) | its logs, coin pictures in `/var/lib/divvy/media` |
| `divvy-worker` | PM2 app `divvy-worker` | `/etc/divvy/worker.env`, `/etc/divvy/keys/` | its logs, token metadata in `/var/lib/divvy/media` |
| `divvy-backup` | The nightly `pg_dump` (cron) | `/etc/divvy/backup.env`, its `~/.pgpass` | `/var/backups/divvy`, its log |

Each runtime user has its own PM2 daemon and its own systemd unit. The releases belong to `divvy` and are read-only for the apps. `divvy` owns the code the apps run, so it holds no secrets: dependency install scripts run during the build and must never see one. None of these users has a password or SSH access; admins use `sudo`.

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

## 3. Users and directories

```bash
# divvy builds. The three runtime users get a shell only so that `sudo -iu <user> pm2 ...` works.
for u in divvy divvy-web divvy-api divvy-worker; do
  sudo adduser --system --group --home "/home/$u" --shell /bin/bash "$u"
done
sudo adduser --system --group --home /home/divvy-backup divvy-backup    # no login shell: cron and sudo -u only
sudo addgroup --system divvy-media                                      # shared media folder
sudo usermod -aG divvy-media divvy-api
sudo usermod -aG divvy-media divvy-worker
sudo usermod -aG adm "$USER"                                            # read the app logs without sudo (log in again)

sudo install -d -o divvy -g divvy -m 755 /srv/divvy /srv/divvy/releases          # code: releases/<stamp>-<sha>, current -> one of them
sudo install -d -o root -g root -m 755 /etc/divvy                                  # env files (§8), each readable only by its owner
sudo install -d -o divvy-worker -g divvy-worker -m 700 /etc/divvy/keys             # hot-wallet keypairs
sudo install -d -o root -g root -m 755 /var/lib/divvy
sudo install -d -o root -g divvy-media -m 2770 /var/lib/divvy/media                # STORAGE_DIR
sudo install -d -o divvy-backup -g divvy-backup -m 700 /var/backups/divvy          # pg_dump files
sudo install -d -o root -g adm -m 755 /var/log/divvy
for a in web api worker backup; do
  sudo install -d -o "divvy-$a" -g adm -m 750 "/var/log/divvy/$a"                 # <app>.out.log, <app>.err.log, backup.log
done
stat -c '%A %U:%G %n' /etc/divvy/keys /var/lib/divvy/media                        # drwx------ divvy-worker:divvy-worker, drwxrws--- root:divvy-media
```

The media folder holds the coin pictures and the token metadata. The API writes pictures under `img/` and the worker writes metadata under `meta/`, each in folders it creates itself. The setgid bit keeps everything in the `divvy-media` group, so the API can read the worker's metadata and serve both at `/api/media/files/`. Nobody else can read the folder.

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

Every user runs the same global `pm2`. Each one's daemon and saved process list live in its own `~/.pm2`.

## 5. PostgreSQL 16

```bash
sudo apt-get install -y postgresql               # PostgreSQL 16 on Ubuntu 24.04
pg_lsclusters                                    # 16 main 5432 online; listens on localhost only by default

DB_PASS=$(openssl rand -hex 24)                  # hex: safe in a URL without escaping
sudo -u postgres psql -X -v ON_ERROR_STOP=1 <<SQL
CREATE ROLE divvy LOGIN PASSWORD '$DB_PASS';
CREATE DATABASE divvy OWNER divvy;
SQL

# Lets divvy-backup run psql, pg_dump and pg_restore as the app role without a password on the command line.
echo "127.0.0.1:5432:*:divvy:$DB_PASS" | sudo -u divvy-backup bash -c 'umask 077; cat > /home/divvy-backup/.pgpass'
sudo -u divvy-backup -H psql -h 127.0.0.1 -U divvy -d divvy -XAtc 'select current_user'   # prints: divvy

echo "DATABASE_URL=postgresql://divvy:$DB_PASS@127.0.0.1:5432/divvy?schema=public"   # goes into api.env, worker.env and backup.env in §8
```

Notes:

- The database role `divvy` owns the database but is not a superuser and can't create databases. The migrations need `CREATE EXTENSION pg_trgm`, which the database owner is allowed to run because `pg_trgm` is a trusted extension. This was checked by applying every migration as such a role.
- The OS user `divvy` (the builder) has no database password. Ad-hoc queries in the runbook (`dbq`) and restores run as `divvy-backup`.
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

echo "REDIS_URL=redis://default:$REDIS_PASS@127.0.0.1:6379/0"  # goes into api.env and worker.env in §8
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
#   4. STORAGE_DRIVER=s3 only: add the bucket's public origin to img-src (§8)
sudo ln -sf /etc/nginx/sites-available/divvy.conf /etc/nginx/sites-enabled/divvy.conf
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` failing with "Address family not supported" means IPv6 is off on this VPS. Delete the `listen [::]:...` lines.

What the site file does that matters when you edit it:

- **Rate limits per client IP.** Pages 20 r/s with a burst of 120 (`divvy_web`; `/_next/static/` isn't limited), `/api/` 20 r/s with a burst of 60, uploads 10 a minute, `POST /api/launch` 4 a minute. Behind Cloudflare these only work with the `real_ip` block enabled; otherwise every visitor shares a few Cloudflare addresses.
- **Only lowercase `/api/` reaches the API.** `/API/...`, `/Api/...` and a bare `/api` answer 404, so nothing can reach the API through Next.js and skip the API's limits.
- **CSP.** `connect-src` allows `ws://localhost:*`, because the Android Mobile Wallet Adapter reaches the wallet app through a local WebSocket. For the same reason the policy has no `upgrade-insecure-requests` (it would rewrite that socket to `wss://`); HSTS keeps the site on HTTPS. Keep both as they are.

## 8. Secrets: env files and keypairs

**The env files.** Each app reads only its own file, as `node --env-file=/etc/divvy/<app>.env` (`deploy/ecosystem.config.cjs`). The build reads `build.env` through a `.env` symlink in each release. Create them empty, each owned by the user that reads it (the `test` keeps a re-run from emptying an existing file):

```bash
for f in web:divvy-web api:divvy-api worker:divvy-worker build:divvy backup:divvy-backup; do
  file="/etc/divvy/${f%%:*}.env" user="${f#*:}"
  sudo test -e "$file" || sudo install -o "$user" -g "$user" -m 600 /dev/null "$file"
done
sudoedit /etc/divvy/api.env              # and the other four; sudoedit keeps the owner and mode
sudo ls -l /etc/divvy/                   # every .env is -rw------- and owned by its own user
```

Which variables go where (the sections of `.env.example` say the same):

| File | Owner | What goes in it |
|---|---|---|
| `web.env` | `divvy-web` | `WEB_ORIGIN` and `API_INTERNAL_URL`. Nothing secret. |
| `build.env` | `divvy` | `NEXT_PUBLIC_SOLANA_RPC_URL`, `NEXT_PUBLIC_SOLANA_CLUSTER` and `NEXT_PUBLIC_TERMS_FINAL`, and nothing else. Next.js inlines them into the bundles at build time, so they're public anyway. |
| `api.env` | `divvy-api` | `DATABASE_URL`, `REDIS_URL`; the api block (`API_MODE`, `API_HOST`, `API_PORT`, `WEB_ORIGIN`, `LOG_LEVEL`, `GEO_HEADER`, `LAUNCH_MIN_WALLET_AGE_DAYS`, `JUP_API_KEY_API`); `X_*`; the storage block; `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `SOLANA_WS_URL`, `DIVVY_PLATFORM_CONFIG`, `LAUNCHLAB_GLOBAL_CONFIG`, `JUP_BASE_URL`, `DIVVY_MAINNET_ENABLED`; the business parameters. **Never** `*_KEYPAIR_PATH`, and no `JITO_*`, `JUP_API_KEY` or `TELEGRAM_*`. |
| `worker.env` | `divvy-worker` | `DATABASE_URL`, `REDIS_URL`; the storage block; the whole solana block, `JITO_*` and `JUP_API_KEY` included; the three `*_KEYPAIR_PATH`; the business parameters; the worker block (`WORKER_ROLES` through the spend caps, `SWAP_BATCH_MAX_LAMPORTS` included). No `API_*`, `X_*` or `NEXT_PUBLIC_*`. |
| `backup.env` | `divvy-backup` | `DATABASE_URL` and `RCLONE_REMOTE`, plus `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` if backup failures should reach Telegram. |

Values that `api.env` and `worker.env` both hold (the database, Redis, the storage block, `SOLANA_CLUSTER`, the PlatformConfig, the mainnet gate and every business parameter) must be identical in both. `envcheck` in the runbook's shell helpers compares them.

Start from `.env.example` in the repo, with these production values:

| Variable | Production value |
|---|---|
| `DATABASE_URL` | the URL printed in §5 |
| `REDIS_URL` | the URL printed in §6 |
| `API_MODE` | `live`. `mock` refuses `NODE_ENV=production`. |
| `API_HOST` / `API_PORT` | `127.0.0.1` / `4000` |
| `WEB_ORIGIN` | `https://divvy.example`, in `web.env` and `api.env` |
| `API_INTERNAL_URL` | `http://127.0.0.1:4000` |
| `NEXT_PUBLIC_SOLANA_RPC_URL` | Inlined into the browser bundle at **build** time, so it's public. Use a key restricted to your domain, or a browser-only RPC plan. Changing it needs a rebuild and a CSP update. |
| `NEXT_PUBLIC_TERMS_FINAL` | `false` until legal review approves the terms text (the owner's call). The terms page shows a draft notice until then. Changing it needs a rebuild. |
| `SOLANA_CLUSTER`, `SOLANA_RPC_URL`, `SOLANA_WS_URL`, `DIVVY_PLATFORM_CONFIG`, `JITO_BLOCK_ENGINE_URL` | `devnet` until the audit sign-off. `SOLANA_RPC_URL` and `DIVVY_PLATFORM_CONFIG` are required. The API and the worker refuse to start when the RPC's genesis hash isn't `SOLANA_CLUSTER`'s. A Helius RPC URL enables DAS holder snapshots; with another provider they fall back to `getProgramAccounts`. `JITO_BLOCK_ENGINE_URL` (worker only) is a bare host, because the worker adds `/api/v1/…` (empty means `https://mainnet.block-engine.jito.wtf`). |
| `JUP_API_KEY`, `JUP_API_KEY_API` | The worker's Jupiter key (prices and swaps) goes in `worker.env`. Give the API its own key in `api.env` as `JUP_API_KEY_API`, so public trade quotes can't use up the worker's quota. Without it the API falls back to `JUP_API_KEY`. |
| `DIVVY_MAINNET_ENABLED` | `false`. Set `true` only after `docs/MAINNET_CHECKLIST.md` is complete and the owner has signed it off. While it's off, nothing is signed and sent on mainnet. |
| `STORAGE_DRIVER`, `STORAGE_DIR`, `PUBLIC_MEDIA_BASE`, `S3_*` | Where coin pictures and token metadata live, in `api.env` and `worker.env`. Metadata URIs are permanent: use durable storage. With `local`, set `STORAGE_DIR=/var/lib/divvy/media` (§3) and `PUBLIC_MEDIA_BASE=https://divvy.example/api/media/files`; both apps refuse to start with a relative path, a path inside the release (anywhere under the folder holding `pnpm-workspace.yaml`, through `/srv/divvy/current` or the real release path, so `/srv/divvy/current/data/media` is refused), or a URL that isn't public https. With `s3`, add the bucket's public origin (the scheme and host of `PUBLIC_MEDIA_BASE`) to `img-src` in the Nginx CSP (§7), or every coin picture is blocked. Also give the bucket a CORS rule that allows `GET` from `https://divvy.example`, because the 3D coins load the pictures with `crossOrigin="anonymous"`. The database backups (§11) don't include the media. |
| `FEE_SPLIT_BEFORE`, `POOL_FEE_SPLIT` | `FEE_SPLIT_BEFORE=<slot>:<holders bps>:<uspad bps>`: trades before that slot paid an earlier `fee_rate` and are split at its weights. `go-live.sh fee-rate` sets it when the fee changes. `POOL_FEE_SPLIT` (default `50:15:10`) splits the fees collected after graduation between holders, the creator and uspad. Both identical in `api.env` and `worker.env`. |
| `FEE_*` | Must give the rates on chain: `FEE_PROTOCOL_BPS` × 100 is LaunchLab's `trade_fee_rate`, (`FEE_HOLDERS_BPS` + `FEE_DIVVY_BPS`) × 100 the PlatformConfig's `fee_rate`, and `FEE_CREATOR_BPS` × 100 its `creator_fee_rate`. Every payout run stops while they differ. |
| `PAYOUT_DELIVERY` | `push` or `claim`, the owner's decision (HANDOFF §3.4). The site's copy follows it. |
| `LAUNCHER_HOURLY_CAP_LAMPORTS`, `JITO_TIP_LAMPORTS`, `HOT_WALLET_MIN_SOL` | The launcher's hourly spend cap, the Jito tip per bundle, and the low-balance alert threshold. The owner sets them; the defaults are in `.env.example`. |
| `SWAP_HOURLY_CAP_LAMPORTS`, `SWAP_BATCH_MAX_LAMPORTS`, `PUSH_HOURLY_CAP_USD` | `worker.env` only. Hourly caps on what the fee claimer swaps in all (100 SOL by default) and per dividend asset (20 SOL, halved for a while after a swap refused for price impact), and on what the payout vault sends ($25,000). Over a cap, part goes now and the rest waits for a later hour. The owner sets them (RUNBOOK "Spend caps"). |
| `WORKER_ROLES` | Leave the default: the one worker runs every role. |
| `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` | X OAuth app (redirect `https://divvy.example/api/auth/x/callback`). Empty hides "Link X". |
| `ADMIN_WALLETS`, `BLOCKED_COUNTRIES` | Admin wallet addresses; ISO codes refused for launches and claims. |
| `LAUNCHER_KEYPAIR_PATH`, `PAYOUT_VAULT_KEYPAIR_PATH`, `FEE_CLAIMER_KEYPAIR_PATH` | `worker.env` only. Paths under `/etc/divvy/keys/` (below). Paths only, never key material. |
| `PAYOUTS_DRY_RUN` | `true`. Turning live payouts on needs the owner's approval (RUNBOOK "Switching dry-run to live"). |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | Alerts from the worker (RUNBOOK "Alerts") and, if set in `backup.env` too, from the backup script. Without them, alerts only go to the worker log. |
| `RCLONE_REMOTE` | `backup.env` only. Optional (§11). |

Don't set `NODE_ENV` in any of them: PM2 sets it per app, and the build sets its own. Values aren't expanded or sourced, so write them literally.

**Hot wallet keypairs** (HANDOFF §9: separate keys for the launcher, the payout vault and fee claims). Create them on the server, as `divvy-worker`, so the secret key never travels and no other user can read it. Never generate them with a release's `node_modules`: every dependency in there could see the key. Use one of these two:

- **Node's built-in crypto** (no packages). It writes a standard keypair file (a JSON array of 64 bytes, the same format as `solana-keygen`) with mode 400, refuses to overwrite an existing file, and prints only the public key:
  ```bash
  cd /
  for role in launcher payout-vault fee-claimer; do
    sudo -u divvy-worker node -e '
      const { generateKeyPairSync } = require("node:crypto");
      const { writeFileSync } = require("node:fs");
      const [file, role] = process.argv.slice(1);
      const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
      const seed = Buffer.from(jwk.d, "base64url"), pub = Buffer.from(jwk.x, "base64url");
      writeFileSync(file, JSON.stringify([...seed, ...pub]), { mode: 0o400, flag: "wx" });
      const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
      let n = BigInt("0x" + pub.toString("hex")), addr = "";
      for (; n > 0n; n /= 58n) addr = B58[Number(n % 58n)] + addr;
      for (const b of pub) { if (b !== 0) break; addr = "1" + addr; }
      console.log(role + " " + addr);
    ' "/etc/divvy/keys/$role.json" "$role"
  done | sudo -u divvy-worker tee -a /etc/divvy/keys/pubkeys.txt
  ```
- **The Solana CLI**, if it's already installed with the official installer from Anza's docs. `--silent` keeps the seed phrase off the screen:
  ```bash
  KEYGEN=$(command -v solana-keygen)
  for role in launcher payout-vault fee-claimer; do
    f=/etc/divvy/keys/$role.json
    sudo "$KEYGEN" new --no-bip39-passphrase --silent -o "$f" > /dev/null &&
      sudo chown divvy-worker:divvy-worker "$f" && sudo chmod 400 "$f" &&
      echo "$role $(sudo "$KEYGEN" pubkey "$f")"
  done | sudo -u divvy-worker tee -a /etc/divvy/keys/pubkeys.txt
  ```

```bash
sudo ls -l /etc/divvy/keys/              # -r-------- divvy-worker divvy-worker for every .json
```

Then:

- Set `LAUNCHER_KEYPAIR_PATH=/etc/divvy/keys/launcher.json`, `PAYOUT_VAULT_KEYPAIR_PATH=/etc/divvy/keys/payout-vault.json` and `FEE_CLAIMER_KEYPAIR_PATH=/etc/divvy/keys/fee-claimer.json` in `worker.env`, and nowhere else. If the worker is already running, restart it so it loads them: `sudo -iu divvy-worker pm2 restart divvy-worker --update-env`. The worker refuses a key file that its group or others can read.
- The PlatformConfig's `platform_fee_wallet` (`FEE_WALLET` in the phase-0 script) must be the fee claimer's public key. Every payout run, dry-run included, checks it and stops with "PlatformConfig.platform_fee_wallet is not the fee claimer key" otherwise. Dry-run also needs the payout vault key, to quote swaps into its token account; it never signs with either.
- Give the owner the public keys from `pubkeys.txt` (`sudo cat /etc/divvy/keys/pubkeys.txt`). Funding needs their approval (rule 3). Keep balances minimal: the launcher's hourly spend is capped (`LAUNCHER_HOURLY_CAP_LAMPORTS`), so are the fee claimer's swaps and the payout vault's sends, and the payout wallets only swap and send what the dividend engine has claimed and recorded.
- Keep an **encrypted** offline copy of each key file (for example `age` or `gpg` to the owner's key) on media the owner holds. This matters most if a wallet becomes `platform_fee_wallet` or `platform_nft_wallet` in the PlatformConfig, because losing it would strand fees. The database backups don't contain `/etc/divvy`. Keep it that way.
- Never paste key material into a terminal, a chat, a ticket or an env file.

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

Follow [`docs/RUNBOOK.md`](../docs/RUNBOOK.md), "Deploy", steps 1 to 5 (release, install, build, migrate, smoke test, switch). Before step 3, `api.env` and `worker.env` need at least `SOLANA_RPC_URL`, `DIVVY_PLATFORM_CONFIG`, `STORAGE_DIR` and `PUBLIC_MEDIA_BASE`: the smoke test starts the API and the worker, and neither starts without them. Both also check `SOLANA_CLUSTER` against the RPC. Without the keypairs (§8) the worker starts, but launches and payouts fail.

Then start PM2 instead of reloading it, once per app user, and register each daemon with systemd. The app names match the user names, so `--only "$u"` starts each user's own app. Never start an app under another user's daemon.

```bash
for u in divvy-web divvy-api divvy-worker; do
  sudo -iu "$u" pm2 start /srv/divvy/current/deploy/ecosystem.config.cjs --only "$u"
  sudo -iu "$u" pm2 save
  sudo env PATH="$PATH" pm2 startup systemd -u "$u" --hp "/home/$u"     # creates and enables pm2-<user>.service
done
systemctl status pm2-divvy-web pm2-divvy-api pm2-divvy-worker --no-pager
sudo reboot     # then: for u in divvy-web divvy-api divvy-worker; do sudo -iu $u pm2 ls; done  (each shows its app online)
```

Now install the Nginx site (§7, last block). Check that the worker came up in dry-run: `grep '"msg":"worker started"' /var/log/divvy/worker/worker.out.log | tail -1` shows `"payoutsDryRun":true` and the cluster you expect.

**Log rotation.** PM2 keeps its log files open, so rotate them with `copytruncate`, each folder as its own user:

```bash
for a in web api worker backup; do cat <<EOF
/var/log/divvy/$a/*.log {
    daily
    rotate 14
    maxsize 100M
    missingok
    notifempty
    compress
    delaycompress
    copytruncate
    su divvy-$a adm
}
EOF
done | sudo tee /etc/logrotate.d/divvy > /dev/null
sudo logrotate -d /etc/logrotate.d/divvy
```

## 11. Backups

Cron runs the backup as `divvy-backup` from a copy of the script outside the releases, so `divvy`, which owns the releases, can't change what runs with the database password. When `deploy/backup/pg-backup.sh` changes, read the diff and install the new copy with the same `install` line.

```bash
sudo install -o root -g root -m 755 /srv/divvy/current/deploy/backup/pg-backup.sh /usr/local/bin/divvy-pg-backup
sudo tee /etc/cron.d/divvy-backup > /dev/null <<'EOF'
# Daily PostgreSQL backup at 03:40 UTC (deploy/backup/pg-backup.sh, restore: deploy/backup/pg-restore.md).
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
40 3 * * * divvy-backup /usr/local/bin/divvy-pg-backup >> /var/log/divvy/backup/backup.log 2>&1
EOF
sudo chmod 644 /etc/cron.d/divvy-backup

sudo -u divvy-backup -H /usr/local/bin/divvy-pg-backup    # run once now; it must end with "done"
```

The script reads `DATABASE_URL`, `RCLONE_REMOTE` and the optional Telegram values from `/etc/divvy/backup.env`, and refuses to run as root.

**Offsite copy (recommended).** Install rclone (`sudo apt-get install -y rclone`). Run `sudo -u divvy-backup -H rclone config`: add the bucket remote, then a `crypt` remote on top of it, so the dumps are encrypted before they leave the server. Set `RCLONE_REMOTE=<crypt-remote>:db` in `backup.env`. Set the bucket's lifecycle rules to expire old dumps (the script only rotates local copies). Keep the rclone crypt passwords with the owner too: without them the offsite copies can't be read.

Then do a restore drill (`deploy/backup/pg-restore.md`, steps 1 to 3) before calling the server ready.

## 12. Monitoring

- **Telegram.** With `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` set in `worker.env` (§8), the worker sends its alerts there (late or failed rounds, payouts stopped, spend caps, low hot-wallet balances, Jito failures, indexer lag and the rest in the runbook's "Alerts"), and so does the backup script if `backup.env` has them too. Send one test message to check the bot and the chat (the token reaches curl on stdin, so it stays out of `ps`):
  ```bash
  printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$(sudo grep -E '^TELEGRAM_BOT_TOKEN=' /etc/divvy/worker.env | tail -n 1 | cut -d= -f2-)" |
    curl -fsS -m 10 -K - -o /dev/null --data-urlencode "chat_id=$(sudo grep -E '^TELEGRAM_ALERT_CHAT_ID=' /etc/divvy/worker.env | tail -n 1 | cut -d= -f2-)" \
      --data-urlencode "text=Divvy: test message from $(hostname)" && echo sent
  ```
- **Uptime.** Point an external uptime checker at `https://divvy.example/api/health`, every minute. It answers HTTP 200 with `"ok":false` when the database or Redis is unreachable, so have the checker look for `"ok":true` in the body if it can.
- Follow the "Routine checks" in the runbook.

## Checklist

- [ ] `sudo ufw status` shows only 22, 80 and 443.
- [ ] `ss -tlnp` shows 5432, 6379, 3000 and 4000 on 127.0.0.1 or ::1 only.
- [ ] `sudo ls -l /etc/divvy/` shows every `.env` as `-rw-------`, owned by its own user (`web.env` by `divvy-web`, `build.env` by `divvy`, and so on), and `sudo ls -l /etc/divvy/keys/` every key as `-r-------- divvy-worker`.
- [ ] `sudo grep -l KEYPAIR_PATH /etc/divvy/*.env` prints only `/etc/divvy/worker.env`, and `build.env` holds only `NEXT_PUBLIC_*` lines.
- [ ] `sudo -u divvy-api ls /etc/divvy/keys` and `sudo -u divvy-web ls /etc/divvy/keys` both fail with "Permission denied".
- [ ] `envcheck` (runbook shell helpers) says `api.env` and `worker.env` agree.
- [ ] `ps -eo user:14,args | grep -E 'next start|server\.js|index\.js' | grep -v grep` shows each app under its own user.
- [ ] `API_MODE=live`, `PAYOUTS_DRY_RUN=true` and `DIVVY_MAINNET_ENABLED=false`, and the worker's `worker started` log line agrees.
- [ ] The Telegram test message arrived (§12).
- [ ] Each user's `pm2 ls` shows its own app online, and they come back after a reboot.
- [ ] `curl -sI https://divvy.example` returns the security headers and a CSP with the real RPC origin.
- [ ] `certbot renew --dry-run` passes.
- [ ] One backup has been written by `divvy-backup` and restored into a scratch database.

## Moving from the single-user layout

For a server set up with one `divvy` user running everything from `/etc/divvy/divvy.env`. Do it in a quiet hour, with launches paused and no payout run in progress (RUNBOOK "Deploy"). The site is down from step 6 until step 7.

1. **Users and folders.** Run §3. `adduser` reports that `divvy` already exists; that's fine. Then fix what the old layout owned differently:
   ```bash
   sudo chown root:root /etc/divvy && sudo chmod 755 /etc/divvy
   sudo chown -R divvy-worker:divvy-worker /etc/divvy/keys && sudo chmod 700 /etc/divvy/keys
   sudo find /etc/divvy/keys -name '*.json' -exec chmod 400 {} +
   sudo chown -R divvy-backup:divvy-backup /var/backups/divvy
   sudo chown root:adm /var/log/divvy && sudo chmod 755 /var/log/divvy
   ```
2. **Env files.** Create the five files (§8) and copy each line of `divvy.env` into the files that need it. Run `envcheck`.
3. **Media.** If `STORAGE_DIR` pointed somewhere else, copy that folder's contents to `/var/lib/divvy/media`, keeping the paths, then `sudo chown -R divvy-api:divvy-media /var/lib/divvy/media/img`, `sudo chown -R divvy-worker:divvy-media /var/lib/divvy/media/meta` and `sudo find /var/lib/divvy/media -mindepth 1 -type d -exec chmod g+s {} +`. `PUBLIC_MEDIA_BASE` stays the same: the metadata URIs on chain must keep working.
4. **Backup credentials** move from `divvy` to `divvy-backup` (skip the rclone lines if there's no offsite copy):
   ```bash
   sudo install -o divvy-backup -g divvy-backup -m 600 /home/divvy/.pgpass /home/divvy-backup/.pgpass
   sudo install -d -o divvy-backup -g divvy-backup -m 700 /home/divvy-backup/.config /home/divvy-backup/.config/rclone
   sudo install -o divvy-backup -g divvy-backup -m 600 /home/divvy/.config/rclone/rclone.conf /home/divvy-backup/.config/rclone/rclone.conf
   ```
5. **Build and check a release** with RUNBOOK "Deploy" steps 1 to 3. Step 1 links `build.env`, step 2 applies any new migrations, and step 3 smoke-tests under the new users and env files.
6. **Stop the old daemon and switch.**
   ```bash
   sudo systemctl disable --now pm2-divvy && sudo rm /etc/systemd/system/pm2-divvy.service && sudo systemctl daemon-reload
   sudo -iu divvy pm2 kill
   ```
   Then the first line of RUNBOOK "Deploy" step 4 (the `current` switch).
7. **Start the apps** with the loop in §10, then install the new log rotation (§10) and the backup copy and cron line (§11). Verify with RUNBOOK "Deploy" step 5 and the checklist above.
8. **Remove the old secrets:** `sudo shred -u /etc/divvy/divvy.env /home/divvy/.pgpass /home/divvy/.config/rclone/rclone.conf`. Move the old `/var/log/divvy/*.log*` files aside or delete them.

Releases built before this change ship a process file that reads `/etc/divvy/divvy.env`. To roll back to one, run the PM2 commands with a newer release's `deploy/ecosystem.config.cjs` instead of `/srv/divvy/current/deploy/ecosystem.config.cjs`.
