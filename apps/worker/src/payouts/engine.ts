/**
 * Hourly dividend engine (HANDOFF §3.3). One run per hour at minute 0, resumed every 10 minutes
 * until the hour's rounds are delivered. Every step is idempotent:
 *
 *   A. claim the shared platform vault once per hour → VaultClaim (unique hour+dryRun)
 *   B. attribute it to coins from indexed TradeEvent.platform_fee → FeeAllocation
 *   C. per coin: carry the holders' bucket if under MIN_ROUND_USD, else open a PayoutRound
 *      (unique coin+hour+dryRun) and attach the allocations. Each asset's swap has a budget (the
 *      hourly cap and an adaptive size limit); a bucket over its share is paid in part and the rest
 *      stays carried
 *   D. one Jupiter swap per dividend asset → SwapBatch (unique asset+hour+dryRun), shared pro rata
 *   E. per round: snapshot holders, exclude pool/Divvy/burn wallets and small holders, pro-rata
 *      entitlements, PayoutItems, and (live) Credits
 *   B2–B4. fees of graduated coins, collected and split 50 : 15 : 10: see poolfees.ts
 *   F. deliver (live only): see deliver.ts
 *   G. forward creators' shares of post-graduation fees (live only): see poolfees.ts
 *
 * Dry-run (the default, CLAUDE.md rule 7) runs A–E against real chain data without signing
 * anything: the vault claim is simulated from indexed fees and swaps are quotes.
 */
import type { Prisma } from "@divvy/db";
import { assertCanSend } from "@divvy/solana/live";
import { publishLive } from "@divvy/server";
import type { WorkerDeps } from "../deps";
import { refreshPaidStats } from "../stats";
import type { PayoutChain } from "./chain";
import { SwapRejected } from "./swapguard";
import { deliverCredits } from "./deliver";
import { dropPreSnapshot, readPreSnapshot } from "./presnapshot";
import { stepCpmmCreatorFees, stepCreatorForwards, stepLockedLpFees, stepMemecoinSales } from "./poolfees";
import { attributeClaim, budgetRounds, classifyHolders, entitlements, isLate, quoteLooksWrong, referenceFloor, shouldCarry, splitPlatformFee, splitSwapOutput } from "./plan";

const COIN_DECIMALS = 6;
const TX_OPTS = { timeout: 120_000, maxWait: 10_000 };

export interface RunSummary {
  hour: string;
  dryRun: boolean;
  claimedLamports: string;
  unattributedLamports: string;
  rounds: { ok: number; carried: number; failed: number; late: number };
  swaps: number;
}

export const topOfHour = (now = new Date()) => new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);

/**
 * `resumeOnly` finishes an earlier hour's open rounds without claiming or opening new ones there
 * (new money always goes to the current hour; audit: a resumed hour must not gain rounds).
 */
export async function runPayouts(d: WorkerDeps, chain: PayoutChain, hour: Date, dryRun: boolean, now = () => new Date(), opts: { resumeOnly?: boolean } = {}): Promise<RunSummary> {
  const mismatch = await chain.ratesMismatch();
  if (mismatch) {
    await d.alerts.send("payouts-rates", "critical", `Payouts stopped: ${mismatch}`, 3600);
    throw new Error(mismatch);
  }
  const prices = await d.prices();
  if (!prices.solUsd) {
    await d.alerts.send("payouts-no-price", "critical", "Payouts stopped: no SOL price in the cache", 3600);
    throw new Error("no SOL price");
  }
  if (!dryRun) assertCanSend(d.sol, "payouts");

  // Claims are attributed in order: an older one (indexer was behind) is finished before a new one
  // is made, so trade ranges never overlap and no claimed lamports are left unallocated (audit).
  await attributePending(d, chain, dryRun);
  if (!opts.resumeOnly) {
    const claim = await stepClaim(d, chain, hour, dryRun);
    await attributeVaultClaim(d, chain, claim.id);
    if (!dryRun && d.env.CPMM_CREATOR_FEES) await stepCpmmCreatorFees(d, chain);
    await stepLockedLpFees(d, chain, dryRun);
    if (!dryRun && (d.env.CPMM_CREATOR_FEES || d.env.LOCKED_LP_FEES)) await stepMemecoinSales(d, chain);
    await stepOpenRounds(d, hour, dryRun, prices.solUsd);
  }
  const swaps = await stepSwaps(d, chain, hour, dryRun, prices);
  await stepSnapshots(d, chain, hour, dryRun, prices.solUsd);
  if (!dryRun) await deliverCredits(d);
  if (!dryRun) await stepCreatorForwards(d, chain);
  await stepFinish(d, hour, dryRun, now());

  const rounds = await d.prisma.payoutRound.groupBy({ by: ["status"], where: { hour, dryRun }, _count: true });
  const count = (s: string) => rounds.find((r) => r.status === s)?._count ?? 0;
  const final = await d.prisma.vaultClaim.findUnique({ where: { hour_dryRun: { hour, dryRun } } });
  return {
    hour: hour.toISOString(),
    dryRun,
    claimedLamports: (final?.lamports ?? 0n).toString(),
    unattributedLamports: (final?.unattributedLamports ?? 0n).toString(),
    rounds: { ok: count("ok"), carried: count("carried"), failed: count("failed"), late: count("late") },
    swaps,
  };
}

