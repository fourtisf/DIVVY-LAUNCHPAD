/**
 * The API contract (HANDOFF §6). The Fastify API returns exactly these shapes and the web app only
 * reads these shapes. Amounts are base-unit integer strings with their decimals and a display value.
 */
import { z } from "zod";

const iso = z.string().datetime();
const base58 = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,88}$/);

export const AmountSchema = z.object({
  raw: z.string().regex(/^\d+$/),
  decimals: z.number().int().min(0).max(18),
  ui: z.number(),
});
export type Amount = z.infer<typeof AmountSchema>;

export const CheckResultSchema = z.object({
  status: z.enum(["idle", "ok", "fail"]),
  code: z.string(),
  message: z.string(),
  collidesWith: z.object({ ticker: z.string(), name: z.string(), mint: z.string().nullable() }).nullable(),
});

export const ApiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  collidesWith: CheckResultSchema.shape.collidesWith,
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/* ---------- config ---------- */

export const DividendAssetSchema = z.object({
  symbol: z.string(),
  name: z.string(),
  kind: z.enum(["stock", "crypto"]),
  /** null until fetched from the official list into the DividendAsset table. Never typed by hand. */
  mint: base58.nullable(),
  decimals: z.number().int().nullable(),
  tokenProgram: z.enum(["spl-token", "token-2022"]).nullable(),
  logoUrl: z.string().nullable(),
  /** Chip art: monogram and colours. */
  mono: z.string(),
  chipBg: z.string(),
  chipFg: z.string(),
  priceUsd: z.number(),
  change24hPct: z.number(),
  /** Orbits the hero coin. */
  featured: z.boolean(),
  enabled: z.boolean(),
});
export type DividendAsset = z.infer<typeof DividendAssetSchema>;

export const ConfigSchema = z.object({
  network: z.enum(["mainnet-beta", "devnet"]),
  /** True while the API serves demo data. The footer says so. */
  demo: z.boolean(),
  launchesOpen: z.boolean(),
  launchesPausedReason: z.string().nullable(),
  /**
   * What a launch costs its creator, who signs and pays for their coin's create (owner decision
   * 2026-10-27): uspad's fee, sent to `to` inside the create (0 and null when there's none), and about
   * what the create itself costs (account rent, the network fee and the Jito tip).
   */
  launchFee: z.object({ amount: AmountSchema, to: base58.nullable(), createCost: AmountSchema }),
  fees: z.object({
    tradeFeeBps: z.number().int(),
    protocolBps: z.number().int(),
    holdersBps: z.number().int(),
    creatorBps: z.number().int(),
    divvyBps: z.number().int(),
  }),
  graduation: z.object({
    targetUsd: z.number(),
    quoteFundRaising: AmountSchema,
    totalSupply: AmountSchema,
    curveSupply: AmountSchema,
    migrateSupply: AmountSchema,
  }),
  limits: z.object({
    launchesPerWalletPerDay: z.number().int(),
    launchesPerDayGlobal: z.number().int(),
    launchCooldownSec: z.number().int(),
    tickerMinLen: z.number().int(),
    tickerMaxLen: z.number().int(),
    nameMaxLen: z.number().int(),
    descriptionMaxLen: z.number().int(),
    imageMaxBytes: z.number().int(),
    imageTypes: z.array(z.string()),
  }),
  payouts: z.object({
    intervalSec: z.number().int(),
    lateAfterSec: z.number().int(),
    minHolderUsd: z.number(),
    minRoundUsd: z.number(),
    delivery: z.enum(["push", "claim"]),
    autoPushMinUsd: z.number().nullable(),
    /** Taken from each automatic send's dividend; a wallet's first send also covers its token account's rent. */
    deliveryFeeUsd: z.number(),
  }),
  quote: z.object({ symbol: z.literal("SOL"), mint: base58, decimals: z.literal(9), priceUsd: z.number() }),
  dividendAssets: z.array(DividendAssetSchema),
  flags: z.object({
    /** X accounts are linked with OAuth 2.0 (live). Off in demo mode, where the handle is typed. */
    xOAuth: z.boolean(),
    /** The trade box builds real transactions for the wallet to sign. */
    trading: z.boolean(),
  }),
});
export type Config = z.infer<typeof ConfigSchema>;

/* ---------- live events (WS /api/live, also the activity strip) ---------- */

const coinRef = { mint: base58, ticker: z.string(), imageUrl: z.string() };

