/**
 * Hourly dividend engine (HANDOFF §3.3). One run per hour at minute 0, resumed every 10 minutes
 * until the hour's rounds are delivered. Every step is idempotent:
 *
 *   A. claim the shared platform vault once per hour → VaultClaim (unique hour+dryRun)
 *   B. attribute it to coins from indexed TradeEvent.platform_fee → FeeAllocation
 *   C. per coin: carry the holders' bucket if under MIN_ROUND_USD, else open a PayoutRound
 *      (unique coin+hour+dryRun) and attach the allocations
 *   D. one Jupiter swap per dividend asset → SwapBatch (unique asset+hour+dryRun), shared pro rata
 *   E. per round: snapshot holders, exclude pool/Divvy/burn wallets and small holders, pro-rata
 *      entitlements, PayoutItems, and (live) Credits
 *   F. deliver (live only): see deliver.ts
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
import { deliverCredits } from "./deliver";
import { attributeClaim, classifyHolders, entitlements, isLate, quoteLooksWrong, shouldCarry, splitPlatformFee, splitSwapOutput } from "./plan";

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

export async function runPayouts(d: WorkerDeps, chain: PayoutChain, hour: Date, dryRun: boolean, now = () => new Date()): Promise<RunSummary> {
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

  const claim = await stepClaim(d, chain, hour, dryRun);
  await stepAttribute(d, chain, claim.id, dryRun);
  if (!dryRun && d.env.CPMM_CREATOR_FEES) await stepCpmmCreatorFees(d, chain);
  await stepOpenRounds(d, hour, dryRun, prices.solUsd);
  const swaps = await stepSwaps(d, chain, hour, dryRun, prices);
  await stepSnapshots(d, chain, hour, dryRun, prices.solUsd);
  if (!dryRun) await deliverCredits(d);
  await stepFinish(d, hour, dryRun, now());

  const rounds = await d.prisma.payoutRound.groupBy({ by: ["status"], where: { hour, dryRun }, _count: true });
  const count = (s: string) => rounds.find((r) => r.status === s)?._count ?? 0;
  const final = await d.prisma.vaultClaim.findUniqueOrThrow({ where: { id: claim.id } });
  return {
    hour: hour.toISOString(),
    dryRun,
    claimedLamports: final.lamports.toString(),
    unattributedLamports: final.unattributedLamports.toString(),
    rounds: { ok: count("ok"), carried: count("carried"), failed: count("failed"), late: count("late") },
    swaps,
  };
}

/* ---------- A. vault claim ---------- */

async function stepClaim(d: WorkerDeps, chain: PayoutChain, hour: Date, dryRun: boolean) {
  const key = { hour_dryRun: { hour, dryRun } };
  const existing = await d.prisma.vaultClaim.findUnique({ where: key });
  if (existing) return recoverClaim(d, chain, existing);

  const prev = await d.prisma.vaultClaim.findFirst({ where: { dryRun, attributedAt: { not: null } }, orderBy: { toSlot: "desc" } });
  const fromSlot = prev?.toSlot ?? 0n;

  if (dryRun) {
    // Simulated sweep: exactly the indexed fees since the last dry-run claim. The real vault balance is
    // logged so the two can be compared by hand.
    const toSlot = await chain.indexedSlot();
    const agg = await d.prisma.trade.aggregate({ where: { venue: "curve", slot: { gt: fromSlot, lte: toSlot } }, _sum: { platformFee: true } });
    const vault = await chain.vaultBalance().catch(() => -1n);
    d.log("payouts: dry-run vault claim", { hour, fromSlot, toSlot, indexed: agg._sum.platformFee ?? 0n, vaultBalance: vault });
    return d.prisma.vaultClaim.create({ data: { hour, dryRun, lamports: agg._sum.platformFee ?? 0n, fromSlot, toSlot } });
  }

  // Live: the row exists before the transaction is sent, so a crash can't lose a claim.
  let row = await d.prisma.vaultClaim.create({ data: { hour, dryRun, lamports: 0n, fromSlot, toSlot: fromSlot } });
  const r = await chain.claimVault(async (sig) => {
    row = await d.prisma.vaultClaim.update({ where: { id: row.id }, data: { sig } });
  });
  if (!r) {
    // Nothing in the vault: attribute up to what's indexed (all of it should be zero-fee).
    return d.prisma.vaultClaim.update({ where: { id: row.id }, data: { toSlot: await chain.indexedSlot() } });
  }
  return d.prisma.vaultClaim.update({ where: { id: row.id }, data: { lamports: r.lamports, toSlot: r.slot } });
}

