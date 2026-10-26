# Phase 0: Jito, Jupiter, xStocks and Helius integration facts (for docs/VERIFIED.md)

Compiled 2026-10-26. The shell could not reach any live endpoint (Solana RPC, jito.wtf, jup.ag, xstocks, backed.fi and helius.dev were all blocked, and WebFetch could not resolve any of those hosts). So every fact below comes from git repositories cloned at the commits listed, or from WebSearch result snippets, which are marked as such. **No live call was made.**

## Status legend
- **VERIFIED from source**: the fact appears in code or in an official docs-source repository at a pinned commit, and I read the file myself.
- **DOCS ONLY**: the fact comes only from a web page seen through a WebSearch snippet. I could not open the page and could not quote it from a repository.
- **NEEDS LIVE CHECK**: the fact is documented, but runtime behaviour has to be confirmed by a live call, which was blocked here.
- **NOT VERIFIED**: no source confirmed it.

## Pinned sources

| Short name | Repo @ commit (date) |
|---|---|
| jito-docs | `jito-labs/jito-docs@9b923b88c07492eaa5804bfbed88edfcff36c51a` (2026-09-09). This is the Sphinx source for docs.jito.wtf. |
| mev-protos | `jito-labs/mev-protos@46ead86a13a55a0ef2c139db96a8ee93bf7505e3` (2025-07-23) |
| jito-js-rpc | `jito-labs/jito-js-rpc@7f057837e0e4e9cbd550586451ea7e89999fb6ca` (2025-06-15) |
| jito-rust-rpc | `jito-labs/jito-rust-rpc@a981785e0f362f980df113f944034466168b08ff` (2025-06-20) |
| jito-ts | `jito-labs/jito-ts@77e94053c4293de71e100b8b42b592ad7d2e567d` (2025-09-10), package version 4.2.1 |
| jup-docs | `jup-ag/docs@0066fdeab9aebddae99d68f58ed121d58153e88a` (2026-10-19). This is the source for developers.jup.ag. |
| sf-tokens | `solana-foundation/tokens@e87d61f60e813aff9a222907a18939ecaf11030b` (2026-10-23) |
| trustwallet | `trustwallet/assets@1047fedeae1f90efedf3b005a4c6915ebb8a1174`. This is HEAD at fetch time; the files were read from raw.githubusercontent.com master. |
| solana-com | `solana-foundation/solana-com@b505fdbd118b7602ddaa297ead28d37e26274940`, file `apps/media/content/posts/case-study-xstocks.mdx` |
| backed-tokenlist | `backed-fi/cowswap-xstocks-tokenlist@401edae9acf8e14152825864b974635e802ac948` (2026-09-24). Owned by the official Backed (xStocks issuer) GitHub org. |
| helius-sdk | `helius-labs/helius-sdk@8560889fffe1af14d69e99d001cec29196756b87` (2026-10-23) |
| token-2022 | `solana-program/token-2022@3f85f9cf0764a15869d4c11411cfe022eaa1d6ee` (2026-10-24) |
| agave | `anza-xyz/agave@f4bd2e9b64a92e0f3c8fe47279805ede1bce60d5` (2026-10-26). Only `account-decoder*` was checked out (sparse). |

Repos that do not exist or are not public (clone asked for credentials): `jito-foundation/jito-js-rpc`, `jito-foundation/jito-docs`, `jito-labs/docs`, `helius-labs/docs`, `helius-labs/helius-docs`.

---

## 1. Jito bundle submission (JSON-RPC)

### 1.1 Endpoint paths
**Finding:** Bundle methods are served under `https://<host>/api/v1`. The official docs send `sendBundle` to `/api/v1/bundles`, and give each read method its own path: `/api/v1/getBundleStatuses`, `/api/v1/getTipAccounts` and `/api/v1/getInflightBundleStatuses`. The official JS SDK and the older spec instead send every bundle method to `/api/v1/bundles`. JSON-RPC dispatches on the `method` field, so both styles probably work, but I could not test that.
**Source:**
- jito-docs `docs/source/lowlatencytxnsend.md:156`: `### 💼 Bundles (\`/api/v1\`)`
- jito-docs `:184`: `curl https://mainnet.block-engine.jito.wtf:443/api/v1/bundles -X POST ...` (sendBundle)
- jito-docs `:257`: `curl https://mainnet.block-engine.jito.wtf/api/v1/getBundleStatuses -X POST ...`
- jito-docs `:336`: `curl https://mainnet.block-engine.jito.wtf/api/v1/getTipAccounts -X POST ...`
- jito-docs `:391`: `curl https://mainnet.block-engine.jito.wtf/api/v1/getInflightBundleStatuses -X POST ...`
- jito-js-rpc `src/index.ts:82` (the same pattern is at :67, :106 and :111): `const endpoint = this.uuid ? \`/bundles?uuid=${this.uuid}\` : '/bundles';`, with base URL `https://mainnet.block-engine.jito.wtf/api/v1` (`examples/basic_bundle.js:15`)
- mev-protos `json_rpc/http.md:7`: `https://mainnet.block-engine.jito.wtf:443/api/v1/bundles`
- jito-rust-rpc `src/lib.rs:113`: `format!("/getBundleStatuses?uuid={}", uuid)`. This shows the per-method path style.

**Status:** VERIFIED from source for both styles. Whether the server accepts both is a NEEDS LIVE CHECK.
**Implication for Divvy:** `jito-bundle.ts` uses the per-method paths from the docs. If a read method returns 404, fall back to `/api/v1/bundles`.

### 1.2 Method names
**Finding:** The methods are `sendBundle`, `getBundleStatuses`, `getInflightBundleStatuses` and `getTipAccounts`. There is also `sendTransaction` on `/api/v1/transactions`.
**Source:** jito-docs `:168`, `:242`, `:323` and `:373` (section headers); jito-js-rpc `README.md:12-18`.
**Status:** VERIFIED from source.
**Implication:** The method names in the spec are correct.

### 1.3 Max transactions per bundle
**Finding:** A bundle holds at most 5 transactions. The status methods also take at most 5 bundle IDs per request.
**Source:**
- jito-docs `:25`: `- Bundles are groups of transactions (max 5) bundled together`
- jito-docs `:178`: `... Maximum of 5 transactions.`
- jito-docs `:252`: `**REQUIRED**: An array of bundle IDs to confirm. Maximum of 5.`
- jito-rust-rpc `src/lib.rs:145-146`: `if transactions.len() > 5 { return Err(anyhow!("Bundle can contain at most 5 transactions"));`
- jito-ts `README.md:36`: `export BUNDLE_TRANSACTION_LIMIT=5`

