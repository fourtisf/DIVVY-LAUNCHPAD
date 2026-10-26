/**
 * Deterministic demo dataset, moved here from the prototype's seeded generators so the web app has
 * no hard-coded data left. Same seeds and formulas as `prototype/divvy-prototype.html`, so the board
 * shows the same coins and numbers. Everything is relative to the moment the API boots.
 *
 * None of these coins, mints, wallets or signatures exist on chain.
 */
import { avatarSvg, hashStr, mulberry32 } from "@divvy/shared";

export const SOL_USD = 100.7;
export const STOCK_DECIMALS = 8;

export interface MockAsset {
  symbol: string;
  mono: string;
  name: string;
  priceUsd: number;
  change24hPct: number;
  chipBg: string;
  chipFg: string;
  kind: "stock" | "crypto";
  decimals: number;
  featured: boolean;
}

const asset = (
  symbol: string, mono: string, name: string, priceUsd: number, change24hPct: number, chipBg: string, chipFg: string,
  kind: "stock" | "crypto" = "stock", decimals = STOCK_DECIMALS,
): MockAsset => ({ symbol, mono, name, priceUsd, change24hPct, chipBg, chipFg, kind, decimals, featured: false });

export const ASSETS: MockAsset[] = [
  asset("NVDAx", "NV", "Nvidia", 182.4, 1.8, "#76B900", "#0D2200"),
  asset("SPYx", "SPY", "S&P 500", 668.9, 0.4, "#6D88FF", "#0B1440"),
  asset("TSLAx", "TS", "Tesla", 431.2, -2.3, "#EF5A65", "#3A0A10"),
  asset("AAPLx", "AP", "Apple", 252.7, 0.9, "#E1E5EA", "#1B1F27"),
  asset("QQQx", "QQQ", "Nasdaq 100", 603.5, 0.7, "#3CCBEB", "#06303A"),
  asset("GOOGLx", "GO", "Alphabet", 248.1, 1.2, "#FBC52C", "#3A2A00"),
  asset("AMZNx", "AM", "Amazon", 221.6, -0.6, "#FFA552", "#3A1E00"),
  asset("MSTRx", "MS", "Strategy", 298.3, 3.1, "#F7931A", "#331A00"),
  asset("COINx", "CB", "Coinbase", 327.9, 2.2, "#3F70F7", "#EEF3FF"),
  asset("HOODx", "HO", "Robinhood", 131.8, 4.0, "#C8F552", "#223300"),
  asset("CRCLx", "CR", "Circle", 139.2, -1.4, "#8DB2FF", "#0E1D45"),
  asset("SOL", "SOL", "Solana", SOL_USD, -1.1, "#B08CFF", "#1E0C44", "crypto", 9),
  asset("USDC", "$", "USD Coin", 1, 0, "#3A86DE", "#EAF3FF", "crypto", 6),
];
// The six stocks that orbit the hero coin in the prototype.
for (const s of ["NVDAx", "SPYx", "TSLAx", "AAPLx", "QQQx", "MSTRx"]) ASSETS.find((a) => a.symbol === s)!.featured = true;
export const ASSET = Object.fromEntries(ASSETS.map((a) => [a.symbol, a])) as Record<string, MockAsset>;

const SEED: [string, string, string, string][] = [
  ["Chip Dog", "CHIPDOG", "NVDAx", "Good boy. Fetches GPUs."], ["Desk Cat", "DESKCAT", "SPYx", "Sits on the keyboard during market open."],
  ["Frog Lord", "FROG", "TSLAx", "Rules the pond. Pays in Teslas."], ["Moon Intern", "INTERN", "QQQx", "Unpaid intern. Paid holders."],
  ["Bagholder Bear", "BAGBEAR", "AAPLx", "Holds the bag so you don't have to."], ["Dividend Duck", "DUCK", "SPYx", "Quack quack, hourly."],
  ["Gamma Goose", "GAMMA", "NVDAx", "Honks at every green candle."], ["Sleepy Shiba", "SLEEPY", "GOOGLx", "Wakes up for payouts only."],
  ["Paper Hands", "PAPER", "COINx", "Sold too early, again."], ["Stonk Snail", "SNAIL", "AMZNx", "Slow and steady. Mostly slow."],
  ["Wen Lambo", "WENLAMBO", "TSLAx", "Soon."], ["Ticker Tape", "TAPE", "SPYx", "A parade every hour."],
  ["Green Candle", "CANDLE", "NVDAx", "Only knows one direction."], ["Laser Llama", "LLAMA", "MSTRx", "Laser eyes, llama heart."],
  ["Robin Hoodie", "HOODIE", "HOODx", "Takes from the bears, gives to holders."], ["Circle Crab", "CRAB", "CRCLx", "Moves sideways. Pays forward."],
  ["Couch Analyst", "COUCH", "QQQx", "Ten charts open, zero trades."], ["Margin Mouse", "MOUSE", "COINx", "Small size, big leverage."],
  ["Quarterly Koala", "KOALA", "AAPLx", "Sleeps 22 hours, earns 24."], ["Bear Market Bun", "BUN", "SOL", "Soft, warm, a little burnt."],
  ["Index Iguana", "IGGY", "SPYx", "Buys the whole market and naps."], ["Rug Proof", "RUGPROOF", "USDC", "Boring on purpose."],
  ["Earnings Eel", "EEL", "NVDAx", "Shocking beats."], ["Bid Wall Bob", "BOB", "TSLAx", "Stands at the bottom of every chart."],
  ["Chart Chimp", "CHIMP", "GOOGLx", "Draws lines. Some of them work."], ["Cash Cow", "COW", "SPYx", "Moo means money."],
  ["Yield Yak", "YAK", "AMZNx", "Never stops talking about APY."], ["Fed Pigeon", "PIGEON", "QQQx", "Delivers rate decisions by hand."],
  ["Grid Bot Gary", "GARY", "MSTRx", "Buys low, sells slightly less low."], ["Short Squeeze", "SQUEEZE", "HOODx", "Shorts hate this one trick."],
];
const HANDLES = ["degenkara", "mochitrades", "solsamurai", "pixelpip", "bagboy", "chartwitch", "lowcapluna", "rizzfi", "nightdesk", "onchainoma", "sendooor", "quietape", "ricecake", "nodeghost", "juno_eth", "ripvol", "tealbear", "gmkenji"];

