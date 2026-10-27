# Payout economics

What it costs to pay holders every hour, whether the payouts are worth having, and which payout design to build. Written for the owner. The numbers come from a model in `scripts/economics/` (no live data yet; see "How sure are these numbers" below). Full tables are in [`scripts/economics/results.md`](../scripts/economics/results.md).

Checked on 2026-10-26.

## Short answer

1. **Build "credit + claim", with one swap per dividend stock per hour (design d).** It costs Divvy under a cent a day for most coins (about 10 cents for a coin trading $1M a day). It breaks even at any volume that produces a payout at all.
2. **Don't push tokens to every holder (designs a and c).** Each holder who has never held that stock needs a new token account, and Divvy would pay its rent: **$0.32 at SOL $150, $0.53 at SOL $250**. On a 1,000-coin platform that rent comes to **$11,700 a day at SOL $150** (**$19,500 at $250**) against **$6,300 a day** of Divvy revenue. Push also lets people farm that rent with fresh wallets.
3. **Payouts are meaningful while a coin is on the curve and modest after graduation.** On the curve, a $100 holding earns about **$0.65 a day** on a coin trading $5k a day, and **$2.60 a day** at $20k. After graduation an actively traded coin pays about **$0.22 a day per $100** (less for quiet coins), because the fee per dollar traded falls by **65%**.
4. **Batching swaps per stock matters for operations, not money.** It halves the number of swaps (100 vs 220 an hour at 1,000 coins) and protects Divvy if Jito tips spike: **$47 vs $632 a day** at a 0.001 SOL tip. At normal tips the dollar difference is a few dollars a day.
5. Choosing credit + claim means the copy changes from "paid every hour" to "credited every hour" (HANDOFF §3.4). That's your call; nothing has been changed.

## How the money flows

Every curve trade pays 1%. Raydium takes 0.25%, the creator gets 0.15% directly, and 0.60% lands in Divvy's platform vault. Divvy splits that 0.60% into 0.50% for holders and 0.10% for itself. All coins share one vault, so Divvy can claim once an hour for everyone and still know each coin's exact share from the trade records.

After graduation the coin trades in a Raydium CPMM pool with a 0.25% fee plus a 0.05% creator fee. Divvy's locked LP position keeps 84% of the 0.25%. Half of that arrives as the memecoin and has to be sold. If Divvy is set as the pool's "creator" (`platform_cp_creator`), it also gets the 0.05%. Divvy then splits the total 50 : 15 : 10 between holders, creator and itself.

| Per $1,000 traded | On the curve | After graduation (creator fee to Divvy) | After graduation (creator fee to creator) |
|---|---:|---:|---:|
| Traders pay | $10.00 | $3.00 | $3.00 |
| Holders' share | **$5.00** | **$1.73** | **$1.40** |
| Divvy's share | **$1.00** | **$0.35** | **$0.28** |
| Creator | $1.50 | $0.52 (forwarded by Divvy) | $0.92 |

**After graduation, holders get 65% less per dollar traded** (72% less if `platform_cp_creator` is left at its default). Recommendation: set `platform_cp_creator` to a Divvy wallet and forward the creator's share.

## The four payout designs

| | How the stock is bought | How holders get it | Who pays the new token account's rent |
|---|---|---|---|
| (a) | One swap per coin per round | Sent to every eligible holder | Divvy |
| (b) | One swap per coin per round | Credited in Divvy's ledger. Holders who already have the account are sent their balance once it passes AUTO_PUSH_MIN_USD; others press "Claim" | The holder, when claiming |
| (c) | One swap per stock per hour, for all coins | Sent to every eligible holder | Divvy |
| (d) | One swap per stock per hour, for all coins | Credited, as in (b) | The holder, when claiming |

What a payout costs on-chain:

| Item | SOL $150 | SOL $250 |
|---|---:|---:|
| New stock token account (rent) | $0.32 | $0.53 |
| One transfer to an existing account | $0.0001 | $0.0001 |
| One swap (fee + Jito tip) | $0.0023 | $0.0038 |
| A holder's first claim (rent + fees, paid by the holder) | $0.32 | $0.54 |