**Status:** VERIFIED from source.
**Implication:** One hourly bundle holds at most 5 transactions, counting the swap, the distribution transfers and the tip. Payouts to many holders will need several bundles or plain transactions. An atomic "swap plus pay everyone" is only possible for a small holder set.

### 1.4 Encoding
**Finding:** Use base64, and pass `{"encoding":"base64"}` explicitly. **The default is still base58, which is deprecated.** The older spec in mev-protos says base64 is not supported; that is outdated.
**Source:**
- jito-docs `:178`: `Fully-signed transactions, as base64 (**recommended**) or base58 (slow, DEPRECATED) encoded strings.`
- jito-docs `:179`: `Values: \`base64\` (**recommended**) or \`base58\` (slow, DEPRECATED). Default: \`base58\``
- jito-docs `:197-199`: the example ends with `{ "encoding": "base64" }`
- jito-js-rpc `src/types.ts:12`: `export type ParamsWithEncoding<T extends any[]> = [...T] | [...T, { encoding: 'base58' | 'base64' }];`
- Outdated, mev-protos `json_rpc/http.md:142`: `as encoded string (base-58) upto a maximum of 5. Please note that at this point, we don't support base-64 encoded transactions`

**Status:** VERIFIED from source.
**Implication:** Params must be `[[b64tx,...], {"encoding":"base64"}]`.

### 1.5 How the tip is paid, and the minimum tip
**Finding:**
- A tip is any instruction, top-level or CPI, that transfers SOL to one of the **8** tip accounts.
- The minimum tip is **1000 lamports**. It may not be enough when demand is high.
- Jito recommends putting the tip **inside the main transaction**, not in a separate tip-only transaction, to reduce "uncle bandit" risk.
- Tip accounts must **not** be referenced through Address Lookup Tables.
- The jito-ts helper `addTipTx` appends a separate tip transaction as the last one in the bundle. That is allowed, but it is the riskier pattern.
- Tip levels can be read at `https://bundles.jito.wtf/api/v1/bundles/tip_floor` and `wss://bundles.jito.wtf/api/v1/bundles/tip_stream`.

**Source:**
- jito-docs `:172`: `A tip is necessary for the bundle to be considered. The tip can be any instruction, top-level or CPI, that transfers SOL to one of the 8 tip accounts. ... Ideally, select one of the accounts at random to reduce contention.`
- jito-docs `:81`: `Please note that Jito enforces a minimum tip of 1000 lamports for bundles.`, and again at `:668` and `:677`
- jito-docs `:574`: `1. Integrate tip instructions within your main transaction alongside core logic.`
- jito-docs `:576`: `3. Exercise caution when sending tips as standalone transactions in bundles, as this may increase vulnerability to uncle bandit scenarios.`
- jito-docs `:579`: `When tipping make sure to not use Address Lookup Tables for the tip accounts.`
- jito-docs `:601`: `When using \`sendBundle\`, only the Jito tip matters.`
- jito-docs `:607`, `:626`: the tip_floor and tip_stream endpoints
- jito-ts `src/sdk/block-engine/types.ts:44-79`: `addTipTx(...)` builds a new v0 transaction containing only `SystemProgram.transfer` to `tipAccount`, then `:75` `this.transactions.push(tipTx);`

**Status:** VERIFIED from source.
**Implication:** Put the tip `SystemProgram.transfer` inside the swap transaction (or the last distribution transaction), keep the tip account in the static account keys, and pick a random account from `getTipAccounts`. The minimum is not a market price, so size the tip from `tip_floor` (for example its 50th to 75th percentile). `jito-bundle.ts` checks offline that a transfer to a tip account appears in the static keys and that it is at least 1000 lamports.

### 1.6 Tip accounts
**Finding:** `getTipAccounts` takes no parameters and returns 8 base58 strings. The docs say they "have remained constant". The example list in the docs is different from the example list in the old mev-protos spec, which looks like a stale or non-mainnet set.
**Source:**
- jito-docs `:325`: `The tip accounts have remained constant and can also be found [here]`
- jito-docs `:359-366`: `96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5`, `HFqU5x63VTqvQss8hp11i4wVV8bD44PvwucfZ2bU7gRe`, `Cw8CFyM9FkoMi7K7Crf6HNQqf4uEMzpKw6QNghXLvLkY`, `ADaUMid9yfUytqMBgopwjb2DTLSokTSzL1zt6iGPaS49`, `DfXygSm4jCyNCybVYYK6DwvWqjKee8pbDmJGcLWNDXjh`, `ADuUkR4vqLUMWXxW9gh6D6L8pMSawimctcNZ5pGwDcEt`, `DttWaMuVvTiduZRnguLF7jNxTgiMBZ1hyAumKUiL2KRL`, `3AVi9Tg9Uo68tJfuvoKvqKNWKkC5wPdSSdeBnizKZ6jT`
- mev-protos `json_rpc/http.md:121-128` lists a different set, starting `9n3d1K5YD2vECAbRFhFFGYNNjiXtHXJWn9F31t89vsAV`

**Status:** The docs list is VERIFIED from source. Whether it matches mainnet today is a NEEDS LIVE CHECK.
**Implication:** Never hardcode tip accounts. Call `getTipAccounts`, cache the result and refresh it periodically.

### 1.7 Bundle ID and status semantics
**Finding:**
- The bundle ID is the SHA-256 of the bundle's transaction signatures.
- A success response from `sendBundle` only means the bundle was received.
- `getBundleStatuses` returns `null` until the bundle lands. It searches only recent history (`MAX_RECENT_BLOCKHASHES` = 300 slots).
- `getInflightBundleStatuses` looks back 5 minutes and returns `Invalid`, `Pending`, `Failed` or `Landed`.

**Source:** jito-docs `:230`, `:170`, `:244-246` and `:375-428`.
**Status:** VERIFIED from source.
**Implication:** Poll `getInflightBundleStatuses` first, then `getBundleStatuses` once it says `Landed`. Treat "Invalid after 5 minutes" as dropped and rebuild with a fresh blockhash.

### 1.8 Regional block engines
**Finding:** Mainnet hosts are `mainnet.` (global), `amsterdam.`, `dublin.`, `frankfurt.`, `london.`, `ny.`, `slc.`, `singapore.` and `tokyo.`, each followed by `mainnet.block-engine.jito.wtf`. The global host is just `mainnet.block-engine.jito.wtf`. Testnet has `testnet.`, `dallas.testnet.` and `ny.testnet.`.
**Source:** jito-docs `:56-68`, for example `| 🇺🇸 **New York**       | \`https://ny.mainnet.block-engine.jito.wtf\` ...`
**Status:** VERIFIED from source.
**Implication:** Choose the region closest to the Divvy keeper. The rate limit applies per region.

