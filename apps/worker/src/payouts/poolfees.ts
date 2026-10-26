/**
 * Fees of graduated coins (owner decision 2026-10-26: everything goes to Divvy first and is split
 * 50 : 15 : 10 between holders, creator and Divvy, like the curve fee). Steps of the hourly run:
 *
 *   B2. the CPMM creator fee, when platform_cp_creator is the fee claimer (CPMM_CREATOR_FEES)
 *   B3. the locked LP's fees, collected with the Fee Key (LOCKED_LP_FEES; otherwise only simulated)
 *   B4. memecoin from B2 and B3, sold for SOL in the coin's own pool
 *   G.  creators' shares forwarded in SOL once they reach CREATOR_FORWARD_MIN_LAMPORTS
 *
 * Each collection is recorded at signing (FeeClaim with lamports 0) and completed after it lands,
 * so a crash in between is settled from the chain on a later run.
 */
import type { FeeClaimKind } from "@divvy/db";
import type { WorkerDeps } from "../deps";
import type { PayoutChain } from "./chain";
import { splitPoolFee } from "./plan";

const STALE_MS = 5 * 60_000;

/**
 * Runs one coin's step. A failure (Raydium's API down, an RPC error) is alerted and skipped, so it
 * never holds up the hour's payouts; anything already signed is settled by a later run.
 */
async function forCoin(d: WorkerDeps, step: string, c: { id: string; ticker?: string }, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    await d.alerts.send(`${step}-${c.id}`, "warn", `${step} failed for ${c.ticker ? `$${c.ticker}` : c.id}: ${String(e).slice(0, 300)}`, 3600);
  }
}

/** FeeClaim lamports + the coin's FeeAllocation, in one transaction. */
async function recordPoolFee(d: WorkerDeps, feeClaimId: string, coinId: string, lamports: bigint, memecoinAmount?: bigint) {
  const s = splitPoolFee(lamports, d.params.fees);
  await d.prisma.$transaction([
    d.prisma.feeClaim.update({ where: { id: feeClaimId }, data: { lamports, ...(memecoinAmount !== undefined ? { memecoinAmount } : {}) } }),
    d.prisma.feeAllocation.create({ data: { coinId, feeClaimId, lamports, holdersLamports: s.holders, creatorLamports: s.creator, divvyLamports: s.divvy } }),
  ]);
}

/** Collections a crash left unrecorded (row made at signing, no allocation yet): ask the chain. */
async function settleStale(d: WorkerDeps, chain: PayoutChain, kind: FeeClaimKind) {
  const stale = await d.prisma.feeClaim.findMany({ where: { kind, lamports: 0n, ts: { lt: new Date(Date.now() - STALE_MS) } } });
  for (const fc of stale) {
    if (await d.prisma.feeAllocation.findFirst({ where: { feeClaimId: fc.id } })) continue;
    const o = await chain.outcome(fc.sig, "wsol");
    if (o.status === "landed") await recordPoolFee(d, fc.id, fc.coinId, o.delta > 0n ? o.delta : 0n);
    else if (o.status === "failed") await d.prisma.feeClaim.delete({ where: { id: fc.id } });
    // unknown: not found yet; a signed transaction past its blockhash never lands, so ask again next run
    else if (Date.now() - fc.ts.getTime() > 3_600_000) await d.prisma.feeClaim.delete({ where: { id: fc.id } });
  }
}

type Graduated = { id: string; ticker: string; mint: string; cpmmPool: string; feeKeyMint: string | null; graduatedAt: Date | null };

async function graduatedCoins(d: WorkerDeps): Promise<Graduated[]> {
  const rows = await d.prisma.coin.findMany({
    where: { status: "graduated", cpmmPool: { not: null }, mint: { not: null } },
    select: { id: true, ticker: true, mint: true, cpmmPool: true, feeKeyMint: true, graduatedAt: true },
  });
  return rows.map((r) => ({ ...r, mint: r.mint!, cpmmPool: r.cpmmPool! }));
}

/* ---------- B2. CPMM creator fees (live, opt-in) ---------- */

export async function stepCpmmCreatorFees(d: WorkerDeps, chain: PayoutChain) {
  await settleStale(d, chain, "cpmm_creator");
  for (const c of await graduatedCoins(d)) {
    await forCoin(d, "CPMM creator fee", c, async () => {
      const pending = await chain.cpmmCreatorFees(c.cpmmPool);
      if (pending < 1_000_000n) return; // not worth a transaction below 0.001 SOL
      let feeClaimId: string | null = null;
      const r = await chain.collectCpmmCreatorFees(c.cpmmPool, c.id, async (sig) => {
        feeClaimId = (await d.prisma.feeClaim.create({ data: { coinId: c.id, kind: "cpmm_creator", sig, lamports: 0n } })).id;
      });
      if (r && feeClaimId) await recordPoolFee(d, feeClaimId, c.id, r.lamports);
    });
  }
}

/* ---------- B3. locked-LP fees ---------- */

/**
 * Finds each graduated coin's Fee Key once, then collects its fees. In dry-run, or while
 * LOCKED_LP_FEES is off, it only simulates and logs what it would collect: that is how the first
 * graduated coin checks the closed-source lock program before anything is signed.
 */