/** Seed list for the "already trading with real volume" check (ReservedTicker in production). */
export const RESERVED = ["PEPE", "BONK", "WIF", "POPCAT", "TRUMP", "PENGU", "FARTCOIN", "MEW", "GIGA", "MOODENG", "PNUT", "SPX", "USDC", "SOL"];

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
export function addr(r: () => number, n = 44): string {
  let s = "";
  for (let i = 0; i < n; i++) s += B58[Math.floor(r() * 58)];
  return s;
}

export interface MockCoin {
  name: string;
  ticker: string;
  pays: string;
  desc: string;
  mint: string;
  /** SVG for the coin picture, or an uploaded image id. */
  image: { kind: "svg"; seed: string } | { kind: "upload"; id: string };
  mcap: number;
  ath: number;
  progress: number;
  graduated: boolean;
  createdAt: number;
  vol: number;
  holders: number;
  paidUsd: number;
  ch: number;
  creatorWallet: string;
  xHandle: string | null;
  links: { x: string | null; telegram: string | null; website: string | null };
}

export const minutesOld = (c: MockCoin, now: number): number => (now - c.createdAt) / 60_000;

export function seedCoins(bootAt: number): MockCoin[] {
  return SEED.map(([name, ticker, pays, desc], i) => {
    const r = mulberry32(hashStr(ticker) + 7);
    const tier = r();
    const mcap = tier < 0.12 ? 60000 + r() * 340000 : tier < 0.32 ? 14000 + r() * 34000 : 2900 + r() * 10000;
    const graduated = mcap >= 48000;
    const progress = graduated ? 1 : Math.min(0.99, Math.max(0.01, (mcap - 2900) / (48000 - 2900)));
    const createdMin = graduated ? 300 + r() * 2400 : 3 + r() * 1500;
    const vol = mcap * (graduated ? 2 + r() * 9 : 0.6 + r() * 3.5);
    const holders = Math.round(18 + mcap / (90 + r() * 120));
    const paidUsd = vol * 0.005 * Math.min(1, createdMin / 1440) * (1.2 + r() * 1.4);
    const ch = (r() - 0.42) * 80;
    const ath = mcap * (1 + r() * 1.8);
    const handle = HANDLES[i % HANDLES.length]!;
    return {
      name, ticker, pays, desc,
      mint: addr(mulberry32(hashStr(ticker + "mint"))),
      image: { kind: "svg", seed: ticker },
      mcap, ath, progress, graduated,
      createdAt: bootAt - createdMin * 60_000,
      vol, holders, paidUsd, ch,
      creatorWallet: addr(mulberry32(hashStr(handle + "wallet"))),
      xHandle: handle,
      links: { x: "https://x.com/" + handle, telegram: null, website: null },
    };
  });
}

export const coinSvg = (c: MockCoin): string | null => (c.image.kind === "svg" ? avatarSvg(c.image.seed) : null);

/* ---------- time series ---------- */

