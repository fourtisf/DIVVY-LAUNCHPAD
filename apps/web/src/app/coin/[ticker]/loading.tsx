"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "@/components/Icon";

const KPIS = ["Market cap", "24h change", "24h volume", "Holders", "Paid to holders"];

/** Shown the moment a coin card is clicked, while the server loads the coin, so the click never looks ignored. */
export default function CoinLoading() {
  const { ticker } = useParams<{ ticker: string }>();
  // Links carry the mint (coins can share a ticker); an old ticker link still shows its ticker.
  const t = decodeURIComponent(ticker ?? "");
  const label = t && t.length <= 12 ? `$${t}` : "Coin";
  return (
    <div aria-busy="true">
      <Link className="back" href="/"><Icon name="back" />Back to the board</Link>
      <div className="coin-head">
        <div className="coin3d"><div className="skel skel-coin" /></div>
        <div style={{ minWidth: 0 }}>
          <h1>{label}</h1>
          <div className="sub">Loading the coin…</div>
        </div>
      </div>
      <div className="kpis">
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
