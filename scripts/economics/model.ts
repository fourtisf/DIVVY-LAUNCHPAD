/**
 * Divvy payout-economics model (HANDOFF §3.2–3.4).
 *
 * Pure functions only: no I/O, no network, no dependencies. Money is modelled in USD floats and
 * on-chain constants in integer lamports/bytes. This is a planning model, not payout code; the
 * engine itself must keep using the bigint math in packages/shared/src/fees.ts.
 *
 * Every constant is tagged in SOURCES with one of:
 *   VERIFIED   read in program/SDK source at a pinned commit (file:line given)
 *   DOCS       stated in an official docs-source repo; program is closed source or value is on-chain
 *   DERIVED    computed here from VERIFIED/DOCS inputs
 *   ASSUMPTION a modelling choice; change it in Params and rerun
 *
 * Pinned commits used for the citations below (cloned for this model, not committed):
 *   anza-xyz/solana-sdk@abe5e77, anza-xyz/agave@918b264, solana-program/token-2022@3f85f9c,
 *   solana-program/associated-token-account@8efacd6, raydium-io/raydium-cp-swap@f4b9b26,
 *   raydium-io/raydium-docs-v1@3682384, raydium-io/raydium-sdk-V2@b69d02b (via docs/verified/launchlab.md),
 *   jito-labs/jito-docs@9b923b8 and jup-ag/docs@0066fde (via docs/verified/jito-jupiter-xstocks.md).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Verified on-chain constants
// ─────────────────────────────────────────────────────────────────────────────

export const LAMPORTS_PER_SOL = 1_000_000_000;

/** solana-sdk rent/src/lib.rs:86 `ACCOUNT_STORAGE_OVERHEAD: u64 = 128`. */
export const RENT_ACCOUNT_STORAGE_OVERHEAD = 128;
/**
 * solana-sdk rent/src/lib.rs:58 `DEFAULT_LAMPORTS_PER_BYTE: u64 = 6_960`, used with the SIMD-0194
 * threshold 1.0 (:65, Default at :88-97), so minimum_balance = (128 + len) × 6960 (:156-157).
 * This equals the older 3480 lamports/byte-year × 2 years. The live Rent sysvar is an on-chain value.
 */
export const RENT_DEFAULT_LAMPORTS_PER_BYTE = 6_960;

/** token-2022 interface/src/state.rs:147 `Account::LEN = 165`. */
export const TOKEN_ACCOUNT_BASE_LEN = 165;
/** token-2022 interface/src/extension/mod.rs:314 adds `size_of::<AccountType>()`; AccountType is repr(u8) (:1054). */
export const TOKEN_ACCOUNT_TYPE_LEN = 1;
/** token-2022 extension/mod.rs:138-141: TLV entry = ExtensionType (u16, :1069) + Length (U16, :100) + value. */
export const TLV_HEADER_LEN = 4;
/** token-2022 interface/src/state.rs:236 `Multisig::LEN = 355`; extension/mod.rs:128-133 pads that length by 2. */
export const MULTISIG_LEN = 355;

/**
 * Account-side extensions on a new xStock ATA, with their value sizes:
 * - ImmutableOwner: requested by the ATA program (associated-token-account program/src/processor.rs:117-121);
 *   unit struct, 0 bytes (token-2022 extension/immutable_owner.rs:11-13).
 * - TransferHookAccount: required by the mint's TransferHook (extension/mod.rs:1303);
 *   `{ transferring: Bool }` (transfer_hook/mod.rs:45-48), Bool = 1 byte (solana-sdk zero-copy/src/unaligned.rs:28).
 * - PausableAccount: required by the mint's Pausable (extension/mod.rs:1304); unit struct, 0 bytes (pausable/mod.rs:33-35).
 * ScaledUiAmount, PermanentDelegate, DefaultAccountState, MetadataPointer, ConfidentialTransferMint and
 * TokenMetadata add no account-side extension (extension/mod.rs:1296-1309 falls through to `&[]`).
 * Which extensions each xStock mint carries is DOCS ONLY (solana-com case-study-xstocks.mdx:165-173).
 */
export const XSTOCK_ATA_EXTENSION_VALUE_LENS: readonly number[] = [0, 1, 0];

/** solana-sdk fee-structure/src/lib.rs:125 `lamports_per_signature: 5000`; agave fee/src/lib.rs:42-55 multiplies by signature count. */
export const LAMPORTS_PER_SIGNATURE = 5_000;
/** agave compute-budget/src/compute_budget_limits.rs:17 `MICRO_LAMPORTS_PER_LAMPORT = 1_000_000`. */
export const MICRO_LAMPORTS_PER_LAMPORT = 1_000_000;
/** solana-sdk packet/src/lib.rs:42 `PACKET_DATA_SIZE = 1280 - 40 - 8` (= 1232). */
export const PACKET_DATA_SIZE = 1_232;
/** jito-docs lowlatencytxnsend.md:81 minimum tip 1000 lamports. */
export const JITO_MIN_TIP_LAMPORTS = 1_000;
/** jito-docs lowlatencytxnsend.md:25,178 max 5 transactions per bundle. */
export const JITO_MAX_TXS_PER_BUNDLE = 5;
/** jito-docs lowlatencytxnsend.md:637 1 request per second per IP per region. */
export const JITO_REQUESTS_PER_HOUR = 3_600;
/** jup-docs swap/index.mdx:217 keyless 0.5 RPS, free key 1 RPS. */
export const JUPITER_FREE_KEY_REQUESTS_PER_HOUR = 3_600;
export const JUPITER_KEYLESS_REQUESTS_PER_HOUR = 1_800;

/** Rates are in parts per 1_000_000 for LaunchLab (sdk common/fee.ts:2) and CPMM (cp-swap curve/fees.rs:3). */
export const FEE_RATE_DENOMINATOR = 1_000_000;

/** LaunchLab SDK defaults (sdk launchpad.ts:100-111; docs/verified/launchlab.md §6). Token amounts in whole tokens. */
export const CURVE_SUPPLY_TOKENS = 1_000_000_000;
export const CURVE_TOTAL_SELL_TOKENS = 793_100_000;
export const CURVE_FUND_RAISING_SOL = 85;

// ─────────────────────────────────────────────────────────────────────────────
// Parameters
// ─────────────────────────────────────────────────────────────────────────────

export type Phase = "curve" | "graduated";
export type Architecture = "perCoinPush" | "perCoinCredit" | "batchedPush" | "batchedCredit";
export const ARCHITECTURES: readonly Architecture[] = ["perCoinPush", "perCoinCredit", "batchedPush", "batchedCredit"];
export const ARCH_LABEL: Record<Architecture, string> = {
  perCoinPush: "(a) per-coin swap + push",
  perCoinCredit: "(b) per-coin swap + credit/claim",
  batchedPush: "(c) batched swap + push",
  batchedCredit: "(d) batched swap + credit/claim",
};

export interface Params {
  solUsd: number;