export const LiveEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("launch"), at: iso, ...coinRef, name: z.string() }),
  z.object({ type: z.literal("trade"), at: iso, ...coinRef, side: z.enum(["buy", "sell"]), sol: AmountSchema, wallet: base58 }),
  z.object({ type: z.literal("graduate"), at: iso, ...coinRef }),
  z.object({
    type: z.literal("payout_round"),
    at: iso,
    ...coinRef,
    assetSymbol: z.string(),
    amount: AmountSchema,
    usd: z.number(),
    wallets: z.number().int(),
  }),
  z.object({ type: z.literal("meter_status"), at: iso, mint: base58.nullable(), status: z.enum(["ok", "carried", "late"]) }),
]);
export type LiveEvent = z.infer<typeof LiveEventSchema>;

/* ---------- stats ---------- */

export const StatsSchema = z.object({
  coinsLive: z.number().int(),
  paidToHoldersUsd: z.number(),
  volume24hUsd: z.number(),
  /** Dividend assets used by at least one coin, for the "Pays in" filters. */
  assetsInUse: z.array(z.string()),
  lastRound: z
    .object({
      hour: iso,
      paidUsd: z.number(),
      wallets: z.number().int(),
      items: z.array(z.object({ ...coinRef, assetSymbol: z.string(), amount: AmountSchema, usd: z.number() })),
    })
    .nullable(),
  nextRoundAt: iso,
  /** Recent events for the activity strip; the WS stream continues from here. */
  activity: z.array(LiveEventSchema),
});
export type Stats = z.infer<typeof StatsSchema>;

/* ---------- coins ---------- */

export const CoinSortSchema = z.enum(["trending", "new", "payers", "graduate"]);
export type CoinSort = z.infer<typeof CoinSortSchema>;

export const CreatorSchema = z.object({
  wallet: base58,
  /** OAuth-verified X handle, if linked. */
  xHandle: z.string().nullable(),
  /** What the UI prints after "by": the X handle, else the short wallet. */
  label: z.string(),
});

export const CoinSummarySchema = z.object({
  mint: base58,
  ticker: z.string(),
  name: z.string(),
  imageUrl: z.string(),
  dividendAsset: z.string(),
  status: z.enum(["live", "graduated"]),
  createdAt: iso,
  creator: CreatorSchema,
  marketCapUsd: z.number(),
  change24hPct: z.number(),
  volume24hUsd: z.number(),
  holders: z.number().int(),
  paidUsd: z.number(),
  paid24hUsd: z.number(),
  /** Paid to holders in the last 24h, in the dividend asset. */
  paid24h: AmountSchema,
  /** Bonding-curve progress 0..1 (1 once graduated). */
  progress: z.number().min(0).max(1),
  /** Recent market cap points for the card sparkline (oldest first). Empty for brand-new coins. */
  spark: z.array(z.number()),
});
export type CoinSummary = z.infer<typeof CoinSummarySchema>;

export const CoinListSchema = z.object({ items: z.array(CoinSummarySchema), nextCursor: z.string().nullable() });
export type CoinList = z.infer<typeof CoinListSchema>;

export const CoinDetailSchema = CoinSummarySchema.extend({
  description: z.string(),
  athUsd: z.number(),
  priceUsd: z.number(),
  priceSol: z.number(),
  supply: AmountSchema,
  paid: AmountSchema,
  links: z.object({ x: z.string().nullable(), telegram: z.string().nullable(), website: z.string().nullable() }),
  cpmmPool: base58.nullable(),
  createdSig: z.string().nullable(),
});
export type CoinDetail = z.infer<typeof CoinDetailSchema>;

export const TradeSchema = z.object({
  sig: z.string(),
  side: z.enum(["buy", "sell"]),
  sol: AmountSchema,
  token: AmountSchema,
  wallet: base58,
  ts: iso,
});
export const TradeListSchema = z.object({ items: z.array(TradeSchema), nextCursor: z.string().nullable() });
export type Trade = z.infer<typeof TradeSchema>;

export const CandleTfSchema = z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]);
export type CandleTf = z.infer<typeof CandleTfSchema>;
export const CandleSchema = z.object({
  /** Bucket start, unix seconds. */
  t: z.number().int(),
  o: z.number(),
  h: z.number(),
  l: z.number(),
  c: z.number(),
  vol: AmountSchema,
});
export const CandleListSchema = z.object({
  tf: CandleTfSchema,
  unit: z.enum(["mcap", "price"]),
  items: z.array(CandleSchema),
});
export type CandleList = z.infer<typeof CandleListSchema>;

export const HolderSchema = z.object({
  wallet: base58,
  /** Set for excluded system accounts, e.g. "Bonding curve". */
  label: z.string().nullable(),
  pct: z.number(),
  balance: AmountSchema,
  received: AmountSchema.nullable(),
  excluded: z.boolean(),
  excludedReason: z.enum(["curve", "pool", "launcher", "divvy", "burn"]).nullable(),
});
export const HolderListSchema = z.object({ items: z.array(HolderSchema) });
export type Holder = z.infer<typeof HolderSchema>;

