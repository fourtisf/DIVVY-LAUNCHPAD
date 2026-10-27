#!/usr/bin/env bash
# uspad.fun: from the demo preview to the live mainnet site on this server, and updates afterwards.
# Run as root. The API keys come from /root/uspad-secrets.env (HELIUS_API_KEY, JUP_API_KEY).
#
#   go-live.sh prepare            no SOL. Postgres, Redis, users, wallet keys, env files, build,
#                                 migrations, dividend stocks. The demo site keeps running.
#   go-live.sh platform-config    dry run of the PlatformConfig creation (shows the fee and the cost).
#   I_HAVE_OWNER_APPROVAL=yes go-live.sh platform-config --send
#                                 💰 creates it. Only after the owner's OK in chat (CLAUDE.md rule 3).
#   go-live.sh switch             demo off, live site on, launches paused, payouts in dry-run.
#   go-live.sh update             deploys the latest commit (demo or live, whichever is running).
#   go-live.sh status             apps, health, wallet addresses and balances.
#
# It follows deploy/setup-vps.md and docs/RUNBOOK.md "Deploy" with uspad's values; the why is in
# deploy/mainnet/README.md. Every step can be run again: what exists is kept.
set -euo pipefail

DOMAIN=uspad.fun
REPO=https://github.com/fourtisf/uspad.git
BRANCH=claude/new-session-qmy02t
SECRETS=/root/uspad-secrets.env
GEN=/root/uspad-generated.env          # database and Redis passwords made by this script
ADMIN_KEY=/root/uspad-keys/platform-admin.json
KEYS=/etc/divvy/keys
ENV_DIR=/etc/divvy
CUR=/srv/divvy/current
ECO=$CUR/deploy/ecosystem.config.cjs
LIVE_MARK=/root/uspad-live-since
# The browser's RPC. Public and rate-limited; a second Helius key restricted to uspad.fun is better
# (it ends up in the browser, so never the server's key). Changing it needs `update` and Nginx's CSP.
BROWSER_RPC=https://api.mainnet-beta.solana.com
# Starting caps (owner can change them in worker.env): launcher 1 SOL/h, swaps 5 SOL/h (2 per
# stock), sends $1,000/h.
LAUNCHER_CAP=1000000000
SWAP_CAP=5000000000
SWAP_BATCH=2000000000
PUSH_CAP_USD=1000

say() { printf '\n\033[1;32m== %s\033[0m\n' "$*"; }
note() { printf '   %s\n' "$*"; }
die() { printf '\033[1;31mERROR: %s\033[0m\n' "$*" >&2; exit 1; }
has_systemd() { [ -d /run/systemd/system ]; }
pm2as() { local u=$1; shift; sudo -iu "$u" pm2 "$@"; }

[ "$(id -u)" = 0 ] || die "jalankan sebagai root"

load_secrets() {
  [ -f "$SECRETS" ] || die "$SECRETS belum ada. Simpan HELIUS_API_KEY dan JUP_API_KEY di sana dulu (chmod 600)."
  set -a; . "$SECRETS"; set +a
  : "${HELIUS_API_KEY:?kosong di $SECRETS}" "${JUP_API_KEY:?kosong di $SECRETS}"
  RPC="https://mainnet.helius-rpc.com/?api-key=$HELIUS_API_KEY"
}

