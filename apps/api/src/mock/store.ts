/**
 * In-memory state for mock mode: the seeded coins plus anything created while the process runs
 * (uploads, launches, sessions). Lost on restart by design.
 */
import { randomBytes } from "node:crypto";
import {
  foldTicker,
  hashStr,
  mulberry32,
  type Amount,
  type CoinDetail,
  type CoinSummary,
  type LiveEvent,
  type PayoutRound,
  type Receipt,
} from "@divvy/shared";
import { addr, ASSET, holders, HOUR, minutesOld, RESERVED, rounds, seedCoins, SOL_USD, spark, topOfHour, type MockCoin, type MockRound } from "./data";

export interface Upload {
  id: string;
  buf: Buffer;
  contentType: string;
  sha256: string;
  phash: string;
  /** Wallet/session that uploaded it, if known. */
  owner: string | null;
}

export interface MockLaunch {
  id: string;
  startedAt: number;
  ticker: string;
  coin: MockCoin;
  indexed: boolean;
  /**
   * A launch by a signed-in wallet waits for it to sign the coin's create, as live mode does (the e2e
   * test drives this with a test wallet). The steps after signing count from `signedAt`.
   */
  sign?: { creator: string; unsigned: string; signedAt: number | null; refused: boolean };
}

/** When a launch's steps start counting: at once, or once its creator signed; null while it waits. */
export const launchClock = (l: MockLaunch): number | null => (l.sign ? l.sign.signedAt : l.startedAt);

export const DEMO_WALLET = "7Hq3Lx9Fa2Mv8RtYbW1Pd5QzJnK4cE6uSgDhA3x9Fa";
/** Step timing for the launch modal (the prototype advances one step per second). */
export const LAUNCH_STEP_MS = 1000;

export class MockStore {
  readonly bootAt = Date.now();
  readonly coins: MockCoin[] = seedCoins(this.bootAt);
  readonly uploads = new Map<string, Upload>();
  /** pHash of every coin picture, keyed by ticker (seeded coins are hashed at boot). */
  readonly phashes = new Map<string, string>();
  readonly sha256s = new Map<string, string>();
  readonly launches = new Map<string, MockLaunch>();
  readonly nonces = new Map<string, { address: string; message: string; expiresAt: number }>();
  readonly sessions = new Map<string, { wallet: string; expiresAt: number }>();
  readonly listeners = new Set<(e: LiveEvent) => void>();

  /** Live coins plus launches still in flight, so a second launch can't take the same identity. */
  allCoins(): MockCoin[] {
    return [...this.coins, ...[...this.launches.values()].filter((l) => !l.indexed).map((l) => l.coin)];
  }

  /** Coins can share a ticker: the first one launched with it (the list is newest first). */
  coinByTicker(t: string): MockCoin | undefined {
    const norm = foldTicker(t);
    return [...this.coins].reverse().find((c) => foldTicker(c.ticker) === norm);
  }

  coinByMint(m: string): MockCoin | undefined {
    return this.coins.find((c) => c.mint === m);
  }

  identity = (c: MockCoin) => ({ ticker: c.ticker, name: c.name, mint: c.mint });

  // Coins may share a ticker, a name or an X account (owner decision 2026-10-27): only reserved
  // tickers and the format rules refuse.
  tickerCtx = { findByTickerNorm: () => undefined, isReserved: (norm: string) => RESERVED_SET.has(norm) };
  nameCtx = { candidates: () => [] };
  xCtx = { findByX: () => undefined };

  emit(e: LiveEvent): void {
    for (const l of this.listeners) l(e);
  }

  /** Advances mock launches; a launch is added to the board when it reaches "indexed". */
  tick(now = Date.now()): void {
    for (const l of this.launches.values()) {
      const clock = launchClock(l);
      if (!l.indexed && clock !== null && now - clock >= 3 * LAUNCH_STEP_MS) {
        l.indexed = true;
        l.coin.createdAt = now;
        this.coins.unshift(l.coin);
        this.emit({ type: "launch", at: new Date(now).toISOString(), mint: l.coin.mint, ticker: l.coin.ticker, name: l.coin.name, imageUrl: imageUrl(l.coin) });
      }
    }
  }

