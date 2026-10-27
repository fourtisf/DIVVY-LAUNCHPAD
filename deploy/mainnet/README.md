# uspad.fun: from the preview to mainnet

The owner decided on 2026-10-26 to go **straight to mainnet, without the devnet rehearsal**, with **push** delivery, the **CPMM creator fee to uspad** after graduation, and Next.js 15 (docs/AUDIT.md, "Open owner decisions"). This file is the order of work for this server. The commands themselves live in [`../setup-vps.md`](../setup-vps.md) (one-time setup) and [`../../docs/RUNBOOK.md`](../../docs/RUNBOOK.md) (deploys, payouts, incidents); below, only what is specific to uspad.fun.

**The short way: [`go-live.sh`](go-live.sh).** It runs phases 1 to 3 with these values, as root, and is safe to run again. The API keys go once into `/root/uspad-secrets.env` (`HELIUS_API_KEY=…`, `JUP_API_KEY=…`, chmod 600); nothing asks for them after that.

```bash
sudo -iu divvy git -C /srv/divvy/app pull && install -m 700 /srv/divvy/app/deploy/mainnet/go-live.sh /root/go-live.sh
/root/go-live.sh prepare                 # no SOL; the demo keeps running
/root/go-live.sh platform-config         # dry run; then, with the owner's OK and 0.02 SOL on the admin:
I_HAVE_OWNER_APPROVAL=yes /root/go-live.sh platform-config --send
/root/go-live.sh switch                  # demo off, live on, launches paused, payouts in dry-run
/root/go-live.sh update                  # every later deploy
/root/go-live.sh status
```

The rest of this file is what the script does and why.

**Gates.** A phase marked 💰 spends SOL: it starts only after the owner says so in chat, for that step (CLAUDE.md rule 3). Scripts that send need `--send` and `I_HAVE_OWNER_APPROVAL=yes`. Private keys are made on the server and never pasted anywhere (rule 4).

Where the server is now: Ubuntu, root login, the password-free preview (`uspad-api`, `uspad-web`) running as `divvy` from `/srv/divvy/app` on ports 4000 and 3000, Nginx with a Let's Encrypt certificate for `uspad.fun`, and the firewall on 22, 80 and 443.

## Phase 0. Read-only checks (no SOL)

Run on the server with a Helius mainnet RPC and a Jupiter API key, and send the output to Claude (it has no access to Solana RPCs):

```bash
sudo -iu divvy bash
cd /srv/divvy/app && git pull && pnpm install --frozen-lockfile && cd packages/solana
read -rsp "Helius API key: " HK; echo; export RPC_URL="https://mainnet.helius-rpc.com/?api-key=$HK"
read -rsp "Jupiter API key: " JUP_API_KEY; echo; export JUP_API_KEY
pnpm tsx scripts/phase0/read-launchlab-configs.ts > ~/cek-1-configs.txt 2>&1
pnpm tsx scripts/phase0/decode-recent-trades.ts --limit 300 > ~/cek-2-trades.txt 2>&1
pnpm tsx scripts/phase0/fetch-xstocks.ts > ~/cek-3-xstocks.txt 2>&1
pnpm tsx scripts/phase0/jupiter-quote-xstock.ts --mint Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh --lamports 1000000000 > ~/cek-4-jupiter.txt 2>&1
exit
```

Go only if: the SOL GlobalConfig's `trade_fee_rate` is 2500 (otherwise the 1% split changes), the trade decoder reports `layoutErrors: 0`, and every xStock you want routes through Jupiter. The rest of docs/MAINNET_CHECKLIST.md §3 follows the same way, with the commands listed there.

## Phase 1. Production layout on the same server (no SOL)

Follow setup-vps.md with these changes:

