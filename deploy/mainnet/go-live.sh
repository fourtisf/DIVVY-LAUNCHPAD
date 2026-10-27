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
#   go-live.sh x-login            asks for the X app's OAuth 2.0 Client ID and Secret and turns on
#                                 "Link your X account" (no rebuild).
#   go-live.sh cp-creator         dry run: the CPMM creator fee of graduated coins to the operations
#                                 wallet. Possible from the epoch after the PlatformConfig's.
#   I_HAVE_OWNER_APPROVAL=yes go-live.sh cp-creator --send
#                                 💰 sets it (about 0.0001 SOL) and turns on CPMM_CREATOR_FEES.
#   I_HAVE_OWNER_APPROVAL=yes go-live.sh open-launches
#                                 💰 checks that the indexer reads recent mainnet transactions, sets the
#                                 owner's admin wallet, turns the mainnet gate on and opens launches to
#                                 admins only, for the owner's test launch.
#   go-live.sh launches open|pause [reason]
#                                 opens launches to everyone, or pauses them (admins can still launch).
#   go-live.sh launch-fee <SOL>   what a creator pays per launch (e.g. 0.02), to the operations wallet
#                                 that pays the create. With a fee there is no daily limit per wallet
#                                 and a failed launch keeps its fee as credit. 0 = free launches.
#   go-live.sh payouts check      the dry-run's last hours: runs, vault, rounds, holders (RUNBOOK
#                                 "First dry-run hours").
#   I_HAVE_OWNER_APPROVAL=yes go-live.sh payouts live
#                                 💰 real dividends: claims the fee vault, buys the stocks, sends them.
#   go-live.sh payouts dry-run    back to computing without sending.
#   go-live.sh payouts minimum <USD>
#                                 a coin's hourly holders' share under this waits for the next hour ($1).
#   go-live.sh token-ca <address> shows the uspad token's contract address in the hero instead of
#                                 "CA: coming soon" (rebuilds the site: it is a NEXT_PUBLIC_ value).
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
# The browser's RPC: uspad's own relay to the server's RPC (apps/api/src/live/routes/rpc.ts). The public
# mainnet RPC refuses websites' requests, and the Helius key must never reach a browser. A full URL
# here (e.g. a second Helius key restricted to uspad.fun) works too. `update` applies it.
BROWSER_RPC=/api/rpc
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
set_env() { sed -i -E "/^$2=/d" "$1"; printf '%s=%s\n' "$2" "$3" >> "$1"; } # file key value
# As divvy-backup, so its log stays writable for the nightly cron job.
run_backup() { sudo -u divvy-backup -H bash -c '/usr/local/bin/divvy-pg-backup >> /var/log/divvy/backup/backup.log 2>&1'; }

