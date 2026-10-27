# Internal audit record

Date: 2026-10-26.

This file records five internal reviews of the Divvy monorepo, all written on 2026-10-26 by AI review agents:

- an API security review of `apps/api` and `packages/server`;
- an indexer and data review covering the indexer, stats, launch state and the API's read paths;
- a web and deploy review of `apps/web`, `deploy/` and CI;
- an on-chain money-path review of the launch pipeline, the dividend engine, swaps, delivery and claims;
- notes from the agent that rewrote `docs/RUNBOOK.md`.

It also records a `pnpm audit --prod` run and the issues found while re-checking and fixing.

**This is not a third-party audit.** A third-party audit of the money paths is still required before mainnet. Its scope and the sign-off are in `docs/MAINNET_CHECKLIST.md`.

The reviews read an older state of the code. Each finding was re-checked against the code at commit `68409dc`, which includes the fixes from commits `8db9efb`, `fe9d234` and `68409dc`. Deploy docs were checked as they are in the working tree. This file cites functions and files rather than the reviews' line numbers. A test is named only where its body was read and it exercises the fix.

This environment has no mainnet RPC. Anything that depends on the deployed programs or on live data is listed under "Needs on-chain verification" (R1 to R13), together with the read-only check that settles it.

**Statuses:**
- **fixed:** the code now handles it.
- **partly fixed:** some of it is handled; the row says what's left.
- **accepted risk:** the code or docs chose to live with it, for the reason given.
- **needs on-chain verification:** see R1 to R13.
- **open:** not fixed.

## Summary

| Area | Fixed | Partly fixed | Accepted risk | Needs on-chain verification | Open | Total |
|---|---|---|---|---|---|---|
| API security (API) | 10 | 0 | 0 | 0 | 0 | 10 |
| Indexer and data (DATA) | 14 | 4 | 0 | 8 | 0 | 26 |
| Web and deploy (WEB) | 9 | 2 | 2 | 0 | 0 | 13 |
| On-chain money paths (MONEY) | 18 | 2 | 0 | 7 | 0 | 27 |
| Runbook agent notes (RB) | 11 | 0 | 1 | 0 | 3 | 15 |
| Dependencies (DEP) | 0 | 1 | 4 | 0 | 0 | 5 |
| Found while re-checking and fixing (NEW) | 5 | 0 | 0 | 0 | 0 | 5 |
| **Total** | **67** | **9** | **7** | **15** | **3** | **101** |

The 15 "needs on-chain verification" rows overlap. They reduce to R1 to R13 below; R11 and R13 also cover points raised while re-checking. WEB-14 (dependencies) is counted under DEP.

What matters most for mainnet now:
- **RB-3:** the first live run pays out the whole dry-run backlog. This is an owner decision.
- **R2 and R11:** these can stop payouts or lose trades.
- **DEP-1:** the Next.js upgrade (owner decision).
- **The 11 partly fixed rows.**

## API security (`apps/api`, `packages/server`)

| ID | Severity | Finding | Status | Where and how |
|---|---|---|---|---|
| API-1 | High | Ticker symbols were dropped after the check, so `BONK!` was checked as BONKI but minted as BONK. | fixed | `checkTicker` (`packages/shared/src/antivamp.ts`) refuses any symbol before folding (`TICKER_CHARS`). Tests: `packages/shared/test/antivamp.test.ts` "refuses symbols instead of dropping them"; `apps/api/test/live.test.ts` (`MOONPIG!` gets `TICKER_CHARS`). |
| API-2 | High | An oversized SIWS signature froze the API, because base58 decoding is quadratic. | fixed | `VerifyRequestSchema` (`packages/shared/src/api.ts`) bounds the address, signature and nonce by regex before anything is decoded. `/api/auth/nonce` checks the address format and that it is 32 bytes (`apps/api/src/live/routes/auth.ts`). Test: `apps/api/test/contract.test.ts` "refuses oversized sign-in fields before decoding them". |
| API-3 | Medium | `/api/live` buffered client frames of up to 100 MiB. | fixed | `apps/api/src/app.ts` registers the WebSocket plugin with `maxPayload: 1024`. `live/routes/live.ts` closes the socket on any client message and drops clients with more than 1 MiB buffered. No test. |
| API-4 | Medium | Launch limits could be raced, and there was no wallet-age check, so the launcher wallet could be drained. | fixed | In `live/routes/create.ts`, a per-wallet Redis `NX` lock comes first. The daily counts are then re-read inside a transaction that holds `pg_advisory_xact_lock`. `fundedAndAged` requires 0.05 SOL and a first transaction at least `LAUNCH_MIN_WALLET_AGE_DAYS` (default 3) old. Test: `live.test.ts` (a new wallet gets `NEEDS_X_OR_SOL`; a second launch gets 429). The concurrent path has no test. Aged, funded wallets can still launch, and `LAUNCHER_HOURLY_CAP_LAMPORTS` bounds what they cost. See NEW-3. |
| API-5 | Medium | A transparent picture hashed as white but showed a copied logo on dark backgrounds. | fixed | `apps/api/src/media.ts` flattens onto `#0A0F0D` before hashing and before storing, so the served picture is the one that was checked. No test. |
| API-6 | Low | The upload type was taken from the client's header. | fixed | `processImage` (`media.ts`) reads the decoded format and accepts only png, jpeg, webp and gif. The contract test "refuses files that aren't images" covers a wrong declared type, not the decoded check. |
| API-7 | Low | The name and picture similarity checks weren't race-safe. | fixed | They run again inside the advisory-locked launch transaction, with the pHash cache cleared (`create.ts`). No test. |
| API-8 | Low | The geofence let unknown countries through. | fixed | `isBlockedCountry` (`apps/api/src/live/viewer.ts`) refuses a missing country in production and always refuses `XX` and `T1`. The launch and claim routes use it. `live.test.ts` covers a listed country (US gets 451), not the unknown case. |
| API-9 | Low | Internal error text reached clients. | fixed | `app.ts` has a global `setErrorHandler`. Every query uses `safeParse`, `amountIn` is capped at u64, wallets go through `publicKeyOrNull`, and cursors are validated (`live/routes/public.ts`, `trade.ts`). Test: `contract.test.ts` "answers bad queries with the error contract, never internal error text" (mock mode). |
| API-10 | Low | `/api/trade/build` spent RPC calls and the worker's Jupiter quota on every unauthenticated call. | fixed | The blockhash is shared for 2 s (`live/deps.ts`) and the pool account is cached for 1 s (`trade.ts`). The API uses `JUP_API_KEY_API` when it is set. It falls back to the worker's key, so `JUP_API_KEY_API` must be set in `api.env` (checklist). Builds still need no session. |

## Indexer and data

