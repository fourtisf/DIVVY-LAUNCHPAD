"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { num, usd, usdFull, type CoinList, type CoinSort, type CoinSummary, type Stats } from "@divvy/shared";
import { coinsKey } from "@/lib/keys";
import { useAssets, useConfig } from "@/lib/config";
import { deliveryCopy } from "@/lib/copy";
import { Chip } from "../Chip";
import { CoinCard } from "../CoinCard";
import { HeroStage } from "../Coin3D";
import { Countdown, Ring } from "../Countdown";
import { CountUp } from "../CountUp";
import { Coupon } from "../Coupon";
import { Icon } from "../Icon";
import { TokenCa } from "../TokenCa";
import { TelegramJoin, XFollow } from "../XFollow";
import { coinHref } from "@/lib/links";
import { toCard } from "@/lib/cards";


const SORTS: [CoinSort, string][] = [
  ["trending", "Trending"],
  ["new", "New"],
  ["payers", "Top payers"],
  ["graduate", "About to graduate"],
];

export function Board({ stats, leaders, initialCoins, now: renderedAt }: { stats: Stats; leaders: CoinSummary[]; initialCoins: CoinList; now: number }) {
  const config = useConfig();
  // Cards' ages ("New", the sparkline) start from the server's clock, so hydration matches the HTML, then
  // follow the browser's (audit: a coin crossing 10 or 20 minutes in between broke hydration).
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const assets = useAssets();
  const q = useSearchParams().get("q") ?? "";
  const [sort, setSort] = useState<CoinSort>("trending");
  const [pays, setPays] = useState("all");
  const key = coinsKey({ sort, pays, q });
  const first = coinsKey({ sort: "trending", pays: "all", q });
  const { data } = useSWR<CoinList>(key, { fallbackData: key === first ? initialCoins : undefined });
  const list = data?.items ?? [];

  const round = stats.lastRound;
  const roundUsd = round?.paidUsd ?? 0;
  const stocksToEarn = config.dividendAssets.filter((a) => a.kind === "stock" && a.enabled).length;
  const featured = config.dividendAssets.filter((a) => a.featured);

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-chips">
            <span className="eyecatch">
              <span className="dot">
                <Icon name="bolt" size={12} />
              </span>
              Holders paid {usd(roundUsd)} in stocks this hour
            </span>
            <TokenCa />
            <XFollow />
            <TelegramJoin />
          </div>
          <h1>
            Memecoins that pay you <span className="glow">real stock dividends.</span>
          </h1>
          <p className="lede">Launch a coin{config.launchFee.to ? " in seconds" : " for free"}. Every trade buys the stock you picked, like NVDAx or SPYx, {deliveryCopy(config).heroTail}</p>
          <div className="ctas">
            <Link className="btn btn-g btn-lg" href="/create">Create a coin</Link>
            <Link className="btn btn-ghost btn-lg" href="/how">How it works</Link>
          </div>
          <div className="promises">
            <Link className="tag" href="/how"><Icon name="gift" />{config.launchFee.to ? "No dev buy" : "Free, no dev buy"}</Link>
            <Link className="tag" href="/how"><Icon name="lock" />Liquidity locked for good</Link>
            <Link className="tag" href="/how"><Icon name="shield" />No sniper in block 0</Link>
            <Link className="tag" href="/payouts"><Icon name="receipt" />Every payout on chain</Link>
          </div>
        </div>
        <HeroStage featured={featured}>
          <div className="glass next-card">
            <Ring nextAt={stats.nextRoundAt} intervalSec={config.payouts.intervalSec} />
            <div>
              <div className="k">Next payout</div>
              <b><Countdown nextAt={stats.nextRoundAt} /></b>
            </div>
          </div>
          <div className="glass round-card">
            <div className="k">Last hourly round</div>
            <div className="v"><CountUp value={roundUsd} format={usdFull} /></div>
            <div className="k">paid to {(round?.wallets ?? 0).toLocaleString("en-US")} wallets</div>
            <div className="rows">
              {round?.items.map((p) => (
                <div className="row" key={p.mint}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.imageUrl} alt="" />
                  <span>${p.ticker}</span>
                  <b>{num(p.amount.ui)} {p.assetSymbol}</b>
                </div>
              ))}
            </div>
          </div>
        </HeroStage>
      </section>

      <div className="stats-band">
        <div><b><CountUp value={stats.paidToHoldersUsd} format={usdFull} /></b><span>Paid to holders</span></div>
        <div><b><CountUp value={stats.volume24hUsd} format={usdFull} /></b><span>Traded in 24h</span></div>
        <div><b>{stats.coinsLive}</b><span>Coins live</span></div>
        <div><b>{stocksToEarn}</b><span>Stocks to earn</span></div>
      </div>

      <section aria-labelledby="leadH">
        <div className="sec-h">
          <div>
            <h2 id="leadH">Paying the most today</h2>
            <p>Ranked by what holders were paid in the last 24 hours.</p>
          </div>
        </div>
        <div className="leaders">
          {leaders.map((c, i) => (
            <Link className="leader tilt" href={coinHref(c)} key={c.mint}>
              <span className="rank">{i + 1}</span>
              <div className="leader-top">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={c.imageUrl} alt="" width={64} height={64} />
                <div>
                  <div className="leader-name">{c.name}</div>
                  <div className="leader-tick">${c.ticker}, {usd(c.marketCapUsd)} market cap</div>
                </div>
              </div>
              <div className="leader-paid">
                <b>{usd(c.paid24hUsd)}</b>
                <span>paid today<br />{num(c.paid24h.ui)} {c.dividendAsset}</span>
              </div>
              <Coupon pays={c.dividendAsset} paidUsd={c.paidUsd} holders={c.holders} />
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="allH">
        <div className="sec-h">
          <div>
            <h2 id="allH">All coins</h2>
          </div>
        </div>
        <div className="toolbar">
          <div className="seg" role="group" aria-label="Sort">
            {SORTS.map(([k, l]) => (
              <button type="button" key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="pays-filter" role="group" aria-label="Filter by stock">
            <span>Pays in</span>
            <button type="button" className="fchip all" aria-pressed={pays === "all"} onClick={() => setPays("all")}>All</button>
            {stats.assetsInUse.filter((s) => assets[s]).map((s) => (
              <button type="button" className="fchip" key={s} aria-pressed={pays === s} onClick={() => setPays(s)}>
                <Chip sym={s} />
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="grid" id="grid">
          {list.length ? (
            list.map((c) => <CoinCard key={c.mint} c={toCard(c, now)} />)
          ) : data ? (
            <div className="empty">
              No coin matches “{q}”. Try a ticker or a stock like NVDAx, or <Link className="link" href="/create">create it yourself</Link>.
            </div>
          ) : null}
        </div>
      </section>
    </>
  );
}
