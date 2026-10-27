import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  avatarSvg,
  mulberry32,
  CandleTfSchema,
  CoinSortSchema,
  IMAGE_MAX_BYTES,
  IMAGE_TYPES,
  TICKER_MAX,
  TICKER_MIN,
  type CandleList,
  type CoinList,
  type CoinPayoutListSchema,
  type Config,
  type HolderListSchema,
  type LiveEvent,
  type Meter,
  type PayoutList,
  type Stats,
  type TradeListSchema,
} from "@divvy/shared";
import { LAUNCHLAB_DEFAULT_CURVE, WSOL_MINT } from "@divvy/solana";
import { sendError } from "../errors";
import { ASSET, ASSETS, HOUR, mcapAt, minutesOld, rounds, SOL_USD, topOfHour, trades, type MockCoin } from "../mock/data";
import {
  allRounds,
  amount,
  holders,
  imageUrl,
  paidLast24hUsd,
  pendingUsd,
  toDetail,
  toReceipt,
  toRound,
  toSummary,
  type MockStore,
} from "../mock/store";

type CoinPayoutList = z.infer<typeof CoinPayoutListSchema>;
type HolderList = z.infer<typeof HolderListSchema>;
type TradeList = z.infer<typeof TradeListSchema>;

export const FEES = { tradeFeeBps: 100, protocolBps: 25, holdersBps: 50, creatorBps: 15, divvyBps: 10 };

export function buildConfig(): Config {
  const c = LAUNCHLAB_DEFAULT_CURVE;
  const units = (raw: bigint, decimals: number) => ({ raw: raw.toString(), decimals, ui: Number(raw) / 10 ** decimals });
  return {
    network: "mainnet-beta",
    demo: true,
    launchesOpen: true,
    launchesPausedReason: null,
    launchFee: { amount: amount(0, 9), to: null },
    fees: FEES,
    graduation: {
      // The prototype says "graduates at $48k". The real figure is graduation FDV (≈ 410.8 SOL with the
      // SDK defaults) × the live SOL price (docs/VERIFIED.md item 8). The demo keeps the prototype's number.
      targetUsd: 48_000,
      quoteFundRaising: units(c.totalFundRaisingB, 9),
      totalSupply: units(c.supply, c.decimals),
      curveSupply: units(c.totalSellA, c.decimals),
      migrateSupply: units(c.supply - c.totalSellA, c.decimals),
    },
    limits: {
      launchesPerWalletPerDay: 3,
      launchesPerDayGlobal: 2000,
      launchCooldownSec: 120,
      tickerMinLen: TICKER_MIN,
      tickerMaxLen: TICKER_MAX,
      nameMaxLen: 32,
      descriptionMaxLen: 280,
      imageMaxBytes: IMAGE_MAX_BYTES,
      imageTypes: [...IMAGE_TYPES],
    },
    payouts: { intervalSec: 3600, lateAfterSec: 900, minHolderUsd: 10, minRoundUsd: 5, delivery: "push", autoPushMinUsd: null, deliveryFeeUsd: 0.02 },
    quote: { symbol: "SOL", mint: WSOL_MINT, decimals: 9, priceUsd: SOL_USD },
    // Stock mints are fetched into the DividendAsset table (packages/solana/scripts/phase0/fetch-xstocks.ts),
    // never typed by hand, so the demo has none.
    dividendAssets: ASSETS.map((a) => {
      const sol = a.symbol === "SOL";
      return {
        symbol: a.symbol,
        name: a.name,
        kind: a.kind,
        mint: sol ? WSOL_MINT : null,
        decimals: sol ? 9 : null,
        tokenProgram: sol ? "spl-token" : null,
        logoUrl: null,
        mono: a.mono,
        chipBg: a.chipBg,
        chipFg: a.chipFg,
        priceUsd: a.priceUsd,
        change24hPct: a.change24hPct,
        featured: a.featured,
        enabled: true,
      };
    }),
    flags: { xOAuth: false, trading: false },
  };
}