/* ---------- A. vault claim ---------- */

const maxTradeId = async (d: WorkerDeps) => (await d.prisma.trade.aggregate({ _max: { id: true } }))._max.id ?? 0n;

async function stepClaim(d: WorkerDeps, chain: PayoutChain, hour: Date, dryRun: boolean) {
  const existing = await d.prisma.vaultClaim.findUnique({ where: { hour_dryRun: { hour, dryRun } } });
  if (existing) return existing;

  // The previous claim (attributed by now) ends where this one starts.
  const prev = await d.prisma.vaultClaim.findFirst({ where: { dryRun }, orderBy: { createdAt: "desc" } });
  if (prev && prev.toTradeId === null) throw new Error("previous vault claim isn't placed in the trade stream yet");
  const fromTradeId = prev?.toTradeId ?? 0n;
  const fromSlot = prev?.toSlot ?? 0n;

  if (dryRun) {
    // Simulated sweep: exactly the indexed fees since the last dry-run claim. The real vault balance is
    // logged so the two can be compared by hand (a gap means missed trades).
    const toTradeId = await maxTradeId(d);
    const toSlot = await chain.indexedSlot();
    const agg = await d.prisma.trade.aggregate({ where: { venue: "curve", id: { gt: fromTradeId, lte: toTradeId } }, _sum: { platformFee: true } });
    const vault = await chain.vaultBalance().catch(() => -1n);
    d.log("payouts: dry-run vault claim", { hour, fromTradeId, toTradeId, indexed: agg._sum.platformFee ?? 0n, vaultBalance: vault });
    if (vault === 0n) await alertEmptyVault(d, agg._sum.platformFee ?? 0n);
    return d.prisma.vaultClaim.create({ data: { hour, dryRun, lamports: agg._sum.platformFee ?? 0n, fromSlot, toSlot, fromTradeId, toTradeId } });
  }

  // Live: the row exists before the transaction is sent, so a crash can't lose a claim. The indexer
  // sets toTradeId when it reaches the claim transaction in the PlatformConfig stream.
  let row = await d.prisma.vaultClaim.create({ data: { hour, dryRun, lamports: 0n, fromSlot, toSlot: fromSlot, fromTradeId } });
  const r = await chain.claimVault(async (sig) => {
    row = await d.prisma.vaultClaim.update({ where: { id: row.id }, data: { sig } });
  });
  // Nothing in the vault: this claim covers no trades; they stay for the next one.
  if (!r) {
    const owed = await d.prisma.trade.aggregate({ where: { venue: "curve", id: { gt: fromTradeId } }, _sum: { platformFee: true } });
    await alertEmptyVault(d, owed._sum.platformFee ?? 0n);
    return d.prisma.vaultClaim.update({ where: { id: row.id }, data: { toTradeId: fromTradeId } });
  }
  return d.prisma.vaultClaim.update({ where: { id: row.id }, data: { lamports: r.lamports, toSlot: r.slot } });
}

/**
 * Indexed trades say platform fees are owed but the shared vault is empty: the fees aren't reaching
 * the vault (docs/AUDIT.md R2), so no holder would ever be paid. Small amounts can be rounding.
 */
async function alertEmptyVault(d: WorkerDeps, indexedLamports: bigint) {
  if (indexedLamports < 10_000_000n) return;
  await d.alerts.send("vault-empty", "critical", `The platform fee vault is empty, but indexed trades owe it ${indexedLamports} lamports since the last claim. Fees may not be reaching the vault (docs/AUDIT.md R2).`, 6 * 3600);
}

