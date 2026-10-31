"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { num, short, sol, usd, type CreatorInfo, type MyPayouts } from "@divvy/shared";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { useErrorText, useSession } from "@/lib/session";
import { explorerTx, signAndSend } from "@/lib/tx";
import { Chip } from "../Chip";
import { useToast } from "../Toasts";
import { coinHref } from "@/lib/links";
import { useAgo, useMsgs } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";
import { me as meMsgs } from "@/i18n/msgs/me";

/** The connected wallet's own page: what it can claim, what it was paid, and its coins' creator fees. */
export function MeView() {
  const config = useConfig();
  const toast = useToast();
  const t = useMsgs(meMsgs);
  const tc = useMsgs(common);
  const ago = useAgo();
  const errorText = useErrorText();
  const wallet = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const { me, ensureSignedIn, signOut, refresh } = useSession();
  const addr = wallet.publicKey?.toBase58() ?? null;
  const signedIn = !!addr && me?.wallet === addr;
  // Cached per wallet, and never showing the last key's data while loading: after a wallet switch, the
  // previous wallet's payouts and claimable fees must not show for a moment (audit).
  const mine = { keepPreviousData: false };
  const { data: payouts, mutate: reloadPayouts } = useSWR(signedIn ? ["/api/me/payouts?limit=50", addr] : null, ([path]) => api<MyPayouts>(path), mine);
  const { data: creator, mutate: reloadCreator } = useSWR(signedIn ? ["/api/me/creator", addr] : null, ([path]) => api<CreatorInfo>(path), mine);
  const [busy, setBusy] = useState<string | null>(null);
  const claimModel = config.payouts.delivery === "claim";

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try {
      await fn();
    } catch (e) {
      const m = errorText(e, t.failed);
      if (m) toast(m);
    } finally {
      setBusy(null);
    }
  };

  const claim = (assetSymbol: string) =>
    run(assetSymbol, async () => {
      const { tx } = await api<{ tx: string }>("/api/claims/build", { method: "POST", body: JSON.stringify({ assetSymbol }) });
      await signAndSend(wallet, connection, tx, { network: config.network, kind: "claim" });
      toast(t.claimed(assetSymbol));
      await Promise.all([refresh(), reloadPayouts()]);
    });

  const claimCreator = () =>
    run("creator", async () => {
      const { tx } = await api<{ tx: string }>("/api/me/creator/claim/build", { method: "POST" });
      await signAndSend(wallet, connection, tx, { network: config.network, kind: "creator-claim" });
      toast(t.creatorClaimed);
      await reloadCreator();
    });

  if (!addr) {
    return (
      <>
        <h1 className="page-h">{t.title}</h1>
        <p className="page-lede">{t.connectLede}</p>
        <button className="btn btn-g btn-lg" type="button" onClick={() => setVisible(true)}>{tc.connectWallet}</button>
      </>
    );
  }

  if (!signedIn) {
    return (
      <>
        <h1 className="page-h">{t.title}</h1>
        <p className="page-lede">{t.signInLede}</p>
        <div className="me-actions">
          <button className="btn btn-g btn-lg" type="button" disabled={busy === "signin"} onClick={() => run("signin", async () => void (await ensureSignedIn()))}>
            {t.signInAs(short(addr))}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void wallet.disconnect()}>{t.disconnect}</button>
        </div>
      </>
    );
  }

  const claimable = me?.claimable ?? [];
  return (
    <>
      <h1 className="page-h">{t.title}</h1>
      <p className="page-lede">
        {t.lede(short(addr) + (me?.x ? ` · @${me.x.handle}` : ""), claimModel)}
      </p>
      <div className="me-actions">
        <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>{t.signOut}</button>
        <button className="btn btn-ghost" type="button" onClick={() => void signOut().then(() => wallet.disconnect())}>{t.disconnect}</button>
      </div>
      {me?.blocked && <p className="note me-warn">{t.blocked}</p>}

      {/* First for creators, so their fees are easy to find. */}
      {creator && creator.coins.length > 0 && (
        <div className="panel" style={{ marginBottom: 18 }} id="creatorFees">
          <div className="panel-h">
            <h3>{t.creatorTitle}</h3>
            <button className="btn btn-g" type="button" disabled={!!busy || creator.claimable.raw === "0"} onClick={() => void claimCreator()}>
              {busy === "creator" ? t.claiming : creator.claimable.raw === "0" ? t.nothingToClaim : t.claimAmount(sol(creator.claimable.ui))}
            </button>
          </div>
          <p className="note">{t.creatorNote((config.fees.creatorBps / 100).toFixed(2))}</p>
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>{t.colCoin}</th><th className="r">{t.colStatus}</th><th className="r">{t.colEarned}</th></tr></thead>
              <tbody>
                {creator.coins.map((c) => (
                  <tr key={c.mint}>
                    <td>
                      <Link href={coinHref(c)} style={{ display: "flex", gap: 10, alignItems: "center", whiteSpace: "nowrap", fontWeight: 500 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.imageUrl} alt="" width={26} height={26} style={{ borderRadius: 8 }} />${c.ticker}
                      </Link>
                    </td>
                    <td className="r">{c.status === "graduated" ? t.graduated : t.onCurve}</td>
                    <td className="r">{sol(c.creatorFees.ui)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h">
          <h3>{claimModel ? t.readyToClaim : t.waitingToSend}</h3>
        </div>
        {claimable.length === 0 ? (
          <p className="note">{t.nothingYet}</p>
        ) : (
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>{t.colStock}</th><th className="r">{t.colAmount}</th><th className="r">{t.colValue}</th><th className="r" /></tr></thead>
              <tbody>
                {claimable.map((c) => (
                  <tr key={c.assetSymbol}>
                    <td style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 500 }}><Chip sym={c.assetSymbol} />{c.assetSymbol}</td>
                    <td className="r up">{num(c.amount.ui)}</td>
                    <td className="r">{usd(c.usd)}</td>
                    <td className="r">
                      {claimModel ? (
                        <button className="btn btn-g" type="button" disabled={!!busy || !!me?.blocked} onClick={() => void claim(c.assetSymbol)}>
                          {busy === c.assetSymbol ? t.claiming : t.claim}
                        </button>
                      ) : (
                        <span className="faint">{t.sentOnce(usd(config.payouts.autoPushMinUsd ?? 1))}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 80 }}>
        <div className="panel-h"><h3>{t.history}</h3></div>
        {!payouts?.items.length ? (
          <p className="note">{t.noPayouts}</p>
        ) : (
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>{t.colCoin}</th><th>{t.colWhen}</th><th className="r">{t.colAmount}</th><th className="r">{t.colValue}</th><th className="r">{t.colStatus}</th><th className="r">{t.colTx}</th></tr></thead>
              <tbody>
                {payouts.items.map((p) => (
                  <tr key={`${p.coin.mint}-${p.hour}`}>
                    <td>
                      <Link href={coinHref(p.coin)} style={{ display: "flex", gap: 10, alignItems: "center", whiteSpace: "nowrap", fontWeight: 500 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.coin.imageUrl} alt="" width={26} height={26} style={{ borderRadius: 8 }} />${p.coin.ticker}
                      </Link>
                    </td>
                    <td style={{ whiteSpace: "nowrap" }} suppressHydrationWarning>{ago(p.hour)}</td>
                    <td className="r up" style={{ whiteSpace: "nowrap" }}>{num(p.amount.ui)} {p.assetSymbol}</td>
                    <td className="r">{usd(p.usd)}</td>
                    <td className="r">{t.status[p.status]}</td>
                    <td className="r">{p.sig ? <a className="tx" href={explorerTx(p.sig, config.network)} target="_blank" rel="noreferrer">{short(p.sig)}</a> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

    </>
  );
}
