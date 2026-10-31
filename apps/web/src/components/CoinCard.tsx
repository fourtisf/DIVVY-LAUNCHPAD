"use client";

import Link from "next/link";
import { pct, usd } from "@divvy/shared";
import { useMsgs } from "@/i18n/client";
import { board } from "@/i18n/msgs/board";
import { common } from "@/i18n/msgs/common";
import { Coupon } from "./Coupon";
import { Spark } from "./Spark";
import { coinHref } from "@/lib/links";
import { shareLabel } from "@/lib/devbuy";

export interface CardCoin {
  name: string;
  ticker: string;
  /** Links the card to this coin's page; coins can share a ticker. */
  mint?: string;
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
  /** Share of supply the creator bought in the create (owner decision 2026-10-28); 0 or absent for none. */
  devBuyPct?: number;
}

/** Board card (prototype `card`). `asDiv` renders the create-page preview, which isn't a link. */
export function CoinCard({ c, asDiv = false }: { c: CardCoin; asDiv?: boolean }) {
  const t = useMsgs(board);
  const ago = useMsgs(common).ago;
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
            {isNew && <span className="badge badge-new">{t.badgeNew}</span>}
            {c.graduated && <span className="badge badge-grad">{t.badgeGraduated}</span>}
            {c.devBuyPct ? (
              <span className="badge badge-dev" title={t.devBadgeTitle(shareLabel(c.devBuyPct))}>
                {t.devBadge(shareLabel(c.devBuyPct))}
              </span>
            ) : null}
          </div>
          <div className="card-sub" suppressHydrationWarning>
            {t.agoBy(ago(c.ageMin), c.creatorLabel)}
          </div>
        </div>
      </div>
      <div className="card-mid">
        <div>
          <div className="mcap-l">{t.marketCap}</div>
          <div className="mcap">{usd(c.mcap)}</div>
        </div>
        <div className="mid-r">
          {c.ageMin < 10 ? null : <Spark data={c.spark} up={c.ch >= 0} id={c.mint ?? c.ticker} />}
          <span className={"chg " + (c.ch >= 0 ? "up" : "down")}>{pct(c.ch)}</span>
        </div>
      </div>
      {c.graduated ? null : (
        <div>
          <div className="bar-row">
            <span>{t.bondingCurve}</span>
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
    <Link className="card tilt" href={coinHref(c)}>
      {body}
    </Link>
  );
}
