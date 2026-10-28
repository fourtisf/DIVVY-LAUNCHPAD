/**
 * The board's search (owner request 2026-10-28): a coin is found by its ticker, its name or its
 * contract address (CA), and by the stock it pays. What people paste is tidied first: a "$" before a
 * ticker, quotes, and stray characters a copy brings along (a trailing "\" broke a pasted CA).
 */
const BASE58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export interface CoinSearch {
  /** Lower-case text for names, tickers and stocks; empty when there's nothing to look for. */
  text: string;
  /** The query as typed (case kept, base58 is case-sensitive) when it can be part of a CA. */
  address: string | null;
}

export function parseCoinSearch(q: string | undefined): CoinSearch {
  const t = (q ?? "")
    .trim()
    .replace(/^[\s"'`$\\/]+/, "")
    .replace(/[\s"'`\\/.,;:]+$/, "");
  return { text: t.toLowerCase(), address: t.length >= 6 && BASE58.test(t) ? t : null };
}

/** Whether a coin matches: its CA (whole or a piece of at least 6 characters), or its name, ticker or stock. */
export function coinMatches(c: { mint: string | null; name: string; ticker: string; stocks: string[] }, s: CoinSearch): boolean {
  if (!s.text) return true;
  if (s.address && c.mint?.includes(s.address)) return true;
  return [c.name, c.ticker, ...c.stocks].some((x) => x.toLowerCase().includes(s.text));
}
