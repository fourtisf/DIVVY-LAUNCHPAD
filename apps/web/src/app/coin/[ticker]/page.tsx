import Link from "next/link";
import type { CoinDetail, Meter, PayoutRound } from "@divvy/shared";
import { api, apiOrNull } from "@/lib/api";
import { CoinView } from "@/components/coin/CoinView";
import { Icon } from "@/components/Icon";

export default async function CoinPage({ params }: { params: { ticker: string } }) {
  const ticker = decodeURIComponent(params.ticker);
  const coin = await apiOrNull<CoinDetail>(`/api/coins/${encodeURIComponent(ticker)}`);
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
    api<Meter>(`/api/coins/${coin.mint}/meter`),
    api<{ items: PayoutRound[]; nextCursor: string | null }>(`/api/coins/${coin.mint}/payouts?limit=10`),
  ]);
  return <CoinView key={coin.mint} coin={coin} initialMeter={meter} initialPayouts={payouts} />;
}
