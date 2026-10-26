import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  CandleTfSchema,
  CoinSortSchema,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  TICKER_MAX,
  TICKER_MIN,
  type CandleList,
  type CoinList,
  type Config,
  type LiveEvent,
  type Meter,
  type PayoutList,
  type Stats,
} from "@divvy/shared";
import { getLaunchSettings } from "@divvy/server";
import { graduationFdvLamports, LAUNCHLAB_DEFAULT_CURVE, WSOL_MINT } from "@divvy/solana";
import { sendError } from "../../errors";
import type { LiveDeps } from "../deps";
import { amount, boardRows, coinByMint, coinByTicker, HOUR, pendingHoldersLamports, toDetail, toReceipt, toRound, toSummary, topOfHour, type CoinRow } from "../data";

const PageQuery = z.object({ cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(60) });
const iso = (t: number | Date) => new Date(t).toISOString();
const TF = { "1m": "m1", "5m": "m5", "1h": "h1", "1d": "d1" } as const;

export function sortRows(rows: CoinRow[], sort: z.infer<typeof CoinSortSchema>, now: number): CoinRow[] {
  const age = (c: CoinRow) => (now - (c.launchedAt ?? c.createdAt).getTime()) / 60_000;
  const by: Record<typeof sort, (a: CoinRow, b: CoinRow) => number> = {
    trending: (a, b) => (b.stats?.volume24hUsd ?? 0) / (age(b) + 60) - (a.stats?.volume24hUsd ?? 0) / (age(a) + 60),
    new: (a, b) => (b.launchedAt ?? b.createdAt).getTime() - (a.launchedAt ?? a.createdAt).getTime(),
    payers: (a, b) => (b.stats?.paid24hUsd ?? 0) - (a.stats?.paid24hUsd ?? 0),
    graduate: (a, b) => Number(a.status === "graduated") - Number(b.status === "graduated") || (b.stats?.progressBps ?? 0) - (a.stats?.progressBps ?? 0),
  };
  return rows.slice().sort(by[sort]);
}