export const RoundStatusSchema = z.enum(["ok", "carried", "late", "failed"]);
export const PayoutRoundSchema = z.object({
  id: z.string(),
  hour: iso,
  status: RoundStatusSchema,
  assetSymbol: z.string(),
  amount: AmountSchema,
  usd: z.number(),
  wallets: z.number().int(),
  sig: z.string().nullable(),
});
export type PayoutRound = z.infer<typeof PayoutRoundSchema>;
export const CoinPayoutListSchema = z.object({ items: z.array(PayoutRoundSchema), nextCursor: z.string().nullable() });

export const MeterSchema = z.object({
  paid24hUsd: z.number(),
  pendingUsd: z.number(),
  lastPayoutAt: iso.nullable(),
  status: z.enum(["ok", "carried", "late"]),
  nextRoundAt: iso,
});
export type Meter = z.infer<typeof MeterSchema>;

export const ReceiptSchema = PayoutRoundSchema.extend({ coin: z.object(coinRef) });
export type Receipt = z.infer<typeof ReceiptSchema>;
export const PayoutListSchema = z.object({
  summary: z.object({
    paidUsd: z.number(),
    rounds: z.number().int(),
    walletPayments: z.number().int(),
    pendingUsd: z.number(),
    status: z.enum(["ok", "late"]),
    lateCoins: z.number().int(),
  }),
  items: z.array(ReceiptSchema),
  nextCursor: z.string().nullable(),
});
export type PayoutList = z.infer<typeof PayoutListSchema>;

/* ---------- create ---------- */

export const CheckResponseSchema = z.object({
  ticker: CheckResultSchema.optional(),
  name: CheckResultSchema.optional(),
  x: CheckResultSchema.optional(),
});
export type CheckResponse = z.infer<typeof CheckResponseSchema>;

export const UploadResponseSchema = z.object({
  imageId: z.string(),
  url: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  check: CheckResultSchema,
});
export type UploadResponse = z.infer<typeof UploadResponseSchema>;

export const LaunchRequestSchema = z.object({
  name: z.string().trim().min(1).max(32),
  ticker: z.string().trim().min(1).max(12),
  description: z.string().max(280).default(""),
  imageId: z.string().min(1),
  dividendAsset: z.string().min(1),
  /** The project's X account: a handle or its profile link (normalizeXHandle). */
  x: z.string().max(200).optional().default(""),
  telegram: z.string().max(100).optional().default(""),
  website: z.string().max(200).optional().default(""),
  /** A launch fee paid on its own earlier (before the fee moved into the create), used as credit. */
  feeSig: z.string().max(100).optional(),
});

/** POST /api/launch/:id/sign: the create as the creator's wallet signed it (base64), or that they turned it down. */
export const LaunchSignSchema = z.union([z.object({ signedTx: z.string().min(100).max(2400) }), z.object({ refused: z.literal(true) })]);
export type LaunchRequest = z.input<typeof LaunchRequestSchema>;

export const LaunchStepSchema = z.enum(["checking", "signing", "bundling", "landed", "indexed", "failed"]);
export type LaunchStep = z.infer<typeof LaunchStepSchema>;
export const LaunchStatusSchema = z.object({
  id: z.string(),
  step: LaunchStepSchema,
  ticker: z.string(),
  /** Only present from "landed" on. Never revealed earlier (HANDOFF §3.5). */
  mint: base58.optional(),
  /**
   * While step = "signing", to the launch's creator only: the create for their wallet to sign (base64,
   * without signatures). It names the mint, which only the creator sees before the coin lands.
   */
  tx: z.string().optional(),
  signature: z.string().optional(),
  error: ApiErrorSchema.optional(),
});
export type LaunchStatus = z.infer<typeof LaunchStatusSchema>;

/* ---------- auth ---------- */

