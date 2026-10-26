import { describe, expect, it } from "vitest";
import {
  ARCHITECTURES,
  CURVE_FUND_RAISING_SOL,
  CURVE_SUPPLY_TOKENS,
  CURVE_TOTAL_SELL_TOKENS,
  DEFAULT_PARAMS,
  PACKET_DATA_SIZE,
  XSTOCK_ATA_EXTENSION_VALUE_LENS,
  breakEvenVolume,
  coinDay,
  curvePriceSol,
  curveVirtualReserves,
  feeBuckets,
  graduationFdvSol,
  holderSet,
  legacyTxBytes,
  normInv,
  platformCoins,
  platformDay,
  priorityFeeLamports,
  recipientsPerTx,
  rentExemptLamports,
  rentFarmMinHolderUsd,
  roundsPerDay,
  token2022AccountLen,
  unitCosts,
  withParams,
} from "./model";

describe("on-chain constants", () => {
  it("reproduces well-known rent figures", () => {
    // Classic SPL token account: 165 bytes → 0.00203928 SOL.
    expect(rentExemptLamports(165)).toBe(2_039_280);
    // Token-2022 ATA with only ImmutableOwner: 165 + 1 + 4 = 170 bytes → 0.00207408 SOL.
    expect(token2022AccountLen([0])).toBe(170);
    expect(rentExemptLamports(170)).toBe(2_074_080);
  });

  it("sizes an xStock ATA at 179 bytes", () => {
    expect(token2022AccountLen(XSTOCK_ATA_EXTENSION_VALUE_LENS)).toBe(179);
    expect(unitCosts(DEFAULT_PARAMS).rentLamports).toBe(2_136_720);
  });

  it("pads an extended account that would be exactly Multisig::LEN", () => {
    // 166 + 4 + 185 = 355 → padded to 357 (token-2022 extension/mod.rs:128-133).
    expect(token2022AccountLen([185])).toBe(357);
  });

  it("rounds the priority fee up like agave", () => {
    expect(priorityFeeLamports(100_000, 200)).toBe(20); // compute_budget_limits.rs:98
    expect(priorityFeeLamports(1, 1)).toBe(1);
    expect(priorityFeeLamports(1, 0)).toBe(0);
  });

  it("packs payout transfers up to the packet size", () => {
    const plain = recipientsPerTx(false);
    const withAta = recipientsPerTx(true);
    expect(plain).toBe(19);
    expect(withAta).toBe(9);
    const ix = (n: number) => [{ accounts: 0, data: 5 }, { accounts: 0, data: 9 }, ...Array.from({ length: n }, () => ({ accounts: 4, data: 10 }))];
    expect(legacyTxBytes(5 + plain, ix(plain))).toBeLessThanOrEqual(PACKET_DATA_SIZE);
    expect(legacyTxBytes(6 + plain, ix(plain + 1))).toBeGreaterThan(PACKET_DATA_SIZE);
  });
});

describe("curve", () => {
  it("matches the virtual reserves and graduation FDV in docs/verified/launchlab.md §6", () => {
    const { x0, y0 } = curveVirtualReserves();
    expect(x0 * 1e6).toBeCloseTo(1_073_025_605_596_382, -4);
    expect(y0 * 1e9).toBeCloseTo(30_000_852_951, -1);
    expect(graduationFdvSol()).toBeCloseTo(410.8, 1);
    const gradPrice = CURVE_FUND_RAISING_SOL / (CURVE_SUPPLY_TOKENS - CURVE_TOTAL_SELL_TOKENS);
    expect(curvePriceSol(CURVE_TOTAL_SELL_TOKENS) / gradPrice).toBeCloseTo(1, 9);
  });
});

describe("fees", () => {
  it("splits a curve trade 0.25 / 0.50 / 0.15 / 0.10", () => {
    const f = feeBuckets("curve", 1_000_000, DEFAULT_PARAMS);
    expect(f.traderPaidUsd).toBeCloseTo(10_000, 6);
    expect(f.raydiumUsd).toBeCloseTo(2_500, 6);
    expect(f.holdersUsd).toBeCloseTo(5_000, 6);
    expect(f.creatorDirectUsd).toBeCloseTo(1_500, 6);
    expect(f.divvyUsd).toBeCloseTo(1_000, 6);
  });

  it("gives the Fee Key 84% of the 0.25% CPMM fee and splits the pot 50:15:10", () => {
    const p = withParams({ cpmmCreatorFeeToPot: false, memeLegShare: 0 });
    const f = feeBuckets("graduated", 1_000_000, p);
    expect(f.potUsd).toBeCloseTo(2_100, 6);
    expect(f.holdersUsd + f.creatorUsd + f.divvyUsd).toBeCloseTo(f.potUsd, 6);
    expect(f.holdersUsd / f.divvyUsd).toBeCloseTo(5, 9);
    expect(f.creatorDirectUsd).toBeCloseTo(500, 6);
  });

  it("drops the holders' bucket per dollar after graduation", () => {
    const curve = feeBuckets("curve", 1_000, DEFAULT_PARAMS).holdersUsd;
    const grad = feeBuckets("graduated", 1_000, DEFAULT_PARAMS).holdersUsd;
    expect(grad / curve).toBeGreaterThan(0.3);
    expect(grad / curve).toBeLessThan(0.4);
  });
});

