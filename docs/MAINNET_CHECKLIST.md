# Mainnet checklist

Nothing in this file has been done yet. Divvy doesn't sign or send anything on mainnet until
`DIVVY_MAINNET_ENABLED=true`, and that switch is flipped only after every box below is ticked and the
owner has signed off at the bottom. Every step that spends SOL needs the owner's explicit approval in
chat first (CLAUDE.md rule 3).

The code enforces the gate in one place, `assertCanSend()` in `packages/solana/src/live/config.ts`,
which every signing path calls: coin creates (`apps/worker/src/launch.ts`), vault claims, swaps and
CPMM fee collection (`apps/worker/src/payouts/chain.ts`), pushes (`payouts/deliver.ts`) and claim
builds (`apps/worker/src/claims.ts`). Payouts also stay in dry-run until `PAYOUTS_DRY_RUN=false`.

## 1. Owner decisions (HANDOFF §12)

- [ ] **Delivery model**: push or credit + claim. `docs/ECONOMICS.md` recommends credit + claim (push
      loses money on most coins because of token-account rent). Set `PAYOUT_DELIVERY`; the site's
      copy switches from "paid" to "credited" by itself.
- [ ] **Fee split**: `FEE_*` must equal the PlatformConfig you create (payouts refuse to run if the
      on-chain rates differ). Default: 1% = 0.25% Raydium + 0.50% holders + 0.15% creator + 0.10% Divvy.
- [ ] **After graduation**: set `platform_cp_creator` to the fee-claimer wallet (a second
      `updatePlatformConfig` transaction) and turn on `CPMM_CREATOR_FEES`, or leave the CPMM creator
      fee with the coin's creator. Harvesting the locked-LP Fee Key is not built (its fee amount comes
      from Raydium's API and the LP-lock program is closed source; see docs/verified/launchlab.md §5b).
- [ ] **Durable storage** for token metadata (`STORAGE_DRIVER=s3` with a provider you trust; the
      metadata URI is permanent once a coin exists).
- [ ] **Dividend assets** at launch. Insert `DividendAsset` rows from `scripts/phase0/fetch-xstocks.ts`
      output, never typed by hand.
- [ ] **Thresholds**: `MIN_ROUND_USD` (spec $5; the model suggests $1 with batched swaps),
      `MIN_HOLDER_USD`, `AUTO_PUSH_MIN_USD`, `PUSH_NEW_ATA_MIN_USD`, `MAX_SWAP_IMPACT_BPS`.
- [ ] **Legal review** (HANDOFF §10): paying "dividends" in stock tokens, the geofence list
      (`BLOCKED_COUNTRIES`), and the Terms of use text (`/terms` shows a draft notice until
      `NEXT_PUBLIC_TERMS_FINAL=true`).
- [ ] **Copy the owner should look at**: the coin page says fees "sit in this coin's own on-chain
      vault" and how-it-works step 4 says "straight into this coin's own vault". On chain, platform
      fees for all coins share one vault; each coin's share is exact because it's computed from its
      own trades (docs/VERIFIED.md item 6). The prototype wording was kept (CLAUDE.md rule 8).
- [ ] Domain, brand name, and the X / Telegram accounts for alerts.

## 2. Audit

- [ ] Internal audit findings in `docs/AUDIT.md` are fixed or explicitly accepted.
- [ ] **Third-party audit** of the money paths before real funds: the dividend engine
      (`apps/worker/src/payouts/*`, `claims.ts`), the launch pipeline, the transaction builders in
      `packages/solana/src/live/*` and `apps/api/src/live/routes/trade.ts`, and key handling.
      Raydium's LaunchLab and LP-lock programs are closed source and out of scope for any audit of
      this repo.

## 3. Read-only checks with a mainnet RPC (no spend)

