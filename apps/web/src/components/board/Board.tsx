"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { num, usd, usdFull, type CoinList, type CoinSort, type CoinSummary, type Stats } from "@divvy/shared";
import { coinsKey } from "@/lib/keys";
import { useAssets, useConfig } from "@/lib/config";
import { deliveryCopy } from "@/lib/copy";
import { useLang, useMsgs } from "@/i18n/client";
import { board } from "@/i18n/msgs/board";
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

const SORTS: CoinSort[] = ["trending", "new", "payers", "graduate"];

export function Board({ stats, leaders, initialCoins, now: renderedAt }: { stats: Stats; leaders: CoinSummary[]; initialCoins: CoinList; now: number }) {
  const config = useConfig();
  const t = useMsgs(board);
  const [lang] = useLang();
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
              {t.paidThisHour(usd(roundUsd))}
            </span>
            <TokenCa />
            <XFollow />
            <TelegramJoin />
          </div>
          <h1>{t.h1}</h1>
          <p className="lede">{t.lede(!!config.launchFee.to, deliveryCopy(config, lang).heroTail)}</p>
          <div className="ctas">
            <Link className="btn btn-g btn-lg" href="/create">{t.createCoin}</Link>
            <Link className="btn btn-ghost btn-lg" href="/how">{t.howItWorks}</Link>
          </div>
          <div className="promises">
            <Link className="tag" href="/how"><Icon name="gift" />{t.devBuysShown(!!config.launchFee.to)}</Link>
            <Link className="tag" href="/how"><Icon name="lock" />{t.liquidityLocked}</Link>
            <Link className="tag" href="/how"><Icon name="shield" />{t.noSniper}</Link>
            <Link className="tag" href="/payouts"><Icon name="receipt" />{t.payoutsOnChain}</Link>
          </div>
        </div>
        <HeroStage featured={featured}>
          <div className="glass next-card">
            <Ring nextAt={stats.nextRoundAt} intervalSec={config.payouts.intervalSec} />
            <div>
              <div className="k">{t.nextPayout}</div>
              <b><Countdown nextAt={stats.nextRoundAt} /></b>
            </div>
          </div>
          <div className="glass round-card">
            <div className="k">{t.lastRound}</div>
            <div className="v"><CountUp value={roundUsd} format={usdFull} /></div>
            <div className="k">{t.paidToWallets((round?.wallets ?? 0).toLocaleString("en-US"))}</div>
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
        <div><b><CountUp value={stats.paidToHoldersUsd} format={usdFull} /></b><span>{t.paidToHolders}</span></div>
        <div><b><CountUp value={stats.volume24hUsd} format={usdFull} /></b><span>{t.traded24h}</span></div>
        <div><b>{stats.coinsLive}</b><span>{t.coinsLive}</span></div>
        <div><b>{stocksToEarn}</b><span>{t.stocksToEarn}</span></div>
      </div>

      <section aria-labelledby="leadH">
        <div className="sec-h">
          <div>
            <h2 id="leadH">{t.leadersH}</h2>
            <p>{t.leadersP}</p>
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
                  <div className="leader-tick">{t.leaderTick(c.ticker, usd(c.marketCapUsd))}</div>
                </div>
              </div>
              <div className="leader-paid">
                <b>{usd(c.paid24hUsd)}</b>
                <span>{t.paidToday}<br />{num(c.paid24h.ui)} {c.dividendAsset}</span>
              </div>
              <Coupon pays={c.dividendAsset} paidUsd={c.paidUsd} holders={c.holders} />
            </Link>
          ))}
        </div>
      </section>

      <section aria-labelledby="allH">
        <div className="sec-h">
          <div>
            <h2 id="allH">{t.allCoins}</h2>
          </div>
        </div>
        <div className="toolbar">
          <div className="seg" role="group" aria-label={t.sort}>
            {SORTS.map((k) => (
              <button type="button" key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>
                {t.sorts[k]}
              </button>
            ))}
          </div>
          <div className="pays-filter" role="group" aria-label={t.filterByStock}>
            <span>{t.paysIn}</span>
            <button type="button" className="fchip all" aria-pressed={pays === "all"} onClick={() => setPays("all")}>{t.all}</button>
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
            <div className="empty">{t.noMatch(q)}</div>
          ) : null}
        </div>
      </section>
    </>
  );
}
