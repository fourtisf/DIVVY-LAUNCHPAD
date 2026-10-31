"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "@/components/Icon";
import { useMsgs } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";
import { coinMsgs } from "@/i18n/msgs/coin";

/** Shown the moment a coin card is clicked, while the server loads the coin, so the click never looks ignored. */
export default function CoinLoading() {
  const { ticker } = useParams<{ ticker: string }>();
  const m = useMsgs(coinMsgs);
  const tc = useMsgs(common);
  const KPIS = [m.kpiMcap, m.kpiChange, m.kpiVolume, m.kpiHolders, m.kpiPaid];
  // Links carry the mint (coins can share a ticker); an old ticker link still shows its ticker.
  const t = decodeURIComponent(ticker ?? "");
  const label = t && t.length <= 12 ? `$${t}` : m.coinFallback;
  return (
    <div aria-busy="true">
      <Link className="back" href="/"><Icon name="back" />{tc.backToBoard}</Link>
      <div className="chead">
        <div className="skel skel-coin" />
        <div style={{ minWidth: 0 }}>
          <h1>{label}</h1>
          <div className="meta">{m.loading}</div>
        </div>
      </div>
      <div className="panel kpis">
        {KPIS.map((k) => (
          <div key={k}>
            <span>{k}</span>
            <b className="skel skel-line" />
          </div>
        ))}
      </div>
      <div className="skel skel-panel" />
    </div>
  );
}
