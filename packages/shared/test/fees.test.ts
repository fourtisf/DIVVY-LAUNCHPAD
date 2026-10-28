import { describe, expect, it } from "vitest";
import { applyBps, assertSplit, bpsLabel, DEV_BUY_MAX_LAMPORTS, devBuyEstimate, proRata, splitByWeights, splitClaim } from "../src/fees";

describe("fee split", () => {
  it("accepts the target split and rejects one that doesn't add up", () => {
    expect(() => assertSplit({ tradeFeeBps: 100, protocolBps: 25, holdersBps: 50, creatorBps: 15, divvyBps: 10 })).not.toThrow();
    expect(() => assertSplit({ tradeFeeBps: 100, protocolBps: 25, holdersBps: 50, creatorBps: 15, divvyBps: 11 })).toThrow();
  });

  it("splits a claim by the configured ratios without losing a lamport", () => {
    const s = splitClaim(1_000_000_007n, { holdersBps: 50, creatorBps: 15, divvyBps: 10 });
    expect(s.holders).toBe(666_666_671n);
    expect(s.creator).toBe(200_000_001n);
    expect(s.holders + s.creator + s.divvy).toBe(1_000_000_007n);
  });

  it("accepts the 1.25% split (owner decision 2026-10-27)", () => {
    expect(() => assertSplit({ tradeFeeBps: 125, protocolBps: 25, holdersBps: 50, creatorBps: 15, divvyBps: 35 })).not.toThrow();
  });

  it("floors bps", () => {
    expect(applyBps(999n, 50)).toBe(4n);
    expect(bpsLabel(15)).toBe("0.15%");
  });

  it("puts the remainder where asked", () => {
    expect(splitByWeights(10n, { a: 1, b: 1, c: 1 }, "c")).toEqual({ a: 3n, b: 3n, c: 4n });
  });
});

describe("proRata", () => {
  it("allocates by balance, floors, and returns the dust", () => {
    const r = proRata(100n, [
      { wallet: "B", balance: 1n },
      { wallet: "A", balance: 1n },
      { wallet: "C", balance: 1n },
      { wallet: "Z", balance: 0n },
    ]);
    expect(r.items).toEqual([
      { wallet: "A", amount: 33n },
      { wallet: "B", amount: 33n },
      { wallet: "C", amount: 33n },
    ]);
    expect(r.dust).toBe(1n);
  });

  it("never pays more than the total", () => {
    const holders = Array.from({ length: 500 }, (_, i) => ({ wallet: "w" + i, balance: BigInt(1 + ((i * 7919) % 1000)) }));
    const r = proRata(123_456_789n, holders);
    const paid = r.items.reduce((a, i) => a + i.amount, 0n);
    expect(paid + r.dust).toBe(123_456_789n);
    expect(r.dust).toBeLessThan(500n);
  });

  it("carries everything when nobody is eligible", () => {
    expect(proRata(50n, [])).toEqual({ items: [], dust: 50n });
  });
});

describe("devBuyEstimate", () => {
  it("prices a dev buy on the empty curve after the 1.25% fee", () => {
    expect(devBuyEstimate(0n, 125)).toEqual({ tokens: 0n, pct: 0 });
    // 1 SOL less 1.25% at the start price (about 2.8e-8 SOL a token): about 3.4% of supply.
    const one = devBuyEstimate(1_000_000_000n, 125);
    expect(one.pct).toBeGreaterThan(0.033);
    expect(one.pct).toBeLessThan(0.035);
    // Each SOL buys less than the one before.
    expect(devBuyEstimate(2_000_000_000n, 125).pct).toBeLessThan(2 * one.pct);
    // Even the most a dev buy may spend leaves the curve unfilled (793.1M of 1B are sold on it).
    expect(devBuyEstimate(DEV_BUY_MAX_LAMPORTS, 125).pct).toBeLessThan(0.7931);
  });
});
