# LaunchLab / CPMM verification for Divvy (Phase 0)

Verified 2026-10-26. Each item has four parts: **Finding**, **Source** (repo@commit `path:line`, or a docs page), **Status**, and **Implication for Divvy**.

Status values:

- **VERIFIED (source)**: read directly in SDK, IDL or CPMM program source.
- **DOCS ONLY**: stated in Raydium's docs source. The LaunchLab and LP-Lock programs are closed source, so their on-chain checks cannot be read.
- **NEEDS ON-CHAIN CHECK**: run `scripts/read-launchlab-configs.ts`.
- **NOT VERIFIED**: no source found.

## Sources used

The shell cannot reach docs.raydium.io, any Solana RPC or api-v3, so none of them were used.

| Repo | Commit | Notes |
|---|---|---|
| `raydium-io/raydium-sdk-V2` | `b69d02b86a93ec2405a94968978a339567b86d71` | `package.json` says `0.2.75-alpha`. `npm view @raydium-io/raydium-sdk-v2` reports latest `0.2.75-alpha`, published 2026-10-26T06:56Z. `diff -rq` of the npm tarball's `src/` against git HEAD `src/` is clean, so every SDK citation below holds for npm `0.2.75-alpha`. |
| `raydium-io/raydium-idl` | `e7e0c96fe77bcf6a020b84a44c47a722aac8e359` | Dated 2026-05-18, so it is stale (see C-8). It predates the 2026-08/09 LaunchLab upgrades: it still has `requires_platform_auth` and `PlatformGlobalAccess`, and it has no `PlatformAllowConfig` or curve-rule instructions. |
| `raydium-io/raydium-docs-v1` | `36823847c22064f9ba0aa4d931f2a181fbbcd5a5` | Dated 2026-10-20. This is the MDX source of docs.raydium.io (pages `products/launchlab/*` and `reference/changelog/*`). It was found through GitHub code search and cited instead of the blocked site. |
| `raydium-io/raydium-docs` | `09d705ffc044430a6d6aa888f096f176df7077af` | Not the docs site. It holds audits plus `public/launchpad_creator_fee_upgrade/*`, the 2025 creator-fee and vault upgrade note. |
| `raydium-io/raydium-cp-swap` | `f4b9b26342afe9122d5ff67cd7a4f19ded4ac0a5` | CPMM program source, dated 2026-10-20. |
| `raydium-io/raydium-sdk-V2-demo` | `003d9045830033e5ef4178d6db129d83f93e1c7f` | Official usage examples, dated 2026-09-15. |

The clones were made locally for this check and are not committed; re-clone at the commits above to re-check any line.

The docs say the LaunchLab and LP-Lock source is "not publicly available": `reference/program-addresses.mdx:29,31,38`.

The docs changelog entries for 2026-08-17, 2026-08-26 and 2026-09-09 each carry this banner: "covers an upcoming LaunchLab program update … verified against the local release branch before deployment. Confirm the deployed program" (for example `reference/changelog/2026-08-26-launchlab-platform-fee-rate-cap.mdx:7`). Mainnet deployment of those releases is therefore **NEEDS ON-CHAIN CHECK**. The read script fetches the on-chain Anchor IDL and reports which markers from those releases it contains.

---

## 1. Create params: Token-2022 standard coin, no transfer fee, SOL quote

### 1a. Program IDs

**Finding**

| Program | Address | Defined at |
|---|---|---|
| LaunchLab (mainnet) | `LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj` | SDK constant `LAUNCHPAD_PROGRAM`, IDL `address`, docs program-addresses |
| CPMM | `CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C` | SDK constant `CREATE_CPMM_POOL_PROGRAM` |
| LP-Lock ("Burn & Earn") | `LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE` | SDK constant `LOCK_CPMM_PROGRAM` |
| LP-Lock CPMM authority | `3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH` | SDK constant `LOCK_CPMM_AUTH` |

**Source**

- raydium-sdk-V2@b69d02b `src/common/programId.ts:37`: `export const LAUNCHPAD_PROGRAM = new PublicKey("LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj");`
- raydium-sdk-V2@b69d02b `src/common/programId.ts:29`: `export const CREATE_CPMM_POOL_PROGRAM = new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");`
- raydium-sdk-V2@b69d02b `src/common/programId.ts:33` and `:35`: `LOCK_CPMM_PROGRAM` and `LOCK_CPMM_AUTH`.
- raydium-idl@e7e0c96 `raydium_launchpad/raydium_launchpad.json:2`: `"address": "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",`
- The same IDL pins CPMM at `:3426` and Lock at `:3631`, inside `migrate_to_cpswap`.
- raydium-cp-swap@f4b9b26 `programs/cp-swap/src/lib.rs:25`: `declare_id!("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C");`
- raydium-docs-v1 `reference/program-addresses.mdx:23,29,31`.

Other SDK constants:

- `LAUNCHPAD_AUTH = WLHv2UAZm6z4KyaaELi5pjdbJh6RESMva1Rnn8pJVVh` (`programId.ts:38`). I derived it offline: `PDA(["vault_auth_seed"])` matches.
- `LAUNCHPAD_PLATFORM = 4Bu96XjU84XjPDSpveTVf6LYGCkfW5FK7SNkREWcEfV4`, Raydium's own platform (`:43`).
- `LAUNCHPAD_CONFIG = 6s1xP3hpbAfFoNtUNF8mfHsjr2Bd97JxFJRWLbL6aHuX` (`:45`). I derived it offline: it is `PDA(["global_config", WSOL, curveType 0, index 0])`, which is the SOL constant-product GlobalConfig, index 0.

**Status:** VERIFIED (source).

**Implication for Divvy:** use the SDK constants. Do not hard-code these addresses.

### 1b. Which builder emits `initialize_with_token_2022`

**Finding**

The SDK instruction builder `initializeWithToken2022(...)` emits it. The high-level `raydium.launchpad.createLaunchpad()` **cannot** build a Token-2022 coin without a transfer fee. It overwrites the `token2022` flag:

```
token2022 = !!transferFeeExtensionParams;
```

As a result:

- Without `transferFeeExtensionParams`, it always builds `initializeV2`, which makes an SPL-Token base mint with Metaplex metadata.
- Passing `transferFeeExtensionParams` with 0 bps would give the mint a `TransferFeeConfig` extension. The HANDOFF forbids that extension.

`createLaunchpad` also calls the Raydium launch-config API (`fetchLaunchConfigs` → `https://launch-mint-v1.raydium.io/main/configs`).

**Source**

- raydium-sdk-V2@b69d02b `src/raydium/launchpad/launchpad.ts:206`: `token2022 = !!transferFeeExtensionParams;`
- The same file at `:348-390`: `token2022 ? initializeWithToken2022(...) : initializeV2(...)`
- `:238`: `const configs = await this.scope.api.fetchLaunchConfigs();`
- `src/api/api.ts:321-331`.
- Builder: `src/raydium/launchpad/instrument.ts:242` (`export function initializeWithToken2022(`).
- The discriminator `[37,190,126,222,44,154,171,17]` (`instrument.ts:23`) equals the IDL discriminator (`raydium_launchpad.json:2501-2509`) and `sha256("global:initialize_with_token_2022")[0..8]`. I checked this by script for all 21 SDK discriminators.

**Status:** VERIFIED (source).

**Implication for Divvy:** call `initializeWithToken2022()` directly. This is what `packages/solana/scripts/phase0/test-launch.ts` does. Do not use `createLaunchpad()` for Divvy coins.

### 1c. Exact parameters of `initializeWithToken2022`

**Finding:** the positional signature, from `instrument.ts:242-277`:

```ts
initializeWithToken2022(
  programId: PublicKey,
  payer: PublicKey, creator: PublicKey, configId: PublicKey, platformId: PublicKey,
  auth: PublicKey, poolId: PublicKey, mintA: PublicKey, mintB: PublicKey,
  vaultA: PublicKey, vaultB: PublicKey, mintProgramB: PublicKey,
  decimals: number, name: string, symbol: string, uri: string,
  curveParam: ({ type: "ConstantCurve"; totalSellA: BN } | { type: "FixedCurve" } | { type: "LinearCurve" })
              & { migrateType: "amm" | "cpmm"; supply: BN; totalFundRaisingB: BN },
  totalLockedAmount: BN, cliffPeriod: BN, unlockPeriod: BN,
  cpmmCreatorFeeOn: CpmmCreatorFeeOn,                                   // enum OnlyTokenB=0, BothToken=1 (type.ts:479-482)
  transferFeeExtensionParams?: { transferFeeBasePoints: number; maxinumFee: BN },  // sic "maxinumFee"
  platformAllowConfig?: PublicKey,   // remaining account, only if platform.restrictGlobalConfig = 1
  platformCurveRuleId?: PublicKey,   // remaining account, only if platform.restrictCurveParam = 1
): TransactionInstruction
```

The SDK encodes the data in this order (`instrument.ts:278-286` and `:330-349`):

1. `u8 decimals`, `str name`, `str symbol`, `str uri`
2. `u8 curveIndex(0)`, `u64 supply`, `u64 totalSellA`, `u64 totalFundRaisingB`, `u8 migrateType (cpmm=1)`
3. `u64 totalLockedAmount`, `u64 cliffPeriod`, `u64 unlockPeriod`, `u8 cpmmCreatorFeeOn`
4. `u8 option`, then `{u16 bps, u64 maxFee}`

The IDL argument order matches:

- `base_mint_param: MintParams{decimals,name,symbol,uri}`
- `curve_param: CurveParams::Constant{supply,total_base_sell,total_quote_fund_raising,migrate_type}`
- `vesting_param{total_locked_amount,cliff_period,unlock_period}`
- `amm_fee_on: AmmCreatorFeeOn`
- `transfer_fee_extension_param: Option<TransferFeeExtensionParams>`

**How to omit the transfer fee:** pass `transferFeeExtensionParams = undefined`. The SDK then writes option tag `0` (`instrument.ts:345`).

**Quirk:** the SDK still appends the 10-byte `{u16,u64}` zero struct after the `0` tag (`instrument.ts:346`). The result is 10 bytes longer than exact Borsh `Option::None`. I confirmed this offline: data is 125 bytes against 115 for exact Borsh. `packages/solana/scripts/phase0/test-launch.ts` trims those 10 bytes by default; set `KEEP_SDK_TRAILING_BYTES=1` to compare in simulation. `createLaunchpad` never takes this path, because it uses token2022 only when `transferFeeExtensionParams` is set.

**Source**

- raydium-sdk-V2@b69d02b `src/raydium/launchpad/instrument.ts:242-356`.
- raydium-idl@e7e0c96 `raydium_launchpad.json:2737-2779`, the args of `initialize_with_token_2022`. `transfer_fee_extension_param` is `{"option": {"defined": {"name": "TransferFeeExtensionParams"}}}` at `:2771-2778`.
- Types at `:5158` (MintParams), `:4839` (ConstantCurve), `:6066` (VestingParams), `:6044` (TransferFeeExtensionParams: `transfer_fee_basis_points u16` "cannot exceed 5%"; `maximum_fee u64`).

**Status:** VERIFIED (source). Whether the program accepts the SDK's 10 trailing bytes is NOT VERIFIED; simulation will tell. Exact Borsh is valid per the IDL.

**Implication for Divvy:** use these values:

| Parameter | Value |
|---|---|
| `decimals` | 6 |
| `curveParam.type` | `"ConstantCurve"` |
| `migrateType` | `"cpmm"` |
| `supply` | `1_000_000_000_000_000` |
| `totalSellA` | `793_100_000_000_000` |
| `totalFundRaisingB` | `85_000_000_000` |
| locked, cliff, unlock | `0`, `0`, `0` |
| `cpmmCreatorFeeOn` | `OnlyTokenB` (the SDK default, `launchpad.ts:194`) |
| `transferFeeExtensionParams` | `undefined` |

### 1d. Accounts, extra signers and "no dev buy"

**Finding**

The instruction has 15 accounts (`instrument.ts:297-314`):

`payer`(W,S), `creator`(none), `configId`, `platformId`, `auth`, `poolId`(W), `mintA`(W,S), `mintB`, `vaultA`(W), `vaultB`(W), `TOKEN_2022_PROGRAM_ID`, `mintProgramB`, `SystemProgram`, `event_authority PDA`, `programId`

The optional allow-config and curve-rule PDAs are appended after these (`:316-317`).

- **Signers:** the payer and the new mint keypair. I confirmed offline that the compiled message has `numRequiredSignatures = 2`: payer and mint, not the creator.
- **Initialize_with_token_2022 has no metadata account.** The IDL account list has no Metaplex accounts (`raydium_launchpad.json:2510-2736`). `initializeV2` does have one (`instrument.ts:199`).
- **PDAs:**
  - `poolId = PDA(["pool", mintA, mintB])` (`pda.ts:28`; IDL `:2569`)
  - `vault = PDA(["pool_vault", pool, mint])` (`pda.ts:32`)
  - `auth = PDA(["vault_auth_seed"])` (`pda.ts:15`)
- **High-level equivalents:** the mint keypair goes in `extraSigners` (`launchpad.ts:459`). `createOnly: true` skips the dev buy (`launchpad.ts:460`; `type.ts:41`), although `buyAmount` is still a required field (`type.ts:12`). Calling the builder directly adds no buy instruction at all. Since 2026-10-28 (owner decision) uspad adds the creator's optional dev buy after it, the way `createOnly: false` does (docs/VERIFIED.md item 29).
- **Client-side limits** (`launchpad.ts:235-236`): `symbol.length <= 10` and a non-empty `uri`. `Curve.checkParam` also requires `decimals === 6` (`curve/curve.ts:213`).

**Source:** as cited above, plus raydium-docs-v1 `products/launchlab/instructions.mdx:98-99`:

- "`payer` | W | S | Pays all rent. Need not be the creator."
- "`creator` | | | Recorded as `pool_state.creator`; not a signer."

**Status:** VERIFIED (source).

**Implication for Divvy:** the launcher wallet pays and signs, the server-held mint keypair signs, and the user's wallet goes in `creator`. No user signature is needed (see §3).

---

## 2. PlatformConfig / GlobalConfig fee fields, caps and fee math

### 2a. Layout field names

**Finding:** field names in the IDL and the SDK layout.

**GlobalConfig.** IDL names (`raydium_launchpad.json:4953-5090`):

- `epoch`, `curve_type`, `index`, `migrate_fee`
- `trade_fee_rate` (docs: "denominated in hundredths of a bip (10^-6)", `:4991-4994`)
- `max_share_fee_rate` (`:4998`)
- `min_base_supply`, `max_lock_rate`, `min_base_sell_rate`, `min_base_migrate_rate`, `min_quote_fund_raising`
- `quote_mint`, `protocol_fee_owner`, `migrate_fee_owner`, `migrate_to_amm_wallet`, `migrate_to_cpswap_wallet`
- `requires_platform_auth u8` (`:5075`), `padding_alignment [u8;7]`, `padding [u64;15]`

The SDK's `LaunchpadConfig` (`layout.ts:5-26`) renames them:

