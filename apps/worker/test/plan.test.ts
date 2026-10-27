import { describe, expect, it } from "vitest";
import {
  attributeClaim,
  budgetRounds,
  classifyHolders,
  deliveryAction,
  deliveryCharge,
  entitlements,
  isLate,
  quoteLooksWrong,
  shouldCarry,
  splitPlatformFee,
  splitSwapOutput,
} from "../src/payouts/plan";

const fees = { tradeFeeBps: 100, protocolBps: 25, holdersBps: 50, creatorBps: 15, divvyBps: 10 };

describe("attributeClaim", () => {
  it("gives each coin exactly its indexed fees when the claim covers them", () => {
    const a = attributeClaim(1_000n, new Map([["a", 600n], ["b", 300n]]));
    expect([...a.perCoin]).toEqual([["a", 600n], ["b", 300n]]);
    expect(a.unattributed).toBe(100n);
    expect(a.shortfall).toBe(false);
  });
  it("scales down pro rata when the claim is short, never paying more than received", () => {
    const a = attributeClaim(500n, new Map([["a", 600n], ["b", 400n]]));
    expect(a.perCoin.get("a")).toBe(300n);
    expect(a.perCoin.get("b")).toBe(200n);
    expect(a.shortfall).toBe(true);
    expect([...a.perCoin.values()].reduce((x, y) => x + y, 0n) + a.unattributed).toBe(500n);
  });
  it("keeps everything unattributed when no trade was indexed", () => {
    const a = attributeClaim(42n, new Map());
    expect(a.perCoin.size).toBe(0);
    expect(a.unattributed).toBe(42n);
  });
});

describe("splitPlatformFee", () => {
  it("splits 0.60% as 0.50% holders and 0.10% Divvy", () => {
    // A 1 SOL buy pays 6,000,000 lamports of platform fee (docs/VERIFIED.md).
    expect(splitPlatformFee(6_000_000n, fees)).toEqual({ holders: 5_000_000n, divvy: 1_000_000n });
  });
  it("sends the rounding remainder to Divvy, never to holders", () => {
    expect(splitPlatformFee(7n, fees)).toEqual({ holders: 5n, divvy: 2n });
  });
});

describe("thresholds and SLA", () => {
  it("carries a bucket under MIN_ROUND_USD", () => {
    expect(shouldCarry(30_000_000n, 150, 5)).toBe(true); // $4.50
    expect(shouldCarry(40_000_000n, 150, 5)).toBe(false); // $6.00
  });
  it("is late after 60 minutes plus the grace period", () => {
    const hour = new Date("2026-10-26T10:00:00Z");
    expect(isLate(hour, new Date("2026-10-26T11:14:59Z"), 900)).toBe(false);
    expect(isLate(hour, new Date("2026-10-26T11:15:01Z"), 900)).toBe(true);
  });
});

describe("swaps", () => {
  it("shares one swap between rounds pro rata, dust to the largest", () => {
    const s = splitSwapOutput(1_000n, new Map([["r1", 1n], ["r2", 2n]]));
    expect(s.get("r1")).toBe(333n);
    expect(s.get("r2")).toBe(667n);
  });
  it("budgets rounds: everything when it fits, the same fraction for every coin when it doesn't", () => {
    const pending = new Map([["a", 100n], ["b", 50n], ["c", 3n]]);
    expect(budgetRounds(pending, 200n)).toEqual(pending);
    // 75 of 153: each coin gets 75/153 of its share, floored, never more than the budget in total.
    expect([...budgetRounds(pending, 75n)]).toEqual([["a", 49n], ["b", 24n], ["c", 1n]]);
    expect([...budgetRounds(pending, 0n)]).toEqual([["a", 0n], ["b", 0n], ["c", 0n]]);
  });
  it("flags quotes far below the reference price", () => {
    const base = { lamportsIn: 1_000_000_000n, assetDecimals: 8, solUsd: 150, assetUsd: 150, maxImpactBps: 300 };
    expect(quoteLooksWrong({ ...base, outAmount: 99_000_000n })).toBe(false); // 0.99 vs 1.00 expected
    expect(quoteLooksWrong({ ...base, outAmount: 90_000_000n })).toBe(true); // 10% short
    expect(quoteLooksWrong({ ...base, assetUsd: 0, outAmount: 99_000_000n })).toBe(true);
  });
});