| ID | Severity | Finding | Status | Where and how |
|---|---|---|---|---|
| DATA-1 | Critical | A trade whose 1-lamport fee was over 10% of it failed the sanity check and halted fee attribution for every coin. | fixed | `decodeTradeEvent` (`packages/solana/src/live/launchlab.ts`) applies the ratio check only from 1,000 lamports. `parseLaunchLabTransaction` decodes only events of Divvy pools. Tests in `packages/solana/test/live.test.ts`: "TradeEvent sanity on tiny trades (audit)", and "parseLaunchLabTransaction", where another platform's malformed event isn't decoded. |
| DATA-2 | High | Fees from trades in the vault claim's own slot were lost or given to the wrong coin. | fixed | Each claim is placed in the trade stream: the indexer sets `VaultClaim.toTradeId` when it reaches the claim transaction (`Indexer.markClaim`, `apps/worker/src/indexer.ts`). `attributeVaultClaim` (`payouts/engine.ts`) then uses trade-id ranges. If the claim isn't seen in the stream, it is placed by slot and a warning alert is sent. Test: `apps/worker/test/engine.test.ts` "a trade later in the claim's own slot belongs to the next claim". Depends on R11(a). |
| DATA-3 | High | An hour whose attribution never finished was orphaned, and the next claim overlapped it. | fixed | `attributePending` attributes older claims oldest-first before a new claim is made. `stepClaim` refuses to continue while the previous claim isn't placed, and chains `fromTradeId` from the latest claim of any state. Test: `engine.test.ts` "a claim the indexer hadn't reached is attributed before the next claim is made". |
| DATA-4 | High | A create that landed after its launch was marked failed became an orphan coin. | fixed | `processLaunch` leaves an unconfirmed launch at `bundling`. `reconcileLaunches` fails it only 150 blocks after `lastValidBlockHeight`. `failLaunch` is a conditional update and keeps the mint and pool. The indexer alerts when a failed launch lands (`apps/worker/src/launch.ts`, `indexer.ts`). Test: `apps/worker/test/pipeline.test.ts` "a bundle that hasn't landed leaves the launch to the reconciler". A coin that lands after being marked failed only raises an alert and needs a manual decision. |
| DATA-5 | High | The migration fallback accepted any account at the CPMM PDA. | fixed | `checkMigrations` decodes the pool and requires: creator fee on, the platform's cp config, the coin and SOL mints, and the expected pool creator. A migration read from a transaction corrects a PDA-derived pool. Graduation is a conditional update (`indexer.ts`). No test. The expected pool creator is an on-chain fact (R9). |
| DATA-6 | Medium-high | A LaunchLab trade with no TradeEvent was skipped silently. | fixed | `parseLaunchLabTransaction` counts trade instructions (outer and inner) against TradeEvents and raises `EventLayoutError` on a mismatch. Test: `packages/solana/test/live.test.ts` (a trade instruction without an event throws). |
| DATA-7 | Medium | The indexer-lag alert couldn't fire on a busy platform, and a stall on a missing transaction was silent. | partly fixed | `statusJob` (`apps/worker/src/ops.ts`) measures lag from the oldest unprocessed signature. `Indexer.follow` alerts after 15 empty fetches of one signature. Left: CPMM cursors aren't monitored. They feed volume and candles only, not money. |
| DATA-8 | Medium | Everything ran at "confirmed" with no rollback handling. | partly fixed | Attribution counts only finalized trades, and deletes trades whose transaction is missing or failed with a critical alert (`attributeVaultClaim`). Left: the indexer cursor still follows "confirmed", and nothing handles a cursor signature that disappears. How `until` behaves then depends on the RPC (R11). |
| DATA-9 | Medium | The trade insert and the candle upserts weren't atomic. | fixed | `saveTrade` writes the trade, its four candles and `lastTradeAt` in one transaction (`indexer.ts`). `pipeline.test.ts` "indexer: a create event lands the coin; trades are stored once with candles" covers a replay, not a crash part-way through the write. |
| DATA-10 | Medium | CPMM "Log truncated" lines were ignored. | fixed | `logsTruncated` (`packages/solana/src/live/cpmm.ts`) triggers a warning alert in `onCpmmTx`. The dropped swap is still missing from volume and candles. Fee attribution doesn't use these swaps. |
| DATA-11 | Medium | `/api/payouts` pagination skipped rows within an hour. | fixed | The cursor is `<hour>\|<round id>` with a fixed `(hour, id)` sort (`apps/api/src/live/routes/public.ts`). No live-mode test. |
| DATA-12 | Medium | The meter showed "late" for idle coins, and for every coin in dry-run. | fixed | The meter uses the worker's definition (hour + 60 min + grace) and only rounds that exist (`/api/coins/:mint/meter` in `public.ts`). |
| DATA-13 | Low-medium | The "pending" amount was wrong around claims. | fixed | `pendingHoldersLamports` (`apps/api/src/live/data.ts`) counts from the latest attributed claim's `toTradeId`, so fees that were claimed but not yet attributed are included. In dry-run it shows every fee since launch, which is what the vault really holds (see RB-3). |
| DATA-14 | Low | Landing wasn't idempotent, Jito "Landed" was trusted, and `createSignature` was wrong past 1,000 signatures. | fixed | `markLanded` is a conditional transaction. A Jito "Landed" also needs a confirmed signature status. `createSignature` pages back up to 50 pages (`launch.ts`). |
| DATA-15 | Low | The wrong wallet was recorded for some trades. | partly fixed | Curve trades: the trader resets after each TradeEvent (`parseLaunchLabTransaction`). Left: CPMM trades still record the fee payer (`onCpmmTx`). This is display only. |
| DATA-16 | Low | Public totals left out delivered "late" rounds. | fixed | `PAID` in `public.ts` counts both `ok` and `late` rounds. |
| DATA-17 | Low | Indexes were missing and the per-minute stats queries were heavy. | partly fixed | Migration `20261026170000_audit_fixes` adds the `Trade(coinId, id)` index, and `lastTradeAt` is kept when a trade is inserted. Left: `refreshMarketStats` (`apps/worker/src/stats.ts`) still runs the "first trade ever" `DISTINCT ON` over every coin's trades each minute. |
| DATA-18 | Low | The indexer loop held one halt name, and one pool's RPC error starved the others. | fixed | `halted` is a set, and each follow runs inside `safely()` (`indexer.ts`). |
| DATA-V1 | Not given | Fee rounding and the minimum trade size. | needs on-chain verification | R7 |
| DATA-V2 | Not given | Whether events can be spoofed through the event CPI. | needs on-chain verification | R8 |
| DATA-V3 | Not given | The TradeEvent layout after the August and September 2026 upgrades. | needs on-chain verification | R1 |
| DATA-V4 | Not given | The migration transaction and the CPMM pool address. | needs on-chain verification | R9 |
| DATA-V5 | Not given | The deployed CPMM `SwapEvent`. | needs on-chain verification | R10 |
| DATA-V6 | Not given | Helius signature order within a slot, and how `until` behaves. | needs on-chain verification | R11 |
| DATA-V7 | Not given | The commitment behind Jito's "Landed", and whether "Invalid" can be transient. | needs on-chain verification | R12 |
| DATA-V8 | Not given | Whether `PoolState.platform_fee` still accrues per pool. | needs on-chain verification | R2 |

## Web and deploy (`apps/web`, `deploy/`, CI)

