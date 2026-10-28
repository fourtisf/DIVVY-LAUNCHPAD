import { devBuyProblem } from "@divvy/shared";

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