/** A live claim row left by a crash: find out whether its transaction landed. */
async function recoverClaim(d: WorkerDeps, chain: PayoutChain, row: Prisma.VaultClaimGetPayload<object>) {
  if (row.dryRun || row.attributedAt || !row.sig || row.lamports > 0n) return row;
  const o = await chain.outcome(row.sig, "vault");
  if (o.status === "landed") return d.prisma.vaultClaim.update({ where: { id: row.id }, data: { lamports: o.delta, toSlot: o.slot } });
  if (o.status === "failed" || Date.now() - row.createdAt.getTime() > 5 * 60_000) {
    // Never landed: the vault still holds the fees; the next hour claims them.
    await d.alerts.send(`claim-lost-${row.id}`, "warn", `Vault claim ${row.sig} didn't land; fees roll into the next hour`);
    return d.prisma.vaultClaim.update({ where: { id: row.id }, data: { sig: null, toSlot: row.fromSlot } });
  }
  throw new Error(`vault claim ${row.sig} still pending; retrying later`);
}

/* ---------- B. attribution ---------- */

async function stepAttribute(d: WorkerDeps, chain: PayoutChain, claimId: string, dryRun: boolean) {
  const claim = await d.prisma.vaultClaim.findUniqueOrThrow({ where: { id: claimId } });
  if (claim.attributedAt) return;
  // Every trade the claim swept must be indexed first, or its fees would look unattributed.
  for (let i = 0; i < 36 && (await chain.indexedSlot()) < claim.toSlot; i++) await new Promise((r) => setTimeout(r, 5000));
  if ((await chain.indexedSlot()) < claim.toSlot) {
    await d.alerts.send("indexer-behind-claim", "critical", `Indexer is behind the vault claim (slot ${claim.toSlot}); payouts wait for it`);
    throw new Error("indexer behind the vault claim");
  }
  const fees = await d.prisma.trade.groupBy({
    by: ["coinId"],
    where: { venue: "curve", slot: { gt: claim.fromSlot, lte: claim.toSlot } },
    _sum: { platformFee: true },
  });
  const byCoin = new Map(fees.map((f) => [f.coinId, f._sum.platformFee ?? 0n]).filter(([, v]) => (v as bigint) > 0n) as [string, bigint][]);
  const a = attributeClaim(claim.lamports, byCoin);
  const tolerance = claim.lamports / 100n > 10_000_000n ? claim.lamports / 100n : 10_000_000n;
  if (a.shortfall || a.unattributed > tolerance) {
    await d.alerts.send(`attribution-${claim.id}`, "warn", `Vault claim ${claim.sig ?? "(dry-run)"}: ${a.shortfall ? "paid less than indexed fees" : `${a.unattributed} lamports not tied to any trade`}`);
  }
  await d.prisma.$transaction(async (tx) => {
    for (const [coinId, lamports] of a.perCoin) {
      const s = splitPlatformFee(lamports, d.params.fees);
      await tx.feeAllocation.create({ data: { coinId, vaultClaimId: claim.id, lamports, holdersLamports: s.holders, divvyLamports: s.divvy, dryRun } });
    }
    await tx.vaultClaim.update({ where: { id: claim.id }, data: { unattributedLamports: a.unattributed, attributedAt: new Date() } });
  }, TX_OPTS);
}

