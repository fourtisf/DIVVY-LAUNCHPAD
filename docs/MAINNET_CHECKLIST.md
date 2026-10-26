# Mainnet checklist

Nothing in this file has been done yet.

**The mainnet switch.** Divvy doesn't sign or send anything on mainnet until `DIVVY_MAINNET_ENABLED=true`. That switch stays `false` until the sign-off section at the bottom is complete, and the sign-off needs sections 1 to 4 and section 6 done first. Only then does section 5 (go-live) start.

**Spending.** Every step that spends SOL needs the owner's explicit approval in chat first (CLAUDE.md rule 3).

**The audit record.** The internal audit record is `docs/AUDIT.md`: every review finding with its status, the on-chain checks R1 to R13, and the owner decisions. This checklist points to it by ID (API-, DATA-, WEB-, MONEY-, RB-, DEP-, NEW-).

**Where the gate is enforced.** The code enforces the gate in one place: `assertCanSend()` in `packages/solana/src/live/config.ts`. Every signing path calls it:
- coin creates (`apps/worker/src/launch.ts`);
- vault claims, swaps and CPMM fee collection (`apps/worker/src/payouts/chain.ts`);
- pushes (`payouts/deliver.ts`);
- claim builds (`apps/worker/src/claims.ts`).

The worker and the live API also refuse to start if the RPC's genesis hash doesn't match `SOLANA_CLUSTER`. Payouts stay in dry-run until `PAYOUTS_DRY_RUN=false`.

## 1. Owner decisions (HANDOFF §12)

The details are in `docs/AUDIT.md`, "Open owner decisions".

- [ ] **Delivery model:** push, or credit and claim.
      - `docs/ECONOMICS.md` recommends credit and claim, because push loses money on most coins through token-account rent.
      - Set `PAYOUT_DELIVERY`. The site's copy switches from "paid" to "credited" by itself.
- [ ] **Fee split:**
      - `FEE_*` must equal the PlatformConfig you create. Payouts refuse to run if the on-chain rates differ.
      - Default: 1% = 0.25% Raydium + 0.50% holders + 0.15% creator + 0.10% Divvy.
- [ ] **After graduation:**
      - Set `platform_cp_creator` to the fee-claimer wallet (a second `updatePlatformConfig` transaction) and turn on `CPMM_CREATOR_FEES`, or leave the CPMM creator fee with the coin's creator.
      - Harvesting the locked-LP Fee Key is not built. Its fee amount comes from Raydium's API and the LP-lock program is closed source; see docs/verified/launchlab.md §5b.
- [ ] **Durable storage** for coin pictures and token metadata. The metadata URI is permanent once a coin exists.
      - With `STORAGE_DRIVER=s3`, choose a provider you trust, add the bucket's origin to the CSP `img-src` and add a CORS rule (WEB-10).
      - With local storage, use an absolute folder outside `/srv/divvy` (NEW-4) and back it up.
- [ ] **Dividend assets** at launch. Insert `DividendAsset` rows from `scripts/phase0/fetch-xstocks.ts` output, never typed by hand, and only after R4 and R5 are go.
- [ ] **Thresholds:**
      - `MIN_ROUND_USD`: the spec says $5; the economics model suggests $1 with batched swaps.
      - `MIN_HOLDER_USD`, `AUTO_PUSH_MIN_USD`, `PUSH_NEW_ATA_MIN_USD` and `MAX_SWAP_IMPACT_BPS`.
- [ ] **Hourly caps and the swap size limit**, each set on purpose and not left at its default (HANDOFF §9):
      - `SWAP_HOURLY_CAP_LAMPORTS` (default 100 SOL): what the fee claimer may swap into stocks in an hour.
      - `SWAP_BATCH_MAX_LAMPORTS` (default 20 SOL): the largest swap per stock per hour. It halves after a refusal for price impact and grows back after good swaps.
      - `PUSH_HOURLY_CAP_USD` (default $25,000): what the payout vault may send.
      - `LAUNCHER_HOURLY_CAP_LAMPORTS` (default 3 SOL): what the launcher may spend on creates and tips.
      - Over a swap or send cap, the part that fits goes out and the rest waits for the next hour, with an alert. If a stock's holders' share is regularly over its size limit, its payouts fall further behind every hour.
- [ ] **First live run: the dry-run backlog** (RB-3).
      - The first run with `PAYOUTS_DRY_RUN=false` sweeps every platform fee collected since the PlatformConfig's first trade.
      - It pays the holders' share of all of it, within the hourly swap budget, to whoever holds at each round until the backlog is used up.
      - Decide between:
        - (a) keeping the backlog small by dry-running on mainnet only with launches paused;
        - (b) paying the holders the dry-run rounds computed (not built);
        - (c) setting the backlog aside (not built).
      - The details are in `docs/AUDIT.md`, "First live run".