Rent is nearly 4,000 times the cost of a transfer, so the whole choice comes down to who pays rent.

## Break-even volume per coin

Break-even means Divvy's own 0.10% (0.035% after graduation) pays all of that coin's payout costs, so holders keep their full share.

| Coin | (a) per-coin + push | (b) per-coin + credit | (c) batched + push | (d) batched + credit |
|---|---:|---:|---:|---:|
| On the curve, SOL $150 | $31.6k/day | any volume | $31.6k/day | any volume |
| On the curve, SOL $250 | $75k/day | any volume | $75k/day | any volume |
| Graduated, SOL $150 | $8.4M/day | any volume | $8.4M/day | any volume |
| Graduated, SOL $250 | over $10M/day | any volume | over $10M/day | any volume |

"Any volume" means the costs are covered from the first payout: under $0.01 a day at $1k/day, and at most 0.2% of the holders' share at every volume tested.

Push loses money on most coins. A new holder costs one rent payment, and Divvy only earns that back if the average eligible holder holds more than about **$144 on the curve or $417 after graduation** at SOL $150 ($240 and $694 at SOL $250). Typical eligible holders hold $75–$130. The curve break-even above exists only because the model caps holder turnover at twice a day.

With credit, the floor is how often a coin can pay, not cost. A round runs once the carried holders' share reaches MIN_ROUND_USD:

| MIN_ROUND_USD | Curve: at least daily from | Curve: hourly from | Graduated: at least daily from | Graduated: hourly from |
|---|---:|---:|---:|---:|
| $1 | $200/day | $4.8k/day | $580/day | $13.9k/day |
| $5 (HANDOFF default) | $1k/day | $24k/day | $2.9k/day | $69k/day |

## Design (e): push, paid by the holder (chosen 2026-10-27)

The owner's choice: stocks are still sent to every eligible holder every hour, but each send pays for itself out of the dividend, in the stock:

- a delivery fee, `DELIVERY_FEE_USD` ($0.02), kept by uspad. It also covers the network fee, which is about $0.0001 per transfer;
- on a wallet's first send of a stock, the rent of its new token account (about 0.0021 SOL, $0.32 at SOL $150). The payout vault pays the rent in SOL and keeps the same value in stock. The holder gets the rent back if they ever close the account.

A first send waits until the wallet is owed `PUSH_NEW_ATA_MIN_USD` ($5), so the rent is at most about 6% of it; later sends wait for `AUTO_PUSH_MIN_USD` ($1), so the fee is at most 2%. What uspad keeps stays in the payout vault (`PayoutTransfer."feeAmount"`); the vault's SOL needs topping up from the fee claimer as it pays rent.

Compared with (a)/(c), uspad no longer pays rent, so push doesn't lose money and rent farming only costs the farmer. Compared with (d), holders get the stock without clicking, and small holders pay a fee per send instead of a one-off claim cost.

## What a holder receives

Holders are paid pro rata among everyone holding at least $10. These are after the swap's route fee and price impact, at SOL $150. On the curve the coin is assumed half-way to graduation (about $10.6k market cap).

| Coin's 24h volume | Curve: per $100 held, per day | Curve: per hour | Graduated: per $100 held, per day | Graduated: per hour |
|---|---:|---:|---:|---:|
| $1k | $0.13 | $0.005 | $0.007 | $0.0003 |
| $5k | $0.65 | $0.03 | $0.04 | $0.002 |
| $20k | $2.59 | $0.11 | $0.14 | $0.006 |
| $50k | $6.48 | $0.27 | $0.22 | $0.009 |
| $200k | $25.90 | $1.08 | $0.22 | $0.009 |

The typical (median) eligible holder holds about $23. They get roughly a quarter of the "per $100" figure: $0.15 a day on a $5k/day curve coin, and $0.05 a day on a graduated coin. Per hour these are fractions of a cent, so the product should talk about daily totals and running balances. Curve rows above $50k/day are short-lived, because such coins graduate quickly.

