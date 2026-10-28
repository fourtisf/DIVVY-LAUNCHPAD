"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ago, num, short, sol, usd, type CreatorInfo, type MyPayouts } from "@divvy/shared";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { errorText, useSession } from "@/lib/session";
import { explorerTx, signAndSend } from "@/lib/tx";
import { Chip } from "../Chip";
import { useToast } from "../Toasts";
import { coinHref } from "@/lib/links";

const STATUS: Record<MyPayouts["items"][number]["status"], string> = { credited: "Credited", sent: "Sent", claimed: "Claimed" };

/** The connected wallet's own page: what it can claim, what it was paid, and its coins' creator fees. */
export function MeView() {
  const config = useConfig();
  const toast = useToast();
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
      const m = errorText(e, "That didn't go through. Try again.");
      if (m) toast(m);
    } finally {
      setBusy(null);
    }
  };

  const claim = (assetSymbol: string) =>
    run(assetSymbol, async () => {
      const { tx } = await api<{ tx: string }>("/api/claims/build", { method: "POST", body: JSON.stringify({ assetSymbol }) });
      await signAndSend(wallet, connection, tx, { network: config.network, kind: "claim" });
      toast(`${assetSymbol} claimed`);
      await Promise.all([refresh(), reloadPayouts()]);
    });

  const claimCreator = () =>
    run("creator", async () => {
      const { tx } = await api<{ tx: string }>("/api/me/creator/claim/build", { method: "POST" });
      await signAndSend(wallet, connection, tx, { network: config.network, kind: "creator-claim" });
      toast("Creator fees claimed");
      await reloadCreator();
    });

  if (!addr) {
    return (
      <>
        <h1 className="page-h">Your payouts</h1>
        <p className="page-lede">Connect the wallet that holds your coins to see what it was paid and what it can claim.</p>
        <button className="btn btn-g btn-lg" type="button" onClick={() => setVisible(true)}>Connect wallet</button>
      </>
    );
  }

  if (!signedIn) {
    return (
      <>
        <h1 className="page-h">Your payouts</h1>
        <p className="page-lede">Sign a short message to prove this wallet is yours. It costs nothing and sends no transaction.</p>
        <div className="me-actions">
          <button className="btn btn-g btn-lg" type="button" disabled={busy === "signin"} onClick={() => run("signin", async () => void (await ensureSignedIn()))}>
            Sign in as {short(addr)}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => void wallet.disconnect()}>Disconnect</button>
        </div>
      </>
    );
  }

  const claimable = me?.claimable ?? [];
  return (
    <>
      <h1 className="page-h">Your payouts</h1>
      <p className="page-lede">
        {short(addr)}
        {me?.x ? ` · @${me.x.handle}` : ""}. {claimModel ? "Every hour your coins credit you their stock. Claim it any time; you pay only the network fee and your token account." : "Every hour your coins send you their stock."}
      </p>
      <div className="me-actions">
        <button className="btn btn-ghost" type="button" onClick={() => void signOut()}>Sign out</button>
        <button className="btn btn-ghost" type="button" onClick={() => void signOut().then(() => wallet.disconnect())}>Disconnect</button>
      </div>
      {me?.blocked && <p className="note me-warn">uspad isn&apos;t available in your country, so claims are turned off here.</p>}

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h">
          <h3>{claimModel ? "Ready to claim" : "Waiting to be sent"}</h3>
        </div>
        {claimable.length === 0 ? (
          <p className="note">Nothing yet. Hold a coin through the top of the hour to get its stock.</p>
        ) : (
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>Stock</th><th className="r">Amount</th><th className="r">Value</th><th className="r" /></tr></thead>
              <tbody>
                {claimable.map((c) => (
                  <tr key={c.assetSymbol}>
                    <td style={{ display: "flex", gap: 10, alignItems: "center", fontWeight: 500 }}><Chip sym={c.assetSymbol} />{c.assetSymbol}</td>
                    <td className="r up">{num(c.amount.ui)}</td>
                    <td className="r">{usd(c.usd)}</td>
                    <td className="r">
                      {claimModel ? (
                        <button className="btn btn-g" type="button" disabled={!!busy || !!me?.blocked} onClick={() => void claim(c.assetSymbol)}>
                          {busy === c.assetSymbol ? "Claiming…" : "Claim"}
                        </button>
                      ) : (
                        <span className="faint">Sent once it&apos;s worth {usd(config.payouts.autoPushMinUsd ?? 1)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><h3>Payout history</h3></div>
        {!payouts?.items.length ? (
          <p className="note">No payouts yet.</p>
        ) : (
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>Coin</th><th>When</th><th className="r">Amount</th><th className="r">Value</th><th className="r">Status</th><th className="r">Tx</th></tr></thead>
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
                    <td className="r">{STATUS[p.status]}</td>
                    <td className="r">{p.sig ? <a className="tx" href={explorerTx(p.sig, config.network)} target="_blank" rel="noreferrer">{short(p.sig)}</a> : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {creator && creator.coins.length > 0 && (
        <div className="panel" style={{ marginBottom: 80 }}>
          <div className="panel-h">
            <h3>Your coins</h3>
            <button className="btn btn-g" type="button" disabled={!!busy || creator.claimable.raw === "0"} onClick={() => void claimCreator()}>
              {busy === "creator" ? "Claiming…" : `Claim ${sol(creator.claimable.ui)}`}
            </button>
          </div>
          <p className="note">Your {(config.fees.creatorBps / 100).toFixed(2)}% of every trade on the curve collects on chain in your own creator vault. Claiming sends it to this wallet.</p>
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>Coin</th><th className="r">Status</th><th className="r">Creator fees earned</th></tr></thead>
              <tbody>
                {creator.coins.map((c) => (
                  <tr key={c.mint}>
                    <td>
                      <Link href={coinHref(c)} style={{ display: "flex", gap: 10, alignItems: "center", whiteSpace: "nowrap", fontWeight: 500 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={c.imageUrl} alt="" width={26} height={26} style={{ borderRadius: 8 }} />${c.ticker}
                      </Link>
                    </td>
                    <td className="r">{c.status === "graduated" ? "Graduated" : "On the curve"}</td>
                    <td className="r">{sol(c.creatorFees.ui)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
