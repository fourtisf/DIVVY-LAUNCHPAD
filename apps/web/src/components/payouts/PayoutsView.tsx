"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { num, short, usd, usdFull, type PayoutList } from "@divvy/shared";
import { qs } from "@/lib/api";
import { useAssets, useConfig } from "@/lib/config";
import { deliveryCopy } from "@/lib/copy";
import { useAgo, useLang, useMsgs } from "@/i18n/client";
import { payouts } from "@/i18n/msgs/payouts";
import { Chip } from "../Chip";
import { Countdown } from "../Countdown";
import { coinHref } from "@/lib/links";

export function PayoutsView({ initial, assetsInUse, nextRoundAt }: { initial: PayoutList; assetsInUse: string[]; nextRoundAt: string }) {
  const assets = useAssets();
  const t = useMsgs(payouts);
  const ago = useAgo();
  const [lang] = useLang();
  const copy = deliveryCopy(useConfig(), lang);
  const [filter, setFilter] = useState("all");
  const key = "/api/payouts" + qs({ asset: filter === "all" ? null : filter, limit: 60 });
  // A stock filter shows its own receipts or says it's loading: never the unfiltered list under its chip (audit).
  const { data, error } = useSWR<PayoutList>(key, { fallbackData: filter === "all" ? initial : undefined, keepPreviousData: false });
  const s = (data ?? initial).summary;
  return (
    <>
      <h1 className="page-h">{t.title}</h1>
      <p className="page-lede">{t.lede(copy.payoutsLedeVerb)}</p>
      <div className="tiles">
        <div><b className="up">{usdFull(s.paidUsd)}</b><span>{t.tilePaid}</span></div>
        <div><b>{s.rounds.toLocaleString("en-US")}</b><span>{t.tileRounds}</span></div>
        <div><b>{s.walletPayments.toLocaleString("en-US")}</b><span>{t.tileWallets}</span></div>
        <div><b suppressHydrationWarning>{usdFull(s.pendingUsd)}</b><span>{t.tilePending}</span></div>
      </div>
      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h">
          <h3>{t.meter}</h3>
          <span className={"status " + (s.status === "late" ? "late" : "ok")}>
            <i />
            {s.status === "late" ? t.late(s.lateCoins) : t.onTime}
          </span>
        </div>
        <div className="meter-bar">
          <i style={{ flex: s.paidUsd, background: "var(--g)" }} />
          <i style={{ flex: s.pendingUsd, background: "var(--teal)" }} />
        </div>
        <div className="legend">
          <span><i style={{ background: "var(--g)" }} />{t.legendPaid}</span>
          <span><i style={{ background: "var(--teal)" }} />{t.legendWaiting(<Countdown nextAt={nextRoundAt} />)}</span>
          <span><i style={{ background: "var(--red)" }} />{t.legendLate}</span>
        </div>
      </div>
      <div className="panel" style={{ marginBottom: 80 }}>
        <div className="panel-h" style={{ flexWrap: "wrap" }}>
          <h3>{t.receipts}</h3>
          <div className="pays-filter" role="group" aria-label={t.filterLabel}>
            <button type="button" className="fchip all" aria-pressed={filter === "all"} onClick={() => setFilter("all")}>{t.all}</button>
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
            <thead><tr><th>{t.colCoin}</th><th>{t.colWhen}</th><th className="r">{t.colPaid}</th><th className="r">{t.colValue}</th><th className="r">{t.colWallets}</th><th className="r">{t.colTx}</th></tr></thead>
            <tbody id="rcpt">
              {!data && (
                <tr>
                  <td colSpan={6} className="faint">{error ? t.loadError : t.loading}</td>
                </tr>
              )}
              {data?.items.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={coinHref(p.coin)} style={{ display: "flex", gap: 10, alignItems: "center", whiteSpace: "nowrap", fontWeight: 500 }}>
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