/** A live claim row left by a crash: find out whether its transaction landed. */
async function recoverClaim(d: WorkerDeps, chain: PayoutChain, row: Prisma.VaultClaimGetPayload<object>) {
  if (row.dryRun || row.attributedAt || row.lamports > 0n || row.toTradeId !== null) return row;
  const o = row.sig ? await chain.outcome(row.sig, "vault") : ({ status: "failed" } as const);
  if (o.status === "landed") return d.prisma.vaultClaim.update({ where: { id: row.id }, data: { lamports: o.delta, toSlot: o.slot } });
  if (o.status === "failed" || Date.now() - row.createdAt.getTime() > 5 * 60_000) {
    // Never sent or never landed: the vault still holds the fees and the next claim sweeps them.
    if (row.sig) await d.alerts.send(`claim-lost-${row.id}`, "warn", `Vault claim ${row.sig} didn't land; fees roll into the next claim`);
    return d.prisma.vaultClaim.update({ where: { id: row.id }, data: { sig: null, toTradeId: row.fromTradeId } });
  }
  throw new Error(`vault claim ${row.sig} still pending; retrying later`);
}

/* ---------- B. attribution ---------- */

async function attributePending(d: WorkerDeps, chain: PayoutChain, dryRun: boolean) {
  const open = await d.prisma.vaultClaim.findMany({ where: { dryRun, attributedAt: null }, orderBy: { createdAt: "asc" } });
  for (const c of open) {
    await recoverClaim(d, chain, c);
    await attributeVaultClaim(d, chain, c.id);
  }
}

/** Polling interval while waiting for the indexer or finality (tests shorten it). */
export const timing = { pollMs: 5000 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms === 5000 ? timing.pollMs : ms));

async function attributeVaultClaim(d: WorkerDeps, chain: PayoutChain, claimId: string) {
  let claim = await d.prisma.vaultClaim.findUniqueOrThrow({ where: { id: claimId } });
  if (claim.attributedAt) return;

  // Wait for the indexer to reach the claim transaction (it sets toTradeId). If it has gone past the
  // claim's slot without seeing it, place the claim by slot instead and say so.
  for (let i = 0; claim.toTradeId === null && i < 36; i++) {
    if ((await chain.indexedSlot()) > claim.toSlot) {
      const last = await d.prisma.trade.aggregate({ where: { slot: { lte: claim.toSlot } }, _max: { id: true } });
      const toTradeId = last._max.id ?? claim.fromTradeId;
      claim = await d.prisma.vaultClaim.update({ where: { id: claim.id }, data: { toTradeId: toTradeId > claim.fromTradeId ? toTradeId : claim.fromTradeId } });
      await d.alerts.send(`claim-by-slot-${claim.id}`, "warn", `Vault claim ${claim.sig} wasn't seen in the PlatformConfig stream; attributed by slot (trades in its own slot may shift by one claim)`);
      break;
    }
    await sleep(5000);
    claim = await d.prisma.vaultClaim.findUniqueOrThrow({ where: { id: claimId } });
  }
  if (claim.toTradeId === null) {
    await d.alerts.send("indexer-behind-claim", "critical", `Indexer hasn't reached vault claim ${claim.sig ?? claim.id}; payouts wait for it`);
    throw new Error("indexer behind the vault claim");
  }
  const range = { gt: claim.fromTradeId, lte: claim.toTradeId };

  // Only finalized trades count: a trade from a confirmed slot that was later dropped is removed
  // instead of taking a share of the money (audit).
  for (let i = 0; i < 12 && (await chain.finalizedSlot()) < claim.toSlot; i++) await sleep(5000);
  const feeTrades = await d.prisma.trade.findMany({ where: { venue: "curve", id: range, platformFee: { gt: 0n } }, select: { id: true, sig: true, slot: true } });
  const sigs = [...new Set(feeTrades.map((t) => t.sig))];
  const status = new Map<string, string>();
  for (let i = 0; i < sigs.length; i += 256) {
    const chunk = sigs.slice(i, i + 256);
    (await chain.signatureStatuses(chunk)).forEach((s, j) => status.set(chunk[j]!, s));
  }
  if ([...status.values()].some((s) => s === "pending")) throw new Error("some trades in the claim aren't finalized yet; retrying later");
  const dropped = feeTrades.filter((t) => status.get(t.sig) === "missing" || status.get(t.sig) === "failed");
  if (dropped.length) {
    await d.prisma.trade.deleteMany({ where: { id: { in: dropped.map((t) => t.id) } } });
    await d.alerts.send(`dropped-trades-${claim.id}`, "critical", `${dropped.length} indexed trade(s) never finalized and were removed before attributing claim ${claim.sig ?? claim.id}`);
  }

  const fees = await d.prisma.trade.groupBy({ by: ["coinId"], where: { venue: "curve", id: range }, _sum: { platformFee: true } });
  const byCoin = new Map(fees.map((f) => [f.coinId, f._sum.platformFee ?? 0n]).filter(([, v]) => (v as bigint) > 0n) as [string, bigint][]);
  const a = attributeClaim(claim.lamports, byCoin);
  const tolerance = claim.lamports / 100n > 10_000_000n ? claim.lamports / 100n : 10_000_000n;
  if (a.shortfall || a.unattributed > tolerance) {
    await d.alerts.send(`attribution-${claim.id}`, "warn", `Vault claim ${claim.sig ?? "(dry-run)"}: ${a.shortfall ? "paid less than indexed fees" : `${a.unattributed} lamports not tied to any trade`}`);
  }
  await d.prisma.$transaction(async (tx) => {
    for (const [coinId, lamports] of a.perCoin) {
      const s = splitPlatformFee(lamports, d.params.fees);
      await tx.feeAllocation.create({ data: { coinId, vaultClaimId: claim.id, lamports, holdersLamports: s.holders, divvyLamports: s.divvy, dryRun: claim.dryRun } });
    }
    await tx.vaultClaim.update({ where: { id: claim.id }, data: { unattributedLamports: a.unattributed, attributedAt: new Date() } });
  }, TX_OPTS);
}

