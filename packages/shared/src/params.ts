/**
 * Business parameters shared by the API and the worker, read from the environment once.
 * The fee split must match the on-chain PlatformConfig; the worker refuses to run payouts if it doesn't.
 */
import { z } from "zod";
import { assertSplit, type FeeSplitBps } from "./fees";

const csv = z
  .string()
  .default("")
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean));

const ParamsSchema = z.object({
  FEE_TRADE_BPS: z.coerce.number().int().default(100),
  FEE_PROTOCOL_BPS: z.coerce.number().int().default(25),
  FEE_HOLDERS_BPS: z.coerce.number().int().default(50),
  FEE_CREATOR_BPS: z.coerce.number().int().default(15),
  FEE_DIVVY_BPS: z.coerce.number().int().default(10),
  /** "push" sends every round; "claim" credits a ledger (HANDOFF §3.4). Copy follows this switch. */
  PAYOUT_DELIVERY: z.enum(["push", "claim"]).default("push"),
  PAYOUTS_DRY_RUN: z.enum(["true", "false"]).default("true"),
  MIN_ROUND_USD: z.coerce.number().positive().default(5),
  MIN_HOLDER_USD: z.coerce.number().positive().default(10),
  AUTO_PUSH_MIN_USD: z.coerce.number().positive().default(1),
  /**
   * uspad's fee per automatic send, in USD, taken from the dividend in stock (owner decision
   * 2026-10-27). It also covers the send's network fee. A wallet's first send pays its new token
   * account's rent the same way.
   */
  DELIVERY_FEE_USD: z.coerce.number().nonnegative().max(1).default(0.02),
  LATE_AFTER_SEC: z.coerce.number().int().positive().default(900),
  MAX_SWAP_IMPACT_BPS: z.coerce.number().int().positive().default(300),
  SWAP_SLIPPAGE_BPS: z.coerce.number().int().positive().default(100),
  LAUNCHES_PER_WALLET_PER_DAY: z.coerce.number().int().positive().default(3),
  LAUNCHES_PER_DAY_GLOBAL: z.coerce.number().int().positive().default(2000),
  LAUNCH_COOLDOWN_SEC: z.coerce.number().int().nonnegative().default(120),
  /** Abuse guard for free launches: a linked X account, or a wallet with at least this many lamports. */
  LAUNCH_MIN_WALLET_LAMPORTS: z.coerce.bigint().default(50_000_000n),
  /** ...and whose first transaction is at least this old (HANDOFF §6 "a minimum age"). */
  LAUNCH_MIN_WALLET_AGE_DAYS: z.coerce.number().nonnegative().default(3),
  /** Hourly spend cap for the launcher hot wallet (rent + tips), in lamports. */
  LAUNCHER_HOURLY_CAP_LAMPORTS: z.coerce.bigint().default(3_000_000_000n),
  /** ISO 3166-1 alpha-2 codes; requests from these countries can't launch or claim (HANDOFF §10). */
  BLOCKED_COUNTRIES: csv,
  ADMIN_WALLETS: csv,
});

export interface DivvyParams {
  fees: FeeSplitBps;
  delivery: "push" | "claim";
  dryRun: boolean;
  minRoundUsd: number;
  minHolderUsd: number;
  autoPushMinUsd: number;
  deliveryFeeUsd: number;
  lateAfterSec: number;
  maxSwapImpactBps: number;
  swapSlippageBps: number;
  launchesPerWalletPerDay: number;
  launchesPerDayGlobal: number;
  launchCooldownSec: number;
  launchMinWalletLamports: bigint;
  launchMinWalletAgeDays: number;
  launcherHourlyCapLamports: bigint;
  blockedCountries: Set<string>;
  adminWallets: Set<string>;
}

export function loadParams(src: Record<string, string | undefined> = process.env): DivvyParams {
  const e = ParamsSchema.parse(definedEnv(src));
  const fees: FeeSplitBps = {
    tradeFeeBps: e.FEE_TRADE_BPS,
    protocolBps: e.FEE_PROTOCOL_BPS,
    holdersBps: e.FEE_HOLDERS_BPS,
    creatorBps: e.FEE_CREATOR_BPS,
    divvyBps: e.FEE_DIVVY_BPS,
  };
  assertSplit(fees);
  return {
    fees,
    delivery: e.PAYOUT_DELIVERY,
    dryRun: e.PAYOUTS_DRY_RUN !== "false",
    minRoundUsd: e.MIN_ROUND_USD,
    minHolderUsd: e.MIN_HOLDER_USD,
    autoPushMinUsd: e.AUTO_PUSH_MIN_USD,
    deliveryFeeUsd: e.DELIVERY_FEE_USD,
    lateAfterSec: e.LATE_AFTER_SEC,
    maxSwapImpactBps: e.MAX_SWAP_IMPACT_BPS,
    swapSlippageBps: e.SWAP_SLIPPAGE_BPS,
    launchesPerWalletPerDay: e.LAUNCHES_PER_WALLET_PER_DAY,
    launchesPerDayGlobal: e.LAUNCHES_PER_DAY_GLOBAL,
    launchCooldownSec: e.LAUNCH_COOLDOWN_SEC,
    launchMinWalletLamports: e.LAUNCH_MIN_WALLET_LAMPORTS,
    launchMinWalletAgeDays: e.LAUNCH_MIN_WALLET_AGE_DAYS,
    launcherHourlyCapLamports: e.LAUNCHER_HOURLY_CAP_LAMPORTS,
    blockedCountries: new Set(e.BLOCKED_COUNTRIES.map((c) => c.toUpperCase())),
    adminWallets: new Set(e.ADMIN_WALLETS),
  };
}

/** On-chain rates (millionths) that the PlatformConfig and GlobalConfig must carry for this split. */
export const expectedOnChainRates = (f: FeeSplitBps) => ({
  tradeFeeRate: f.protocolBps * 100,
  platformFeeRate: (f.holdersBps + f.divvyBps) * 100,
  creatorFeeRate: f.creatorBps * 100,
});

/** `KEY=` in an env file means "not set": drop empty strings so defaults apply. */
export const definedEnv = (src: Record<string, string | undefined>): Record<string, string> =>
  Object.fromEntries(Object.entries(src).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
