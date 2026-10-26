/**
 * Pure dividend-engine math (HANDOFF §3.3). No I/O here, so every rule can be checked against hand
 * calculations in tests. All amounts are bigint base units; nothing rounds up.
 */
import { proRata, splitByWeights, splitClaim, type DivvyParams } from "@divvy/shared";

/* ---------- 1. attribute a vault claim to coins ---------- */

export interface Attribution {
  /** Lamports per coin. Never more than that coin's indexed platform fees. */
  perCoin: Map<string, bigint>;
  /** Claimed minus attributed. Positive: fees we can't tie to a coin (missed trades). Kept by Divvy, alerted. */
  unattributed: bigint;
  /** Indexed fees exceeded what the vault paid; allocations were scaled down. */
  shortfall: boolean;
}

/**
 * The shared platform vault pays one lump sum; indexed TradeEvent.platform_fee says whose it is.
 * Each coin gets exactly its indexed fees when the claim covers them. If the claim is short (e.g. a
 * trade in the claim's own slot after the claim), coins are scaled down pro rata; the rest arrives
 * with the next claim.
 */
export function attributeClaim(claimed: bigint, feesByCoin: Map<string, bigint>): Attribution {
  const total = [...feesByCoin.values()].reduce((a, b) => a + b, 0n);
  if (total === 0n) return { perCoin: new Map(), unattributed: claimed, shortfall: false };
  if (claimed >= total) return { perCoin: new Map(feesByCoin), unattributed: claimed - total, shortfall: false };
  const { items, dust } = proRata(claimed, [...feesByCoin].map(([wallet, balance]) => ({ wallet, balance })));
  return { perCoin: new Map(items.map((i) => [i.wallet, i.amount])), unattributed: dust, shortfall: true };
}

/** Splits a coin's platform-fee lamports into the holders' and Divvy's buckets (remainder to Divvy). */
export function splitPlatformFee(lamports: bigint, fees: DivvyParams["fees"]): { holders: bigint; divvy: bigint } {
  return splitByWeights(lamports, { holders: fees.holdersBps, divvy: fees.divvyBps }, "divvy");
}

/**
 * Splits fees collected after graduation (the CPMM creator fee, the locked LP's fees and memecoin
 * sales) into holders', creator's and Divvy's buckets in the curve fee's proportions, 50 : 15 : 10
 * by default (owner decision 2026-10-26; docs/ECONOMICS.md). Remainder to Divvy.
 */
export function splitPoolFee(lamports: bigint, fees: DivvyParams["fees"]): { holders: bigint; creator: bigint; divvy: bigint } {
  return splitClaim(lamports, fees);
}

/* ---------- 2. thresholds ---------- */

export const lamportsUsd = (lamports: bigint, solUsd: number) => (Number(lamports) / 1e9) * solUsd;

/** Below MIN_ROUND_USD the holders' bucket carries forward; it isn't "late" (HANDOFF §3.3 step 3). */
export const shouldCarry = (holdersLamports: bigint, solUsd: number, minRoundUsd: number) => lamportsUsd(holdersLamports, solUsd) < minRoundUsd;

/**
 * How much of each coin's waiting holders' bucket this hour's swap can take. Everything when it fits
 * the budget; otherwise each coin gets the same fraction (floored), so a large backlog drains over
 * several hours without starving the other coins paying that asset (audit: an all-or-nothing batch
 * over the cap was refused every hour and stopped every coin paying that stock).
 */
export function budgetRounds(pending: Map<string, bigint>, budget: bigint): Map<string, bigint> {
  const total = [...pending.values()].reduce((a, b) => a + b, 0n);
  if (total <= budget) return new Map(pending);
  if (budget <= 0n) return new Map([...pending.keys()].map((k) => [k, 0n]));
  return new Map([...pending].map(([k, v]) => [k, (v * budget) / total]));
}

/* ---------- 3. share one swap between the rounds that funded it ---------- */

/** Asset units per round, pro rata to the lamports each put in. Flooring dust goes to the largest round. */
export function splitSwapOutput(assetOut: bigint, lamportsByRound: Map<string, bigint>): Map<string, bigint> {
  const { items, dust } = proRata(assetOut, [...lamportsByRound].map(([wallet, balance]) => ({ wallet, balance })));
  const out = new Map<string, bigint>([...lamportsByRound.keys()].map((k) => [k, 0n]));
  for (const i of items) out.set(i.wallet, i.amount);
  if (dust > 0n && lamportsByRound.size) {
    const [largest] = [...lamportsByRound].sort((a, b) => (a[1] === b[1] ? (a[0] < b[0] ? -1 : 1) : a[1] > b[1] ? -1 : 1))[0]!;
    out.set(largest, out.get(largest)! + dust);
  }
  return out;
}

