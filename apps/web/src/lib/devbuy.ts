import { DEV_BUY_ACCOUNTS_LAMPORTS, DEV_BUY_MAX_LAMPORTS, DEV_BUY_MIN_LAMPORTS, devBuyProblem } from "@divvy/shared";

/** The create form's quick picks, in SOL (owner request 2026-10-28). */
export const DEV_BUY_PICKS = ["0.1", "0.2", "0.5", "1"] as const;
/** Left in the wallet by "Max": the network fees, and the server's margin over the create's estimate. */
const MAX_RESERVE_LAMPORTS = 10_000_000n;

/**
 * The most the wallet can put in a dev buy and still pay for the launch: its balance less uspad's fee,
 * the create, the dev buy's token accounts and a margin, rounded down to 0.001 SOL and capped at the
 * 80 SOL limit. Null when that's under the 0.01 SOL minimum.
 */
export function maxDevBuy(balanceLamports: bigint, feeLamports: bigint, createLamports: bigint): bigint | null {
  const room = balanceLamports - feeLamports - createLamports - DEV_BUY_ACCOUNTS_LAMPORTS - MAX_RESERVE_LAMPORTS;
  const max = room > DEV_BUY_MAX_LAMPORTS ? DEV_BUY_MAX_LAMPORTS : room - (room % 1_000_000n);
  return max >= DEV_BUY_MIN_LAMPORTS ? max : null;
}

/** Lamports as the SOL a person types: "1.25", never "1.2500000000000002". */
export function solText(lamports: bigint): string {
  const whole = lamports / 1_000_000_000n;
  const frac = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

/**
 * The create form's dev buy field in lamports: 0n when empty, null when it isn't an amount the server
 * takes (0.01 to 80 SOL, at most 9 decimals). The server checks it again (CLAUDE.md rule 5).
 */
export function parseDevBuy(input: string): bigint | null {
  const v = input.trim().replace(",", ".");
  if (!v) return 0n;
  const m = /^(\d{1,3})(?:\.(\d{0,9}))?$/.exec(v);
  if (!m) return null;
  const lamports = BigInt(m[1]!) * 1_000_000_000n + BigInt((m[2] ?? "").padEnd(9, "0"));
  return devBuyProblem(lamports) ? null : lamports;
}

/** A share of supply (0..1) as "3.4%", or "<0.1%" for a sliver. */
export const shareLabel = (f: number): string => (f > 0 && f < 0.001 ? "<0.1%" : `${(f * 100).toFixed(1)}%`);