describe("holders", () => {
  const excluded = new Map([["CURVE", "curve" as const], ["VAULT", "divvy" as const]]);
  // price 0.000001 SOL/token, SOL $150 → $0.00015 per token; $10 = 66,667 tokens.
  const p = { priceSol: 0.000001, solUsd: 150, coinDecimals: 6, minHolderUsd: 10 };
  const rows = classifyHolders(
    [
      { owner: "CURVE", amount: 700_000_000_000_000n },
      { owner: "VAULT", amount: 5_000_000_000n },
      { owner: "alice", amount: 300_000_000_000n },
      { owner: "bob", amount: 100_000_000_000n },
      { owner: "dust", amount: 60_000_000_000n },
    ],
    excluded,
    p,
  );
  it("excludes pool and Divvy wallets and holders under MIN_HOLDER_USD", () => {
    expect(rows.map((r) => [r.wallet, r.excludedReason])).toEqual([
      ["CURVE", "curve"],
      ["VAULT", "divvy"],
      ["alice", null],
      ["bob", null],
      ["dust", "small"],
    ]);
  });
  it("pays eligible holders pro rata and carries the dust", () => {
    const e = entitlements(1_000_001n, rows);
    expect(e.items).toEqual([
      { wallet: "alice", amount: 750_000n },
      { wallet: "bob", amount: 250_000n },
    ]);
    expect(e.dust).toBe(1n);
  });
});

describe("deliveryAction", () => {
  const base = { autoPushMinUsd: 1, pushNewAtaMinUsd: 5 };
  it("auto-sends to existing accounts above AUTO_PUSH_MIN_USD in both models", () => {
    expect(deliveryAction({ ...base, delivery: "claim", hasAta: true, creditUsd: 1.5 })).toBe("send");
    expect(deliveryAction({ ...base, delivery: "push", hasAta: true, creditUsd: 0.5 })).toBe("hold");
  });
  it("creates accounts only under push and only once the credit outweighs the rent", () => {
    expect(deliveryAction({ ...base, delivery: "push", hasAta: false, creditUsd: 4 })).toBe("hold");
    expect(deliveryAction({ ...base, delivery: "push", hasAta: false, creditUsd: 6 })).toBe("send_create_ata");
    expect(deliveryAction({ ...base, delivery: "claim", hasAta: false, creditUsd: 600 })).toBe("hold");
  });
});

describe("deliveryCharge (holders pay their own delivery)", () => {
  // NVDAx at $180 with 8 decimals, SOL at $150.
  const base = { feeUsd: 0.02, rentLamports: 2_074_080n, solUsd: 150, assetUsd: 180, decimals: 8 };

  it("keeps the delivery fee, rounded up to whole base units", () => {
    // $0.02 / $180 = 0.000111… NVDAx = 11,111.1 units → 11,112.
    expect(deliveryCharge({ ...base, credit: 1_000_000n, createAta: false })).toEqual({ fee: 11_112n, net: 988_888n });
  });

  it("also keeps the new account's rent when the send creates it", () => {
    // Rent 0.00207408 SOL × $150 = $0.311112 → 172,840 units; plus 11,112 for the fee.
    expect(deliveryCharge({ ...base, credit: 5_000_000n, createAta: true })).toEqual({ fee: 183_952n, net: 4_816_048n });
  });

  it("holds the send when the credit doesn't cover its own costs, or a price is missing", () => {
    expect(deliveryCharge({ ...base, credit: 11_112n, createAta: false })).toBeNull();
    expect(deliveryCharge({ ...base, credit: 100_000n, createAta: true })).toBeNull();
    expect(deliveryCharge({ ...base, assetUsd: 0, credit: 5_000_000n, createAta: false })).toBeNull();
  });

  it("charges nothing but the rent when the fee is off", () => {
    expect(deliveryCharge({ ...base, feeUsd: 0, credit: 1_000_000n, createAta: false })).toEqual({ fee: 0n, net: 1_000_000n });
  });
});