- `tradeFeeRate`, `maxShareFeeRate`, `minSupplyA`, `maxLockRate`, `minSellRateA`, `minMigrateRateA`, `minFundRaisingB`
- `mintB`, `protocolFeeOwner`, `migrateFeeOwner`, `migrateToAmmWallet`, `migrateToCpmmWallet`
- `seq(u64(),16)` as padding

The SDK layout therefore never decodes the `requires_platform_auth` byte, which sits at offset 243. Total span is 371 bytes.

**PlatformConfig.** IDL (`:5190-5340`):

- `epoch`, `platform_fee_wallet`, `platform_nft_wallet`
- `platform_scale`, `creator_scale`, `burn_scale`, `fee_rate`
- `name[64]`, `web[256]`, `img[256]`
- `cpswap_config`, `creator_fee_rate`, `transfer_fee_extension_auth`
- `platform_vesting_wallet`, `platform_vesting_scale`, `platform_cp_creator`
- `padding[108]`, `curve_params: Vec<PlatformCurveParam>`

That is the pre-2026-08-31 shape. The SDK's `PlatformConfig` (`layout.ts:106-136`) reflects the current one:

- `platformClaimFeeWallet`, `platformLockNftWallet`
- `platformScale`, `creatorScale`, `burnScale`, `feeRate`, `name`, `web`, `img`
- `cpConfigId`, `creatorFeeRate`, `transferFeeExtensionAuth`
- `platformVestingWallet`, `platformVestingScale`, `platformCpCreator`
- `restrictGlobalConfig u8`, `restrictCurveParam u8`, `curveRuleManager`, `seq(u8,78)`

Span is 944 bytes. The docs give the same 944-byte layout in Rust (`products/launchlab/platform-config.mdx:45-70`).

**Rate denominator:** 1_000_000.

- SDK: `src/common/fee.ts:2`: `export const FEE_RATE_DENOMINATOR_VALUE = new BN(1_000_000);`
- Docs: `platform-config.mdx:111`: "Both rates are denominated in `1/1_000_000`".

**Status:** VERIFIED (source) for the SDK and IDL. The current on-chain layout is NEEDS ON-CHAIN CHECK; the read script decodes it.

**Implication for Divvy:** decode with the SDK 0.2.75 layouts. Do not use the raydium-idl JSON for PlatformConfig or GlobalConfig.

### 2b. Caps

**Finding**

| Rate | Cap | Where enforced |
|---|---|---|
| `PlatformConfig.fee_rate` | **50 000** (500 bps, 5%) | Both `CreatePlatformConfig` (`PlatformParams::check()`, error `InvalidInput`) and `UpdatePlatformConfig::FeeRate/AllInfo` (`InvalidPlatformInfo`) |
| `PlatformConfig.creator_fee_rate` | **`MAX_CREATOR_FEE_RATE = 5000`** (50 bps) | Create and update |
| `GlobalConfig.max_share_fee_rate` | 10 000 (100 bps) | Bounds only the per-trade referral `share_fee_rate` argument |

Fee-rate cap history:

- Create was capped at 10 000 from the first release.
- Update was capped at 25 000 from 2026-01-27.
- Both have been 50 000 since 2026-08-26.

`max_share_fee_rate` **never bounded the platform fee**; the docs say this explicitly. The SDK has no client-side cap except `totalFeeRate <= 1_000_000` (`curve/curve.ts:513`).

**Source**

- raydium-docs-v1 `reference/changelog/2026-08-26-launchlab-platform-fee-rate-cap.mdx`:
  - `:18`: "**The platform fee ceiling is 500 bps on both paths.** `CreatePlatformConfig` and `UpdatePlatformConfig` both accept `fee_rate` up to `50000`."
  - `:22`: "`creator_fee_rate` is unchanged at `MAX_CREATOR_FEE_RATE = 5000` (50 bps)"
  - `:23`: "`GlobalConfig.max_share_fee_rate` is unchanged at `10_000` (100 bps), and never bounded the platform fee."
  - `:31-36`: the `require!` diffs.
- `products/launchlab/platform-config.mdx:42` (`MAX_CREATOR_FEE_RATE: u64 = 5000`) and `:113-122`.
- `products/launchlab/global-config.mdx:84`.

**Status:** DOCS ONLY. The program is closed source, and the docs entry says it was verified against a release branch before deployment, so whether 50 000 is live on mainnet is NEEDS ON-CHAIN CHECK. Divvy's target of 6000 is under the old 10 000 create cap anyway, so the deployment question does not affect Divvy.

**Implication for Divvy:** Divvy's 0.60% platform fee and 0.15% creator fee are within the caps on both old and new programs.

### 2c. Is the Raydium protocol fee inside or on top of the platform fee?

**Finding:** on top. The fees are additive.

```
totalFeeRate = protocolFeeRate(GlobalConfig.tradeFeeRate) + platformFeeRate(PlatformConfig.feeRate)
             + shareFeeRate(per-trade referral) + creatorFeeRate(PlatformConfig.creatorFeeRate)   // curve.ts:501-515
totalFee     = ceilDiv(amountIn_after_transfer_fee × totalFeeRate, 1_000_000)                     // curve.ts:272-273, 489-491
platformFee  = floor(totalFee × platformFeeRate / totalFeeRate)                                   // curve.ts:480
creatorFee   = floor(totalFee × creatorFeeRate  / totalFeeRate)                                   // curve.ts:482
shareFee     = floor(totalFee × shareFeeRate    / totalFeeRate)                                   // curve.ts:481
protocolFee  = totalFee − platformFee − shareFee − creatorFee                                     // curve.ts:484
amountIntoCurve (buy) = amountIn − totalFee                                                       // curve.ts:275
```

- **Buys:** the fee comes out of the SOL input.
- **Sells:** the fee comes out of the gross SOL output (`curve.ts:397-406`).
- `buyToken` passes `protocolFeeRate: configInfo.tradeFeeRate`, `platformFeeRate` and `creatorFeeRate: platformInfo.creatorFeeRate` (`launchpad.ts:673-684`).

The docs agree:

- `platform-config.mdx:15`: "an extra trade fee (`fee_rate`) on top of the protocol's `trade_fee_rate`".
- `:97-103`: three separate fees, each `amount_in × rate / 1_000_000`.
- `tips-and-gotchas/launchlab-cpmm-fee-reference.mdx:12-19`: "four additive fees".

**Worked example.** With `trade_fee_rate = 2500` (0.25%), `fee_rate = X` and `creator_fee_rate = Y`, a trader pays **0.25% + X + Y** of every curve trade, plus any referral `share_fee_rate`. Raydium keeps 0.25%, the platform vault gets X, and the creator vault gets Y.

Divvy's target split is reachable exactly:

- `fee_rate = 6000` (0.60%)
- `creator_fee_rate = 1500` (0.15%)
- total = 2500 + 6000 + 1500 = **10 000 = 1.00%**

The 0.60% platform fee is then split off-chain into 0.50% for holders and 0.10% for Divvy. I checked this offline with the SDK: for a 1 SOL buy, `Curve.splitFee` gives platform 6 000 000 lamports, protocol 2 500 000 and creator 1 500 000.

**Source:** raydium-sdk-V2@b69d02b `src/raydium/launchpad/curve/curve.ts:245-316, 466-515`; `launchpad.ts:671-684`; docs as quoted.

**Status:**

- The SDK math is VERIFIED (source).
- That the program uses the same rounding is DOCS ONLY. The docs formula computes each fee separately, so the rounding may differ by a lamport.
- The GlobalConfig `trade_fee_rate` actually being 2500 on the SOL config Divvy uses is NEEDS ON-CHAIN CHECK. No source pins it; a docs page uses "trade fee is 1%" only as an illustration (`platform-config.mdx:7`).

