/**
 * Indexer (HANDOFF §8). Every LaunchLab create, trade and migration of a Divvy coin references our
 * PlatformConfig, so we follow that one address with getSignaturesForAddress (a WebSocket logs
 * subscription only wakes the loop early). Graduated coins are followed on their CPMM pool.
 *
 * Fee attribution must be exact (HANDOFF §13), so a Divvy trade we can't decode stops that cursor and
 * alerts instead of being skipped. Other platforms' events are never decoded, so they can't stop it.
 * The indexer also marks where each vault claim sits in the trade stream (VaultClaim.toTradeId).
 */
import { Prisma } from "@divvy/db";
import { PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { publishLive } from "@divvy/server";
import { WSOL_MINT } from "@divvy/solana";
import { cpmmPoolPda, decodeCpmmPool, EventLayoutError, getTransactionAnyVersion, logsTruncated, parseCpmmSwaps, parseLaunchLabTransaction, TxShapeError } from "@divvy/solana/live";
import type { WorkerDeps } from "./deps";
import { markLanded } from "./launch";
import { bucket, cpmmTradeRow, curveTradeRow, type Tf, type TradeRow } from "./market";
import { refreshMarketStats } from "./stats";

const TF_DB: Record<Tf, string> = { "1m": "1m", "5m": "5m", "1h": "1h", "1d": "1d" };
/** getTransaction returning null this many times in a row for one signature raises an alert. */
const NULL_TX_ALERT_AFTER = 15;
/** Transactions one graduated pool's stream works through per pass, so the platform stream isn't kept waiting. */
const CPMM_SLICE = 200;

interface CoinRef {
  id: string;
  mint: string | null;
  ticker: string;
  imageUrl: string;
  status: string;
}

export class Indexer {
  private byPool = new Map<string, CoinRef>();
  /** Every pool that belongs to a Divvy coin (any status), refreshed each tick. */
  private pools = new Set<string>();
  /** Signatures of live vault claims the indexer hasn't placed in the trade stream yet. */
  private claimSigs = new Set<string>();
  private busy = false;
  private again = false;
  private halted = new Set<string>();
  /** Per stream, so two stuck streams can't keep resetting each other's count (audit). */
  private nullTx = new Map<string, { sig: string; count: number }>();

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
        await this.refreshSets();
        let platformAt = 0;
        const platform = () => {
          platformAt = Date.now();
          return this.safely("platform", () => this.follow("platform", this.d.sol.platformConfig, (sig, tx) => this.onPlatformTx(sig, tx, touched)));
        };
        await platform();
        const graduated = await this.d.prisma.coin.findMany({ where: { status: "graduated", cpmmPool: { not: null } }, select: { id: true, cpmmPool: true } });
        // One pool's RPC error doesn't starve the others. Each pool's backlog is worked through a slice at
        // a time and the platform stream (fees and vault claims) comes round again between pools, so busy
        // pools can't keep it waiting (audit).
        for (const g of graduated) {
          await this.safely(`cpmm:${g.cpmmPool}`, () => this.follow(`cpmm:${g.cpmmPool}`, new PublicKey(g.cpmmPool!), (sig, tx) => this.onCpmmTx(sig, tx, g.id, touched), CPMM_SLICE));
          if (Date.now() - platformAt >= this.d.env.INDEXER_POLL_MS) await platform();
        }
        if (touched.size) await refreshMarketStats(this.d, [...touched]);
      } while (this.again);
    } catch (e) {
      this.d.log("indexer: tick failed", { error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy = false;
    }
  }

  private async safely(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (e) {
      this.d.log("indexer: follow failed", { name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  async refreshSets(): Promise<void> {
    const [coins, claims] = await Promise.all([
      this.d.prisma.coin.findMany({ where: { poolState: { not: null } }, select: { poolState: true } }),
      this.d.prisma.vaultClaim.findMany({ where: { dryRun: false, sig: { not: null }, toTradeId: null }, select: { sig: true } }),
    ]);
    this.pools = new Set(coins.map((c) => c.poolState!));
    this.claimSigs = new Set(claims.map((c) => c.sig!));
  }

  /**
   * Walks new signatures for `address` oldest-first, advancing the cursor after each transaction, at most
   * `max` per call (the rest next time). Transactions are fetched a few at a time in parallel and applied
   * in order (audit: one fetch at a time let cheap spam touching the PlatformConfig outrun the indexer).
   */
  async follow(name: string, address: PublicKey, handle: (sig: string, tx: VersionedTransactionResponse) => Promise<void>, max = Infinity): Promise<void> {
    if (this.halted.has(name)) return;
    const cur = await this.d.prisma.indexerCursor.findUnique({ where: { name } });
    const sigs: { signature: string; slot: number; err: unknown }[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await this.d.conn.getSignaturesForAddress(address, { before, until: cur?.lastSignature ?? undefined, limit: 1000 }, "confirmed");
      sigs.push(...page);
      if (page.length < 1000) break;
      before = page[page.length - 1]!.signature;
    }
    const todo = sigs.reverse().slice(0, max);
    const fetched = new Map<string, Promise<VersionedTransactionResponse | null>>();
    const fetchAhead = (from: number) => {
      for (const t of todo.slice(from, from + this.d.env.INDEXER_FETCH_CONCURRENCY)) {
        if (!t.err && !fetched.has(t.signature)) {
          const p = getTransactionAnyVersion(this.d.conn, t.signature);
          p.catch(() => {}); // awaited below, in order
          fetched.set(t.signature, p);
        }
      }
    };
    for (const [i, s] of todo.entries()) {
      fetchAhead(i);
      if (!s.err) {
        // Any transaction version: a newer one web3.js can't read is fetched raw (rawtx.ts). One whose
        // shape we don't know stops this stream, like a layout change, instead of being skipped.
        let tx: VersionedTransactionResponse | null;
        try {
          tx = await fetched.get(s.signature)!;
        } catch (e) {
          if (e instanceof TxShapeError) {
            this.halted.add(name);
            await this.d.alerts.send(`indexer-shape-${name}`, "critical", `Indexer stopped on ${s.signature}: ${e.message}. Fee attribution is paused until this is fixed.`, 3600);
          }
          throw e;
        }
        if (!tx) {
          // Not served yet: try again next tick without moving the cursor, but say so if it persists.
          const prev = this.nullTx.get(name);
          const stuck = prev?.sig === s.signature ? { sig: s.signature, count: prev.count + 1 } : { sig: s.signature, count: 1 };
          this.nullTx.set(name, stuck);
          if (stuck.count === NULL_TX_ALERT_AFTER) await this.d.alerts.send(`indexer-null-tx-${s.signature}`, "critical", `Indexer (${name}) is stuck: the RPC keeps returning no transaction for ${s.signature}`, 3600);
          return;
        }
        try {
          await handle(s.signature, tx);
        } catch (e) {
          if (e instanceof EventLayoutError) {
            this.halted.add(name);
            await this.d.alerts.send(`indexer-layout-${name}`, "critical", `Indexer stopped on ${s.signature}: ${e.message}. Fee attribution is paused until this is fixed.`, 3600);
          }
          throw e;
        }
      }
      // Where a vault claim sits in the stream: every trade indexed so far was swept by it. A claim that
      // failed on chain swept nothing, so it gets no marker; the engine sees the failure and its fees
      // roll into the next claim's range (a marker here would give those trades to an empty claim).
      if (name === "platform" && this.claimSigs.has(s.signature)) {
        if (s.err) this.claimSigs.delete(s.signature);
        else await this.markClaim(s.signature);
      }
      await this.d.prisma.indexerCursor.upsert({
        where: { name },
        create: { name, lastSignature: s.signature, lastSlot: BigInt(s.slot) },
        update: { lastSignature: s.signature, lastSlot: BigInt(s.slot) },
      });
    }
  }

  async markClaim(sig: string): Promise<void> {
    const max = await this.d.prisma.trade.aggregate({ _max: { id: true } });
    await this.d.prisma.vaultClaim.updateMany({ where: { sig, toTradeId: null }, data: { toTradeId: max._max.id ?? 0n } });
    this.claimSigs.delete(sig);
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
    const parsed = parseLaunchLabTransaction(tx, this.d.programs.launchLab, this.d.programs.cpmm, (pool) => this.pools.has(pool));
    const ts = new Date((tx.blockTime ?? Math.floor(Date.now() / 1000)) * 1000);

    for (const pc of parsed.poolCreates) {
      const coin = await this.coinByPool(pc.poolState.toBase58());
      // A coin created after this tick's refresh: its trades later in this batch must not be filtered out.
      if (coin) this.pools.add(pc.poolState.toBase58());
      if (coin?.status === "pending") {
        const launch = await this.d.prisma.launch.findUnique({ where: { coinId: coin.id } });
        if (launch) await markLanded(this.d, launch.id, sig);
        this.byPool.delete(pc.poolState.toBase58());
      } else if (coin?.status === "failed") {
        await this.d.alerts.send(`failed-launch-landed-${coin.id}`, "critical", `A launch marked failed landed on chain anyway (coin ${coin.id}, ${sig}); its trades are indexed but it needs a manual decision`, 86_400);
      }
    }

    for (const t of parsed.trades) {
      const coin = await this.coinByPool(t.event.poolState.toBase58());
      if (!coin) continue; // a Divvy pool by the filter above, so this only happens mid-refresh
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
    // Volume and candles only (fee attribution after graduation comes from actual claims).
    if (logsTruncated(tx)) await this.d.alerts.send(`cpmm-truncated-${sig}`, "warn", `CPMM logs truncated in ${sig}; a swap on ${coin.ticker} may be missing from volume and candles`, 86_400);
    for (const s of parseCpmmSwaps(tx, this.d.programs.cpmm)) {
      if (s.event.poolId.toBase58() !== coin.cpmmPool) continue;
      const row = cpmmTradeRow(sig, s.seq, s.event, this.feePayer(tx));
      if (row && (await this.saveTrade(coin, row, BigInt(tx.slot), ts))) touched.add(coin.id);
    }
  }

  /**
   * Marks a coin graduated and starts following its CPMM pool. A migration read from a transaction
   * (sig set) is authoritative and corrects a pool found by the PDA fallback.
   */
  async graduate(mint: string, cpmmPool: string, at: Date, sig: string | null): Promise<void> {
    const coin = await this.d.prisma.coin.findUnique({ where: { mint } });
    if (!coin) return;
    if (coin.status === "graduated") {
      if (sig && coin.cpmmPool !== cpmmPool) {
        await this.d.prisma.coin.update({ where: { id: coin.id }, data: { cpmmPool } });
        await this.d.alerts.send(`cpmm-pool-corrected-${coin.id}`, "warn", `${coin.ticker}: CPMM pool corrected from ${coin.cpmmPool} to ${cpmmPool} by migration ${sig}`, 86_400);
      }
      return;
    }
    const n = await this.d.prisma.coin.updateMany({ where: { id: coin.id, status: "live" }, data: { status: "graduated", cpmmPool, graduatedAt: at } });
    if (!n.count) return;
    await this.d.prisma.coinStats.updateMany({ where: { coinId: coin.id }, data: { progressBps: 10_000 } });
    await publishLive(this.d.redis, { type: "graduate", at: at.toISOString(), mint, ticker: coin.ticker, imageUrl: coin.imageUrl });
    this.d.log("indexer: graduated", { coinId: coin.id, cpmmPool, sig });
  }

  /**
   * Coins whose curve is done but whose migration transaction we haven't seen: derive the CPMM pool
   * PDA and accept it only if it is the pool LaunchLab would have created: made with
   * initialize_with_permission (creator fee enabled), on the platform's cp config, for this coin and
   * SOL, with the expected pool creator. CPMM `initialize` is permissionless, so anyone could
   * otherwise pre-create an account at that address (audit).
   */
  async checkMigrations(coinIds: string[]): Promise<void> {
    if (!coinIds.length) return;
    const { platform } = await this.d.chain();
    for (const id of coinIds) {
      const coin = await this.d.prisma.coin.findUnique({ where: { id } });
      if (!coin?.mint || coin.status !== "live") continue;
      const mint = new PublicKey(coin.mint);
      const wsol = new PublicKey(WSOL_MINT);
      const pda = cpmmPoolPda(this.d.programs.cpmm, platform.cpConfigId, mint, wsol);
      const info = await this.d.conn.getAccountInfo(pda, "confirmed");
      if (!info || !info.owner.equals(this.d.programs.cpmm)) continue;
      let pool;
      try {
        pool = decodeCpmmPool(info.data);
      } catch {
        continue;
      }
      const expectedCreator = platform.platformCpCreator.equals(PublicKey.default) ? new PublicKey(coin.creatorWallet) : platform.platformCpCreator;
      const mintsOk = (pool.mintA.equals(mint) && pool.mintB.equals(wsol)) || (pool.mintA.equals(wsol) && pool.mintB.equals(mint));
      if (pool.enableCreatorFee && pool.configId.equals(platform.cpConfigId) && mintsOk && pool.poolCreator.equals(expectedCreator)) {
        await this.graduate(coin.mint, pda.toBase58(), new Date(), null);
      } else {
        await this.d.alerts.send(`cpmm-pda-mismatch-${coin.id}`, "warn", `${coin.ticker}: an account at the CPMM pool address doesn't look like LaunchLab's migration pool; waiting for the migration transaction`, 86_400);
      }
    }
  }

  /** Inserts the trade, its candles and lastTradeAt in one transaction; the live feed only moves for new rows. */
  private async saveTrade(coin: CoinRef, r: TradeRow, slot: bigint, ts: Date): Promise<boolean> {
    const price = new Prisma.Decimal(r.priceSol.toFixed(18));
    try {
      await this.d.prisma.$transaction(async (tx) => {
        await tx.trade.create({
          data: {
            sig: r.sig, ix: r.ix, coinId: coin.id, side: r.side, solAmount: r.solAmount, tokenAmount: r.tokenAmount, wallet: r.wallet,
            priceSol: price, protocolFee: r.protocolFee, platformFee: r.platformFee,
            creatorFee: r.creatorFee, shareFee: r.shareFee, venue: r.venue, slot, ts,
          },
        });
        for (const tf of Object.keys(TF_DB) as Tf[]) {
          const b = new Date(bucket(ts.getTime(), tf));
          await tx.$executeRaw`
            INSERT INTO "Candle" ("coinId", tf, ts, o, h, l, c, "volSol")
            VALUES (${coin.id}, ${TF_DB[tf]}::"CandleTf", ${b}, ${price}, ${price}, ${price}, ${price}, ${r.solAmount})
            ON CONFLICT ("coinId", tf, ts) DO UPDATE SET
              h = GREATEST("Candle".h, EXCLUDED.h), l = LEAST("Candle".l, EXCLUDED.l), c = EXCLUDED.c,
              "volSol" = "Candle"."volSol" + EXCLUDED."volSol"`;
        }
        await tx.coinStats.upsert({ where: { coinId: coin.id }, create: { coinId: coin.id, lastTradeAt: ts }, update: { lastTradeAt: ts } });
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return false;
      throw e;
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
