"use client";

import Link from "next/link";
import { agoMin, pct, usd } from "@divvy/shared";
import { Coupon } from "./Coupon";
import { Spark } from "./Spark";

export interface CardCoin {
  name: string;
  ticker: string;
  imageUrl: string;
  pays: string;
  mcap: number;
  ch: number;
  /** Minutes since launch. */
  ageMin: number;
  creatorLabel: string;
  progress: number;
  graduated: boolean;
  paidUsd: number;
  holders: number;
  spark: number[];
}

/** Board card (prototype `card`). `asDiv` renders the create-page preview, which isn't a link. */
export function CoinCard({ c, asDiv = false }: { c: CardCoin; asDiv?: boolean }) {
  const isNew = c.ageMin < 20;
  const body = (
    <>
      <div className="card-top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={c.imageUrl} alt="" width={60} height={60} loading="lazy" />
        <div style={{ minWidth: 0 }}>
          <div className="card-name">{c.name}</div>
          <div className="card-sub">
            <span className="tk">${c.ticker}</span>
            {isNew && <span className="badge badge-new">New</span>}
            {c.graduated && <span className="badge badge-grad">Graduated</span>}
          </div>
          <div className="card-sub" suppressHydrationWarning>
            {agoMin(c.ageMin)} by {c.creatorLabel}
          </div>
        </div>
      </div>
      <div className="card-mid">
        <div>
          <div className="mcap-l">Market cap</div>
          <div className="mcap">{usd(c.mcap)}</div>
        </div>
        <div className="mid-r">
          {c.ageMin < 10 ? null : <Spark data={c.spark} up={c.ch >= 0} id={c.ticker} />}
          <span className={"chg " + (c.ch >= 0 ? "up" : "down")}>{pct(c.ch)}</span>
        </div>
      </div>
      {c.graduated ? null : (
        <div>
          <div className="bar-row">
            <span>Bonding curve</span>
            <span>{Math.round(c.progress * 100)}%</span>
          </div>
          <div className="bar">
            <i style={{ width: (c.progress * 100).toFixed(1) + "%" }} />
          </div>
        </div>
      )}
      <Coupon pays={c.pays} paidUsd={c.paidUsd} holders={c.holders} />
    </>
  );
  return asDiv ? (
    <div className="card tilt">{body}</div>
  ) : (
    <Link className="card tilt" href={`/coin/${encodeURIComponent(c.ticker)}`}>
      {body}
    </Link>
  );
}
