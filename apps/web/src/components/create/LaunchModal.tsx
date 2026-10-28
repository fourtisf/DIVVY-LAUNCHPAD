"use client";

import { useEffect, useRef, useState } from "react";
import { VersionedTransaction } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import {
  short,
  usd,
  type CoinDetail,
  type LaunchStatus,
  type LaunchStep,
} from "@divvy/shared";
import { api } from "@/lib/api";
import { useAssets, useConfig } from "@/lib/config";
import { checkCreate, UnsafeTransaction } from "@/lib/txcheck";
import { CoinSpin3D } from "../Coin3D";
import { Icon } from "../Icon";
import { useToast } from "../Toasts";

const STEPS = [
  "Checking ticker, name and X account",
  "Approve the launch in your wallet",
  "Sending the create in a private bundle",
  "Live on chain",
  "On the board",
];
/** Whether a wallet error means the person turned the request down (wallet-adapter wraps the wallet's own error). */
const rejected = (e: unknown) => {
  const x = e as { message?: string; code?: number; error?: { code?: number; message?: string } } | null;
  return x?.code === 4001 || x?.error?.code === 4001 || /reject|declin|denied|cancel/i.test(`${x?.message ?? ""} ${x?.error?.message ?? ""}`);
};

const STEP_INDEX: Record<LaunchStep, number> = {
  checking: 0,
  signing: 1,
  bundling: 2,
  landed: 3,
  indexed: 5,
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
  const wallet = useWallet();
  // The polling loop outlives this render: it reads the wallet as it is now, not as it was at the start.
  const walletNow = useRef(wallet);
  walletNow.current = wallet;
  // The create the wallet was last asked to sign: a new attempt brings a new one.
  const asked = useRef<string | null>(null);
  // While the wallet is asked: since when (for the "open your wallet" hint) and what it last said.
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [walletSaid, setWalletSaid] = useState<string | null>(null);
  const [, setTick] = useState(0);
  useEffect(() => {
    if (askedAt === null) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [askedAt]);

  /**
   * The creator signs their coin's create (owner decision 2026-10-27): checked here before the wallet
   * opens, then sent back signed for the worker to add the mint's signature. Turning it down, or a
   * create that fails the check, ends the launch with nothing charged.
   */
  // One wallet prompt at a time: a create that arrives while one is open waits for it (audit).
  const busy = useRef(false);
  const queued = useRef<string | null>(null);
  const sign = (body: object) => api(`/api/launch/${launchId}/sign`, { method: "POST", body: JSON.stringify(body) });
  const signCreate = async (b64: string) => {
    if (busy.current) {
      queued.current = b64;
      return;
    }
    busy.current = true;
    const wallet = walletNow.current;
    try {
      if (!wallet.publicKey || !wallet.signTransaction) throw new UnsafeTransaction("this wallet can't sign the launch");
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      checkCreate(tx, wallet.publicKey, config.network, { to: config.launchFee.to, lamports: BigInt(config.launchFee.amount.raw) });
      setWalletSaid(null);
      setAskedAt(Date.now());
      const signed = await wallet.signTransaction(tx);
      let bin = "";
      for (const b of signed.serialize()) bin += String.fromCharCode(b);
      // A lost answer is retried: the signature is worth more than a quick error.
      for (let i = 0; ; i++) {
        try {
          await sign({ signedTx: btoa(bin) });
          break;
        } catch (e) {
          if (i === 2) throw e;
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    } catch (e) {
      console.error("launch: the wallet didn't sign", e);
      // Only a refusal ends the launch: the creator turned it down, or the create failed the page's
      // check. Any other wallet error (a prompt still open, a dropped connection) waits for the next ask,
      // and says what the wallet answered so it can be fixed.
      if (e instanceof UnsafeTransaction || rejected(e)) {
        if (e instanceof UnsafeTransaction) toast(e.message);
        await sign({ refused: true }).catch(() => {});
      } else {
        const x = e as { message?: string; error?: { message?: string } } | null;
        setWalletSaid(x?.error?.message || x?.message || "no answer");
      }
    } finally {
      setAskedAt(null);
      busy.current = false;
      const next = queued.current;
      queued.current = null;
      if (next && next !== b64) void signCreate(next);
    }
  };

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
        if (s.step === "signing" && s.tx && s.tx !== asked.current) {
          asked.current = s.tx;
          void signCreate(s.tx);
        }
        if (i >= STEPS.length) {
          // By mint: coins can share a ticker.
          const coin = s.mint ? await api<CoinDetail>(`/api/coins/${s.mint}`).catch(() => null) : null;
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
            <p>{k === 1 ? "Your wallet pays for the coin's create and signs it, so the coin is yours on chain. Keep this tab open." : "Keep this tab open. It takes a few seconds."}</p>
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
            {k === 1 && walletSaid ? (
              <p className="note" role="status">Your wallet didn&apos;t sign it ({walletSaid}). It will ask again in a moment.</p>
            ) : k === 1 && askedAt !== null && Date.now() - askedAt > 8000 ? (
              <p className="note" role="status">Don&apos;t see your wallet? Open it from your browser&apos;s toolbar: the request is waiting there.</p>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