| ID | Severity | Finding | Status | Where and how |
|---|---|---|---|---|
| WEB-1 | High | The web app, API and worker ran as one OS user, so a web or API compromise could read the hot-wallet keys. | fixed | `deploy/ecosystem.config.cjs` runs each app as its own user (`divvy-web`, `divvy-api`, `divvy-worker`) with its own env file (`/etc/divvy/web.env`, `api.env`, `worker.env`). `.env.example` says which settings go in which file. `deploy/setup-vps.md` (updated alongside this record, not yet committed) does the rest:<br>• `divvy` only builds, reading the public `NEXT_PUBLIC_*` values from `/etc/divvy/build.env`;<br>• a separate `divvy-backup` user reads `/etc/divvy/backup.env`;<br>• the keys live in `/etc/divvy/keys`, readable by `divvy-worker` only;<br>• the keys are generated with Node's built-in crypto or `solana-keygen`, never the release's packages;<br>• it explains how to move an existing single-user server.<br>The fix only counts once the server is built this way. This is a go-live check in the checklist, and the apps won't start on the old layout. |
| WEB-2 | High | All server-side API calls shared one rate-limit bucket, so one visitor could take the site down. | fixed | `apps/web/src/lib/server-api.ts` forwards the visitor's IP (from Nginx's `X-Real-IP`) and country, and shares `/api/config` and `/api/stats` between renders for 5 s. Nginx limits pages with the `divvy_web` zone. No test. |
| WEB-3 | Medium | The browser signed whatever the API built, and showed a local estimate instead of the quote. | partly fixed | `checkTransaction` (`apps/web/src/lib/txcheck.ts`) does five checks:<br>• the wallet must be a signer and, except for claims, the fee payer;<br>• only the expected programs may run;<br>• SOL and token moves to other people's accounts are refused;<br>• token accounts created for other owners are refused;<br>• a trade must include the coin's mint.<br>`TradeBox.tsx` also checks the server's `minOut` against the chosen slippage and asks before a quote far below the estimate. Left:<br>• LaunchLab buy/sell arguments aren't decoded from the instruction;<br>• Jupiter route instructions are accepted whole;<br>• the box still shows the local estimate before the quote.<br>Test: `apps/web/src/lib/txcheck.test.ts` (see NEW-1). |
| WEB-4 | Medium | Sign-in used raw `signMessage`, so the wallet never checked the domain. | accepted risk | `apps/web/src/lib/session.tsx` uses the wallet's `signIn` when it has one. The API requires the signed bytes to equal the issued message (`signedMessageMatches`, `apps/api/src/routes/auth.ts`). The fallback checks that the message names this host and wallet. Test: `contract.test.ts` "accepts a wallet signIn only when the signed bytes are the issued message". Admin powers now end 12 hours after sign-in (`ADMIN_SESSION_MS`, `apps/api/src/live/viewer.ts`); test: `live.test.ts` "signs in with a DB-backed session and flags admins". Accepted: the API still accepts plain `signMessage` signatures, because wallets without `signIn` need them, so a phishing page can still collect one for a non-admin session. |
| WEB-5 | Medium | `/API/...` spellings reached the API through the Next rewrite, skipping Nginx's API rules (including the launch pause). | fixed | `experimental.caseSensitiveRoutes` is set in `apps/web/next.config.mjs`. Nginx answers any other `/api` spelling with 404, and `/api/` is a `^~` prefix (`deploy/nginx/divvy.conf`). |
| WEB-6 | Medium | The local storage defaults would break on-chain metadata URIs. | fixed | `assertProductionStorage` (`packages/server/src/storage.ts`) runs in both the API and the worker through `loadStorage`. In production it refuses a relative `STORAGE_DIR`, one inside the app folder, and a `PUBLIC_MEDIA_BASE` that isn't public https. Test: `packages/server/test/storage.test.ts` "production storage guard". The release-root gap is closed too (NEW-4). |
| WEB-7 | Medium | The CSP broke the Mobile Wallet Adapter on Android. | fixed | `connect-src` allows `ws://localhost:*` and `upgrade-insecure-requests` is removed (`divvy.conf`). It hasn't been tried on an Android phone yet (checklist). |
| WEB-8 | Medium | Errors after a send still said "Nothing was spent", inviting a second trade. | fixed | After a confirmation error, `signAndSend` (`apps/web/src/lib/tx.ts`) checks the signature status and raises `SentUnconfirmed` ("check the explorer before trying again"). "Nothing was sent" is now only the fallback for errors before sending (`TradeBox.tsx`). |
| WEB-9 | Low | Amount parsing and the sell presets were wrong. | partly fixed | `TradeBox.tsx` now parses decimals strictly, converts to exact base units with BigInt, starts with an empty sell field in live mode, and takes "100%" from the raw balance. Left: the percentage buttons still do nothing without `NEXT_PUBLIC_SOLANA_RPC_URL` (set it in production). |
| WEB-10 | Low | Switching to S3 storage would break images (CSP, and a tainted WebGL canvas). | fixed | `img.crossOrigin = "anonymous"` is set in `apps/web/src/three/scenes.ts`. `divvy.conf` documents adding the bucket's origin to `img-src` and a CORS rule. This becomes a config step once a storage provider is chosen (owner decision). |
| WEB-11 | Low | The geofence let unknown countries through. | fixed | Same fix as API-8. |
| WEB-12 | Low | CI pins GitHub Actions to tags, not commit SHAs. | accepted risk | `.github/workflows/ci.yml` runs with `permissions: contents: read`, uses no secrets, runs on `push` and `pull_request` (not `pull_request_target`) and deploys nothing. The mainnet checklist still asks for SHA pins before mainnet. |
| WEB-13 | Low | `docker-compose.yml` published Postgres and Redis on all interfaces. | fixed | Both are bound to `127.0.0.1`. |
| WEB-14 | Not given | Dependencies. | see DEP-1 to DEP-5 | The review knew of no advisory for next 14.2.35. `pnpm audit --prod` found 36. |

## On-chain money paths