```bash
cd packages/solana
RPC_URL=… npx tsx scripts/phase0/read-launchlab-configs.ts     # trade_fee_rate on the SOL GlobalConfig must be 2500 for the default split
RPC_URL=… npx tsx scripts/phase0/decode-recent-trades.ts       # the indexer's decoders on real LaunchLab trades: expect layoutErrors 0
RPC_URL=… npx tsx scripts/phase0/decode-recent-trades.ts --cpmm <a graduated pool>   # CPMM SwapEvent
RPC_URL=… npx tsx scripts/phase0/fetch-xstocks.ts              # mints, decimals, extensions, paused flag
JUP_API_KEY=… npx tsx scripts/phase0/jupiter-quote-xstock.ts --mint <xStock> --lamports 1000000000   # /build routes into each xStock, price impact
npx tsx scripts/phase0/jito-bundle.ts tip-accounts
```

- [ ] `trade_fee_rate` recorded in docs/VERIFIED.md item 4.
- [ ] `decode-recent-trades.ts` shows `layoutErrors: 0` over at least 200 LaunchLab transactions, and
      the decoded fees add up (platform + creator + protocol ≈ 1% of the SOL leg for a 1% platform).
- [ ] Every dividend asset routes through Jupiter `/build` at $1–$500 with impact under
      `MAX_SWAP_IMPACT_BPS`; none has its transfer hook enabled (payouts refuse such assets).
- [ ] The CPMM config the PlatformConfig will use (index 0 `D4FP…` vs `CRRS5…`) and its rates.

## 4. Devnet rehearsal (devnet SOL only)

Devnet has no Jito block engine, no xStocks and no Jupiter routes, so this covers launches, trading,
the indexer and the dry-run accounting, not swaps.

- [ ] Create a devnet PlatformConfig (`create-platform-config.ts` on a devnet RPC), set
      `SOLANA_CLUSTER=devnet`, run `API_MODE=live` and the worker.
- [ ] Launch 3 coins from the UI; each reaches "indexed" and shows on the board within 10 seconds.
- [ ] Buy and sell from the UI; trades, candles, curve progress and fees match the explorer.
- [ ] Dry-run payouts for 24 hours; for 3 coins, the rounds match a hand calculation
      (`apps/worker/test/engine.test.ts` shows the method).
- [ ] Kill the worker mid-launch and mid-round; it recovers without double sends.

## 5. Mainnet go-live (each numbered step needs the owner's approval in chat)

1. [ ] Create the hot wallets on the server (`deploy/setup-vps.md`), record the public keys.
2. [ ] Create Divvy's PlatformConfig: `fee_rate` 6000, `creator_fee_rate` 1500, with
       `FEE_WALLET` and `NFT_WALLET` set to the fee claimer's public key (the script defaults both to
       the admin key, and payouts refuse to run unless `platform_fee_wallet` is the fee claimer):
       `FEE_WALLET=<fee claimer> NFT_WALLET=<fee claimer> I_HAVE_OWNER_APPROVAL=yes npx tsx create-platform-config.ts --send`.
3. [ ] Fund the launcher with a small balance; keep `LAUNCHER_HOURLY_CAP_LAMPORTS` low.
4. [ ] Set `DIVVY_MAINNET_ENABLED=true` with `PAYOUTS_DRY_RUN=true` and launches paused from `/admin`.
5. [ ] One test launch (`test-launch.ts --send`, Jito only). Check the pool, the metadata and that the
       indexer marks it live.
6. [ ] A small buy and sell from the UI. Check the TradeEvent decode and the fee split on chain.
7. [ ] 24 hours of dry-run payouts: compare each `VaultClaim.lamports` (simulated) with the real
       vault's growth, and `unattributedLamports` stays 0.
8. [ ] Live payouts (`PAYOUTS_DRY_RUN=false`) with the first rounds watched by hand; receipts open
       on the explorer.
9. [ ] Open launches.

## 6. Operations

- [ ] Telegram alerts arrive (low balance, late round, indexer lag, attribution gap).
- [ ] Backups run and a restore drill passed (`deploy/backup/pg-restore.md`).
- [ ] Load test of the board: 1,000 coins, 50 requests per second (HANDOFF Phase 5).
- [ ] `docs/RUNBOOK.md` read by whoever is on call.

## Sign-off

| | Name | Date |
|---|---|---|
| Owner | | |
| Third-party auditor | | |
