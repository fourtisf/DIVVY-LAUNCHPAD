import { describe, expect, it } from "vitest";
import { curveProgress, graduationFdvLamports, LAUNCHLAB_DEFAULT_CURVE } from "../src";

describe("curve helpers", () => {
  it("progress is sold / total for sale", () => {
    expect(curveProgress(0n, LAUNCHLAB_DEFAULT_CURVE.totalSellA)).toBe(0);
    expect(curveProgress(396_550_000_000_000n, LAUNCHLAB_DEFAULT_CURVE.totalSellA)).toBe(0.5);
    expect(curveProgress(LAUNCHLAB_DEFAULT_CURVE.totalSellA + 1n, LAUNCHLAB_DEFAULT_CURVE.totalSellA)).toBe(1);
  });

  it("graduation FDV with SDK defaults is about 410.8 SOL", () => {
    const fdv = graduationFdvLamports(LAUNCHLAB_DEFAULT_CURVE);
    expect(Number(fdv) / 1e9).toBeCloseTo(410.826, 2);
  });
});
