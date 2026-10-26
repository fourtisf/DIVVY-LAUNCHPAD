/**
 * Indexer (HANDOFF §8). Every LaunchLab create, trade and migration of a Divvy coin references our
 * PlatformConfig, so we follow that one address with getSignaturesForAddress (a WebSocket logs
 * subscription only wakes the loop early). Graduated coins are followed on their CPMM pool.
 *
 * Fee attribution must be exact (HANDOFF §13), so a transaction we can't decode stops the cursor and
 * alerts instead of being skipped.
 */
import { Prisma } from "@divvy/db";
import { PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { publishLive } from "@divvy/server";
import { WSOL_MINT } from "@divvy/solana";
import { cpmmPoolPda, EventLayoutError, parseCpmmSwaps, parseLaunchLabTransaction } from "@divvy/solana/live";
import type { WorkerDeps } from "./deps";
import { markLanded } from "./launch";
import { bucket, cpmmTradeRow, curveTradeRow, type Tf, type TradeRow } from "./market";
import { refreshMarketStats } from "./stats";

const TF_DB: Record<Tf, string> = { "1m": "1m", "5m": "5m", "1h": "1h", "1d": "1d" };

interface CoinRef {
  id: string;
  mint: string | null;
  ticker: string;
  imageUrl: string;
  status: string;
}

export class Indexer {
  private byPool = new Map<string, CoinRef>();
  private busy = false;
  private again = false;
  private halted: string | null = null;

  constructor(private readonly d: WorkerDeps) {}

  /** Starts polling and the logs subscription. Returns a stop function. */
  start(): () => void {
    const timer = setInterval(() => void this.tick(), this.d.env.INDEXER_POLL_MS);
    let subId: number | null = null;
    try {
      subId = this.d.conn.onLogs(this.d.sol.platformConfig, () => void this.tick(), "confirmed");
    } catch (e) {
      this.d.log("indexer: logs subscription unavailable, polling only", { error: String(e) });
    }
    void this.tick();
    return () => {
      clearInterval(timer);
      if (subId !== null) void this.d.conn.removeOnLogsListener(subId).catch(() => {});
    };
  }

  async tick(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      do {
        this.again = false;
        const touched = new Set<string>();
        await this.follow("platform", this.d.sol.platformConfig, (sig, tx) => this.onPlatformTx(sig, tx, touched));
        const graduated = await this.d.prisma.coin.findMany({ where: { status: "graduated", cpmmPool: { not: null } }, select: { id: true, cpmmPool: true } });
        for (const g of graduated) await this.follow(`cpmm:${g.cpmmPool}`, new PublicKey(g.cpmmPool!), (sig, tx) => this.onCpmmTx(sig, tx, g.id, touched));
        if (touched.size) await refreshMarketStats(this.d, [...touched]);
      } while (this.again);
    } catch (e) {
      this.d.log("indexer: tick failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy = false;
    }
  }

  /** Walks new signatures for `address` oldest-first, advancing the cursor after each transaction. */
  async follow(name: string, address: PublicKey, handle: (sig: string, tx: VersionedTransactionResponse) => Promise<void>): Promise<void> {
    if (this.halted === name) return;
    const cur = await this.d.prisma.indexerCursor.findUnique({ where: { name } });
    const sigs: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.d.conn.getSignaturesForAddress(address, { before, until: cur?.lastSignature ?? undefined, limit: 1000 }, "confirmed");
      sigs.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1]!.signature;
    }
    for (const s of sigs.reverse()) {
      if (!s.err) {
        const tx = await this.d.conn.getTransaction(s.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
        if (!tx) return; // not served yet; try again next tick without moving the cursor
        try {
          await handle(s.signature, tx);
        } catch (e) {
          if (e instanceof EventLayoutError) {
            this.halted = name;
            await this.d.alerts.send(`indexer-layout-${name}`, "critical", `Indexer stopped on ${s.signature}: ${e.message}. Fee attribution is paused until this is fixed.`, 3600);
          }
          throw e;
        }
      }
      await this.d.prisma.indexerCursor.upsert({
        where: { name },
        create: { name, lastSignature: s.signature, lastSlot: BigInt(s.slot) },
        update: { lastSignature: s.signature, lastSlot: BigInt(s.slot) },
      });
    }
  }

  private async coinByPool(pool: string): Promise<CoinRef | null> {
    const hit = this.byPool.get(pool);
    if (hit && hit.status !== "pending") return hit;
    const c = await this.d.prisma.coin.findUnique({ where: { poolState: pool }, select: { id: true, mint: true, ticker: true, imageUrl: true, status: true } });
    if (c) this.byPool.set(pool, c);
    return c;
  }

  private feePayer(tx: VersionedTransactionResponse): string {
    return tx.transaction.message.staticAccountKeys[0]!.toBase58();
  }

  async onPlatformTx(sig: string, tx: VersionedTransactionResponse, touched: Set<string>): Promise<void> {
    const parsed = parseLaunchLabTransaction(tx, this.d.programs.launchLab, this.d.programs.cpmm);
    const ts = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000);

    for (const pc of parsed.poolCreates) {
      const coin = await this.coinByPool(pc.poolState.toBase58());
      if (coin?.status === "pending") {
        const launch = await this.d.prisma.launch.findUnique({ where: { coinId: coin.id } });
        if (launch) await markLanded(this.d, launch.id, sig);
        this.byPool.delete(pc.poolState.toBase58());
      }
    }

    for (const t of parsed.trades) {
      const coin = await this.coinByPool(t.event.poolState.toBase58());
      if (!coin) {
        await this.d.alerts.send(`indexer-unknown-pool-${t.event.poolState.toBase58()}`, "warn", `Trade on an unknown pool ${t.event.poolState.toBase58()} (${sig})`, 86_400);
        continue;
      }
      const row = curveTradeRow(sig, t, this.feePayer(tx));
      if (await this.saveTrade(coin, row, BigInt(tx.slot), ts)) touched.add(coin.id);
    }

    for (const m of parsed.cpmmPools) {
      const coinMint = m.token0.toBase58() === WSOL_MINT ? m.token1 : m.token0;
      await this.graduate(coinMint.toBase58(), m.lpPool.toBase58(), ts, sig);
    }
  }

  async onCpmmTx(sig: string, tx: VersionedTransactionResponse, coinId: string, touched: Set<string>): Promise<void> {
    const coin = await this.d.prisma.coin.findUnique({ where: { id: coinId }, select: { id: true, mint: true, ticker: true, imageUrl: true, status: true, cpmmPool: true } });
    if (!coin?.cpmmPool) return;
    const ts = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000);
    for (const s of parseCpmmSwaps(tx, this.d.programs.cpmm)) {
      if (s.event.poolId.toBase58() !== coin.cpmmPool) continue;
      const row = cpmmTradeRow(sig, s.seq, s.event, this.feePayer(tx));
      if (row && (await this.saveTrade(coin, row, BigInt(tx.slot), ts))) touched.add(coin.id);
    }
  }

  /** Marks a coin graduated and starts following its CPMM pool. */
  async graduate(mint: string, cpmmPool: string, at: Date, sig: string | null): Promise<void> {
    const coin = await this.d.prisma.coin.findUnique({ where: { mint } });
    if (!coin || coin.status === "graduated") return;
    await this.d.prisma.coin.update({ where: { id: coin.id }, data: { status: "graduated", cpmmPool, graduatedAt: at } });
    await this.d.prisma.coinStats.updateMany({ where: { coinId: coin.id }, data: { progressBps: 10_000 } });
    await publishLive(this.d.redis, { type: "graduate", at: at.toISOString(), mint, ticker: coin.ticker, imageUrl: coin.imageUrl });
    this.d.log("indexer: graduated", { coinId: coin.id, cpmmPool, sig });
  }

  /**
   * Coins whose curve is done but whose migration we haven't seen: derive the CPMM pool PDA from the
   * platform's cp config and confirm it exists (cp-swap initialize_with_permission seeds).
   */
  async checkMigrations(coinIds: string[]): Promise<void> {
    if (!coinIds.length) return;
    const { platform } = await this.d.chain();
    for (const id of coinIds) {
      const coin = await this.d.prisma.coin.findUnique({ where: { id } });
      if (!coin?.mint || coin.status !== "live") continue;
      const pda = cpmmPoolPda(this.d.programs.cpmm, platform.cpConfigId, new PublicKey(coin.mint), new PublicKey(WSOL_MINT));
      if (await this.d.conn.getAccountInfo(pda, "confirmed")) await this.graduate(coin.mint, pda.toBase58(), new Date(), null);
    }
  }

  /** Inserts the trade once; candles and the live feed only move for new rows. */
  private async saveTrade(coin: CoinRef, r: TradeRow, slot: bigint, ts: Date): Promise<boolean> {
    try {
      await this.d.prisma.trade.create({
        data: {
          sig: r.sig, ix: r.ix, coinId: coin.id, side: r.side, solAmount: r.solAmount, tokenAmount: r.tokenAmount, wallet: r.wallet,
          priceSol: new Prisma.Decimal(r.priceSol.toFixed(18)), protocolFee: r.protocolFee, platformFee: r.platformFee,
          creatorFee: r.creatorFee, shareFee: r.shareFee, venue: r.venue, slot, ts,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
    }
    const price = new Prisma.Decimal(r.priceSol.toFixed(18));
    for (const tf of Object.keys(TF_DB) as Tf[]) {
      const b = new Date(bucket(ts.getTime(), tf));
      await this.d.prisma.$executeRaw`
        INSERT INTO "Candle" ("coinId", tf, ts, o, h, l, c, "volSol")
        VALUES (${coin.id}, ${TF_DB[tf]}::"CandleTf", ${b}, ${price}, ${price}, ${price}, ${price}, ${r.solAmount})
        ON CONFLICT ("coinId", tf, ts) DO UPDATE SET
          h = GREATEST("Candle".h, EXCLUDED.h), l = LEAST("Candle".l, EXCLUDED.l), c = EXCLUDED.c,
          "volSol" = "Candle"."volSol" + EXCLUDED."volSol"`;
    }
    if (coin.mint) {
      await publishLive(this.d.redis, {
        type: "trade", at: ts.toISOString(), mint: coin.mint, ticker: coin.ticker, imageUrl: coin.imageUrl,
        side: r.side, sol: { raw: r.solAmount.toString(), decimals: 9, ui: Number(r.solAmount) / 1e9 }, wallet: r.wallet,
      });
    }
    return true;
  }
}