**Update 2026-10-27:** the owner raised Divvy's share to 0.35%: `fee_rate = 8500`, total 2500 + 8500 + 1500 = **12 500 = 1.25%** (VERIFIED item 28 for the update path).

**Implication for Divvy:** set `fee_rate = 1% − trade_fee_rate − creator_fee_rate`. Read `trade_fee_rate` from the chosen GlobalConfig before creating the PlatformConfig; `create-platform-config.ts` prints it. If `trade_fee_rate ≠ 2500`, the 1% total and 0.50% holder share need adjusting. Holders can still be kept as the largest slice.

### 2d. `requires_platform_auth`

**Finding**

The field exists in the May 2026 IDL as `GlobalConfig.requires_platform_auth u8`, together with the `create_platform_global_access` and `close_platform_global_access` instructions (owner `GThUX1…`, the Raydium admin).

The 2026-08-17 release **removed** it. Its byte went back to padding, and access control is now platform-side: `PlatformConfig.restrict_global_config` plus `PlatformAllowConfig` PDAs (`["platform_allow_config", platform_config, global_config]`), which the platform admin creates. The SDK has `createPlatformAllowConfig` (`launchpad.ts:2053`), `getPdaPlatformAllowConfig` (`pda.ts:86`) and `updateRestrictGlobalConfig` (`instrument.ts:975-978`).

**Source**

- raydium-idl@e7e0c96 `raydium_launchpad.json:5075`, `"name": "requires_platform_auth"`, and `:1616-1690` (`create_platform_global_access`).
- raydium-docs-v1 `reference/changelog/2026-08-17-launchlab-cpmm-only-platform-config.mdx`:
  - `:18`: "`PlatformConfig.restrict_global_config` and `PlatformAllowConfig` replace the global admin-managed `requires_platform_auth` / `PlatformGlobalAccess` model."
  - `:45`: "`GlobalConfig.requires_platform_auth` is removed and its byte returns to padding."
- `products/launchlab/global-config.mdx:122`.

**Status:** DOCS ONLY / NEEDS ON-CHAIN CHECK. The read script prints byte 243 of each GlobalConfig and checks the on-chain IDL for the `requires_platform_auth` and `restrict_global_config` markers.

**Implication for Divvy:** after the upgrade there is no need to contact Raydium for authorization. Leave `restrict_global_config = 0`, or set it to 1 and create an allow PDA for the SOL config.

### 2e. Other fee-relevant config facts

**Finding**

- **`creator_scale` must be 0.** The docs say: "**`creator_scale` must be exactly `0`** — the program asserts `require_eq!(creator_scale, 0)` on both `CreatePlatformConfig` and the `MigrateNftInfo` update path".
- **One PlatformConfig per admin wallet.** The PDA seed is `["platform_config", admin]` (`pda.ts:54`). The demo comment reads "every wallet only enable to create "1" platform config".
- **PlatformConfig updates are rate-limited by epoch.**
- **`platform_cp_creator` is not settable at create time.** `PlatformParams` has no such field (IDL `:5572-5620`). It is set afterwards with `updatePlatformConfig({type:"updatePlatformCpCreator"})` (`instrument.ts:971-974`).

**Source**

- `platform-config.mdx:72`.
- raydium-sdk-V2-demo@003d904 `src/launchpad/createPlatform.ts:10`.
- `products/launchlab/tips-and-gotchas/redistribute-creator-fees.mdx:44`: "**Epoch-limited updates.** Platform config updates are rate-limited by Solana epoch."

**Status:** DOCS ONLY for the `creator_scale` assert and the epoch limit. VERIFIED (source) for the PDA seed and the missing create-time field.

**Implication for Divvy:**

- Create with `platformScale = 1_000_000`, `creatorScale = 0`, `burnScale = 0`. Adjust burn if wanted.
- Plan the `platform_cp_creator` update as a second transaction, possibly in a later epoch.
- The SDK demo's `creatorScale: 500000` (`createPlatform.ts:32`) is stale.

---

## 3. Must the creator sign the create?

**Finding:** **No.**

- In `initialize_with_token_2022` and `initialize_v2`, `creator` has no `signer` or `writable` flag. Only `payer` (writable signer) and `base_mint` (signer) sign.
- The SDK builder marks `creator` with `isSigner: false`.
- `payer` is a separate account; the IDL describes it as "This can be any account with sufficient SOL".

**Where creator fees accrue:** in a per-creator, per-quote-mint vault.

- The vault is `PDA([creator, quote_mint])` under the LaunchLab program; its authority is `PDA(["creator_fee_vault_auth_seed"])`.
- Every trade passes it in `remaining_accounts`: `[share_fee_receiver?], system_program, platform_fee_vault, creator_fee_vault`.
- The vault is shared across **all** pools by that creator using that quote mint, on any platform.

**Claim path:** `claim_creator_fee`, with the `creator` as writable signer. The SDK method is `raydium.launchpad.claimCreatorFee({ mintB })`, which always claims for `scope.ownerPubKey`. Only the creator can claim.

**Source**

- raydium-idl@e7e0c96 `raydium_launchpad.json`:
  - `:2512-2519`: payer `"writable": true, "signer": true`, with the doc "This can be any account with sufficient SOL to cover the transaction".
  - `:2520-2522`: `{ "name": "creator" }`, with no flags.
  - `:2598` (`base_mint` signer); `initialize_v2` is the same at `:2206-2215`.
- raydium-sdk-V2@b69d02b `src/raydium/launchpad/instrument.ts:298-299`:

  ```
  { pubkey: payer, isSigner: true, isWritable: true },
  { pubkey: creator, isSigner: false, isWritable: false },
  ```

- Offline check: the compiled message of `packages/solana/scripts/phase0/test-launch.ts` has 2 required signers (payer and mint), and the creator is not among them.
- Creator vault:
  - SDK: `pda.ts:70-71` (`findProgramAddress([creator.toBuffer(), mintB.toBuffer()], programId)`), `pda.ts:10`, `launchpad.ts:739`, and `instrument.ts:411-413`.
  - IDL: `claim_creator_fee` `:392-560`, with creator `"writable": true, "signer": true` at `:412-418` and `creator_fee_vault` seeds `[creator, quote_mint]` at `:459`.
  - SDK claim: `launchpad.ts:1965-2008` and `instrument.ts:1028-1055`.
  - Docs: `instructions.mdx:98-99, 176-180, 419-436`; `accounts.mdx:178`.

**Status:** VERIFIED (source).

**Implication for Divvy:**

- Pick HANDOFF option **(a), without needing the user's signature at all**. Set `creator = user wallet`; the launcher pays and signs, and the mint keypair signs.
- Creator fees accrue on-chain to the user, and the user claims them by signing `claim_creator_fee`. Divvy cannot claim or forward them.
- The vault aggregates across all of that user's coins, so a per-coin creator-earned figure must come from indexed `TradeEvent.creator_fee` (IDL `:6013`), not from the vault balance.

---

## 4. How platform fees are claimed

**Finding:** two claim paths exist.

**1. `claim_platform_fee_from_vault`** (current path). It sweeps the **per-platform, per-quote-mint vault** `PDA([platform_config, quote_mint])`, whose authority is `PDA(["platform_fee_vault_auth_seed"])`. The signer is `platform_fee_wallet`, which must equal `platform_config.platform_fee_wallet`, and the recipient is that wallet's ATA.

