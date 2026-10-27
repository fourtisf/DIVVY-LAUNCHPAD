import { describe, expect, it } from "vitest";
import { expectedOnChainRates, loadParams } from "../src/params";

describe("loadParams fees", () => {
  it("defaults to 1.25%: 0.25% Raydium, 0.50% holders, 0.15% creator, 0.35% uspad (owner decision 2026-10-27)", () => {
    const p = loadParams({});
    expect(p.fees).toEqual({ tradeFeeBps: 125, protocolBps: 25, holdersBps: 50, creatorBps: 15, divvyBps: 35 });
    expect(expectedOnChainRates(p.fees)).toEqual({ tradeFeeRate: 2500, platformFeeRate: 8500, creatorFeeRate: 1500 });
    expect(p.feeSplitBefore).toBeNull();
    // Graduated coins keep the old proportions.
    expect(p.poolSplit).toEqual({ holdersBps: 50, creatorBps: 15, divvyBps: 10 });
  });

  it("reads the split of trades before a fee change", () => {
    expect(loadParams({ FEE_SPLIT_BEFORE: "419000123:50:10" }).feeSplitBefore).toEqual({ slot: 419_000_123n, holdersBps: 50, divvyBps: 10 });
    expect(() => loadParams({ FEE_SPLIT_BEFORE: "419000123" })).toThrow(/FEE_SPLIT_BEFORE/);
  });

  it("still loads the old 1% split from an env file that sets it", () => {
    expect(expectedOnChainRates(loadParams({ FEE_TRADE_BPS: "100", FEE_DIVVY_BPS: "10" }).fees).platformFeeRate).toBe(6000);
    expect(() => loadParams({ FEE_DIVVY_BPS: "10" })).toThrow(/add up/);
  });

  it("refuses an empty pool split", () => {
    expect(loadParams({ POOL_FEE_SPLIT: "60:15:25" }).poolSplit).toEqual({ holdersBps: 60, creatorBps: 15, divvyBps: 25 });
    expect(() => loadParams({ POOL_FEE_SPLIT: "0:0:0" })).toThrow(/all zero/);
  });
});
