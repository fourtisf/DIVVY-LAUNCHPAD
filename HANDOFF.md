# Divvy: build handoff

Divvy is a Solana memecoin launchpad where **every coin pays its holders a dividend in a real tokenized stock** (NVDAx, SPYx, TSLAx and others). Coins are bought and sold with SOL. A share of every trade's fee is used to buy the coin's chosen stock token, which is then split between holders every hour.

This document is the spec. The approved UI is `prototype/divvy-prototype.html`. Read both before writing code.

---

## 0. Ground rules

1. **The prototype is the visual source of truth.** Port it faithfully: layout, copy, colors, fonts, 3D coins, tilt cards, coupon "foil stub", payout meter, mobile tab bar. Do not redesign.
2. **Everything in the prototype is mock data.** Every number, coin, payout and wallet in the prototype comes from a seeded random generator. Replace all of it with real data from the API.
3. **Never invent on-chain addresses, program IDs, fee numbers or SDK method names.** Each one marked **VERIFY** below must be confirmed against the Raydium SDK v2 source/IDL, Raydium docs, or on-chain data before it is used. Write down what you confirmed and where you confirmed it in `docs/VERIFIED.md`.
4. **No mainnet spending without the owner's explicit OK.** This covers any transaction that costs real SOL beyond a few cents, creating the PlatformConfig, and funding hot wallets.
5. **Stack:**
   - Next.js 14 (App Router) for the frontend.
   - Fastify for the API.
   - Prisma with PostgreSQL for the database.
   - Redis for cache, queues and rate limits.
   - Node worker processes for the indexer and payouts.
   - Deployment on a Hostinger VPS with PM2 and Nginx.

---

## 1. What makes Divvy different

Divvy was designed after reverse-engineering uselaunch.fun, a launcher on top of StonkFun and Raydium LaunchLab. That analysis found these weaknesses, and Divvy is built to fix them:

| uselaunch.fun | Divvy |
|---|---|
| Fees are forwarded off-chain by StonkFun, and each coin's share is *estimated* from volume | Divvy owns its **LaunchLab PlatformConfig**, so fees accrue on-chain **per pool**. Each coin's fees are exact. |
| Buybacks stalled for 10+ hours unnoticed, and post-graduation buybacks were about 2–3% of the expected amount | A public **payout meter**: paid vs pending vs last payout. It turns red if a round is more than 15 minutes late. |
| 100% of fees go to buyback and burn, so the creator gets nothing | **0.15% creator share**, so creators have a reason to promote |
| Coins paired with a stock (e.g. NVDAx) required buyers to hold NVDAx | Every coin trades against **SOL**. The stock is only the dividend asset. |
| Drip buyback with tiny price impact | Holders receive a **real asset** every hour |

Kept from uselaunch:
- **Anti-vamp checks:** ticker, name, picture and X account.
- **No sniper in block 0:** the create is sent as a private Jito bundle and the mint address stays hidden until it lands.
- **Free launch with no dev buy:** the launcher wallet pays rent.

---

## 2. Pages (from the prototype)

| Route | Prototype function | What it shows |
|---|---|---|
| `/` | `renderBoard()` | Hero with the 3D coin scene, last-round glass card, next-payout ring, stats band, "Paying the most today" (top 3), all-coins grid with sort and the "Pays in" filter |
| `/coin/[ticker]` | `renderCoin()` | 3D flipping coin (front: meme image, back: dividend stock), KPIs, chart with crosshair, Payouts/Holders/Trades tabs, trade box, dividend foil card with countdown and calculator, fee split, payout meter, copy protection |
| `/create` | `renderCreate()` | 3-step form (coin, dividend stock, links), live anti-vamp checks, live preview card, launch modal with spinning 3D coin and 4 progress steps |
| `/payouts` | `renderPayouts()` | Totals, global payout meter, receipts table filterable by stock |
| `/how` | `renderHow()` | 5 steps and the fine print |

