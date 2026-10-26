import { describe, expect, it } from "vitest";
import { PublicKey } from "@solana/web3.js";
import { WSOL_MINT } from "@divvy/solana";
import type { CpmmSwapEvent, ParsedTrade } from "@divvy/solana/live";
import { bucket, changePct, cpmmTradeRow, curvePriceAfter, curveTradeRow, sparkline } from "../src/market";

const pool = new PublicKey("11111111111111111111111111111112");
const trader = new PublicKey("11111111111111111111111111111113");
const coin = new PublicKey("11111111111111111111111111111114");

const event = (over: Partial<ParsedTrade["event"]> = {}): ParsedTrade["event"] => ({
  poolState: pool,
  totalBaseSell: 793_100_000_000_000n,
  virtualBase: 1_073_025_605_596_382n,
  virtualQuote: 30_000_852_951n,
  realBaseBefore: 0n,
  realQuoteBefore: 0n,
  realBaseAfter: 32_000_000_000_000n,
  realQuoteAfter: 990_000_000n,
  amountIn: 1_000_000_000n,
  amountOut: 32_000_000_000_000n,
  protocolFee: 2_500_000n,
  platformFee: 6_000_000n,
  creatorFee: 1_500_000n,
  shareFee: 0n,
  side: "buy",
  poolStatus: 0,
  exactIn: true,
  ...over,
});

describe("trade rows", () => {
  it("maps a curve buy: SOL paid incl. fees, tokens out, spot price after", () => {
    const r = curveTradeRow("sig", { ix: 3, event: event(), trader }, "payer");
    expect(r).toMatchObject({ sig: "sig", ix: 3, side: "buy", solAmount: 1_000_000_000n, tokenAmount: 32_000_000_000_000n, wallet: trader.toBase58(), platformFee: 6_000_000n, venue: "curve" });
    const expected = (30_000_852_951 + 990_000_000) / 1e9 / ((1_073_025_605_596_382 - 32_000_000_000_000) / 1e6);
    expect(r.priceSol).toBeCloseTo(expected, 15);
    expect(curvePriceAfter(event())).toBeCloseTo(expected, 15);
  });
  it("falls back to the fee payer when the trader isn't known", () => {
    expect(curveTradeRow("sig", { ix: 0, event: event({ side: "sell", amountIn: 5n, amountOut: 7n }), trader: null }, "payer")).toMatchObject({ wallet: "payer", solAmount: 7n, tokenAmount: 5n, side: "sell" });
  });
  it("maps a CPMM sell at its execution price", () => {
    const e: CpmmSwapEvent = {
      poolId: pool, inputVaultBefore: 0n, outputVaultBefore: 0n, inputAmount: 2_000_000n, outputAmount: 500_000_000n,
      inputTransferFee: 0n, outputTransferFee: 0n, baseInput: true, inputMint: coin, outputMint: new PublicKey(WSOL_MINT),
      tradeFee: 5_000n, creatorFee: 250_000n, creatorFeeOnInput: false,
    };
    const r = cpmmTradeRow("sig", 1, e, "w")!;
    expect(r).toMatchObject({ ix: 10_001, side: "sell", solAmount: 500_000_000n, tokenAmount: 2_000_000n, creatorFee: 250_000n, venue: "cpmm" });
    expect(r.priceSol).toBeCloseTo(0.5 / 2, 12);
  });
});

describe("candles and stats", () => {
  it("buckets to the timeframe start", () => {
    expect(new Date(bucket(Date.parse("2026-10-26T10:07:31Z"), "5m")).toISOString()).toBe("2026-10-26T10:05:00.000Z");
  });
  it("computes 24h change only with a reference", () => {
    expect(changePct(2, 1)).toBe(100);
    expect(changePct(2, null)).toBe(0);
  });
  it("fills sparkline gaps with the last close", () => {
    const step = 300_000;
    const end = 10 * step;
    expect(sparkline([{ ts: 7 * step, c: 1 }, { ts: 9 * step, c: 3 }], end, step, 4)).toEqual([1, 1, 3, 3]);
  });
});
