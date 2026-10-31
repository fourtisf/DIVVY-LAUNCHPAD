"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { minutesSince, num, pct, usd, usdFull, type CoinList, type CoinSort, type CoinSummary, type Stats } from "@divvy/shared";
import { coinsKey } from "@/lib/keys";
import { useAssets, useConfig } from "@/lib/config";
import { deliveryCopy } from "@/lib/copy";
import { shareLabel } from "@/lib/devbuy";
import { coinHref } from "@/lib/links";
import { useLang, useMsgs } from "@/i18n/client";
import { board } from "@/i18n/msgs/board";
import { common } from "@/i18n/msgs/common";
import { Chip } from "../Chip";
import { Countdown } from "../Countdown";
import { CountUp } from "../CountUp";
import { Icon } from "../Icon";
import { Mark } from "../Mark";
import { TokenCa } from "../TokenCa";
import { TelegramJoin, XFollow } from "../XFollow";

const SORTS: CoinSort[] = ["trending", "new", "payers", "graduate"];

/** A coin's picture as a rounded tile (prototype `av`). */
function Avatar({ src, size }: { src: string; size: number }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="av" src={src} alt="" width={size} height={size} loading="lazy" style={{ width: size, height: size, borderRadius: Math.round(size * 0.27), objectFit: "cover" }} />;
}

/** One row of the coin table (prototype `.trow`); on phones it folds into a compact card. */
function CoinRow({ c, now }: { c: CoinSummary; now: number }) {
  const t = useMsgs(board);
  const ago = useMsgs(common).ago;
  const age = minutesSince(c.createdAt, now);
  const graduated = c.status === "graduated";
  return (
    <Link className="trow" href={coinHref(c)}>
      <div className="coin">
        <Avatar src={c.imageUrl} size={38} />
        <div style={{ minWidth: 0 }}>
          <b>
            {c.name}
            {age < 20 && <span className="badge new">{t.badgeNew}</span>}
            {graduated && <span className="badge grad">{t.badgeGraduated}</span>}
            {c.devBuyPct ? <span className="badge dev" title={t.devBadgeTitle(shareLabel(c.devBuyPct))}>{t.devBadge(shareLabel(c.devBuyPct))}</span> : null}
          </b>
          <small suppressHydrationWarning>${c.ticker} · {ago(age)}</small>
        </div>
      </div>
      <span className="c-mcap num" style={{ fontSize: 17, fontWeight: 700 }}>{usd(c.marketCapUsd)}</span>
      <span className="c-chg"><span className={"chg " + (c.change24hPct >= 0 ? "up" : "down")}>{pct(c.change24hPct)}</span></span>
      <span className="c-prog prog">
        {graduated ? (
          <span style={{ color: "#1E7A55", fontWeight: 700, fontSize: 13 }}>{t.badgeGraduated}</span>
        ) : (
          <>
            <span className="bar"><i style={{ width: (c.progress * 100).toFixed(1) + "%" }} /></span>
            <span className="num">{Math.round(c.progress * 100)}%</span>
          </>
        )}
      </span>
      <span className="c-pays paychip"><Chip sym={c.dividendAsset} />{c.dividendAsset}</span>
      <span className="c-paid num up">{usd(c.paidUsd)}</span>
      <span className="c-h num">{c.holders.toLocaleString("en-US")}</span>
      <span className="c-age" suppressHydrationWarning>{t.ageShort(ago(age))}</span>
    </Link>
  );
}