# Ed25519 keypair as a solana-keygen JSON file (mode 400), with Node's own crypto and no packages, so
# no dependency ever sees a secret key (deploy/setup-vps.md §8). Prints only the public key.
KEYGEN_JS='
const { generateKeyPairSync } = require("node:crypto");
const { writeFileSync } = require("node:fs");
const [file] = process.argv.slice(1);
const jwk = generateKeyPairSync("ed25519").privateKey.export({ format: "jwk" });
const seed = Buffer.from(jwk.d, "base64url"), pub = Buffer.from(jwk.x, "base64url");
writeFileSync(file, JSON.stringify([...seed, ...pub]), { mode: 0o400, flag: "wx" });'
PUBKEY_JS='
const pub = Buffer.from(JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).slice(32));
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
let n = BigInt("0x" + pub.toString("hex")), addr = "";
for (; n > 0n; n /= 58n) addr = B58[Number(n % 58n)] + addr;
for (const b of pub) { if (b !== 0) break; addr = "1" + addr; }
console.log(addr);'
pubkey() { (cd / && node -e "$PUBKEY_JS" "$1"); }
gen_key() { # file owner
  [ -e "$1" ] && return 0
  (cd / && sudo -u "$2" node -e "$KEYGEN_JS" "$1")
}

# An env file is written once; later runs leave it alone so hand edits survive.
write_env() { # file owner (content on stdin)
  if [ -s "$1" ]; then note "$1 sudah ada, tidak diubah"; cat > /dev/null; return 0; fi
  install -o "$2" -g "$2" -m 600 /dev/null "$1"
  cat > "$1"
}
env_get() { grep -E "^$2=" "$1" | tail -n 1 | cut -d= -f2-; }
# As divvy-backup, so its log stays writable for the nightly cron job.
run_backup() { sudo -u divvy-backup -H bash -c '/usr/local/bin/divvy-pg-backup >> /var/log/divvy/backup/backup.log 2>&1'; }