- SDK: `raydium.launchpad.claimVaultPlatformFee({ platformId, mintB, claimFeeWallet })`, with a multi-platform variant `claimMultipleVaultPlatformFee`.
- **SDK gotcha:** the recipient is `this.scope.account.getAssociatedTokenAccount(...)` of the SDK owner (`launchpad.ts:1863`), while the IDL constrains the recipient to the ATA of `platform_fee_wallet`. Run it with `owner = platform_fee_wallet`.

**2. `claim_platform_fee`** (per-pool, legacy). It transfers `pool_state.platform_fee` out of that pool's `quote_vault` and zeroes the counter. The signer is again `platform_fee_wallet`.

- SDK: `raydium.launchpad.claimPlatformFee({ platformId, poolId, platformClaimFeeWallet })`, and `claimAllPlatformFee` (gPA filter `pool.platformFee > 0`).

**Where new fees go.** Every trade passes the platform fee vault in `remaining_accounts`. The 2025 upgrade note describes `claim_platform_fee` as the path for a `platform_fee saved PoolState is not 0`, meaning the per-pool counter is a legacy balance. The current docs say "`platform_fee` accrues to a per-platform vault". However, `instructions.mdx:549`, the state-change matrix, still shows `platform_fee += ∆` on buys, so the docs are not fully consistent.

**Source**

- IDL `claim_platform_fee_from_vault` `:732-910`:
  - signer `platform_fee_wallet` `:752-758`, "Only the wallet stored in platform_config can collect platform fees"
  - `platform_fee_vault` seeds `[platform_config, quote_mint]` `:806`
- IDL `claim_platform_fee` `:565-730` (signer `:585`; `pool_state` W `:624`).
- SDK:
  - `launchpad.ts:1846-1893` (`claimVaultPlatformFee`), `:1491-1572` (`claimPlatformFee`), `:1574-1652` (`claimAllPlatformFee`)
  - `instrument.ts:998-1026`, `:727-756`
  - `pda.ts:62-68`
  - buy remaining accounts `launchpad.ts:738-739` and `instrument.ts:411-413`
- raydium-docs@09d705f `public/launchpad_creator_fee_upgrade/raydium_launchpad_creator_fee_upgrade.md:5` ("Support platform fee claimed from `platform_fee_vault`"), `:141`, `:190`.
- raydium-docs-v1:
  - `platform-config.mdx:106, 228-229`
  - `accounts.mdx:24, 179`: "Every launch routed through the same platform that uses the same quote mint pours into the same vault."
  - `reference/changelog/2026-08-26-…mdx:61`: "accruing to the same per-platform vault".

**Status:**

- The instructions, signers and PDAs are VERIFIED (source).
- That **new** platform fees go only to the aggregated vault and that `PoolState.platform_fee` stays 0 is NEEDS ON-CHAIN CHECK. The read script prints a pool's `platformFee` counter next to the vault balance.

**Implication for Divvy (contradiction with HANDOFF):**

- Curve-phase platform fees are **not** held per pool. They pool into one Divvy vault per quote mint, so "claim the platform fee from the pool vault" (HANDOFF §3.3) is wrong.
- Claim the platform vault once per run with `claim_platform_fee_from_vault`.
- Attribute each coin's share exactly from on-chain `TradeEvent` data. `TradeEvent` carries `pool_state`, `platform_fee`, `creator_fee`, `protocol_fee` and `share_fee` (IDL `:5957-6030`).
- The exactness promise still holds, but it now depends on the indexer, not on a per-pool balance.
- Also sweep any legacy `PoolState.platform_fee` with `claim_platform_fee`.

---

## 5. After graduation: locked LP / Fee Key and CPMM creator fees

### 5a. LP split at `migrate_to_cpswap`

**Finding**

For migrations executed after the 2026-08-17 upgrade:

```
platform locked LP = floor(total LP × (platform_scale + creator_scale) / 1_000_000)
burned LP          = total LP − platform locked LP
```

If the locked share is non-zero, the LP-Lock program (`LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE`) wraps it into **one Fee Key NFT owned by `platform_nft_wallet`**. No creator Fee Key is minted any more; before the upgrade, `creator_scale` minted a separate Fee Key to the token creator.

- All new launches are CPMM-only: `migrate_type` must be 1, otherwise the program returns `MigrateTypeNotMatch`.
- `migrate_to_cpswap` is signed by `GlobalConfig.migrate_to_cpswap_wallet`, Raydium's crank.
- The CPMM reserves are `quote_vault − quote_protocol_fee − migrate_fee − platform_fee` and `base_vault − total_locked_amount`.
- The CPMM pool is created through CPMM `initialize_with_permission`.

**Source**

- raydium-docs-v1 `reference/changelog/2026-08-17-launchlab-cpmm-only-platform-config.mdx`:
  - `:14` (CPMM-only)
  - `:16`: "Migrations executed after the upgrade combine `platform_scale + creator_scale` into one platform-owned locked-LP share. `burn_scale` is burned."
  - `:33-34` (formula)
  - `:37`: "LaunchLab creates one Fee Key for `platform_nft_wallet` and does not create a new creator Fee Key."
- `products/launchlab/platform-config.mdx:144-153`.
- `products/launchlab/instructions.mdx:295-299, 320-331` (10 fixed remaining accounts).
- IDL (pre-upgrade shape) `migrate_to_cpswap` `:3377-3800`: payer "must match the migrate_to_cpswap_wallet" `:3396-3402`, `lock_program` `:3630-3631`.
- Lock program ID: SDK `programId.ts:33`.

**Status:** DOCS ONLY. The LaunchLab program is closed source and deployment of the 2026-08-17 release needs an on-chain check.

**Implication for Divvy:** set `platform_nft_wallet` to a Divvy fee-claim wallet. Every graduated Divvy coin then gives Divvy one Fee Key, which is per pool and therefore exactly attributable per coin.

### 5b. Harvesting fees from the locked position

**Finding**

- **SDK method:** `raydium.cpmm.harvestLockLp({ poolInfo, nftMint, lpFeeAmount, ... })`, with a batch variant `harvestMultiLockLp`.
- **Builder:** `collectCpFeeInstruction`, Lock-program discriminator `collectCpFee = [8,30,51,199,209,184,247,133]`, data `u64 lpFeeAmount`.
- **Signer:** the Fee Key owner (`nftOwner` `isSigner: true`).
- **Accounts:** lock PDA `PDA(["locked_liquidity", nftMint])` under the Lock program, and the NFT ATA.
- **`lpFeeAmount` has no on-chain formula in the SDK.**
  - The SDK reads it from the Raydium API: `fetchCpmmLockInfo` → `https://dynamic-ipfs.raydium.io/lock/cpmm/position`, field `positionInfo.unclaimedFee.lp`.
  - The official demo passes an arbitrary `new BN(99999999)`.
  - `harvestLockLp` derives the NFT ATA from `feePayer`, not from the owner (`cpmm.ts:979`). Keep `feePayer` equal to the Fee Key owner.
- **Harvested fees arrive in both tokens.** The CPMM trade fee is taken on the input side, so sells pay their fee in the memecoin.

**Source**

- raydium-sdk-V2@b69d02b `src/raydium/cpmm/cpmm.ts:910-1024` (`harvestLockLp`; `:979` ATA from feePayer; `:980` lock PDA).
- `src/raydium/cpmm/instruction.ts:32` (discriminator) and `:476-550` (builder; `:516` `{ pubkey: nftOwner, isSigner: true, isWritable: false }`).
- `src/raydium/cpmm/pda.ts:121-131` (`LOCK_LIQUIDITY_SEED = "locked_liquidity"`).
- `src/api/url.ts:75`; `src/api/type.ts:109-132`.
- raydium-sdk-V2-demo@003d904 `src/cpmm/harvestLockLiquidity.ts:24-31`.
- Docs: `user-flows/burn-and-earn.mdx:16-38`; `products/launchlab/creator-fees.mdx:46-51`.

