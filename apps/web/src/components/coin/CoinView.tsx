"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  bpsLabel,
  minutesSince,
  num,
  pct,
  short,
  usd,
  type CandleList,
  type CandleTf,
  type CoinDetail,
  type Holder,
  type Meter,
  type PayoutRound,
  type Trade,
} from "@divvy/shared";
import { qs } from "@/lib/api";
import { useAssets, useConfig } from "@/lib/config";
import { deliveryCopy } from "@/lib/copy";
import { BRAND } from "@/lib/brand";
import { useAgo, useLang, useMsgs } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";
import { coinMsgs } from "@/i18n/msgs/coin";
import { Chip } from "../Chip";
import { Countdown } from "../Countdown";
import { Icon } from "../Icon";
import { useToast } from "../Toasts";
import { CandleChart } from "./CandleChart";
import { ReportButton } from "./ReportButton";
import { TradeBox } from "./TradeBox";
import { CreatorFees } from "./CreatorFees";
import { shareLabel } from "@/lib/devbuy";

type List<T> = { items: T[]; nextCursor?: string | null };

/** Candle sizes, as the buttons show them. */
const INTERVALS: { tf: CandleTf; label: string }[] = [
  { tf: "1m", label: "1m" },
  { tf: "5m", label: "5m" },
  { tf: "15m", label: "15m" },
  { tf: "1h", label: "1h" },
  { tf: "4h", label: "4h" },
  { tf: "1d", label: "1D" },
];
/** A coin's first candle size: minutes while it's young, then longer ones. */
const defaultInterval = (ageMin: number): CandleTf => (ageMin <= 360 ? "1m" : ageMin <= 4320 ? "15m" : "1h");

/** How often the page re-reads the coin, its chart and its trades (the indexer polls every 4 s). */
const LIVE_MS = 8_000;

