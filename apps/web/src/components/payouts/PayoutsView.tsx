"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { ago, num, short, usd, usdFull, type PayoutList } from "@divvy/shared";
import { qs } from "@/lib/api";
import { useAssets, useConfig } from "@/lib/config";
import { deliveryCopy } from "@/lib/copy";
import { Chip } from "../Chip";
import { Countdown } from "../Countdown";

export function PayoutsView({ initial, assetsInUse, nextRoundAt }: { initial: PayoutList; assetsInUse: string[]; nextRoundAt: string }) {
  const assets = useAssets();
  const copy = deliveryCopy(useConfig());
  const [filter, setFilter] = useState("all");
  const key = "/api/payouts" + qs({ asset: filter === "all" ? null : filter, limit: 60 });
  const { data = initial } = useSWR<PayoutList>(key, { fallbackData: filter === "all" ? initial : undefined });
  const s = data.summary;
  return (
    <>
      <h1 className="page-h">Payouts</h1>
      <p className="page-lede">Every hour each coin&apos;s vault buys its stock and {copy.payoutsLedeVerb} holders. These are the receipts, newest first. Each one is a transaction you can open.</p>
      <div className="tiles">
        <div><b className="up">{usdFull(s.paidUsd)}</b><span>Paid to holders</span></div>
        <div><b>{s.rounds.toLocaleString("en-US")}</b><span>Payout rounds</span></div>
        <div><b>{s.walletPayments.toLocaleString("en-US")}</b><span>Wallet payments</span></div>
        <div><b suppressHydrationWarning>{usdFull(s.pendingUsd)}</b><span>Waiting for the next round</span></div>
      </div>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h">
          <h3>Payout meter, all coins</h3>
          <span className={"status " + (s.status === "late" ? "late" : "ok")}>
            <i />
            {s.status === "late" ? `${s.lateCoins} ${s.lateCoins === 1 ? "coin is" : "coins are"} late` : "Every coin on time"}
          </span>
        </div>
        <div className="meter-bar">
          <i style={{ flex: s.paidUsd, background: "var(--g)" }} />
          <i style={{ flex: s.pendingUsd, background: "var(--teal)" }} />
        </div>
        <div className="legend">
          <span><i style={{ background: "var(--g)" }} />Paid</span>
          <span><i style={{ background: "var(--teal)" }} />Waiting, next round in&nbsp;<b><Countdown nextAt={nextRoundAt} /></b></span>
          <span><i style={{ background: "var(--red)" }} />Late, shown per coin</span>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 80 }}>
        <div className="panel-h" style={{ flexWrap: "wrap" }}>
          <h3>Receipts</h3>
          <div className="pays-filter" role="group" aria-label="Filter receipts by stock">
            <button type="button" className="fchip all" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>All</button>
            {assetsInUse.filter((a) => assets[a]).map((a) => (
              <button type="button" className="fchip" key={a} aria-pressed={filter === a} onClick={() => setFilter(a)}>
                <Chip sym={a} />
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="table-scroll">
          <table className="t">
            <thead><tr><th>Coin</th><th>When</th><th className="r">Paid</th><th className="r">Value</th><th className="r">Wallets</th><th className="r">Tx</th></tr></thead>
            <tbody id="rcpt">
              {data.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/coin/${encodeURIComponent(p.coin.ticker)}`} style={{ display: "flex", gap: 10, alignItems: "center", whiteSpace: "nowrap", fontWeight: 500 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.coin.imageUrl} alt="" width={26} height={26} style={{ borderRadius: 8 }} />${p.coin.ticker}
                    </Link>
                  </td>
                  <td style={{ whiteSpace: "nowrap" }} suppressHydrationWarning>{ago(p.hour)}</td>
                  <td className="r up" style={{ whiteSpace: "nowrap" }}>{num(p.amount.ui)} {p.assetSymbol}</td>
                  <td className="r">{usd(p.usd)}</td>
                  <td className="r">{p.wallets}</td>
                  <td className="r"><span className="tx">{p.sig ? short(p.sig) : ""}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