| ID | Severity | Finding | Status | Where and how |
|---|---|---|---|---|
| MONEY-1 | High | A confirmed swap batch's output was shared with rounds that never paid into it (a double payout). | fixed | `stepSwaps` (`apps/worker/src/payouts/engine.ts`) records `swapBatchId` on the funding rounds when the batch is created, and splits the output only among them. Rounds that arrive later are carried. Resumed hours open no new rounds (`resumeOnly`). Test: `engine.test.ts` "a round that turns up after its hour's swap is carried". |
| MONEY-2 | High | A vault claim not attributed before its hour ended was never attributed. | fixed | Same fix as DATA-3. |
| MONEY-3 | High | A swap that landed could be treated as failed and swapped again. | fixed | Only a "failed on chain" error refuses the batch. Any other error after signing leaves the batch at `sent`, and the next run asks the chain (`outcome`). The batch goes back to pending only after a failed outcome, or after 5 minutes without one. No test of the outcome path. |
| MONEY-4 | High | One RPC error while reading the vault moved an hour of holders' fees to Divvy. | fixed | `vaultBalance` (`payouts/chain.ts`) passes RPC errors on. An empty vault produces a claim that covers no trades, so those fees stay for the next claim (`stepClaim`). If the vault is empty while at least 0.01 SOL of indexed fees are owed since the last claim, `alertEmptyVault` sends a critical alert, in dry-run and live. That is how a no-go on R2 would show up. |
| MONEY-5 | Medium | Concurrent settles restored a credit twice. | fixed | `settleTransfers` (`deliver.ts`) and `settleClaim` (`claims.ts`) move only pending rows, and only the call that moved a row restores the credit. Test: `engine.test.ts` "two settlers expiring the same transfer restore the credit once". The claim race isn't tested. |
| MONEY-6 | Medium | Claim and transfer expiry read statuses before the block height, with no margin. | fixed | `reconcileClaims` and `reconcileTransfers` read the block height first, then the statuses, and expire only 150 blocks past `lastValidBlockHeight` (`EXPIRY_MARGIN`). `engine.test.ts` "claims: reserves the credit, then confirms or gives it back" covers expiry, not the race. |
| MONEY-7 | Medium | A launch was marked failed while its create could still land. | fixed | Same fix as DATA-4. |
| MONEY-8 | Medium | The swap guards checked the quote, not the transaction that was signed, and the public RPC send could be sandwiched. | fixed | `swap` (`payouts/chain.ts`) checks the built swap: mints, `inAmount`, price impact, and `minOut` against the reference floor. It then simulates it, sends it as a Jito bundle on mainnet, and alerts if the output is below the minimum. No test: the engine tests stub the chain. |
| MONEY-9 | Medium | The fee claimer signed whatever instructions Jupiter returned. | fixed | `checkSwapInstructions` (`payouts/swapguard.ts`) allows ComputeBudget, Jupiter, wrapping and unwrapping SOL, and token accounts for the fee claimer or payout vault. The simulation bounds the SOL spent and the minimum received. Test: `apps/worker/test/swapguard.test.ts`. The simulation bounds aren't tested. |
| MONEY-10 | Medium | One bad recipient blocked its whole push batch forever. | fixed | A failed batch is retried one recipient at a time (`deliverCredits`). A wallet that still fails is skipped for 24 hours, each wallet on its own clock, with a warning alert (`blockedWallets`, `blockWallet`). Its credit stays and is retried, so it isn't stranded under push. No test. |
| MONEY-11 | Medium | The holder snapshot could be gamed by flash holding and by moving balances while pages were read. | partly fixed | `presnapshot.ts` takes a snapshot at a secret minute in the middle of the hour. `holdersForRound` pays each wallet on the smaller of that and its balance at the round, and refuses snapshots that add up to more than the supply. Test: `engine.test.ts` "pays each wallet on the smaller of its mid-hour and round balances". Left: paged snapshots aren't pinned to one slot, and the supply check misses double counts smaller than the frozen or burned balance. |
| MONEY-12 | Low | Trades after the claim in its own slot were never paid. | fixed | Same fix as DATA-2. |
| MONEY-13 | Low | There were no spend caps on fee-claimer swaps or payout-vault sends. | fixed | The caps come from `apps/worker/src/env.ts`:<br>• Swaps: `SWAP_HOURLY_CAP_LAMPORTS` (default 100 SOL), plus a per-stock size limit, `SWAP_BATCH_MAX_LAMPORTS` (default 20 SOL). `stepOpenRounds` budgets against both and `stepSwaps` checks the cap again before sending. Over budget, part is paid and the rest carries (NEW-2).<br>• Sends: `PUSH_HOURLY_CAP_USD` (default $25,000). `deliverCredits` sends what fits and leaves the rest for the next hour. The send cap has no test of its own. |
| MONEY-14 | Low | Hours older than the previous one were never resumed, and stale dust could be paid twice. | fixed | `apps/worker/src/index.ts` resumes every unfinished earlier hour, however old, and sends a critical alert once a round is more than a day old. A coin's rounds run in order, and dust comes only from delivered rounds (`stepOpenRounds`, `previousDust`). The mid-hour snapshot is kept for 26 hours, or until its round snapshots or carries (`dropPreSnapshot`), so a late round is still capped by it. No test of the resume loop. |
| MONEY-15 | Low | The payout vault paid the fee for every claim, with no minimum and no back-off. | fixed | Claims under `AUTO_PUSH_MIN_USD` are refused, and claims for a stock with no price wait (`NO_PRICE`). A claim that fails on chain blocks the next one for an hour (`buildClaim`, `settleClaim`). The vault is still the fee payer. |
| MONEY-16 | Low | Item status wasn't tied to amounts. | fixed | `markItems` (`deliver.ts`) marks the oldest credited items only up to the amount sent or claimed. The partial case isn't tested. |
| MONEY-17 | Low | CPMM creator-fee collections had no recovery. | fixed | `stepCpmmCreatorFees` asks the chain about rows left at 0 lamports, then creates the allocation or removes the row. |
| MONEY-18 | Low | Program-owned holders got credits nobody can claim. | partly fixed | `deliverCredits` never creates a token account for an off-curve wallet. Left: `classifyHolders` (`plan.ts`) still gives them a share, which then sits in `Credit`. |
| MONEY-19 | Low | The mainnet gate trusted the `SOLANA_CLUSTER` label. | fixed | The worker, and the API in live mode (`apps/api/src/server.ts`), check the RPC's genesis hash when they start (`assertClusterMatchesRpc`, `packages/solana/src/live/config.ts`). The constants aren't logged in VERIFIED.md yet (R13). |
| MONEY-20 | Low | Two money steps relied on there being a single worker process. | fixed | `stepSnapshots` credits only after a conditional step change. `stepSwaps` moves a batch from `pending` to `sent` before swapping. The Redis lock is renewed for as long as a run lasts (`apps/worker/src/lock.ts`). |
| MONEY-V1 | Not given | The TradeEvent layout. Reordered fee fields would pass the sanity checks. | needs on-chain verification | R1 |
| MONEY-V2 | Not given | Whether `PoolState.platform_fee` still accrues per pool. | needs on-chain verification | R2 |
| MONEY-V3 | Not given | Whether the curve vault's owner is the LaunchLab authority PDA. | needs on-chain verification | R3 |
| MONEY-V4 | Not given | How Scaled UI Amount xStocks are priced. | needs on-chain verification | R4 |
| MONEY-V5 | Not given | Whether xStock mints use DefaultAccountState Frozen. | needs on-chain verification | R5 |
| MONEY-V6 | Not given | Compute-unit limits. A duplicate limit instruction is now dropped in `JupiterClient.build`. | needs on-chain verification | R6 |
| MONEY-V7 | Not given | On-chain fee rounding compared with the SDK. | needs on-chain verification | R7 |

## Runbook agent notes

| ID | Severity | Finding | Status | Where and how |
|---|---|---|---|---|
| RB-1 | Not given | An unattributed vault claim was never retried, only one hour back was resumed, and a failed resume skipped the current hour. | fixed | The DATA-3 fix applies. In addition, `index.ts` resumes up to 24 hours back and catches each resume's error. |
| RB-2 | Not given | A launch could be failed late, and a `sendBundle` error ended the retry loop. | fixed | The DATA-4 fix applies. Each attempt in `processLaunch` also catches send errors. |
| RB-3 | Not given | The first live run sweeps every fee collected during dry-run. | open | Owner decision; see "First live run" below. |
| RB-4 | Not given | Dry-run can't detect missed trades, because the simulated claim equals the indexed fees. | accepted risk | By design: `stepClaim` logs the real `vaultBalance` next to the indexed sum so they can be compared by hand (code comment). The checklist's go-live step 7 does this comparison. |
| RB-5 | Not given | The meter showed "late" in dry-run. | fixed | See DATA-12. |
| RB-6 | Not given | Redis being down took the API down, and `/api/health` answers 200 with `ok:false`. | fixed | The rate limiter has `skipOnError: true` (`app.ts`). The 200-with-body behaviour is documented in `docs/RUNBOOK.md`, and its checks read `.ok`. |
| RB-7 | Not given | The API and the worker wrote media to different folders. | fixed | See WEB-6. |
| RB-8 | Not given | The payout lock was shorter than a run, and SIGTERM didn't wait for running jobs. | fixed | `withLock` renews the lock while the job runs (`lock.ts`). On SIGINT or SIGTERM, the queue workers stop taking jobs straight away, and the worker waits up to 120 s for running jobs (`index.ts`). That fits inside PM2's 130 s `kill_timeout`. |
| RB-9 | Not given | The admin late-round count included dry-run rounds. | fixed | It is now filtered by the current `dryRun` (`apps/api/src/live/routes/admin.ts`). |
| RB-10 | Not given | Hidden coins were still listed in `/api/payouts`, `/api/stats` and live events. | fixed | Lists, receipts and live events now leave hidden coins out (`public.ts`, `live/routes/live.ts`). The `/api/payouts` summary counts (`rounds`, `walletPayments`) now leave them out too. |
| RB-11 | Not given | Comments in the PM2 and Nginx files were out of date. | fixed | They have been updated. |
| RB-12 | Not given | Round and swap-batch status `failed` is never set. | open | Low. Failures are carried instead, so the API's `failed` filters never match anything. |
| RB-13 | Not given | The Jito alert fires per failed attempt, not on a failure rate (HANDOFF §8). | open | Low. It is limited to one alert per 15 minutes (`launch.ts`). |
| RB-14 | Not given | Pushes compared what was owed with the vault balance, ignoring pending transfers and claims. | fixed | `deliverCredits` now adds pending transfers and claims to what is owed. |
| RB-15 | Not given | The claim builder ignored `PAYOUTS_DRY_RUN`. | fixed | `buildClaim` answers `CLAIMS_CLOSED` in dry-run. No test. |

