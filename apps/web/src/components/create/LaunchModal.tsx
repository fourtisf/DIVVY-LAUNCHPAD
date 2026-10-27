"use client";

import { useEffect, useState } from "react";
import {
  short,
  usd,
  type CoinDetail,
  type LaunchStatus,
  type LaunchStep,
} from "@divvy/shared";
import { api } from "@/lib/api";
import { useAssets, useConfig } from "@/lib/config";
import { CoinSpin3D } from "../Coin3D";
import { Icon } from "../Icon";
import { useToast } from "../Toasts";

const STEPS = [
  "Checking ticker, name and X account",
  "Sending the create in a private bundle",
  "Live on chain",
  "On the board",
];
const STEP_INDEX: Record<LaunchStep, number> = {
  checking: 0,
  bundling: 1,
  landed: 2,
  indexed: 4,
  failed: -1,
};

/**
 * The 4-step launch modal, driven by GET /api/launch/:id (HANDOFF §11 Phase 2). Once the coin is on the
 * board it says so, with its mint and market cap, and waits for the creator: open the coin page, look it
 * up on Solscan, or launch another (owner request 2026-10-27).
 */
export function LaunchModal({
  launchId,
  ticker,
  img,
  pays,
  onDone,
  onAnother,
}: {
  launchId: string;
  ticker: string;
  img: string;
  pays: string;
  onDone: (s: LaunchStatus) => void;
  onAnother: () => void;
}) {
  const back = useAssets()[pays];
  const config = useConfig();
  const toast = useToast();
  const [k, setK] = useState(0);
  const [live, setLive] = useState<{
    status: LaunchStatus;
    mcapUsd: number | null;
  } | null>(null);

  useEffect(() => {
    let stop = false;
    let t: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const s = await api<LaunchStatus>(`/api/launch/${launchId}`);
        if (stop) return;
        const i = STEP_INDEX[s.step];
        if (i < 0) return onDone(s);
        setK(i);
        if (i >= STEPS.length) {
          const coin = await api<CoinDetail>(
            `/api/coins/${encodeURIComponent(s.ticker)}`,
          ).catch(() => null);
          if (!stop)
            setLive({ status: s, mcapUsd: coin?.marketCapUsd ?? null });
          return;
        }
      } catch {
        /* keep polling; the launch keeps going server-side */
      }
      t = setTimeout(poll, 400);
    };
    void poll();
    return () => {
      stop = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launchId]);

  return (
    <div
      className="modal-bg on"
      id="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modalTitle"
    >
      <div className="modal" id="modalBody">
        <CoinSpin3D src={img} back={back} label={"$" + ticker} />
        {live ? (
          <div className="in">
            <h2 id="modalTitle">${ticker} is live</h2>
            <p>Its holders get {pays} every hour from its trading fees.</p>
            <div className="kv">
              <span>Market cap</span>
              <b>{live.mcapUsd === null ? "…" : usd(live.mcapUsd)}</b>
            </div>
            <div className="kv">
              <span>Pays holders in</span>
              <b>{pays}</b>
            </div>
            {live.status.mint && (
              <div className="kv">
                <span>Mint</span>
                <b>
                  <button
                    type="button"
                    className="mint-copy"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(live.status.mint!)
                        .then(
                          () => toast("Mint address copied"),
                          () => toast(live.status.mint!),
                        )
                    }
                  >
                    {short(live.status.mint)} <Icon name="copy" size={13} />
                  </button>
                </b>
              </div>
            )}
            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-g btn-lg"
                onClick={() => onDone(live.status)}
              >
                Open coin page
              </button>
              {live.status.mint && (
                <a
                  className="btn btn-ghost"
                  href={`https://solscan.io/token/${live.status.mint}${config.network === "devnet" ? "?cluster=devnet" : ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View on Solscan
                </a>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onAnother}
              >
                Launch another
              </button>
            </div>
          </div>
        ) : (
          <div className="in">
            <h2 id="modalTitle">Minting ${ticker}</h2>
            <p>Keep this tab open. It takes a few seconds.</p>
            <ul className="prog" id="prog">
              {STEPS.map((s, i) => (
                <li key={s} className={i < k ? "done" : i === k ? "now" : ""}>
                  <span className={"ck " + (i < k ? "ok" : "")}>
                    {i < k ? (
                      <Icon name="check" size={13} />
                    ) : i === k ? (
                      <span className="spin" />
                    ) : null}
                  </span>
                  {s}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