/* ---------- B2. CPMM creator fees of graduated coins (live, opt-in) ---------- */

async function stepCpmmCreatorFees(d: WorkerDeps, chain: PayoutChain) {
  const coins = await d.prisma.coin.findMany({ where: { status: "graduated", cpmmPool: { not: null } }, select: { id: true, cpmmPool: true } });
  for (const c of coins) {
    const pending = await chain.cpmmCreatorFees(c.cpmmPool!).catch(() => 0n);
    if (pending < 1_000_000n) continue; // not worth a transaction below 0.001 SOL
    let feeClaimId: string | null = null;
    const r = await chain.collectCpmmCreatorFees(c.cpmmPool!, c.id, async (sig) => {
      feeClaimId = (await d.prisma.feeClaim.create({ data: { coinId: c.id, kind: "cpmm_creator", sig, lamports: 0n } })).id;
    });
    if (!r || !feeClaimId) continue;
    const s = splitPlatformFee(r.lamports, d.params.fees);
    await d.prisma.$transaction([
      d.prisma.feeClaim.update({ where: { id: feeClaimId }, data: { lamports: r.lamports } }),
      d.prisma.feeAllocation.create({ data: { coinId: c.id, feeClaimId, lamports: r.lamports, holdersLamports: s.holders, divvyLamports: s.divvy } }),
    ]);
  }
}

/* ---------- C. rounds ---------- */

/** Dust (asset units) the coin's last round left undistributed. */
async function previousDust(d: WorkerDeps, coinId: string, hour: Date, dryRun: boolean): Promise<bigint> {
  const prev = await d.prisma.payoutRound.findFirst({ where: { coinId, dryRun, hour: { lt: hour } }, orderBy: { hour: "desc" }, select: { dustCarried: true } });
  return prev?.dustCarried ?? 0n;
}