/** The Sign-In With Solana fields; wallets that support `signIn` render them into exactly `message`. */
export const SiwsInputSchema = z.object({
  domain: z.string(),
  address: z.string(),
  statement: z.string(),
  uri: z.string(),
  version: z.string(),
  chainId: z.string(),
  nonce: z.string(),
  issuedAt: z.string(),
  expirationTime: z.string(),
});
export const NonceResponseSchema = z.object({ nonce: z.string(), message: z.string(), input: SiwsInputSchema, expiresAt: iso });
export type SiwsInput = z.infer<typeof SiwsInputSchema>;
export type NonceResponse = z.infer<typeof NonceResponseSchema>;
/** Bounded before any base58 decoding: decoding is quadratic, so an unbounded signature is a DoS (audit). */
export const VerifyRequestSchema = z.object({
  address: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/),
  signature: z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{64,90}$/),
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  /** Base64 of the bytes the wallet's `signIn` signed. It must equal the issued message exactly. */
  signedMessage: z.string().max(2048).regex(/^[A-Za-z0-9+/]+={0,2}$/).optional(),
});
export const MeSchema = z.object({
  wallet: base58.nullable(),
  isAdmin: z.boolean(),
  /** The visitor's country can't launch or claim (HANDOFF §10). Known even when signed out. */
  blocked: z.boolean(),
  x: z.object({ userId: z.string(), handle: z.string() }).nullable(),
  launchesToday: z.number().int(),
  launchesLeftToday: z.number().int(),
  claimable: z.array(z.object({ assetSymbol: z.string(), amount: AmountSchema, usd: z.number() })),
});
export type Me = z.infer<typeof MeSchema>;

/* ---------- trade + claims ---------- */

export const TradeBuildRequestSchema = z.object({
  mint: base58,
  side: z.enum(["buy", "sell"]),
  /** Base units of the input (lamports for buys, token base units for sells). */
  amountIn: z.string().regex(/^\d+$/),
  slippageBps: z.number().int().min(1).max(5000),
  wallet: base58,
});
export type TradeBuildRequest = z.infer<typeof TradeBuildRequestSchema>;
export const TradeBuildResponseSchema = z.object({
  /** Unsigned versioned transaction, base64. null while the API runs in demo mode. */
  tx: z.string().nullable(),
  route: z.enum(["curve", "jupiter"]),
  expectedOut: AmountSchema,
  minOut: AmountSchema,
  priceImpactBps: z.number().int(),
});
export type TradeBuildResponse = z.infer<typeof TradeBuildResponseSchema>;

export const ClaimsSchema = z.object({
  delivery: z.enum(["push", "claim"]),
  items: z.array(z.object({ assetSymbol: z.string(), mint: base58.nullable(), amount: AmountSchema, usd: z.number() })),
});
export const ClaimBuildRequestSchema = z.object({ assetSymbol: z.string().min(1) });
export const ClaimBuildResponseSchema = z.object({ tx: z.string().nullable() });

/* ---------- signed-in extras: payouts, creator fees, reports ---------- */

export const MyPayoutsSchema = z.object({
  items: z.array(
    z.object({
      coin: z.object(coinRef),
      hour: iso,
      assetSymbol: z.string(),
      amount: AmountSchema,
      usd: z.number(),
      status: z.enum(["credited", "sent", "claimed"]),
      sig: z.string().nullable(),
    }),
  ),
  nextCursor: z.string().nullable(),
});
export type MyPayouts = z.infer<typeof MyPayoutsSchema>;

export const CreatorInfoSchema = z.object({
  wallet: base58,
  /** SOL waiting in the creator's LaunchLab fee vault (all their coins together). */
  claimable: AmountSchema,
  coins: z.array(z.object({ ...coinRef, name: z.string(), status: z.enum(["pending", "live", "graduated", "failed"]), creatorFees: AmountSchema })),
});
export type CreatorInfo = z.infer<typeof CreatorInfoSchema>;

export const UnsignedTxSchema = z.object({ tx: z.string() });

export const ReportRequestSchema = z.object({
  reason: z.enum(["copy", "scam", "nsfw", "illegal", "other"]),
  details: z.string().max(500).default(""),
});

/* ---------- admin ---------- */

export const AdminOverviewSchema = z.object({
  launchesOpen: z.boolean(),
  launchesPausedReason: z.string().nullable(),
  wallets: z.array(z.object({ role: z.string(), address: base58, sol: z.number(), lowBalance: z.boolean() })),
  pendingLaunches: z.number().int(),
  openReports: z.number().int(),
  lateRounds: z.number().int(),
  indexerLagSec: z.number().nullable(),
  mainnetEnabled: z.boolean(),
  dryRun: z.boolean(),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

export const AdminReportListSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      coin: z.object({ ...coinRef, name: z.string(), hidden: z.boolean() }),
      reason: z.string(),
      details: z.string(),
      status: z.enum(["open", "resolved", "dismissed"]),
      createdAt: iso,
    }),
  ),
});
export type AdminReportList = z.infer<typeof AdminReportListSchema>;

export const AdminSettingsRequestSchema = z.object({ launchesOpen: z.boolean(), reason: z.string().max(200).nullable().default(null) });
export const AdminHideRequestSchema = z.object({ hidden: z.boolean(), reason: z.string().max(200).nullable().default(null) });
export const AdminReportUpdateSchema = z.object({ status: z.enum(["open", "resolved", "dismissed"]) });