### 1.9 Rate limits and auth
**Finding:**
- The default limit is **1 request per second per IP per region**. Going over returns 429.
- No auth key is needed for default sends.
- An optional UUID can be sent in the `x-jito-auth` header or as a `?uuid=` query parameter.
- Higher limits are requested through a Discord ticket.

**Source:**
- jito-docs `:637`: `1 request per second per IP per region.`
- jito-docs `:642`: `You no longer need an approved auth key for default sends.`
- jito-docs `:647`: `429 or rate limit error indicating what you hit.`
- jito-docs `:148-154`: `Header Field: Include the API key in the x-jito-auth header.` and `Example: api/v1/transactions?uuid=<uuid>`
- jito-docs `:656`: the Discord ticket link

**Status:** VERIFIED from source.
**Implication:** One `sendBundle` plus status polling at 1 rps is fine for an hourly job. Polling must be at least 1.1 s apart; `jito-bundle.ts` enforces that.

### 1.10 Privacy / mempool
**Finding:** Solana has no public mempool. Jito says it never explicitly leaks submitted bundles. However, if a bundle lands in an **uncled (skipped) block**, anyone who received that block can rebroadcast its transactions individually through the normal banking stage, without atomicity or revert protection. So bundles are private in normal operation, but this is not guaranteed.
**Source:**
- jito-docs `:3`: `... fast landing, MEV protection, and revert protection ...`
- jito-docs `:688`: `Those transactions will hit the normal banking stage which does not respect the bundle atomicity and reversion protection rules.`
- jito-docs `:696`: `if you send to Jito you are never going to be explicitly leaked by Jito. However, be aware that during uncled block situations you are exposed to this.`
- jito-docs `:533-535`: `jitodontfront` sandwich mitigation. Any bundle that includes a transaction referencing a `jitodontfront…` account is rejected unless that transaction is at index 0.

**Status:** VERIFIED from source, as a documentation claim.
**Implication:** Each transaction in a Divvy bundle must be safe if executed alone. The swap needs its own `minOut` (`otherAmountThreshold`), and distribution transactions should check balances first and after. Optionally add a `jitodontfront…` read-only account to the swap transaction and keep it at index 0.

### 1.11 gRPC searcher vs JSON-RPC
**Finding:** I found no deprecation notice for the gRPC searcher. The docs say both are supported. jito-ts (gRPC, `searcherClient(url, authKeypair?)`) is still maintained (v4.2.1, last commit 2025-09-10), and the auth keypair is optional. The "Getting Started" section of the docs only points to the JSON-RPC SDKs (`jito-py-rpc`, `jito-js-rpc`, `jito-rust-rpc`, `jito-go-rpc`).
**Source:**
- jito-docs `:21`: `- Submissions can be over gRPC or JSON-RPC`
- jito-docs `:481-511`: the SDK cards
- jito-ts `src/sdk/block-engine/searcher.ts:346-370`: `export const searcherClient = (url: string, authKeypair?: Keypair, ...)`

**Status:** VERIFIED from source, meaning no deprecation was found.
**Implication:** Use JSON-RPC with plain `fetch`. No gRPC or keypair auth is needed.

---

## 2. Jupiter swaps SOL → xStocks

### 2.1 Current API generation and base URL
**Finding:**
- The current Swap API is **Swap API V2** at `https://api.jup.ag/swap/v2`. It has two paths:
  - Meta-Aggregator: `GET /order` and `POST /execute`.
  - Router: `GET /build`, which returns raw Metis instructions.
- **Swap API V1 (`/swap/v1/quote`, `/swap/v1/swap`, `/swap/v1/swap-instructions`) is "no longer actively maintained and has been superseded by Swap V2."**
- Ultra (`/ultra/v1/order` and `/execute`) maps onto `/swap/v2/order` and `/execute`.
- `lite-api.jup.ag` is being phased out and is replaced by keyless access on `api.jup.ag`.

**Source:**
- jup-docs `swap/index.mdx:8`: `The Swap API is Jupiter's REST API for swapping tokens on Solana, served at \`https://api.jup.ag/swap/v2\`.`
- jup-docs `openapi-spec/swap/v2/swap.yaml:9-11`: `servers: - url: https://api.jup.ag/swap/v2`
- jup-docs `swap/v1/index.mdx:9-11`: `**Metis Swap API** is no longer actively maintained and has been superseded by [Swap V2](/swap).`
- jup-docs `swap/index.mdx:147`: `Swap API V1 (Metis) users on \`/quote\` and \`/swap\` move to \`/order\` for managed execution or to \`/build\` for raw instructions.`
- jup-docs `portal/migration.mdx:26`: `**Keyless access**: Replaces \`lite-api.jup.ag\` with keyless requests on \`api.jup.ag\` at 0.5 RPS`
- jup-docs `portal/migration.mdx:90`: `\`lite-api.jup.ag\` will be phased out once the new API gateway is stable.`

**Status:** VERIFIED from source (the docs repo).
**Implication:** Build on `/swap/v2`. Do not build new code on `/swap/v1` or `lite-api`.

### 2.2 API key and rate limits
**Finding:** A key is optional. Keyless requests get 0.5 RPS. With a key, sent in the `x-api-key` header, the plan limits are Free 1, Developer 10, Launch 50 and Pro 150 RPS. `/execute` has its own bucket. The hidden endpoints `/swap/v2/quote`, `/swap/v2/swap` and `/swap/v2/swap-instructions` **require** a key and return 404 on lite-api.
**Source:**
- jup-docs `swap/index.mdx:13`: `Quotes work without an API key, and one key covers every Jupiter API.`
- jup-docs `swap/index.mdx:48`: `Keyless requests are limited to 0.5 requests per second. For production, pass an API key in the \`x-api-key\` header.`
- jup-docs `swap/index.mdx:217`: `Keyless: 0.5 requests per second. Free API key: 1 RPS, Developer 10, Launch 50, Pro 150. \`/execute\` has its own bucket (Keyless 20, Free 50, paid plans 100 RPS)`
- jup-docs `swap/quote-and-swap.mdx:5`: `hidden: true`
- jup-docs `swap/quote-and-swap.mdx:14`: `All three endpoints require an API key passed via the \`x-api-key\` header.`
- jup-docs `swap/quote-and-swap.mdx:20`: `The \`lite-api.jup.ag\` host returns \`404\` for \`/swap/v2/{quote,swap,swap-instructions}\`.`