- [ ] **Next.js upgrade** (DEP-1). Next 14.2.35 has 25 open advisories, 3 of them critical, and gets no fixes. They are fixed in next 15.5.28 or later. The image optimizer and Server Actions are shut off in the meantime. The upgrade changes the stack CLAUDE.md pins, so it needs the owner's OK. It is recommended before mainnet.
- [ ] **Legal review** (HANDOFF §10):
      - paying "dividends" in stock tokens;
      - the geofence list (`BLOCKED_COUNTRIES`; unknown countries are refused in production);
      - the Terms of use text (`/terms` shows a draft notice until `NEXT_PUBLIC_TERMS_FINAL=true`).
- [ ] **Copy the owner should look at.** The wording below was kept from the prototype (CLAUDE.md rule 8). The exact strings are in `docs/AUDIT.md`, owner decision 9.
      - The coin page says fees "sit in this coin's own on-chain vault".
      - ~~How-it-works step 4 says "straight into this coin's own vault"~~. Rewritten on 2026-10-26 at the owner's request: the creator's share goes to their own vault, holders' and uspad's to the shared vault, attributed per coin. The page now also covers Raydium's fee, graduation, the locked LP and the fee after graduation.
      - How-it-works step 5 and the payouts page say "the vault buys" the stock.
      - Step 5 doesn't mention that a wallet must also hold at a secret mid-hour moment (MONEY-11), or that Divvy's own wallets and the burn address are left out.
      - On chain, platform fees for all coins share one vault, and each coin's share is exact because it's computed from its own trades (docs/VERIFIED.md item 6).
- [ ] Domain, brand name, and the X / Telegram accounts for alerts.

## 2. Audit

- [ ] Internal audit findings in `docs/AUDIT.md` are fixed or explicitly accepted, in particular every row marked "partly fixed" or "open".
- [ ] The GitHub Actions in `.github/workflows/ci.yml` are pinned to full commit SHAs (WEB-12).
- [ ] **Third-party audit** of the money paths before real funds. Scope:
      - `packages/solana/src/live/*`: the transaction builders, the event decoders and the mainnet gate.
      - `apps/worker`: the launch pipeline (`launch.ts`), the dividend engine (`payouts/*`) and claims (`claims.ts`). Also recommended: `indexer.ts`, whose output decides each coin's share.
      - `apps/api`: the create, trade and claims routes (`apps/api/src/live/routes/create.ts`, `trade.ts`).
      - `apps/web`: the transaction check (`apps/web/src/lib/txcheck.ts`).
      - Key handling.
      - Raydium's LaunchLab and LP-lock programs are closed source and out of scope for any audit of this repo.

## 3. Read-only checks with a mainnet RPC (no spend)

Each check below is described in `docs/AUDIT.md`, "Needs on-chain verification": what to check, the script, and what counts as go or no-go. Record each result, with its source, in `docs/VERIFIED.md`.

```bash
cd packages/solana
RPC_URL=… npx tsx scripts/phase0/read-launchlab-configs.ts     # trade_fee_rate on the SOL GlobalConfig must be 2500 for the default split
RPC_URL=… npx tsx scripts/phase0/read-launchlab-configs.ts --pool-of <a busy PlatformConfig>   # R2: platformFeeCounter and the platform vault, run twice
RPC_URL=… npx tsx scripts/phase0/decode-recent-trades.ts --limit 300   # R1: the indexer's decoders on real LaunchLab trades
RPC_URL=… npx tsx scripts/phase0/decode-recent-trades.ts --address <a PlatformConfig> --limit 1000   # R1, R7, R9
RPC_URL=… npx tsx scripts/phase0/decode-recent-trades.ts --cpmm <a graduated pool>   # R10: CPMM SwapEvent
RPC_URL=… npx tsx scripts/phase0/fetch-xstocks.ts              # mints, decimals, extensions, paused flag (R4, R5)
JUP_API_KEY=… npx tsx scripts/phase0/jupiter-quote-xstock.ts --mint <xStock> --lamports 1000000000   # /build routes into each xStock, price impact (R4)
JUP_API_KEY=… RPC_URL=… npx tsx scripts/phase0/jupiter-quote-xstock.ts --mint <xStock> --lamports <hourly batch> --build --taker <fee claimer> --simulate   # R6
npx tsx scripts/phase0/jito-bundle.ts tip-accounts
```