export async function stepLockedLpFees(d: WorkerDeps, chain: PayoutChain, dryRun: boolean) {
  const coins = await graduatedCoins(d);
  if (!coins.length) return;
  const missing = coins.filter((c) => !c.feeKeyMint);
  if (missing.length) {
    let found = new Map<string, string>();
    try {
      found = await chain.feeKeysByPool(missing.map((c) => c.cpmmPool));
    } catch (e) {
      await d.alerts.send("lplock-discovery", "warn", `Looking up Fee Keys failed: ${String(e).slice(0, 300)}`, 3600);
    }
    for (const c of missing) {
      const nft = found.get(c.cpmmPool);
      if (nft) {
        await d.prisma.coin.update({ where: { id: c.id }, data: { feeKeyMint: nft } });
        c.feeKeyMint = nft;
        d.log("payouts: Fee Key found", { coinId: c.id, cpmmPool: c.cpmmPool, feeKeyMint: nft });
      } else if (c.graduatedAt && Date.now() - c.graduatedAt.getTime() > 3_600_000) {
        await d.alerts.send(`lplock-missing-${c.id}`, "warn", `${c.ticker}: the fee claimer holds no Fee Key for pool ${c.cpmmPool}. Is PlatformConfig.platform_lock_nft_wallet the fee claimer?`, 86_400);
      }
    }
  }

  const simulateOnly = dryRun || !d.env.LOCKED_LP_FEES;
  if (!simulateOnly) await settleStale(d, chain, "cpmm_locked_lp");
  for (const c of coins) {
    if (!c.feeKeyMint) continue;
    const coin = { ...c, feeKeyMint: c.feeKeyMint };
    if (simulateOnly) {
      try {
        const r = await chain.harvestLockedLp(coin, true, async () => {});
        if (r) d.log("payouts: locked-LP fees (simulated, nothing signed)", { coinId: c.id, lpFeeAmount: r.lpFeeAmount, lamports: r.lamports, memecoin: r.memecoin });
      } catch (e) {
        d.log("payouts: locked-LP simulation failed", { coinId: c.id, error: String(e) });
      }
      continue;
    }
    await forCoin(d, "Locked-LP fee collection", c, async () => {
      let feeClaimId: string | null = null;
      const r = await chain.harvestLockedLp(coin, false, async (sig) => {
        feeClaimId = (await d.prisma.feeClaim.create({ data: { coinId: c.id, kind: "cpmm_locked_lp", sig, lamports: 0n } })).id;
      });
      if (r && feeClaimId) await recordPoolFee(d, feeClaimId, c.id, r.lamports, r.memecoin);
    });
  }
}

/* ---------- B4. memecoin sales (live, when B2 or B3 runs) ---------- */

export async function stepMemecoinSales(d: WorkerDeps, chain: PayoutChain) {
  await settleStale(d, chain, "memecoin_sale");
  for (const c of await graduatedCoins(d)) {
    await forCoin(d, "Memecoin sale", c, async () => {
      const balance = await chain.memecoinBalance(c.mint);
      if (balance === 0n) return;
      let feeClaimId: string | null = null;
      const r = await chain.sellMemecoin(c, balance, async (sig) => {
        feeClaimId = (await d.prisma.feeClaim.create({ data: { coinId: c.id, kind: "memecoin_sale", sig, lamports: 0n, memecoinSwapSig: sig } })).id;
      });
      if (r && feeClaimId) await recordPoolFee(d, feeClaimId, c.id, r.lamports, r.sold);
    });
  }
}

/* ---------- G. creators' shares (live) ---------- */

export async function stepCreatorForwards(d: WorkerDeps, chain: PayoutChain) {
  // Transfers signed but not confirmed by a crash: landed ones are kept, the rest are undone so the
  // share is owed again. Past 5 minutes the blockhash has expired, so "missing" can't land later.
  const stale = await d.prisma.creatorTransfer.findMany({ where: { status: "sent", createdAt: { lt: new Date(Date.now() - STALE_MS) } } });
  if (stale.length) {
    const st = await chain.signatureStatuses(stale.map((t) => t.sig));
    for (const [i, t] of stale.entries()) {
      if (st[i] === "finalized") await d.prisma.creatorTransfer.update({ where: { id: t.id }, data: { status: "landed" } });
      else if (st[i] === "failed" || st[i] === "missing") {
        await d.prisma.$transaction([
          d.prisma.feeAllocation.updateMany({ where: { creatorTransferId: t.id }, data: { creatorTransferId: null } }),
          d.prisma.creatorTransfer.delete({ where: { id: t.id } }),
        ]);
      }
    }
  }

  const owed = { dryRun: false, creatorTransferId: null, creatorLamports: { gt: 0n } };
  const byCoin = await d.prisma.feeAllocation.groupBy({ by: ["coinId"], where: owed, _sum: { creatorLamports: true } });
  for (const g of byCoin) {
    if ((g._sum.creatorLamports ?? 0n) < BigInt(d.env.CREATOR_FORWARD_MIN_LAMPORTS)) continue;
    await forCoin(d, "Creator forward", { id: g.coinId }, async () => {
      const coin = await d.prisma.coin.findUnique({ where: { id: g.coinId }, select: { creatorWallet: true } });
      if (!coin) return;
      const rows = await d.prisma.feeAllocation.findMany({ where: { ...owed, coinId: g.coinId }, select: { id: true, creatorLamports: true } });
      const lamports = rows.reduce((a, r) => a + r.creatorLamports, 0n);
      let transferId: string | null = null;
      await chain.sendSol(coin.creatorWallet, lamports, "fees.forward_creator", g.coinId, async (sig) => {
        transferId = await d.prisma.$transaction(async (tx) => {
          const t = await tx.creatorTransfer.create({ data: { coinId: g.coinId, wallet: coin.creatorWallet, lamports, sig } });
          await tx.feeAllocation.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { creatorTransferId: t.id } });
          return t.id;
        });
      });
      if (transferId) await d.prisma.creatorTransfer.update({ where: { id: transferId }, data: { status: "landed" } });
    });
  }
}
