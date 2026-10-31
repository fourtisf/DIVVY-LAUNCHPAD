import Link from "next/link";
import type { CoinDetail, CoinList, Meter, PayoutRound } from "@divvy/shared";
import { toCard } from "@/lib/cards";
import { serverApi, serverApiOrNull } from "@/lib/server-api";
import { CoinCard } from "@/components/CoinCard";
import { CoinView } from "@/components/coin/CoinView";
import { Icon } from "@/components/Icon";
import { getMsgs } from "@/i18n/server";
import { common } from "@/i18n/msgs/common";
import { coinMsgs } from "@/i18n/msgs/coin";

const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export default async function CoinPage({ params }: { params: Promise<{ ticker: string }> }) {
  const ticker = decodeURIComponent((await params).ticker);
  const [t, tc] = await Promise.all([getMsgs(coinMsgs), getMsgs(common)]);
  // Coins can share a ticker (owner decision 2026-10-27) and links use the mint. A ticker link (an old
  // tab, a typed or shared URL) that matches several coins lists them, instead of guessing which one.
  // The API lists every coin whose ticker reads the same, lookalikes included (D0GE for DOGE).
  if (!MINT.test(ticker) && ticker.length <= 64) {
    const found = await serverApiOrNull<CoinList>(`/api/coins?ticker=${encodeURIComponent(ticker)}&limit=100`);
    const same = found?.items ?? [];
    if (same.length > 1)
      return (
        <>
          <Link className="back" href="/"><Icon name="back" />{tc.backToBoard}</Link>
          <h1 className="page-h">${same[0]!.ticker}</h1>
          <p className="page-lede">{t.sameTicker(same.length)}</p>
          <div className="grid">
            {same.map((c) => (
              <CoinCard key={c.mint} c={toCard(c)} />
            ))}
          </div>
        </>
      );
  }
  // Longer than any ticker or mint: the API would refuse it, so it's simply not a coin here.
  const coin = ticker.length > 64 ? null : await serverApiOrNull<CoinDetail>(`/api/coins/${encodeURIComponent(ticker)}`);
  if (!coin)
    return (
      <>
        <Link className="back" href="/"><Icon name="back" />{tc.backToBoard}</Link>
        <div className="empty">
          {t.noCoin(ticker, (text) => (
            <Link className="link" href="/create">{text}</Link>
          ))}
        </div>
      </>
    );
  const [meter, payouts] = await Promise.all([
    serverApi<Meter>(`/api/coins/${coin.mint}/meter`),
    serverApi<{ items: PayoutRound[]; nextCursor: string | null }>(`/api/coins/${coin.mint}/payouts?limit=10`),
  ]);
  return <CoinView key={coin.mint} coin={coin} initialMeter={meter} initialPayouts={payouts} />;
}
