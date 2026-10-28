import { describe, expect, it } from "vitest";
import { parseDevBuy, shareLabel } from "./devbuy";

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