export async function livePublicRoutes(app: FastifyInstance, { d }: { d: LiveDeps }) {
  app.get("/api/health", async () => {
    const [db, redis] = await Promise.allSettled([d.prisma.$queryRaw`SELECT 1`, d.redis.ping()]);
    return { ok: db.status === "fulfilled" && redis.status === "fulfilled", mode: "live", db: db.status === "fulfilled", redis: redis.status === "fulfilled", uptimeSec: Math.round(process.uptime()) };
  });

  app.get("/api/config", async (): Promise<Config> => {
    const [assets, prices, settings, chain] = await Promise.all([
      d.prisma.dividendAsset.findMany({ where: { enabled: true }, orderBy: { sortOrder: "asc" } }),
      d.prices(),
      getLaunchSettings(d.prisma),
      d.chain().catch(() => null),
    ]);
    const c = LAUNCHLAB_DEFAULT_CURVE;
    const migrateFee = chain ? BigInt(chain.global.migrateFee.toString()) : 0n;
    const fdvSol = Number(graduationFdvLamports(c, 0n, migrateFee)) / 1e9;
    const units = (raw: bigint, decimals: number) => amount(raw, decimals);
    const p = d.params;
    return {
      network: d.sol.cluster,
      demo: false,
      launchesOpen: settings.launchesOpen,
      launchesPausedReason: settings.reason,
      fees: p.fees,
      graduation: {
        targetUsd: fdvSol * prices.solUsd,
        quoteFundRaising: units(c.totalFundRaisingB, 9),
        totalSupply: units(c.supply, c.decimals),
        curveSupply: units(c.totalSellA, c.decimals),
        migrateSupply: units(c.supply - c.totalSellA, c.decimals),
      },
      limits: {
        launchesPerWalletPerDay: p.launchesPerWalletPerDay,
        launchesPerDayGlobal: p.launchesPerDayGlobal,
        launchCooldownSec: p.launchCooldownSec,
        tickerMinLen: TICKER_MIN,
        tickerMaxLen: TICKER_MAX,
        nameMaxLen: 32,
        descriptionMaxLen: 280,
        imageMaxBytes: IMAGE_MAX_BYTES,
        imageTypes: [...IMAGE_TYPES],
      },
      payouts: { intervalSec: 3600, lateAfterSec: p.lateAfterSec, minHolderUsd: p.minHolderUsd, minRoundUsd: p.minRoundUsd, delivery: p.delivery, autoPushMinUsd: p.delivery === "claim" ? p.autoPushMinUsd : null },
      quote: { symbol: "SOL", mint: WSOL_MINT, decimals: 9, priceUsd: prices.solUsd },
      dividendAssets: assets.map((a) => ({
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        mint: a.mint,
        decimals: a.decimals,
        tokenProgram: a.tokenProgram === "token_2022" ? "token-2022" : "spl-token",
        logoUrl: a.logoUrl,
        mono: a.mono,
        chipBg: a.chipBg,
        chipFg: a.chipFg,
        priceUsd: prices.byMint[a.mint] ?? 0,
        change24hPct: prices.change24h[a.mint] ?? 0,
        featured: a.featured,
        enabled: a.enabled,
      })),
      flags: { xOAuth: !!(d.env.X_CLIENT_ID && d.env.X_REDIRECT_URI), trading: true },
    };
  });

  app.get("/api/stats", async (): Promise<Stats> => {
    const now = Date.now();
    const [rows, last] = await Promise.all([
      boardRows(d),
      d.prisma.payoutRound.findFirst({ where: { dryRun: false, status: "ok" }, orderBy: { hour: "desc" }, select: { hour: true } }),
    ]);
    const round = last
      ? await d.prisma.payoutRound.findMany({ where: { dryRun: false, status: "ok", hour: last.hour }, include: { coin: { include: { dividendAsset: true } } } })
      : [];
    const items = round.map(toReceipt).sort((a, b) => b.usd - a.usd);
    const recentRounds = await d.prisma.payoutRound.findMany({
      where: { dryRun: false, status: "ok" },
      orderBy: { hour: "desc" },
      take: 16,
      include: { coin: { include: { dividendAsset: true } } },
    });
    const activity: LiveEvent[] = recentRounds.map((r) => {
      const x = toReceipt(r);
      return { type: "payout_round", at: x.hour, mint: x.coin.mint, ticker: x.coin.ticker, imageUrl: x.coin.imageUrl, assetSymbol: x.assetSymbol, amount: x.amount, usd: x.usd, wallets: x.wallets };
    });
    for (const c of rows.filter((c) => c.launchedAt && now - c.launchedAt.getTime() < HOUR).slice(0, 10))
      activity.push({ type: "launch", at: iso(c.launchedAt!), mint: c.mint!, ticker: c.ticker, name: c.name, imageUrl: c.imageUrl });
    for (const c of rows.filter((c) => c.graduatedAt).sort((a, b) => b.graduatedAt!.getTime() - a.graduatedAt!.getTime()).slice(0, 3))
      activity.push({ type: "graduate", at: iso(c.graduatedAt!), mint: c.mint!, ticker: c.ticker, imageUrl: c.imageUrl });
    activity.sort((a, b) => b.at.localeCompare(a.at));
    return {
      coinsLive: rows.length,
      paidToHoldersUsd: rows.reduce((a, c) => a + (c.stats?.paidUsd ?? 0), 0),
      volume24hUsd: rows.reduce((a, c) => a + (c.stats?.volume24hUsd ?? 0), 0),
      assetsInUse: [...new Set(rows.map((c) => c.dividendAsset.symbol))],
      lastRound: last
        ? {
            hour: iso(last.hour),
            paidUsd: items.reduce((a, i) => a + i.usd, 0),
            wallets: items.reduce((a, i) => a + i.wallets, 0),
            items: items.slice(0, 3).map((i) => ({ mint: i.coin.mint, ticker: i.coin.ticker, imageUrl: i.coin.imageUrl, assetSymbol: i.assetSymbol, amount: i.amount, usd: i.usd })),
          }
        : null,
      nextRoundAt: iso(topOfHour(now) + HOUR),
      activity: activity.slice(0, 24),
    };
  });

  app.get("/api/coins", async (req, reply): Promise<CoinList | void> => {
    const q = z
      .object({ sort: CoinSortSchema.default("trending"), pays: z.string().max(16).optional(), q: z.string().max(64).optional(), cursor: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(100).default(60) })
      .safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid coin query");
    const [rows, prices] = await Promise.all([boardRows(d), d.prices()]);
    const needle = q.data.q?.trim().toLowerCase();
    let list = rows;
    if (needle) list = list.filter((c) => [c.name, c.ticker, c.dividendAsset.symbol, c.dividendAsset.name].some((s) => s.toLowerCase().includes(needle)));
    if (q.data.pays && q.data.pays !== "all") list = list.filter((c) => c.dividendAsset.symbol === q.data.pays);
    const sorted = sortRows(list, q.data.sort, Date.now());
    const cursor = q.data.cursor ?? 0;
    return {
      items: sorted.slice(cursor, cursor + q.data.limit).map((c) => toSummary(c, prices.solUsd)),
      nextCursor: cursor + q.data.limit < sorted.length ? String(cursor + q.data.limit) : null,
    };
  });

  app.get<{ Params: { ticker: string } }>("/api/coins/:ticker", async (req, reply) => {
    if (req.params.ticker.length > 32) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const c = await coinByTicker(d, req.params.ticker);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", `There's no coin called $${req.params.ticker} here yet.`);
    return toDetail(c, (await d.prices()).solUsd);
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/trades", async (req, reply) => {
    const c = await coinByMint(d, req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const page = PageQuery.parse(req.query);
    const cursor = page.cursor && /^\d+$/.test(page.cursor) ? BigInt(page.cursor) : undefined;
    const rows = await d.prisma.trade.findMany({
      where: { coinId: c.id, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: "desc" },
      take: page.limit + 1,
    });
    const more = rows.length > page.limit;
    return {
      items: rows.slice(0, page.limit).map((t) => ({ sig: t.sig, side: t.side, sol: amount(t.solAmount, 9), token: amount(t.tokenAmount, 6), wallet: t.wallet, ts: t.ts.toISOString() })),
      nextCursor: more ? rows[page.limit - 1]!.id.toString() : null,
    };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/candles", async (req, reply): Promise<CandleList | void> => {
    const c = await coinByMint(d, req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const q = z.object({ tf: CandleTfSchema.default("5m"), unit: z.enum(["mcap", "price"]).default("mcap"), limit: z.coerce.number().int().min(2).max(1000).default(300) }).safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid candle query");
    const solUsd = (await d.prices()).solUsd;
    // Candles store SOL per token; USD uses today's SOL price (approximation, noted in docs).
    const k = solUsd * (q.data.unit === "mcap" ? 1e9 : 1);
    const rows = await d.prisma.candle.findMany({ where: { coinId: c.id, tf: TF[q.data.tf] }, orderBy: { ts: "desc" }, take: q.data.limit });
    return {
      tf: q.data.tf,
      unit: q.data.unit,
      items: rows.reverse().map((r) => ({ t: Math.floor(r.ts.getTime() / 1000), o: Number(r.o) * k, h: Number(r.h) * k, l: Number(r.l) * k, c: Number(r.c) * k, vol: amount(r.volSol, 9) })),
    };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/holders", async (req, reply) => {
    const c = await coinByMint(d, req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const latest = await d.prisma.holderBalance.findFirst({ where: { coinId: c.id }, orderBy: { snapshotHour: "desc" }, select: { snapshotHour: true } });
    if (!latest) return { items: [] };
    const top = await d.prisma.holderBalance.findMany({ where: { coinId: c.id, snapshotHour: latest.snapshotHour }, orderBy: { balance: "desc" }, take: 10 });
    const received = await d.prisma.payoutItem.groupBy({
      by: ["wallet"],
      where: { wallet: { in: top.map((h) => h.wallet) }, round: { coinId: c.id, dryRun: false } },
      _sum: { amountAsset: true },
    });
    const rec = new Map(received.map((r) => [r.wallet, r._sum.amountAsset ?? 0n]));
    const LABEL: Record<string, string> = { curve: "Bonding curve", pool: "Raydium pool", launcher: "Launcher wallet", divvy: "Divvy", burn: "Burned" };
    return {
      items: top.map((h) => ({
        wallet: h.wallet,
        label: h.excludedReason ? LABEL[h.excludedReason] ?? null : null,
        pct: (Number(h.balance) / 1e15) * 100,
        balance: amount(h.balance, 6),
        received: h.excludedReason ? null : amount(rec.get(h.wallet) ?? 0n, c.dividendAsset.decimals),
        excluded: !!h.excludedReason,
        excludedReason: (h.excludedReason as "curve" | "pool" | "launcher" | "divvy" | "burn" | null) ?? null,
      })),
    };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/payouts", async (req, reply) => {
    const c = await coinByMint(d, req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const page = PageQuery.parse(req.query);
    const before = page.cursor && !Number.isNaN(Date.parse(page.cursor)) ? new Date(page.cursor) : undefined;
    const rows = await d.prisma.payoutRound.findMany({
      where: { coinId: c.id, dryRun: false, status: { in: ["ok", "late"] }, ...(before ? { hour: { lt: before } } : {}) },
      orderBy: { hour: "desc" },
      take: page.limit + 1,
      include: { coin: { include: { dividendAsset: true } } },
    });
    const more = rows.length > page.limit;
    return { items: rows.slice(0, page.limit).map(toRound), nextCursor: more ? rows[page.limit - 1]!.hour.toISOString() : null };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/meter", async (req, reply): Promise<Meter | void> => {
    const c = await coinByMint(d, req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const now = Date.now();
    const [rounds, pending, solUsd, current] = await Promise.all([
      d.prisma.payoutRound.findMany({ where: { coinId: c.id, dryRun: false, hour: { gte: new Date(now - 24 * HOUR) } }, include: { coin: { include: { dividendAsset: true } } }, orderBy: { hour: "desc" } }),
      pendingHoldersLamports(d, c.id),
      d.prices().then((p) => p.solUsd),
      d.prisma.payoutRound.findUnique({ where: { coinId_hour_dryRun: { coinId: c.id, hour: new Date(topOfHour(now)), dryRun: false } } }),
    ]);
    const lastOk = rounds.find((r) => r.status === "ok");
    const late = !current && now - topOfHour(now) > d.params.lateAfterSec * 1000 && now - (c.launchedAt?.getTime() ?? now) > HOUR;
    return {
      paid24hUsd: rounds.filter((r) => r.status === "ok").map(toRound).reduce((a, r) => a + r.usd, 0),
      pendingUsd: (Number(pending) / 1e9) * solUsd,
      lastPayoutAt: lastOk ? (lastOk.finishedAt ?? lastOk.hour).toISOString() : null,
      status: late || current?.status === "late" || current?.status === "failed" ? "late" : current?.status === "carried" ? "carried" : "ok",
      nextRoundAt: iso(topOfHour(now) + HOUR),
    };
  });

  app.get("/api/payouts", async (req, reply): Promise<PayoutList | void> => {
    const q = z.object({ asset: z.string().max(16).optional(), cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(60) }).safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid payouts query");
    const now = Date.now();
    const before = q.data.cursor && !Number.isNaN(Date.parse(q.data.cursor)) ? new Date(q.data.cursor) : undefined;
    const assetWhere = q.data.asset && q.data.asset !== "all" ? { coin: { dividendAsset: { symbol: q.data.asset } } } : {};
    const [rows, agg, rows24, pending, solUsd, board] = await Promise.all([
      d.prisma.payoutRound.findMany({
        where: { dryRun: false, status: { in: ["ok", "late"] }, ...assetWhere, ...(before ? { hour: { lt: before } } : {}) },
        orderBy: [{ hour: "desc" }, { assetOut: "desc" }],
        take: q.data.limit + 1,
        include: { coin: { include: { dividendAsset: true } } },
      }),
      d.prisma.payoutRound.aggregate({ where: { dryRun: false, status: "ok" }, _count: true, _sum: { holdersPaid: true } }),
      d.prisma.payoutRound.count({ where: { dryRun: false, status: { in: ["late", "failed"] }, hour: { gte: new Date(topOfHour(now) - HOUR) } } }),
      pendingHoldersLamports(d),
      d.prices().then((p) => p.solUsd),
      boardRows(d),
    ]);
    const more = rows.length > q.data.limit;
    return {
      summary: {
        paidUsd: board.reduce((a, c) => a + (c.stats?.paidUsd ?? 0), 0),
        rounds: agg._count,
        walletPayments: agg._sum.holdersPaid ?? 0,
        pendingUsd: (Number(pending) / 1e9) * solUsd,
        status: rows24 > 0 ? "late" : "ok",
        lateCoins: rows24,
      },
      items: rows.slice(0, q.data.limit).map(toReceipt),
      nextCursor: more ? rows[q.data.limit - 1]!.hour.toISOString() : null,
    };
  });

  // Local storage driver: serve stored media (S3 deployments serve from the bucket's public URL).
  app.get<{ Params: { "*": string } }>("/api/media/files/*", async (req, reply) => {
    if (!d.storage.read) return sendError(reply, 404, "NOT_FOUND", "No such file");
    const f = await d.storage.read(req.params["*"]).catch(() => null);
    if (!f) return sendError(reply, 404, "NOT_FOUND", "No such file");
    return reply.header("content-type", f.contentType).header("cache-control", "public, max-age=31536000, immutable").header("x-content-type-options", "nosniff").send(f.body);
  });
}
