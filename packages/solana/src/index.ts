/**
 * Solana integration helpers: LaunchLab, Jito, Jupiter, Helius.
 *
 * Every address here is logged with its source in docs/VERIFIED.md. Prefer the Raydium SDK's own
 * constants where the SDK is loaded; these exist for code paths (API, worker) that shouldn't import
 * the whole SDK. Phase 0 scripts live in ./scripts/phase0.
 */

export const PROGRAM_IDS = {
  /** raydium-sdk-V2@b69d02b src/common/programId.ts:37 (LAUNCHPAD_PROGRAM); raydium-idl raydium_launchpad.json:2 */
  launchLab: "LanMV9sAd7wArD4vJFi2qDdfnVhFxYSUg6eADduJ3uj",
  /** raydium-sdk-V2@b69d02b src/common/programId.ts:29; raydium-cp-swap@f4b9b26 programs/cp-swap/src/lib.rs:25 */
  cpmm: "CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C",
  /** raydium-sdk-V2@b69d02b src/common/programId.ts:33 (LOCK_CPMM_PROGRAM, "Burn & Earn") */
  lpLock: "LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE",
  /** solana-program/token-2022@3f85f9c interface/src/lib.rs:29 */
  token2022: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
} as const;

/** Wrapped SOL, the quote mint (@solana/spl-token NATIVE_MINT). */
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

/** LaunchLab rates are in millionths (raydium-sdk-V2 src/common/fee.ts:2). */
export const LAUNCHLAB_RATE_DENOMINATOR = 1_000_000;

/**
 * Raydium SDK defaults for a LaunchLab constant-product curve
 * (raydium-sdk-V2@b69d02b src/raydium/launchpad/launchpad.ts:100-109). Base units, 6 decimals.
 */
export const LAUNCHLAB_DEFAULT_CURVE = {
  decimals: 6,
  supply: 1_000_000_000_000_000n,
  totalSellA: 793_100_000_000_000n,
  totalFundRaisingB: 85_000_000_000n,
} as const;

/** Bonding-curve progress 0..1 from PoolState fields real_base / total_base_sell (docs/VERIFIED.md item 8). */
export function curveProgress(realBase: bigint, totalBaseSell: bigint): number {
  if (totalBaseSell <= 0n) return 0;
  if (realBase >= totalBaseSell) return 1;
  return Number((realBase * 1_000_000n) / totalBaseSell) / 1_000_000;
}

/**
 * Graduation FDV in lamports: the final curve price (fundRaising / (supply − sold − locked)) times supply.
 * With the SDK defaults this is ≈ 410.8 SOL (docs/verified/launchlab.md §6).
 */
export function graduationFdvLamports(
  c: { supply: bigint; totalSellA: bigint; totalFundRaisingB: bigint },
  totalLocked = 0n,
  migrateFeeLamports = 0n,
): bigint {
  const migrateBase = c.supply - c.totalSellA - totalLocked;
  if (migrateBase <= 0n) throw new Error("no tokens left for the pool");
  return ((c.totalFundRaisingB - migrateFeeLamports) * c.supply) / migrateBase;
}