- **§1–§2**: done already, apart from the 2 GB swap if the plan has 4 GB of RAM or less, and `timedatectl set-timezone Etc/UTC`.
- **§3–§6**: as written. `adduser divvy` says the user exists; that's fine.
- **§7**: the domain is `uspad.fun`. The certificate exists already (`/etc/letsencrypt/live/uspad.fun/`), so skip the bootstrap site and `certbot certonly`. When you install `deploy/nginx/divvy.conf`, replace `divvy.example` with `uspad.fun` everywhere; that also sets the certificate paths. Remove the preview site (`/etc/nginx/sites-enabled/uspad.conf`) in the same reload, and run `certbot renew --dry-run` afterwards. GeoIP: DB-IP Lite needs no account.
- **§8**: the values below. Create the three hot-wallet keys with Node's crypto (first option), and a fourth, the **platform admin**, the same way but kept by root: `/root/uspad-keys/platform-admin.json` (folder 700, file 400). It signs only the PlatformConfig creation and its updates, so the worker never needs it. Back all four up encrypted, offline, with the owner.
- **§9**: the repository is public, so no deploy key: `sudo -u divvy git clone --mirror https://github.com/fourtisf/uspad.git /srv/divvy/repo.git`.
- **§10–§12**: as written, after phase 2 (the apps need `DIVVY_PLATFORM_CONFIG` to start).