  newId(): string {
    return randomBytes(12).toString("base64url");
  }

  newMint(ticker: string): string {
    return addr(mulberry32(hashStr(ticker + Date.now() + Math.random())));
  }
}

const RESERVED_SET = new Set(RESERVED.map((t) => foldTicker(t)));

/* ---------- serialisers (mock data → API shapes) ---------- */

export function amount(ui: number, decimals: number): Amount {
  const raw = BigInt(Math.max(0, Math.round(ui * 10 ** decimals)));
  return { raw: raw.toString(), decimals, ui: Number(raw) / 10 ** decimals };
}

export const imageUrl = (c: MockCoin): string => (c.image.kind === "svg" ? `/api/media/coin/${encodeURIComponent(c.ticker)}.svg` : `/api/media/upload/${c.image.id}`);

const shortWallet = (w: string) => w.slice(0, 4) + "…" + w.slice(-4);

export function toSummary(c: MockCoin, now: number): CoinSummary {
  const a = ASSET[c.pays]!;
  const paid24hUsd = c.vol * 0.005;
  return {
    mint: c.mint,
    ticker: c.ticker,
    name: c.name,
    imageUrl: imageUrl(c),
    dividendAsset: c.pays,
    status: c.graduated ? "graduated" : "live",
    createdAt: new Date(c.createdAt).toISOString(),
    creator: { wallet: c.creatorWallet, xHandle: c.xHandle, label: c.xHandle ?? shortWallet(c.creatorWallet) },
    marketCapUsd: c.mcap,
    change24hPct: c.ch,
    volume24hUsd: c.vol,
    holders: c.holders,
    paidUsd: c.paidUsd,
    paid24hUsd,
    paid24h: amount(paid24hUsd / a.priceUsd, a.decimals),
    progress: c.progress,
    spark: spark(c, now),
    devBuyPct: c.devBuy,
  };
}

export function toDetail(c: MockCoin, now: number): CoinDetail {
  const a = ASSET[c.pays]!;
  const priceUsd = c.mcap / 1e9;
  return {
    ...toSummary(c, now),
    description: c.desc,
    athUsd: c.ath,
    priceUsd,
    priceSol: priceUsd / SOL_USD,
    supply: amount(1e9, 6),
    paid: amount(c.paidUsd / a.priceUsd, a.decimals),
    links: c.links,
    cpmmPool: c.graduated ? addr(mulberry32(hashStr(c.ticker + "cpmm"))) : null,
    createdSig: addr(mulberry32(hashStr(c.ticker + "createsig")), 88),
  };
}

export function toRound(r: MockRound): PayoutRound {
  const a = ASSET[r.coin.pays]!;
  return {
    id: `${r.coin.ticker}-${r.hour}`,
    hour: new Date(r.hour).toISOString(),
    status: "ok",
    assetSymbol: r.coin.pays,
    amount: amount(r.amount, a.decimals),
    usd: r.usd,
    wallets: r.wallets,
    sig: r.sig,
  };
}

export const toReceipt = (r: MockRound): Receipt => ({ ...toRound(r), coin: { mint: r.coin.mint, ticker: r.coin.ticker, imageUrl: imageUrl(r.coin) } });

/** Every coin's recent rounds, newest first (prototype `allPayouts`, 6 per coin). */
export function allRounds(store: MockStore, now: number): MockRound[] {
  return store.coins.flatMap((c) => rounds(c, now, 6)).sort((a, b) => b.hour - a.hour || b.usd - a.usd);
}

/** Holders' share of fees waiting for the next round, per coin. */
export const pendingUsd = (c: MockCoin, now: number): number => (c.vol / 24) * 0.005 * ((now - topOfHour(now)) / HOUR);

export const paidLast24hUsd = (c: MockCoin, now: number): number => (c.vol / 24) * 0.005 * Math.min(24, Math.floor(minutesOld(c, now) / 60));

export { holders };
