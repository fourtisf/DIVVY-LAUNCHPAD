"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { sol, type CoinDetail, type CreatorInfo } from "@divvy/shared";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { useErrorText, useSession } from "@/lib/session";
import { explorerTx, signAndSend } from "@/lib/tx";
import { useMsgs } from "@/i18n/client";
import { creatorFeesMsgs } from "@/i18n/msgs/coin";
import { useToast } from "../Toasts";

/**
 * On a coin's page, for its creator only (the connected wallet made the coin): the SOL its trades left
 * them and a button to claim it. Same API as /me: LaunchLab keeps one creator vault per wallet, so a
 * claim takes the fees of all their coins at once.
 */
export function CreatorFees({ coin }: { coin: CoinDetail }) {
  const config = useConfig();
  const toast = useToast();
  const t = useMsgs(creatorFeesMsgs);
  const errorText = useErrorText();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { me, ensureSignedIn } = useSession();
  const addr = wallet.publicKey?.toBase58() ?? null;
  const isCreator = !!addr && addr === coin.creator.wallet;
  const signedIn = isCreator && me?.wallet === addr;
  // The same key as /me's, so both pages share the answer.
  const { data, mutate } = useSWR(signedIn ? ["/api/me/creator", addr] : null, ([path]) => api<CreatorInfo>(path), { keepPreviousData: false, refreshInterval: 30_000 });
  const [busy, setBusy] = useState(false);
  const [claimed, setClaimed] = useState<string | null>(null);
  if (!isCreator) return null;

  const run = async (fn: () => Promise<void>, fallback: string) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const m = errorText(e, fallback);
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };
  const claim = () =>
    run(async () => {
      const { tx } = await api<{ tx: string }>("/api/me/creator/claim/build", { method: "POST" });
      const sig = await signAndSend(wallet, connection, tx, { network: config.network, kind: "creator-claim" });
      setClaimed(sig);
      toast(t.claimed);
      await mutate();
    }, t.claimFailed);

  const earned = data?.coins.find((c) => c.mint === coin.mint)?.creatorFees.ui ?? 0;
  const ready = data?.claimable;
  return (
    <div className="panel" id="creatorFees">
      <div className="panel-h">
        <h3>{t.title}</h3>
      </div>
      {!signedIn ? (
        <>
          <p className="note">{t.signInNote}</p>
          <button className="btn btn-g" type="button" style={{ width: "100%" }} disabled={busy} onClick={() => void run(async () => void (await ensureSignedIn()), t.signInFailed)}>
            {t.signInToClaim}
          </button>
        </>
      ) : !data ? (
        <p className="note">{t.loading}</p>
      ) : (
        <>
          <div className="kv"><span>{t.earnedOn(coin.ticker)}</span><b>{sol(earned)}</b></div>
          <div className="kv"><span>{t.ready}</span><b className="up">{sol(ready!.ui)}</b></div>
          <button className="btn btn-g" type="button" id="claimCreator" style={{ width: "100%", marginTop: 10 }} disabled={busy || ready!.raw === "0"} onClick={() => void claim()}>
            {busy ? t.claiming : ready!.raw === "0" ? t.nothing : t.claim(sol(ready!.ui))}
          </button>
          <p className="note" style={{ marginTop: 10 }}>
            {t.note(
              (config.fees.creatorBps / 100).toFixed(2),
              claimed
                ? (text) => (
                    <a className="link" href={explorerTx(claimed, config.network)} target="_blank" rel="noreferrer">{text}</a>
                  )
                : null,
              (text) => (
                <Link className="link" href="/me">{text}</Link>
              ),
            )}
          </p>
        </>
      )}
    </div>
  );
}
