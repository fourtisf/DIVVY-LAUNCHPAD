/** Reads from Postgres and maps rows to the API contract (packages/shared/src/api.ts). */
import type { Prisma } from "@divvy/db";
import {
  foldName,
  foldTicker,
  short,
  splitByWeights,
  type Amount,
  type CoinDetail,
  type CoinSummary,
  type CoinIdentity,
  type PayoutRound as PayoutRoundDto,
  type Receipt,
  xProfileUrl,
} from "@divvy/shared";
import type { LiveDeps } from "./deps";

export const HOUR = 3_600_000;
export const topOfHour = (t: number) => Math.floor(t / HOUR) * HOUR;
const COIN_SUPPLY_TOKENS = 1e9;

export function amount(raw: bigint | number | string, decimals: number): Amount {
  const r = BigInt(raw);
  return { raw: (r < 0n ? 0n : r).toString(), decimals, ui: Number(r < 0n ? 0n : r) / 10 ** decimals };
}

export const coinInclude = { stats: true, dividendAsset: true, creator: true } satisfies Prisma.CoinInclude;
export type CoinRow = Prisma.CoinGetPayload<{ include: typeof coinInclude }>;

/** Coins anyone can see: created on chain and not hidden by moderation. */
export const visibleWhere: Prisma.CoinWhereInput = { status: { in: ["live", "graduated"] }, hidden: false, mint: { not: null } };

export function toSummary(c: CoinRow, solUsd: number): CoinSummary {
  const s = c.stats;
  const a = c.dividendAsset;
  return {
    mint: c.mint!,
    ticker: c.ticker,
    name: c.name,
    imageUrl: c.imageUrl,
    dividendAsset: a.symbol,
    status: c.status === "graduated" ? "graduated" : "live",
    createdAt: (c.launchedAt ?? c.createdAt).toISOString(),
    creator: { wallet: c.creatorWallet, xHandle: c.creator.xHandle, label: c.creator.xHandle ?? short(c.creatorWallet) },
    marketCapUsd: s ? Number(s.priceSol) * COIN_SUPPLY_TOKENS * solUsd : 0,
    change24hPct: s?.change24hPct ?? 0,
    volume24hUsd: s?.volume24hUsd ?? 0,
    holders: s?.holders ?? 0,
    paidUsd: s?.paidUsd ?? 0,
    paid24hUsd: s?.paid24hUsd ?? 0,
    paid24h: amount(s?.paid24hAsset ?? 0n, a.decimals),
    progress: c.status === "graduated" ? 1 : Math.min(1, (s?.progressBps ?? 0) / 10_000),
    spark: Array.isArray(s?.spark) ? (s!.spark as number[]).filter((n) => typeof n === "number") : [],
  };
}

export function toDetail(c: CoinRow, solUsd: number): CoinDetail {
  const s = c.stats;
  const priceSol = s ? Number(s.priceSol) : 0;
  const links = (c.links ?? {}) as { x?: string; telegram?: string; website?: string };
  return {
    ...toSummary(c, solUsd),
    description: c.description,
    athUsd: s?.athUsd ?? 0,
    priceUsd: priceSol * solUsd,
    priceSol,
    supply: amount(1_000_000_000_000_000n, 6),
    paid: amount(s?.paidAsset ?? 0n, c.dividendAsset.decimals),
    links: { x: links.x ?? null, telegram: links.telegram ?? null, website: links.website ?? null },
    cpmmPool: c.cpmmPool,
    createdSig: c.createdSig,
  };
}

type RoundRow = Prisma.PayoutRoundGetPayload<{ include: { coin: { include: { dividendAsset: true } } } }>;

export function toRound(r: RoundRow): PayoutRoundDto {
  const a = r.coin.dividendAsset;
  const ui = Number(r.assetOut) / 10 ** a.decimals;
  return {
    id: r.id,
    hour: r.hour.toISOString(),
    status: r.status,
    assetSymbol: a.symbol,
    amount: amount(r.assetOut, a.decimals),
    usd: r.priceUsd ? ui * Number(r.priceUsd) : 0,
    wallets: r.holdersPaid,
    sig: r.swapSig,
  };
}

export const toReceipt = (r: RoundRow): Receipt => ({ ...toRound(r), coin: { mint: r.coin.mint!, ticker: r.coin.ticker, imageUrl: r.coin.imageUrl } });

/* ---------- board cache ---------- */

let board: { at: number; rows: CoinRow[] } | null = null;
let loading: Promise<CoinRow[]> | null = null;

/**
 * All visible coins with stats, refreshed at most every 5 s (sorting and filtering happen in memory).
 * One query refreshes the cache however many requests arrive meanwhile, and they get the previous
 * rows instead of waiting (load test: 1,000 coins at 200 req/s).
 */
export async function boardRows(d: LiveDeps): Promise<CoinRow[]> {
  if (board && Date.now() - board.at < 5000) return board.rows;
  loading ??= d.prisma.coin
    .findMany({ where: visibleWhere, include: coinInclude })
    .then((rows) => {
      board = { at: Date.now(), rows };
      return rows;
    })
    .finally(() => {
      loading = null;
    });
  if (board) {
    loading.catch(() => {}); // a failed refresh keeps serving the previous rows
    return board.rows;
  }
  return loading;
}