| Setting | Value on uspad.fun |
|---|---|
| `WEB_ORIGIN` | `https://uspad.fun` |
| `PUBLIC_MEDIA_BASE` / `STORAGE_DIR` | `https://uspad.fun/api/media/files` / `/var/lib/divvy/media` |
| `SOLANA_CLUSTER` | `mainnet-beta` (api.env, worker.env) |
| `SOLANA_RPC_URL` | the Helius mainnet URL with its key (api.env, worker.env) |
| `NEXT_PUBLIC_SOLANA_CLUSTER` / `NEXT_PUBLIC_SOLANA_RPC_URL` | `mainnet-beta` / a **second** Helius key, restricted to `uspad.fun` in Helius' dashboard (build.env; it ends up in the browser) |
| `DIVVY_PLATFORM_CONFIG` | printed by phase 2's dry run ("PlatformConfig PDA to be created") |
| `DIVVY_MAINNET_ENABLED` | `false` until phase 4 |
| `PAYOUTS_DRY_RUN` | `true` until phase 5 |
| `PAYOUT_DELIVERY` | `push` (owner decision) |
| `MIN_HOLDER_USD` | owner decision; $10 (the default) is fine now that holders pay their own account rent |
| `DELIVERY_FEE_USD` | `0.02`: uspad's fee per send, kept from the dividend (owner decision 2026-10-27) |
| `CPMM_CREATOR_FEES` | `false` until phase 3's `set-cp-creator.ts` lands, then `true` |
| `LOCKED_LP_FEES` | `false` until phase 6 |
| `JUP_API_KEY` / `JUP_API_KEY_API` | two Jupiter keys: the worker's and the API's |
| `BLOCKED_COUNTRIES` | `US` at least (xStocks aren't offered to U.S. persons); legal review decides the rest |
| `ADMIN_WALLETS` | the owner's own wallet address |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALERT_CHAT_ID` | strongly recommended: every money alert goes there |
| `NEXT_PUBLIC_TOKEN_CA` | empty ("CA: coming soon") until the uspad token exists |

## Phase 2. 💰 The PlatformConfig

Once per admin wallet; it sets the fee split and where fees and Fee Keys go. Rent is 0.0075 SOL (944 bytes, from the SDK layout), so **0.02 SOL** to the admin covers creation, the update in phase 3 and fees.

```bash
cd /srv/divvy/current/packages/solana          # or /srv/divvy/app before phase 1 is done
export RPC_URL="https://mainnet.helius-rpc.com/?api-key=…"
FEE=$(sudo awk '/^fee-claimer /{print $2}' /etc/divvy/keys/pubkeys.txt)
sudo env RPC_URL="$RPC_URL" PLATFORM_ADMIN_KEYPAIR=/root/uspad-keys/platform-admin.json \
  FEE_WALLET="$FEE" NFT_WALLET="$FEE" NAME=uspad WEB=https://uspad.fun IMG=https://uspad.fun/brand/uspad-mark-512.png \
  pnpm tsx scripts/phase0/create-platform-config.ts                   # dry run: read the printed total (1%) and the PDA
```

- `FEE_WALLET` must be the fee claimer (every payout run checks it), and `NFT_WALLET` too, or the worker can't harvest the locked LP.
- `PLATFORM_SCALE=1000000`, `BURN_SCALE=0` by default: all graduated liquidity locked for good, as the How it works page says.
- After the owner's OK: the same command with `I_HAVE_OWNER_APPROVAL=yes` and `--send` at the end. Put the PDA in `api.env` and `worker.env` as `DIVVY_PLATFORM_CONFIG`.

## Phase 3. 💰 Creator fee to uspad, then the site goes live (launches paused)

1. In the next epoch (updates are limited per epoch), set the CPMM creator-fee beneficiary to the fee claimer. Dry run first, then with the owner's OK `I_HAVE_OWNER_APPROVAL=yes … --send`:
   ```bash
   sudo env RPC_URL="$RPC_URL" PLATFORM_ADMIN_KEYPAIR=/root/uspad-keys/platform-admin.json CP_CREATOR="$FEE" \
     pnpm tsx scripts/phase0/set-cp-creator.ts
   ```
   Then `CPMM_CREATOR_FEES=true` in worker.env.
2. Dividend stocks, from phase 0's checks and never typed by hand:
   ```bash
   cd /srv/divvy/current
   sudo -u divvy-worker env RPC_URL="$RPC_URL" JUP_API_KEY=… pnpm --filter @divvy/solana exec tsx scripts/phase0/fetch-xstocks.ts --json > /tmp/xstocks.json
   cd apps/worker && sudo -u divvy-worker node --env-file=/etc/divvy/worker.env --import tsx scripts/seed-dividend-assets.ts /tmp/xstocks.json          # dry run
   sudo -u divvy-worker node --env-file=/etc/divvy/worker.env --import tsx scripts/seed-dividend-assets.ts /tmp/xstocks.json --write
   ```
3. Stop the preview (`sudo -iu divvy pm2 delete all && sudo -iu divvy pm2 save`, and disable its `pm2-divvy` service), start the three live apps (setup-vps.md §10), install the Nginx site (§7). **Pause launches** right away (RUNBOOK "Pausing launches", admin pause) until phase 4.
4. Check: the site shows no demo banner, `/api/health` says `"mode":"live"`, the worker log says `"cluster":"mainnet-beta","mainnetEnabled":false,"payoutsDryRun":true`.

## Phase 4. 💰 Open launches

1. Fund the hot wallets (public keys in `/etc/divvy/keys/pubkeys.txt`) with small amounts the owner picks. The launcher pays each coin's rent and Jito tip and is capped per hour (`LAUNCHER_HOURLY_CAP_LAMPORTS`). The payout vault pays each new holder's token-account rent in SOL and keeps the same value from that holder's dividend in stock, so it needs SOL up front and a top-up now and then. The fee claimer pays its own transaction fees. `HOT_WALLET_MIN_SOL` sets the low-balance alert.
2. `DIVVY_MAINNET_ENABLED=true` in api.env **and** worker.env (`envcheck`), reload the API, restart the worker (RUNBOOK "Config-only changes").
3. The owner launches one coin from the site, buys and sells a little, and checks it on Solscan and Raydium. Then resume launches.

## Phase 5. 💰 Live payouts

Payouts run in dry-run from phase 3. After at least 24 hours, go through RUNBOOK "First dry-run hours: what to check", then "Switching dry-run to live" with the owner's OK (`PAYOUTS_DRY_RUN=false` in both files). That section also covers the dry-run backlog (MAINNET_CHECKLIST "First live run").

## Phase 6. 💰 After the first graduation

Every hourly run logs `payouts: locked-LP fees (simulated, nothing signed)` for each graduated coin. Compare it with the position on Raydium's site (Portfolio, the locked position of the fee claimer's wallet). If it matches, set `LOCKED_LP_FEES=true` with the owner's OK. Until then the fees wait in the lock; nothing is lost.

## Still open before real money flows

From docs/MAINNET_CHECKLIST.md: the third-party audit of the money paths (strongly recommended), the legal review of "dividends" and the terms, `MIN_HOLDER_USD` and the hourly caps, backups with a restore drill, and the Telegram alerts.
