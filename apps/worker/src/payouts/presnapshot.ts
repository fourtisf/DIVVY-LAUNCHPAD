/**
 * Mid-hour holder snapshot (audit: a single snapshot at a predictable moment pays wallets that buy
 * just before the round and sell right after). Once an hour, at a random minute between :05 and :54
 * that is kept in Redis and never published, the balances of every coin that may pay next hour are
 * recorded. The round then pays each wallet on the smaller of that balance and its balance at the
 * round, so a wallet must hold across both moments.
 */
import { randomInt } from "node:crypto";
import type { WorkerDeps } from "../deps";
import type { PayoutChain } from "./chain";

const HOUR = 3_600_000;
const preKey = (roundHour: Date, coinId: string) => `divvy:presnap:${roundHour.toISOString()}:${coinId}`;

/** The mid-hour balances for a round, or null if none were taken (the round then uses its own snapshot). */
export async function readPreSnapshot(d: Pick<WorkerDeps, "redis">, roundHour: Date, coinId: string): Promise<Map<string, bigint> | null> {
  const raw = await d.redis.hgetall(preKey(roundHour, coinId));
  if (!raw || !Object.keys(raw).length) return null;
  return new Map(Object.entries(raw).filter(([w]) => w !== "_").map(([w, a]) => [w, BigInt(a)]));
}

/** Runs every minute; acts once per hour at that hour's secret minute. */
export async function preSnapshotJob(d: WorkerDeps, chain: PayoutChain, now = new Date()): Promise<number> {
  const roundHour = new Date(Math.floor(now.getTime() / HOUR) * HOUR + HOUR);
  const minuteKey = `divvy:presnap-minute:${roundHour.toISOString()}`;
  await d.redis.set(minuteKey, String(5 + randomInt(50)), "EX", 7200, "NX");
  if (now.getUTCMinutes() !== Number(await d.redis.get(minuteKey))) return 0;
  if ((await d.redis.set(`divvy:presnap-done:${roundHour.toISOString()}`, "1", "EX", 7200, "NX")) !== "OK") return 0;

  // Coins that may pay next hour: traded recently, or money waiting for a round.
  const since = new Date(now.getTime() - 2 * HOUR);
  const coins = await d.prisma.coin.findMany({
    where: { mint: { not: null }, status: { in: ["live", "graduated"] }, OR: [{ trades: { some: { ts: { gte: since } } } }, { allocations: { some: { roundId: null } } }] },
    select: { id: true, mint: true },
  });
  let taken = 0;
  for (const c of coins) {
    try {
      const holders = await chain.holders(c.mint!);
      const key = preKey(roundHour, c.id);
      // "_" marks a snapshot with no holders, so the round knows one was taken.
      await d.redis.hset(key, { _: "0", ...Object.fromEntries(holders.map((h) => [h.owner, h.amount.toString()])) });
      await d.redis.expire(key, 3 * 3600);
      taken++;
    } catch (e) {
      d.log("presnapshot: failed", { coinId: c.id, error: e instanceof Error ? e.message : String(e) });
    }
  }
  d.log("presnapshot: taken", { roundHour, coins: taken });
  return taken;
}