**Status:** VERIFIED from source. Whether `/build` works keyless is a NEEDS LIVE CHECK: the OpenAPI spec lists `security: ApiKeyAuth` at `swap.yaml:458-459`, while `swap/index.mdx:13` says quotes are keyless.
**Implication:** Get a free key (1 RPS). An hourly job is far below the limit.

### 2.3 Which path works with a Jito bundle
**Finding:** Only `/build` (Router, Metis-only) produces instructions you can put in your own transaction or Jito bundle, and it takes `forJitoBundle=true`. `/order` transactions are built for `/execute`. JupiterZ RFQ transactions cannot be modified, so they are landed by Jupiter. `/order` accepts a `jitoTipLamports` parameter, but that is used by Jupiter's own landing, not by your bundle.
**Source:**
- jup-docs `swap/index.mdx:213`: `Use \`/build\`. Its instructions are yours to assemble, sign and send however you want, and \`forJitoBundle=true\` excludes DEXes that are incompatible with Jito bundles. \`/order\` transactions are built for \`/execute\`...`
- jup-docs `openapi-spec/swap/v2/swap.yaml:556-563`: `name: forJitoBundle ... This excludes DEXes that are incompatible with Jito bundles.`
- jup-docs `swap.yaml:455`: `The \`/execute\` endpoint is not available for \`/build\` transactions.`
- jup-docs `swap.yaml:457`: `Routing is Metis only. No swap fees are charged by Jupiter.`
- jup-docs `swap.yaml:249-254`: the `jitoTipLamports` parameter on `/order`

**Status:** VERIFIED from source.
**Implication:** Divvy's bundled swap must call `GET /swap/v2/build?...&taker=<keeper>&forJitoBundle=true`. That excludes JupiterZ RFQ, which is where xStocks market makers can mint just-in-time (see 2.7), so Metis-only prices for xStocks may be worse. This needs a live check.

### 2.4 Parameters
**Finding:**
- `/build` takes `inputMint`, `outputMint`, `amount`, `taker` (required), `slippageBps` (number, or `"rtse"`; default 50), `mode=fast`, `dexes`/`excludeDexes`, `platformFeeBps` with `feeAccount`, `maxAccounts` (1-64), `payer`, `wrapAndUnwrapSol` (default true), `destinationTokenAccount`/`nativeDestinationAccount`, `blockhashSlotsToExpiry`, `tipAmount` (a Jupiter `/submit` tip, not Jito), `computeUnitPricePercentile`, `forJitoBundle` and `transactionVersion`.
- **None of these exist on `/build`: `restrictIntermediateTokens`, `onlyDirectRoutes`, `dynamicSlippage`, `prioritizationFeeLamports`, `asLegacyTransaction`, `swapMode`.** They exist only on the unmaintained V1. `/build` is ExactIn only.
- `/order` takes `slippageBps`, `priorityFeeLamports`, `jitoTipLamports`, `broadcastFeeType`, `excludeRouters`, `excludeDexes`, `receiver`, `payer`, `referralAccount`/`referralFee` and `maxSupportedTransactionVersion`.

**Source:**
- jup-docs `openapi-spec/swap/v2/swap.yaml:460-573` (the `/build` parameters), `:101-114` (`BuildSlippageBpsParameter`, `default: 50`, `enum: - rtse`), `:523-541` (`wrapAndUnwrapSol`, `destinationTokenAccount`)
- jup-docs `swap/migration/metis-to-build.mdx:26`: `| \`swapMode\` | - | Not supported. \`/build\` is ExactIn only. |`
- jup-docs `swap/migration/metis-to-build.mdx:20-33`: the full mapping table, which has no rows for `restrictIntermediateTokens`, `onlyDirectRoutes` or `dynamicSlippage`
- V1 only, jup-docs `openapi-spec/swap/v1/swap.yaml:687` (`name: restrictIntermediateTokens`), `:696` (`onlyDirectRoutes`), `:743` (`dynamicSlippage`, described as `No longer applicable`), `:399`/`:475` (`prioritizationFeeLamports`)
- jup-docs `swap.yaml:174-291` (the `/order` parameters)

**Status:** VERIFIED from source.
**Implication:** Replace `onlyDirectRoutes` and `restrictIntermediateTokens` with `dexes=` or `maxAccounts`. Replace `dynamicSlippage` with `slippageBps=rtse` or a fixed value. Replace `prioritizationFeeLamports` with `computeUnitPricePercentile`. In a Jito bundle the priority fee hardly matters (jito-docs `:601`). `/build` returns the CU **price** instruction but **not** the CU limit, so simulate and add `setComputeUnitLimit` yourself (jup-docs `swap/build/index.mdx:593`, `swap.yaml:604-608`).

### 2.5 Price impact field
**Finding:** The two paths report price impact differently.
- On **`/build`**, `priceImpactPct` is a string decimal ratio (`"0.001"` means 0.1%).
- On **`/order`**, `priceImpactPct` is **deprecated**. Use `priceImpact`, a number in **percentage points** (`-0.1` means -0.1%).

**Source:**
- jup-docs `openapi-spec/swap/v2/swap.yaml:597-599`: `priceImpactPct: type: string ... Price impact of the swap as a decimal ratio (e.g. "0.001" = 0.1%)`
- jup-docs `swap.yaml:315-317`: `priceImpact: type: number description: Price impact in percentage points (e.g. -0.1 = -0.1%).`
- jup-docs `swap.yaml:327-330`: `priceImpactPct: ... "Deprecated: decimal price impact ratio. Use priceImpact divided by 100 instead." deprecated: true`

**Status:** VERIFIED from source.
**Implication:** A Divvy price-impact guard must normalise these units. Treat `/build`.`priceImpactPct` as a fraction and `/order`.`priceImpact` as a percentage.

### 2.6 Token-2022 support
**Finding:** The `/order` docs say referral fees support "SPL and Token2022 tokens". The Tokens API returns `tokenProgram` for both programs. I found **no doc statement** that Metis (`/build`) routes into Token-2022 mints that carry **transfer-hook, pausable or permanent-delegate** extensions, which xStocks have (see 3.3). Jupiter's Trigger V2 explicitly excludes transfer-hook mints unless whitelisted. The Solana Foundation case study says xStocks are "tradable via Raydium/Jupiter".
**Source:**
- jup-docs `swap/order-and-execute.mdx:535`: `- Supports SPL and Token2022 tokens`
- jup-docs `openapi-spec/tokens/v2/tokens.yaml:318-320`: `tokenProgram: ... The token program address (SPL Token or Token-2022)`
- jup-docs `trigger/index.mdx:44`: `| **Token-2022** | Not supported | Supported, except transfer-fee or transfer-hook mints (unless whitelisted) |`
- solana-com `case-study-xstocks.mdx:27`: `tradable via Raydium/Jupiter`

