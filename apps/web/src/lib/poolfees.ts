import type { Config } from "@divvy/shared";

// The Raydium CPMM pool a coin graduates into (docs/ECONOMICS.md "Sources"): a 0.25% trade fee, of
// which Raydium keeps 12% + 4% and the locked liquidity earns the rest, plus a 0.05% creator fee of
// which Raydium keeps 5% (AmmConfig index 0 on mainnet, 2026-10-27: creator_fee_share_rate 50000;
// docs/VERIFIED.md item 26).
export const POOL_FEE_BPS = 25;
export const POOL_RAYDIUM_SHARE = 0.16;
export const POOL_CREATOR_FEE_BPS = 5;
export const POOL_CREATOR_RAYDIUM_SHARE = 0.05;

/**
 * A pool trade's fee and where it goes: the locked liquidity's fees and the pool's creator fee are split
 * by fees.afterGraduation (50 : 15 : 10, the curve's split before uspad's share went up).
 */
export function poolFees(w: Config["fees"]["afterGraduation"]) {
  const lpBps = POOL_FEE_BPS * (1 - POOL_RAYDIUM_SHARE);
  const potBps = lpBps + POOL_CREATOR_FEE_BPS * (1 - POOL_CREATOR_RAYDIUM_SHARE);
  const shared = w.holders + w.creator + w.divvy;
  return {
    total: POOL_FEE_BPS + POOL_CREATOR_FEE_BPS,
    holders: (potBps * w.holders) / shared,
    creator: (potBps * w.creator) / shared,
    divvy: (potBps * w.divvy) / shared,
    raydium: POOL_FEE_BPS * POOL_RAYDIUM_SHARE + POOL_CREATOR_FEE_BPS * POOL_CREATOR_RAYDIUM_SHARE,
  };
}