Rule of thumb: on the curve, a holder earns about 0.5% × the coin's daily volume ÷ the value held by eligible holders. After graduation it is about 0.22% × daily volume ÷ market cap (about a fifth of the supply sits in the pool). When a coin trades its market cap once a day, that is about 0.2% a day, roughly 80% a year in simple terms.

**Claiming (credit model).** A first claim costs the holder $0.32–$0.54, mostly rent for their own token account. They get the rent back if they later empty and close it. A $100 holder covers that in 0.5–1.4 days on a $5k/day curve coin, 1.5–2.5 days on a busy graduated coin, and 9–25 days on a graduated coin trading $5k/day (lower figure at SOL $150, higher at $250). Later claims cost about $0.002. Suggest claiming once the balance passes about $1.

## What Divvy spends per day

Platform model: live coins with a long tail of volume (median $1.5k/day; the busiest 5% have graduated). Totals per day.

| Live coins (total volume) | Paid to holders | Divvy revenue | Divvy's costs, push (a/c) | Divvy's costs, credit (b) | Divvy's costs, credit batched (d) |
|---|---:|---:|---:|---:|---:|
| 10 ($66k/day), SOL $150 | $196 | $39 | $93 (rent $92) | $0.16 | $0.15 |
| 100 ($951k/day), SOL $150 | $2,944 | $591 | $1,124 (rent $1,115) | $1.40 | $0.85 |
| 1,000 ($10.6M/day), SOL $150 | $31,380 | $6,295 | $11,780 (rent $11,690) | $14 | $7.50 |
| 10, SOL $250 | $196 | $39 | $142 | $0.26 | $0.25 |
| 100, SOL $250 | $2,944 | $591 | $1,877 | $2.31 | $1.39 |
| 1,000, SOL $250 | $31,380 | $6,295 | $19,675 | $23 | $11 |

Infra (server, RPC, Helius) is extra, assumed at $10/day.

Workload at 1,000 coins: per-coin swaps need about 220 swaps an hour, which uses about 15 minutes of Jito's 1-request-per-second budget each hour. Batched needs about 100, which uses about 7 minutes. Push also means about 35,000 transfers an hour and 36,000 new token accounts a day. Credit means about 100 transfers an hour, plus about 1 million ledger rows a day. Store balances per wallet and totals per round rather than one row per holder per round.

## Recommended defaults

| Setting | Recommendation | Why |
|---|---|---|
| Delivery | Credit + claim, with auto-send to wallets that already have the stock's token account | No rent for Divvy, no rent farming, and claims are a natural place for the terms and geofence check that xStocks need (non-US only; see `docs/verified/jito-jupiter-xstocks.md` §3.4) |
| Swaps | One swap per dividend stock per hour, split into chunks of about $25–$50 | Fewer bundles and less exposure to tip spikes. Chunks keep price impact as low as per-coin swaps. Chunk size ≈ √(swap fee × pool depth); recompute once real quotes exist |
| MIN_ROUND_USD | **$1** with batched swaps ($5 if swaps stay per coin) | At 1,000 coins, $1 pays 280 coins every hour vs 61 at $5, for about $1.60 a day more. The swap fee is under 0.04% of a $1 round when batched |
| Min holding to be eligible | **$10** (keep) | Under credit it doesn't drive cost. If push is ever chosen, use **at least $50**, or $100 at SOL $250. That stops rent farming ($16–$27 on the curve, $53–$89 after graduation) and is the level where push breaks even |
| AUTO_PUSH_MIN_USD | **$1** | Sending costs 0.01% of $1. Lower is possible but means more tiny transfers |
| Jito tip | Read `tip_floor`; cap per swap | The minimum is 1,000 lamports; the model uses 10,000 |
| `platform_cp_creator` | A Divvy wallet | Adds the 0.05% CPMM creator fee to the pot after graduation (+24% for holders) |

## After graduation

