import type { CoinList, Stats } from "@divvy/shared";
import { serverApi, sharedApi } from "@/lib/server-api";
import { Board } from "@/components/board/Board";
import { coinsKey } from "@/lib/keys";

export default async function BoardPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { q: raw } = await searchParams;
  const q = typeof raw === "string" ? raw : "";
  const [stats, leaders, coins] = await Promise.all([
    sharedApi<Stats>("/api/stats"),
    serverApi<CoinList>("/api/coins?sort=payers&limit=3"),
    serverApi<CoinList>(coinsKey({ sort: "trending", pays: "all", q })),
  ]);
  return <Board stats={stats} leaders={leaders.items} initialCoins={coins} now={Date.now()} />;
}
