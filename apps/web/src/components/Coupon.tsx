"use client";

import { usd } from "@divvy/shared";
import { useMsgs } from "@/i18n/client";
import { board } from "@/i18n/msgs/board";
import { Chip } from "./Chip";

/** The foil "Pays in" stub on every card (prototype `coupon`). */
export function Coupon({ pays, paidUsd, holders }: { pays: string; paidUsd: number; holders: number }) {
  const t = useMsgs(board);
  return (
    <div className="coupon">
      <div className="stub">
        <Chip sym={pays} />
        <div>
          <small>{t.paysIn}</small>
          <strong>{pays}</strong>
        </div>
      </div>
      <div className="vals">
        <div>
          <b className="cash">{usd(paidUsd)}</b>{t.paidOut}
        </div>
        <div>
          <b>{holders.toLocaleString("en-US")}</b>{t.holders}
        </div>
      </div>
    </div>
  );
}