  // Curve fees, parts per 1e6 of trade size (docs/verified/launchlab.md §2c).
  curveProtocolRate: number; // GlobalConfig.trade_fee_rate (NEEDS ON-CHAIN CHECK)
  curvePlatformRate: number; // PlatformConfig.fee_rate
  curveCreatorRate: number; // PlatformConfig.creator_fee_rate
  /** Off-chain split weights of Divvy's pot (HANDOFF §3.2): holders 50, creator 15, Divvy 10 (bps of volume on the curve). */
  splitHoldersBps: number;
  splitCreatorBps: number;
  splitDivvyBps: number;

  // CPMM after graduation (AmmConfig index 0 per docs).
  cpmmTradeFeeRate: number;
  cpmmProtocolFeeRate: number; // share of the trade fee
  cpmmFundFeeRate: number; // share of the trade fee
  cpmmCreatorFeeRate: number; // share of volume, on top of the trade fee
  cpmmCreatorFeeShareRate: number; // protocol cut of the creator fee at collection
  /** True if PlatformConfig.platform_cp_creator is a Divvy wallet, so the CPMM creator fee joins the pot. */
  cpmmCreatorFeeToPot: boolean;
  /** Share of all LP tokens held by Divvy's Fee Key (platform_scale 1e6, burn 0, no outside LPs). */
  feeKeyLpShare: number;
  /** Share of harvested LP fees that arrives as the memecoin and must be sold to SOL. */
  memeLegShare: number;

  // Coin state.
  curveProgress: number; // 0..1 of total_base_sell sold, for curve-phase scenarios
  gradTurnoverPerDay: number; // 24h volume / market cap after graduation
  gradMinMcapOfGradFdv: number; // floor on post-graduation market cap, as a fraction of graduation FDV
  gradPoolSupplyShare: number; // share of supply sitting in the CPMM pool (excluded from holders)

  // Holders.
  holdersAt10kMcap: number;
  holdersMcapExponent: number;
  holderZipfAlpha: number;
  minHolderUsd: number;

  // Churn and ATA ownership.
  /** Share of the eligible set replaced per 1× daily turnover (24h volume / held value). */
  churnPerTurnover: number;
  /** Cap on daily replacement of the eligible set. */
  maxDailyChurnOfEligible: number;
  /** Push: share of new recipients that already own an ATA for the dividend asset. */
  pushAtaPreexistingShare: number;
  /** Credit: share of eligible holders that already own the ATA (they get auto-push). */
  creditAtaShare: number;

  // Product thresholds.
  minRoundUsd: number;
  autoPushMinUsd: number;

  // Network.
  lamportsPerSignature: number;
  rentLamportsPerByte: number;
  priorityMicroLamportsPerCu: number;
  jitoTipLamports: number;
  swapViaJito: boolean;
  swapCu: number;
  transferCheckedCu: number;
  ataCreateCu: number;
  harvestCu: number;
  harvestsPerTx: number;
  vaultClaimCu: number;
  claimSignatures: number;
  jitoPollsPerBundle: number;
  /** Off-chain cost of one holder-snapshot page (Helius DAS getTokenAccounts, 1000 accounts). */
  snapshotUsdPerCall: number;
  snapshotPageSize: number;

  // xStock swap market.
  xstockRouteFeeBps: number;
  xstockDepthUsd: number;
  /**
   * Swaps larger than this are split into chunks spaced out so the pool recovers between them.
   * 0 = auto: sqrt(fixed swap cost × depth), which minimises fixed cost + price impact per dollar.
   */
  maxSwapChunkUsd: number;

  // Batching.
  batchCoinsPerSwap: number; // single-coin scenarios only; the platform sim computes it

  // Platform.
  numAssets: number;
  infraUsdPerDay: number;
  volumeMedianUsd: number;
  volumeLogSigma: number;
  graduatedShareOfLive: number;
}

export const DEFAULT_PARAMS: Params = {
  solUsd: 150,

  curveProtocolRate: 2_500,
  curvePlatformRate: 6_000,
  curveCreatorRate: 1_500,
  splitHoldersBps: 50,
  splitCreatorBps: 15,
  splitDivvyBps: 10,

  cpmmTradeFeeRate: 2_500,
  cpmmProtocolFeeRate: 120_000,
  cpmmFundFeeRate: 40_000,
  cpmmCreatorFeeRate: 500,
  cpmmCreatorFeeShareRate: 0,
  cpmmCreatorFeeToPot: true,
  feeKeyLpShare: 1,
  memeLegShare: 0.5,

  curveProgress: 0.5,
  gradTurnoverPerDay: 1,
  gradMinMcapOfGradFdv: 0.5,
  gradPoolSupplyShare: 0.207,

  holdersAt10kMcap: 100,
  holdersMcapExponent: 0.75,
  holderZipfAlpha: 1.2,
  minHolderUsd: 10,

  churnPerTurnover: 0.5,
  maxDailyChurnOfEligible: 2,
  pushAtaPreexistingShare: 0.1,
  creditAtaShare: 0.1,

  minRoundUsd: 5,
  autoPushMinUsd: 1,

  lamportsPerSignature: LAMPORTS_PER_SIGNATURE,
  rentLamportsPerByte: RENT_DEFAULT_LAMPORTS_PER_BYTE,
  priorityMicroLamportsPerCu: 50_000,
  jitoTipLamports: 10_000,
  swapViaJito: true,
  swapCu: 300_000,
  transferCheckedCu: 6_000,
  ataCreateCu: 25_000,
  harvestCu: 150_000,
  harvestsPerTx: 2,
  vaultClaimCu: 80_000,
  claimSignatures: 2,
  jitoPollsPerBundle: 3,
  snapshotUsdPerCall: 0.0001,
  snapshotPageSize: 1_000,

  xstockRouteFeeBps: 30,
  xstockDepthUsd: 250_000,
  maxSwapChunkUsd: 0,

  batchCoinsPerSwap: 10,

  numAssets: 11,
  infraUsdPerDay: 10,
  volumeMedianUsd: 1_500,
  volumeLogSigma: 2,
  graduatedShareOfLive: 0.05,
};

export function withParams(over: Partial<Params> = {}): Params {
  return { ...DEFAULT_PARAMS, ...over };
}

// ─────────────────────────────────────────────────────────────────────────────
// Source table (rendered into results.md and docs/ECONOMICS.md)
// ─────────────────────────────────────────────────────────────────────────────

export type SourceStatus = "VERIFIED" | "DOCS" | "DERIVED" | "ASSUMPTION";
export interface SourceRow {
  item: string;
  value: string;
  status: SourceStatus;
  source: string;
}

