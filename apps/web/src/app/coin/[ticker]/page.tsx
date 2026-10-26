import Link from "next/link";
import type { CoinDetail, Meter, PayoutRound } from "@divvy/shared";
import { serverApi, serverApiOrNull } from "@/lib/server-api";
import { CoinView } from "@/components/coin/CoinView";
import { Icon } from "@/components/Icon";

export default async function CoinPage({ params }: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await params).ticker);
  const coin = await serverApiOrNull<CoinDetail>(`/api/coins/${encodeURIComponent(ticker)}`);
  if (!coin)
    return (
      <>
        <Link className="back" href="/"><Icon name="back" />Back to the board</Link>
        <div className="empty">
          There&apos;s no coin called ${ticker} here yet. <Link className="link" href="/create">Create it</Link>.
        </div>
      </>
    );
  const [meter, payouts] = await Promise.all([
    serverApi<Meter>(`/api/coins/${coin.mint}/meter`),
    serverApi<{ items: PayoutRound[]; nextCursor: string | null }>(`/api/coins/${coin.mint}/payouts?limit=10`),
  ]);
  return <CoinView key={coin.mint} coin={coin} initialMeter={meter} initialPayouts={payouts} />;
}
