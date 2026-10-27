/**
 * A coin's page, by mint: coins can share a ticker (owner decision 2026-10-27), and a ticker link
 * opens the first coin launched with it.
 */
export const coinHref = (c: { ticker: string; mint?: string | null }) => `/coin/${encodeURIComponent(c.mint || c.ticker)}`;