platform_pda() { # admin pubkey → PlatformConfig PDA, from the SDK (seed ["platform_config", admin])
  (cd "$CUR/packages/solana" && node -e '
    const { getPdaPlatformId, LAUNCHPAD_PROGRAM } = require("@raydium-io/raydium-sdk-v2");
    const { PublicKey } = require("@solana/web3.js");
    console.log(getPdaPlatformId(LAUNCHPAD_PROGRAM, new PublicKey(process.argv[1])).publicKey.toBase58());' "$1" 2>/dev/null)
}

account_exists() { # address → "yes"/"no" on mainnet
  (cd "$CUR/packages/solana" && RPC_URL="$RPC" node -e '
    const { Connection, PublicKey } = require("@solana/web3.js");
    new Connection(process.env.RPC_URL, "confirmed").getAccountInfo(new PublicKey(process.argv[1]))
      .then((a) => console.log(a ? "yes" : "no"), (e) => { console.error(String(e).replace(/api-key=[^&\s"]+/g, "api-key=…")); process.exit(1); });' "$1" 2>/dev/null)
}

build_release() { # sets REL
  say "Kode terbaru dan build (beberapa menit)"
  sudo -u divvy -H bash -c "set -e
    if [ -d /srv/divvy/repo.git ]; then git -C /srv/divvy/repo.git fetch --prune -q origin; else git clone -q --mirror $REPO /srv/divvy/repo.git; fi"
  local sha
  sha=$(sudo -u divvy git -C /srv/divvy/repo.git rev-parse "refs/heads/$BRANCH")
  REL=/srv/divvy/releases/$(date -u +%Y%m%d%H%M%S)-${sha:0:7}
  sudo -u divvy -H bash -c "set -e
    mkdir '$REL'
    git -C /srv/divvy/repo.git archive '$sha' | tar -x -C '$REL'
    echo '$sha' > '$REL/REVISION'
    ln -s $ENV_DIR/build.env '$REL/.env'
    cd '$REL'
    pnpm install --frozen-lockfile
    pnpm build"
  mkdir -p "$REL/apps/web/.next/cache" && chown -R divvy-web:divvy-web "$REL/apps/web/.next/cache"
  note "release $REL"
}

point_current() { # release
  sudo -u divvy ln -sfn "$1" /srv/divvy/current.next && sudo -u divvy mv -Tf /srv/divvy/current.next /srv/divvy/current
}

migrate() {
  say "Migrasi database"
  (cd "$CUR/packages/db" && sudo -u divvy-api -H node --env-file=$ENV_DIR/api.env ./node_modules/prisma/build/index.js migrate deploy)
}

smoke() { # release: boots it next to the running site on spare ports (RUNBOOK "Deploy", step 2)
  say "Uji coba build di port cadangan"
  (cd "$1/apps/api" && sudo -u divvy-api -H env NODE_ENV=production API_PORT=4001 timeout 40 \
    node --env-file=$ENV_DIR/api.env dist/server.js > /tmp/smoke-api.log 2>&1 &)
  (cd "$1/apps/web" && sudo -u divvy-web -H env NODE_ENV=production API_INTERNAL_URL=http://127.0.0.1:4001 timeout 35 \
    node --env-file=$ENV_DIR/web.env node_modules/next/dist/bin/next start -p 3001 -H 127.0.0.1 > /tmp/smoke-web.log 2>&1 &)
  sleep 14
  curl -fsS http://127.0.0.1:4001/api/health | grep -q '"mode":"live"' || { tail -n 30 /tmp/smoke-api.log; die "API baru tidak sehat (log di atas). Situs lama tetap jalan."; }
  [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3001/)" = 200 ] || { tail -n 30 /tmp/smoke-web.log; die "Web baru tidak sehat (log di atas). Situs lama tetap jalan."; }
  (cd "$1/apps/worker" && sudo -u divvy-worker -H env NODE_ENV=production WORKER_ROLES=none timeout 15 \
    node --env-file=$ENV_DIR/worker.env dist/index.js > /tmp/smoke-worker.log 2>&1) || true
  grep -q '"msg":"worker started"' /tmp/smoke-worker.log || { tail -n 30 /tmp/smoke-worker.log; die "Worker baru tidak mau start (log di atas)."; }
  note "API, web dan worker baru sehat"
}

# --------------------------------------------------------------------------------------------------
prepare() {
  load_secrets
  say "Sistem: zona waktu UTC, swap, paket"
  if has_systemd; then timedatectl set-timezone Etc/UTC; fi
  if [ -z "$(swapon --show 2>/dev/null)" ] && [ "$(awk '/MemTotal/{print $2}' /proc/meminfo)" -lt 6000000 ]; then
    fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile > /dev/null && swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    note "swap 2 GB dibuat"
  fi
  # A broken third-party repository (expired key, say) fails `apt-get update` without stopping the
  # Ubuntu lists from refreshing, so it's reported and the install goes on.
  apt-get update -q > /tmp/uspad-apt.log 2>&1 || { note "apt-get update melaporkan masalah (bukan dari Ubuntu):"; grep -E '^(E|W):' /tmp/uspad-apt.log | sed 's/^/     /' | head -n 6; }
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q postgresql redis-server jq libnginx-mod-http-geoip2 > /dev/null

  say "User dan folder (satu user per aplikasi)"
  id divvy > /dev/null 2>&1 || adduser --disabled-password --gecos "" divvy > /dev/null
  for u in divvy-web divvy-api divvy-worker; do
    id "$u" > /dev/null 2>&1 || adduser --system --group --home "/home/$u" --shell /bin/bash "$u" > /dev/null
  done
  id divvy-backup > /dev/null 2>&1 || adduser --system --group --home /home/divvy-backup divvy-backup > /dev/null
  getent group divvy-media > /dev/null || addgroup --system divvy-media > /dev/null
  usermod -aG divvy-media divvy-api && usermod -aG divvy-media divvy-worker
  install -d -o divvy -g divvy -m 755 /srv/divvy /srv/divvy/releases
  install -d -o root -g root -m 755 $ENV_DIR /var/lib/divvy
  install -d -o divvy-worker -g divvy-worker -m 700 $KEYS
  install -d -o root -g divvy-media -m 2770 /var/lib/divvy/media
  install -d -o divvy-backup -g divvy-backup -m 700 /var/backups/divvy
  install -d -o root -g adm -m 755 /var/log/divvy
  for a in web api worker backup; do install -d -o "divvy-$a" -g adm -m 750 "/var/log/divvy/$a"; done
  install -d -o root -g root -m 700 /root/uspad-keys
  [ -f "$GEN" ] || install -m 600 /dev/null "$GEN"

  say "PostgreSQL"
  has_systemd && systemctl enable --now postgresql > /dev/null 2>&1 || service postgresql start > /dev/null 2>&1 || true
  if [ -z "$(env_get "$GEN" DB_PASS)" ]; then
    echo "DB_PASS=$(openssl rand -hex 24)" >> "$GEN"
  fi
  DB_PASS=$(env_get "$GEN" DB_PASS)
  # The password in $GEN is the one that counts, also for a role left by an earlier attempt.
  sudo -u postgres psql -XAtc "select 1 from pg_roles where rolname='divvy'" | grep -q 1 || sudo -u postgres psql -Xq -c "CREATE ROLE divvy LOGIN"
  sudo -u postgres psql -Xq -c "ALTER ROLE divvy WITH LOGIN PASSWORD '$DB_PASS'"
  sudo -u postgres psql -XAtc "select 1 from pg_database where datname='divvy'" | grep -q 1 || sudo -u postgres psql -Xq -c "CREATE DATABASE divvy OWNER divvy"
  DATABASE_URL="postgresql://divvy:$DB_PASS@127.0.0.1:5432/divvy?schema=public"
  echo "127.0.0.1:5432:*:divvy:$DB_PASS" | sudo -u divvy-backup bash -c 'umask 077; cat > /home/divvy-backup/.pgpass'

  say "Redis (password, tidak ada yang dibuang diam-diam)"
  if [ -z "$(env_get "$GEN" REDIS_PASS)" ]; then echo "REDIS_PASS=$(openssl rand -hex 32)" >> "$GEN"; fi
  REDIS_PASS=$(env_get "$GEN" REDIS_PASS)
  if ! grep -q "^requirepass $REDIS_PASS" /etc/redis/redis.conf; then
    [ -f /etc/redis/redis.conf.orig ] || cp /etc/redis/redis.conf /etc/redis/redis.conf.orig
    printf '\n# --- uspad (later lines override earlier ones) ---\nbind 127.0.0.1 -::1\nprotected-mode yes\nport 6379\nrequirepass %s\nmaxmemory 512mb\nmaxmemory-policy noeviction\n' "$REDIS_PASS" >> /etc/redis/redis.conf
    if has_systemd; then systemctl restart redis-server; else service redis-server restart > /dev/null; fi
  fi
  REDIS_URL="redis://default:$REDIS_PASS@127.0.0.1:6379/0"
  REDISCLI_AUTH="$REDIS_PASS" redis-cli -h 127.0.0.1 ping | grep -q PONG || die "Redis tidak menjawab"

  say "Wallet: launcher, payout vault, fee claimer, dan platform admin"
  gen_key $KEYS/launcher.json divvy-worker
  gen_key $KEYS/payout-vault.json divvy-worker
  gen_key $KEYS/fee-claimer.json divvy-worker
  gen_key "$ADMIN_KEY" root
  FEE=$(pubkey $KEYS/fee-claimer.json)
  ADMIN=$(pubkey "$ADMIN_KEY")

  say "Env untuk build dan web"
  write_env $ENV_DIR/build.env divvy <<EOF
NEXT_PUBLIC_SOLANA_CLUSTER=mainnet-beta
NEXT_PUBLIC_SOLANA_RPC_URL=$BROWSER_RPC
NEXT_PUBLIC_TERMS_FINAL=false
NEXT_PUBLIC_TOKEN_CA=
EOF
  write_env $ENV_DIR/web.env divvy-web <<EOF
WEB_ORIGIN=https://$DOMAIN
API_INTERNAL_URL=http://127.0.0.1:4000
EOF

  build_release
  point_current "$REL"
  PDA=$(platform_pda "$ADMIN")
  [ -n "$PDA" ] || die "alamat PlatformConfig tidak bisa dihitung"

  say "Env untuk API, worker dan backup"
  local business
  business=$(cat <<EOF
# Business parameters: identical in api.env and worker.env (envcheck).
FEE_TRADE_BPS=100
FEE_PROTOCOL_BPS=25
FEE_HOLDERS_BPS=50
FEE_CREATOR_BPS=15
FEE_DIVVY_BPS=10
PAYOUT_DELIVERY=push
PAYOUTS_DRY_RUN=true
MIN_ROUND_USD=5
MIN_HOLDER_USD=10
AUTO_PUSH_MIN_USD=1
DELIVERY_FEE_USD=0.02
LAUNCHER_HOURLY_CAP_LAMPORTS=$LAUNCHER_CAP
BLOCKED_COUNTRIES=US
ADMIN_WALLETS=
EOF
)
  local shared
  shared=$(cat <<EOF
DATABASE_URL=$DATABASE_URL
REDIS_URL=$REDIS_URL
STORAGE_DRIVER=local
STORAGE_DIR=/var/lib/divvy/media
PUBLIC_MEDIA_BASE=https://$DOMAIN/api/media/files
SOLANA_CLUSTER=mainnet-beta
SOLANA_RPC_URL=$RPC
DIVVY_PLATFORM_CONFIG=$PDA
JUP_BASE_URL=https://api.jup.ag
# Nothing is signed on mainnet while this is false.
DIVVY_MAINNET_ENABLED=false
EOF
)
  write_env $ENV_DIR/api.env divvy-api <<EOF
API_MODE=live
API_HOST=127.0.0.1
API_PORT=4000
WEB_ORIGIN=https://$DOMAIN
LOG_LEVEL=info
GEO_HEADER=x-geo-country
JUP_API_KEY_API=$JUP_API_KEY
$shared
$business
EOF
  write_env $ENV_DIR/worker.env divvy-worker <<EOF
$shared
JUP_API_KEY=$JUP_API_KEY
JITO_TIP_LAMPORTS=100000
LAUNCHER_KEYPAIR_PATH=$KEYS/launcher.json
PAYOUT_VAULT_KEYPAIR_PATH=$KEYS/payout-vault.json
FEE_CLAIMER_KEYPAIR_PATH=$KEYS/fee-claimer.json
$business
WORKER_ROLES=launch,claims,indexer,payouts,prices,status,reserved
HOT_WALLET_MIN_SOL=0.05
TELEGRAM_BOT_TOKEN=
TELEGRAM_ALERT_CHAT_ID=
# Set true after set-cp-creator.ts lands (platform_cp_creator = fee claimer).
CPMM_CREATOR_FEES=false
# Set true after the first graduated coin's simulated harvest checks out (README phase 6).
LOCKED_LP_FEES=false
SWAP_HOURLY_CAP_LAMPORTS=$SWAP_CAP
SWAP_BATCH_MAX_LAMPORTS=$SWAP_BATCH
PUSH_HOURLY_CAP_USD=$PUSH_CAP_USD
EOF
  write_env $ENV_DIR/backup.env divvy-backup <<EOF
DATABASE_URL=$DATABASE_URL
RCLONE_REMOTE=
EOF

  migrate

  say "Saham dividen (dari pengecekan on-chain, tidak pernah diketik tangan)"
  export RPC_URL="$RPC" JUP_API_KEY
  (cd "$CUR/packages/solana" && sudo -u divvy -H --preserve-env=RPC_URL,JUP_API_KEY ./node_modules/.bin/tsx scripts/phase0/fetch-xstocks.ts --json) > /tmp/uspad-xstocks.json 2> /tmp/uspad-xstocks.err || true
  unset RPC_URL
  chmod 644 /tmp/uspad-xstocks.json
  if jq -e 'length > 0' /tmp/uspad-xstocks.json > /dev/null 2>&1; then
    (cd "$CUR/apps/worker" && sudo -u divvy-worker -H node --env-file=$ENV_DIR/worker.env --import tsx scripts/seed-dividend-assets.ts /tmp/uspad-xstocks.json --write)
  else
    note "fetch-xstocks gagal, saham belum dimasukkan:"; sed 's/api-key=[^&" ]*/api-key=…/g' /tmp/uspad-xstocks.err | tail -n 5
  fi

  say "Selesai (tanpa SOL). Situs demo masih jalan."
  cat <<EOF

   Alamat wallet (publik, aman dibagikan):
     platform admin  $ADMIN
     fee claimer     $FEE
     launcher        $(pubkey $KEYS/launcher.json)
     payout vault    $(pubkey $KEYS/payout-vault.json)
   PlatformConfig yang akan dibuat: $PDA

   Langkah berikutnya:
     1. /root/go-live.sh platform-config        (dry run, gratis)
     2. Kirim hasilnya ke Claude, lalu kirim 0,02 SOL ke platform admin setelah disetujui.
   Simpan cadangan /root/uspad-keys/ dan /etc/divvy/keys/ secara terenkripsi di tempat aman.
EOF
}

# --------------------------------------------------------------------------------------------------
platform_config() {
  load_secrets
  [ -L "$CUR" ] && [ -f "$ADMIN_KEY" ] || die "jalankan 'go-live.sh prepare' dulu"
  local fee admin send=()
  fee=$(pubkey $KEYS/fee-claimer.json)
  admin=$(pubkey "$ADMIN_KEY")
  if [ "${1:-}" = "--send" ]; then
    [ "${I_HAVE_OWNER_APPROVAL:-}" = yes ] || die "--send butuh I_HAVE_OWNER_APPROVAL=yes (persetujuan owner di chat)"
    send=(--send)
  fi
  say "PlatformConfig ${send[*]:-(dry run)}  admin $admin, fee claimer $fee"
  (cd "$CUR/packages/solana" && env RPC_URL="$RPC" PLATFORM_ADMIN_KEYPAIR="$ADMIN_KEY" FEE_WALLET="$fee" NFT_WALLET="$fee" \
    NAME=uspad WEB="https://$DOMAIN" IMG="https://$DOMAIN/brand/uspad-mark-512.png" I_HAVE_OWNER_APPROVAL="${I_HAVE_OWNER_APPROVAL:-}" \
    ./node_modules/.bin/tsx scripts/phase0/create-platform-config.ts "${send[@]}" 2>&1) | sed 's/api-key=[^&" ]*/api-key=…/g'
  note "PDA di api.env: $(env_get $ENV_DIR/api.env DIVVY_PLATFORM_CONFIG)"
}

# --------------------------------------------------------------------------------------------------
switch() {
  load_secrets
  [ -L "$CUR" ] || die "jalankan 'go-live.sh prepare' dulu"
  local pda
  pda=$(env_get $ENV_DIR/api.env DIVVY_PLATFORM_CONFIG)
  [ "$(account_exists "$pda")" = yes ] || die "PlatformConfig $pda belum ada di mainnet. Buat dulu: go-live.sh platform-config"

  smoke "$(readlink -f $CUR)"

  say "Matikan situs demo"
  if id divvy > /dev/null 2>&1; then sudo -iu divvy pm2 kill > /dev/null 2>&1 || true; fi
  if has_systemd && systemctl list-unit-files pm2-divvy.service > /dev/null 2>&1; then
    systemctl disable --now pm2-divvy > /dev/null 2>&1 || true
    rm -f /etc/systemd/system/pm2-divvy.service && systemctl daemon-reload
  fi

  say "Jalankan aplikasi live (masing-masing user sendiri)"
  for u in divvy-web divvy-api divvy-worker; do
    pm2as "$u" start "$ECO" --only "$u" > /dev/null
    pm2as "$u" save > /dev/null
    if has_systemd; then env PATH="$PATH" pm2 startup systemd -u "$u" --hp "/home/$u" > /dev/null; fi
  done
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
  done > /etc/logrotate.d/divvy

  say "Database negara pengunjung (DB-IP Lite, CC BY 4.0)"
  install -d -m 755 /var/lib/GeoIP
  if [ ! -s /var/lib/GeoIP/GeoLite2-Country.mmdb ]; then
    local m
    for m in "$(date -u +%Y-%m)" "$(date -u -d '-1 month' +%Y-%m)"; do
      curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-$m.mmdb.gz" | gunzip > /var/lib/GeoIP/GeoLite2-Country.mmdb.new && break
    done
    [ -s /var/lib/GeoIP/GeoLite2-Country.mmdb.new ] || die "database negara tidak bisa diunduh"
    mv /var/lib/GeoIP/GeoLite2-Country.mmdb.new /var/lib/GeoIP/GeoLite2-Country.mmdb
  fi
  cat > /etc/cron.d/uspad-geoip <<'EOF'
# Refresh the DB-IP Lite country database monthly (deploy/mainnet/go-live.sh).
SHELL=/bin/bash
17 4 3 * * root curl -fsSL "https://download.db-ip.com/free/dbip-country-lite-$(date -u +\%Y-\%m).mmdb.gz" | gunzip > /var/lib/GeoIP/GeoLite2-Country.mmdb.new && [ -s /var/lib/GeoIP/GeoLite2-Country.mmdb.new ] && mv /var/lib/GeoIP/GeoLite2-Country.mmdb.new /var/lib/GeoIP/GeoLite2-Country.mmdb && systemctl reload nginx
EOF

  say "Nginx: situs live, launch dijeda"
  local rpc_host=${BROWSER_RPC#https://}
  rpc_host=${rpc_host%%/*}
  install -d -m 755 /var/www/certbot
  sed -e "s/rpc\.divvy\.example/$rpc_host/g" -e "s/divvy\.example/$DOMAIN/g" "$CUR/deploy/nginx/divvy.conf" > /etc/nginx/sites-available/uspad-live.conf
  touch /etc/nginx/divvy-launches-paused
  rm -f /etc/nginx/sites-enabled/uspad.conf /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/uspad-live.conf /etc/nginx/sites-enabled/uspad-live.conf
  if ! nginx -t > /dev/null 2>&1; then
    if nginx -t 2>&1 | grep -q "Address family not supported"; then
      sed -i '/listen \[::\]/d' /etc/nginx/sites-available/uspad-live.conf
    fi
    nginx -t || die "konfigurasi Nginx ditolak (lihat di atas)"
  fi
  if has_systemd; then systemctl reload nginx; else nginx -s reload; fi

  say "Backup database harian"
  install -o root -g root -m 755 "$CUR/deploy/backup/pg-backup.sh" /usr/local/bin/divvy-pg-backup
  cat > /etc/cron.d/divvy-backup <<'EOF'
# Daily PostgreSQL backup at 03:40 UTC (deploy/backup/pg-backup.sh, restore: deploy/backup/pg-restore.md).
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
40 3 * * * divvy-backup /usr/local/bin/divvy-pg-backup >> /var/log/divvy/backup/backup.log 2>&1
EOF
  chmod 644 /etc/cron.d/divvy-backup
  run_backup || note "backup pertama gagal; lihat /var/log/divvy/backup/backup.log"

  date -u +%FT%TZ > "$LIVE_MARK"
  sleep 8
  status
  cat <<EOF

   Situs live. Data demo sudah hilang, launch dijeda, dividen dalam dry-run, mainnet-gate mati.
   Langkah berikutnya ada di deploy/mainnet/README.md (fase 3 dan 4): creator fee pool, isi wallet,
   lalu DIVVY_MAINNET_ENABLED=true. Semuanya setelah persetujuan owner.
EOF
}

# --------------------------------------------------------------------------------------------------
update() {
  if [ ! -f "$LIVE_MARK" ]; then
    say "Update situs demo"
    sudo -iu divvy bash -c 'cd /srv/divvy/app && git pull && pnpm install --frozen-lockfile && pnpm --filter @divvy/api --filter @divvy/web build && pm2 reload deploy/preview/preview.config.cjs'
    return
  fi
  load_secrets
  build_release
  smoke "$REL"
  if ! diff -q <(ls -1 "$CUR/packages/db/prisma/migrations") <(ls -1 "$REL/packages/db/prisma/migrations") > /dev/null; then
    say "Ada migrasi baru: backup dulu"
    run_backup
    point_current "$REL"
    migrate
  else
    point_current "$REL"
  fi
  say "Reload aplikasi"
  pm2as divvy-web reload "$ECO" --only divvy-web --update-env > /dev/null
  pm2as divvy-api reload "$ECO" --only divvy-api --update-env > /dev/null
  # Not in the middle of a payout run (RUNBOOK "Deploy").
  local i
  for i in $(seq 1 60); do
    [ "$(REDISCLI_AUTH="$(env_get "$GEN" REDIS_PASS)" redis-cli -h 127.0.0.1 EXISTS divvy:lock:payouts)" = 0 ] && break
    [ "$i" = 1 ] && note "menunggu putaran dividen selesai..."
    sleep 5
  done
  pm2as divvy-worker restart "$ECO" --only divvy-worker --update-env > /dev/null
  (cd /srv/divvy/releases && ls -1dt -- */ | tail -n +6 | while read -r d; do
    [ "$(readlink -f "$d")" = "$(readlink -f $CUR)" ] || rm -rf -- "/srv/divvy/releases/${d%/}"
  done)
  sleep 8
  status
}

# --------------------------------------------------------------------------------------------------
status() {
  load_secrets
  say "Aplikasi"
  if [ -f "$LIVE_MARK" ]; then
    for u in divvy-web divvy-api divvy-worker; do pm2as "$u" jlist 2>/dev/null | jq -r '.[] | "   \(.name): \(.pm2_env.status), restarts \(.pm2_env.restart_time)"'; done
    note "health: $(curl -fsS https://$DOMAIN/api/health 2>/dev/null || echo 'tidak menjawab')"
    note "worker: $(grep '"msg":"worker started"' /var/log/divvy/worker/worker.out.log 2>/dev/null | tail -n 1 | jq -c '{cluster, mainnetEnabled, payoutsDryRun, delivery}' 2>/dev/null || echo '?')"
    note "launch: $([ -f /etc/nginx/divvy-launches-paused ] && echo dijeda || echo buka)"
  else
    note "situs demo (belum switch)"
  fi
  if [ -L "$CUR" ] && [ -f "$ADMIN_KEY" ]; then
    say "Wallet (saldo SOL di mainnet)"
    local args=()
    args+=("platform-admin=$(pubkey "$ADMIN_KEY")")
    for r in fee-claimer launcher payout-vault; do args+=("$r=$(pubkey $KEYS/$r.json)"); done
    (cd "$CUR/packages/solana" && RPC_URL="$RPC" node -e '
      const { Connection, PublicKey } = require("@solana/web3.js");
      const c = new Connection(process.env.RPC_URL, "confirmed");
      (async () => { for (const a of process.argv.slice(1)) { const [r, k] = a.split("=");
        const l = await c.getBalance(new PublicKey(k)).catch(() => null);
        console.log(`   ${r.padEnd(15)} ${k}  ${l === null ? "?" : (l / 1e9).toFixed(4) + " SOL"}`); } })();' "${args[@]}" 2>/dev/null)
  fi
}

case "${1:-}" in
  prepare) prepare ;;
  platform-config) platform_config "${2:-}" ;;
  switch) switch ;;
  update) update ;;
  status) status ;;
  *) sed -n '2,15p' "$0"; exit 1 ;;
esac