**Status:** DOCS ONLY (indirect). Routing SOL → xStock through `/build` with `forJitoBundle=true` is a **NEEDS LIVE CHECK**. Run `jupiter-quote-xstock.ts --build --taker <pk> --simulate`.
**Implication:** This is the key go/no-go check for Divvy's swap leg.

### 2.7 xStocks liquidity on JupiterZ RFQ
**Finding:** Jupiter's RFQ market-maker API has a "permissioned tokens" list for tokens that a market maker mints or burns just-in-time, and names xStocks explicitly. RFQ is only available through `/order`.
**Source:**
- jup-docs `swap/routing/rfq/v1/webhook-api.mdx:46`: `It advertises tokens you cannot hold as ordinary inventory but mint or burn just-in-time alongside the fill, such as tokenised RWAs (Ondo, xStocks).`
- jup-docs `swap/index.mdx:79`: `JupiterZ (RFQ) is not available on the Router path.`

**Status:** VERIFIED from source, as a documentation claim.
**Implication:** Compare quotes from `/order` (which may win through `router=jupiterz`) and `/build` (Metis). If RFQ is much better, Divvy has to choose between atomic bundling (`/build`) and price (`/order` + `/execute`, landed by Jupiter outside your bundle).

### 2.8 Tokens API V2
**Finding:**
- The base URL is `https://api.jup.ag/tokens/v2`.
- `GET /search?query=<symbol|name|mint>` accepts up to 100 comma-separated mints and returns 20 results by default for symbol or name searches.
- `GET /tag?query=lst|verified|stocks` returns the whole list for that tag. The **`stocks`** tag means tokenised equities and includes **Ondo and Remora**, not only xStocks.
- Each token object has `id`, `symbol`, `decimals`, `tokenProgram`, `isVerified` and `tags`.
- The token object has **no field for Token-2022 extensions**.

**Source:**
- jup-docs `openapi-spec/tokens/v2/tokens.yaml:8`: `url: https://api.jup.ag/tokens/v2`
- jup-docs `tokens.yaml:12-29`: `/search` with `Limit to 100 mint addresses in query`
- jup-docs `tokens.yaml:106-123`: `/tag` with `enum: - lst - verified - stocks`
- jup-docs `tokens.yaml:469-476`: the `isVerified` and `tags` fields
- jup-docs `tokens/token-information.mdx:73-74`: `* Supported tags: \`lst\`, \`verified\`, \`stocks\`.` and `* \`stocks\` returns tokenized equities (e.g. Ondo, Remora).`
- The V1 Tokens API is deprecated: jup-docs `api-reference/tokens/v1/all.mdx:5`

**Status:** VERIFIED from source.
**Implication:** Never pick a mint by ticker. Ondo, Backpack and scam tokens share tickers. Keep a **whitelist of mints** (see 3.1) and use the Tokens API only to cross-check `isVerified`, `decimals` and `tokenProgram`.

### 2.9 Price API
**Finding:** Price API **V3** is `GET https://api.jup.ag/price/v3?ids=<comma-separated>`, with up to 50 IDs. It returns `usdPrice`, `liquidity`, `decimals`, `blockId` and `priceChange24h`. Price V2 is deprecated.
**Source:**
- jup-docs `openapi-spec/price/v3/price.yaml:8`: `url: https://api.jup.ag/price/v3`
- jup-docs `price.yaml:24`: `Get USD prices for up to 50 tokens per request.`
- jup-docs `price.yaml:28-34`: the `ids` parameter
- jup-docs `api-reference/price/v2/price.mdx:5`: `deprecated: true`

**Status:** VERIFIED from source. Whether the price is per raw unit or per UI (scaled) unit for xStocks is **NOT VERIFIED**.
**Implication:** Use V3 for dashboard values only. Confirm whether `usdPrice` applies the scaled-UI multiplier before computing USD values from raw amounts.

---

## 3. xStocks mints and token properties

### 3.1 Mint addresses (only the ones I can cite from two independent sources)
**Finding:** Both mints in the spec match. All 11 tickers below appear in **both** the Solana Foundation token registry (labelled `xStock`) and Trust Wallet's assets repo (name "... (xStock)"). Every Trust Wallet entry lists `decimals: 8` and the website `https://assets.backed.fi/products`.

| Symbol | Mint | sf-tokens `packages/asset-registry/src/data/…` | trustwallet `blockchains/solana/assets/<mint>/info.json` |
|---|---|---|---|
| NVDAx | `Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh` | `xstock-variant-groups.ts:842` (`label: 'xStock'`), `list-mints.ts:242` (`// NVIDIA`) | `"symbol": "NVDAX"`, `"decimals": 8` (lines 7-8) |
| SPYx | `XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W` | `etfs.ts:17` (under `// xStocks index tokens`, `{ name: 'SP500' }`), `list-mints.ts:139` | `"symbol": "SPYX"`, name `SP500 tokenized ETF (xStock)` |
| TSLAx | `XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB` | `xstock-variant-groups.ts:1176`, `list-mints.ts:271` | `TSLAX` |
| AAPLx | `XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp` | `xstock-variant-groups.ts:117`, `list-mints.ts:177` | `AAPLX` |
| QQQx | `Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ` | `etfs.ts:16` (`{ name: 'Nasdaq', coingeckoId: 'nasdaq-xstock' }`), `list-mints.ts:138` | `QQQX`, name `Nasdaq tokenized ETF (xStock)` |
| GOOGLx | `XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN` | `xstock-variant-groups.ts:55`, `list-mints.ts:172` | `GOOGLX` |
| AMZNx | `Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg` | `xstock-variant-groups.ts:63`, `list-mints.ts:173` | `AMZNX` |
| MSTRx | `XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ` | `xstock-variant-groups.ts:779`, `list-mints.ts:235` | `MSTRX` |
| COINx | `Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu` | `xstock-variant-groups.ts:346`, `list-mints.ts:198` | `COINX` |
| HOODx | `XsvNBAYkrDRNhA7wPHQfX3ZUXZyZLdnCQDfHZ56bzpg` | `xstock-variant-groups.ts:1015`, `list-mints.ts:255` | `HOODX` |
| CRCLx | `XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1` | `xstock-variant-groups.ts:312`, `list-mints.ts:194` | `CRCLX` |