- Holders get $1.73 per $1,000 traded instead of $5.00, a 65% drop. Divvy's share falls from $1.00 to $0.35.
- Each graduated coin needs its own fee harvest and its own memecoin sale every round. These can't be batched across coins, but each costs well under a cent.
- Selling the memecoin half of the fees means a small, steady sell pressure of about 0.1% of the coin's volume.
- Under push, graduation is where losses grow: more holders, and each one costs rent, while revenue per dollar traded falls.

## Risks the numbers don't show

- **Rent farming (push only).** A fresh wallet buys just over $10, waits for the hourly snapshot, receives a token account that Divvy paid for, then sells and closes it to collect the rent. That is profitable below $16 (curve) or $53 (graduated) at SOL $150.
- **Unclaimed balances** sit in Divvy's payout wallet. The stock's issuer can pause transfers or move tokens from any account. Keep the vault visible on the payout meter.
- **Timing.** Paying on a single snapshot at the hour invites buying just before it. Consider averaging balances across the hours a round covers.
- **Legal.** Sending tokenized stocks to anyone who holds a memecoin needs legal review (HANDOFF §10).

## How sure are these numbers

The structure is solid: fees, rent, transaction sizes and the fee split are taken from source code. The biggest unknowns are behavioural. They are how many holders a coin has, how fast they change, and real swap prices for xStocks. They move push's break-even a lot, from "any volume" to "never" in the sensitivity table, but **they never make push cheaper than credit**.

To check on-chain before relying on this (read-only scripts already exist in `packages/solana/scripts/phase0/`):

1. `trade_fee_rate` on the SOL GlobalConfig (assumed 0.25%): `read-launchlab-configs.ts`.
2. CPMM AmmConfig index 0 rates (assumed 0.25% / 12% / 4% / 0.05%) and `creator_fee_share_rate` (assumed 0): `read-launchlab-configs.ts`.
3. The xStock mints' extensions, which set the 179-byte account size: `fetch-xstocks.ts`.
4. Real SOL → xStock quotes at 0.1, 1 and 10 SOL, for route fee and depth: `jupiter-quote-xstock.ts`.
5. The live rent rate: `getMinimumBalanceForRentExemption(179)` should return 2,136,720.
6. Once coins are live, replace the holder-count, holder-spread and churn assumptions with indexer data and rerun.

## Sources and assumptions

