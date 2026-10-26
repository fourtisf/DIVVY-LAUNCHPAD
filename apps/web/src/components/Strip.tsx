"use client";

import { ago, num, type LiveEvent } from "@divvy/shared";

/** Live activity marquee (prototype `renderStrip`). The list is doubled for a seamless loop. */
export function Strip({ events }: { events: LiveEvent[] }) {
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
              {img}${e.ticker} holders received <span className="amt">{num(e.amount.ui)} {e.assetSymbol}</span>
            </span>
          );
        case "launch":
          return (
            <span key={key} {...common} suppressHydrationWarning>
              {img}
              <b>${e.ticker}</b> launched {ago(e.at)}
            </span>
          );
        case "graduate":
          return (
            <span key={key} {...common}>
              {img}
              <b>${e.ticker}</b> graduated to Raydium
            </span>
          );
        default:
          return null;
      }
    });
  return (
    <div className="strip" aria-label="Live activity">
      <div className="strip-track" id="strip">
        {render(false)}
        {render(true)}
      </div>
    </div>
  );
}
