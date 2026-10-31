"use client";

import Link from "next/link";
import { pct, usd } from "@divvy/shared";
import { Chip } from "./Chip";
import { coinHref } from "@/lib/links";
import { shareLabel } from "@/lib/devbuy";
import { useMsgs } from "@/i18n/client";
import { board } from "@/i18n/msgs/board";
import { common } from "@/i18n/msgs/common";

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

/**
 * A coin as an envelope card (prototype `.lcard`): the create page's preview and the list of coins that
 * share a ticker. `asDiv` renders the preview, which isn't a link.
 */
export function CoinCard({ c, asDiv = false }: { c: CardCoin; asDiv?: boolean }) {
  const t = useMsgs(board);
  const ago = useMsgs(common).ago;
  const isNew = c.ageMin < 20;
  const body = (
    <>
      <div className="top">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="av" src={c.imageUrl} alt="" width={44} height={44} loading="lazy" style={{ width: 44, height: 44, borderRadius: 12, objectFit: "cover" }} />
        <div style={{ minWidth: 0 }}>
          <div className="nm">{c.name}</div>
          <div className="tk" suppressHydrationWarning>${c.ticker} · {t.agoBy(ago(c.ageMin), c.creatorLabel)}</div>
        </div>
        {isNew ? <span className="badge new">{t.badgeNew}</span> : c.graduated ? <span className="badge grad">{t.badgeGraduated}</span> : null}
      </div>
      <div className="bd">
        <div className="stat">
          <b className="num">{usd(c.mcap)}</b>
          <span>
            {t.marketCap} <span className={"chg " + (c.ch >= 0 ? "up" : "down")}>{pct(c.ch)}</span>
            {c.devBuyPct ? <><br /><span title={t.devBadgeTitle(shareLabel(c.devBuyPct))}>{t.devBadge(shareLabel(c.devBuyPct))}</span></> : null}
          </span>
        </div>
        {c.graduated ? null : (
          <div>
            <div className="bar-row" style={{ margin: "0 0 6px" }}>
              <span>{t.bondingCurve}</span>
              <span>{Math.round(c.progress * 100)}%</span>
            </div>
            <div className="bar"><i style={{ width: (c.progress * 100).toFixed(1) + "%" }} /></div>
          </div>
        )}
        <div className="pays">
          <strong><Chip sym={c.pays} />{c.pays}</strong>
          <span className="tab">{usd(c.paidUsd)} {t.paidOut} · {c.holders.toLocaleString("en-US")} {t.holders}</span>
        </div>
      </div>
    </>
  );
  return asDiv ? (
    <div className="lcard">{body}</div>
  ) : (
    <Link className="lcard" href={coinHref(c)}>
      {body}
    </Link>
  );
}
