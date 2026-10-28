import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@divvy/db";
import {
  CandleTfSchema,
  CoinSortSchema,
  foldTicker,
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
  coinMatches,
  parseCoinSearch,
} from "@divvy/shared";
import { getLaunchSettings } from "@divvy/server";
import { graduationFdvLamports, LAUNCHLAB_DEFAULT_CURVE, WSOL_MINT } from "@divvy/solana";
import { sendError } from "../../errors";
import type { LiveDeps } from "../deps";
import { CREATE_COST_LAMPORTS } from "../launchfee";
import { amount, boardRows, coinByMint, coinByTicker, HOUR, pendingHoldersLamports, toDetail, toReceipt, toRound, toSummary, topOfHour, type CoinRow } from "../data";

/** Rounds that paid holders: live, delivered, on time or late (carried rounds paid nothing). */
const PAID = { dryRun: false, step: "delivered", status: { in: ["ok", "late"] } } satisfies Prisma.PayoutRoundWhereInput;

const PageQuery = z.object({ cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(60) });
const iso = (t: number | Date) => new Date(t).toISOString();
// The indexer stores 1m, 5m, 1h and 1d candles; 15m and 4h are made from 5m and 1h ones.
const TF = {
  "1m": { db: "m1", n: 1 },
  "5m": { db: "m5", n: 1 },
  "15m": { db: "m5", n: 3 },
  "1h": { db: "h1", n: 1 },
  "4h": { db: "h1", n: 4 },
  "1d": { db: "d1", n: 1 },
} as const;
const TF_SEC = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 } as const;