const CoinsQuery = z.object({
  sort: CoinSortSchema.default("trending"),
  pays: z.string().optional(),
  q: z.string().max(64).optional(),
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

const PageQuery = z.object({
  cursor: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(60),
});

const iso = (t: number) => new Date(t).toISOString();

export function sortCoins(list: MockCoin[], sort: z.infer<typeof CoinSortSchema>, now: number): MockCoin[] {
  const age = (c: MockCoin) => minutesOld(c, now);
  const by: Record<typeof sort, (a: MockCoin, b: MockCoin) => number> = {
    trending: (a, b) => b.vol / (age(b) + 60) - a.vol / (age(a) + 60),
    new: (a, b) => b.createdAt - a.createdAt,
    payers: (a, b) => b.vol - a.vol,
    graduate: (a, b) => Number(a.graduated) - Number(b.graduated) || b.progress - a.progress,
  };
  return list.slice().sort(by[sort]);
}

export function activity(store: MockStore, now: number): LiveEvent[] {
  // Prototype `renderStrip`: recent payouts, with launches from the last hour and graduations mixed in.
  const r = mulberry32(42);
  const ev: LiveEvent[] = allRounds(store, now)
    .slice(0, 16)
    .map((p) => ({ type: "payout_round", at: iso(p.hour), mint: p.coin.mint, ticker: p.coin.ticker, imageUrl: imageUrl(p.coin), assetSymbol: p.coin.pays, amount: amount(p.amount, ASSET[p.coin.pays]!.decimals), usd: p.usd, wallets: p.wallets }));
  for (const c of store.coins.filter((c) => minutesOld(c, now) < 60))
    ev.splice(Math.floor(r() * ev.length), 0, { type: "launch", at: iso(c.createdAt), mint: c.mint, ticker: c.ticker, name: c.name, imageUrl: imageUrl(c) });
  for (const c of store.coins.filter((c) => c.graduated).slice(0, 3))
    ev.splice(Math.floor(r() * ev.length), 0, { type: "graduate", at: iso(c.createdAt), mint: c.mint, ticker: c.ticker, imageUrl: imageUrl(c) });
  return ev;
}

const TF_SEC: Record<z.infer<typeof CandleTfSchema>, number> = { "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

export async function publicRoutes(app: FastifyInstance, { store }: { store: MockStore }) {
  const config = buildConfig();

  app.get("/api/health", async () => ({ ok: true, mode: "mock", uptimeSec: Math.round(process.uptime()) }));

  app.get("/api/config", async (): Promise<Config> => config);

  app.get("/api/stats", async (): Promise<Stats> => {
    store.tick();
    const now = Date.now();
    const all = allRounds(store, now);
    const latest = all[0]?.hour;
    const round = all.filter((p) => p.hour === latest);
    return {
      coinsLive: store.coins.length,
      paidToHoldersUsd: store.coins.reduce((a, c) => a + c.paidUsd, 0),
      volume24hUsd: store.coins.reduce((a, c) => a + c.vol, 0),
      assetsInUse: [...new Set(store.coins.map((c) => c.pays))],
      lastRound:
        latest === undefined
          ? null
          : {
              hour: iso(latest),
              paidUsd: round.reduce((a, p) => a + p.usd, 0),
              wallets: round.reduce((a, p) => a + p.wallets, 0),
              items: round.slice(0, 3).map((p) => ({ mint: p.coin.mint, ticker: p.coin.ticker, imageUrl: imageUrl(p.coin), assetSymbol: p.coin.pays, amount: amount(p.amount, ASSET[p.coin.pays]!.decimals), usd: p.usd })),
            },
      nextRoundAt: iso(topOfHour(now) + HOUR),
      activity: activity(store, now),
    };
  });

  app.get("/api/coins", async (req, reply): Promise<CoinList | void> => {
    const q = CoinsQuery.safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid coin query");
    store.tick();
    const now = Date.now();
    const { sort, pays, cursor = 0, limit } = q.data;
    const needle = q.data.q?.trim().toLowerCase();
    let list = store.coins;
    if (needle) list = list.filter((c) => [c.name, c.ticker, c.pays, ASSET[c.pays]!.name].some((s) => s.toLowerCase().includes(needle)));
    if (pays && pays !== "all") list = list.filter((c) => c.pays === pays);
    const sorted = sortCoins(list, sort, now);
    const page = sorted.slice(cursor, cursor + limit);
    return { items: page.map((c) => toSummary(c, now)), nextCursor: cursor + limit < sorted.length ? String(cursor + limit) : null };
  });

  app.get<{ Params: { ticker: string } }>("/api/coins/:ticker", async (req, reply) => {
    store.tick();
    const c = store.coinByTicker(req.params.ticker);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", `There's no coin called $${req.params.ticker} here yet.`);
    return toDetail(c, Date.now());
  });

  const withCoin = (mint: string) => store.coinByMint(mint);

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/trades", async (req, reply): Promise<TradeList | void> => {
    const c = withCoin(req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const pq = PageQuery.safeParse(req.query);
    if (!pq.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid page");
    const page = pq.data;
    const all = trades(c, Date.now());
    const cursor = page.cursor ?? 0;
    return {
      items: all.slice(cursor, cursor + page.limit).map((t) => ({ sig: t.sig, side: t.side, sol: amount(t.sol, 9), token: amount(t.tokens, 6), wallet: t.wallet, ts: iso(t.at) })),
      nextCursor: cursor + page.limit < all.length ? String(cursor + page.limit) : null,
    };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/candles", async (req, reply): Promise<CandleList | void> => {
    const c = withCoin(req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const q = z
      .object({ tf: CandleTfSchema.default("5m"), unit: z.enum(["mcap", "price"]).default("mcap"), limit: z.coerce.number().int().min(2).max(1000).default(300) })
      .safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid candle query");
    const now = Date.now();
    const step = TF_SEC[q.data.tf] * 1000;
    const last = Math.floor(now / step) * step;
    const first = Math.max(Math.floor(c.createdAt / step) * step, last - (q.data.limit - 1) * step);
    const k = q.data.unit === "price" ? 1e-9 : 1;
    const items: CandleList["items"] = [];
    for (let t = first; t <= last; t += step) {
      const o = mcapAt(c, now, Math.max(t, c.createdAt)) * k;
      const cl = mcapAt(c, now, Math.min(t + step, now)) * k;
      items.push({ t: t / 1000, o, h: Math.max(o, cl), l: Math.min(o, cl), c: cl, vol: amount((c.vol / (86400_000 / step)) / SOL_USD, 9) });
    }
    if (items.length === 1) items.unshift({ ...items[0]!, t: items[0]!.t - step / 1000, o: 2900 * k, c: 2900 * k, h: 2900 * k, l: 2900 * k });
    return { tf: q.data.tf, unit: q.data.unit, items };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/holders", async (req, reply): Promise<HolderList | void> => {
    const c = withCoin(req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const a = ASSET[c.pays]!;
    return {
      items: holders(c, Date.now()).map((h) => ({
        wallet: h.wallet,
        label: h.label,
        pct: h.pct,
        balance: amount((h.pct / 100) * 1e9, 6),
        received: h.received == null ? null : amount(h.received, a.decimals),
        excluded: h.excludedReason !== null,
        excludedReason: h.excludedReason,
      })),
    };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/payouts", async (req, reply): Promise<CoinPayoutList | void> => {
    const c = withCoin(req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const pq = PageQuery.safeParse(req.query);
    if (!pq.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid page");
    const page = pq.data;
    const all = rounds(c, Date.now(), 24);
    const cursor = page.cursor ?? 0;
    return { items: all.slice(cursor, cursor + page.limit).map(toRound), nextCursor: cursor + page.limit < all.length ? String(cursor + page.limit) : null };
  });

  app.get<{ Params: { mint: string } }>("/api/coins/:mint/meter", async (req, reply): Promise<Meter | void> => {
    const c = withCoin(req.params.mint);
    if (!c) return sendError(reply, 404, "COIN_NOT_FOUND", "Unknown coin");
    const now = Date.now();
    return {
      paid24hUsd: paidLast24hUsd(c, now),
      pendingUsd: pendingUsd(c, now),
      lastPayoutAt: minutesOld(c, now) < 60 ? null : iso(topOfHour(now)),
      status: "ok",
      nextRoundAt: iso(topOfHour(now) + HOUR),
    };
  });

  app.get("/api/payouts", async (req, reply): Promise<PayoutList | void> => {
    const q = z.object({ asset: z.string().optional(), cursor: z.coerce.number().int().min(0).optional(), limit: z.coerce.number().int().min(1).max(100).default(60) }).safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid payouts query");
    store.tick();
    const now = Date.now();
    const all = allRounds(store, now);
    const rows = q.data.asset && q.data.asset !== "all" ? all.filter((p) => p.coin.pays === q.data.asset) : all;
    const cursor = q.data.cursor ?? 0;
    return {
      summary: {
        paidUsd: store.coins.reduce((a, c) => a + c.paidUsd, 0),
        rounds: all.length,
        walletPayments: all.reduce((a, p) => a + p.wallets, 0),
        pendingUsd: store.coins.reduce((a, c) => a + pendingUsd(c, now), 0),
        status: "ok",
        lateCoins: 0,
      },
      items: rows.slice(cursor, cursor + q.data.limit).map(toReceipt),
      nextCursor: cursor + q.data.limit < rows.length ? String(cursor + q.data.limit) : null,
    };
  });

  /* media (mock only; production serves images from object storage / IPFS) */
  app.get<{ Params: { ticker: string } }>("/api/media/coin/:ticker.svg", async (req, reply) => {
    const c = store.coinByTicker(req.params.ticker);
    const svg = c && c.image.kind === "svg" ? avatarSvg(c.image.seed) : avatarSvg(req.params.ticker);
    return reply.header("content-type", "image/svg+xml").header("cache-control", "public, max-age=86400").send(svg);
  });

  app.get<{ Params: { id: string } }>("/api/media/upload/:id", async (req, reply) => {
    const u = store.uploads.get(req.params.id);
    if (!u) return sendError(reply, 404, "NOT_FOUND", "No such image");
    return reply.header("content-type", u.contentType).header("cache-control", "public, max-age=31536000, immutable").send(u.buf);
  });
}