- [ ] `trade_fee_rate` recorded in docs/VERIFIED.md item 4.
- [ ] Every dividend asset routes through Jupiter `/build` at $1 to $500 with impact under `MAX_SWAP_IMPACT_BPS`. None has its transfer hook enabled (payouts refuse such assets).
- [ ] The CPMM config the PlatformConfig will use (index 0 `D4FP…` or `CRRS5…`) and its rates.
- [ ] **R1** TradeEvent layout:
      - `layoutErrors: 0` over at least 200 LaunchLab transactions.
      - Each decoded fee field matches its own rate. Platform + creator + protocol ≈ 1% of the SOL leg for a 1% platform.
- [ ] **R2** `PoolState.platform_fee` no longer grows on new trades, while the platform fee vault does.
- [ ] **R3** A LaunchLab curve vault's token-account owner equals the authority PDA that `poolAddresses().auth` returns.
- [ ] **R4** For each xStock, (Jupiter raw `outAmount` / 10^decimals) × Price API `usdPrice` matches the SOL in. If it is off by the Scaled UI multiplier, the prices must be converted first.
- [ ] **R5** No xStock mint has DefaultAccountState `frozen`.
- [ ] **R6** Simulated compute units stay under about 80% of each limit:
      - swap 600,000;
      - create 400,000 (from the `test-launch.ts` dry run);
      - claim 100,000;
      - push 120,000 per transfer.

      For claims and pushes, simulate a `transferChecked` plus an account create of each xStock from an existing holder's account.
- [ ] **R7** On a busy platform, the platform vault's growth between two reads equals the sum of the decoded platform fees to the lamport. Note the smallest trade seen.
- [ ] **R8** A simulated call to LaunchLab's event instruction without the event-authority signature fails.
- [ ] **R9** On a platform with graduated coins:
      - the migration appears in that PlatformConfig's stream;
      - the pool is account 4 of `initialize_with_permission`;
      - the CPMM pool's creator follows the rule in `checkMigrations`.
- [ ] **R10** CPMM `SwapEvent` decodes cleanly, and `out` matches the output vault's balance change.
- [ ] **R11** On the production RPC:
      - (a) `getSignaturesForAddress` returns a slot's transactions in block order;
      - (b) `until` with a missing signature doesn't return the full history;
      - (c) `getSignatureStatuses` with `searchTransactionHistory` finds 1-day-old and 30-day-old signatures as `finalized`.

      If (c) fails, attribution would delete real trades.
- [ ] **R12** Jito "Landed" commitment and whether "Invalid" is ever transient. The swap's tip account is a static key, not loaded through a lookup table.
- [ ] **R13** `getGenesisHash` on the mainnet and devnet RPCs equals `GENESIS_HASH` in `packages/solana/src/live/config.ts`, and both are logged in docs/VERIFIED.md.

## 4. Devnet rehearsal (devnet SOL only)

Devnet has no Jito block engine, no xStocks and no Jupiter routes. The rehearsal covers launches, curve trading, the indexer and the dry-run accounting, but not swaps or graduated-coin trades.

- [ ] Create a devnet PlatformConfig (`create-platform-config.ts` on a devnet RPC), set `SOLANA_CLUSTER=devnet`, and run `API_MODE=live` and the worker.
- [ ] Launch 3 coins from the UI. Each reaches "indexed" and shows on the board within 10 seconds.
- [ ] Buy and sell from the UI. Trades, candles, curve progress and fees match the explorer.
- [ ] Dry-run payouts for 24 hours:
      - for 3 coins, the rounds match a hand calculation (`apps/worker/test/engine.test.ts` shows the method);
      - each coin's largest `HolderBalance` row is excluded as `curve` (R3).
- [ ] Kill the worker mid-launch and mid-round. It recovers without double sends.
- [ ] Connect Phantom or Solflare from Chrome on Android (Mobile Wallet Adapter), behind the production Nginx config and CSP (WEB-7).

## 5. Mainnet go-live

This section starts only after the sign-off at the bottom is complete. Until then `DIVVY_MAINNET_ENABLED` stays `false`. Each numbered step needs the owner's approval in chat.

**Before step 1 (no spend), the server matches the split layout** (WEB-1; `deploy/ecosystem.config.cjs`, `deploy/setup-vps.md`):

- [ ] **Separate users.**
      - `divvy-web`, `divvy-api` and `divvy-worker` each run their own PM2 daemon with `--only` their own app.
      - `divvy` owns the releases and builds, and runs nothing.
      - `divvy-backup` runs the nightly dump.