export function CoinView({ coin: initialCoin, initialMeter, initialPayouts }: { coin: CoinDetail; initialMeter: Meter; initialPayouts: List<PayoutRound> }) {
  const { data: coin = initialCoin } = useSWR<CoinDetail>(`/api/coins/${initialCoin.mint}`, { fallbackData: initialCoin, refreshInterval: LIVE_MS });
  const config = useConfig();
  const assets = useAssets();
  const toast = useToast();
  const t = useMsgs(coinMsgs);
  const tc = useMsgs(common);
  const [lang] = useLang();
  const ago = useAgo();
  const s = assets[coin.dividendAsset];
  const px = s?.priceUsd ?? 1;
  const ageMin = minutesSince(coin.createdAt);
  const m = coin.mint;

  const [tf, setTf] = useState<CandleTf>(() => defaultInterval(ageMin));
  const [unit, setUnit] = useState<"price" | "mcap">("mcap");
  const { data: candles } = useSWR<CandleList>(`/api/coins/${m}/candles` + qs({ tf, unit, limit: 300 }), { refreshInterval: LIVE_MS, keepPreviousData: false });

  const [tab, setTab] = useState<"payouts" | "holders" | "trades">("payouts");
  // Refreshed like the meter, so a new round shows here as soon as the meter says it was paid (audit).
  const { data: payouts } = useSWR<List<PayoutRound>>(`/api/coins/${m}/payouts?limit=10`, { fallbackData: initialPayouts, refreshInterval: 30_000 });
  // Hours that paid holders, as dots under the candles.
  const payoutHours = useMemo(
    () => (payouts?.items ?? []).filter((p) => p.status === "ok" || p.status === "late").map((p) => Math.floor(new Date(p.hour).getTime() / 1000)),
    [payouts],
  );
  const { data: holders } = useSWR<List<Holder>>(tab === "holders" ? `/api/coins/${m}/holders` : null);
  const { data: trades } = useSWR<List<Trade>>(tab === "trades" ? `/api/coins/${m}/trades?limit=24` : null, { refreshInterval: LIVE_MS });
  const { data: meter = initialMeter } = useSWR<Meter>(`/api/coins/${m}/meter`, { fallbackData: initialMeter, refreshInterval: 30_000 });

  const [hold, setHold] = useState(1);
  const daily = (coin.volume24hUsd * config.fees.holdersBps) / 10_000 * (hold / 100);
  const tot = meter.paid24hUsd + meter.pendingUsd || 1;
  const f = config.fees;
  const minHolder = usd(config.payouts.minHolderUsd);
  const lateMin = Math.round(config.payouts.lateAfterSec / 60);
  const statusLabel = meter.status === "late" ? t.statusLate : meter.status === "carried" ? t.statusCarried : t.statusOnTime;

  const copyCa = () => {
    navigator.clipboard?.writeText(coin.mint).catch(() => {});
    toast(t.caCopied);
  };

  return (
    <>
      <Link className="back" href="/"><Icon name="back" />{tc.backToBoard}</Link>
      <div className="chead">
        <span className="av" title={t.coinTitle(coin.ticker, coin.dividendAsset)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={coin.imageUrl} alt="" width={92} height={92} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h1>
            {coin.name}
            <small>${coin.ticker}</small>
          </h1>
          <div className="meta">
            <span suppressHydrationWarning>{t.createdBy(coin.creator.label, ago(coin.createdAt))}</span>
            <button className="ca" type="button" id="copyCa" title={t.copyCa} onClick={copyCa}>
              <Icon name="copy" />
              {short(coin.mint)}
            </button>
            <span className="tag"><Icon name="shield" />{t.privateBundle}</span>
            <span className="tag" id="devBuyTag" title={coin.devBuyPct ? t.devBoughtTitle(shareLabel(coin.devBuyPct)) : t.noDevBuyTitle}>
              <Icon name="gift" />
              {coin.devBuyPct ? t.devBought(shareLabel(coin.devBuyPct)) : t.noDevBuy}
            </span>
            <ReportButton mint={coin.mint} ticker={coin.ticker} />
          </div>
        </div>
      </div>

      <div className="panel kpis">
        <div><span>{t.kpiMcap}</span><b className="up">{usd(coin.marketCapUsd)}</b></div>
        <div><span>{t.kpiChange}</span><b className={coin.change24hPct >= 0 ? "up" : "down"}>{pct(coin.change24hPct)}</b></div>
        <div><span>{t.kpiVolume}</span><b>{usd(coin.volume24hUsd)}</b></div>
        <div><span>{t.kpiHolders}</span><b>{coin.holders.toLocaleString("en-US")}</b></div>
        <div><span>{t.kpiPaid}</span><b className="up">{usd(coin.paidUsd)}</b></div>
      </div>

      <div className="coin-grid">
        <div className="stack">
          <div className="panel">
            <div className="chart-head">
              <div className="tf" role="group" aria-label={t.candleSize}>
                {INTERVALS.map((i) => (
                  <button type="button" key={i.tf} aria-pressed={tf === i.tf} onClick={() => setTf(i.tf)}>{i.label}</button>
                ))}
              </div>
              <div className="tf" role="group" aria-label={t.chartOf}>
                <button type="button" aria-pressed={unit === "price"} onClick={() => setUnit("price")}>{t.price}</button>
                <button type="button" aria-pressed={unit === "mcap"} onClick={() => setUnit("mcap")}>{t.marketCap}</button>
              </div>
            </div>
            <CandleChart
              candles={candles}
              solUsd={config.quote.priceUsd}
              payoutHours={payoutHours}
              label={t.chartLabel(unit, coin.ticker)}
            />
            <div className="legend">
              <span>{t.ath(usd(coin.athUsd))}</span>
              <span><i style={{ background: "var(--gold-deep)" }} />{t.hourlyPayout}</span>
            </div>
          </div>
          <div className="panel">
            <div className="tabs" role="tablist">
              {(["payouts", "holders", "trades"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {t.tabs[k]}
                </button>
              ))}
            </div>
            <div id="tabBody" className="table-scroll">
              {tab === "payouts" &&
                (payouts?.items.length ? (
                  <table className="t">
                    <thead><tr><th>{t.thWhen}</th><th className="r">{t.thPaid}</th><th className="r">{t.thValue}</th><th className="r">{t.thWallets}</th><th className="r">{t.thTx}</th></tr></thead>
                    <tbody>
                      {payouts.items.map((p) => (
                        <tr key={p.id}>
                          <td suppressHydrationWarning>{ago(p.hour)}</td>
                          <td className="r up">{num(p.amount.ui)} {coin.dividendAsset}</td>
                          <td className="r">{usd(p.usd)}</td>
                          <td className="r">{p.wallets}</td>
                          <td className="r"><span className="tx">{p.sig ? short(p.sig) : ""}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted" style={{ padding: "20px 4px 6px", margin: 0 }}>
                    {t.noPayout(<b><Countdown nextAt={meter.nextRoundAt} /></b>, minHolder)}
                  </p>
                ))}
              {tab === "holders" && holders && (
                <table className="t">
                  <thead><tr><th>{t.thWallet}</th><th className="r">{t.thShare}</th><th className="r">{t.thReceived}</th></tr></thead>
                  <tbody>
                    {holders.items.map((h) => (
                      <tr key={h.wallet}>
                        <td>
                          {h.excluded ? (
                            <>
                              {h.label ?? short(h.wallet)} <span className="faint" style={{ fontSize: 12 }}>{t.notPaid}</span>
                            </>
                          ) : (
                            short(h.wallet)
                          )}
                        </td>
                        <td className="r">{h.pct.toFixed(2)}%</td>
                        <td className={"r " + (h.excluded ? "faint" : "up")}>{h.excluded || !h.received ? t.na : num(h.received.ui) + " " + coin.dividendAsset}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "trades" &&
                trades &&
                (trades.items.length ? (
                  <table className="t">
                    <thead><tr><th>{t.thWhen}</th><th>{t.thSide}</th><th className="r">${coin.ticker}</th><th className="r">SOL</th><th className="r">{t.thWallet}</th></tr></thead>
                    <tbody>
                      {/* One transaction can hold several trades of a coin: keyed by signature and which one it is. */}
                      {trades.items.map((tr, i, all) => (
                        <tr key={`${tr.sig}:${all.slice(0, i).filter((x) => x.sig === tr.sig).length}`}>
                          <td>{ago(tr.ts)}</td>
                          <td className={"side-" + tr.side}>{t.side[tr.side]}</td>
                          <td className="r">{num(tr.token.ui)}</td>
                          <td className="r">{tr.sol.ui.toFixed(3)}</td>
                          <td className="r">{short(tr.wallet)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted" style={{ padding: "20px 4px 6px", margin: 0 }}>{t.noTrades}</p>
                ))}
            </div>
          </div>
        </div>

        <aside className="stack">
          <TradeBox coin={coin} />
          <CreatorFees coin={coin} />
          <div className="foil-card">
            <div className="foil-top">
              <Chip sym={coin.dividendAsset} />
              <div>
                <small>{t.paidIn}</small>
                <strong>{coin.dividendAsset}</strong>
              </div>
              <div className="cd">
                <small>{t.nextPayout}</small>
                <b><Countdown nextAt={meter.nextRoundAt} /></b>
              </div>
            </div>
            <div className="foil-body">
              <div className="paid-row">
                <div>
                  <div className="faint" style={{ fontSize: 12.5, marginBottom: 6 }}>{t.paidSoFar}</div>
                  <b>{num(coin.paid.ui)} {coin.dividendAsset}</b>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="faint" style={{ fontSize: 12.5 }}>{t.worth}</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }} className="up">{usd(coin.paidUsd)}</div>
                </div>
              </div>
              <div className="calc">
                <label htmlFor="hold">{t.ifYouHold(<b id="holdPct">{hold.toFixed(1)}%</b>)}</label>
                <input
                  type="range"
                  id="hold"
                  min="0.1"
                  max="5"
                  step="0.1"
                  value={hold}
                  onChange={(e) => setHold(+e.target.value)}
                  style={{ ["--p" as string]: ((hold - 0.1) / 4.9) * 100 + "%" }}
                />
                <div className="out" id="calcOut">
                  {t.calcOut(<b>{num(daily / px)} {coin.dividendAsset}</b>, <b>{usd(daily)}</b>)}
                </div>
              </div>
              <p className="note">{t.cardNote(minHolder, deliveryCopy(config, lang))}</p>
            </div>
          </div>
          <div className="panel">
            <h3>{t.whereFee}</h3>
            <div className="split" aria-hidden="true">
              <i style={{ flex: f.holdersBps, background: "var(--red)" }} />
              <i style={{ flex: f.creatorBps, background: "var(--gold)" }} />
              <i style={{ flex: f.divvyBps, background: "var(--gold-deep)" }} />
              <i style={{ flex: f.protocolBps, background: "rgba(255,255,255,.14)" }} />
            </div>
            <div className="split-legend">
              <span><i style={{ background: "var(--red)" }} />{t.buysFor(coin.dividendAsset)}<b>{bpsLabel(f.holdersBps)}</b></span>
              <span><i style={{ background: "var(--gold)" }} />{t.creator}<b>{bpsLabel(f.creatorBps)}</b></span>
              <span><i style={{ background: "var(--gold-deep)" }} />{BRAND}<b>{bpsLabel(f.divvyBps)}</b></span>
              <span><i style={{ background: "rgba(255,255,255,.14)" }} />{t.raydiumProtocol}<b>{bpsLabel(f.protocolBps)}</b></span>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <h3>{t.meter}</h3>
              <span className={"status " + meter.status}><i />{statusLabel}</span>
            </div>
            <div className="meter-bar" aria-hidden="true">
              <i style={{ flex: meter.paid24hUsd / tot, background: "var(--red)" }} />
              <i style={{ flex: meter.pendingUsd / tot, background: "var(--gold)" }} />
            </div>
            <div className="kv"><span>{t.paid24h}</span><b>{usd(meter.paid24hUsd)}</b></div>
            <div className="kv"><span>{t.waiting}</span><b suppressHydrationWarning>{usd(meter.pendingUsd)}</b></div>
            <div className="kv"><span>{t.lastPayout}</span><b suppressHydrationWarning>{meter.lastPayoutAt ? ago(meter.lastPayoutAt) : t.firstPending}</b></div>
            <p className="note">{t.feesNote(lateMin)}</p>
          </div>
          <div className="panel">
            <h3>{t.checkAddress}</h3>
            <p className="note">
              {t.checkNote(coin.ticker, <b>{short(coin.mint)}</b>)}
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
