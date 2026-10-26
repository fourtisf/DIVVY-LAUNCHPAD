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