/* ---------- C. rounds ---------- */

/** Dust (asset units) the coin's last round left undistributed. */
async function previousDust(d: WorkerDeps, coinId: string, hour: Date, dryRun: boolean): Promise<bigint> {
  const prev = await d.prisma.payoutRound.findFirst({ where: { coinId, dryRun, hour: { lt: hour }, step: "delivered" }, orderBy: { hour: "desc" }, select: { dustCarried: true } });
  return prev?.dustCarried ?? 0n;
}

const limitKey = (assetId: string, dryRun: boolean) => `divvy:swap-limit:${dryRun ? "dry" : "live"}:${assetId}`;
const MIN_SWAP_LIMIT = 10_000_000n;

/** This hour's largest swap for an asset: SWAP_BATCH_MAX_LAMPORTS, or less after impact refusals. */
async function swapLimit(d: WorkerDeps, assetId: string, dryRun: boolean): Promise<bigint> {
  const max = BigInt(d.env.SWAP_BATCH_MAX_LAMPORTS);
  const v = await d.redis.get(limitKey(assetId, dryRun));
  return v && BigInt(v) < max ? BigInt(v) : max;
}

/** A swap refused for its size: next hour tries half as much. */
async function shrinkSwapLimit(d: WorkerDeps, assetId: string, dryRun: boolean, lamportsIn: bigint) {
  const next = lamportsIn / 2n > MIN_SWAP_LIMIT ? lamportsIn / 2n : MIN_SWAP_LIMIT;
  await d.redis.set(limitKey(assetId, dryRun), next.toString(), "EX", 7 * 86_400);
}

/** A good swap: the limit grows back by half, up to SWAP_BATCH_MAX_LAMPORTS. */
async function growSwapLimit(d: WorkerDeps, assetId: string, dryRun: boolean) {
  const v = await d.redis.get(limitKey(assetId, dryRun));
  if (!v) return;
  const next = (BigInt(v) * 3n) / 2n;
  if (next >= BigInt(d.env.SWAP_BATCH_MAX_LAMPORTS)) await d.redis.del(limitKey(assetId, dryRun));
  else await d.redis.set(limitKey(assetId, dryRun), next.toString(), "EX", 7 * 86_400);
}