describe("rounds and holders", () => {
  it("carries small buckets to the next round", () => {
    expect(roundsPerDay(0, 5)).toBe(0);
    expect(roundsPerDay(5, 5)).toBe(24);
    expect(roundsPerDay(1.25, 5)).toBe(6);
    expect(roundsPerDay(1.3, 5)).toBe(6);
    expect(roundsPerDay(1.2, 5)).toBe(4.8);
  });

  it("only makes holders at or above the minimum eligible", () => {
    const hs = holderSet(500, 50_000, 1.2, 10);
    expect(hs.eligible).toBeGreaterThan(0);
    expect(hs.eligible).toBeLessThanOrEqual(500);
    expect(Math.min(...hs.values)).toBeGreaterThanOrEqual(10);
    expect(hs.eligibleUsd).toBeLessThanOrEqual(50_000 + 1e-6);
    expect(holderSet(500, 50_000, 1.2, 0).eligibleUsd).toBeCloseTo(50_000, 6);
  });
});

describe("architectures", () => {
  it("costs Divvy far more under push than under credit", () => {
    for (const phase of ["curve", "graduated"] as const) {
      const push = coinDay({ phase, volume24hUsd: 50_000 }, "perCoinPush", DEFAULT_PARAMS);
      const credit = coinDay({ phase, volume24hUsd: 50_000 }, "perCoinCredit", DEFAULT_PARAMS);
      expect(push.networkCostUsd).toBeGreaterThan(10 * credit.networkCostUsd);
      expect(push.rentUsd).toBeGreaterThan(0);
      expect(credit.rentUsd).toBe(0);
      expect(push.divvyNetUsd).toBeCloseTo(push.fees.divvyUsd - push.networkCostUsd, 9);
    }
  });

  it("pays no rent when every recipient already has the ATA", () => {
    const d = coinDay({ phase: "curve", volume24hUsd: 20_000 }, "perCoinPush", withParams({ pushAtaPreexistingShare: 1 }));
    expect(d.rentUsd).toBe(0);
  });

  it("delivers more to holders as volume grows, in every architecture", () => {
    for (const arch of ARCHITECTURES) {
      for (const phase of ["curve", "graduated"] as const) {
        let last = -1;
        for (const v of [1_000, 5_000, 20_000, 50_000, 200_000, 1_000_000]) {
          const d = coinDay({ phase, volume24hUsd: v }, arch, DEFAULT_PARAMS);
          expect(d.holdersDeliveredUsd).toBeGreaterThan(last);
          expect(d.holdersDeliveredUsd).toBeLessThanOrEqual(d.fees.holdersUsd);
          last = d.holdersDeliveredUsd;
        }
      }
    }
  });

  it("breaks even at a lower volume with credit than with push", () => {
    for (const phase of ["curve", "graduated"] as const) {
      const push = breakEvenVolume(phase, "batchedPush", DEFAULT_PARAMS) ?? Infinity;
      const credit = breakEvenVolume(phase, "batchedCredit", DEFAULT_PARAMS) ?? Infinity;
      expect(credit).toBeLessThan(push);
    }
  });

  it("makes rent farming unprofitable only above rent / round-trip fees", () => {
    const p = withParams({ solUsd: 150 });
    expect(rentFarmMinHolderUsd("curve", p)).toBeCloseTo((2_136_720 / 1e9) * 150 / 0.02, 9);
  });
});

describe("platform", () => {
  it("builds a deterministic long tail", () => {
    const a = platformCoins(1_000, DEFAULT_PARAMS);
    const b = platformCoins(1_000, DEFAULT_PARAMS);
    expect(a).toEqual(b);
    expect(a).toHaveLength(1_000);
    expect(a.filter((c) => c.phase === "graduated")).toHaveLength(50);
    const sorted = a.map((c) => c.volume24hUsd);
    expect(sorted[499]! / DEFAULT_PARAMS.volumeMedianUsd).toBeCloseTo(1, 1);
    expect(normInv(0.5)).toBeCloseTo(0, 9);
    expect(normInv(0.975)).toBeCloseTo(1.959964, 5);
  });

  it("batches swaps without changing what holders are owed", () => {
    const coins = platformCoins(100, DEFAULT_PARAMS);
    const per = platformDay(coins, "perCoinCredit", DEFAULT_PARAMS);
    const bat = platformDay(coins, "batchedCredit", DEFAULT_PARAMS);
    expect(bat.holdersBucketUsd).toBeCloseTo(per.holdersBucketUsd, 6);
    expect(bat.swapsPerHour).toBeLessThan(per.swapsPerHour);
    expect(bat.networkCostUsd).toBeLessThan(per.networkCostUsd);
  });
});
