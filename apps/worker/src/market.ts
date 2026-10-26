/** Pure market-data helpers for the indexer: trade rows from events, candle buckets, stats. */
import type { ParsedTrade, CpmmSwapEvent } from "@divvy/solana/live";
import { WSOL_MINT } from "@divvy/solana";

export const TF_MS = { "1m": 60_000, "5m": 300_000, "1h": 3_600_000, "1d": 86_400_000 } as const;
export type Tf = keyof typeof TF_MS;
export const bucket = (ts: number, tf: Tf) => Math.floor(ts / TF_MS[tf]) * TF_MS[tf];

export interface TradeRow {
  sig: string;
  ix: number;
  side: "buy" | "sell";
  solAmount: bigint;
  tokenAmount: bigint;
  wallet: string;
  /** SOL per whole token. */
  priceSol: number;
  protocolFee: bigint;
  platformFee: bigint;
  creatorFee: bigint;
  shareFee: bigint;
  venue: "curve" | "cpmm";
}

/** Spot price after the trade, from the curve's virtual and real reserves (constantProductCurve.ts:32-44). */
export function curvePriceAfter(e: ParsedTrade["event"]): number {
  const quote = e.virtualQuote + e.realQuoteAfter;
  const base = e.virtualBase - e.realBaseAfter;
  if (base <= 0n) return 0;
  return Number(quote) / 1e9 / (Number(base) / 1e6);
}

export function curveTradeRow(sig: string, t: ParsedTrade, feePayer: string): TradeRow {
  const e = t.event;
  const buy = e.side === "buy";
  return {
    sig,
    ix: t.ix,
    side: e.side,
    // Buys: SOL the trader paid, fees included. Sells: SOL the trader received.
    solAmount: buy ? e.amountIn : e.amountOut,
    tokenAmount: buy ? e.amountOut : e.amountIn,
    wallet: t.trader?.toBase58() ?? feePayer,
    priceSol: curvePriceAfter(e),
    protocolFee: e.protocolFee,
    platformFee: e.platformFee,
    creatorFee: e.creatorFee,
    shareFee: e.shareFee,
    venue: "curve",
  };
}

/** CPMM swap → trade row. Price is the execution price; fees other than the creator fee stay in the pool. */
export function cpmmTradeRow(sig: string, seq: number, e: CpmmSwapEvent, wallet: string, coinDecimals = 6): TradeRow | null {
  const inSol = e.inputMint.toBase58() === WSOL_MINT;
  const outSol = e.outputMint.toBase58() === WSOL_MINT;
  if (inSol === outSol) return null;
  const sol = inSol ? e.inputAmount : e.outputAmount;
  const tok = inSol ? e.outputAmount : e.inputAmount;
  if (tok === 0n) return null;
  const creatorFeeInSol = (e.creatorFeeOnInput && inSol) || (!e.creatorFeeOnInput && outSol);
  return {
    sig,
    // Offset keeps CPMM events apart from LaunchLab events in the same transaction.
    ix: 10_000 + seq,
    side: inSol ? "buy" : "sell",
    solAmount: sol,
    tokenAmount: tok,
    wallet,
    priceSol: Number(sol) / 1e9 / (Number(tok) / 10 ** coinDecimals),
    protocolFee: 0n,
    platformFee: 0n,
    creatorFee: creatorFeeInSol ? e.creatorFee : 0n,
    shareFee: 0n,
    venue: "cpmm",
  };
}

/** Percentage change, 0 when there's no reference. */
export const changePct = (now: number, then: number | null) => (then && then > 0 ? ((now - then) / then) * 100 : 0);

/**
 * Sparkline: `n` evenly spaced closes ending at `end`, carrying the last known close through empty
 * buckets (and the first known one backwards).
 */
export function sparkline(candles: { ts: number; c: number }[], end: number, stepMs: number, n = 28): number[] {
  if (!candles.length) return [];
  const sorted = [...candles].sort((a, b) => a.ts - b.ts);
  const start = Math.floor(end / stepMs) * stepMs - (n - 1) * stepMs;
  const out: number[] = [];
  let i = 0;
  let last = sorted[0]!.c;
  for (let k = 0; k < n; k++) {
    const t = start + k * stepMs;
    while (i < sorted.length && sorted[i]!.ts <= t) last = sorted[i++]!.c;
    out.push(last);
  }
  return out;
}
