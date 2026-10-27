"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { useWallet } from "@solana/wallet-adapter-react";
import { ago, short, type AdminOverview, type AdminReportList } from "@divvy/shared";
import { api } from "@/lib/api";
import { errorText, useSession } from "@/lib/session";
import { useToast } from "../Toasts";
import { coinHref } from "@/lib/links";

const REASONS: Record<string, string> = { copy: "Copies another coin", scam: "Scam", nsfw: "Not safe for work", illegal: "Illegal", other: "Other" };

/** Admin page: launch switch, hot wallets, health, and the report queue. The API checks ADMIN_WALLETS. */
export function AdminView() {
  const toast = useToast();
  const { publicKey } = useWallet();
  const { me, ensureSignedIn } = useSession();
  const isAdmin = !!me?.isAdmin && me.wallet === publicKey?.toBase58();
  const { data: o, error: oError, mutate: reloadO } = useSWR<AdminOverview>(isAdmin ? "/api/admin/overview" : null, { refreshInterval: 30_000 });
  const { data: reports, mutate: reloadR } = useSWR<AdminReportList>(isAdmin ? "/api/admin/reports" : null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
      await Promise.all([reloadO(), reloadR()]);
    } catch (e) {
      const m = errorText(e, "That didn't work. Try again.");
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };
  const post = (path: string, body: unknown) => api(path, { method: "POST", body: JSON.stringify(body) });

  if (!isAdmin) {
    return (
      <>
        <h1 className="page-h">Admin</h1>
        <p className="page-lede">{me?.wallet ? "This wallet isn't an admin." : "Sign in with an admin wallet."}</p>
        {!me?.wallet && (
          <button className="btn btn-g btn-lg" type="button" onClick={() => void ensureSignedIn().catch((e) => toast(errorText(e, "Couldn't sign in") ?? ""))}>
            Sign in
          </button>
        )}
      </>
    );
  }

  return (
    <>
      <h1 className="page-h">Admin</h1>
      <p className="page-lede">
        {o ? `${o.mainnetEnabled ? "Mainnet sends are on" : "Mainnet sends are off"}. Payouts are ${o.dryRun ? "in dry-run" : "live"}.` : oError ? "Couldn't load the overview. It retries every 30 seconds." : "Loading…"}
      </p>
      {o && (
        <div className="tiles">
          <div><b className={o.launchesOpen ? "up" : "down"}>{o.launchesOpen ? "Open" : "Paused"}</b><span>Launches</span></div>
          <div><b>{o.pendingLaunches}</b><span>Launches in progress</span></div>
          <div><b className={o.lateRounds ? "down" : ""}>{o.lateRounds}</b><span>Late rounds, last 24h</span></div>
          <div><b className={(o.indexerLagSec ?? 0) > 60 ? "down" : ""}>{o.indexerLagSec === null ? "–" : `${o.indexerLagSec}s`}</b><span>Indexer lag</span></div>
        </div>
      )}

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><h3>Launches</h3></div>
        {/* No switch until the real state is known (audit: it showed "paused" while loading). */}
        {!o ? (
          <p className="note">{oError ? "The launch switch shows once the overview loads." : "Loading…"}</p>
        ) : o.launchesOpen ? (
          <form
            className="admin-row"
            onSubmit={(e) => {
              e.preventDefault();
              void act(() => post("/api/admin/settings", { launchesOpen: false, reason: reason.trim() || null }), "Launches paused");
            }}
          >
            <input className="tinput" placeholder="Reason shown on the create page" maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="btn btn-red" type="submit" disabled={busy}>Pause launches</button>
          </form>
        ) : (
          <div className="admin-row">
            <p className="note" style={{ margin: 0 }}>Paused: {o.launchesPausedReason ?? "no reason given"}</p>
            <button className="btn btn-g" type="button" disabled={busy} onClick={() => void act(() => post("/api/admin/settings", { launchesOpen: true, reason: null }), "Launches open")}>
              Open launches
            </button>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 18 }}>
        <div className="panel-h"><h3>Hot wallets</h3></div>
        {!o?.wallets.length ? (
          <p className="note">No wallet status yet. The worker reports balances every minute.</p>
        ) : (
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>Role</th><th>Address</th><th className="r">Balance</th></tr></thead>
              <tbody>
                {o.wallets.map((w) => (
                  <tr key={w.role}>
                    <td>{w.role.replace("_", " ")}</td>
                    <td><span className="tx">{short(w.address)}</span></td>
                    <td className={"r " + (w.lowBalance ? "down" : "")}>{w.sol.toFixed(3)} SOL{w.lowBalance ? ", low" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 80 }}>
        <div className="panel-h"><h3>Reports</h3></div>
        {!reports?.items.length ? (
          <p className="note">No open reports.</p>
        ) : (
          <div className="table-scroll">
            <table className="t">
              <thead><tr><th>Coin</th><th>Reason</th><th>When</th><th className="r" /></tr></thead>
              <tbody>
                {reports.items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={coinHref(r.coin)} style={{ display: "flex", gap: 10, alignItems: "center", whiteSpace: "nowrap", fontWeight: 500 }}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={r.coin.imageUrl} alt="" width={26} height={26} style={{ borderRadius: 8 }} />${r.coin.ticker}
                        {r.coin.hidden && <span className="faint">hidden</span>}
                      </Link>
                    </td>
                    <td>
                      {REASONS[r.reason] ?? r.reason}
                      {r.details && <div className="faint" style={{ fontSize: 12.5 }}>{r.details}</div>}
                    </td>
                    <td suppressHydrationWarning>{ago(r.createdAt)}</td>
                    <td className="r admin-acts">
                      <button
                        className="btn btn-ghost"
                        type="button"
                        disabled={busy}
                        onClick={() => void act(() => post(`/api/admin/coins/${r.coin.mint}/hide`, { hidden: !r.coin.hidden, reason: r.coin.hidden ? null : REASONS[r.reason] ?? r.reason }), r.coin.hidden ? "Coin shown again" : "Coin hidden")}
                      >
                        {r.coin.hidden ? "Unhide" : "Hide coin"}
                      </button>
                      <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void act(() => post(`/api/admin/reports/${r.id}`, { status: "resolved" }), "Report resolved")}>Resolve</button>
                      <button className="btn btn-ghost" type="button" disabled={busy} onClick={() => void act(() => post(`/api/admin/reports/${r.id}`, { status: "dismissed" }), "Report dismissed")}>Dismiss</button>
                    </td>
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