platform_pda() { # admin pubkey → PlatformConfig PDA, from the SDK (seed ["platform_config", admin])
  (cd "$CUR/packages/solana" && node -e '
    const { getPdaPlatformId, LAUNCHPAD_PROGRAM } = require("@raydium-io/raydium-sdk-v2");
    const { PublicKey } = require("@solana/web3.js");
    console.log(getPdaPlatformId(LAUNCHPAD_PROGRAM, new PublicKey(process.argv[1])).publicKey.toBase58());' "$1" 2>/dev/null)
}

balance_of() { # address → lamports on mainnet, or "?"
  (cd "$CUR/packages/solana" && RPC_URL="$RPC" node -e '
    const { Connection, PublicKey } = require("@solana/web3.js");
    new Connection(process.env.RPC_URL, "confirmed").getBalance(new PublicKey(process.argv[1]))
      .then((l) => console.log(l), () => console.log("?"));' "$1" 2>/dev/null) || echo "?"
}

# uspad runs the launcher, fee-claimer and payout-vault roles on one operations wallet (owner
# decision 2026-10-27), kept in fee-claimer.json because it is also the PlatformConfig's fee and
# Fee Key wallet. Earlier runs made separate launcher and payout-vault keys: point worker.env at the
# operations wallet and delete those keys, but only if they hold nothing on chain.
merge_wallets() {
  local f addr bal
  [ -f $ENV_DIR/worker.env ] && sed -i -E "s#^(LAUNCHER|PAYOUT_VAULT)_KEYPAIR_PATH=.*#\1_KEYPAIR_PATH=$KEYS/fee-claimer.json#" $ENV_DIR/worker.env
  for f in $KEYS/launcher.json $KEYS/payout-vault.json; do
    [ -f "$f" ] || continue
    addr=$(pubkey "$f")
    bal=$([ -L "$CUR" ] && balance_of "$addr" || echo "?")
    if [ "$bal" = 0 ]; then rm -f "$f"; note "wallet lama $addr kosong, dihapus"
    else note "PERHATIAN: wallet lama $addr berisi $bal lamports (atau tidak bisa dicek); $f disimpan"; fi
  done
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

# Before the switch only (the live site moves to a new release through `update`): the release from
# `prepare` may be behind the branch, so the admin scripts and the go-live run on the latest commit.
latest_release() {
  [ -f "$LIVE_MARK" ] && return 0
  sudo -u divvy git -C /srv/divvy/repo.git fetch --prune -q origin
  [ "$(cat "$CUR/REVISION" 2>/dev/null)" = "$(sudo -u divvy git -C /srv/divvy/repo.git rev-parse "refs/heads/$BRANCH")" ] && return 0
  build_release
  point_current "$REL"
  migrate
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

  say "Wallet: platform admin dan wallet operasional"
  gen_key $KEYS/fee-claimer.json divvy-worker
  gen_key "$ADMIN_KEY" root
  merge_wallets
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
MIN_ROUND_USD=1
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
# One operations wallet for all three roles (owner decision 2026-10-27).
LAUNCHER_KEYPAIR_PATH=$KEYS/fee-claimer.json
PAYOUT_VAULT_KEYPAIR_PATH=$KEYS/fee-claimer.json
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
     platform admin      $ADMIN   (0,02 SOL sekali, untuk PlatformConfig)
     wallet operasional  $FEE   (membuat koin, mengambil fee, membeli dan mengirim saham)
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
  latest_release
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

  latest_release
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
  local rpc_host=$DOMAIN
  case $BROWSER_RPC in https://*) rpc_host=${BROWSER_RPC#https://}; rpc_host=${rpc_host%%/*} ;; esac
  install -d -m 755 /var/www/certbot
  sed -e "s/rpc\.divvy\.example/$rpc_host/g" -e "s/divvy\.example/$DOMAIN/g" "$CUR/deploy/nginx/divvy.conf" > /etc/nginx/sites-available/uspad-live.conf
  touch /etc/nginx/divvy-launches-paused
  # The preview's site is kept aside, so a rejected config puts it back instead of leaving Nginx
  # unable to start.
  local preview=/root/uspad-preview-nginx.conf
  [ -e /etc/nginx/sites-enabled/uspad.conf ] && cp -L /etc/nginx/sites-enabled/uspad.conf "$preview"
  rm -f /etc/nginx/sites-enabled/uspad.conf /etc/nginx/sites-enabled/default
  ln -sf /etc/nginx/sites-available/uspad-live.conf /etc/nginx/sites-enabled/uspad-live.conf
  if ! nginx -t > /dev/null 2>&1; then
    if nginx -t 2>&1 | grep -q "Address family not supported"; then
      sed -i '/listen \[::\]/d' /etc/nginx/sites-available/uspad-live.conf
    fi
    if ! nginx -t; then
      rm -f /etc/nginx/sites-enabled/uspad-live.conf
      [ -f "$preview" ] && cp "$preview" /etc/nginx/sites-enabled/uspad.conf
      die "konfigurasi Nginx ditolak (lihat di atas); situs lama dipasang lagi"
    fi
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
  # Inlined into the web build (NEXT_PUBLIC_*), so set before building.
  set_env $ENV_DIR/build.env NEXT_PUBLIC_SOLANA_RPC_URL "$BROWSER_RPC"
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
  restart_worker
  (cd /srv/divvy/releases && ls -1dt -- */ | tail -n +6 | while read -r d; do
    [ "$(readlink -f "$d")" = "$(readlink -f $CUR)" ] || rm -rf -- "/srv/divvy/releases/${d%/}"
  done)
  sleep 8
  status
}

# Not in the middle of a payout run (RUNBOOK "Deploy").
restart_worker() {
  local i
  for i in $(seq 1 60); do
    [ "$(REDISCLI_AUTH="$(env_get "$GEN" REDIS_PASS)" redis-cli -h 127.0.0.1 EXISTS divvy:lock:payouts)" = 0 ] && break
    [ "$i" = 1 ] && note "menunggu putaran dividen selesai..."
    sleep 5
  done
  pm2as divvy-worker restart "$ECO" --only divvy-worker --update-env > /dev/null
}

# --------------------------------------------------------------------------------------------------
# The X app comes from developer.x.com (User authentication settings: Web App, read only, callback
# https://uspad.fun/api/auth/x/callback). The secret is typed here, never pasted into a chat.
x_login() {
  [ -s $ENV_DIR/api.env ] || die "jalankan 'go-live.sh prepare' dulu"
  local id secret
  read -rp "X OAuth 2.0 Client ID: " id
  read -rsp "X OAuth 2.0 Client Secret (tidak tampil saat diketik): " secret; echo
  [ -n "$id" ] && [ -n "$secret" ] || die "Client ID dan Client Secret wajib diisi"
  sed -i -E '/^X_(CLIENT_ID|CLIENT_SECRET|REDIRECT_URI)=/d' $ENV_DIR/api.env
  printf 'X_CLIENT_ID=%s\nX_CLIENT_SECRET=%s\nX_REDIRECT_URI=https://%s/api/auth/x/callback\n' "$id" "$secret" "$DOMAIN" >> $ENV_DIR/api.env
  [ -f "$LIVE_MARK" ] || { note "disimpan; aktif setelah 'go-live.sh switch'"; return 0; }
  pm2as divvy-api reload "$ECO" --only divvy-api --update-env > /dev/null
  sleep 4
  [ "$(curl -fsS https://$DOMAIN/api/config | jq -r .flags.xOAuth)" = true ] || die "API belum melihat setelan X (cek /var/log/divvy/api/api.err.log)"
  say "Link X aktif: buka https://$DOMAIN/create dan klik 'Link your X account'"
}

# --------------------------------------------------------------------------------------------------
cp_creator() {
  load_secrets
  [ -L "$CUR" ] && [ -f "$ADMIN_KEY" ] || die "jalankan 'go-live.sh prepare' dulu"
  local fee send=()
  fee=$(pubkey $KEYS/fee-claimer.json)
  if [ "${1:-}" = "--send" ]; then
    [ "${I_HAVE_OWNER_APPROVAL:-}" = yes ] || die "--send butuh I_HAVE_OWNER_APPROVAL=yes (persetujuan owner di chat)"
    send=(--send)
  fi
  say "Creator fee pool CPMM ke wallet operasional $fee ${send[*]:-(dry run)}"
  (cd "$CUR/packages/solana" && env RPC_URL="$RPC" PLATFORM_ADMIN_KEYPAIR="$ADMIN_KEY" CP_CREATOR="$fee" I_HAVE_OWNER_APPROVAL="${I_HAVE_OWNER_APPROVAL:-}" \
    ./node_modules/.bin/tsx scripts/phase0/set-cp-creator.ts "${send[@]}" 2>&1) | sed 's/api-key=[^&" ]*/api-key=…/g'
  [ ${#send[@]} = 0 ] && return 0
  # Set on chain (the script stops this function otherwise): the worker may collect it now.
  set_env $ENV_DIR/worker.env CPMM_CREATOR_FEES true
  if [ -f "$LIVE_MARK" ]; then restart_worker; fi
  note "CPMM_CREATOR_FEES=true di worker.env"
}

# --------------------------------------------------------------------------------------------------
# The launch switch the API reads (packages/server/src/settings.ts), the same one as /admin.
launch_setting() { sudo -u postgres psql -X -d divvy -Atc "SELECT value FROM \"Setting\" WHERE key = 'launches'" 2>/dev/null; }
set_launches() { # open (true/false), reason
  local v
  v=$(jq -cn --argjson open "$1" --arg reason "${2:-}" '{launchesOpen: $open, reason: (if $reason == "" then null else $reason end)}')
  echo "INSERT INTO \"Setting\" (key, value, \"updatedAt\") VALUES ('launches', :'v'::jsonb, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, \"updatedAt\" = now();" | sudo -u postgres psql -X -q -d divvy -v ON_ERROR_STOP=1 -v v="$v"
}

open_launches() {
  load_secrets
  [ -f "$LIVE_MARK" ] || die "jalankan 'go-live.sh switch' dulu"
  [ "${I_HAVE_OWNER_APPROVAL:-}" = yes ] || die "butuh I_HAVE_OWNER_APPROVAL=yes: setiap launch dibayar wallet operasional (CLAUDE.md rule 3)"
  [ -f "$CUR/packages/solana/src/live/rawtx.ts" ] || die "kode di server masih lama: jalankan 'go-live.sh update' dulu"

  say "Cek: indexer membaca 300 transaksi LaunchLab terbaru di mainnet (termasuk versi baru)"
  (cd "$CUR/packages/solana" && RPC_URL="$RPC" timeout 900 ./node_modules/.bin/tsx scripts/phase0/decode-recent-trades.ts --limit 300 2>&1) | sed 's/api-key=[^&" ]*/api-key=…/g' > /root/uspad-trades-check.txt || true
  local res
  res=$(tail -n 1 /root/uspad-trades-check.txt)
  echo "$res" | jq -e . > /dev/null 2>&1 || { tail -n 20 /root/uspad-trades-check.txt; die "cek gagal jalan (log di atas)"; }
  note "$(echo "$res" | jq -c '{read, versions, unreadable, rpcErrors, trades, layoutErrors}')"
  [ "$(echo "$res" | jq '.unreadable + .layoutErrors')" = 0 ] || die "indexer belum bisa membaca semua transaksi. Kirim /root/uspad-trades-check.txt ke Claude; launch tetap tertutup."

  say "Wallet admin (dompet Anda sendiri, untuk launch uji coba dan halaman /admin)"
  local cur w
  cur=$(env_get $ENV_DIR/api.env ADMIN_WALLETS)
  read -rp "   Alamat wallet Phantom Anda${cur:+ [Enter = $cur]}: " w
  w=${w:-$cur}
  [[ $w =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || die "itu bukan alamat Solana"

  say "Mainnet gate nyala, launch hanya untuk admin"
  for f in $ENV_DIR/api.env $ENV_DIR/worker.env; do
    set_env "$f" ADMIN_WALLETS "$w"
    set_env "$f" DIVVY_MAINNET_ENABLED true
  done
  set_launches false "Launches open soon."
  rm -f /etc/nginx/divvy-launches-paused
  if has_systemd; then systemctl reload nginx; else nginx -s reload; fi
  pm2as divvy-api reload "$ECO" --only divvy-api --update-env > /dev/null
  restart_worker
  sleep 8
  status
  cat <<EOF

   Launch uji coba (hanya wallet $w yang bisa):
     1. Buka https://$DOMAIN/create, connect wallet itu, lalu sign in.
     2. Launch satu koin. Biayanya sekitar 0,012 SOL, dibayar wallet operasional.
     3. Setelah live, beli dan jual sedikit di halaman koin, lalu cek di Solscan.
     4. Kalau semuanya benar, buka untuk semua orang:  /root/go-live.sh launches open
EOF
}

launches() {
  case "${1:-}" in
    open) set_launches true "" ;;
    pause) set_launches false "${2:-Launches are paused for now.}" ;;
    *) die "pakai: go-live.sh launches open | pause [alasan]" ;;
  esac
  say "Setelan launch: $(launch_setting)"
}

# Creator-paid launches (owner decision 2026-10-27, apps/api/src/live/launchfee.ts): before each launch
# the creator's wallet sends LAUNCH_FEE_LAMPORTS to the operations wallet, which pays the create.
launch_fee() {
  [[ ${1:-} =~ ^[0-9]+(\.[0-9]{1,9})?$ ]] || die "pakai: go-live.sh launch-fee <SOL>, misalnya 0.02 (0 = gratis)"
  [ -f "$LIVE_MARK" ] || die "jalankan 'go-live.sh switch' dulu"
  [ -f "$CUR/apps/api/src/live/launchfee.ts" ] || die "kode di server masih lama: jalankan 'go-live.sh update' dulu"
  local int=${1%%.*} frac="" lamports wallet
  [[ $1 == *.* ]] && frac=${1#*.}
  frac=$(printf '%-9s' "$frac" | tr ' ' 0)
  lamports=$((10#$int * 1000000000 + 10#$frac))
  [ "$lamports" -le 1000000000 ] || die "lebih dari 1 SOL per launch: salah ketik? (contoh: 0.02)"
  wallet=$(pubkey $KEYS/fee-claimer.json)
  set_env $ENV_DIR/api.env LAUNCH_FEE_LAMPORTS "$lamports"
  set_env $ENV_DIR/api.env LAUNCH_FEE_WALLET "$wallet"
  pm2as divvy-api reload "$ECO" --only divvy-api --update-env > /dev/null
  sleep 3
  if [ "$lamports" -gt 0 ]; then
    [ "$lamports" -ge 15000000 ] || note "Peringatan: satu create memakan sekitar 0,012 SOL dari wallet operasional; fee ini tidak menutupnya."
    note "Biaya launch: $1 SOL per koin, dibayar wallet creator ke $wallet. Tanpa batas harian per wallet."
  else
    note "Launch gratis lagi (dibayar wallet operasional), dengan batas harian per wallet."
  fi
  note "config: $(curl -fsS https://$DOMAIN/api/config 2>/dev/null | jq -c .launchFee 2>/dev/null || echo '?')"
}

# --------------------------------------------------------------------------------------------------
# Dividends: dry-run computes every round without signing; live claims, swaps and sends (RUNBOOK
# "Switching dry-run to live").
dbq() { sudo -u postgres psql -X -d divvy "$@"; }
payouts() {
  local log=/var/log/divvy/worker/worker.out.log
  case "${1:-}" in
    check)
      say "Worker"
      grep '"msg":"worker started"' $log | tail -n 1 | jq -c '{t, mainnetEnabled, payoutsDryRun, delivery}'
      say "Putaran terakhir (setiap 10 menit)"
      grep -E '"msg":"payouts: (run|failed)"' $log | tail -n 4 | jq -c '{t, hour, dryRun, claimedLamports, rounds, error}'
      say "Vault fee platform (dry-run: klaim simulasi vs saldo asli)"
      grep '"msg":"payouts: dry-run vault claim"' $log | tail -n 3 | jq -c '{hour, indexed, vaultBalance}'
      say "Round per koin, 3 jam terakhir"
      dbq -c "SELECT to_char(r.hour, 'MM-DD HH24:MI') AS hour, c.ticker, r.\"dryRun\" AS dry, r.status, r.step,
                     round(r.\"solIn\" / 1e9, 6) AS sol_in, round(r.\"carriedOutLamports\" / 1e9, 6) AS carried_sol,
                     r.\"holdersPaid\" AS holders, left(r.error, 60) AS error
              FROM \"PayoutRound\" r JOIN \"Coin\" c ON c.id = r.\"coinId\"
              WHERE r.hour >= date_trunc('hour', now() AT TIME ZONE 'UTC') - interval '3 hours'
              ORDER BY r.hour DESC, c.ticker"
      say "Holder di snapshot terakhir (kosong = berhak dividen)"
      dbq -c "SELECT c.ticker, coalesce(h.\"excludedReason\"::text, '') AS excluded, count(*)
              FROM \"HolderBalance\" h JOIN \"Coin\" c ON c.id = h.\"coinId\"
              WHERE h.\"snapshotHour\" = (SELECT max(\"snapshotHour\") FROM \"HolderBalance\") GROUP BY 1, 2 ORDER BY 1, 2"
      ;;
    live)
      load_secrets
      [ "${I_HAVE_OWNER_APPROVAL:-}" = yes ] || die "butuh I_HAVE_OWNER_APPROVAL=yes: dividen live membelanjakan isi vault (CLAUDE.md rule 3)"
      [ "$(env_get $ENV_DIR/worker.env DIVVY_MAINNET_ENABLED)" = true ] || die "mainnet gate masih mati: jalankan 'go-live.sh open-launches' dulu"
      local m
      m=$((10#$(date -u +%M)))
      { [ "$m" -ge 20 ] && [ "$m" -le 50 ]; } || die "jalankan antara menit 20 dan 50 (sekarang menit $m), supaya tidak bertabrakan dengan putaran menit 0"
      for f in $ENV_DIR/api.env $ENV_DIR/worker.env; do set_env "$f" PAYOUTS_DRY_RUN false; done
      pm2as divvy-api reload "$ECO" --only divvy-api --update-env > /dev/null
      restart_worker
      sleep 8
      status
      note "Putaran live pertama: menit 0 berikutnya. Setelah itu: go-live.sh payouts check"
      ;;
    dry-run)
      for f in $ENV_DIR/api.env $ENV_DIR/worker.env; do set_env "$f" PAYOUTS_DRY_RUN true; done
      pm2as divvy-api reload "$ECO" --only divvy-api --update-env > /dev/null
      restart_worker
      note "Dividen kembali ke dry-run"
      ;;
    minimum)
      [[ ${2:-} =~ ^[0-9]+(\.[0-9]+)?$ ]] && awk -v v="$2" 'BEGIN { exit !(v > 0 && v <= 100) }' || die "pakai: go-live.sh payouts minimum <USD>, misalnya 1"
      for f in $ENV_DIR/api.env $ENV_DIR/worker.env; do set_env "$f" MIN_ROUND_USD "$2"; done
      pm2as divvy-api reload "$ECO" --only divvy-api --update-env > /dev/null
      restart_worker
      note "Jatah holder satu koin di bawah \$$2 per jam menunggu jam berikutnya (tidak hilang)."
      ;;
    *) die "pakai: go-live.sh payouts check | live | dry-run | minimum <USD>" ;;
  esac
}

# --------------------------------------------------------------------------------------------------
token_ca() {
  [[ ${1:-} =~ ^[1-9A-HJ-NP-Za-km-z]{32,44}$ ]] || die "pakai: go-live.sh token-ca <alamat mint uspad token>"
  [ -f "$LIVE_MARK" ] || die "jalankan 'go-live.sh switch' dulu"
  set_env $ENV_DIR/build.env NEXT_PUBLIC_TOKEN_CA "$1"
  update
  note "CA di situs: $1"
}

# --------------------------------------------------------------------------------------------------
status() {
  load_secrets
  say "Aplikasi"
  if [ -f "$LIVE_MARK" ]; then
    for u in divvy-web divvy-api divvy-worker; do pm2as "$u" jlist 2>/dev/null | jq -r '.[] | "   \(.name): \(.pm2_env.status), restarts \(.pm2_env.restart_time)"'; done
    note "health: $(curl -fsS https://$DOMAIN/api/health 2>/dev/null || echo 'tidak menjawab')"
    note "worker: $(grep '"msg":"worker started"' /var/log/divvy/worker/worker.out.log 2>/dev/null | tail -n 1 | jq -c '{cluster, mainnetEnabled, payoutsDryRun, delivery}' 2>/dev/null || echo '?')"
    note "launch: $([ -f /etc/nginx/divvy-launches-paused ] && echo "dijeda di Nginx" || echo "Nginx buka"), setelan $(launch_setting || echo '?')"
  else
    note "situs demo (belum switch)"
  fi
  if [ -L "$CUR" ] && [ -f "$ADMIN_KEY" ]; then
    say "Wallet (saldo SOL di mainnet)"
    local args=()
    args+=("platform-admin=$(pubkey "$ADMIN_KEY")")
    args+=("operasional=$(pubkey $KEYS/fee-claimer.json)")
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
  x-login) x_login ;;
  cp-creator) cp_creator "${2:-}" ;;
  open-launches) open_launches ;;
  launches) launches "${2:-}" "${3:-}" ;;
  launch-fee) launch_fee "${2:-}" ;;
  payouts) payouts "${2:-}" "${3:-}" ;;
  token-ca) token_ca "${2:-}" ;;
  status) status ;;
  *) sed -n '2,39p' "$0"; exit 1 ;;
esac