/**
 * Sanity check on a quote against the Price API: refuses swaps that would get materially less
 * than the reference price implies (stale pools, manipulated routes).
 */
export function quoteLooksWrong(p: { lamportsIn: bigint; outAmount: bigint; assetDecimals: number; solUsd: number; assetUsd: number; maxImpactBps: number }): boolean {
  if (p.solUsd <= 0 || p.assetUsd <= 0) return true;
  const expected = (Number(p.lamportsIn) / 1e9) * p.solUsd / p.assetUsd;
  const got = Number(p.outAmount) / 10 ** p.assetDecimals;
  return got < expected * (1 - p.maxImpactBps / 10_000);
}

/** The least output a swap may accept: the reference price minus the impact cap, in asset base units. */
export function referenceFloor(p: { lamportsIn: bigint; assetDecimals: number; solUsd: number; assetUsd: number; maxImpactBps: number }): bigint {
  if (p.solUsd <= 0 || p.assetUsd <= 0) return BigInt(Number.MAX_SAFE_INTEGER);
  const expected = ((Number(p.lamportsIn) / 1e9) * p.solUsd) / p.assetUsd;
  return BigInt(Math.floor(expected * (1 - p.maxImpactBps / 10_000) * 10 ** p.assetDecimals));
}

/* ---------- 4. holders and entitlements ---------- */

export type ExcludedReason = "curve" | "pool" | "launcher" | "divvy" | "burn" | "small";

export interface SnapshotRow {
  wallet: string;
  balance: bigint;
  excludedReason: ExcludedReason | null;
}

/**
 * Applies the exclusions (curve and pool vault owners, Divvy wallets, burn) and the minimum holding
 * value (MIN_HOLDER_USD at the snapshot price) — HANDOFF §3.3 step 5.
 */
export function classifyHolders(
  holders: { owner: string; amount: bigint }[],
  excluded: Map<string, Exclude<ExcludedReason, "small">>,
  p: { priceSol: number; solUsd: number; coinDecimals: number; minHolderUsd: number },
): SnapshotRow[] {
  const unitUsd = p.priceSol * p.solUsd;
  return holders.map((h) => {
    const reason = excluded.get(h.owner);
    if (reason) return { wallet: h.owner, balance: h.amount, excludedReason: reason };
    const usd = (Number(h.amount) / 10 ** p.coinDecimals) * unitUsd;
    return { wallet: h.owner, balance: h.amount, excludedReason: usd < p.minHolderUsd ? "small" : null };
  });
}

/** Entitlements pro rata to balance among eligible holders; flooring dust is carried to the next round. */
export function entitlements(distributable: bigint, rows: SnapshotRow[]) {
  return proRata(distributable, rows.filter((r) => r.excludedReason === null).map((r) => ({ wallet: r.wallet, balance: r.balance })));
}

/* ---------- 5. delivery ---------- */

export type DeliveryAction = "send" | "send_create_ata" | "hold";

/**
 * HANDOFF §3.4. Wallets that already hold the asset's token account get their credit once it passes
 * AUTO_PUSH_MIN_USD. Under "push", wallets without one are sent too, but only once the credit is worth
 * PUSH_NEW_ATA_MIN_USD, so the payout vault never pays more rent than the dividend is worth. Under
 * "claim", they keep the credit and claim it, paying their own rent.
 */
export function deliveryAction(p: { delivery: "push" | "claim"; hasAta: boolean; creditUsd: number; autoPushMinUsd: number; pushNewAtaMinUsd: number }): DeliveryAction {
  if (p.hasAta) return p.creditUsd >= p.autoPushMinUsd ? "send" : "hold";
  if (p.delivery === "push" && p.creditUsd >= p.pushNewAtaMinUsd) return "send_create_ata";
  return "hold";
}

/** A round is late if it isn't delivered within the hour plus the grace period (HANDOFF §3.3 SLA). */
export const isLate = (hour: Date, now: Date, lateAfterSec: number) => now.getTime() > hour.getTime() + 3_600_000 + lateAfterSec * 1000;