**Status:**

- The SDK API is VERIFIED (source).
- The Lock program's semantics, including how much LP fee can be harvested, are NOT VERIFIED: the program is closed source and its IDL is not in raydium-idl.

**Implication for Divvy:**

- Post-graduation claims need the Fee Key owner's signature and an `lpFeeAmount` from Raydium's API, or a simulation-based probe.
- The dividend engine must handle the memecoin leg of harvested fees, for example by swapping it to SOL. This is not in the HANDOFF.

**Built (2026-10-26)** in `packages/solana/src/live/lplock.ts` and `apps/worker/src/payouts/poolfees.ts`:

- **Finding the Fee Key.** The fee claimer's SPL Token accounts holding exactly 1 token whose `["locked_liquidity", mint]` PDA exists under the lock program (the SDK's own test, `cpmm.ts:1723-1750`), and whose lock record contains the pool's 32-byte address. That last test is an ASSUMPTION about a closed layout, so Raydium's API must also return the same `poolInfo.id` before any harvest.
- **The API's `id` is the lock PDA**, not the NFT mint: raydium-docs-v1@3682384 `api-reference/openapi/dynamic-ipfs-v1.yaml` ("Locked CPMM position PDA public key"); the SDK's `fetchCpmmLockBalances` passes the PDA too. Devnet host `https://dynamic-ipfs-devnet.raydium.io` (same file, `servers`).
- **`unclaimedFee.lp` has no documented unit** ("Claimable LP amount", type number). The worker tries it as whole LP tokens (× 10^`lpDecimals`) and, if it is a whole number, as base units, drops any reading above a tenth of the locked LP, and simulates each before signing. The first reading that simulates cleanly and returns a positive amount is used.
- **User accounts:** the owner's ATAs for both pool mints (the SDK uses a temporary WSOL account; an ATA is assumed to be accepted, which the simulation checks).
- **Memecoin leg:** sold with CPMM `swap_base_input` in the coin's own pool (account order checked against cp-swap@f4b9b26 `instructions/swap_base_input.rs` `Swap`), at most 1% of the coin reserve per run.
- **Status:** NOT exercised on chain. `LOCKED_LP_FEES` stays off until a graduated coin's simulated harvest (logged every run) has been checked against Raydium's UI for that position.

### 5c. CPMM creator fee on LaunchLab-migrated pools

**Finding:** yes, the CPMM creator fee applies to LaunchLab-migrated pools.

- CPMM pools created through `initialize_with_permission`, the path LaunchLab migration uses, are initialized with `enable_creator_fee = true`. Ordinary `initialize` uses `false`.
- The rate is `AmmConfig.creator_fee_rate`, charged in addition to `trade_fee_rate`. With `enable_creator_fee = false`, `adjust_creator_fee_rate` returns 0.
- **Beneficiary (`pool_creator`):** `PlatformConfig.platform_cp_creator` if it is set; otherwise the original launch creator.
- **Collection paths:**
  - `collect_creator_fee`, signed by `pool_creator`.
  - `collect_creator_fee_permissionless`, where any payer can trigger it but funds go only to `pool_creator`'s canonical ATAs.
- **Protocol share of the creator fee.** Since the 2026-09-19 CPMM change, `AmmConfig.creator_fee_share_rate`, or a `CreatorFeeShare` PDA, takes a protocol share at collection time.
- **Which token.** LaunchLab `cpmmCreatorFeeOn = OnlyTokenB` (QuoteToken) puts the creator fee in SOL only.
- **SDK methods:** `raydium.cpmm.collectCreatorFees` and `collectCreatorFeesPermissionless`.

**Source**

- raydium-cp-swap@f4b9b26:
  - `programs/cp-swap/src/instructions/initialize_with_permission.rs:357-372`: `pool_state.initialize(..., creator_fee_on, true,);`
  - `initialize.rs:344-359` (`CreatorFeeOn::BothToken, false`)
  - `states/pool.rs:343-349` (`if self.enable_creator_fee { creator_fee_rate } else { 0 }`)
  - `states/config.rs:16, 28, 32` (`trade_fee_rate`, `creator_fee_rate`, `creator_fee_share_rate`)
  - `instructions/collect_creator_fee.rs:12-13` (`#[account(mut, address = pool_state.load()?.pool_creator)] pub creator: Signer<'info>`)
  - `collect_creator_fee_permissionless.rs:15, 19-20`
  - `curve/calculator.rs:108-111`
- SDK `cpmm.ts:1304, 1484`; `cpmm/instruction.ts:552-636`.
- Docs:
  - `products/launchlab/creator-fees.mdx:19-28`
  - `platform-config.mdx:239`
  - `tips-and-gotchas/redistribute-creator-fees.mdx:20-36`
  - `reference/changelog/2026-09-19-cpmm-creator-fee-protocol-share.mdx:12, 21`

**Status:**

- The CPMM side is VERIFIED (source).
- That LaunchLab migrations call `initialize_with_permission` and pass `platform_cp_creator` is DOCS ONLY (`instructions.mdx:297`, "CPMM InitializeWithPermission").
- The actual `creator_fee_rate` and `creator_fee_share_rate` on the chosen AmmConfig are NEEDS ON-CHAIN CHECK.

**Implication for Divvy:**

- To fund the dividend, creator and Divvy "in the same proportions" after graduation, set `platform_cp_creator` to a Divvy wallet. Divvy then collects CPMM creator fees for every pool and forwards the creator's share.
- If it is left at default, the user receives the CPMM creator fee directly.
- Either way, the post-graduation fee pool is much smaller than the curve-phase 1%. See C-4.

### 5d. "2026-08-17 upgrade"

**Finding:** this is the docs changelog entry "2026-08-17 — LaunchLab: CPMM-only launches and platform config controls". It moves creator locked LP to the platform Fee Key, makes new launches CPMM-only, and removes `requires_platform_auth`.

A separate entry, "2026-08-17 — CPMM: permissionless creator-fee collection", is a different program.

**Source:** `reference/changelog/2026-08-17-launchlab-cpmm-only-platform-config.mdx:2, 10-20`; `reference/changelog/2026-08-17-cpmm-permissionless-creator-fee-collection.mdx:2, 16-20`.

**Status:** DOCS ONLY. The entry itself says "verified … against local branch … not a mainnet-beta deployment" (`:85-88`).

**Implication for Divvy:** the HANDOFF's "Fee Key NFT goes to `platform_nft_wallet`" matches the docs. Confirm deployment with the read script's IDL check.

---

## 6. Curve supply and graduation numbers

**Finding**

**SDK constants (`LaunchpadPoolInitParam`).** These are Raydium SDK defaults, not just StonkFun's choice:

| Field | Raw value | Meaning |
|---|---|---|
| `supply` | `1_000_000_000_000_000` | 1B tokens at 6 decimals |
| `totalSellA` | `793_100_000_000_000` | 793.1M tokens |
| `totalFundRaisingB` | `85_000_000_000` | 85 SOL |
| `decimals` | 6 | |
| locked, cliff, unlock | 0 | |

The official demo labels these as the defaults. The high-level `createLaunchpad` actually takes its defaults from the API's `defaultParams` (`supplyInit`, `totalSellA`, `totalFundRaisingB`). The program has no defaults; the values are explicit instruction arguments.

**Migration reserve:**

```
supply − totalSellA − totalLockedAmount = 206.9M
```

**Limits.** These come from the chosen GlobalConfig and are checked client-side by `Curve.checkParam`:

