import type { CoinList, Stats } from "@divvy/shared";
import { api } from "@/lib/api";
import { Board } from "@/components/board/Board";
import { coinsKey } from "@/lib/keys";

export default async function BoardPage({ searchParams }: { searchParams: { q?: string } }) {
  const q = typeof searchParams.q === "string" ? searchParams.q : "";
  const [stats, leaders, coins] = await Promise.all([
    api<Stats>("/api/stats"),
    api<CoinList>("/api/coins?sort=payers&limit=3"),
    api<CoinList>(coinsKey({ sort: "trending", pays: "all", q })),
  ]);
  return <Board stats={stats} leaders={leaders.items} initialCoins={coins} />;
}