**Source:** the files and lines listed in the table. Trust Wallet capitalises the symbol suffix (`NVDAX`, not `NVDAx`).
**Status:** VERIFIED from source for two independent third-party registries. **The issuer's own list was not reachable**:
- backed-tokenlist `update-tokenlist.js:6` names the official source, `const API_URL = 'https://api.xstocks.fi/api/v2/public/assets';`, but that host is blocked here and WebFetch could not resolve it.
- The Backed repo itself omits Solana. `update-tokenlist.js:35` says `// Solana (Xs8w8HvDjT1DxYeHzhSkRT8wYUahJB9kRC7Fuiic2Hf) is omitted: not in CHAIN_IDS.` That comment is about SHEINx and confirms Backed's Solana mints use the `Xs…` vanity prefix.

NEEDS LIVE CHECK: compare against `https://api.xstocks.fi/api/v2/public/assets` (deployments where `network` is Solana).
**Implication:** Hardcode this whitelist in Divvy config with the citations above, and re-check it against the issuer API before mainnet. **Ondo and Backpack Securities variants of the same stock exist with different mints.** For example, sf-tokens lists NVIDIA Ondo `gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo` at `xstock-variant-groups.ts:843` and MSTR Backpack `MSTRdWXMeZxdE8osAQy3fA4rvTY5rgummDSMEx6U7Nz` at `:781`. Those are **not** xStocks.

### 3.2 Decimals
**Finding:** On Solana, xStocks use 8 decimals according to Trust Wallet. Backed's EVM deployments use 18.
**Source:**
- trustwallet `.../Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh/info.json:8`: `"decimals": 8,`
- backed-tokenlist `update-tokenlist.js:8-9`: `// All xStocks EVM tokens use 18 decimals` and `const XSTOCKS_DECIMALS = 18;`

**Status:** VERIFIED from source for Trust Wallet. The on-chain value is a NEEDS LIVE CHECK (`fetch-xstocks.ts` with `RPC_URL`).
**Implication:** Read `decimals` from the mint on-chain and pass it to `transferChecked`. Never hardcode it.

### 3.3 Token-2022 and its extensions
**Finding:** According to the Solana Foundation's xStocks case study, every xStock is a Token Extensions (Token-2022) mint with these extensions:
- **Metadata Pointer**
- **Scaled UI Amount Config**: an issuer-set multiplier for dividends and splits. Dividends are reinvested through the multiplier.
- **Pausable Config**: the issuer can pause all interactions.
- **Permanent Delegate**: Backed can transfer or burn from any account.
- **Default Account State**: currently set to initialized, but it allows a future blocklist via sRFC-37.
- **Transfer Hook**: initialized, but disabled.
- **Confidential Balances**: initialized, but disabled.
- **Token Metadata**

**Source:** solana-com `case-study-xstocks.mdx`:
- `:165`: `Each xStock token utilizes the following Token Extensions:`
- `:168`: `**Scaled UI Amount Config** – Allows the issuer to provide a multiplier that is used to represent onchain corporate actions like stock dividends, splits, and reverse splits.`
- `:169`: `**Pausable Config** – Lets the issuer pause all interactions with the token ...`
- `:170`: `**Permanent Delegate** – Assigns an authority designated by the token issuer (in this case, Backed) with ongoing rights to transfer or burn tokens from any address ...`
- `:171`: `**Default Account State** – While currently set to have all token accounts start in an "initialized" state ...`
- `:172`: `**Transfer Hook** – ... Currently initialized, but disabled.`
- `:173`: `**Confidential Balances** – ... Currently initialized, but disabled.`
- `:159`: `In the current xStocks design, the dividends are automatically reinvested into token balances.`

Jupiter's own lend schema also refers to scaled-UI stocks: jup-docs `openapi-spec/lend/borrow.yaml:273-275`, `scaledUiConfig: ... Token-2022 scaled-UI-amount config. Present on scaled-UI tokens (e.g. tokenised stocks).`

**Status:** DOCS ONLY (an official Solana Foundation post published 2025-08-18, `:6`). The extensions on each mint are a **NEEDS LIVE CHECK** (`fetch-xstocks.ts` with `RPC_URL`).
**Implication for Divvy, enforced by Token-2022 code:**
- **Always use `TransferChecked`.** Plain `Transfer` fails with `MintRequiredForTransfer` on accounts that have the `TransferHookAccount` or `PausableAccount` extension. See token-2022 `program/src/processor.rs:440-447` (`// Transfer hook extension exists on the account, but no mint ... return Err(TokenError::MintRequiredForTransfer.into());`) and `:458-462` (`// Pausable extension exists on the account, but no mint ...`).
- **Pause means every distribution fails.** token-2022 `processor.rs:425-427`: `if let Ok(extension) = mint.get_extension::<PausableConfig>() { if extension.paused.into() { return Err(TokenError::MintPaused.into());`. The keeper must check `pausableConfig.paused` before building a bundle. If the mint is paused, skip the hour and carry the SOL forward.
- **Raw vs UI amounts.** RPC `uiAmount`/`uiAmountString` apply the multiplier (agave `account-decoder/src/parse_token.rs:141-145`: `} else if let Some((scaled_ui_amount_config, unix_timestamp)) = ... scaled_ui_amount_config.amount_to_ui_amount(amount, decimals, unix_timestamp);`). Jupiter `outAmount` and on-chain `amount` are raw. Divvy should do all pro-rata maths in **raw u64** and use the multiplier only for display. Holder-facing numbers must say whether they are scaled.
- **"Dividend" wording.** xStocks already reinvest the underlying stock's dividends through the multiplier. A Divvy "dividend" is a distribution of xStock tokens funded by trading fees, not a pass-through of the stock's dividend.
- **Issuer control risk.** The permanent delegate can seize or burn tokens from Divvy's treasury or from holders. Default Account State could be switched to frozen, after which new ATAs would start frozen and sends to first-time recipients would fail. The transfer hook could be enabled, after which transfers would need extra accounts.

### 3.4 Geographic and eligibility restrictions
**Finding:** xStocks are offered only to **non-U.S. persons**. Distributors (Kraken, STON.fi) also exclude U.S. persons, and some exclude more jurisdictions.
**Source:**
- solana-com `case-study-xstocks.mdx:27`: `available for non-U.S. persons to buy/hold like any SPL token`
- solana-com `:153`: `anyone with a wallet in allowed jurisdictions can buy, hold, and use`
- WebSearch snippet (DOCS ONLY) attributed to https://assets.backed.fi/onboarding and https://assets.backed.fi/products: "The securities have not been and will not be registered under the U.S. Securities Act of 1933 ... may be offered, sold or otherwise delivered at any time only to transferees that are Non-United States Persons."
- WebSearch snippet for https://support.kraken.com/articles/getting-started-with-xstocks: not available to "clients in the United States (U.S.) or U.S. Persons (as defined under Regulation S ...)".
- https://ston.fi/xstocks (snippet) lists the U.S., EU/EEA, UK, Canada, Australia and Belgium as restricted.