export function Board({ stats, leaders, initialCoins, now: renderedAt }: { stats: Stats; leaders: CoinSummary[]; initialCoins: CoinList; now: number }) {
  const config = useConfig();
  const t = useMsgs(board);
  const [lang] = useLang();
  // Ages start from the server's clock, so hydration matches the HTML, then follow the browser's
  // (audit: a coin crossing 10 or 20 minutes in between broke hydration).
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
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
  const paidLaunch = !!config.launchFee.to;

  return (
    <>
      <section className="hero">
        <div>
          <div className="hero-chips">
            <span className="eyecatch">
              <span className="dot"><Icon name="bolt" size={12} /></span>
              {t.paidThisHour(usd(roundUsd))}
            </span>
            <TokenCa />
            <XFollow />
            <TelegramJoin />
          </div>
          <h1>{t.h1}</h1>
          <p className="lede">{t.lede(paidLaunch, deliveryCopy(config, lang).heroTail)}</p>
          <div className="ctas">
            <Link className="btn btn-gold btn-lg" href="/create">{t.createCoin}</Link>
            <Link className="btn btn-ghost btn-lg" href="/how">{t.howItWorks}</Link>
          </div>
          <div className="promises">
            <Link className="pill" href="/how">{t.devBuysShown(paidLaunch)}</Link>
            <Link className="pill" href="/how">{t.liquidityLocked}</Link>
            <Link className="pill" href="/how">{t.noSniper}</Link>
            <Link className="pill" href="/payouts">{t.payoutsOnChain}</Link>
          </div>
        </div>
        <div className="stage">
          <div className="env" aria-label={t.nextPayout}>
            <span className="seal"><Mark size={88} variant="red" /></span>
            <div className="amt">
              <b className="tab"><Countdown nextAt={stats.nextRoundAt} /></b>
              <span>{t.untilNext}</span>
            </div>
          </div>
          <div className="panel ticket">
            <div className="k">{t.lastRound}</div>
            <div className="v"><CountUp value={roundUsd} format={usdFull} /></div>
            <div className="k">{t.paidToWallets((round?.wallets ?? 0).toLocaleString("en-US"))}</div>
            <div className="rows">
              {round?.items.map((p) => (
                <div className="row" key={p.mint}>
                  <Avatar src={p.imageUrl} size={20} />
                  <span>${p.ticker}</span>
                  <b>{num(p.amount.ui)} {p.assetSymbol}</b>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <div className="stats">
        <div><b><CountUp value={stats.paidToHoldersUsd} format={usdFull} /></b><span>{t.paidToHolders}</span></div>
        <div><b><CountUp value={stats.volume24hUsd} format={usdFull} /></b><span>{t.traded24h}</span></div>
        <div><b>{stats.coinsLive}</b><span>{t.coinsLive}</span></div>
        <div><b>{stocksToEarn}</b><span>{t.stocksToEarn}</span></div>
      </div>

      <section className="sec" aria-labelledby="leadH">
        <div className="sec-h">
          <div>
            <h2 id="leadH">{t.leadersH}</h2>
            <p>{t.leadersP}</p>
          </div>
        </div>
        <div className="leaders">
          {leaders.map((c, i) => (
            <Link className="lcard" href={coinHref(c)} key={c.mint}>
              <div className="top">
                <Avatar src={c.imageUrl} size={44} />
                <div style={{ minWidth: 0 }}>
                  <div className="nm">{c.name}</div>
                  <div className="tk">{t.leaderTick(c.ticker, usd(c.marketCapUsd))}</div>
                </div>
                <span className="rank">{i + 1}</span>
              </div>
              <div className="bd">
                <div className="paid">
                  <b className="num">{usd(c.paid24hUsd)}</b>
                  <span>{t.paidToday}<br />{num(c.paid24h.ui)} {c.dividendAsset}</span>
                </div>
                <div className="pays">
                  <strong><Chip sym={c.dividendAsset} />{c.dividendAsset}</strong>
                  <span className="tab">{t.leaderTotal(usd(c.paidUsd), c.holders.toLocaleString("en-US"))}</span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="sec" style={{ paddingTop: 6 }} aria-labelledby="allH">
        <div className="sec-h"><div><h2 id="allH">{t.allCoins}</h2></div></div>
        <div className="panel board">
          <div className="toolbar">
            <div className="seg" role="group" aria-label={t.sort}>
              {SORTS.map((k) => (
                <button type="button" key={k} aria-pressed={sort === k} onClick={() => setSort(k)}>{t.sorts[k]}</button>
              ))}
            </div>
            <div className="fwrap">
              <span>{t.paysIn}</span>
              <div className="fchips" role="group" aria-label={t.filterByStock}>
                <button type="button" className="fchip all" aria-pressed={pays === "all"} onClick={() => setPays("all")}>{t.all}</button>
                {stats.assetsInUse.filter((s) => assets[s]).map((s) => (
                  <button type="button" className="fchip" key={s} aria-pressed={pays === s} onClick={() => setPays(s)}>
                    <Chip sym={s} />
                    {s}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="trow th" aria-hidden="true">
            <span>{t.colCoin}</span><span>{t.colMcap}</span><span>{t.col24h}</span><span>{t.colCurve}</span><span>{t.colPays}</span><span>{t.colPaid}</span><span>{t.colHolders}</span><span>{t.colAge}</span>
          </div>
          <div id="grid">
            {list.length ? list.map((c) => <CoinRow key={c.mint} c={c} now={now} />) : data ? <div className="empty">{t.noMatch(q)}</div> : null}
          </div>
        </div>
      </section>
    </>
  );
}
