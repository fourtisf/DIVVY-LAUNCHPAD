/**
 * A priority fee for the trades the site builds. Without one, a buy or sell sent while Solana is busy is
 * often dropped and the page waits until it expires (2026-10-28: a creator's sell stayed on "Confirming").
 * The price comes from what recent transactions paid on the same pool (getRecentPrioritizationFees with
 * that account, in micro-lamports per compute unit), held between a floor and a cap so a trade costs at
 * most about 0.001 SOL in priority fees at the default compute budget.
 */
export const PRIORITY_FLOOR_MICRO_LAMPORTS = 50_000;
export const PRIORITY_CAP_MICRO_LAMPORTS = 1_000_000;

/** The 75th percentile of the fees recently paid (zeros left out), between the floor and the cap. */
export function pickPriorityPrice(recent: number[]): number {
  const paid = recent.filter((f) => f > 0).sort((a, b) => a - b);
  const p75 = paid.length ? paid[Math.min(paid.length - 1, Math.floor(paid.length * 0.75))]! : 0;
  return Math.min(PRIORITY_CAP_MICRO_LAMPORTS, Math.max(PRIORITY_FLOOR_MICRO_LAMPORTS, p75));
}
