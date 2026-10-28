/**
 * Integer fee and payout math (HANDOFF §3.2, §3.3). Everything is bigint in base units; nothing here
 * rounds up, so a split never pays out more than it received. Remainders are returned, not dropped.
 */

export interface FeeSplitBps {
  /** Total fee a trader pays on the curve, in basis points of the trade. */
  tradeFeeBps: number;
  protocolBps: number;
  holdersBps: number;
  creatorBps: number;
  divvyBps: number;
}

export function assertSplit(s: FeeSplitBps): void {
  const parts = [s.protocolBps, s.holdersBps, s.creatorBps, s.divvyBps];
  if (parts.some((p) => !Number.isInteger(p) || p < 0)) throw new Error("fee parts must be non-negative integers");
  if (parts.reduce((a, b) => a + b, 0) !== s.tradeFeeBps) throw new Error("fee parts must add up to tradeFeeBps");
}

/** `amount × bps / 10_000`, floored. */
export function applyBps(amount: bigint, bps: number): bigint {
  if (amount < 0n) throw new Error("negative amount");
  return (amount * BigInt(bps)) / 10_000n;
}

/**
 * Splits `amount` by integer weights. Each share is floored; the leftover (< number of keys) goes to
 * the key named in `remainderTo`, so the shares always sum to `amount` exactly.
 */
export function splitByWeights<K extends string>(
  amount: bigint,
  weights: Record<K, number>,
  remainderTo: NoInfer<K>,
): Record<K, bigint> {
  if (amount < 0n) throw new Error("negative amount");
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((a, k) => a + BigInt(weights[k]), 0n);
  if (total <= 0n) throw new Error("weights must sum to a positive number");
  const out = {} as Record<K, bigint>;
  let used = 0n;
  for (const k of keys) {
    out[k] = (amount * BigInt(weights[k])) / total;
    used += out[k];
  }
  out[remainderTo] += amount - used;
  return out;
}

/* ---------- the creator's dev buy ---------- */

/**
 * The most a dev buy may spend: under the 85 SOL the curve raises, so a create never fills its own
 * curve. There is no other cap (owner decision 2026-10-28).
 */
export const DEV_BUY_MAX_LAMPORTS = 80_000_000_000n;
/** The least a dev buy may spend, so its fee and its tokens are never rounding dust. */
export const DEV_BUY_MIN_LAMPORTS = 10_000_000n;
/** The empty curve's virtual reserves: 1B supply, 793.1M sold for 85 SOL (docs/verified/launchlab.md, curve math). */
const START_VIRTUAL_A = 1_073_025_605_596_382n;
const START_VIRTUAL_B = 30_000_852_951n;
const COIN_SUPPLY = 1_000_000_000_000_000n;

/**
 * About what a dev buy of `lamports` gets on the empty curve once the trade fee is taken: tokens in
 * base units and the share of supply (0..1). The coin page shows the real amount once the create lands.
 */
export function devBuyEstimate(lamports: bigint, tradeFeeBps: number): { tokens: bigint; pct: number } {
  if (lamports <= 0n) return { tokens: 0n, pct: 0 };
  const net = lamports - (lamports * BigInt(tradeFeeBps) + 9_999n) / 10_000n;
  const tokens = (net * START_VIRTUAL_A) / (START_VIRTUAL_B + net);
  return { tokens, pct: Number((tokens * 1_000_000n) / COIN_SUPPLY) / 1_000_000 };
}

/** The holders' and uspad's weights in the platform fee. */
export type PlatformSplit = Pick<FeeSplitBps, "holdersBps" | "divvyBps">;

/**
 * Splits a coin's platform-fee lamports into the holders' and uspad's buckets (remainder to uspad).
 * `early` covers a platform fee change: `fees` of the coin's `total` indexed fees came from trades
 * before it, and that share is split at the old weights, the rest at the current ones.
 */
export function splitPlatformFee(
  lamports: bigint,
  s: PlatformSplit,
  early?: { fees: bigint; total: bigint; split: PlatformSplit } | null,
): { holders: bigint; divvy: bigint } {
  const now = splitByWeights(lamports, { holders: s.holdersBps, divvy: s.divvyBps }, "divvy");
  if (!early || early.fees <= 0n || early.total <= 0n) return now;
  const old = (lamports * (early.fees < early.total ? early.fees : early.total)) / early.total;
  const a = splitByWeights(old, { holders: early.split.holdersBps, divvy: early.split.divvyBps }, "divvy");
  const b = splitByWeights(lamports - old, { holders: s.holdersBps, divvy: s.divvyBps }, "divvy");
  return { holders: a.holders + b.holders, divvy: a.divvy + b.divvy };
}

/** Splits a claimed fee into Divvy's buckets in proportion to the configured bps (protocol excluded). */
export function splitClaim(
  lamports: bigint,
  s: Pick<FeeSplitBps, "holdersBps" | "creatorBps" | "divvyBps">,
): { holders: bigint; creator: bigint; divvy: bigint } {
  return splitByWeights(lamports, { holders: s.holdersBps, creator: s.creatorBps, divvy: s.divvyBps }, "divvy");
}

export interface HolderBalanceIn {
  wallet: string;
  balance: bigint;
}

export interface Entitlement {
  wallet: string;
  amount: bigint;
}

/**
 * Pro-rata allocation of `total` across holders by balance. Each entitlement is floored; the sum of
 * the floors is ≤ total and the difference is returned as `dust` to carry into the next round.
 * Holders with a zero balance get nothing. Input order doesn't matter; output is sorted by wallet.
 */
export function proRata(total: bigint, holders: HolderBalanceIn[]): { items: Entitlement[]; dust: bigint } {
  if (total < 0n) throw new Error("negative total");
  const eligible = holders.filter((h) => h.balance > 0n).sort((a, b) => (a.wallet < b.wallet ? -1 : a.wallet > b.wallet ? 1 : 0));
  const supply = eligible.reduce((a, h) => a + h.balance, 0n);
  if (supply === 0n || total === 0n) return { items: [], dust: total };
  let paid = 0n;
  const items: Entitlement[] = [];
  for (const h of eligible) {
    const amount = (total * h.balance) / supply;
    if (amount > 0n) items.push({ wallet: h.wallet, amount });
    paid += amount;
  }
  return { items, dust: total - paid };
}

/** "0.50%" from 50 bps. */
export function bpsLabel(bps: number): string {
  return (bps / 100).toFixed(2) + "%";
}
