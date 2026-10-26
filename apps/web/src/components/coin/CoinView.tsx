"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";
import {
  ago,
  bpsLabel,
  leetExamples,
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
import { Chip } from "../Chip";
import { CoinFlip3D } from "../Coin3D";
import { Countdown } from "../Countdown";
import { Icon } from "../Icon";
import { useToast } from "../Toasts";
import { Chart } from "./Chart";
import { TradeBox } from "./TradeBox";

type List<T> = { items: T[]; nextCursor?: string | null };

const TF_LABELS = ["1h", "6h", "24h", "All"] as const;

/** Chart timeframe → candle query. "All" picks a bucket size from the coin's age. */
function candleQuery(tf: (typeof TF_LABELS)[number], ageMin: number): { tf: CandleTf; limit: number } {
  if (tf === "1h") return { tf: "1m", limit: 60 };
  if (tf === "6h") return { tf: "5m", limit: 72 };
  if (tf === "24h") return { tf: "5m", limit: 288 };
  if (ageMin <= 180) return { tf: "1m", limit: 180 };
  if (ageMin <= 1440) return { tf: "5m", limit: 288 };
  return { tf: "1h", limit: 1000 };
}

export function CoinView({ coin, initialMeter, initialPayouts }: { coin: CoinDetail; initialMeter: Meter; initialPayouts: List<PayoutRound> }) {
  const config = useConfig();
  const assets = useAssets();
  const toast = useToast();
  const s = assets[coin.dividendAsset];
  const px = s?.priceUsd ?? 1;
  const ageMin = minutesSince(coin.createdAt);
  const m = coin.mint;

  const [tf, setTf] = useState<(typeof TF_LABELS)[number]>("All");
  const cq = candleQuery(tf, ageMin);
  const { data: candles } = useSWR<CandleList>(`/api/coins/${m}/candles` + qs({ tf: cq.tf, unit: "mcap", limit: cq.limit }));
  const chartData = useMemo(() => (candles?.items ?? []).map((c) => ({ t: c.t, v: c.c })), [candles]);

  const [tab, setTab] = useState<"payouts" | "holders" | "trades">("payouts");
  const { data: payouts } = useSWR<List<PayoutRound>>(`/api/coins/${m}/payouts?limit=10`, { fallbackData: initialPayouts });
  const { data: holders } = useSWR<List<Holder>>(tab === "holders" ? `/api/coins/${m}/holders` : null);
  const { data: trades } = useSWR<List<Trade>>(tab === "trades" ? `/api/coins/${m}/trades?limit=24` : null);
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
            <span className="tag"><Icon name="lock" />Ticker locked forever</span>
            <span className="tag"><Icon name="shield" />Private bundle launch</span>
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
              <div className="faint" style={{ fontSize: 13 }}>Market cap, all-time high {usd(coin.athUsd)}</div>
              <div className="tf" role="group" aria-label="Time frame">
                {TF_LABELS.map((t) => (
                  <button type="button" key={t} aria-pressed={tf === t} onClick={() => setTf(t)}>{t}</button>
                ))}
              </div>
            </div>
            <Chart data={chartData} ticks={ageMin >= 60} label={`Market cap chart for $${coin.ticker}`} />
            <div className="legend">
              <span><i style={{ background: "var(--g)" }} />Market cap</span>
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
                      {trades.items.map((t) => (
                        <tr key={t.sig}>
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
              <p className="note">Wallets holding at least {minHolder} at the hourly snapshot are paid. The curve, the pool and the launcher wallet are left out.</p>
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
              <span><i style={{ background: "var(--lime)" }} />Divvy<b>{bpsLabel(f.divvyBps)}</b></span>
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
            <h3>Copy protection</h3>
            <ul className="checks">
              <li><span className="ck ok"><Icon name="check" size={13} /></span><div>${coin.ticker} is taken here forever<small>Lookalikes like {leetExamples(coin.ticker)} are refused</small></div></li>
              <li><span className="ck ok"><Icon name="check" size={13} /></span><div>The name can&apos;t be reused<small>Adding “official” or a “2” doesn&apos;t get through</small></div></li>
              <li><span className="ck ok"><Icon name="check" size={13} /></span><div>The picture is fingerprinted<small>Resized or recolored copies are refused</small></div></li>
              <li><span className="ck ok"><Icon name="check" size={13} /></span><div>{coin.creator.xHandle ? "@" + coin.creator.xHandle : "No X account"} owns this coin<small>One coin per X account</small></div></li>
            </ul>
          </div>
        </aside>
      </div>
    </>
  );
}