export const invalidateBoard = () => {
  board = null;
};

export async function coinByTicker(d: LiveDeps, ticker: string): Promise<CoinRow | null> {
  const c = await d.prisma.coin.findUnique({ where: { tickerNorm: foldTicker(ticker) }, include: coinInclude });
  return c && c.status !== "pending" && c.status !== "failed" && !c.hidden && c.mint ? c : null;
}

export async function coinByMint(d: LiveDeps, mint: string): Promise<CoinRow | null> {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(mint)) return null;
  const c = await d.prisma.coin.findUnique({ where: { mint }, include: coinInclude });
  return c && (c.status === "live" || c.status === "graduated") && !c.hidden ? c : null;
}

/* ---------- anti-vamp contexts backed by Postgres ---------- */

/** Coins that hold an identity: live, graduated, or still launching. Failed launches release theirs. */
const identityWhere: Prisma.CoinWhereInput = { status: { in: ["pending", "live", "graduated"] } };
const ident = (c: { ticker: string; name: string; mint: string | null; status: string }): CoinIdentity => ({
  ticker: c.ticker,
  name: c.name,
  // The mint of a coin that hasn't landed yet stays secret (HANDOFF §3.5).
  mint: c.status === "pending" ? null : c.mint,
});

export async function antiVampContexts(d: LiveDeps) {
  return {
    async ticker(norm: string) {
      const [hit, reserved] = await Promise.all([
        d.prisma.coin.findFirst({ where: { ...identityWhere, tickerNorm: norm }, select: { ticker: true, name: true, mint: true, status: true } }),
        d.prisma.reservedTicker.findUnique({ where: { tickerNorm: norm } }),
      ]);
      return { hit: hit ? ident(hit) : undefined, reserved: !!reserved };
    },
    /** Trigram prefilter, then the exact Levenshtein check runs in shared code. */
    async nameCandidates(name: string) {
      const norm = foldName(name);
      if (norm.length < 2) return [];
      const rows = await d.prisma.$queryRaw<{ ticker: string; name: string; mint: string | null; status: string; nameNorm: string }[]>`
        SELECT ticker, name, mint, status::text AS status, "nameNorm" FROM "Coin"
        WHERE status IN ('pending','live','graduated') AND similarity("nameNorm", ${norm}) > 0.2
        ORDER BY similarity("nameNorm", ${norm}) DESC LIMIT 200`;
      return rows.map((r) => ({ ...ident(r), nameNorm: r.nameNorm }));
    },
    async xHandle(handle: string) {
      const hit = await d.prisma.coin.findFirst({
        // The coin's X link (stored as xProfileUrl), or a creator's verified X account.
        where: { ...identityWhere, OR: [{ links: { path: ["x"], equals: xProfileUrl(handle) } }, { creator: { xHandle: { equals: handle, mode: "insensitive" } } }] },
        select: { ticker: true, name: true, mint: true, status: true },
      });
      return hit ? ident(hit) : undefined;
    },
  };
}

let phashCache: { at: number; rows: { ticker: string; name: string; mint: string | null; status: string; imagePhash: string; imageSha256: string; creatorUserId: string }[] } | null = null;

export async function pictureCandidates(d: LiveDeps) {
  if (phashCache && Date.now() - phashCache.at < 30_000) return phashCache.rows;
  const rows = await d.prisma.coin.findMany({
    where: identityWhere,
    select: { ticker: true, name: true, mint: true, status: true, imagePhash: true, imageSha256: true, creatorUserId: true },
  });
  phashCache = { at: Date.now(), rows: rows.map((r) => ({ ...r, status: r.status as string })) };
  return phashCache.rows;
}
export const invalidatePictures = () => {
  phashCache = null;
};
export { ident as identityOf };

/* ---------- money waiting for the next round ---------- */

/**
 * Lamports in the holders' bucket that no round has spent yet: allocations carried forward, plus the
 * platform fees of every trade after the last attributed vault claim (still in the vault, or claimed
 * but not yet attributed), split like a claim would be.
 */
export async function pendingHoldersLamports(d: LiveDeps, coinId?: string): Promise<bigint> {
  const last = await d.prisma.vaultClaim.findFirst({ where: { dryRun: false, attributedAt: { not: null }, toTradeId: { not: null } }, orderBy: { toTradeId: "desc" }, select: { toTradeId: true } });
  const [carried, accrued] = await Promise.all([
    d.prisma.feeAllocation.aggregate({ where: { roundId: null, dryRun: false, ...(coinId ? { coinId } : {}) }, _sum: { holdersLamports: true } }),
    d.prisma.trade.aggregate({ where: { venue: "curve", id: { gt: last?.toTradeId ?? 0n }, ...(coinId ? { coinId } : {}) }, _sum: { platformFee: true } }),
  ]);
  const f = d.params.fees;
  const accruedHolders = splitByWeights(accrued._sum.platformFee ?? 0n, { holders: f.holdersBps, divvy: f.divvyBps }, "divvy").holders;
  return (carried._sum.holdersLamports ?? 0n) + accruedHolders;
}
