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
import { useConfig } from "@/lib/config";
import { useErrorText } from "@/lib/session";
import { checkCreate, UnsafeTransaction } from "@/lib/txcheck";
import { useMsgs } from "@/i18n/client";
import { create } from "@/i18n/msgs/create";
import { Icon } from "../Icon";
import { useToast } from "../Toasts";

/** The modal's steps (create.steps): checks, wallet, bundle, on chain, on the board. */
const STEP_COUNT = create.en.steps.length;
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
  devBuy,
  onDone,
  onAnother,
}: {
  launchId: string;
  ticker: string;
  img: string;
  pays: string;
  /** The dev buy the creator typed, in lamports (0 for none): the create must hold exactly that. */
  devBuy: bigint;
  onDone: (s: LaunchStatus) => void;
  onAnother: () => void;
}) {
  const config = useConfig();
  const toast = useToast();
  const t = useMsgs(create);
  const errText = useErrorText();
  // Like the wallet below: the polling loop's prompt toasts in the language shown now.
  const errTextNow = useRef(errText);
  errTextNow.current = errText;
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
  // The newest create waiting for the wallet; since when the launch waits for a signature; when the
  // wallet was last asked and what it last answered. They drive the hints and the Approve button.
  const [toSign, setToSign] = useState<string | null>(null);
  const [signingSince, setSigningSince] = useState<number | null>(null);
  const [askedAt, setAskedAt] = useState<number | null>(null);
  const [walletSaid, setWalletSaid] = useState<string | null>(null);
  const [signedB64, setSignedB64] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (k !== 1) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [k]);

  /**
   * The creator signs their coin's create (owner decision 2026-10-27): checked here before the wallet
   * opens, then sent back signed for the worker to add the mint's signature. Turning it down, or a
   * create that fails the check, ends the launch with nothing charged.
   *
   * The wallet is asked once on its own when a create arrives. Its prompt can get lost (behind the
   * window, or held back by a wallet that only opens on a click), so the modal also has an Approve
   * button that asks again; the answer to an ask that a newer one replaced doesn't count, except a
   * signature, which the worker checks against the create it's waiting for.
   */
  const prompting = useRef(false);
  const seq = useRef(0);
  const sign = (body: object) => api(`/api/launch/${launchId}/sign`, { method: "POST", body: JSON.stringify(body) });
  const signCreate = async (b64: string) => {
    const my = ++seq.current;
    prompting.current = true;
    const wallet = walletNow.current;
    setWalletSaid(null);
    try {
      if (!wallet.publicKey || !wallet.signTransaction) throw new UnsafeTransaction("this wallet can't sign the launch");
      const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
      checkCreate(tx, wallet.publicKey, config.network, { to: config.launchFee.to, lamports: BigInt(config.launchFee.amount.raw) }, devBuy);
      setAskedAt(Date.now());
      console.info("launch: asking the wallet to sign the create", wallet.wallet?.adapter.name);
      const signed = await wallet.signTransaction(tx);
      let bin = "";
      for (const b of signed.serialize()) bin += String.fromCharCode(b);
      // A lost answer is retried: the signature is worth more than a quick error.
      for (let i = 0; ; i++) {
        try {
          await sign({ signedTx: btoa(bin) });
          setSignedB64(b64);
          break;
        } catch (e) {
          if (i === 2) throw e;
          await new Promise((r) => setTimeout(r, 800));
        }
      }
    } catch (e) {
      console.error("launch: the wallet didn't sign", e);
      if (my !== seq.current) return;
      // Only a refusal ends the launch: the creator turned it down, or the create failed the page's
      // check. Any other wallet error (a dropped connection, a wallet that needs a click) waits for the
      // Approve button or the next create, and says what the wallet answered.
      if (e instanceof UnsafeTransaction || rejected(e)) {
        if (e instanceof UnsafeTransaction) toast(errTextNow.current(e, e.message) ?? e.message);
        await sign({ refused: true }).catch(() => {});
      } else {
        const x = e as { message?: string; error?: { message?: string } } | null;
        // Empty when the wallet said nothing: shown as "no answer" in the visitor's language.
        setWalletSaid(x?.error?.message || x?.message || "");
      }
    } finally {
      if (my === seq.current) {
        prompting.current = false;
        setAskedAt(null);
      }
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
        if (s.step === "signing") setSigningSince((x) => x ?? Date.now());
        if (s.step === "signing" && s.tx && s.tx !== asked.current) {
          asked.current = s.tx;
          setToSign(s.tx);
          // One prompt at a time on its own (audit): while one is open, the button asks with this one.
          if (!prompting.current) void signCreate(s.tx);
        }
        if (i >= STEP_COUNT) {
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
        <div className="mcoin">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={img} alt={"$" + ticker} />
        </div>
        {live ? (
          <div className="in">
            <h2 id="modalTitle">{t.isLive(ticker)}</h2>
            <p>{t.holdersGet(pays)}</p>
            <div className="kv">
              <span>{t.marketCap}</span>
              <b>{live.mcapUsd === null ? "…" : usd(live.mcapUsd)}</b>
            </div>
            <div className="kv">
              <span>{t.paysIn}</span>
              <b>{pays}</b>
            </div>
            {live.status.mint && (
              <div className="kv">
                <span>{t.mint}</span>
                <b>
                  <button
                    type="button"
                    className="mint-copy"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(live.status.mint!)
                        .then(
                          () => toast(t.mintCopied),
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
                {t.openCoin}
              </button>
              {live.status.mint && (
                <a
                  className="btn btn-ghost"
                  href={`https://solscan.io/token/${live.status.mint}${config.network === "devnet" ? "?cluster=devnet" : ""}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t.viewSolscan}
                </a>
              )}
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onAnother}
              >
                {t.launchAnother}
              </button>
            </div>
          </div>
        ) : (
          <div className="in">
            <h2 id="modalTitle">{t.minting(ticker)}</h2>
            <p>{k === 1 ? t.signingNote : t.keepOpen}</p>
            <ul className="prog" id="prog">
              {t.steps.map((s, i) => (
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
            {k === 1 && !toSign && signingSince !== null && now - signingSince > 10_000 && (
              <p className="note" role="status">{t.waitingCreate}</p>
            )}
            {k === 1 && toSign && toSign !== signedB64 && (walletSaid !== null || askedAt === null || now - askedAt > 8000) && (
              <>
                <p className="note" role="status">
                  {walletSaid !== null
                    ? t.didntSign(walletSaid || t.noAnswer)
                    : t.cantSee}
                </p>
                <button type="button" className="btn btn-g" style={{ width: "100%", marginTop: 10 }} onClick={() => void signCreate(toSign)}>
                  {t.approve}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