async function stepOpenRounds(d: WorkerDeps, hour: Date, dryRun: boolean, solUsd: number) {
  const pending = await d.prisma.feeAllocation.groupBy({ by: ["coinId"], where: { roundId: null, dryRun }, _sum: { holdersLamports: true } });
  for (const p of pending) {
    const holders = p._sum.holdersLamports ?? 0n;
    if (holders <= 0n) continue;
    if (await d.prisma.payoutRound.findUnique({ where: { coinId_hour_dryRun: { coinId: p.coinId, hour, dryRun } } })) continue;
    const dust = await previousDust(d, p.coinId, hour, dryRun);
    if (shouldCarry(holders, solUsd, d.params.minRoundUsd)) {
      await d.prisma.payoutRound.create({
        data: { coinId: p.coinId, hour, dryRun, status: "carried", step: "delivered", carriedOutLamports: holders, dustCarried: dust, finishedAt: new Date() },
      });
      continue;
    }
    const fresh = await d.prisma.feeAllocation.aggregate({ where: { coinId: p.coinId, roundId: null, dryRun, createdAt: { gte: hour } }, _sum: { holdersLamports: true } });
    await d.prisma.$transaction(async (tx) => {
      const round = await tx.payoutRound.create({
        data: { coinId: p.coinId, hour, dryRun, status: "ok", step: "allocated", solIn: holders, carriedInLamports: holders - (fresh._sum.holdersLamports ?? 0n), dustCarried: dust },
      });
      const n = await tx.feeAllocation.updateMany({ where: { coinId: p.coinId, roundId: null, dryRun }, data: { roundId: round.id } });
      if (n.count === 0) throw new Error("allocations moved under us");
    }, TX_OPTS);
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
    const lamportsIn = group.reduce((a, r) => a + r.solIn, 0n);
    let batch = await d.prisma.swapBatch.upsert({
      where: { assetId_hour_dryRun: { assetId, hour, dryRun } },
      create: { assetId, hour, dryRun, lamportsIn },
      update: {},
    });
    const refuse = async (reason: string, severity: "warn" | "critical" = "warn") => {
      await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "skipped", error: reason } });
      for (const r of group) await detachRound(d, r, reason);
      await d.alerts.send(`swap-${asset.symbol}-${hour.toISOString()}`, severity, `${asset.symbol} swap for ${hour.toISOString()} not done: ${reason}. Holders' share carries to the next round.`);
    };

    if (batch.status === "sent" && batch.sig) {
      const o = await chain.outcome(batch.sig, { assetMint: asset.mint });
      if (o.status === "landed") batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "confirmed", assetOut: o.delta } });
      else if (o.status === "failed" || Date.now() - batch.updatedAt.getTime() > 5 * 60_000) batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "pending", sig: null } });
      else continue; // still in flight
    }

    if (batch.status === "pending") {
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
        await refuse(`price impact ${q.priceImpactBps} bps is over the ${d.params.maxSwapImpactBps} bps cap`);
        continue;
      }
      if (quoteLooksWrong({ lamportsIn, outAmount: q.outAmount, assetDecimals: asset.decimals, solUsd: prices.solUsd, assetUsd, maxImpactBps: d.params.maxSwapImpactBps })) {
        await refuse("the quote is off the reference price", "critical");
        continue;
      }
      if (dryRun) {
        batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "confirmed", assetOut: q.outAmount, minOut: q.minOut, priceImpactBps: q.priceImpactBps } });
      } else {
        if ((await chain.feeClaimerLamports()) < lamportsIn + 20_000_000n) {
          await d.alerts.send("fee-claimer-short", "critical", "Fee claimer holds less SOL than the holders' share it must swap");
          throw new Error("fee claimer balance below the swap amount");
        }
        try {
          const r = await chain.swap(asset.mint, lamportsIn, d.params.swapSlippageBps, async (sig) => {
            batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "sent", sig, minOut: q.minOut, priceImpactBps: q.priceImpactBps } });
          });
          batch = await d.prisma.swapBatch.update({ where: { id: batch.id }, data: { status: "confirmed", sig: r.sig, assetOut: r.assetOut } });
          swaps++;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // Definitely not landed (expired or failed on chain): carry. Otherwise the next run checks.
          if (/block height exceeded|failed on chain/i.test(msg)) await refuse(`swap failed (${msg.slice(0, 120)})`);
          else d.log("payouts: swap outcome unknown, will check next run", { asset: asset.symbol, error: msg });
          continue;
        }
      }
    }

    if (batch.status !== "confirmed") continue;
    const shares = splitSwapOutput(batch.assetOut, new Map(group.map((r) => [r.id, r.solIn])));
    const assetUsd = prices.byMint[asset.mint] ?? 0;
    await d.prisma.$transaction(
      group.map((r) =>
        d.prisma.payoutRound.update({
          where: { id: r.id },
          data: { step: "swapped", swapBatchId: batch.id, assetOut: shares.get(r.id) ?? 0n, swapSig: batch.sig, priceUsd: assetUsd ? assetUsd.toFixed(12) : null },
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
      const holders = await chain.holders(coin.mint);
      const rows = classifyHolders(holders, chain.excludedOwners({ mint: coin.mint, cpmmPool: coin.cpmmPool }), {
        priceSol: Number(coin.stats?.priceSol ?? 0),
        solUsd,
        coinDecimals: COIN_DECIMALS,
        minHolderUsd: d.params.minHolderUsd,
      });
      const { items, dust } = entitlements(r.assetOut + r.dustCarried, rows);
      const holderCount = rows.filter((x) => x.excludedReason === null || x.excludedReason === "small").length;
      await d.prisma.$transaction(async (tx) => {
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
        await tx.payoutRound.update({ where: { id: r.id }, data: { step: "snapshotted", holdersPaid: items.length, dustCarried: dust } });
        if (!dryRun) await tx.coinStats.updateMany({ where: { coinId: coin.id }, data: { holders: holderCount } });
      }, TX_OPTS);
    } catch (e) {
      d.log("payouts: snapshot failed, will retry", { coinId: coin.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
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