I could not read the full Backed terms of service.
**Status:** DOCS ONLY. The full issuer terms are **NOT VERIFIED** (hosts unreachable).
**Implication:** **This is a legal blocker to resolve before launch.** Divvy would push xStocks to every holder of a permissionless memecoin, including U.S. persons, which conflicts with Reg S transfer restrictions. Get legal review, and consider geofencing claims instead of pushing tokens. Also note that the permanent delegate (3.3) lets the issuer claw back tokens from ineligible holders.

---

## 4. Helius holder snapshot

### 4.1 DAS `getTokenAccounts`
**Finding:** The JSON-RPC method is `getTokenAccounts`, with these parameters: `mint` and/or `owner`, `page` (1-indexed), `limit`, `cursor`, `before`, `after`, and `options.showZeroBalance`. The response has `total`, `limit`, `page`, `cursor` and `token_accounts[]`, where each entry has `address`, `mint`, `owner`, `amount`, `delegated_amount`, `frozen`, `burnt` and **`token_extensions`**. The `token_extensions` field implies Token-2022 accounts are indexed. The SDK types `amount` as a JS `number`.
**Source:**
- helius-sdk `src/types/das.ts:643-662`: `export interface GetTokenAccountsRequest { mint?: string; owner?: string; page?: number; limit?: number; cursor?: string; before?: string; after?: string; options?: { showZeroBalance?: boolean; }; }`
- helius-sdk `das.ts:623-640`: `TokenAccounts { address, mint, owner, amount?: number, delegated_amount, frozen, burnt, token_extensions: any }`
- helius-sdk `das.ts:665-678`: the response type
- helius-sdk `src/rpc/methods/getTokenAccounts.ts:15`: `"getTokenAccounts",`
- helius-sdk `README.md:231`: `Get information about all token accounts for a specific mint or a specific owner.`
- The docs URL https://www.helius.dev/docs/api-reference/das/gettokenaccounts was seen only in WebSearch. The DAS overview snippet recommends a limit of 100-1,000 and says fungible tokens "include SPL Token and Token-2022".

**Status:** The parameters are VERIFIED from source (SDK types). Token-2022 coverage and the maximum `limit` (said to be 1000) are a **NEEDS LIVE CHECK**. The official cap was not found.
**Implication:**
- Snapshot with `{mint, limit: 1000, cursor}` and loop until no cursor is returned. Use `showZeroBalance: false`.
- `amount` is raw and not scaled-UI adjusted. If Divvy ever snapshots xStock balances, use raw values.
- For the memecoin, raw amounts above 2^53 would lose precision as a JS number. With 6 decimals and a 1B supply the maximum is 1e15, which is below 9.007e15, so it is safe. Still, parse the raw JSON with a BigInt-safe parser.
- Exclude pool vaults, LaunchLab vaults, burnt/incinerator accounts and frozen accounts from the snapshot.

### 4.2 `getProgramAccounts` fallback for Token-2022
**Finding:** In both Token and Token-2022, the token account layout is mint at offset 0 (32 bytes), owner at 32, and amount at 64 (u64 LE). The base length is 165 bytes. Token-2022 accounts **with extensions are longer than 165**: the AccountType byte sits at index 165, followed by TLV extensions. ATAs for Token-2022 always carry at least `ImmutableOwner`, and xStock accounts also carry `PausableAccount`, `TransferHookAccount` and others. So a **`dataSize: 165` filter misses them**. The correct query is `getProgramAccounts(TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb, { filters: [{ memcmp: { offset: 0, bytes: <mint> } }] })` with **no dataSize filter**. Optionally add `memcmp offset 165 == 0x02` (AccountType::Account) to exclude non-account data. That only works for extended accounts, so do not add it if base-length accounts are possible.
**Source:**
- token-2022 `interface/src/state.rs:102-108`: `pub struct Account { pub mint: Address, pub owner: Address, pub amount: u64, ...`
- token-2022 `state.rs:147`: `const LEN: usize = 165;`
- token-2022 `state.rs:151`: `array_refs![src, 32, 32, 8, 36, 1, 12, 8, 36];`
- token-2022 `interface/src/generic_token_account.rs:8-9`: `const SPL_TOKEN_ACCOUNT_MINT_OFFSET: usize = 0;` and `const SPL_TOKEN_ACCOUNT_OWNER_OFFSET: usize = 32;`
- token-2022 `interface/src/extension/mod.rs:311-314`: `const BASE_ACCOUNT_LENGTH: usize = Account::LEN;` ... `const BASE_ACCOUNT_AND_TYPE_LENGTH: usize = BASE_ACCOUNT_LENGTH + size_of::<AccountType>();`
- token-2022 `mod.rs:1056-1063`: `pub enum AccountType { Uninitialized, Mint, Account }`, which makes Account = 2
- token-2022 `interface/src/lib.rs:29`: `declare_id!("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");`
- Helius also offers `getProgramAccountsV2`, with cursor pagination and `changedSinceSlot`: helius-sdk `README.md:238`.

**Status:** VERIFIED from source.
**Implication:**
- If the Divvy memecoin is a **classic SPL** mint, `dataSize: 165` plus `memcmp@0` is correct for the Tokenkeg program.
- If the LaunchLab token is **Token-2022**, drop `dataSize`.
- Large holder sets: prefer `getProgramAccountsV2` with `changedSinceSlot`, or DAS.
- Holder-snapshot and xStock-distribution code should share one layout helper.

---

## Scripts (written, type-checked; **not run against any network**)

