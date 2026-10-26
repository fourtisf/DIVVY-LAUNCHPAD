"use client";

import { useEffect, useState } from "react";
import type { LaunchStatus, LaunchStep } from "@divvy/shared";
import { api } from "@/lib/api";
import { useAssets } from "@/lib/config";
import { CoinSpin3D } from "../Coin3D";
import { Icon } from "../Icon";

const STEPS = ["Checking ticker, name, picture and X account", "Sending the create in a private bundle", "Live on chain", "On the board"];
const STEP_INDEX: Record<LaunchStep, number> = { checking: 0, bundling: 1, landed: 2, indexed: 4, failed: -1 };

/** The 4-step launch modal, driven by GET /api/launch/:id (HANDOFF §11 Phase 2). */
export function LaunchModal({ launchId, ticker, img, pays, onDone }: { launchId: string; ticker: string; img: string; pays: string; onDone: (s: LaunchStatus) => void }) {
  const back = useAssets()[pays];
  const [k, setK] = useState(0);

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
          t = setTimeout(() => !stop && onDone(s), 600);
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
    <div className="modal-bg on" id="modal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
      <div className="modal" id="modalBody">
        <CoinSpin3D src={img} back={back} label={"$" + ticker} />
        <div className="in">
          <h2 id="modalTitle">Minting ${ticker}</h2>
          <p>Keep this tab open. It takes a few seconds.</p>
          <ul className="prog" id="prog">
            {STEPS.map((s, i) => (
              <li key={s} className={i < k ? "done" : i === k ? "now" : ""}>
                <span className={"ck " + (i < k ? "ok" : "")}>{i < k ? <Icon name="check" size={13} /> : i === k ? <span className="spin" /> : null}</span>
                {s}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