async function stepOpenRounds(d: WorkerDeps, hour: Date, dryRun: boolean, solUsd: number) {
  const pending = await d.prisma.feeAllocation.groupBy({ by: ["coinId"], where: { roundId: null, dryRun }, _sum: { holdersLamports: true } });
  const ready = new Map<string, bigint>();
  for (const p of pending) {
    const holders = p._sum.holdersLamports ?? 0n;
    if (holders <= 0n) continue;
    if (await d.prisma.payoutRound.findUnique({ where: { coinId_hour_dryRun: { coinId: p.coinId, hour, dryRun } } })) continue;
    // Rounds of one coin run in order (each carries the previous one's dust): while an earlier round is
    // unfinished, this hour's money waits (audit: dust could otherwise be paid twice).
    if (await d.prisma.payoutRound.findFirst({ where: { coinId: p.coinId, dryRun, hour: { lt: hour }, step: { not: "delivered" } }, select: { id: true } })) continue;
    ready.set(p.coinId, holders);
  }
  if (!ready.size) return;

  // Budgets: what's left of the hourly swap cap, and each asset's size limit less what this hour's
  // rounds already hold.
  const opened = await d.prisma.payoutRound.findMany({ where: { hour, dryRun, status: "ok" }, select: { solIn: true, coin: { select: { dividendAssetId: true } } } });
  let capLeft = BigInt(d.env.SWAP_HOURLY_CAP_LAMPORTS) - opened.reduce((a, r) => a + r.solIn, 0n);
  const assetOf = new Map((await d.prisma.coin.findMany({ where: { id: { in: [...ready.keys()] } }, select: { id: true, dividendAssetId: true } })).map((c) => [c.id, c.dividendAssetId]));
  const byAsset = new Map<string, Map<string, bigint>>();
  for (const [coinId, holders] of ready) {
    const a = assetOf.get(coinId)!;
    byAsset.set(a, (byAsset.get(a) ?? new Map()).set(coinId, holders));
  }

  for (const [assetId, coins] of byAsset) {
    const used = opened.filter((r) => r.coin.dividendAssetId === assetId).reduce((a, r) => a + r.solIn, 0n);
    const room = (await swapLimit(d, assetId, dryRun)) - used;
    const budget = room < capLeft ? room : capLeft;
    const takes = budgetRounds(coins, budget > 0n ? budget : 0n);
    const total = [...coins.values()].reduce((a, b) => a + b, 0n);
    if (total > budget) {
      await d.alerts.send(`swap-budget-${assetId}-${hour.toISOString()}`, "warn", `Holders' money waiting for asset ${assetId} (${total} lamports) is over this hour's swap budget (${budget > 0n ? budget : 0n}); paying part now, the rest carries`);
    }
    for (const [coinId, holders] of coins) {
      const take = takes.get(coinId) ?? 0n;
      const dust = await previousDust(d, coinId, hour, dryRun);
      if (shouldCarry(take, solUsd, d.params.minRoundUsd)) {
        await d.prisma.payoutRound.create({
          data: { coinId, hour, dryRun, status: "carried", step: "delivered", carriedOutLamports: holders, dustCarried: dust, finishedAt: new Date() },
        });
        await dropPreSnapshot(d, hour, coinId);
        continue;
      }
      const fresh = await d.prisma.feeAllocation.aggregate({ where: { coinId, roundId: null, dryRun, createdAt: { gte: hour } }, _sum: { holdersLamports: true } });
      const carriedIn = holders - (fresh._sum.holdersLamports ?? 0n);
      await d.prisma.$transaction(async (tx) => {
        const round = await tx.payoutRound.create({
          data: { coinId, hour, dryRun, status: "ok", step: "allocated", solIn: take, carriedInLamports: carriedIn < take ? carriedIn : take, carriedOutLamports: holders - take, dustCarried: dust },
        });
        // Oldest money first. The allocation that crosses the budget is split: the part that fits
        // funds this round, the rest stays carried as its own row.
        const allocs = await tx.feeAllocation.findMany({ where: { coinId, roundId: null, dryRun }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
        if (allocs.reduce((a, x) => a + x.holdersLamports, 0n) !== holders) throw new Error("allocations moved under us");
        let left = take;
        const whole: string[] = [];
        for (const a of allocs) {
          if (left === 0n) break;
          if (a.holdersLamports <= left) {
            whole.push(a.id);
            left -= a.holdersLamports;
          } else {
            await tx.feeAllocation.update({ where: { id: a.id }, data: { holdersLamports: left, roundId: round.id } });
            await tx.feeAllocation.create({ data: { coinId, lamports: 0n, holdersLamports: a.holdersLamports - left, divvyLamports: 0n, dryRun, createdAt: a.createdAt } });
            left = 0n;
          }
        }
        await tx.feeAllocation.updateMany({ where: { id: { in: whole } }, data: { roundId: round.id } });
      }, TX_OPTS);
      capLeft -= take;
    }
  }
}

/** Gives a round's lamports back to the carry pool (swap refused or failed). */
async function detachRound(d: WorkerDeps, round: { id: string; solIn: bigint }, reason: string) {
  await d.prisma.$transaction([
    d.prisma.feeAllocation.updateMany({ where: { roundId: round.id }, data: { roundId: null } }),
    d.prisma.payoutRound.update({
      where: { id: round.id },
      data: { status: "carried", step: "delivered", error: reason, solIn: 0n, carriedOutLamports: round.solIn, finishedAt: new Date() },
    }),
  ]);
}

/* ---------- D. swaps ---------- */

async function stepSwaps(d: WorkerDeps, chain: PayoutChain, hour: Date, dryRun: boolean, prices: { solUsd: number; byMint: Record<string, number> }): Promise<number> {
  const rounds = await d.prisma.payoutRound.findMany({ where: { hour, dryRun, step: "allocated" }, include: { coin: { include: { dividendAsset: true } } } });
  const byAsset = new Map<string, typeof rounds>();
  for (const r of rounds) byAsset.set(r.coin.dividendAssetId, [...(byAsset.get(r.coin.dividendAssetId) ?? []), r]);
  let swaps = 0;

  for (const [assetId, group] of byAsset) {
    const asset = group[0]!.coin.dividendAsset;
    // A batch belongs to the rounds that funded it, fixed when it's created. A round that turns up
    // later in the same hour is carried instead of sharing an output it didn't pay for (audit).
    let batch =
      (await d.prisma.swapBatch.findUnique({ where: { assetId_hour_dryRun: { assetId, hour, dryRun } } })) ??
      (await d.prisma.$transaction(async (tx) => {
        const b = await tx.swapBatch.create({ data: { assetId, hour, dryRun, lamportsIn: group.reduce((a, r) => a + r.solIn, 0n) } });
        await tx.payoutRound.updateMany({ where: { id: { in: group.map((r) => r.id) }, step: "allocated", swapBatchId: null }, data: { swapBatchId: b.id } });
        return b;
      }, TX_OPTS));
    const members = await d.prisma.payoutRound.findMany({ where: { swapBatchId: batch.id, step: "allocated" } });
    for (const r of group) if (!members.some((m) => m.id === r.id)) await detachRound(d, r, "arrived after this hour's swap");
    if (!members.length) continue;
    const lamportsIn = batch.lamportsIn;

    const refuse = async (reason: string, severity: "warn" | "critical" = "warn") => {
      await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "skipped", error: reason } });
      for (const r of members) await detachRound(d, r, reason);
      await d.alerts.send(`swap-${asset.symbol}-${hour.toISOString()}`, severity, `${asset.symbol} swap for ${hour.toISOString()} not done: ${reason}. Holders' share carries to the next round.`);
    };

    if (batch.status === "skipped") {
      for (const r of members) await detachRound(d, r, batch.error ?? "swap skipped");
      continue;
    }
    if (batch.status === "sent") {
      if (batch.sig) {
        // Decided from the chain, never from a send error: a "block height exceeded" can hide a swap
        // that landed (audit). After 5 minutes the blockhash has long expired.
        const o = await chain.outcome(batch.sig, { assetMint: asset.mint });
        if (o.status === "landed") batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "confirmed", assetOut: o.delta } });
        else if (o.status === "failed" || Date.now() - batch.updatedAt.getTime() > 5 * 60_000) batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "pending", sig: null } });
        else continue;
      } else if (Date.now() - batch.updatedAt.getTime() > 5 * 60_000) {
        // Claimed by a run that died before signing.
        batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "pending" } });
      } else continue;
    }

    if (batch.status === "pending") {
      // Claim the batch so two runs never swap it twice.
      const claimed = await d.prisma.swapBatch.updateMany({ where: { id: batch.id, status: "pending" }, data: { status: "sent", sig: null } });
      if (claimed.count !== 1) continue;
      batch = await d.prisma.swapBatch.findUniqueOrThrow({ where: { id: batch.id } });
      const info = await chain.mintInfo(asset.mint);
      if (info.paused) {
        await refuse("the asset's token is paused by its issuer");
        continue;
      }
      if (!dryRun && info.transferHookProgram) {
        await refuse("the asset's transfer hook is enabled; payouts can't send it yet", "critical");
        continue;
      }
      const q = await chain.quote(asset.mint, lamportsIn, d.params.swapSlippageBps).catch((e: Error) => e);
      if (q instanceof Error) {
        await refuse(`no route (${q.message.slice(0, 120)})`);
        continue;
      }
      const assetUsd = prices.byMint[asset.mint] ?? 0;
      if (q.priceImpactBps > d.params.maxSwapImpactBps) {
        await shrinkSwapLimit(d, assetId, dryRun, lamportsIn);
        await refuse(`price impact ${q.priceImpactBps} bps is over the ${d.params.maxSwapImpactBps} bps cap; next hour's swap will be half the size`);
        continue;
      }
      const ref = { lamportsIn, assetDecimals: asset.decimals, solUsd: prices.solUsd, assetUsd, maxImpactBps: d.params.maxSwapImpactBps };
      if (quoteLooksWrong({ ...ref, outAmount: q.outAmount })) {
        await shrinkSwapLimit(d, assetId, dryRun, lamportsIn);
        await refuse("the quote is off the reference price", "critical");
        continue;
      }
      if (dryRun) {
        batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "confirmed", assetOut: q.outAmount, minOut: q.minOut, priceImpactBps: q.priceImpactBps } });
        await growSwapLimit(d, assetId, dryRun);
      } else {
        // Hourly spend cap on the fee claimer's swaps (HANDOFF §9).
        const capKey = `divvy:swap-spend:${hour.toISOString()}`;
        const spent = BigInt(await d.redis.incrby(capKey, Number(lamportsIn)));
        await d.redis.expire(capKey, 7200);
        if (spent > BigInt(d.env.SWAP_HOURLY_CAP_LAMPORTS)) {
          await d.redis.decrby(capKey, Number(lamportsIn));
          await refuse(`over the hourly swap cap of ${d.env.SWAP_HOURLY_CAP_LAMPORTS} lamports`, "critical");
          continue;
        }
        if ((await chain.feeClaimerLamports()) < lamportsIn + 20_000_000n) {
          await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "pending" } });
          await d.alerts.send("fee-claimer-short", "critical", "Fee claimer holds less SOL than the holders' share it must swap");
          throw new Error("fee claimer balance below the swap amount");
        }
        let signed = false;
        try {
          const r = await chain.swap(asset.mint, lamportsIn, d.params.swapSlippageBps, { minOutFloor: referenceFloor(ref), maxImpactBps: d.params.maxSwapImpactBps }, async (sig) => {
            signed = true;
            batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { sig, minOut: q.minOut, priceImpactBps: q.priceImpactBps } });
          });
          batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "confirmed", sig: r.sig, assetOut: r.assetOut } });
          if (r.assetOut < batch.minOut) await d.alerts.send(`swap-short-${batch.id}`, "critical", `${asset.symbol} swap ${r.sig} delivered ${r.assetOut}, below its minimum ${batch.minOut}`);
          else await growSwapLimit(d, assetId, dryRun);
          swaps++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          if (e instanceof SwapRejected) await refuse(`swap refused: ${msg.slice(0, 160)}`, "critical");
          else if (!signed) await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "pending" } });
          else if (/failed on chain/i.test(msg)) await refuse(`swap failed (${msg.slice(0, 120)})`);
          // Otherwise the outcome is unknown: it stays "sent" and the next run asks the chain.
          d.log("payouts: swap not confirmed", { asset: asset.symbol, error: msg });
          continue;
        }
      }
    }

    if (batch.status !== "confirmed") continue;
    const shares = splitSwapOutput(batch.assetOut, new Map(members.map((r) => [r.id, r.solIn])));
    const assetUsd = prices.byMint[asset.mint] ?? 0;
    await d.prisma.$transaction(
      members.map((r) =>
        d.prisma.payoutRound.update({
          where: { id: r.id },
          data: { step: "swapped", assetOut: shares.get(r.id) ?? 0n, swapSig: batch.sig, priceUsd: assetUsd ? assetUsd.toFixed(12) : null },
        }),
      ),
    );
  }
  return swaps;
}