## Dependencies

`pnpm audit --prod` was run on 2026-10-26 and re-run for this record with the same result. It found 36 advisories: 3 critical, 13 high, 18 moderate and 2 low. By package:

| Package | Critical | High | Moderate | Low |
|---|---|---|---|---|
| next | 3 | 9 | 11 | 2 |
| postcss | 0 | 2 | 2 | 0 |
| bigint-buffer | 0 | 1 | 0 | 0 |
| deepmerge-ts | 0 | 1 | 0 | 0 |
| stream-json | 0 | 0 | 3 | 0 |
| uuid | 0 | 0 | 1 | 0 |

| ID | Severity | Finding | Status | Where and how |
|---|---|---|---|---|
| DEP-1 | 3 critical, 9 high, 11 moderate, 2 low | next 14.2.35 is affected by most advisories. They are patched only from next 15.5.28, and the 14.x line gets no fixes.<br>• Critical: two unauthenticated RCEs in the Image Optimization API, and one RCE that only affects servers hosted on Windows. The VPS runs Linux, so that one doesn't apply.<br>• High: RSC and Server Actions DoS, SSRF in Server Actions on custom servers, SSRF in rewrites, a middleware bypass (Pages Router only; Divvy has no middleware and uses the App Router), and an HTTP deserialization DoS.<br>• Moderate: XSS in the App Router, cache poisoning and confusion, request smuggling in rewrites, image-optimizer DoS and disk growth. | fixed | Fixed on 2026-10-26 with the owner's OK: next 15.5.28 and React 19.2.9. `pnpm audit --prod` lists no next advisory. The mitigations (optimizer off, `/_next/image` and `Next-Action` blocked in Nginx) stay as defence in depth. |
| DEP-2 | 2 high, 2 moderate | postcss, through next. | accepted risk | Used only at build time, on Divvy's own CSS, and never reached at runtime. next 15.5.28 still pins postcss 8.4.31, so it stays after the upgrade. |
| DEP-3 | High | bigint-buffer 1.1.5 or earlier (through spl-token) has a buffer overflow in the native `toBigIntLE`. | accepted risk | `pnpm.ignoredBuiltDependencies` in the root `package.json` skips the native addon, so the pure-JS fallback runs. The tests log "bigint: Failed to load bindings, pure JS will be used". |
| DEP-4 | High | deepmerge-ts below 8, through the Prisma CLI's config loader. | accepted risk | Used only at migrate and build time, on Divvy's own config. |
| DEP-5 | 4 moderate | stream-json below 3.6 and uuid below 11.1.1, through `@solana/web3.js` and jayson. | accepted risk | Not reached. web3.js loads only `jayson/lib/client/browser`, which never requires stream-json. It calls uuid v4 without a `buf` argument; the advisory needs v3, v5 or v6 with `buf`. |

## Found while re-checking and fixing

NEW-1 to NEW-4 were found while re-checking the reviews. NEW-5 was found while fixing. All five are now fixed in commit `68409dc`.

| ID | Severity | Finding | Status | Where and how |
|---|---|---|---|---|
| NEW-1 | Medium | The browser's transaction check threw on any transaction that uses address lookup tables, so graduated-coin (Jupiter) trades couldn't be made from the UI. | fixed | `checkTransaction` (`apps/web/src/lib/txcheck.ts`) used to call `getAccountKeys` with empty lookup keys, which web3.js 1.99 refuses. It now reads only the static keys; programs can't come from a lookup table. An index past the static keys is a lookup-table account and reads as unknown. Test: `apps/web/src/lib/txcheck.test.ts` "passes a Jupiter route compiled with address lookup tables" compiles a real v0 route with a lookup table. `pnpm test` now runs it (`apps/web` has a `test` script). |
| NEW-2 | Medium | A swap batch over `SWAP_HOURLY_CAP_LAMPORTS`, or over `MAX_SWAP_IMPACT_BPS`, was never split. It was refused every hour and kept growing, which stopped every coin paying that stock. | fixed | `stepOpenRounds` (`payouts/engine.ts`) gives each stock an hourly budget: the smaller of its adaptive size limit and what's left of `SWAP_HOURLY_CAP_LAMPORTS`. The size limit starts at `SWAP_BATCH_MAX_LAMPORTS`. `budgetRounds` (`plan.ts`) gives every coin the same fraction of its waiting share. The allocation that crosses the budget is split, so the rest stays carried. The size limit halves after a refusal for price impact or a quote off the reference price, and grows back by half after good swaps (`shrinkSwapLimit`, `growSwapLimit`). `chunkSwap` was removed. Tests: `engine.test.ts` "pays a backlog over the swap budget in part, carries the rest, and halves the size after an impact refusal (audit)" and `plan.test.ts` "budgets rounds". |
| NEW-3 | Low | Concurrent launches could starve the database connection pool. | fixed | The checks inside the lock now run on the advisory-lock transaction's own connection (`launchChecks` with `prisma: tx` in `apps/api/src/live/routes/create.ts`). No test. |
| NEW-4 | Low | The production storage guard checked the app's folder, not the release. | fixed | `assertProductionStorage` also refuses a `STORAGE_DIR` inside the workspace root, meaning the nearest folder holding `pnpm-workspace.yaml`. It checks both the path the app was started from and its realpath (`packages/server/src/storage.ts`). Test: `packages/server/test/storage.test.ts` (`../../data/media` is refused). |
| NEW-5 | Medium | A vault claim whose transaction failed on chain got a trade marker from the indexer. It was then attributed with 0 lamports over real trades, scaling every coin to 0, and those trades fell outside the next claim's range. | fixed | `Indexer.follow` (`apps/worker/src/indexer.ts`) no longer marks a claim whose signature has `err`. `recoverClaim` then sees the failure and gives the claim an empty range, so its trades roll into the next claim. No test. |

## Needs on-chain verification

None of these can be checked here, because this environment has no mainnet RPC. Each check below is read-only: none signs or spends. Scripts are in `packages/solana/scripts/phase0/` and run as `RPC_URL=… pnpm tsx scripts/phase0/<script>.ts` from `packages/solana`. Record each result, with its source, in `docs/VERIFIED.md` (CLAUDE.md rule 2).

**R1. TradeEvent layout compared with the deployed program.** (DATA-V3, MONEY-V1; VERIFIED item 13)
- **Why it matters:** `decodeTradeEvent` uses the 139-byte layout from `raydium-idl@e7e0c96` (May 2026). Its sanity checks catch most shifts, but not two u64 fee fields in swapped order.
- **Check:** run `decode-recent-trades.ts --limit 300`, then the same with `--address <a busy platform's PlatformConfig>`. For a platform whose rates are known (from `read-launchlab-configs.ts`), compare each trade's protocol, platform and creator fee with `amountIn` × its rate.
- **Go:** `layoutErrors: 0` over at least 200 transactions, and each fee field matches its rate to within rounding.
- **No-go:** any layout error, which would halt the indexer, or fees that line up with the wrong rate, which would misattribute silently. Fix the layout before mainnet.
- **Again on Divvy's own PlatformConfig:** after go-live step 6, the decoded platform fee of the test buy must equal the platform vault's balance change.

