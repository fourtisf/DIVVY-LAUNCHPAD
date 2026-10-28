import { describe, expect, it } from "vitest";
import { maxDevBuy, parseDevBuy, shareLabel, solText } from "./devbuy";

describe("parseDevBuy", () => {
  it("reads SOL into lamports, empty or zero as none", () => {
    expect(parseDevBuy("")).toBe(0n);
    expect(parseDevBuy("0")).toBe(0n);
    expect(parseDevBuy("1")).toBe(1_000_000_000n);
    expect(parseDevBuy("0.5")).toBe(500_000_000n);
    expect(parseDevBuy(" 2,25 ")).toBe(2_250_000_000n);
    expect(parseDevBuy("80")).toBe(80_000_000_000n);
  });

  it("refuses what the server would: dust, more than 80 SOL, or not a number", () => {
    expect(parseDevBuy("0.001")).toBeNull();
    expect(parseDevBuy("80.000000001")).toBeNull();
    expect(parseDevBuy("1e3")).toBeNull();
    expect(parseDevBuy("-1")).toBeNull();
    expect(parseDevBuy("0.0000000001")).toBeNull();
  });
});

describe("shareLabel", () => {
  it("prints a share of supply", () => {
    expect(shareLabel(0.0342)).toBe("3.4%");
    expect(shareLabel(0.0004)).toBe("<0.1%");
  });
});

describe("maxDevBuy", () => {
  it("leaves the fee, the create, the token accounts and a margin, and the server agrees", () => {
    // 2 SOL, a 0.02 SOL fee and a 0.009 SOL create: 2 - 0.02 - 0.009 - 0.0042 - 0.01 = 1.9568, down to 1.956.
    const max = maxDevBuy(2_000_000_000n, 20_000_000n, 9_000_000n)!;
    expect(max).toBe(1_956_000_000n);
    expect(parseDevBuy(solText(max))).toBe(max);
    // The API wants 0.012 for the create, the fee, the buy and 0.0042 for its accounts: all covered.
    expect(12_000_000n + 20_000_000n + max + 4_200_000n).toBeLessThanOrEqual(2_000_000_000n);
  });

  it("caps at 80 SOL and gives nothing under the 0.01 SOL minimum", () => {
    expect(maxDevBuy(500_000_000_000n, 0n, 9_000_000n)).toBe(80_000_000_000n);
    expect(maxDevBuy(40_000_000n, 20_000_000n, 9_000_000n)).toBeNull();
  });
});

describe("solText", () => {
  it("prints lamports as typed SOL", () => {
    expect(solText(1_956_000_000n)).toBe("1.956");
    expect(solText(80_000_000_000n)).toBe("80");
    expect(solText(100_000_000n)).toBe("0.1");
  });
});