export function sourceTable(p: Params = DEFAULT_PARAMS): SourceRow[] {
  const ataLen = token2022AccountLen(XSTOCK_ATA_EXTENSION_VALUE_LENS);
  const rent = rentExemptLamports(ataLen, p.rentLamportsPerByte);
  return [
    { item: "Curve fee: protocol / platform / creator", value: "0.25% / 0.60% / 0.15% (additive, 1.00% total)", status: "VERIFIED", source: "sdk curve.ts:466-515; docs/verified/launchlab.md §2c. trade_fee_rate = 2500 is NEEDS ON-CHAIN CHECK" },
    { item: "Divvy off-chain split of 0.60%", value: "0.50% holders / 0.10% Divvy", status: "DOCS", source: "HANDOFF §3.2; docs/VERIFIED.md row 4" },
    { item: "Curve: supply / sold / raise", value: "1B / 793.1M / 85 SOL", status: "VERIFIED", source: "sdk launchpad.ts:100-111" },
    { item: "Curve virtual reserves", value: `${(curveVirtualReserves().x0 / 1e6).toFixed(2)}M tokens / ${curveVirtualReserves().y0.toFixed(4)} SOL`, status: "DERIVED", source: "sdk constantProductCurve.ts:88-126 formula (docs/verified/launchlab.md §6)" },
    { item: "Graduation FDV", value: `${graduationFdvSol().toFixed(1)} SOL`, status: "DERIVED", source: "85 SOL × 1B / 206.9M (launchlab.md §6)" },
    { item: "Platform fees pool in one vault per quote mint", value: "1 claim per hour for all coins", status: "VERIFIED", source: "idl claim_platform_fee_from_vault :732-910; launchlab.md §4" },
    { item: "CPMM index 0 trade / protocol / fund / creator rate", value: "2500 / 120000 / 40000 / 500 (0.25%, 12% and 4% of the fee, 0.05%)", status: "DOCS", source: "raydium-docs-v1 reference/program-addresses.mdx:177-185, fee-comparison.mdx:17,38-39,181-188 (read 2026-09-09). NEEDS ON-CHAIN CHECK" },
    { item: "CPMM LP keeps trade fee − protocol − fund", value: "84% of 0.25% = 0.21% of volume", status: "VERIFIED", source: "cp-swap curve/calculator.rs:105-118, curve/fees.rs:30-54, states/pool.rs:225-246" },
    { item: "CPMM creator fee on migrated pools", value: "on (enable_creator_fee = true), paid to platform_cp_creator", status: "VERIFIED", source: "cp-swap initialize_with_permission.rs:357-372, states/pool.rs:343-349; launchlab.md §5c" },
    { item: "CPMM creator_fee_share_rate", value: `${p.cpmmCreatorFeeShareRate} (default 0 = creator keeps all)`, status: "DOCS", source: "raydium-docs-v1 reference/changelog/2026-09-19-cpmm-creator-fee-protocol-share.mdx:52. NEEDS ON-CHAIN CHECK" },
    { item: "Fee Key share of LP", value: `${p.feeKeyLpShare * 100}%`, status: "DOCS", source: "platform_scale 1e6, burn 0 → all LP locked to one Fee Key (changelog 2026-08-17 :33-34; launchlab.md §5a)" },
    { item: "Memecoin share of harvested LP fees", value: `${p.memeLegShare * 100}%`, status: "DERIVED", source: "LP withdrawal is pro-rata to reserves and a constant-product pool holds equal value on both sides; Lock program is closed source (launchlab.md §5b)" },
    { item: "Rent: (128 + bytes) × lamports_per_byte", value: `${p.rentLamportsPerByte} lamports/byte`, status: "VERIFIED", source: "solana-sdk rent/src/lib.rs:58,65,86,88-97,156-157. Live Rent sysvar is on-chain" },
    { item: "xStock ATA size", value: `${ataLen} bytes = 165 + 1 + (4+0 ImmutableOwner) + (4+1 TransferHookAccount) + (4+0 PausableAccount)`, status: "DERIVED", source: "token-2022 state.rs:147, extension/mod.rs:100,128-141,314,1069,1296-1309, account_len.rs:49-55; ATA processor.rs:117-121; xStock mint extensions are DOCS (case-study-xstocks.mdx:165-173)" },
    { item: "Rent for one new xStock ATA", value: `${rent.toLocaleString("en-US")} lamports (${(rent / LAMPORTS_PER_SOL).toFixed(8)} SOL)`, status: "DERIVED", source: "ATA program pays rent.minimum_balance(len) (associated-token-account program/src/tools/account.rs:27,58)" },
    { item: "Base fee per signature", value: `${p.lamportsPerSignature} lamports`, status: "VERIFIED", source: "solana-sdk fee-structure/src/lib.rs:125; agave fee/src/lib.rs:42-55" },
    { item: "Priority fee = ceil(CU limit × µlamports/CU / 1e6)", value: `${p.priorityMicroLamportsPerCu.toLocaleString("en-US")} µlamports/CU`, status: "ASSUMPTION", source: "formula VERIFIED agave compute-budget/src/compute_budget_limits.rs:17,61-68; the price is a market value" },
    { item: "Max transaction size", value: `${PACKET_DATA_SIZE} bytes`, status: "VERIFIED", source: "solana-sdk packet/src/lib.rs:42" },
    { item: "Jito tip per swap bundle", value: `${p.jitoTipLamports.toLocaleString("en-US")} lamports (min ${JITO_MIN_TIP_LAMPORTS})`, status: "ASSUMPTION", source: "minimum VERIFIED jito-docs lowlatencytxnsend.md:81; only the tip matters for bundles (:601)" },
    { item: "Jito / Jupiter rate limits", value: "Jito 1 req/s/IP/region; Jupiter free key 1 RPS, keyless 0.5 RPS", status: "VERIFIED", source: "jito-docs :637; jup-docs swap/index.mdx:217" },
    { item: "Jupiter fee on /swap/v2/build", value: "none", status: "VERIFIED", source: "jup-docs openapi-spec/swap/v2/swap.yaml:457" },
    { item: "SOL→xStock route fee", value: `${p.xstockRouteFeeBps} bps`, status: "ASSUMPTION", source: "DEX pool fees on the route; check with packages/solana/scripts/phase0/jupiter-quote-xstock.ts" },
    { item: "SOL→xStock depth (price impact = size / (depth + size))", value: `$${p.xstockDepthUsd.toLocaleString("en-US")}`, status: "ASSUMPTION", source: "needs live quotes at 0.1/1/10 SOL" },
    { item: "Largest single swap chunk", value: p.maxSwapChunkUsd > 0 ? `$${p.maxSwapChunkUsd}` : `auto: √(swap fixed cost × depth) = $${swapChunkUsd(p).toFixed(0)}`, status: p.maxSwapChunkUsd > 0 ? "ASSUMPTION" : "DERIVED", source: "per-dollar cost f/c + c/depth is lowest at c = √(f × depth); chunks are spaced so arbitrage restores the price (ASSUMPTION)" },
    { item: "CU: transferChecked / new ATA / swap / harvest / vault claim", value: `${p.transferCheckedCu} / ${p.ataCreateCu} / ${p.swapCu} / ${p.harvestCu} / ${p.vaultClaimCu}`, status: "ASSUMPTION", source: "p-ATA bench shows 5,494 CU for a new Token-2022 ATA (associated-token-account pinocchio/program/benches/compute_units.md:13); 25,000 is a conservative figure for the legacy ATA program" },
    { item: "Holder count", value: `${p.holdersAt10kMcap} × (mcap / $10k)^${p.holdersMcapExponent}`, status: "ASSUMPTION", source: "rough fit to typical pump.fun-style coins (~100 holders at $10k, ~400 at graduation, ~3,000 at $1M); replace with indexer data" },
    { item: "Holder balances", value: `Zipf, balance ∝ rank^-${p.holderZipfAlpha}`, status: "ASSUMPTION", source: "top-heavy power law: top 10 of 100 holders own ~68%" },
    { item: "New eligible wallets per day", value: `eligible × min(${p.maxDailyChurnOfEligible}, ${p.churnPerTurnover} × 24h volume / held value)`, status: "ASSUMPTION", source: "half of the turned-over value lands in wallets that are new to the asset and hold across a snapshot; drives push rent" },
    { item: "Share of recipients that already have the asset ATA", value: `push ${p.pushAtaPreexistingShare * 100}%, credit ${p.creditAtaShare * 100}%`, status: "ASSUMPTION", source: "few memecoin holders already hold xStocks; grows with repeat Divvy users" },
    { item: "Post-graduation market cap", value: `max(${p.gradMinMcapOfGradFdv} × graduation FDV, 24h volume / ${p.gradTurnoverPerDay})`, status: "ASSUMPTION", source: "daily turnover of ~1× market cap" },
    { item: "Curve scenarios sit at progress", value: `${p.curveProgress * 100}%`, status: "ASSUMPTION", source: "mid-curve; market cap on the curve is fixed by progress" },
    { item: "Platform volume distribution", value: `lognormal, median $${p.volumeMedianUsd.toLocaleString("en-US")}/day, σ = ${p.volumeLogSigma}; top ${p.graduatedShareOfLive * 100}% by volume graduated; ${p.numAssets} assets, Zipf popularity`, status: "ASSUMPTION", source: "long tail: most coins nearly dead, a few carry the platform" },
    { item: "Holder snapshot", value: `$${p.snapshotUsdPerCall} per page of ${p.snapshotPageSize} accounts, every hour a coin pays`, status: "ASSUMPTION", source: "page size per docs/verified/jito-jupiter-xstocks.md §4.1 (limit 1000 is NEEDS LIVE CHECK); price not verified" },
    { item: "Infra (VPS, RPC/Helius plan)", value: `$${p.infraUsdPerDay}/day`, status: "ASSUMPTION", source: "pricing not verified; platform totals only" },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// On-chain cost primitives
// ─────────────────────────────────────────────────────────────────────────────

/** Rent-exempt minimum for an account with `dataLen` bytes (solana-sdk rent/src/lib.rs:156-157). */
export function rentExemptLamports(dataLen: number, lamportsPerByte: number = RENT_DEFAULT_LAMPORTS_PER_BYTE): number {
  return (RENT_ACCOUNT_STORAGE_OVERHEAD + dataLen) * lamportsPerByte;
}

/** Token-2022 account length for the given account-extension value sizes (token-2022 account_len.rs:49-55). */
export function token2022AccountLen(extensionValueLens: readonly number[]): number {
  if (extensionValueLens.length === 0) return TOKEN_ACCOUNT_BASE_LEN;
  const tlv = extensionValueLens.reduce((a, v) => a + TLV_HEADER_LEN + v, 0);
  const len = TOKEN_ACCOUNT_BASE_LEN + TOKEN_ACCOUNT_TYPE_LEN + tlv;
  return len === MULTISIG_LEN ? len + 2 : len;
}

export function xstockAtaRentLamports(p: Params = DEFAULT_PARAMS): number {
  return rentExemptLamports(token2022AccountLen(XSTOCK_ATA_EXTENSION_VALUE_LENS), p.rentLamportsPerByte);
}

/** agave compute_budget_limits.rs:61-68: ceil(price × limit / 1e6). */
export function priorityFeeLamports(cuLimit: number, microLamportsPerCu: number): number {
  return Math.ceil((cuLimit * microLamportsPerCu) / MICRO_LAMPORTS_PER_LAMPORT);
}

export function txFeeLamports(signatures: number, cuLimit: number, p: Params): number {
  return signatures * p.lamportsPerSignature + priorityFeeLamports(cuLimit, p.priorityMicroLamportsPerCu);
}

/**
 * Size of a legacy transaction message with one signer, in bytes:
 * compact sig count + 64/sig + 3-byte header + compact key count + 32/key + 32 blockhash
 * + compact ix count + per ix (program idx + compact acct count + acct idxs + compact data len + data).
 * Instructions here are small, so every compact-u16 is 1 byte except the key count above 127.
 */
export function legacyTxBytes(keys: number, ixs: ReadonlyArray<{ accounts: number; data: number }>, signatures = 1): number {
  const compact = (n: number) => (n < 128 ? 1 : 2);
  let bytes = compact(signatures) + 64 * signatures + 3 + compact(keys) + 32 * keys + 32 + compact(ixs.length);
  for (const ix of ixs) bytes += 1 + compact(ix.accounts) + ix.accounts + compact(ix.data) + ix.data;
  return bytes;
}

/** Compute-budget ixs: SetComputeUnitLimit (u8 + u32) and SetComputeUnitPrice (u8 + u64), no accounts. */
const COMPUTE_BUDGET_IXS = [
  { accounts: 0, data: 5 },
  { accounts: 0, data: 9 },
];
/** Token-2022 TransferChecked: [source, mint, destination, authority], data = u8 tag + u64 amount + u8 decimals. */
const TRANSFER_CHECKED_IX = { accounts: 4, data: 10 };
/** ATA CreateIdempotent: [funder, ata, wallet, mint, system program, token program], data = u8 tag. */
const ATA_CREATE_IX = { accounts: 6, data: 1 };

/**
 * How many recipients fit in one payout transaction. Base keys: vault owner (signer, fee payer),
 * source vault, mint, Token-2022 program, ComputeBudget program. Each recipient adds its ATA key;
 * with ATA creation it also adds its wallet key, and the tx adds System and ATA program keys.
 */
export function recipientsPerTx(withAtaCreate: boolean): number {
  let n = 0;
  for (;;) {
    const next = n + 1;
    const keys = 5 + next + (withAtaCreate ? 2 + next : 0);
    const ixs = [...COMPUTE_BUDGET_IXS];
    for (let i = 0; i < next; i++) {
      if (withAtaCreate) ixs.push(ATA_CREATE_IX);
      ixs.push(TRANSFER_CHECKED_IX);
    }
    if (legacyTxBytes(keys, ixs) > PACKET_DATA_SIZE) return n;
    n = next;
  }
}

export interface UnitCosts {
  rentLamports: number;
  /** Network cost of one transfer to an existing ATA, amortised over a full tx. */
  transferLamports: number;
  /** Network cost of one transfer that also creates the ATA (rent excluded), amortised. */
  transferWithAtaLamports: number;
  /** One swap tx: signature + tip (bundled) or priority fee. */
  swapLamports: number;
  /** One post-graduation harvest (LP-lock collectCpFee + creator-fee collect), amortised. */
  harvestLamports: number;
  /** One claim_platform_fee_from_vault per hour for the whole platform. */
  vaultClaimLamports: number;
  /** What a holder pays to claim for the first time (rent + signatures + priority). */
  holderFirstClaimLamports: number;
  perTxPlain: number;
  perTxWithAta: number;
}

export function unitCosts(p: Params): UnitCosts {
  const perTxPlain = recipientsPerTx(false);
  const perTxWithAta = recipientsPerTx(true);
  const sig = p.lamportsPerSignature;
  const prio = (cu: number) => (cu * p.priorityMicroLamportsPerCu) / MICRO_LAMPORTS_PER_LAMPORT;
  const rent = xstockAtaRentLamports(p);
  return {
    rentLamports: rent,
    transferLamports: sig / perTxPlain + prio(p.transferCheckedCu),
    transferWithAtaLamports: sig / perTxWithAta + prio(p.transferCheckedCu + p.ataCreateCu),
    swapLamports: sig + (p.swapViaJito ? p.jitoTipLamports : priorityFeeLamports(p.swapCu, p.priorityMicroLamportsPerCu)),
    harvestLamports: sig / p.harvestsPerTx + prio(p.harvestCu),
    vaultClaimLamports: txFeeLamports(1, p.vaultClaimCu, p),
    holderFirstClaimLamports: rent + txFeeLamports(p.claimSignatures, p.transferCheckedCu + p.ataCreateCu, p),
    perTxPlain,
    perTxWithAta,
  };
}

export function lamportsToUsd(lamports: number, solUsd: number): number {
  return (lamports / LAMPORTS_PER_SOL) * solUsd;
}

// ─────────────────────────────────────────────────────────────────────────────
// Curve and market state
// ─────────────────────────────────────────────────────────────────────────────

/** Virtual reserves (whole tokens, SOL) from sdk constantProductCurve.ts:88-126 with migrateFee 0. */
export function curveVirtualReserves(): { x0: number; y0: number } {
  const sell = CURVE_TOTAL_SELL_TOKENS;
  const migrate = CURVE_SUPPLY_TOKENS - CURVE_TOTAL_SELL_TOKENS;
  const tf = CURVE_FUND_RAISING_SOL;
  const denom = (tf * sell) / migrate - tf;
  return { x0: (tf * sell * sell) / migrate / denom, y0: (tf * tf) / denom };
}

/** Spot price (SOL per token) after `sold` tokens: x0·y0 / (x0 − sold)². */
export function curvePriceSol(sold: number): number {
  const { x0, y0 } = curveVirtualReserves();
  return (x0 * y0) / ((x0 - sold) * (x0 - sold));
}

export function graduationFdvSol(): number {
  return curvePriceSol(CURVE_TOTAL_SELL_TOKENS) * CURVE_SUPPLY_TOKENS;
}

export interface MarketState {
  mcapUsd: number;
  /** USD value held by non-excluded wallets (pool and curve vaults excluded). */
  heldUsd: number;
  /** SOL-side value of the CPMM pool, used for the memecoin-leg sell (graduated only). */
  poolQuoteUsd: number;
}

export function marketState(phase: Phase, volume24hUsd: number, p: Params): MarketState {
  if (phase === "curve") {
    const sold = p.curveProgress * CURVE_TOTAL_SELL_TOKENS;
    const price = curvePriceSol(sold);
    return { mcapUsd: price * CURVE_SUPPLY_TOKENS * p.solUsd, heldUsd: sold * price * p.solUsd, poolQuoteUsd: 0 };
  }
  const gradFdvUsd = graduationFdvSol() * p.solUsd;
  const mcapUsd = Math.max(p.gradMinMcapOfGradFdv * gradFdvUsd, volume24hUsd / p.gradTurnoverPerDay);
  return { mcapUsd, heldUsd: mcapUsd * (1 - p.gradPoolSupplyShare), poolQuoteUsd: mcapUsd * p.gradPoolSupplyShare };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fees
// ─────────────────────────────────────────────────────────────────────────────

export interface FeeBuckets {
  /** Everything the traders paid, per day. */
  traderPaidUsd: number;
  /** Raydium protocol + fund, plus the CPMM creator fee if it bypasses Divvy. */
  raydiumUsd: number;
  /** What reaches Divvy's wallets before the off-chain split. */
  potUsd: number;
  /** Market cost of selling the memecoin leg (graduated), taken off the pot. */
  memeLegCostUsd: number;
  /** Size of the memecoin leg, per day. */
  memeLegUsd: number;
  holdersUsd: number;
  creatorUsd: number;
  divvyUsd: number;
  /** Creator fee paid on-chain directly to the creator (curve, or CPMM creator fee if not routed to Divvy). */
  creatorDirectUsd: number;
}

/** Per-day fee buckets for one coin. `memeLegSellSizeUsd` is the size of each sell (for price impact). */
export function feeBuckets(phase: Phase, volume24hUsd: number, p: Params, memeLegSellSizeUsd = 0, poolQuoteUsd = 0): FeeBuckets {
  const D = FEE_RATE_DENOMINATOR;
  const splitTotal = p.splitHoldersBps + p.splitCreatorBps + p.splitDivvyBps;
  if (phase === "curve") {
    const protocol = (volume24hUsd * p.curveProtocolRate) / D;
    const pot = (volume24hUsd * p.curvePlatformRate) / D;
    const creator = (volume24hUsd * p.curveCreatorRate) / D;
    // On the curve the creator is paid on-chain; the platform pot splits holders : Divvy only.
    const hd = p.splitHoldersBps + p.splitDivvyBps;
    return {
      traderPaidUsd: protocol + pot + creator,
      raydiumUsd: protocol,
      potUsd: pot,
      memeLegCostUsd: 0,
      memeLegUsd: 0,
      holdersUsd: (pot * p.splitHoldersBps) / hd,
      creatorUsd: 0,
      divvyUsd: (pot * p.splitDivvyBps) / hd,
      creatorDirectUsd: creator,
    };
  }
  const tradeFee = (volume24hUsd * p.cpmmTradeFeeRate) / D;
  const protocolFund = (tradeFee * (p.cpmmProtocolFeeRate + p.cpmmFundFeeRate)) / D;
  const lpFee = tradeFee - protocolFund;
  const lpToFeeKey = lpFee * p.feeKeyLpShare;
  const creatorFeeGross = (volume24hUsd * p.cpmmCreatorFeeRate) / D;
  const creatorFeeNet = (creatorFeeGross * (D - p.cpmmCreatorFeeShareRate)) / D;
  const creatorToPot = p.cpmmCreatorFeeToPot ? creatorFeeNet : 0;
  const memeLeg = lpToFeeKey * p.memeLegShare;
  // Selling the memecoin leg pays the CPMM trade + creator fee and price impact in its own pool.
  const sellFee = (p.cpmmTradeFeeRate + p.cpmmCreatorFeeRate) / D;
  const impact = poolQuoteUsd > 0 ? priceImpact(memeLegSellSizeUsd, poolQuoteUsd) : 0;
  const memeLegCost = memeLeg * (sellFee + impact);
  const pot = lpToFeeKey + creatorToPot - memeLegCost;
  return {
    traderPaidUsd: tradeFee + creatorFeeGross,
    raydiumUsd: protocolFund + (creatorFeeGross - creatorFeeNet),
    potUsd: pot,
    memeLegCostUsd: memeLegCost,
    memeLegUsd: memeLeg,
    holdersUsd: (pot * p.splitHoldersBps) / splitTotal,
    creatorUsd: (pot * p.splitCreatorBps) / splitTotal,
    divvyUsd: (pot * p.splitDivvyBps) / splitTotal,
    creatorDirectUsd: p.cpmmCreatorFeeToPot ? 0 : creatorFeeNet,
  };
}

/** Largest swap chunk: the parameter, or the cost-minimising √(fixed × depth) when it is 0. */
export function swapChunkUsd(p: Params): number {
  if (p.maxSwapChunkUsd > 0) return p.maxSwapChunkUsd;
  const fixedUsd = lamportsToUsd(unitCosts(p).swapLamports, p.solUsd);
  return Math.max(1, Math.sqrt(fixedUsd * p.xstockDepthUsd));
}

/** Constant-product price impact for a trade of `sizeUsd` into a reserve worth `depthUsd`. */
export function priceImpact(sizeUsd: number, depthUsd: number): number {
  if (sizeUsd <= 0 || depthUsd <= 0) return 0;
  return sizeUsd / (depthUsd + sizeUsd);
}

// ─────────────────────────────────────────────────────────────────────────────
// Holders
// ─────────────────────────────────────────────────────────────────────────────

export function holderCount(mcapUsd: number, p: Params): number {
  return Math.max(1, Math.round(p.holdersAt10kMcap * Math.pow(Math.max(mcapUsd, 1) / 10_000, p.holdersMcapExponent)));
}

export interface HolderSet {
  holders: number;
  eligible: number;
  /** USD value held by eligible holders. */
  eligibleUsd: number;
  /** Value held by each eligible holder, rank 1 first. */
  values: number[];
  top10Share: number;
}

/** Zipf holder balances: rank r holds heldUsd × r^-α / H_N(α). Eligible = value ≥ minHolderUsd. */
export function holderSet(holders: number, heldUsd: number, alpha: number, minHolderUsd: number): HolderSet {
  let h = 0;
  let h10 = 0;
  for (let r = 1; r <= holders; r++) {
    const w = Math.pow(r, -alpha);
    h += w;
    if (r <= 10) h10 += w;
  }
  const values: number[] = [];
  let eligibleUsd = 0;
  for (let r = 1; r <= holders; r++) {
    const v = (heldUsd * Math.pow(r, -alpha)) / h;
    if (v < minHolderUsd) break;
    values.push(v);
    eligibleUsd += v;
  }
  return { holders, eligible: values.length, eligibleUsd, values, top10Share: h > 0 ? h10 / h : 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rounds and per-coin day
// ─────────────────────────────────────────────────────────────────────────────

/** Rounds per day when a round only runs once the carried bucket reaches `minRoundUsd`. */
export function roundsPerDay(bucketPerHourUsd: number, minRoundUsd: number): number {
  if (!(bucketPerHourUsd > 0)) return 0;
  if (bucketPerHourUsd >= minRoundUsd) return 24;
  return 24 / Math.ceil(minRoundUsd / bucketPerHourUsd - 1e-12);
}

export interface CoinInput {
  phase: Phase;
  volume24hUsd: number;
}

/** How a coin's xStock swap is shared with other coins (batched architectures). */
export interface BatchContext {
  /** Coins whose rounds share each swap, on average. */
  coinsPerSwap: number;
  /** Average USD size of each batched swap (for price impact). */
  swapSizeUsd: number;
}

export interface CoinDay {
  phase: Phase;
  arch: Architecture;
  volume24hUsd: number;
  mcapUsd: number;
  holders: number;
  eligible: number;
  eligibleUsd: number;
  top10Share: number;
  fees: FeeBuckets;
  roundsPerDay: number;
  bucketPerRoundUsd: number;
  /** Holders' bucket after the xStock swap's route fee and price impact, per day. */
  holdersDeliveredUsd: number;
  xstockSwapCostUsd: number;
  // Activity per day.
  swaps: number;
  memeLegSells: number;
  harvests: number;
  transfers: number;
  ataCreates: number;
  // Divvy's network costs per day, USD.
  swapNetworkUsd: number;
  transferNetworkUsd: number;
  rentUsd: number;
  harvestNetworkUsd: number;
  memeLegNetworkUsd: number;
  snapshotUsd: number;
  networkCostUsd: number;
  divvyNetUsd: number;
  /** Network cost as a share of the holders' bucket. */
  costShareOfHolders: number;
  // Holder view.
  perHundredPerDayUsd: number;
  medianHolderUsd: number;
  medianHolderPerDayUsd: number;
  medianHolderPerHourUsd: number;
  /** Credit only: days for a $100 holder to accrue enough to cover a first claim. */
  daysToCoverFirstClaimPer100: number;
  /** Push only: one-off rent if every eligible holder needs an ATA at once (first round). */
  firstRoundRentUsd: number;
}

export function isPush(arch: Architecture): boolean {
  return arch === "perCoinPush" || arch === "batchedPush";
}
export function isBatched(arch: Architecture): boolean {
  return arch === "batchedPush" || arch === "batchedCredit";
}

/** Per-day economics for one coin under one architecture. */
export function coinDay(coin: CoinInput, arch: Architecture, p: Params, batch?: BatchContext): CoinDay {
  const { phase, volume24hUsd } = coin;
  const market = marketState(phase, volume24hUsd, p);
  const u = unitCosts(p);
  const usd = (lamports: number) => lamportsToUsd(lamports, p.solUsd);

  // First pass for round frequency (meme-leg impact is second order; use the gross pot).
  const gross = feeBuckets(phase, volume24hUsd, p);
  const R = roundsPerDay(gross.holdersUsd / 24, p.minRoundUsd);
  const memeLegPerRound = R > 0 ? gross.memeLegUsd / R : 0;
  const fees = phase === "graduated" ? feeBuckets(phase, volume24hUsd, p, memeLegPerRound, market.poolQuoteUsd) : gross;
  const bucketPerRound = R > 0 ? fees.holdersUsd / R : 0;

  const hs = holderSet(holderCount(market.mcapUsd, p), market.heldUsd, p.holderZipfAlpha, p.minHolderUsd);
  const E = hs.eligible;
  const paying = R > 0 && E > 0;

  // xStock swap: route fee + impact on the swap size, and the fixed tx cost (shared when batched).
  const batched = isBatched(arch);
  const coinsPerSwap = batched ? Math.max(1, batch?.coinsPerSwap ?? p.batchCoinsPerSwap) : 1;
  const swapSize = batched ? (batch?.swapSizeUsd ?? bucketPerRound * coinsPerSwap) : bucketPerRound;
  const chunks = Math.max(1, Math.ceil(swapSize / swapChunkUsd(p)));
  const xstockSwapCost = paying ? fees.holdersUsd * (p.xstockRouteFeeBps / 10_000 + priceImpact(swapSize / chunks, p.xstockDepthUsd)) : 0;
  const holdersDelivered = paying ? fees.holdersUsd - xstockSwapCost : 0;
  const swaps = paying ? (R * chunks) / coinsPerSwap : 0;
  const swapNetworkUsd = usd(swaps * u.swapLamports);

  // Graduated: one harvest and one memecoin sell per round (per coin, in every architecture),
  // plus forwarding the creator's share.
  const graduated = phase === "graduated" && paying;
  const harvests = graduated ? R : 0;
  const memeLegSells = graduated ? R : 0;
  const harvestNetworkUsd = usd(harvests * u.harvestLamports);
  const memeLegNetworkUsd = usd(memeLegSells * u.swapLamports + (graduated ? R * u.transferLamports : 0));

  // Delivery.
  const valuesPerRound = hs.values;
  let transfers = 0;
  let ataCreates = 0;
  let transferNetworkUsd = 0;
  let rentUsd = 0;
  let firstRoundRentUsd = 0;
  const perRoundNet = paying ? holdersDelivered / R : 0;
  if (paying && isPush(arch)) {
    const turnover = market.heldUsd > 0 ? volume24hUsd / market.heldUsd : 0;
    const newEligible = E * Math.min(p.maxDailyChurnOfEligible, p.churnPerTurnover * turnover);
    ataCreates = newEligible * (1 - p.pushAtaPreexistingShare) * Math.min(1, R);
    transfers = R * E;
    transferNetworkUsd = usd((transfers - ataCreates) * u.transferLamports + ataCreates * u.transferWithAtaLamports);
    rentUsd = usd(ataCreates * u.rentLamports);
    firstRoundRentUsd = usd(E * (1 - p.pushAtaPreexistingShare) * u.rentLamports);
  } else if (paying) {
    // Credit: everyone is credited off-chain; holders with the ATA are auto-pushed once their
    // accrued credit reaches autoPushMinUsd. Everyone else claims and pays their own rent.
    let pushesPerRound = 0;
    for (const v of valuesPerRound) {
      const credit = (perRoundNet * v) / hs.eligibleUsd;
      pushesPerRound += credit >= p.autoPushMinUsd ? 1 : 1 / Math.ceil(p.autoPushMinUsd / credit);
    }
    transfers = R * pushesPerRound * p.creditAtaShare;
    transferNetworkUsd = usd(transfers * u.transferLamports);
  }

  const snapshotUsd = paying ? R * Math.ceil(hs.holders / p.snapshotPageSize) * p.snapshotUsdPerCall : 0;
  const networkCostUsd = swapNetworkUsd + transferNetworkUsd + rentUsd + harvestNetworkUsd + memeLegNetworkUsd + snapshotUsd;
  const perHundred = paying ? (holdersDelivered * 100) / hs.eligibleUsd : 0;
  const medianIdx = Math.max(0, Math.ceil(E / 2) - 1);
  const medianHolderUsd = E > 0 ? (valuesPerRound[medianIdx] ?? 0) : 0;
  const medianPerDay = paying ? (holdersDelivered * medianHolderUsd) / hs.eligibleUsd : 0;
  const claimCostUsd = usd(u.holderFirstClaimLamports);

  return {
    phase,
    arch,
    volume24hUsd,
    mcapUsd: market.mcapUsd,
    holders: hs.holders,
    eligible: E,
    eligibleUsd: hs.eligibleUsd,
    top10Share: hs.top10Share,
    fees,
    roundsPerDay: paying ? R : 0,
    bucketPerRoundUsd: paying ? bucketPerRound : 0,
    holdersDeliveredUsd: holdersDelivered,
    xstockSwapCostUsd: xstockSwapCost,
    swaps,
    memeLegSells,
    harvests,
    transfers,
    ataCreates,
    swapNetworkUsd,
    transferNetworkUsd,
    rentUsd,
    harvestNetworkUsd,
    memeLegNetworkUsd,
    snapshotUsd,
    networkCostUsd,
    divvyNetUsd: fees.divvyUsd - networkCostUsd,
    costShareOfHolders: fees.holdersUsd > 0 ? networkCostUsd / fees.holdersUsd : 0,
    perHundredPerDayUsd: perHundred,
    medianHolderUsd,
    medianHolderPerDayUsd: medianPerDay,
    medianHolderPerHourUsd: medianPerDay / 24,
    daysToCoverFirstClaimPer100: !isPush(arch) && perHundred > 0 ? claimCostUsd / perHundred : Number.POSITIVE_INFINITY,
    firstRoundRentUsd,
  };
}

/** Log-spaced grid from `lo` to `hi` with `perDecade` points per factor of 10. */
export function logGrid(lo: number, hi: number, perDecade: number): number[] {
  const out: number[] = [];
  const n = Math.round(Math.log10(hi / lo) * perDecade);
  for (let i = 0; i <= n; i++) out.push(lo * Math.pow(10, i / perDecade));
  return out;
}

/**
 * Smallest 24h volume from which Divvy's own share covers the coin's network costs at every
 * higher grid volume (so holders keep their full share). Null if never within the grid.
 */
export function breakEvenVolume(phase: Phase, arch: Architecture, p: Params, lo = 100, hi = 10_000_000): number | null {
  const grid = logGrid(lo, hi, 40);
  let answer: number | null = null;
  for (let i = grid.length - 1; i >= 0; i--) {
    const v = grid[i]!;
    if (coinDay({ phase, volume24hUsd: v }, arch, p).divvyNetUsd >= 0) answer = v;
    else break;
  }
  return answer;
}

/** Smallest volume at which network costs are at most `share` of the holders' bucket (for every higher volume). */
export function volumeForCostShare(phase: Phase, arch: Architecture, p: Params, share: number, lo = 100, hi = 10_000_000): number | null {
  const grid = logGrid(lo, hi, 40);
  let answer: number | null = null;
  for (let i = grid.length - 1; i >= 0; i--) {
    const v = grid[i]!;
    const d = coinDay({ phase, volume24hUsd: v }, arch, p);
    if (d.roundsPerDay > 0 && d.costShareOfHolders <= share) answer = v;
    else break;
  }
  return answer;
}

// ─────────────────────────────────────────────────────────────────────────────
// Platform simulation
// ─────────────────────────────────────────────────────────────────────────────

/** Acklam's rational approximation of the standard normal inverse CDF (|error| < 1.2e-9). */
export function normInv(q: number): number {
  if (!(q > 0 && q < 1)) throw new Error("q must be in (0, 1)");
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  const A = (i: number) => a[i]!;
  const B = (i: number) => b[i]!;
  const C = (i: number) => c[i]!;
  const Dd = (i: number) => d[i]!;
  if (q < pl) {
    const t = Math.sqrt(-2 * Math.log(q));
    return (((((C(0) * t + C(1)) * t + C(2)) * t + C(3)) * t + C(4)) * t + C(5)) / ((((Dd(0) * t + Dd(1)) * t + Dd(2)) * t + Dd(3)) * t + 1);
  }
  if (q > 1 - pl) return -normInv(1 - q);
  const t = q - 0.5;
  const r = t * t;
  return ((((((A(0) * r + A(1)) * r + A(2)) * r + A(3)) * r + A(4)) * r + A(5)) * t) / (((((B(0) * r + B(1)) * r + B(2)) * r + B(3)) * r + B(4)) * r + 1);
}

/** Deterministic 32-bit PRNG (mulberry32), for assigning dividend assets reproducibly. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface PlatformCoin {
  volume24hUsd: number;
  phase: Phase;
  asset: number;
}

/** n live coins: lognormal volumes at evenly spaced quantiles, top share graduated, Zipf asset popularity. */
export function platformCoins(n: number, p: Params, seed = 7): PlatformCoin[] {
  const rnd = mulberry32(seed);
  const weights = Array.from({ length: p.numAssets }, (_, k) => 1 / (k + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  const grad = Math.round(n * p.graduatedShareOfLive);
  const coins: PlatformCoin[] = [];
  for (let i = 0; i < n; i++) {
    const z = normInv((i + 0.5) / n);
    const volume24hUsd = p.volumeMedianUsd * Math.exp(p.volumeLogSigma * z);
    let u = rnd() * total;
    let asset = 0;
    while (asset < p.numAssets - 1 && u >= weights[asset]!) {
      u -= weights[asset]!;
      asset++;
    }
    coins.push({ volume24hUsd, phase: i >= n - grad ? "graduated" : "curve", asset });
  }
  return coins;
}

export interface PlatformDay {
  arch: Architecture;
  coins: number;
  graduated: number;
  volumeUsd: number;
  traderFeesUsd: number;
  holdersBucketUsd: number;
  holdersDeliveredUsd: number;
  divvyRevenueUsd: number;
  networkCostUsd: number;
  rentUsd: number;
  swapNetworkUsd: number;
  transferNetworkUsd: number;
  graduatedOpsUsd: number;
  vaultClaimUsd: number;
  infraUsd: number;
  divvyNetUsd: number;
  coinsPayingHourly: number;
  coinsPayingDaily: number;
  coinsPayingLessThanDaily: number;
  swapsPerHour: number;
  jitoRequestsPerHour: number;
  jupiterCallsPerHour: number;
  transfersPerHour: number;
  ataCreatesPerDay: number;
}

export function platformDay(coins: PlatformCoin[], arch: Architecture, p: Params): PlatformDay {
  // Pass 1: rounds and bucket sizes per coin (independent of architecture).
  const base = coins.map((c) => coinDay(c, "perCoinCredit", p));
  // Batching: per asset, expected coins due per hour and average swap size.
  const batchByAsset = new Map<number, BatchContext & { batchesPerDay: number }>();
  if (isBatched(arch)) {
    for (let a = 0; a < p.numAssets; a++) {
      let noneDue = 1;
      let roundsSum = 0;
      let usdPerDay = 0;
      coins.forEach((c, i) => {
        if (c.asset !== a) return;
        const b = base[i]!;
        if (b.roundsPerDay <= 0) return;
        noneDue *= 1 - b.roundsPerDay / 24;
        roundsSum += b.roundsPerDay;
        usdPerDay += b.fees.holdersUsd;
      });
      const batchesPerDay = 24 * (1 - noneDue);
      if (batchesPerDay > 0) {
        batchByAsset.set(a, { coinsPerSwap: roundsSum / batchesPerDay, swapSizeUsd: usdPerDay / batchesPerDay, batchesPerDay });
      }
    }
  }
  const u = unitCosts(p);
  const out: PlatformDay = {
    arch,
    coins: coins.length,
    graduated: coins.filter((c) => c.phase === "graduated").length,
    volumeUsd: 0,
    traderFeesUsd: 0,
    holdersBucketUsd: 0,
    holdersDeliveredUsd: 0,
    divvyRevenueUsd: 0,
    networkCostUsd: 0,
    rentUsd: 0,
    swapNetworkUsd: 0,
    transferNetworkUsd: 0,
    graduatedOpsUsd: 0,
    vaultClaimUsd: lamportsToUsd(24 * u.vaultClaimLamports, p.solUsd),
    infraUsd: p.infraUsdPerDay,
    divvyNetUsd: 0,
    coinsPayingHourly: 0,
    coinsPayingDaily: 0,
    coinsPayingLessThanDaily: 0,
    swapsPerHour: 0,
    jitoRequestsPerHour: 0,
    jupiterCallsPerHour: 0,
    transfersPerHour: 0,
    ataCreatesPerDay: 0,
  };
  let swapsPerDay = 0;
  coins.forEach((c) => {
    const d = coinDay(c, arch, p, isBatched(arch) ? batchByAsset.get(c.asset) : undefined);
    out.volumeUsd += c.volume24hUsd;
    out.traderFeesUsd += d.fees.traderPaidUsd;
    out.holdersBucketUsd += d.fees.holdersUsd;
    out.holdersDeliveredUsd += d.holdersDeliveredUsd;
    out.divvyRevenueUsd += d.fees.divvyUsd;
    out.networkCostUsd += d.networkCostUsd;
    out.rentUsd += d.rentUsd;
    out.swapNetworkUsd += d.swapNetworkUsd;
    out.transferNetworkUsd += d.transferNetworkUsd;
    out.graduatedOpsUsd += d.harvestNetworkUsd + d.memeLegNetworkUsd;
    out.ataCreatesPerDay += d.ataCreates;
    out.transfersPerHour += d.transfers / 24;
    if (d.roundsPerDay >= 24) out.coinsPayingHourly++;
    if (d.roundsPerDay >= 1) out.coinsPayingDaily++;
    if (d.roundsPerDay < 1) out.coinsPayingLessThanDaily++;
    swapsPerDay += d.memeLegSells + d.swaps;
  });
  out.networkCostUsd += out.vaultClaimUsd;
  out.swapsPerHour = swapsPerDay / 24;
  out.jitoRequestsPerHour = out.swapsPerHour * (1 + p.jitoPollsPerBundle);
  out.jupiterCallsPerHour = out.swapsPerHour;
  out.divvyNetUsd = out.divvyRevenueUsd - out.networkCostUsd - out.infraUsd;
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Threshold helpers for recommendations
// ─────────────────────────────────────────────────────────────────────────────

/** Fixed network cost of one round's swap as a share of the round, for a given round size. */
export function swapFixedShare(roundUsd: number, coinsPerSwap: number, p: Params): number {
  return lamportsToUsd(unitCosts(p).swapLamports / coinsPerSwap, p.solUsd) / roundUsd;
}

/** Network cost of one auto-push as a share of the pushed amount. */
export function autoPushCostShare(pushUsd: number, p: Params): number {
  return lamportsToUsd(unitCosts(p).transferLamports, p.solUsd) / pushUsd;
}

/**
 * Smallest holding (USD) for which a fresh wallet loses money farming ATA rent under push:
 * it must pay a round trip of trading fees (buy + sell) worth more than the rent Divvy gives it.
 */
export function rentFarmMinHolderUsd(phase: Phase, p: Params): number {
  const rentUsd = lamportsToUsd(xstockAtaRentLamports(p), p.solUsd);
  const oneWay =
    phase === "curve"
      ? (p.curveProtocolRate + p.curvePlatformRate + p.curveCreatorRate) / FEE_RATE_DENOMINATOR
      : (p.cpmmTradeFeeRate + p.cpmmCreatorFeeRate) / FEE_RATE_DENOMINATOR;
  return rentUsd / (2 * oneWay);
}