- [ ] **Separate env files**, laid out as in `deploy/setup-vps.md` §8. No shared `divvy.env` is left. Each file is `chmod 600` and owned by the user that reads it:

      | File | Owner | What it holds |
      |---|---|---|
      | `/etc/divvy/web.env` | `divvy-web` | Only `WEB_ORIGIN` and `API_INTERNAL_URL`. |
      | `/etc/divvy/api.env` | `divvy-api` | Its own `JUP_API_KEY_API` (API-10) and no key paths. |
      | `/etc/divvy/worker.env` | `divvy-worker` | The only file that names keypair files. |
      | `/etc/divvy/build.env` | `divvy` | Only the public `NEXT_PUBLIC_*` values, which are built into the bundle. |
      | `/etc/divvy/backup.env` | `divvy-backup` | The backup settings. |
- [ ] **The keys are unreadable to every other user.** As `divvy-api`, `divvy-web`, `divvy` and `divvy-backup`, reading anything in `/etc/divvy/keys` fails.
- [ ] **Media storage.** `STORAGE_DIR` is `/var/lib/divvy/media` (outside the release; the apps refuse anything inside it, NEW-4), or S3 is set up as decided in section 1.
- [ ] **Browser RPC.** `NEXT_PUBLIC_SOLANA_RPC_URL` is set in `build.env` before the build (WEB-9), and its origin is in the CSP `connect-src`.
- [ ] **Dependencies.** Re-run `pnpm audit --prod`. Review anything not already covered by DEP-1 to DEP-5 and record it in `docs/AUDIT.md`.

Steps:

1. [ ] Create the hot wallets on the server and record the public keys.
       - The keys go in `/etc/divvy/keys`: the directory is `chmod 700` and each file `chmod 400`, all owned by `divvy-worker`.
       - Generate them with `solana-keygen` or Node's built-in `crypto`, never with packages from the release (WEB-1).
2. [ ] Create Divvy's PlatformConfig: `fee_rate` 6000, `creator_fee_rate` 1500, with `FEE_WALLET` and `NFT_WALLET` set to the fee claimer's public key.
       - The script defaults both to the admin key, and payouts refuse to run unless `platform_fee_wallet` is the fee claimer.
       - Command: `FEE_WALLET=<fee claimer> NFT_WALLET=<fee claimer> I_HAVE_OWNER_APPROVAL=yes npx tsx create-platform-config.ts --send`.
3. [ ] Fund the launcher with a small balance and keep `LAUNCHER_HOURLY_CAP_LAMPORTS` low. Set `SWAP_HOURLY_CAP_LAMPORTS`, `SWAP_BATCH_MAX_LAMPORTS` and `PUSH_HOURLY_CAP_USD` in `worker.env` to the values chosen in section 1.
4. [ ] Set `DIVVY_MAINNET_ENABLED=true`, with `PAYOUTS_DRY_RUN=true` and launches paused from `/admin`.
5. [ ] One test launch (`test-launch.ts --send`, Jito only). Check the pool, the metadata, and that the indexer marks it live.
6. [ ] A small buy and sell from the UI.
       - Check the TradeEvent decode and the fee split on chain.
       - R1 and R7 on Divvy's own PlatformConfig: the decoded platform fees equal the platform vault's growth to the lamport.
7. [ ] 24 hours of dry-run payouts. Compare the dry-run claims with the real vault (RB-4, R2):
       - each `VaultClaim.lamports` (simulated) against the real vault's growth (`vaultBalance` in the worker log);
       - `vaultBalance` grows while fees are indexed;
       - `unattributedLamports` stays 0.
8. [ ] Live payouts (`PAYOUTS_DRY_RUN=false`), with the first rounds watched by hand.
       - The backlog decision from section 1 is applied.
       - The backlog drains within the swap budget at the expected rate (NEW-2). Watch the swap-budget alerts and the per-stock size limit.
       - Receipts open on the explorer.
9. [ ] Open launches.

## 6. Operations

- [ ] Telegram alerts arrive (low balance, late round, indexer lag, attribution gap, empty fee vault).
- [ ] Backups run and a restore drill passed (`deploy/backup/pg-restore.md`).
- [ ] Load test of the board: 1,000 coins, 50 requests per second (HANDOFF Phase 5).
- [ ] `docs/RUNBOOK.md` read by whoever is on call.

## Sign-off

Signing means:
- sections 1 to 4 and section 6 are complete;
- every R check in section 3 is go;
- the third-party audit has no open finding on the money paths.

`DIVVY_MAINNET_ENABLED` stays `false` until both lines below are signed. Section 5 runs after that, one approved step at a time.

| | Name | Date |
|---|---|---|
| Owner | | |
| Third-party auditor | | |
