/**
 * Denormalised CoinStats for the board (HANDOFF §8 "cache board data"). Prices come from the chain
 * (LaunchLab pool or CPMM reserves); volumes and changes from indexed trades.
 */
import { Prisma } from "@divvy/db";
import { PublicKey } from "@solana/web3.js";
import { curveProgress } from "@divvy/solana";
import { cpmmPriceSol, cpmmReserves, decodeCpmmPool, decodePool, POOL_STATUS, poolPriceSol } from "@divvy/solana/live";
import type { WorkerDeps } from "./deps";
import { changePct, sparkline, TF_MS } from "./market";

const SUPPLY_TOKENS = 1e9;

type StatsData = Omit<Prisma.CoinStatsUncheckedCreateInput, "coinId">;

/**
 * Creates a coin's stats row if it has none, then applies `update`. Not Prisma's upsert: that one reads
 * and then writes, so two writers at once both try to insert and one fails on the unique coinId. The
 * launch and the indexer do write at once since the create carries the dev buy's trade, and on
 * 2026-10-28 that left a landed launch short of "indexed" (and the indexer reads a unique failure as a
 * trade it already has). INSERT … ON CONFLICT DO NOTHING can't fail that way. Works in a transaction.
 */
export async function putCoinStats(db: { coinStats: Pick<Prisma.TransactionClient["coinStats"], "createMany" | "update"> }, coinId: string, create: StatsData, update: StatsData = create): Promise<void> {
  await db.coinStats.createMany({ data: [{ coinId, ...create }], skipDuplicates: true });
  if (Object.keys(update).length) await db.coinStats.update({ where: { coinId }, data: update });
}
const DAY = 86_400_000;

interface ChainState {
  priceSol: number;
  realBase?: bigint;
  realQuote?: bigint;
  progressBps?: number;
  poolStatus?: number;
}

/** Reads pool accounts for live (curve) coins in chunks of 100. */
async function curveStates(d: WorkerDeps, coins: { id: string; poolState: string | null }[]): Promise<Map<string, ChainState>> {
  const out = new Map<string, ChainState>();
  const withPool = coins.filter((c) => c.poolState);
  for (let i = 0; i < withPool.length; i += 100) {
    const chunk = withPool.slice(i, i + 100);
    const infos = await d.conn.getMultipleAccountsInfo(chunk.map((c) => new PublicKey(c.poolState!)), "confirmed");
    infos.forEach((info, j) => {
      if (!info) return;
      const p = decodePool(info.data);
      const realBase = BigInt(p.realA.toString());
      const total = BigInt(p.totalSellA.toString());
      out.set(chunk[j]!.id, {
        priceSol: poolPriceSol(p),
        realBase,
        realQuote: BigInt(p.realB.toString()),
        progressBps: Math.round(curveProgress(realBase, total) * 10_000),
        poolStatus: p.status,
      });
    });
  }
  return out;
}

async function cpmmStates(d: WorkerDeps, coins: { id: string; mint: string | null; cpmmPool: string | null }[]): Promise<Map<string, ChainState>> {
  const out = new Map<string, ChainState>();
  for (const c of coins) {
    if (!c.cpmmPool || !c.mint) continue;
    const info = await d.conn.getAccountInfo(new PublicKey(c.cpmmPool), "confirmed").catch(() => null);
    if (!info) continue;
    const pool = decodeCpmmPool(info.data);
    const reserves = await cpmmReserves(d.conn, pool).catch(() => null);
    if (reserves) out.set(c.id, { priceSol: cpmmPriceSol(pool, reserves, new PublicKey(c.mint)), progressBps: 10_000 });
  }
  return out;
}

/**
 * Refreshes market stats for the given coins (all live and graduated coins when omitted).
 * Returns coins whose curve finished (pool status ≥ migrate) so the caller can follow up.
 */