| Input | Value used | Status | Source |
|---|---|---|---|
| Curve fees | 0.25% protocol + 0.60% platform + 0.15% creator, added together | Verified (source); 0.25% needs on-chain check | sdk `curve.ts:466-515`; `docs/verified/launchlab.md` §2c |
| Holders / Divvy split of the 0.60% | 0.50% / 0.10% | Divvy's choice | HANDOFF §3.2 |
| Curve size | 1B supply, 793.1M sold, 85 SOL raised; graduation ≈ 410.8 SOL | Verified (source) | sdk `launchpad.ts:100-111`, `constantProductCurve.ts:88-126` |
| One platform vault for all coins | One claim per hour | Verified (source) | IDL `claim_platform_fee_from_vault`; `launchlab.md` §4 |
| CPMM fee tier (index 0) | 0.25% trade; 12% protocol and 4% fund (of the fee); 0.05% creator | Docs; needs on-chain check | raydium-docs-v1@3682384 `reference/program-addresses.mdx:177-185`, `reference/fee-comparison.mdx:17,38-39,181-188` |
| LP keeps fee minus protocol and fund | 84% of 0.25% | Verified (source) | raydium-cp-swap@f4b9b26 `curve/calculator.rs:105-118`, `curve/fees.rs:30-54`, `states/pool.rs:225-246` |
| CPMM creator fee is on for graduated pools | Paid to `platform_cp_creator` | Verified (source) | cp-swap `initialize_with_permission.rs:357-372`, `states/pool.rs:343-349` |
| Raydium's cut of the creator fee | 0 by default | Docs; needs on-chain check | raydium-docs-v1 `reference/changelog/2026-09-19-cpmm-creator-fee-protocol-share.mdx:52` |
| Divvy's Fee Key owns all LP | 100% (platform scale 1e6, burn 0) | Docs | raydium-docs-v1 `reference/changelog/2026-08-17-launchlab-cpmm-only-platform-config.mdx:33-34` |
| Memecoin share of harvested fees | 50% | Derived (constant-product pools hold equal value on both sides) | `launchlab.md` §5b |
| Rent | (128 + bytes) × 6,960 lamports | Verified (source); live value on-chain | anza-xyz/solana-sdk@abe5e77 `rent/src/lib.rs:58,65,86,88-97,156-157` |
| xStock token account size | 179 bytes = 165 + 1 + ImmutableOwner (4) + TransferHookAccount (5) + PausableAccount (4) | Derived from source; the mint's extensions are docs | token-2022@3f85f9c `interface/src/state.rs:147`, `extension/mod.rs:100,128-141,314,1069,1296-1309`, `extension/account_len.rs:49-55`, `transfer_hook/mod.rs:45-48`; solana-sdk `zero-copy/src/unaligned.rs:28`; associated-token-account@8efacd6 `program/src/processor.rs:117-121`, `program/src/tools/account.rs:27,58`; xStocks case study `case-study-xstocks.mdx:165-173` |
| Rent per new xStock account | 2,136,720 lamports (0.00213672 SOL) | Derived | from the two rows above |
| Fee per signature | 5,000 lamports | Verified (source) | solana-sdk `fee-structure/src/lib.rs:125`; agave@918b264 `fee/src/lib.rs:42-55` |
| Priority fee | ceil(CU × price ÷ 1,000,000); price 50,000 µlamports/CU | Formula verified; price assumed | agave `compute-budget/src/compute_budget_limits.rs:17,61-68` |
| Transaction size limit | 1,232 bytes → 19 transfers per tx, or 9 with account creation | Verified; packing derived | solana-sdk `packet/src/lib.rs:42` |
| Jito | Tip ≥ 1,000 lamports (10,000 used); 5 txs per bundle; 1 request/s | Verified; tip level assumed | jito-docs@9b923b8 `lowlatencytxnsend.md:25,81,601,637` |
| Jupiter `/swap/v2/build` | No Jupiter fee; free key 1 request/s | Verified | jup-docs@0066fde `openapi-spec/swap/v2/swap.yaml:457`, `swap/index.mdx:217` |
| SOL → xStock route fee and depth | 0.30%; $250k depth | Assumption | Needs live quotes |
| Compute units per instruction | Transfer 6k, new account 25k, harvest 150k | Assumption | p-ATA bench: 5,494 CU for a new Token-2022 account (`pinocchio/program/benches/compute_units.md:13`) |
| Holders per coin | 100 × (market cap ÷ $10k)^0.75 | Assumption | Rough fit to pump.fun-style coins |
| Holder spread | Power law, rank^-1.2 (top 10 of 100 hold ~68%) | Assumption | |
| New holders per day | eligible × min(2, 0.5 × volume ÷ value held) | Assumption | Drives push rent |
| Holders who already have the stock's account | 10% | Assumption | |
| Post-graduation market cap | ≈ 24h volume (at least half the graduation value) | Assumption | |
| Curve scenarios | Half-way to graduation | Assumption | |
| Platform volumes | Long tail, median $1.5k/day; top 5% graduated; 11 stocks | Assumption | |
| Snapshot and infra costs | $0.0001 per 1,000-holder page; $10/day | Assumption | Pricing not verified |

## How to rerun

From the repo root (the root `node_modules/.bin` has no `tsx` or `vitest`; use the copies in `packages/shared`):

```bash
packages/shared/node_modules/.bin/tsx scripts/economics/simulate.ts     # prints tables, writes scripts/economics/results.md
packages/shared/node_modules/.bin/vitest run scripts/economics          # 18 sanity tests
```

Change any input in `DEFAULT_PARAMS` in `scripts/economics/model.ts`, for example SOL price, churn, holder spread, tips or thresholds, and rerun.