**R2. Whether `PoolState.platform_fee` still accrues per pool.** (DATA-V8, MONEY-V2; VERIFIED item 6)
- **Check:** run `read-launchlab-configs.ts --pool-of <a busy PlatformConfig>`, for example StonkFun's `6BwHH…`. It prints the pool's `platformFeeCounter` and the platform fee vault balance. Run it twice, some minutes apart.
- **Go:** the counter stays unchanged while the platform vault grows.
- **No-go:** the counter grows. Fees would then sit in each pool, Divvy's hourly vault claim would sweep nothing, trades would roll forward every hour and no holder would ever be paid. The critical `vault-empty` alert fires in this case (MONEY-4). A per-pool `claim_platform_fee` path must be built first.
- **During go-live:** the 24-hour mainnet dry-run (go-live step 7) also shows it, as `vaultBalance` in the log stays 0 while indexed fees grow.

**R3. The curve vault's owner is the LaunchLab authority PDA.** (MONEY-V3)
- **Why it matters:** `excludedOwners` (`payouts/chain.ts`) leaves out the owner returned by the SDK's `getPdaLaunchpadAuth` (`poolAddresses().auth`) and the pool id.
- **Check:** for a LaunchLab pool shown by `read-launchlab-configs.ts --pool-of …`, read the base vault with `getAccountInfo(vaultA, { encoding: "jsonParsed" })`. `parsed.info.owner` must equal that PDA. No script prints this yet.
- **Devnet:** in the rehearsal, each coin's largest `HolderBalance` row should have `excludedReason = 'curve'`.
- **Go:** the owner matches.
- **No-go:** about 79% of the supply would count as eligible, and that share of every round would be credited to an account nobody can claim from.

**R4. Pricing of Scaled UI Amount (Token-2022) xStocks.** (MONEY-V4)
- **Check:**
  - `fetch-xstocks.ts` prints each mint's `scaledUiAmountConfig` multiplier.
  - `jupiter-quote-xstock.ts --mint <xStock> --lamports 1000000000` prints the raw `outAmount`.
  - Compare (`outAmount` / 10^decimals) × the xStock's Price API v3 `usdPrice` with 1 SOL × SOL's `usdPrice`.
- **Go:** the two agree to within the quote's price impact.
- **No-go:** they differ by about the multiplier. That means the Price API prices UI units, so these are all off by the multiplier:
  - `quoteLooksWrong` and `referenceFloor`;
  - `AUTO_PUSH_MIN_USD` and `PUSH_HOURLY_CAP_USD`;
  - the USD on receipts.

  If the multiplier is more than about `MAX_SWAP_IMPACT_BPS` above 1, every swap is refused. Convert the prices to raw units before mainnet.

**R5. DefaultAccountState Frozen on xStock mints and new token accounts.** (MONEY-V5; VERIFIED item 11)
- **Check:** `fetch-xstocks.ts` prints `defaultAccountState` for each mint.
- **Go:** the state is initialized, or the extension isn't present.
- **No-go:** the state is frozen. New token accounts would start frozen, so pushes that create an account and every claim to a new account would fail. Failed claims start the 1-hour back-off, and a failed push skips the wallet for 24 hours before trying again. Leave that stock out, or agree a thaw process with the issuer.