/* ---------- E. snapshots and entitlements ---------- */

async function stepSnapshots(d: WorkerDeps, chain: PayoutChain, hour: Date, dryRun: boolean, solUsd: number) {
  const rounds = await d.prisma.payoutRound.findMany({ where: { hour, dryRun, step: "swapped" }, include: { coin: { include: { stats: true } } } });
  for (const r of rounds) {
    const coin = r.coin;
    if (!coin.mint) continue;
    try {
      const holders = await holdersForRound(d, chain, coin.id, coin.mint, hour);
      const rows = classifyHolders(holders, chain.excludedOwners({ mint: coin.mint, cpmmPool: coin.cpmmPool }), {
        priceSol: Number(coin.stats?.priceSol ?? 0),
        solUsd,
        coinDecimals: COIN_DECIMALS,
        minHolderUsd: d.params.minHolderUsd,
      });
      const { items, dust } = entitlements(r.assetOut + r.dustCarried, rows);
      const holderCount = rows.filter((x) => x.excludedReason === null || x.excludedReason === "small").length;
      await d.prisma.$transaction(async (tx) => {
        // Only one run may credit a round (audit): the step moves first, conditionally.
        const moved = await tx.payoutRound.updateMany({ where: { id: r.id, step: "swapped" }, data: { step: "snapshotted", holdersPaid: items.length, dustCarried: dust } });
        if (moved.count !== 1) return;
        await tx.holderBalance.createMany({ data: rows.map((x) => ({ coinId: coin.id, wallet: x.wallet, balance: x.balance, snapshotHour: hour, excludedReason: x.excludedReason })), skipDuplicates: true });
        await tx.payoutItem.createMany({ data: items.map((i) => ({ roundId: r.id, wallet: i.wallet, amountAsset: i.amount, status: "credited" as const })), skipDuplicates: true });
        if (!dryRun && items.length) {
          // One statement for every credit: INSERT ... ON CONFLICT add.
          const wallets = items.map((i) => i.wallet);
          const amounts = items.map((i) => i.amount.toString());
          await tx.$executeRaw`
            INSERT INTO "Credit" (wallet, "assetId", amount, "updatedAt")
            SELECT w, ${coin.dividendAssetId}, a::bigint, now() FROM unnest(${wallets}::text[], ${amounts}::text[]) AS t(w, a)
            ON CONFLICT (wallet, "assetId") DO UPDATE SET amount = "Credit".amount + EXCLUDED.amount, "updatedAt" = now()`;
        }
        if (!dryRun) await tx.coinStats.updateMany({ where: { coinId: coin.id }, data: { holders: holderCount } });
      }, TX_OPTS);
      await dropPreSnapshot(d, hour, coin.id);
    } catch (e) {
      d.log("payouts: snapshot failed, will retry", { coinId: coin.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
}

/** Total supply of every Divvy coin (SDK curve defaults, docs/VERIFIED.md item 8). */
const COIN_SUPPLY = 1_000_000_000_000_000n;

/**
 * Holders for a round: the snapshot now, capped per wallet by the random mid-hour snapshot when one
 * was taken (presnapshot.ts), so buying just before the round and selling right after earns nothing.
 * A paged snapshot that adds up to more than the supply was taken while balances moved: retry.
 */
export async function holdersForRound(d: WorkerDeps, chain: PayoutChain, coinId: string, mint: string, hour: Date) {
  const now = await chain.holders(mint);
  const total = now.reduce((a, h) => a + h.amount, 0n);
  if (total > COIN_SUPPLY) throw new Error(`holder snapshot adds up to ${total}, more than the supply`);
  const pre = await readPreSnapshot(d, hour, coinId);
  if (!pre) return now;
  return now.map((h) => ({ owner: h.owner, amount: h.amount < (pre.get(h.owner) ?? 0n) ? h.amount : (pre.get(h.owner) ?? 0n) }));
}

/* ---------- finish: SLA, receipts, stats ---------- */

async function stepFinish(d: WorkerDeps, hour: Date, dryRun: boolean, now: Date) {
  const done = await d.prisma.payoutRound.findMany({ where: { hour, dryRun, step: "snapshotted" }, include: { coin: { include: { dividendAsset: true } } } });
  for (const r of done) {
    const late = isLate(hour, now, d.params.lateAfterSec);
    await d.prisma.payoutRound.update({ where: { id: r.id }, data: { step: "delivered", status: late ? "late" : "ok", finishedAt: now } });
    if (!dryRun && r.coin.mint) {
      const a = r.coin.dividendAsset;
      const paid = (await d.prisma.payoutItem.aggregate({ where: { roundId: r.id }, _sum: { amountAsset: true } }))._sum.amountAsset ?? 0n;
      const ui = Number(paid) / 10 ** a.decimals;
      await publishLive(d.redis, {
        type: "payout_round", at: now.toISOString(), mint: r.coin.mint, ticker: r.coin.ticker, imageUrl: r.coin.imageUrl,
        assetSymbol: a.symbol, amount: { raw: paid.toString(), decimals: a.decimals, ui }, usd: ui * Number(r.priceUsd ?? 0), wallets: r.holdersPaid,
      });
    }
  }
  // Rounds still open past the deadline are late: shown red on the meters and alerted.
  if (isLate(hour, now, d.params.lateAfterSec)) {
    const stuck = await d.prisma.payoutRound.findMany({ where: { hour, dryRun, step: { not: "delivered" }, status: { not: "late" } }, include: { coin: true } });
    for (const r of stuck) {
      await d.prisma.payoutRound.update({ where: { id: r.id }, data: { status: "late" } });
      if (!dryRun) await publishLive(d.redis, { type: "meter_status", at: now.toISOString(), mint: r.coin.mint, status: "late" });
    }
    if (stuck.length) await d.alerts.send(`late-${hour.toISOString()}-${dryRun}`, "critical", `${stuck.length} payout round(s) for ${hour.toISOString()} are late${dryRun ? " (dry-run)" : ""}`);
  }
  if (!dryRun) await refreshPaidStats(d, [...new Set(done.map((r) => r.coinId))]);
}
