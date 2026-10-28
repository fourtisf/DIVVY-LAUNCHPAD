"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  ago,
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
import { Chip } from "../Chip";
import { CoinFlip3D } from "../Coin3D";
import { Countdown } from "../Countdown";
import { Icon } from "../Icon";
import { useToast } from "../Toasts";
import { CandleChart } from "./CandleChart";
import { ReportButton } from "./ReportButton";
import { TradeBox } from "./TradeBox";
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
  const statusLabel = meter.status === "late" ? "Late" : meter.status === "carried" ? "Carried to next round" : "On time";

  const copyCa = () => {
    navigator.clipboard?.writeText(coin.mint).catch(() => {});
    toast("Contract address copied");
  };

  return (
    <>
      <Link className="back" href="/"><Icon name="back" />Back to the board</Link>
      <div className="coin-head">
        <CoinFlip3D src={coin.imageUrl} back={s} label={"$" + coin.ticker} title={`Front: $${coin.ticker}. Back: ${coin.dividendAsset}`} />
        <div style={{ minWidth: 0 }}>
          <h1>
            {coin.name}
            <span className="t">${coin.ticker}</span>
          </h1>
          <div className="sub">
            <span suppressHydrationWarning>Created by {coin.creator.label} {ago(coin.createdAt)}</span>
            <button className="ca" type="button" id="copyCa" title="Copy contract address" onClick={copyCa}>
              <Icon name="copy" />
              {short(coin.mint)}
            </button>
            <span className="tag"><Icon name="shield" />Private bundle launch</span>
            <span className="tag" id="devBuyTag" title={coin.devBuyPct ? `The creator bought ${shareLabel(coin.devBuyPct)} of the supply inside the create` : "The creator didn't buy any in the create"}>
              <Icon name="gift" />
              {coin.devBuyPct ? `Dev bought ${shareLabel(coin.devBuyPct)}` : "No dev buy"}
            </span>
            <ReportButton mint={coin.mint} ticker={coin.ticker} />
          </div>
        </div>
      </div>

      <div className="kpis">
        <div><span>Market cap</span><b className="up">{usd(coin.marketCapUsd)}</b></div>
        <div><span>24h change</span><b className={coin.change24hPct >= 0 ? "up" : "down"}>{pct(coin.change24hPct)}</b></div>
        <div><span>24h volume</span><b>{usd(coin.volume24hUsd)}</b></div>
        <div><span>Holders</span><b>{coin.holders.toLocaleString("en-US")}</b></div>
        <div><span>Paid to holders</span><b className="up">{usd(coin.paidUsd)}</b></div>
      </div>

      <div className="coin-grid">
        <div className="stack">
          <div className="panel">
            <div className="chart-head">
              <div className="tf" role="group" aria-label="Candle size">
                {INTERVALS.map((t) => (
                  <button type="button" key={t.tf} aria-pressed={tf === t.tf} onClick={() => setTf(t.tf)}>{t.label}</button>
                ))}
              </div>
              <div className="tf" role="group" aria-label="Chart of">
                <button type="button" aria-pressed={unit === "price"} onClick={() => setUnit("price")}>Price</button>
                <button type="button" aria-pressed={unit === "mcap"} onClick={() => setUnit("mcap")}>Market cap</button>
              </div>
            </div>
            <CandleChart
              candles={candles}
              solUsd={config.quote.priceUsd}
              payoutHours={payoutHours}
              label={`${unit === "price" ? "Price" : "Market cap"} chart for $${coin.ticker}`}
            />
            <div className="legend">
              <span>Market cap all-time high {usd(coin.athUsd)}</span>
              <span><i style={{ background: "var(--teal)" }} />Hourly payout to holders</span>
            </div>
          </div>
          <div className="panel">
            <div className="tabs" role="tablist">
              {(["payouts", "holders", "trades"] as const).map((k) => (
                <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                  {k[0]!.toUpperCase() + k.slice(1)}
                </button>
              ))}
            </div>
            <div id="tabBody" className="table-scroll">
              {tab === "payouts" &&
                (payouts?.items.length ? (
                  <table className="t">
                    <thead><tr><th>When</th><th className="r">Paid</th><th className="r">Value</th><th className="r">Wallets</th><th className="r">Tx</th></tr></thead>
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
                    No payout yet. The first round runs at the top of the hour, <b><Countdown nextAt={meter.nextRoundAt} /></b> from now, for every wallet holding at least {minHolder}.
                  </p>
                ))}
              {tab === "holders" && holders && (
                <table className="t">
                  <thead><tr><th>Wallet</th><th className="r">Share</th><th className="r">Received</th></tr></thead>
                  <tbody>
                    {holders.items.map((h) => (
                      <tr key={h.wallet}>
                        <td>
                          {h.excluded ? (
                            <>
                              {h.label ?? short(h.wallet)} <span className="faint" style={{ fontSize: 12 }}>not paid</span>
                            </>
                          ) : (
                            short(h.wallet)
                          )}
                        </td>
                        <td className="r">{h.pct.toFixed(2)}%</td>
                        <td className={"r " + (h.excluded ? "faint" : "up")}>{h.excluded || !h.received ? "n/a" : num(h.received.ui) + " " + coin.dividendAsset}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {tab === "trades" &&
                trades &&
                (trades.items.length ? (
                  <table className="t">
                    <thead><tr><th>When</th><th>Side</th><th className="r">${coin.ticker}</th><th className="r">SOL</th><th className="r">Wallet</th></tr></thead>
                    <tbody>
                      {/* One transaction can hold several trades of a coin: keyed by signature and which one it is. */}
                      {trades.items.map((t, i, all) => (
                        <tr key={`${t.sig}:${all.slice(0, i).filter((x) => x.sig === t.sig).length}`}>
                          <td>{ago(t.ts)}</td>
                          <td className={"side-" + t.side}>{t.side}</td>
                          <td className="r">{num(t.token.ui)}</td>
                          <td className="r">{t.sol.ui.toFixed(3)}</td>
                          <td className="r">{short(t.wallet)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="muted" style={{ padding: "20px 4px 6px", margin: 0 }}>No trades yet. The first buyer gets the lowest price on the curve.</p>
                ))}
            </div>
          </div>
        </div>

        <aside className="stack">
          <TradeBox coin={coin} />
          <div className="foil-card">
            <div className="foil-top">
              <Chip sym={coin.dividendAsset} />
              <div>
                <small>Holders are paid in</small>
                <strong>{coin.dividendAsset}</strong>
              </div>
              <div className="cd">
                <small>Next payout</small>
                <b><Countdown nextAt={meter.nextRoundAt} /></b>
              </div>
            </div>
            <div className="foil-body">
              <div className="paid-row">
                <div>
                  <div className="faint" style={{ fontSize: 12.5, marginBottom: 6 }}>Paid out so far</div>
                  <b>{num(coin.paid.ui)} {coin.dividendAsset}</b>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div className="faint" style={{ fontSize: 12.5 }}>Worth</div>
                  <div style={{ fontSize: 18, fontWeight: 700 }} className="up">{usd(coin.paidUsd)}</div>
                </div>
              </div>
              <div className="calc">
                <label htmlFor="hold">If you hold <b id="holdPct">{hold.toFixed(1)}%</b> of supply</label>
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
                  At today&apos;s volume you&apos;d receive about <b>{num(daily / px)} {coin.dividendAsset}</b> a day, worth <b>{usd(daily)}</b>.
                </div>
              </div>
              <p className="note">Wallets holding at least {minHolder} at the hourly snapshot are {deliveryCopy(config).cardNoteVerb}. The curve, the pool and the launcher wallet are left out.</p>
            </div>
          </div>
          <div className="panel">
            <h3>Where the fee goes</h3>
            <div className="split" aria-hidden="true">
              <i style={{ flex: f.holdersBps, background: "var(--g)" }} />
              <i style={{ flex: f.creatorBps, background: "var(--teal)" }} />
              <i style={{ flex: f.divvyBps, background: "var(--lime)" }} />
              <i style={{ flex: f.protocolBps, background: "rgba(255,255,255,.14)" }} />
            </div>
            <div className="split-legend">
              <span><i style={{ background: "var(--g)" }} />Buys {coin.dividendAsset} for holders<b>{bpsLabel(f.holdersBps)}</b></span>
              <span><i style={{ background: "var(--teal)" }} />Creator<b>{bpsLabel(f.creatorBps)}</b></span>
              <span><i style={{ background: "var(--lime)" }} />uspad<b>{bpsLabel(f.divvyBps)}</b></span>
              <span><i style={{ background: "rgba(255,255,255,.14)" }} />Raydium protocol<b>{bpsLabel(f.protocolBps)}</b></span>
            </div>
          </div>
          <div className="panel">
            <div className="panel-h">
              <h3>Payout meter</h3>
              <span className={"status " + meter.status}><i />{statusLabel}</span>
            </div>
            <div className="meter-bar" aria-hidden="true">
              <i style={{ flex: meter.paid24hUsd / tot, background: "var(--g)" }} />
              <i style={{ flex: meter.pendingUsd / tot, background: "var(--teal)" }} />
            </div>
            <div className="kv"><span>Paid to holders, last 24h</span><b>{usd(meter.paid24hUsd)}</b></div>
            <div className="kv"><span>Waiting for the next round</span><b suppressHydrationWarning>{usd(meter.pendingUsd)}</b></div>
            <div className="kv"><span>Last payout</span><b suppressHydrationWarning>{meter.lastPayoutAt ? ago(meter.lastPayoutAt) : "First round pending"}</b></div>
            <p className="note">Fees sit in this coin&apos;s own on-chain vault until the hourly round. A round more than {lateMin} minutes late turns this red for everyone.</p>
          </div>
          <div className="panel">
            <h3>Check the address</h3>
            <p className="note">
              Coins on uspad can share a ticker, a name, a picture and an X account. This ${coin.ticker} is <b>{short(coin.mint)}</b>: compare it with the address the project posts before you buy.
            </p>
          </div>
        </aside>
      </div>
    </>
  );
}
