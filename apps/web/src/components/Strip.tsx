"use client";

import { num, type LiveEvent } from "@divvy/shared";
import { useAgo, useMsgs } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";

/** Live activity marquee (prototype `renderStrip`). The list is doubled for a seamless loop. */
export function Strip({ events }: { events: LiveEvent[] }) {
  const t = useMsgs(common);
  const ago = useAgo();
  const render = (hidden: boolean) =>
    events.map((e, i) => {
      const key = (hidden ? "h" : "v") + i;
      const common = { className: "ev", ...(hidden ? { "aria-hidden": true } : {}) };
      // eslint-disable-next-line @next/next/no-img-element
      const img = "imageUrl" in e ? <img src={e.imageUrl} alt="" /> : null;
      switch (e.type) {
        case "payout_round":
          return (
            <span key={key} {...common}>
              {img}{t.stripPaid(e.ticker)} <span className="amt">{num(e.amount.ui)} {e.assetSymbol}</span>
            </span>
          );
        case "launch":
          return (
            <span key={key} {...common} suppressHydrationWarning>
              {img}
              <b>${e.ticker}</b> {t.stripLaunched(ago(e.at))}
            </span>
          );
        case "graduate":
          return (
            <span key={key} {...common}>
              {img}
              <b>${e.ticker}</b> {t.stripGraduated}
            </span>
          );
        default:
          return null;
      }
    });
  return (
    <div className="strip" aria-label={t.liveActivity}>
      <div className="strip-track" id="strip">
        {render(false)}
        {render(true)}
      </div>
    </div>
  );
}