/** Prototype `series`: market cap points from launch to now (oldest first). */
export function series(c: MockCoin, now: number, points = 120): number[] {
  if (minutesOld(c, now) < 10) return Array.from({ length: 12 }, (_, i) => 2900 + ((c.mcap - 2900) * i) / 11);
  const r = mulberry32(hashStr(c.ticker + "chart"));
  const out: number[] = [];
  let v = 2900;
  const peakAt = 0.55 + r() * 0.3,
    peak = Math.max(c.ath, c.mcap);
  for (let i = 0; i < points; i++) {
    const t = i / (points - 1);
    const goal = t < peakAt ? 2900 + (peak - 2900) * Math.pow(t / peakAt, 1.6) : peak + (c.mcap - peak) * ((t - peakAt) / (1 - peakAt));
    v = v + (goal - v) * 0.35 + goal * (r() - 0.5) * 0.09;
    out.push(Math.max(1800, v));
  }
  out[points - 1] = c.mcap;
  return out;
}

/** Card sparkline: the prototype's `series(c, 40).slice(-28)`, hidden for coins under 10 minutes old. */
export const spark = (c: MockCoin, now: number): number[] => (minutesOld(c, now) < 10 ? [] : series(c, now, 40).slice(-28));

/** Market cap at an absolute time, interpolated over the launch→now series. */
export function mcapAt(c: MockCoin, now: number, at: number): number {
  const s = series(c, now);
  const span = now - c.createdAt;
  if (span <= 0) return c.mcap;
  const x = Math.min(1, Math.max(0, (at - c.createdAt) / span)) * (s.length - 1);
  const i = Math.floor(x);
  const a = s[i]!,
    b = s[Math.min(s.length - 1, i + 1)]!;
  return a + (b - a) * (x - i);
}

/* ---------- payouts, trades, holders ---------- */

export const HOUR = 3_600_000;
export const topOfHour = (t: number): number => Math.floor(t / HOUR) * HOUR;

export interface MockRound {
  coin: MockCoin;
  hour: number;
  usd: number;
  amount: number;
  wallets: number;
  sig: string;
}

/** Prototype `payoutsFor`: one round per full hour since launch, newest first. */
export function rounds(c: MockCoin, now: number, count: number): MockRound[] {
  const r = mulberry32(hashStr(c.ticker + "payouts"));
  const out: MockRound[] = [];
  const px = ASSET[c.pays]!.priceUsd;
  const n = Math.min(count, Math.floor(minutesOld(c, now) / 60));
  for (let h = 0; h < n; h++) {
    const usd = (c.vol / 24) * 0.005 * (0.5 + r() * 1.1);
    out.push({ coin: c, hour: topOfHour(now) - h * HOUR, usd, amount: usd / px, wallets: Math.max(6, Math.round(c.holders * (0.55 + r() * 0.4))), sig: addr(r, 88) });
  }
  return out;
}

export interface MockTrade {
  at: number;
  side: "buy" | "sell";
  sol: number;
  tokens: number;
  wallet: string;
  sig: string;
}

/** Prototype `trades`. */
export function trades(c: MockCoin, now: number, n = 24): MockTrade[] {
  if (minutesOld(c, now) < 1) return [];
  const r = mulberry32(hashStr(c.ticker + "trades"));
  const sigR = mulberry32(hashStr(c.ticker + "tradesigs"));
  const out: MockTrade[] = [];
  let m = 0;
  const price = c.mcap / 1e9;
  for (let i = 0; i < n; i++) {
    m += r() * 6;
    const s = Math.pow(r(), 2) * 3 + 0.01;
    const side = r() < 0.62 ? "buy" : "sell";
    out.push({ at: now - m * 60_000, side, sol: s, tokens: (s * SOL_USD) / price, wallet: addr(r), sig: addr(sigR, 88) });
  }
  return out;
}

export interface MockHolder {
  wallet: string;
  label: string | null;
  pct: number;
  received: number | null;
  excludedReason: "curve" | "pool" | null;
}

/** Prototype `holders`: the curve or pool first (not paid), then the top wallets. */
export function holders(c: MockCoin, now: number): MockHolder[] {
  const r = mulberry32(hashStr(c.ticker + "holders"));
  const px = ASSET[c.pays]!.priceUsd;
  const sysWallet = addr(mulberry32(hashStr(c.ticker + "vault")));
  const top: MockHolder = c.graduated
    ? { wallet: sysWallet, label: "Raydium pool", pct: 14 + r() * 6, received: null, excludedReason: "pool" }
    : { wallet: sysWallet, label: "Bonding curve", pct: 20.69 + 79.31 * (1 - c.progress), received: null, excludedReason: "curve" };
  if (minutesOld(c, now) < 1) return [top];
  const dist = 100 - top.pct;
  let left = dist;
  const rows: MockHolder[] = [];
  for (let i = 0; i < 9; i++) {
    const p = left * (0.06 + r() * 0.16);
    left -= p;
    rows.push({ wallet: addr(r), label: null, pct: p, received: dist > 0 ? (c.paidUsd * p) / dist / px : 0, excludedReason: null });
  }
  rows.sort((a, b) => b.pct - a.pct);
  return [top, ...rows];
}