**R6. Compute-unit limits of real transactions.** (MONEY-V6)
- **Limits in the code:**
  - Jupiter swaps: 600,000 (`JupiterClient.build`, which now drops Jupiter's own SetComputeUnitLimit).
  - Claims: 100,000 (`buildClaim`).
  - Pushes: 120,000 per transfer (`sendBatch`).
  - Creates: 400,000 (`createTransaction`).
- **Check:**
  - Swaps: `jupiter-quote-xstock.ts --mint <xStock> --lamports <a typical hourly batch> --build --taker <fee claimer public key> --simulate` prints `unitsConsumed`.
  - Creates: the `test-launch.ts` dry run prints the create's units.
  - Claims and pushes: no script yet. Simulate, with `sigVerify: false`, a `transferChecked` plus an idempotent token-account create of each xStock, from an existing holder's account to a fresh wallet.
- **Go:** every transaction uses at most about 80% of its limit.
- **No-go:** raise that limit. A transaction over its limit fails on chain and still costs its fee. For a claim, the vault pays.

**R7. Fee rounding compared with on-chain values, and the minimum trade size.** (DATA-V1, MONEY-V7)
- **Why it matters:** attribution uses each event's `platform_fee`. Any gap between that and what reaches the vault shows up in one of two ways:
  - The vault received more: `unattributedLamports`, kept by Divvy.
  - The vault received less: a shortfall, where every coin is scaled down and a warning alert is sent.
- **Check:**
  - Choose a busy PlatformConfig that claims rarely.
  - Read its platform fee vault balance twice (`read-launchlab-configs.ts <platformConfig>`).
  - Sum the platform fees of the trades in between (`decode-recent-trades.ts --address <platformConfig> --limit 1000`).
  - Compare a few decoded trades with the SDK's `quoteBuy`/`quoteSell` for the same `amountIn` and pool state.
  - Note the smallest `amountIn` seen.
- **Go:** the vault's growth equals the decoded sum to the lamport, and the SDK quotes match the event fees.
- **No-go:** a steady gap per trade. Attribution then has to model the rounding.
- **Minimum trade size:** this tells whether the dust trades behind DATA-1 can happen at all.
- **Again on Divvy's own PlatformConfig:** after go-live step 6.

**R8. Events can't be spoofed through LaunchLab's event CPI.** (DATA-V2)
- **Why it matters:** the indexer trusts an inner instruction whose program is LaunchLab and whose data starts with Anchor's event tag. Anchor's `emit_cpi!` handler accepts the call only if the event-authority PDA signed, and only LaunchLab can sign for it. LaunchLab is closed source.
- **Check:** simulate (`sigVerify: false`, read-only) a transaction that calls LaunchLab with `EVENT_IX_TAG_LE` + a TradeEvent body, passing the event-authority PDA as a non-signer. No script exists.
- **Go:** the simulation fails.
- **No-go:** anyone could inject events. Because of the instruction and event count check (DATA-6), a spoofed event now halts the indexer rather than misattributing. That still blocks payouts.

**R9. The migration transaction and the CPMM pool.** (DATA-V4; VERIFIED item 16)
- **What the code relies on:**
  - `migrate_to_cpswap` references the platform's PlatformConfig, so the indexer sees it.
  - In `initialize_with_permission`, the pool is account 4 and the mints are accounts 5 and 6.
  - The pool creator is `platform_cp_creator`, or the coin's creator when that is unset (`checkMigrations`).
- **Check:**
  - Run `decode-recent-trades.ts --address <a PlatformConfig with graduated coins>`. It prints "migration → CPMM pool" when a migration is in that stream.
  - For one such pool, decode the CPMM pool account (`decodeCpmmPool`: `pool_creator`, config, mints, creator fee). No script prints CPMM pool state yet.
- **Go:** migrations appear in the platform's stream, account 4 is the pool, and the pool creator follows the rule above.
- **No-go:** Divvy would learn of graduations only through the PDA fallback, which refuses a mismatched creator and alerts. A pool made from a keypair would never be found, so graduated coins would show stale prices and no volume.

**R10. The deployed CPMM `SwapEvent`.** (DATA-V5; VERIFIED item 14)
- **Check:** run `decode-recent-trades.ts --cpmm <a graduated pool>`, and compare `out` with the output vault's token balance change in the same transaction.
- **Go:** the events decode cleanly and the amounts match. This also shows whether `output_amount` is before or after the creator fee.
- **No-go:** post-graduation volume, candles and prices would be wrong. Money isn't affected: fee attribution after graduation comes from actual claims.

**R11. How the production RPC behaves.** (DATA-V6, plus this re-check). There are three read-only checks, with no script:

| | Check | Go | No-go |
|---|---|---|---|
| (a) | For a busy slot, compare the order of `getSignaturesForAddress` within the slot with the block's own order from `getBlock`. | Block order. | Vault claims are placed by their position in the stream (DATA-2), so a different order puts trades in the wrong claim. |
| (b) | Call `getSignaturesForAddress` with `until` set to a signature that doesn't exist, as after a rollback. | An error or an empty page. | The full history comes back, so the indexer would re-read everything. |
| (c) | Call `getSignatureStatuses` with `searchTransactionHistory: true` for signatures 1 day and 30 days old. | Both come back `finalized`. | `attributeVaultClaim` deletes trades whose status comes back missing. The first live claim re-checks every trade since launch (RB-3), so real trades and their fees would be dropped and kept by Divvy as unattributed. |

(c) is the most serious of the three.

**R12. Jito bundle status.** (DATA-V7; VERIFIED item 9)
- **Check:**
  - From the Jito docs, or by watching the test launch (go-live step 5), find the commitment behind "Landed" in `getInflightBundleStatuses`, and whether "Invalid" can be transient just after `sendBundle`.
  - Check that the swap's tip account isn't loaded through one of Jupiter's lookup tables (look at `addressTableLookups` in a built swap). VERIFIED item 9 says the tip must not come through a lookup table.
- **Go:** "Landed" is at least processed, and the tip account is a static key.
- **No-go on status:** only slower or noisier launches. Launches now wait for a confirmed signature, and the reconciler waits until the blockhash expires.
- **No-go on the tip:** the swap bundle is refused.

**R13. Genesis hashes.** (Found while re-checking, MONEY-19)
- **Why it matters:** `GENESIS_HASH` in `packages/solana/src/live/config.ts` (mainnet `5eykt4…`, devnet `EtWTRA…`) isn't logged in `docs/VERIFIED.md`.
- **Check:** call `getGenesisHash` on the production mainnet RPC and on a devnet RPC, then log both values with their source.
- **Go:** they equal the constants.
- **No-go:** the worker and the live API refuse to start, so they fail closed. Correct the constant from a cited source.

## Open owner decisions

**Decided by the owner on 2026-10-26** (in chat, after the trade-offs below were put to them):

- **Go straight to mainnet, without the devnet rehearsal** (checklist section 4). Mitigation: payouts start in dry-run with small caps, and every spend still needs the owner's OK in chat.
- **Delivery model: push, paid by the holder** (item 1; changed 2026-10-27). `PAYOUT_DELIVERY=push`. Each send keeps `DELIVERY_FEE_USD` ($0.02) of the dividend for uspad, and a send that creates the holder's token account also keeps that account's rent, both in the stock (ECONOMICS.md design e). uspad no longer pays rent, so rent farming costs it nothing and `MIN_HOLDER_USD` can stay $10 (item 6, still the owner's call).
- **After graduation: the CPMM creator fee goes to uspad** (item 3). `platform_cp_creator` is set to the fee claimer and `CPMM_CREATOR_FEES=true`; the pot is split 50 : 15 : 10 like the curve fee, and the creator's share is forwarded in SOL. Fee Key harvesting is built but stays off (`LOCKED_LP_FEES`) until checked on the first graduated coin.
- **Two wallets instead of four** (2026-10-27). The launcher, fee-claimer and payout-vault roles share one operations wallet; the platform admin stays separate and offline from the apps. Trade-off, put to the owner: a stolen operations key exposes everything in it (working SOL, uspad's fees, holders' stock not yet sent), where separate keys would have exposed one role's balance. Spend caps limit bugs, not a stolen key, so its balances must stay small; under push, holders' stock leaves it every hour.
- **The X field is the project's link** (2026-10-27). The create form takes the project's X account as a typed handle or link (`https://x.com/uspadfun?s=11` works), like the prototype's typed handle, instead of OAuth linking. The server still allows one coin per X account. Trade-off: nothing proves the creator runs that account, so someone could put a real project's X on a copy first. A typed link is therefore only a link on the coin page: it doesn't count as "linked X" for the free-launch guard and isn't shown as "by @handle". OAuth linking stays in the API, unused (`go-live.sh x-login` turns it on).
- **Dividends every hour: `MIN_ROUND_USD` $1** (2026-10-27, item 8's threshold). The owner wants holders paid every hour, as the site says. Swaps are batched per stock, so the economics model's $1 applies: a coin's holders' share pays in the hour it reaches $1 (about $200 of trading on the curve), and anything under waits for the next hour. The send minimums stay (`AUTO_PUSH_MIN_USD` $1, `PUSH_NEW_ATA_MIN_USD` $5), so the delivery fee is at most 2% of a send and a first send's rent at most about 8%. `go-live.sh payouts minimum <USD>` changes it.
- **Creators pay for their launch; launches are unlimited** (2026-10-27). With `LAUNCH_FEE_LAMPORTS` set (`go-live.sh launch-fee <SOL>`), the create form asks the creator's wallet to send the fee to the operations wallet, the API reads that transfer from the chain (signed by the signed-in wallet, at least the fee, under a day old, each signature once: `apps/api/src/live/launchfee.ts`), and only then queues the launch. The fee replaces the free-launch limits: no per-wallet daily limit, no cooldown, no "X or funded wallet" guard; the global daily limit stays. A launch that fails gives the fee back as credit for the creator's next launch. Admins launch without a fee. Trade-off: anyone with SOL can launch as often as they like, so copy protection (ticker, name, picture, X) is what stops spam copies.
- **The creator signs and pays for their coin's create** (2026-10-27). GMGN and other explorers show a create's signer as the coin's dev, and uspad's operations wallet signed every create, so every coin showed the same dev with uspad's history. The worker now builds `initialize_with_token_2022` with the creator's wallet as payer and creator, uspad's fee (`LAUNCH_FEE_LAMPORTS`, 0.02 SOL, the owner's choice) and the Jito tip inside it, and signs it with the mint only. The launch moves to a new step, `signing`: the API hands that create, without signatures, to the launch's creator alone; the page checks it (`checkCreate`: payer and creator are the wallet, only the mint co-signs, only the fee and one tip of at most 0.001 SOL leave the wallet), the wallet signs, and the worker accepts it if the creator's signature is good and it is still this create, compute budget instructions aside, then adds the mint's signature and sends the bundle. Turning it down, or three rounds without a good signature, ends the launch with nothing charged; the fee lands with the coin or not at all, so no separate payment or credit is needed any more (earlier payments still count as credit). The creator pays about 0.009 SOL for the create on top of the fee; the API refuses a wallet holding less than the fee plus 0.012 SOL. Trade-off, put to the owner: the creator's wallet sees the mint a few seconds before the coin lands (it can't send the create without uspad's mint signature), so the creator alone could have a buy ready for the first block after it.
- **Tickers, names and X accounts can repeat** (2026-10-27). At the owner's request, a coin may use the ticker, name or X account of another coin, launched or launching. Only the format rules (letters and digits, 2 to 10 characters) and the reserved tickers (tokens already trading elsewhere with real volume) still refuse. `Coin.tickerNorm` and `creatorXUserId` are no longer unique (migration `20261027210000_shared_tickers`). Coin links use the mint; an old ticker link opens the first coin launched with that ticker. The coin page's copy protection panel became "Check the address", and How it works says the contract address is what tells coins apart. Trade-off: anyone can launch a coin that looks exactly like another one, so buyers must check the address.
- **Pictures aren't checked** (2026-10-27). At the owner's request, any picture can go on any coin: the upload check always passes and the launch no longer compares pictures (HANDOFF's picture fingerprint is off). Ticker, name and X are still checked. Trade-off: a copy can now use the original coin's exact picture, so the ticker and name checks are what tell coins apart. `Coin.imageSha256` and `imagePhash` are still stored, so the check can come back. Migration `20261027200000_launch_fees_picture_reuse` dropped the unique picture index.
- **Next.js upgrade: done** (item 7, DEP-1). next 15.5.28 with React 19.2.9.
- **How it works copy** (item 9, step 4): rewritten at the owner's request. Raydium's fee, the shared vault, graduation, the locked LP and the fee after graduation are explained.

1. **Delivery model: push, or credit and claim** (HANDOFF §3.4).
   - `PAYOUT_DELIVERY` defaults to `push` (`packages/shared/src/params.ts`). `docs/ECONOMICS.md` recommends credit and claim, because pushes pay token-account rent.
   - The site's copy switches through `deliveryCopy`. The words "credited every hour" are used only if claim is chosen (CLAUDE.md rule 8).
   - Under claim, holders pay their own account rent and the payout vault pays each claim's network fee (MONEY-15).
2. **Fee split.** `FEE_*` must equal the PlatformConfig, and payouts refuse to run when they differ. The default 1% is 0.25% Raydium + 0.50% holders + 0.15% creator + 0.10% Divvy.
3. **After graduation:**
   - Set `platform_cp_creator` to the fee claimer (a mainnet `updatePlatformConfig`) and turn on `CPMM_CREATOR_FEES`, or leave the CPMM creator fee with the coin's creator.
   - Harvesting the locked-LP Fee Key isn't built.
4. **Media storage provider.** Metadata URIs are permanent once a coin exists.
   - With `STORAGE_DRIVER=s3`, add the bucket's origin to the CSP `img-src` and a CORS rule (WEB-10).
   - With local storage, use an absolute folder outside `/srv/divvy` (NEW-4) and back it up.
5. **Legal: Terms of use and the geofence list** (HANDOFF §10).
   - `BLOCKED_COUNTRIES` defaults to `US`, and unknown countries are refused in production (API-8).
   - `/terms` shows a draft notice until `NEXT_PUBLIC_TERMS_FINAL=true`.
   - xStocks are offered to non-U.S. persons only (VERIFIED item 11).
6. **Thresholds and caps.**
   - Thresholds: `MIN_ROUND_USD` (the spec says $5; the economics model suggests $1 with batched swaps), `MIN_HOLDER_USD`, `AUTO_PUSH_MIN_USD`, `PUSH_NEW_ATA_MIN_USD`, `MAX_SWAP_IMPACT_BPS`.
   - Hourly caps and the swap size limit. Each should be set on purpose, not left at its default:
     - `SWAP_HOURLY_CAP_LAMPORTS` (default 100 SOL);
     - `SWAP_BATCH_MAX_LAMPORTS`, the largest swap per stock per hour (default 20 SOL);
     - `PUSH_HOURLY_CAP_USD` (default $25,000);
     - `LAUNCHER_HOURLY_CAP_LAMPORTS` (default 3 SOL).

     Money over the swap budget waits and is paid in later hours. If a stock's holders' share is regularly larger than its size limit, payouts for that stock fall further behind every hour (the budget alert fires).
7. ~~**Next.js 15.5 upgrade (DEP-1).**~~ Approved by the owner and done on 2026-10-26: next 15.5.28, React 19.2.9.
8. **Dividend assets at launch** (HANDOFF §12). Insert them from `fetch-xstocks.ts` output, after R4 and R5.
9. **Copy that doesn't match how the money moves.** On chain:
   - One platform fee vault holds the platform fees of every Divvy coin (VERIFIED item 6 and "Where the sources contradict HANDOFF" item 1). Each coin's share is still exact, because it comes from that coin's own indexed trades.
   - Creator fees go to one vault per creator.
   - Raydium's 0.25% goes to Raydium.
   - The 0.50%/0.10% split between holders and Divvy is done by the worker.
   - Divvy's fee-claimer wallet makes one swap per stock per hour for every coin paying that stock, and the stock goes to the payout vault.
   - Holders are paid on the smaller of a secret mid-hour balance and their balance at the round (MONEY-11).

   The wording below is kept from the prototype (CLAUDE.md rules 1 and 8). The owner should decide whether to change it:
   - `apps/web/src/components/coin/CoinView.tsx`: "Fees sit in this coin's own on-chain vault until the hourly round." (Prototype line 960.)
   - `apps/web/src/app/how/page.tsx` step 4: "Every trade fills the coin's vault" and "straight into this coin's own vault: 0.50% for holders, 0.15% for the creator, 0.10% for Divvy and 0.25% for Raydium". (Prototype line 1211.)
   - `how/page.tsx` step 5:
     - "At the top of each hour the vault buys the coin's stock token…";
     - "The curve, the pool and the launcher wallet are left out." Divvy's own wallets and the burn address are left out too.
     - Nothing says a wallet must also hold at the secret mid-hour moment.
   - `apps/web/src/components/payouts/PayoutsView.tsx`: "Every hour each coin's vault buys its stock and …".
   - `MeView.tsx` "your own creator vault" is accurate.
10. **First live run: what to do with the dry-run backlog (RB-3).** See below.

### First live run

What `apps/worker/src/payouts/engine.ts` does today on the first run with `PAYOUTS_DRY_RUN=false`:

- **Dry-run never touches the vault.**
  - Each dry-run hour writes `VaultClaim`, `FeeAllocation`, `PayoutRound` and `PayoutItem` rows with `dryRun = true`. The simulated claim equals the indexed fees.
  - It writes no `Credit` rows and signs nothing.
  - The real platform fee vault keeps every platform fee since the PlatformConfig's first trade, including the test launch.
- **The first live claim starts from zero.** `stepClaim` looks for the previous claim with the same `dryRun` value. There is none, so the claim starts at `fromTradeId = 0` and `fromSlot = 0` and sweeps the vault's whole balance.
- **It re-checks every trade since launch.** `attributeVaultClaim` covers every curve trade the indexer has stored, from the first one up to the claim's position in the stream. Before attributing, it asks the RPC for the status of every one of those signatures and deletes trades it can't find (R11c).
- **Each coin is credited all its fees at once.**
  - Each coin's allocations hold its all-time indexed platform fees.
  - Dry-run allocations are never reused, and dry-run `PayoutItem`s never become credits.
- **The backlog is paid out over several hours** (NEW-2).
  - Each stock's swap takes at most its size limit (`SWAP_BATCH_MAX_LAMPORTS`, default 20 SOL) and what's left of `SWAP_HOURLY_CAP_LAMPORTS`.
  - Every coin paying that stock gets the same fraction of its share each hour; the rest stays carried.
  - A coin whose fraction is under `MIN_ROUND_USD` carries whole that hour.
  - A refusal for price impact halves the next hour's size.
- **Who gets it:**
  - Each hour's part goes to the holders at that hour's round, each capped by the secret mid-hour snapshot of the hour before. The pre-snapshot job also runs during dry-run.
  - Holders who sold during dry-run get nothing. Anyone who buys more than an hour before go-live shares in the backlog for as long as it lasts.
- **A test shows this:** `engine.test.ts` "live: claims, attributes, swaps…" runs live right after the dry-run test and pays the same trades again.
- **Size:** the backlog equals the last dry-run `vaultBalance` that `stepClaim` logged. The meters' `pendingUsd` shows the holders' part (DATA-13).

Options:
- **(a) Accept it, and keep the backlog small.** Dry-run on mainnet only with launches paused, so the backlog is just the test coin's fees. The go-live order in the checklist does this.
- **(b) Pay the backlog to the holders the dry-run rounds already computed.** This would turn dry-run `PayoutItem`s into credits, which isn't built.
- **(c) Set the backlog aside before going live.** A one-off claim with its own accounting, which isn't built and is a mainnet spend that needs approval.

Whichever option is chosen, divide the backlog by the swap budget to see how many hours it takes to drain, and set `SWAP_BATCH_MAX_LAMPORTS` and `SWAP_HOURLY_CAP_LAMPORTS` knowing that.