All files are in `packages/solana/scripts/phase0/`:
- `jupiter-quote-xstock.ts`: READ-ONLY.
  - Default call: `GET /swap/v2/order` with no taker, which returns a quote only. It prints router, outAmount, priceImpact (pct points) and the deprecated priceImpactPct, plus routePlan.
  - `--build --taker <pk>` calls `GET /swap/v2/build?...&forJitoBundle=true`, which returns priceImpactPct (decimal), routePlan and ALT count.
  - `--simulate` compiles an **unsigned** v0 transaction (adding a CU limit plus Jupiter's CU price, in the order from jup-docs `swap/build/index.mdx:443-451`) and calls `simulateTransaction({sigVerify:false, replaceRecentBlockhash:true})`.
  - Optional env vars: `JUP_API_KEY` and `RPC_URL`.
- `jito-bundle.ts`: a module plus CLI.
  - Module: `JitoClient` with `getTipAccounts`, `getBundleStatuses`, `getInflightBundleStatuses`, `pollBundle` (at least 1.1 s between polls) and `sendBundle`, which refuses to run without `approved: true`.
  - Offline `inspectBundle` checks: deserialises each transaction, confirms it is fully signed, and finds a tip transfer to a static-key tip account of at least 1000 lamports.
  - CLI `send` is a **dry run by default** that prints the exact JSON-RPC payload. It POSTs only with `--send` **and** `I_HAVE_OWNER_APPROVAL=yes`.
  - Smoke-tested offline. A throwaway-keypair transaction with a fake blockhash produced the dry-run payload, and `--send` without the env var printed "Refusing to send". No network was touched.
- `fetch-xstocks.ts`: READ-ONLY.
  - Starts from the cited whitelist (§3.1).
  - Jupiter `/tokens/v2/search?query=<mints>` checks `isVerified`, `decimals` and `tokenProgram`.
  - `--symbols` searches by ticker and flags look-alikes. `--tag` lists `stocks`-tagged tokens named "xStock".
  - With `RPC_URL` set, it reads `getParsedAccountInfo` and prints the owner program, decimals and extension list (`scaledUiAmountConfig.multiplier/newMultiplier/newMultiplierEffectiveTimestamp`, `pausableConfig.paused`, `permanentDelegate.delegate`, `transferHook.programId`, `defaultAccountState.accountState`). These field names were checked against agave `account-decoder-client-types/src/token.rs:96` (`tag = "extension", content = "state"`), `:124-125`, `:328-333` and `:337-340`.

**Type-check:** `tsc 5.6.3 --noEmit` with `strict` and `noUncheckedIndexedAccess`, against `@solana/web3.js@1.98.4` and `@types/node@22.10.2`, finished with exit 0. It passed both with and without the DOM lib. The scripts were copied into `a scratch type-check project` for the check.

---

## Contradictions with the spec

1. **Jupiter V1 endpoints are superseded.** `/swap/v1/quote`, `/swap/v1/swap` and `/swap/v1/swap-instructions` are "no longer actively maintained" (jup-docs `swap/v1/index.mdx:9-11`). Use `/swap/v2/build` for bundles (`/order` + `/execute` is managed landing and cannot be bundled). `lite-api.jup.ag` is being retired (`portal/migration.mdx:90`). The Ultra `/ultra/v1/order` endpoint maps to `/swap/v2/order`.
2. **Several spec parameters do not exist on `/build`:** `restrictIntermediateTokens`, `onlyDirectRoutes`, `dynamicSlippage` and `prioritizationFeeLamports`, and `/build` is ExactIn only. The replacements are `slippageBps` (number or `rtse`), `computeUnitPricePercentile`, `dexes`/`excludeDexes` and `maxAccounts`. `/build` does **not** include a CU-limit instruction.
3. **`priceImpactPct` is ambiguous.** It is deprecated on `/order`, where `priceImpact` in percentage points should be used. On `/build` it is a decimal ratio. A shared threshold is off by a factor of 100 if the units are mixed.
4. **The Jito default encoding is base58 (deprecated).** You must pass `{"encoding":"base64"}`. The older Jito spec (mev-protos `http.md:142`) says base64 is unsupported; that is outdated.
5. **Jito paths:** the docs use `/api/v1/getBundleStatuses`, `/api/v1/getTipAccounts` and `/api/v1/getInflightBundleStatuses`. Only `sendBundle` goes to `/api/v1/bundles`. The JS SDK sends everything to `/bundles`.
6. **Tip placement:** "tip in the last tx" is allowed (jito-ts does it), but the docs recommend putting the tip in the main transaction, never as a standalone tip transaction and never through an ALT.
7. **Bundles are not strictly private.** Uncled blocks can unbundle and rebroadcast transactions (jito-docs `:688-696`), so each transaction must be safe on its own.
8. **The Tokens API `verified` value is a tag, not a filter on `/search`.** `/tag?query=verified` returns all verified tokens. Stocks use `tag=stocks`, which includes Ondo and Remora. The token object has `isVerified` and no extension data.
9. **xStocks are Token-2022 with pausable, permanent-delegate, scaled-UI, default-account-state and (disabled) transfer-hook extensions.** Balances shown by wallets and RPC `uiAmount` are multiplied. Transfers must be `transferChecked`. The issuer can pause or seize. The spec's SPYx and NVDAx mints **match** the cited sources.
10. **A `dataSize: 165` filter is wrong for Token-2022 holder scans,** as the spec already suspected. It is confirmed by token-2022 `extension/mod.rs:311-314`.
11. **Jupiter's `tipAmount` parameter is not a Jito tip.** It pays Jupiter authorities for `/submit` (tx.jup.ag) and has a minimum of 1,000,000 lamports (jup-docs `swap/quote-and-swap.mdx:101`). Do not set it when bundling through Jito.

## Open questions

1. Does Jupiter Metis (`/build`, `forJitoBundle=true`) return SOL → xStock routes at Divvy's hourly size with acceptable price impact? Or is most xStock liquidity on JupiterZ RFQ, which is `/order` only? Run `jupiter-quote-xstock.ts` in both modes for NVDAx and SPYx at, for example, 0.1, 1 and 10 SOL.
2. What does each xStock mint actually carry on-chain: extensions, current multiplier, `paused` flag, `defaultAccountState`, transfer-hook program (expected `null`) and decimals (expected 8)? Run `fetch-xstocks.ts` with `RPC_URL`.
3. Is the issuer's list (`https://api.xstocks.fi/api/v2/public/assets`) consistent with the whitelist? It is not reachable from here.
4. Does the Jito server accept read methods on `/api/v1/bundles` as well as on the per-method paths? Do UUID holders get more than 1 rps?
5. What is the Helius `getTokenAccounts` maximum `limit` (1000?), and does it return complete Token-2022 coverage? Does DAS `token_extensions` expose `scaledUiAmountConfig`/`pausable`? The SDK `MintExtensions` type (`das.ts:252-264`) lists neither.
6. Is the Divvy memecoin (Raydium LaunchLab) an SPL or a Token-2022 mint? That decides the `getProgramAccounts` filter and whether `transferChecked` and extension handling apply on the memecoin side too.
7. **Legal:** can Divvy push xStocks to U.S. or other restricted holders at all? Can the issuer's permanent delegate claw back those distributions? This needs counsel and the full Backed terms of service, which were not reachable.
8. Does Jupiter Price V3 `usdPrice` for scaled-UI xStocks apply per raw unit or per scaled UI unit?
9. When a mint is paused (for example during corporate actions), should Divvy queue the hour's SOL and retry, or swap into another xStock?
