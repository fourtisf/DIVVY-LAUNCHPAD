/** Small recurring jobs: prices, hot-wallet and indexer status, reserved tickers. */
import { foldTicker, TICKER_MAX, TICKER_MIN } from "@divvy/shared";
import { writePrices, writeStatus, type WorkerStatus } from "@divvy/server";
import { WSOL_MINT } from "@divvy/solana";
import type { WorkerDeps } from "./deps";

/** Jupiter Price API v3 → Redis, read by the API and the payout engine. */
export async function pricesJob(d: WorkerDeps): Promise<void> {
  const assets = await d.prisma.dividendAsset.findMany({ where: { enabled: true }, select: { mint: true } });
  const r = await d.jupiter.priceDetails([WSOL_MINT, ...assets.map((a) => a.mint)]);
  const solUsd = r[WSOL_MINT]?.usdPrice ?? 0;
  if (!solUsd) {
    await d.alerts.send("prices-no-sol", "warn", "Jupiter returned no SOL price; the previous cache stays until it expires");
    return;
  }
  const byMint: Record<string, number> = {};
  const change24h: Record<string, number> = {};
  for (const [mint, v] of Object.entries(r)) {
    byMint[mint] = v.usdPrice;
    if (v.priceChange24h !== null) change24h[mint] = v.priceChange24h;
  }
  await writePrices(d.redis, { solUsd, byMint, change24h, at: Date.now() });
}

/** Hot-wallet balances and indexer lag → Redis (admin overview) and alerts (HANDOFF §8). */
export async function statusJob(d: WorkerDeps): Promise<void> {
  const wallets: WorkerStatus["wallets"] = [];
  for (const [role, get] of [["launcher", d.wallets.launcher], ["payout_vault", d.wallets.payoutVault], ["fee_claimer", d.wallets.feeClaimer]] as const) {
    let address: string;
    try {
      address = get().publicKey.toBase58();
    } catch {
      continue; // this process doesn't hold that key
    }
    const lamports = await d.conn.getBalance(get().publicKey, "confirmed").catch(() => null);
    if (lamports === null) continue;
    const sol = lamports / 1e9;
    const lowBalance = sol < d.env.HOT_WALLET_MIN_SOL;
    wallets.push({ role, address, sol, lowBalance });
    if (lowBalance) await d.alerts.send(`low-${role}`, "warn", `${role} hot wallet is low: ${sol.toFixed(3)} SOL`, 6 * 3600);
  }
  const cursor = await d.prisma.indexerCursor.findUnique({ where: { name: "platform" } });
  let indexerLagSec: number | null = null;
  if (cursor?.lastSignature) {
    // Lag: how long the oldest transaction the indexer hasn't processed has been waiting. (The newest
    // one would look fresh on a busy platform even with the indexer stuck for hours; audit.)
    const waiting = await d.conn.getSignaturesForAddress(d.sol.platformConfig, { until: cursor.lastSignature, limit: 1000 }, "confirmed").catch(() => null);
    const oldest = waiting?.[waiting.length - 1];
    indexerLagSec = oldest?.blockTime ? Math.max(0, Math.round(Date.now() / 1000 - oldest.blockTime)) : 0;
    if (indexerLagSec > 60) await d.alerts.send("indexer-lag", "critical", `Indexer is ${indexerLagSec}s behind`, 900);
  }
  await writeStatus(d.redis, { at: Date.now(), indexerSlot: cursor ? Number(cursor.lastSlot) : null, indexerLagSec, wallets });
}

/**
 * Daily refresh of tickers already trading with real volume (HANDOFF §5), from Jupiter's top lists.
 * Entries not seen for 7 days are dropped; manual entries are never touched.
 */
export async function reservedTickersJob(d: WorkerDeps): Promise<number> {
  const lists = await Promise.all([
    d.jupiter.topTokens("toptraded", "24h", 100),
    d.jupiter.topTokens("toporganicscore", "24h", 100),
    d.jupiter.topTokens("toptrending", "24h", 100),
  ]);
  const own = new Set((await d.prisma.coin.findMany({ where: { mint: { not: null } }, select: { mint: true } })).map((c) => c.mint));
  const norms = new Set<string>();
  for (const t of lists.flat()) {
    if (own.has(t.id)) continue;
    const n = foldTicker(t.symbol);
    if (n.length >= TICKER_MIN && n.length <= TICKER_MAX) norms.add(n);
  }
  const now = new Date();
  for (const n of norms) {
    await d.prisma.reservedTicker.upsert({ where: { tickerNorm: n }, create: { tickerNorm: n, source: "jupiter", refreshedAt: now }, update: { refreshedAt: now } });
  }
  await d.prisma.reservedTicker.deleteMany({ where: { source: "jupiter", refreshedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } });
  return norms.size;
}
