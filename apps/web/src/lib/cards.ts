import { minutesSince, type CoinSummary } from "@divvy/shared";
import type { CardCoin } from "@/components/CoinCard";

/** A coin from the API as a board card. */
export const toCard = (c: CoinSummary, now = Date.now()): CardCoin => ({
  name: c.name,
  ticker: c.ticker,
  mint: c.mint,
  imageUrl: c.imageUrl,
  pays: c.dividendAsset,
  mcap: c.marketCapUsd,
  ch: c.change24hPct,
  ageMin: minutesSince(c.createdAt, now),
  creatorLabel: c.creator.label,
  progress: c.progress,
  graduated: c.status === "graduated",
  paidUsd: c.paidUsd,
  holders: c.holders,
  spark: c.spark,
});