export async function refreshMarketStats(d: WorkerDeps, coinIds?: string[]): Promise<{ migrating: string[] }> {
  const coins = await d.prisma.coin.findMany({
    where: { status: { in: ["live", "graduated"] }, ...(coinIds ? { id: { in: coinIds } } : {}) },
    select: { id: true, mint: true, poolState: true, cpmmPool: true, status: true, stats: { select: { athUsd: true } } },
  });
  if (!coins.length) return { migrating: [] };
  const { solUsd } = await d.prices();
  const ids = coins.map((c) => c.id);
  const now = Date.now();
  const [curve, cpmm, vols, ago, spark] = await Promise.all([
    curveStates(d, coins.filter((c) => c.status === "live")),
    cpmmStates(d, coins.filter((c) => c.status === "graduated")),
    d.prisma.$queryRaw<{ coinId: string; vol: bigint }[]>`
      SELECT "coinId", COALESCE(SUM("solAmount"), 0)::bigint AS vol FROM "Trade"
      WHERE ts > ${new Date(now - DAY)} AND "coinId" IN (${Prisma.join(ids)}) GROUP BY "coinId"`,
    // Price 24h ago: the last trade at or before then, else the first trade ever (young coins).
    d.prisma.$queryRaw<{ coinId: string; price: Prisma.Decimal; isBefore: boolean }[]>`
      (SELECT DISTINCT ON ("coinId") "coinId", "priceSol" AS price, true AS "isBefore" FROM "Trade"
        WHERE ts <= ${new Date(now - DAY)} AND "coinId" IN (${Prisma.join(ids)}) ORDER BY "coinId", ts DESC)
      UNION ALL
      (SELECT DISTINCT ON ("coinId") "coinId", "priceSol" AS price, false AS "isBefore" FROM "Trade"
        WHERE "coinId" IN (${Prisma.join(ids)}) ORDER BY "coinId", ts ASC)`,
    d.prisma.candle.findMany({
      where: { coinId: { in: ids }, tf: "m5", ts: { gte: new Date(now - 28 * TF_MS["5m"]) } },
      select: { coinId: true, ts: true, c: true },
    }),
  ]);
  const volBy = new Map(vols.map((v) => [v.coinId, BigInt(v.vol)]));
  const agoBy = new Map<string, number>();
  for (const a of ago) if (a.isBefore || !agoBy.has(a.coinId)) agoBy.set(a.coinId, Number(a.price));
  const sparkBy = new Map<string, { ts: number; c: number }[]>();
  for (const s of spark) {
    const arr = sparkBy.get(s.coinId) ?? [];
    arr.push({ ts: s.ts.getTime(), c: Number(s.c) });
    sparkBy.set(s.coinId, arr);
  }

  const migrating: string[] = [];
  for (const c of coins) {
    const st = curve.get(c.id) ?? cpmm.get(c.id);
    if (!st) continue;
    if (st.poolStatus !== undefined && st.poolStatus >= POOL_STATUS.migrate) migrating.push(c.id);
    const mcap = st.priceSol * SUPPLY_TOKENS * solUsd;
    const vol = volBy.get(c.id) ?? 0n;
    const points = sparkline(sparkBy.get(c.id) ?? [], now, TF_MS["5m"]).map((p) => Math.round(p * SUPPLY_TOKENS * solUsd));
    const data = {
      priceSol: new Prisma.Decimal(st.priceSol.toFixed(18)),
      marketCapUsd: mcap,
      athUsd: Math.max(c.stats?.athUsd ?? 0, mcap),
      change24hPct: changePct(st.priceSol, agoBy.get(c.id) ?? null),
      volume24hLamports: vol,
      volume24hUsd: (Number(vol) / 1e9) * solUsd,
      spark: points.length ? points : [Math.round(mcap)],
      ...(st.progressBps !== undefined ? { progressBps: st.progressBps } : {}),
      ...(st.realBase !== undefined ? { realBase: st.realBase, realQuote: st.realQuote } : {}),
    };
    await putCoinStats(d.prisma, c.id, data);
  }
  return { migrating };
}

/** Paid-to-holders totals: what live rounds actually distributed (sum of their PayoutItems). */
export async function refreshPaidStats(d: WorkerDeps, coinIds: string[]): Promise<void> {
  if (!coinIds.length) return;
  const since = new Date(Date.now() - DAY);
  const rows = await d.prisma.$queryRaw<{ coinId: string; hour: Date; priceUsd: Prisma.Decimal | null; decimals: number; paid: bigint }[]>`
    SELECT r."coinId", r.hour, r."priceUsd", a.decimals, COALESCE(SUM(i."amountAsset"), 0)::bigint AS paid
    FROM "PayoutRound" r
    JOIN "Coin" c ON c.id = r."coinId"
    JOIN "DividendAsset" a ON a.id = c."dividendAssetId"
    JOIN "PayoutItem" i ON i."roundId" = r.id
    WHERE r."dryRun" = false AND r."coinId" IN (${Prisma.join(coinIds)})
    GROUP BY r.id, r."coinId", r.hour, r."priceUsd", a.decimals`;
  const agg = new Map<string, { all: bigint; allUsd: number; day: bigint; dayUsd: number }>();
  for (const r of rows) {
    const a = agg.get(r.coinId) ?? { all: 0n, allUsd: 0, day: 0n, dayUsd: 0 };
    const paid = BigInt(r.paid);
    const usd = (Number(paid) / 10 ** r.decimals) * Number(r.priceUsd ?? 0);
    a.all += paid;
    a.allUsd += usd;
    if (r.hour >= since) {
      a.day += paid;
      a.dayUsd += usd;
    }
    agg.set(r.coinId, a);
  }
  for (const id of coinIds) {
    const a = agg.get(id) ?? { all: 0n, allUsd: 0, day: 0n, dayUsd: 0 };
    const data = { paidAsset: a.all, paidUsd: a.allUsd, paid24hAsset: a.day, paid24hUsd: a.dayUsd };
    await putCoinStats(d.prisma, id, data);
  }
}