type CandleRow = { ts: Date; o: unknown; h: unknown; l: unknown; c: unknown; volSol: bigint };
/** Stored candles, oldest first, merged into buckets of `span` seconds (15m from 5m, 4h from 1h). */
export function mergeCandles(rows: CandleRow[], span: number): { t: number; o: number; h: number; l: number; c: number; vol: bigint }[] {
  const out: { t: number; o: number; h: number; l: number; c: number; vol: bigint }[] = [];
  for (const r of rows) {
    const t = Math.floor(r.ts.getTime() / 1000 / span) * span;
    const last = out[out.length - 1];
    if (last?.t === t) {
      last.h = Math.max(last.h, Number(r.h));
      last.l = Math.min(last.l, Number(r.l));
      last.c = Number(r.c);
      last.vol += r.volSol;
    } else out.push({ t, o: Number(r.o), h: Number(r.h), l: Number(r.l), c: Number(r.c), vol: r.volSol });
  }
  return out;
}

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
      launchFee: { amount: amount(d.env.LAUNCH_FEE_LAMPORTS, 9), to: d.env.LAUNCH_FEE_LAMPORTS > 0n ? d.env.LAUNCH_FEE_WALLET! : null, createCost: amount(CREATE_COST_LAMPORTS, 9) },
      fees: { ...p.fees, afterGraduation: { holders: p.poolSplit.holdersBps, creator: p.poolSplit.creatorBps, divvy: p.poolSplit.divvyBps } },
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
      payouts: { intervalSec: 3600, lateAfterSec: p.lateAfterSec, minHolderUsd: p.minHolderUsd, minRoundUsd: p.minRoundUsd, delivery: p.delivery, autoPushMinUsd: p.delivery === "claim" ? p.autoPushMinUsd : null, deliveryFeeUsd: p.deliveryFeeUsd },
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
      d.prisma.payoutRound.findFirst({ where: { ...PAID, coin: { hidden: false } }, orderBy: { hour: "desc" }, select: { hour: true } }),
    ]);
    const round = last
      ? await d.prisma.payoutRound.findMany({ where: { ...PAID, coin: { hidden: false }, hour: last.hour }, include: { coin: { include: { dividendAsset: true } } } })
      : [];
    const items = round.map(toReceipt).sort((a, b) => b.usd - a.usd);
    const recentRounds = await d.prisma.payoutRound.findMany({
      where: { ...PAID, coin: { hidden: false } },
      orderBy: { hour: "desc" },
      take: 16,
      include: { coin: { include: { dividendAsset: true } } },
    });
    const activity: LiveEvent[] = recentRounds.map((r) => {
      const x = toReceipt(r);
      return { type: "payout_round", at: x.hour, mint: x.coin.mint, ticker: x.coin.ticker, imageUrl: x.coin.imageUrl, assetSymbol: x.assetSymbol, amount: x.amount, usd: x.usd, wallets: x.wallets };
    });
    const launched = rows.filter((c) => c.launchedAt && now - c.launchedAt.getTime() < HOUR).sort((a, b) => b.launchedAt!.getTime() - a.launchedAt!.getTime());
    for (const c of launched.slice(0, 10))
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
      .object({
        sort: CoinSortSchema.default("trending"),
        pays: z.string().max(16).optional(),
        q: z.string().max(64).optional(),
        // Every coin whose ticker reads the same (foldTicker), for the coin page's ticker chooser.
        ticker: z.string().max(64).optional(),
        cursor: z.coerce.number().int().min(0).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(60),
      })
      .safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid coin query");
    const [rows, prices] = await Promise.all([boardRows(d), d.prices()]);
    // By ticker, name, CA or stock (packages/shared search.ts).
    const search = parseCoinSearch(q.data.q);
    let list = rows.filter((c) => coinMatches({ mint: c.mint, name: c.name, ticker: c.ticker, stocks: [c.dividendAsset.symbol, c.dividendAsset.name] }, search));
    if (q.data.ticker) {
      const norm = foldTicker(q.data.ticker);
      list = list.filter((c) => c.tickerNorm === norm);
    }
    if (q.data.pays && q.data.pays !== "all") list = list.filter((c) => c.dividendAsset.symbol === q.data.pays);
    const sorted = sortRows(list, q.data.sort, Date.now());
    const cursor = q.data.cursor ?? 0;
    return {
      items: sorted.slice(cursor, cursor + q.data.limit).map((c) => toSummary(c, prices.solUsd)),
      nextCursor: cursor + q.data.limit < sorted.length ? String(cursor + q.data.limit) : null,
    };
  });

  app.get<{ Params: { ticker: string } }>("/api/coins/:ticker", async (req, reply) => {
    // A coin's mint, or a ticker (coins can share one: the first launched with it).
    if (req.params.ticker.length > 44) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const c = (await coinByMint(d, req.params.ticker)) ?? (await coinByTicker(d, req.params.ticker));
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", `There's no coin called $${req.params.ticker} here yet.`);
    return toDetail(c, (await d.prices()).solUsd);
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/trades", async (req, reply) => {
    const c = await coinByMint(d, req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const pq = PageQuery.safeParse(req.query);
    if (!pq.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid page");
    const page = pq.data;
    const cursor = page.cursor && /^\d{1,18}$/.test(page.cursor) ? BigInt(page.cursor) : undefined;
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
    const { db, n } = TF[q.data.tf];
    const rows = await d.prisma.candle.findMany({ where: { coinId: c.id, tf: db }, orderBy: { ts: "desc" }, take: q.data.limit * n });
    const merged = mergeCandles(rows.reverse(), TF_SEC[q.data.tf]);
    return {
      tf: q.data.tf,
      unit: q.data.unit,
      items: merged.slice(-q.data.limit).map((r) => ({ t: r.t, o: r.o * k, h: r.h * k, l: r.l * k, c: r.c * k, vol: amount(r.vol, 9) })),
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
      items: top.map((h) => {
        // "small" is a holder whose stake was under the minimum that hour: still a holder, not an
        // excluded wallet (and not in the response's enum, audit).
        const why = h.excludedReason === "small" ? null : h.excludedReason;
        return {
          wallet: h.wallet,
          label: why ? LABEL[why] ?? null : null,
          pct: (Number(h.balance) / 1e15) * 100,
          balance: amount(h.balance, 6),
          received: why ? null : amount(rec.get(h.wallet) ?? 0n, c.dividendAsset.decimals),
          excluded: !!why,
          excludedReason: (why as "curve" | "pool" | "launcher" | "divvy" | "burn" | null) ?? null,
        };
      }),
    };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/payouts", async (req, reply) => {
    const c = await coinByMint(d, req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const pq = PageQuery.safeParse(req.query);
    if (!pq.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid page");
    const page = pq.data;
    const before = page.cursor && !Number.isNaN(Date.parse(page.cursor)) ? new Date(page.cursor) : undefined;
    const rows = await d.prisma.payoutRound.findMany({
      where: { ...PAID, coinId: c.id, ...(before ? { hour: { lt: before } } : {}) },
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
    const thisHour = topOfHour(now);
    const roundAt = (hour: number) => d.prisma.payoutRound.findUnique({ where: { coinId_hour_dryRun: { coinId: c.id, hour: new Date(hour), dryRun: false } } });
    const [rounds, pending, solUsd, current, previous] = await Promise.all([
      d.prisma.payoutRound.findMany({ where: { ...PAID, coinId: c.id, hour: { gte: new Date(now - 24 * HOUR) } }, include: { coin: { include: { dividendAsset: true } } }, orderBy: { hour: "desc" } }),
      pendingHoldersLamports(d, c.id),
      d.prices().then((p) => p.solUsd),
      roundAt(thisHour),
      roundAt(thisHour - HOUR),
    ]);
    const lastPaid = rounds[0];
    // Late = a round that missed its SLA (hour + 60 min + grace, HANDOFF §3.3), the worker's definition.
    // A coin with nothing to pay has no round and isn't late.
    const overdue = (r: typeof previous, hour: number) => !!r && (r.status === "late" || r.status === "failed" || (r.step !== "delivered" && now > hour + HOUR + d.params.lateAfterSec * 1000));
    const late = overdue(previous, thisHour - HOUR) || overdue(current, thisHour);
    return {
      paid24hUsd: rounds.map(toRound).reduce((a, r) => a + r.usd, 0),
      pendingUsd: (Number(pending) / 1e9) * solUsd,
      lastPayoutAt: lastPaid ? (lastPaid.finishedAt ?? lastPaid.hour).toISOString() : null,
      status: late ? "late" : current?.status === "carried" ? "carried" : "ok",
      nextRoundAt: iso(topOfHour(now) + HOUR),
    };
  });

  // The payouts page's totals scan every round and every trade since the last claim, so one result is
  // shared by all requests for 10 s instead of being recomputed on each (audit).
  const loadTotals = (now: number) =>
    Promise.all([
      d.prisma.payoutRound.aggregate({ where: { ...PAID, coin: { hidden: false } }, _count: true, _sum: { holdersPaid: true } }),
      d.prisma.payoutRound.count({ where: { dryRun: false, status: { in: ["late", "failed"] }, hour: { gte: new Date(topOfHour(now) - HOUR) } } }),
      pendingHoldersLamports(d),
    ]);
  let totals: { at: number; value: ReturnType<typeof loadTotals> } | null = null;
  const payoutTotals = (now: number) => {
    if (!totals || now - totals.at > 10_000) {
      const value = loadTotals(now);
      totals = { at: now, value };
      value.catch(() => {
        if (totals?.value === value) totals = null; // a failure isn't kept
      });
    }
    return totals.value;
  };

  app.get("/api/payouts", async (req, reply): Promise<PayoutList | void> => {
    const q = z.object({ asset: z.string().max(16).optional(), cursor: z.string().max(64).optional(), limit: z.coerce.number().int().min(1).max(100).default(60) }).safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid payouts query");
    const now = Date.now();
    // Cursor "<hour ISO>|<round id>": many coins share an hour, so the hour alone would skip rows.
    const [cHour, cId] = (q.data.cursor ?? "").split("|");
    const before = cHour && cId && !Number.isNaN(Date.parse(cHour)) ? { hour: new Date(cHour), id: cId } : null;
    const assetWhere = q.data.asset && q.data.asset !== "all" ? { coin: { hidden: false, dividendAsset: { symbol: q.data.asset } } } : { coin: { hidden: false } };
    const [rows, [agg, rows24, pending], solUsd, board] = await Promise.all([
      d.prisma.payoutRound.findMany({
        where: { ...PAID, ...assetWhere, ...(before ? { OR: [{ hour: { lt: before.hour } }, { hour: before.hour, id: { lt: before.id } }] } : {}) },
        orderBy: [{ hour: "desc" }, { id: "desc" }],
        take: q.data.limit + 1,
        include: { coin: { include: { dividendAsset: true } } },
      }),
      payoutTotals(now),
      d.prices().then((p) => p.solUsd),
      boardRows(d),
    ]);
    const more = rows.length > q.data.limit;
    const lastRow = rows[q.data.limit - 1];
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
      nextCursor: more && lastRow ? `${lastRow.hour.toISOString()}|${lastRow.id}` : null,
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
