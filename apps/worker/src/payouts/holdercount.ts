/**
 * Holder counts for the board and the coin page (CoinStats.holders), read from the chain every five
 * minutes for coins traded since the last count, and for coins never counted. Counted like a round's
 * snapshot: every wallet holding the coin except the curve, the pool and uspad's own wallets, small
 * holders included. A read only: it runs in dry-run too, where rounds don't write the count.
 */
import type { WorkerDeps } from "../deps";
import type { PayoutChain } from "./chain";

export async function refreshHolderCounts(d: WorkerDeps, chain: PayoutChain, now = new Date()): Promise<number> {
  const coins = await d.prisma.coin.findMany({
    where: {
      mint: { not: null },
      status: { in: ["live", "graduated"] },
      OR: [{ trades: { some: { ts: { gte: new Date(now.getTime() - 6 * 60_000) } } } }, { stats: { holders: 0 }, trades: { some: {} } }],
    },
    select: { id: true, mint: true, cpmmPool: true },
  });
  let counted = 0;
  for (const c of coins) {
    try {
      const excluded = chain.excludedOwners({ mint: c.mint!, cpmmPool: c.cpmmPool });
      const owners = new Set((await chain.holders(c.mint!)).filter((h) => h.amount > 0n && !excluded.has(h.owner)).map((h) => h.owner));
      await d.prisma.coinStats.updateMany({ where: { coinId: c.id }, data: { holders: owners.size } });
      counted++;
    } catch (e) {
      d.log("holder-counts: failed", { coinId: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return counted;
}