Shared UI pieces:
- Sticky header with search. The `/` key focuses the search.
- Live activity marquee.
- Mobile bottom tab bar.
- Toasts.
- Connect wallet button. It is a mock in the prototype; replace it with Solana Wallet Adapter supporting Phantom, Solflare and Backpack.

### Design tokens (copy exactly from the prototype `:root`)
- **Background and surfaces:** `--bg #0A0F0D`, `--s1 #0F1714`, `--s2 #131E1A`, `--s3 #192620`, `--s4 #20302A`
- **Brand green:** `--g #4ADE80`, `--g-hi #86EFAC`, `--g-deep #16A34A`, `--g-ink #03140A`
- **Accents:** `--teal #5EEAD4`, `--lime #D9F99D`, `--red #FF6B81`
- **Foil gradient:** `--foil` (mint, lime and teal). Used on coupon stubs, the logo, step numbers and the dividend card header.
- **Fonts:** Clash Display for display text and Satoshi for UI text, both from Fontshare. Plus Jakarta Sans is the fallback.
- **3D:** three.js r128 from a CDN in the prototype. In Next.js, use the `three` npm package or `@react-three/fiber`. Keep the same look:
  - Coin built as a LatheGeometry rim (green chrome, `metalness 1`, `roughness .2`, reeded edge bump band only on the outer edge).
  - CircleGeometry faces with canvas textures: guilloche pattern, ring text, emblem.
  - PMREM environment from a canvas "studio" equirect.
  - ACES tone mapping.
  - Satellites always `lookAt` the camera.
  - Rendering pauses when off-screen. Respect `prefers-reduced-motion`. Use a CSS fallback coin when WebGL is unavailable.
  - Dynamic-import three.js on the client only.
- **Card tilt:** pointer-driven `rotateX/rotateY` (≤ 9–11°), with `translateZ` on inner blocks only while tilting. Disabled for touch input and reduced motion.

---

## 3. Mechanics

### 3.1 Launch
1. **Sign-in.** The user connects a wallet and signs in with Sign-In-With-Solana (SIWS): the API issues a nonce and verifies the signature.
2. **Form.** The user fills in name, ticker, description, picture, dividend stock and optional links. **X account:** "one coin per X account" is only meaningful if ownership is proven. Link X with **X OAuth 2.0**; never trust a typed handle.
3. **Server-side anti-vamp checks** (§5).
4. **Build the create transaction.**
   - The server generates the **mint keypair** and never reveals the address before the transaction lands.
   - The transaction is a LaunchLab `initialize_with_token_2022` on **Divvy's PlatformConfig**:
     - Supply: 1,000,000,000.
     - Decimals: 6.
     - **No transfer-fee extension.** These are standard coins, not taxed.
     - Quote mint: SOL.
     - `migrate_type = CPMM`.
     - Zero vesting.
     - **No dev buy.**
   - **Payer/signer:** the Divvy **launcher wallet** (hot wallet) pays rent.
   - **Creator account:** the user's wallet, if LaunchLab allows a creator that is not the payer and does not sign, so creator fees accrue to the user on-chain. If the creator must sign, there are two options: (a) the user partially signs the transaction in their wallet, or (b) the launcher is the creator and Divvy forwards the creator share from its own claims. **VERIFY** which applies and pick (a) if possible.
5. **Send as a private Jito bundle** with a tip. Never send through the public RPC.
6. **Confirm and index.** On confirmation, write the coin to the database, upload metadata (Arweave or IPFS), push it to the board, and emit live events.

Use Raydium's documented curve parameters. StonkFun's on-chain launches use:
- Curve: sells 793,100,000 tokens (79.31%).
- Migration reserve: the remaining 206,900,000 seed the CPMM pool.
- Graduation target: `total_quote_fund_raising` of about 85 SOL (≈ $48k market cap in the UI copy).

**VERIFY** all three against the SDK defaults for our config. Keep the UI copy ("graduates at $48k") driven by `/api/config`, not hard-coded.

### 3.2 Fees (target split, make it configurable)
Every curve trade pays a **1% fee**. Target split:

| Destination | Share | Notes |
|---|---|---|
| Raydium protocol | 0.25% | Taken by Raydium (on StonkFun's config it comes out of the 1%) |
| Holders' dividend | 0.50% | Platform fee, then the dividend engine |
| Creator | 0.15% | On-chain creator fee if supported, otherwise forwarded |
| Divvy | 0.10% | Platform revenue |

**VERIFY** the following against the GlobalConfig/PlatformConfig structs in the SDK IDL:
- The exact fee fields (`fee_rate`, the platform share fee, the creator fee rate).
- The cap on the platform fee (docs mention `max_share_fee_rate`).
- Whether the protocol fee sits inside or on top of the platform fee.

If the exact split cannot be reached, keep the holders' share as the largest slice, update `/api/config`, and let the UI read percentages from config.

**After graduation:** the CPMM pool runs on the 0.25% tier. With post-migration fee sharing, the LP is locked and a **Fee Key NFT** goes to `platform_nft_wallet` (behaviour after the 2026-08-17 upgrade). Fees claimed from that position fund the dividend, the creator and Divvy in the same proportions. **VERIFY** the claim instruction for locked-LP fees and whether CPMM creator fees apply.

### 3.3 Dividend engine (the core feature)
Hourly job, per coin:

1. **Claim fees** for the coin's pool:
   - On the curve: claim the platform fee from the pool vault.
   - After graduation: collect fees from the locked LP / Fee Key.
2. **Book the money.** Record the SOL claimed as a `FeeClaim` and split it into holders/creator/Divvy buckets using the config ratios.
3. **Check the threshold.** If the holders' bucket is below `MIN_ROUND_USD` (default $5), **carry it forward**. This is not "late"; the meter shows "carried to next round".
4. **Buy the stock.** Swap the holders' bucket SOL into the coin's dividend asset via the **Jupiter** swap API. Use a slippage cap and stop on price-impact anomalies.
5. **Snapshot holders.** Read every token account of the mint (Helius `getTokenAccounts` or `getProgramAccounts` on Token-2022, filtered by mint).
   - **Exclude:** the curve vaults, CPMM pool vaults, the launcher wallet, Divvy wallets, and the burn/incinerator address.
   - **Eligibility:** wallets whose holding is worth ≥ $10 at the snapshot price.
6. **Calculate entitlements** pro-rata to balance. Track dust remainders and carry them forward.
7. **Deliver** (decision in §3.4).
8. **Persist and publish.** Save a `PayoutRound` plus `PayoutItem`s, each with its tx signature(s), and publish to `/payouts`.

**SLA:** each round must complete within 60 minutes of the hour, with a 15-minute grace period. Otherwise, mark it late, show it red on the coin and global meters, and alert the owner on Telegram.

### 3.4 Delivery: push vs claim (owner decision needed)
Pushing Token-2022 stock tokens to wallets that have never held them requires **creating an associated token account (ATA) for each recipient**. That rent (≈ 0.002 SOL per new ATA) can exceed the dividend on small coins.

**Recommended:** credit every hour and let holders claim any time, with automatic sending above a threshold.
- Each hourly round credits each holder's balance in a ledger. The tokens sit in the payout vault, and every credit is visible publicly.
- **Auto-send:** wallets that already have the ATA are sent their tokens automatically once the credit exceeds `AUTO_PUSH_MIN_USD`.
- **Claim:** everyone else gets a "Claim" button that builds a transaction where the holder pays their own ATA rent.
- **v2:** move to an on-chain Merkle distributor.

If the owner chooses "credit + claim", change the prototype copy from "paid every hour" to "credited every hour". This affects the hero lede, the how-it-works step 5 and the dividend card note. Do not change the copy without that decision.

### 3.5 No sniper in block 0
- Mint keypair generated server-side.
- The create goes only through a Jito block engine bundle with a tip.
- Never broadcast through public RPCs. Never expose the mint address in any API response before confirmation. The `/api/launch/:id` status shows the mint only after the "live on chain" step.
- Honest copy: block 0 is protected; block 1 onwards is open.

---

## 4. On-chain references
Confirmed by research on 2026-10-26. Re-verify before use.

| What | Address / value | Source |
|---|---|---|
| Raydium LaunchLab program | `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` | Bitquery StonkFun docs, Solscan |
| Raydium CPMM program | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | Bitquery |
| CPMM 0.25% fee config used at graduation | `CRRS5ieQmBrZjWhcj99JuGrT5tyuWDaGAXLXLFjbAtjQ` | Bitquery |
| SPYx (xStocks) mint | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | Bitquery |
| NVDAx (xStocks) mint | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | uselaunch.fun API |
| LaunchLab instructions | `initialize_with_token_2022`, `initialize_v2`, `buy_exact_in`, `sell_*`, `migrate_to_cpswap` | Bitquery and Raydium docs |
| SDK | `@raydium-io/raydium-sdk-v2`, launchpad module (IDL under `src/raydium/launchpad/`) | Raydium docs |
| Reference platform (StonkFun) configs | standard `4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7`, reward `6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt` | Bitquery |

All other dividend asset mints (TSLAx, AAPLx, QQQx, GOOGLx, AMZNx, MSTRx, COINx, HOODx, CRCLx) **must be fetched** from the official xStocks list or the Jupiter token list and stored in the `DividendAsset` table. Never type them by hand.

Divvy's own **PlatformConfig** is created once, with the owner's approval. Read Raydium's `products/launchlab/platform-config` docs first. Some GlobalConfigs set `requires_platform_auth`, which may require contacting Raydium.

---

## 5. Anti-vamp rules
The prototype implements these client-side as `foldTicker`, `foldName`, `checkTicker`, `checkName`, `checkX` and `aHash`. Port them to `packages/shared` and **enforce them on the server**. The client-side check is only for live UI feedback.

- **Ticker:**
  - Normalize: uppercase, strip non-alphanumerics, fold Cyrillic/Greek homoglyphs, fold leetspeak (`0→O 1→I 3→E 4→A 5→S 7→T 8→B $→S @→A`).
  - Must be 2–10 characters.
  - Must be unique among Divvy coins, enforced with a **unique index on `tickerNorm`**.
  - Refuse tickers on the "already trading with real volume" list, refreshed daily from DexScreener/Jupiter top tokens by volume.
- **Name:**
  - Normalize: lowercase, strip "official / real / the / og / v2 / ii", trailing digits and punctuation.
  - Refuse if the Levenshtein similarity to an existing name is ≥ 0.84.
- **Picture:**
  - Compute a perceptual hash on the server with `sharp` plus pHash/dHash.
  - Refuse if the Hamming distance to any existing coin's hash is ≤ 6.
  - Also refuse exact duplicates by SHA-256 of the file.
  - Accept png/jpg/webp/gif up to 8 MB. Re-encode on upload and strip EXIF.
- **X account:** one coin per **OAuth-verified** X user ID. Store the ID, not the handle.
- **Race safety:** run the checks and the insert inside one DB transaction, with unique constraints on `tickerNorm`, `xUserId` and `imageSha256`.
- **Error contract:** every refusal returns `{code, message, collidesWith}`. The UI shows the message verbatim.

---

## 6. API (Fastify)
All responses are JSON. Amounts are returned as strings in base units together with display values.

```
GET  /api/config                 fees split, limits, graduation target, dividend assets, flags
GET  /api/stats                  coins live, paid to holders, 24h volume, last round, next round at
GET  /api/coins?sort=trending|new|payers|graduate&pays=SYM&q=&cursor=&limit=
GET  /api/coins/:ticker          coin detail (market, progress, paid, holders, creator, links, dividend asset)
GET  /api/coins/:mint/trades?cursor=
GET  /api/coins/:mint/candles?tf=1m|5m|1h|1d&unit=mcap|price
GET  /api/coins/:mint/holders    top holders with received totals (excluded wallets flagged)
GET  /api/coins/:mint/payouts    rounds for this coin
GET  /api/coins/:mint/meter      paid24h, pending, lastPayoutAt, status ok|carried|late
GET  /api/payouts?asset=&cursor= global receipts
GET  /api/check?ticker=&name=&x= live anti-vamp result
POST /api/upload                 multipart image, returns {imageId, url, check}
GET  /api/auth/nonce?address=    SIWS nonce
POST /api/auth/verify            {address, signature, nonce} sets httpOnly session
POST /api/auth/logout
GET  /api/me                     wallet, linked X, launches today, claimable balances
GET  /api/auth/x/start  /callback   X OAuth 2.0 link
POST /api/launch                 {name,ticker,description,imageId,dividendAsset,telegram,website} returns {launchId}
GET  /api/launch/:id             {step: checking|bundling|landed|indexed, mint?, signature?, error?}
POST /api/trade/build            {mint, side, amountIn, slippageBps, wallet} returns unsigned tx (curve via SDK, graduated via Jupiter)
GET  /api/claims                 claimable dividend balances for the signed-in wallet
POST /api/claims/build           unsigned claim tx (if claim delivery is chosen)
WS   /api/live                   events: launch, trade, graduate, payout_round, meter_status
```

**Rate limits (defaults from uselaunch):**
- 3 launches per wallet per day.
- 2,000 launches per day globally.
- 120-second cooldown between launches.
- Launches can be paused globally with a reason (`/api/config.launchesOpen`).
- **Abuse guard for free launches:** require a linked X account, or a wallet with ≥ 0.05 SOL and a minimum age.

---

## 7. Data model (Prisma, starting point)
```
User          id, wallet (unique), xUserId (unique?), xHandle, createdAt
Session       id, userId, expiresAt
Coin          id, mint (unique), ticker, tickerNorm (unique), name, nameNorm, description,
              imageUrl, imageSha256 (unique), imagePhash, dividendAssetId, creatorUserId,
              poolState, cpmmPool?, status (pending|live|graduated|failed),
              createdSig, createdAt, graduatedAt?, links Json
DividendAsset id, symbol, name, mint (unique), decimals, tokenProgram, logoUrl, enabled
Launch        id, userId, coinId?, step, mintPubkey (secret until landed), bundleId, error, createdAt
Trade         sig+ix (unique), coinId, side, solAmount, tokenAmount, wallet, priceSol, slot, ts
Candle        coinId, tf, ts, o,h,l,c, volSol (unique coinId+tf+ts)
FeeClaim      id, coinId, sig, lamports, holdersLamports, creatorLamports, divvyLamports, ts
PayoutRound   id, coinId, hour (unique coinId+hour), status (ok|carried|late|failed),
              solIn, assetOut, priceUsd, swapSig, holdersPaid, startedAt, finishedAt
PayoutItem    id, roundId, wallet, amountAsset, status (credited|sent|claimed), sendSig?
HolderBalance coinId, wallet, balance, snapshotHour (for history / charts)
ReservedTicker tickerNorm (unique), source, refreshedAt
```

---

## 8. Workers
- **Indexer.** A Helius webhook or a LaserStream/Yellowstone gRPC subscription on the LaunchLab program, filtered to **our PlatformConfig**.
  - Parse buys and sells into `Trade`, maintain `Candle`, and track curve progress from pool reserves (`progress = 100 − (baseReserve − 206.9M) × 100 / 793.1M`, **VERIFY** for our curve).
  - Detect `migrate_to_cpswap`, then switch the coin to graduated and start indexing the CPMM pool.
  - Cache board data in Redis.
- **Payouts.** A cron at minute 0 of every hour that processes coins in parallel batches.
  - Make it idempotent: unique `coinId+hour`, and retry safely.
  - Ship a dry-run mode that computes everything without sending, and run it first.
- **Reserved tickers.** A daily refresh.
- **Alerts.** A Telegram bot fires on: a payout late or failed, the hot wallet balance below threshold, a Jito bundle failure rate above X%, or an indexer lag above 60 seconds.

---

## 9. Security
- **Hot wallets.** Separate keys for the launcher, the payout vault and fee claims.
  - Keep minimal balances, auto top-up only with approval, and put spend caps per hour.
  - Store keys in env/secret files readable only by the service user. Never in the repo or the database.
- **Server-side checks.** Every value the client sends (amounts, assets, tickers) is re-validated on the server.
- **Upload pipeline.** Re-encode images and limit size and type.
- **Web security.**
  - CSP allowing only the font, CDN and RPC origins in use.
  - SIWS nonces are single-use with a 5-minute TTL.
  - httpOnly, SameSite=Lax cookies.
- **Logging.** Log every signed transaction with its purpose.

---

## 10. Compliance (owner must review)
- Tokenized stocks (xStocks by Backed) are restricted for some jurisdictions, including the US. Geofence, add Terms of Service, and show the disclaimer from the prototype footer.
- Paying "dividends" in stock tokens to memecoin holders may raise securities questions in some jurisdictions. **Get legal review before mainnet marketing.**

---

## 11. Build phases and acceptance criteria

### Phase 0: verify (no UI work)
**Done when:**
- `docs/VERIFIED.md` lists, each with a source link or tx:
  - LaunchLab create params, fee fields and caps, the creator-signer rule, the platform fee claim instruction, the locked-LP fee claim, the curve and graduation numbers.
  - Jito bundle submission.
  - Jupiter swaps from SOL into xStock tokens.
- A script performs one test launch on our PlatformConfig with a tiny budget. Run it only after owner approval.

### Phase 1: scaffold and port the UI
Monorepo layout:
```
apps/web      Next.js 14
apps/api      Fastify
apps/worker   indexer + payouts + cron
packages/db   Prisma
packages/shared  types, anti-vamp fold functions, fee math
packages/solana  LaunchLab, Jito, Jupiter, Helius helpers
```
**Done when:**
- Every page renders pixel-close to the prototype on desktop at 1440px and mobile at 390px.
- The 3D scenes work and pause when off-screen.
- The pages run on a mock API that returns the same shapes as §6.

### Phase 2: launch flow live
**Done when:**
- SIWS and X OAuth work.
- Server anti-vamp works with unique constraints.
- Upload and pHash work.
- Jito-bundled create works.
- The 4-step modal is driven by `/api/launch/:id`.
- A launched coin appears on the board within 10 seconds.

### Phase 3: indexer and trading
**Done when:**
- Trades, candles, curve progress and graduation update live.
- The buy/sell box builds real transactions: SDK on the curve, Jupiter after graduation.

### Phase 4: dividend engine
**Done when:**
- Dry-run rounds match manual calculations for 3 coins over 24 hours.
- Then live rounds run with receipts, the meter and alerts.
- The delivery mode follows the owner's decision in §3.4.

### Phase 5: hardening and launch
**Done when:**
- Rate limits, monitoring, backups and the runbook (`docs/RUNBOOK.md`) are in place.
- Load test the board: 1,000 coins, 50 requests per second.
- The owner signs off.

---

## 12. Open decisions for the owner
1. Payout delivery: push, or credit + claim (recommended).
2. Final fee split, once the PlatformConfig limits are verified.
3. Whether the creator signs the create (so creator fees go to them on-chain) or Divvy forwards the creator share.
4. Domain, brand name ("Divvy" is a working name), and the X/Telegram accounts for alerts.
5. The list of dividend assets at launch. The prototype shows 11 stocks plus SOL and USDC.
6. Geofence list and Terms of Service text.

## 13. Lessons from uselaunch.fun (for context)
- A single "master wallet" creates every coin (signer `HgKfkiGW…mxVdk`) using StonkFun's PlatformConfig `6BwHH…`. Their mints carry only the metadata extensions, with no transfer fee.
- Its public API showed:
  - 643 launches in about 19 hours.
  - 44.5 SOL bought back in total.
  - $LAUNCHCAT: $1.3M of 24h volume after graduation, but only about 1.55 SOL of buybacks after graduation.
  - No buybacks at all for about 10.7 hours across every coin.
- Lesson: **fee flows must be on-chain, exact per coin, and monitored publicly.** That is Divvy's core promise; do not compromise it.
