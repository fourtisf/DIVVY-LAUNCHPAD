import { usd } from "@divvy/shared";
import { Chip } from "./Chip";

/** The foil "Pays in" stub on every card (prototype `coupon`). */
export function Coupon({ pays, paidUsd, holders }: { pays: string; paidUsd: number; holders: number }) {
  return (
    <div className="coupon">
      <div className="stub">
        <Chip sym={pays} />
        <div>
          <small>Pays in</small>
          <strong>{pays}</strong>
        </div>
      </div>
      <div className="vals">
        <div>
          <b className="cash">{usd(paidUsd)}</b>paid out
        </div>
        <div>
          <b>{holders.toLocaleString("en-US")}</b>holders
        </div>
      </div>
    </div>
  );
}