- `decimals == 6`
- `supply >= minSupplyA × 10^decimals`
- `totalSell >= supply × minSellRateA / 1e6`
- `totalFundRaising >= minFundRaisingB`
- `migrateAmount >= supply × minMigrateRateA / 1e6`
- `locked <= supply × maxLockRate / 1e6`
- cpmm liquidity `sqrt(migrateA × fundRaising) > 100`

Docs defaults at config creation are a 30 SOL minimum raise, 20% sell, 20% migrate, 30% lock and a 10M minimum supply. A later changelog says the floors were "opened wide — 1 bps rates, 99999 supply bounds", so the live values are on-chain only.

**Curve formula (constant product with virtual reserves).** `getInitParam` solves the virtual reserves `a` (base) and `b` (quote) so that selling exactly `totalSell` raises `totalFundRaising` and ends at the migration price:

```
supplyMinusSellLocked = supply − totalSell − locked
tfMinusMf = totalFundRaising − migrateFee
x0 = (tfMinusMf·totalSell²/supplyMinusSellLocked) / (tfMinusMf·totalSell/supplyMinusSellLocked − totalFundRaising)
y0 = totalFundRaising² / (same denominator)
```

- Buy: `out = in·(virtualA − realA)/((virtualB + realB) + in)`.
- Price: `(virtualB + realB)/(virtualA − realA)`.
- The final price equals `(tf − mf)/(supply − totalSell − locked)`.
- Buys are capped at `totalSellA − realA`.

With 1B, 793.1M, 85 SOL and migrateFee 0, I computed offline with the SDK:

| Quantity | Value |
|---|---|
| `virtualA` | 1 073 025 605 596 382 |
| `virtualB` | 30 000 852 951 |
| Start price | ≈ 2.796e-8 SOL/token (FDV ≈ 28 SOL) |
| Graduation price | 85/206.9M ≈ 4.108e-7 SOL/token |
| **Graduation FDV** | **≈ 410.8 SOL** |

The "$48k" figure therefore holds only at SOL ≈ $117. The SDK's own `LaunchpadPoolInitParam.virtualA/B` (`launchpad.ts:110-111`) differ slightly, consistent with a non-zero migrate fee.

**Progress.** The HANDOFF formula `100 − (baseReserve − 206.9M)·100/793.1M` equals `realA·100/totalSellA` **only** when all of these hold:

- `baseReserve` is the base-vault balance in whole tokens
- supply is 1B and `totalSell` is 793.1M
- `totalLockedAmount` is 0

Proposed formula, from PoolState fields (SDK name / IDL name):

```
progressPct = realA (real_base) × 100 / totalSellA (total_base_sell)
```

- It reaches 100% exactly when the SDK stops selling (`remainingAmountA = totalSellA − realA`).
- `status` (0 Fund, 1 Migrate, 2 Trade) marks graduation.
- An alternative is quote-based, `realB / totalFundRaisingB`. It hits 100% at the same moment but is not linear in tokens sold.
- Raydium's demo uses a price-based "finishing rate", `(price − initPrice)/(endPrice − initPrice)`.

**Source**

- raydium-sdk-V2@b69d02b `src/raydium/launchpad/launchpad.ts:100-123`:

  ```
  supply: new BN(1_000_000_000_000_000),
  totalSellA: new BN(793_100_000_000_000),
  totalFundRaisingB: new BN(85_000_000_000),
  ...
  decimals: 6
  ```

  and `:241-244` (API `defaultParams`).
- `src/raydium/launchpad/curve/curve.ts:196-240` (`checkParam`) and `:281-296` (cap at remaining).
- `src/raydium/launchpad/curve/constantProductCurve.ts:32-44` (price), `:62-64` (end price), `:88-126` (`getInitParam`), `:128-140` and `:184-197` (swap).
- raydium-sdk-V2-demo@003d904 `src/launchpad/createMint.ts:60-62`: `// supply: new BN(1_000_000_000_000_000), // lauchpad mint supply amount, default: LaunchpadPoolInitParam.supply`.
- `src/launchpad/getFinishRate.ts:7-34`.
- raydium-docs-v1 `products/launchlab/global-config.mdx:129-134`; `reference/changelog/2026-08-31-launchlab-platform-curve-rules.mdx:12` (the floors "opened wide" sentence).
- IDL PoolState `:5700, 5738, 5759` (`status`, `total_base_sell`, `real_base`).

**Status:**

- The SDK defaults, formula and progress mapping are VERIFIED (source).
- The GlobalConfig limits are NEEDS ON-CHAIN CHECK.
- StonkFun's actual parameters are NEEDS ON-CHAIN CHECK; `read-launchlab-configs.ts --pool-of <stonkfun platform>` prints them.

**Implication for Divvy:**

- Use the SDK constants.
- Compute progress as `realA/totalSellA`.
- Drive "graduates at $X" from `graduation FDV (SOL) × live SOL price`, not from 85 SOL.

---

## 7. Checks against the HANDOFF spec

Each claim is listed with what the sources say.

**"Every curve trade pays a 1% fee… Raydium protocol 0.25% (on StonkFun's config it comes out of the 1%)"**

- The 1% total is achievable: 2500 + 6000 + 1500.
- The protocol fee is **additive to** the platform and creator fees (§2c). It is not deducted from the platform's fee.
- "Comes out of the 1%" is only true in the sense that StonkFun's platform rate plus Raydium's rate sums to 1%.
- StonkFun's rates are NEEDS ON-CHAIN CHECK.
- The 0.25% protocol rate itself is NEEDS ON-CHAIN CHECK; no source pins `trade_fee_rate = 2500`.

**"After graduation: the CPMM pool runs on the 0.25% tier … LP is locked and a Fee Key NFT goes to platform_nft_wallet (behaviour after the 2026-08-17 upgrade)"**

- The Fee Key part matches the docs (§5a), DOCS ONLY.
- The CPMM tier is whatever the PlatformConfig's `cpswap_config` points at. The docs list AmmConfig **index 0, `D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2`**, as the 0.25% tier (`reference/fee-comparison.mdx:17`; `reference/program-addresses.mdx:268`).
- LaunchLab-migrated CPMM pools also have `enable_creator_fee = true`, so traders may pay `trade_fee_rate + AmmConfig.creator_fee_rate`.

**"CPMM 0.25% fee config used at graduation `CRRS5ieQmBrZjWhcj99JuGrT5tyuWDaGAXLXLFjbAtjQ`"**

- I derived offline that this address is the CPMM `PDA(["amm_config", u16 BE 11])`, i.e. **CPMM AmmConfig index 11**. The CPMM seed is `index.to_be_bytes()` (`raydium-cp-swap programs/cp-swap/src/instructions/admin/create_config.rs:19-21`).
- It is **not** index 0, which the docs call the 0.25% tier.
- Its `trade_fee_rate` and `creator_fee_rate` are NEEDS ON-CHAIN CHECK. No source found states them; a web search for the address returned nothing.

**StonkFun configs: standard `4E876qZTE9FJMrBzgVtBrSrzz2TLivB5Y5QXPjB4gZL7`, reward `6BwHHDg3u1854jC8PDLXvR4spTcLNaoBxLJNGC4nTESt`**

- These appear in no repository source.
- Account type, fee rates, `cpConfigId`, `platform_cp_creator` and scales are all NEEDS ON-CHAIN CHECK. They are in the defaults of `read-launchlab-configs.ts`.

---

## Scripts (written, not executed: no RPC reachable here)

The scripts are in `packages/solana/scripts/phase0/`:

- **`read-launchlab-configs.ts`** (read-only). It:
  - checks the on-chain Anchor IDL for upgrade markers (`requires_platform_auth`, `restrict_global_config`, `create_platform_allow_config`, `create_platform_curve_rule`, `restrict_curve_param`, `collect_excess_lamports`)
  - decodes every GlobalConfig, including the former `requires_platform_auth` byte
  - decodes the StonkFun PlatformConfigs and their `cpConfigId` AmmConfigs, CRRS5… and D4FP…
  - decodes a pool given with `--pool`, or the most recently active pool of a config with `--pool-of`
  - for that pool, prints supply and curve fields, progress (both formulas), graduation FDV, the `PoolState.platformFee` counter, and the platform and creator vault balances
- **`create-platform-config.ts`.** It builds `createPlatformConfig()` (`instrument.ts:758`) with these defaults:
  - `fee_rate` 6000, `creator_fee_rate` 1500
  - scales 1e6/0/0
  - cp config D4FP… (index 0)

  It enforces the docs caps and `creator_scale = 0`, prints `trade_fee_rate` and the total trader fee, and refuses if the admin's PDA already exists. It simulates the transaction and sends only with `--send` **and** `I_HAVE_OWNER_APPROVAL=yes`. The keypair comes from `PLATFORM_ADMIN_KEYPAIR`; `PLATFORM_ADMIN_PUBKEY` is enough for an unsigned dry run.
- **`test-launch.ts`.** It builds a create-only `initializeWithToken2022()` (`instrument.ts:242`) with no transfer fee, SOL quote, cpmm, zero vesting and no buy:
  - payer = launcher, creator = `CREATOR` (not a signer), mint keypair generated locally
  - adds the allow and curve-rule PDAs when the platform's flags are on
  - runs `Curve.checkParam`, trims the 10 SDK padding bytes, adds a CU limit
  - signs with mint and launcher, writes base64 to `test-launch.tx.b64` and exports `buildTestLaunchTx()`
  - simulates with a throwaway mint; `--send` (with the same two guards) builds again with a fresh mint and a Jito tip inside the transaction and submits it **only** as a Jito bundle, never through an RPC (edited after review to honour CLAUDE.md rule 6)

**Type-check result**

- `tsc --noEmit` (TypeScript 5.6.3, `strict`, `skipLibCheck`) passes with **0 errors** for all three scripts. Dependencies: `@raydium-io/raydium-sdk-v2@0.2.75-alpha`, `@solana/web3.js@1.99.0`, `@solana/spl-token@0.4.15`, `bn.js@5.2.5`, `bs58@6.0.0`.
- The project is in `a scratch type-check project (not committed)`; the scripts were copied into its `src/`.
- With `skipLibCheck` off, the only error is inside the SDK's own `.d.ts` (missing `@types/big.js`).
- An offline smoke test (not committed) ran `buildTestLaunchTx` against a mocked connection. Results:
  - 2 required signers (launcher and mint); the creator is not a signer
  - 16 instruction accounts (15 plus the allow PDA)
  - data ends in Option tag `0`
  - the transaction serializes at 863 bytes
- No RPC, signing for chain, or sending happened.

---

## Contradictions with HANDOFF

- **C-1.** "fees accrue on-chain **per pool**" and "On the curve: claim the platform fee from the pool vault" (HANDOFF §2, §3.3) are not what the sources say.
  - Platform fees go to one **per-platform vault** `[platform_config, quote_mint]`, claimed with `claim_platform_fee_from_vault`.
  - Per-coin amounts must come from `TradeEvent.platform_fee` in the indexer.
  - Creator fees likewise go to a per-creator vault shared across all of that creator's coins.
- **C-2.** "Raydium protocol 0.25% … comes out of the 1%" is misleading. `trade_fee_rate` is **added** to `fee_rate + creator_fee_rate` (`curve.ts:512`). The platform must size `fee_rate` so the sum is 1%.
- **C-3.** "CPMM 0.25% fee config used at graduation `CRRS5…`": that address is CPMM AmmConfig **index 11**. The docs call **index 0 (`D4FPEru…BvC2`)** the 0.25% tier. CRRS5…'s actual rates are unverified.
- **C-4.** "After graduation: the CPMM pool runs on the 0.25% tier … fees fund the dividend, the creator and Divvy in the same proportions."
  - LaunchLab-migrated CPMM pools have the **CPMM creator fee enabled** (`initialize_with_permission.rs:371`). Its beneficiary is `platform_cp_creator`, or the user by default, not the Fee Key.
  - The Fee Key earns only the LP share of the trade fee: about 84% of 0.25% at index 0, scaled by the locked LP fraction.
  - Harvested LP fees arrive in **both** SOL and the memecoin.
- **C-5.** Creator signing (§3.1) is not an issue: the creator is **not a signer**. Pick option (a) with no user signature.
- **C-6.** "Some GlobalConfigs set `requires_platform_auth`, which may require contacting Raydium" (§4): this field was **removed** in the 2026-08-17 release (docs). It is replaced by platform-managed `restrict_global_config` and `PlatformAllowConfig`. Deployment is unconfirmed.
- **C-7.** "≈ $48k market cap" for an "85 SOL" graduation: graduation FDV is ≈ **410.8 SOL** (85 SOL × 1B / 206.9M). $48k holds only at SOL ≈ $117, so compute it live.
- **C-8.** "SDK … launchpad module (IDL under `src/raydium/launchpad/`)" (§4 table): the SDK contains **no IDL**. The IDL is in `raydium-io/raydium-idl`, and that copy (2026-05-18) predates the 2026-08/09 layout changes.
- **C-9.** The HANDOFF implies the SDK can build the Token-2022 create directly. The high-level `createLaunchpad` **cannot** build a Token-2022 coin without a transfer fee (`launchpad.ts:206`). Use the `initializeWithToken2022` builder.

## Open questions

All of these need an RPC (run `read-launchlab-configs.ts`) or Raydium's answer.

1. Are the 2026-08-17, 08-26, 08-31 and 09-09 LaunchLab releases deployed on mainnet? Check the on-chain IDL markers and GlobalConfig byte 243.
2. What is `trade_fee_rate` on the SOL constant-product GlobalConfig Divvy will use (`6s1xP3hp…` index 0, or another), and what are its `minFundRaisingB`, `minSellRateA`, `minMigrateRateA` and `migrateFee`?
3. What are StonkFun's actual `fee_rate`, `creator_fee_rate`, scales, `cpConfigId` and `platform_cp_creator` on `4E876…` and `6BwHH…`, and what curve parameters do its pools use?
4. What `trade_fee_rate`, `creator_fee_rate` and `creator_fee_share_rate` are on CPMM AmmConfigs index 11 (`CRRS5…`) and index 0 (`D4FP…`)? This decides Divvy's `cpConfigId`.
5. Does a new trade still increment `PoolState.platform_fee`, or only the platform vault? Compare a live pool's counter with the vault, or simulate a buy.
6. Does the program accept the SDK's 10 trailing zero bytes after `Option::None` in `initialize_with_token_2022`? `test-launch.ts` trims them by default; `KEEP_SDK_TRAILING_BYTES=1` compares.
7. How does the LP-Lock program compute harvestable `lpFeeAmount`? It is closed source; the SDK relies on the Raydium API `positionInfo.unclaimedFee.lp`. Is there an on-chain way, or should a capped probe be simulated?
8. What exactly is the epoch rate-limit on `update_platform_config`, i.e. can `platform_cp_creator` be set in the same epoch as creation?
9. Exact on-chain fee rounding: the SDK uses a single ceil on the total and a pro-rata split, while the docs show per-fee formulas. This matters only for lamport-level reconciliation against `TradeEvent`.
