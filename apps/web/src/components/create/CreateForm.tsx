"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import useSWR from "swr";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  avatarDataUri,
  bpsLabel,
  displayTicker,
  pct,
  type CheckResponse,
  type LaunchStatus,
  type UploadResponse,
} from "@divvy/shared";
import { api, ApiRequestError, qs } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { useDebounced } from "@/lib/hooks";
import { errorText, useSession } from "@/lib/session";
import { payLaunchFee, SentUnconfirmed } from "@/lib/tx";
import { Chip } from "../Chip";
import { CoinCard } from "../CoinCard";
import { Icon } from "../Icon";
import { useToast } from "../Toasts";
import { LaunchModal } from "./LaunchModal";
import { coinHref } from "@/lib/links";

interface Draft {
  name: string;
  ticker: string;
  desc: string;
  pays: string;
  x: string;
  tg: string;
  web: string;
  /** Local preview URL and the server's answer for the uploaded picture. */
  imgPreview: string | null;
  upload: UploadResponse | null;
}

// Kept across page changes, like the prototype's `draft`.
let saved: Draft = { name: "", ticker: "", desc: "", pays: "NVDAx", x: "", tg: "", web: "", imgPreview: null, upload: null };

type Check = { s: "idle" | "ok" | "fail"; m: string };
const toCheck = (r: { status: Check["s"]; message: string } | undefined, idle: string): Check => (r ? { s: r.status, m: r.message } : { s: "idle", m: idle });

/**
 * A launch fee this wallet paid that no launch has used yet. The next try sends it again, so a launch
 * refused after the payment never costs a second fee. sessionStorage, so a reload keeps it.
 */
const heldFee = {
  get(w: string): string | null {
    try {
      return w ? sessionStorage.getItem(`uspad:launch-fee:${w}`) : null;
    } catch {
      return null;
    }
  },
  set(w: string, sig: string | null) {
    try {
      if (sig) sessionStorage.setItem(`uspad:launch-fee:${w}`, sig);
      else sessionStorage.removeItem(`uspad:launch-fee:${w}`);
    } catch {
      // Storage off: a payment the API already recorded is still credited to the wallet.
    }
  },
};
const errCode = (e: unknown) => (e instanceof ApiRequestError ? e.body?.code : undefined);

export function CreateForm() {
  const config = useConfig();
  const toast = useToast();
  const router = useRouter();
  const walletCtx = useWallet();
  const { publicKey } = walletCtx;
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const { me, ensureSignedIn } = useSession();
  const [d, setD] = useState<Draft>(saved);
  const [imgCheck, setImgCheck] = useState<Check>(() => (saved.upload ? { s: saved.upload.check.status, m: saved.upload.check.message } : { s: "idle", m: "Upload a picture" }));
  const [over, setOver] = useState(false);
  const [launch, setLaunch] = useState<{ id: string; ticker: string; img: string; pays: string } | null>(null);
  // Why the last launch didn't happen, kept under the button: a toast alone is gone in 2.6 s.
  const [launchError, setLaunchError] = useState<string | null>(null);
  // Creator-paid launches (Config.launchFee): the fee in SOL, and whether the wallet is sending it now.
  const feeSol = config.launchFee.to ? config.launchFee.amount.ui : 0;
  const [paying, setPaying] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saved = d;
  }, [d]);

  const set = (k: keyof Draft) => (e: { target: { value: string } }) => {
    setLaunchError(null);
    setD((p) => ({ ...p, [k]: e.target.value }));
  };

  // Live anti-vamp feedback from the server (the authority), debounced.
  const dq = useDebounced({ ticker: d.ticker, name: d.name, x: d.x }, 150);
  const checkKey = dq.ticker.trim() || dq.name.trim() || dq.x.trim() ? "/api/check" + qs({ ticker: dq.ticker, name: dq.name, x: dq.x }) : null;
  const { data: checks } = useSWR<CheckResponse>(checkKey, { keepPreviousData: true });
  const ct = d.ticker.trim() ? toCheck(checks?.ticker, "Checking…") : { s: "idle" as const, m: "Type a ticker" };
  const cn = d.name.trim() ? toCheck(checks?.name, "Checking…") : { s: "idle" as const, m: "Type a name" };
  // The project's X link (owner decision 2026-10-27): typed like the Telegram link, one coin per account.
  const cx = d.x.trim() ? toCheck(checks?.x, "Checking…") : { s: "ok" as const, m: "Optional" };
  const stale = dq.ticker !== d.ticker || dq.name !== d.name || dq.x !== d.x;
  const ci = imgCheck;

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    if (!config.limits.imageTypes.includes(f.type)) return setImgCheck({ s: "fail", m: "Use a PNG, JPG, WEBP or GIF" });
    if (f.size > config.limits.imageMaxBytes) return setImgCheck({ s: "fail", m: `That file is over ${Math.round(config.limits.imageMaxBytes / 1024 / 1024)} MB` });
    if (!config.demo) {
      try {
        if (!(await ensureSignedIn())) return setImgCheck({ s: "idle", m: "Connect a wallet to upload" });
      } catch (e) {
        return setImgCheck({ s: "idle", m: errorText(e, "Sign in to upload") ?? "Sign in to upload" });
      }
    }
    const preview = URL.createObjectURL(f);
    setD((p) => ({ ...p, imgPreview: preview, upload: null }));
    setImgCheck({ s: "idle", m: "Checking the picture" });
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await api<UploadResponse>("/api/upload", { method: "POST", body: fd });
      setD((p) => ({ ...p, upload: r }));
      setImgCheck({ s: r.check.status, m: r.check.message });
    } catch (e) {
      setImgCheck({ s: "fail", m: e instanceof ApiRequestError ? e.message : "The upload failed. Try again." });
    }
  };

  const ready = !stale && ct.s === "ok" && cn.s === "ok" && cx.s !== "fail" && ci.s === "ok";
  const hint =
    ct.s !== "ok"
      ? "Fix the ticker to continue."
      : cn.s !== "ok"
        ? "Fix the name to continue."
        : ci.s !== "ok"
          ? "Add a picture to continue."
          : cx.s === "fail"
            ? "Fix the X account to continue."
            : paying
              ? `Approve the ${feeSol} SOL launch fee in your wallet…`
              : feeSol
                ? `Ready. You'll approve the ${feeSol} SOL launch fee in your wallet.`
                : "Ready. Launching takes a few seconds.";

  const t = displayTicker(d.ticker) || "TICKER";
  const previewImg = d.upload?.url ?? d.imgPreview ?? avatarDataUri(t);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !d.upload) return;
    // Demo mode keeps the prototype's flow (launch without a wallet). Live mode needs a signed-in wallet.
    if (!publicKey && !config.demo) return setVisible(true);
    setLaunchError(null);
    const wallet = publicKey?.toBase58() ?? "";
    try {
      if (!config.demo && !(await ensureSignedIn())) return;
      const body = { name: d.name, ticker: d.ticker, description: d.desc, imageId: d.upload.imageId, dividendAsset: d.pays, x: d.x, telegram: d.tg, website: d.web };
      // With a payment, the API reads it from the chain, and its RPC can be a few seconds behind the wallet's.
      const post = async (feeSig?: string) => {
        for (let i = 0; ; i++) {
          try {
            return await api<{ launchId: string }>("/api/launch", { method: "POST", body: JSON.stringify({ ...body, feeSig }) });
          } catch (e) {
            if (feeSig && i < 5 && errCode(e) === "FEE_NOT_FOUND") await new Promise((r) => setTimeout(r, 2000));
            else throw e;
          }
        }
      };
      let res: { launchId: string } | null = null;
      const held = heldFee.get(wallet);
      if (held) {
        try {
          res = await post(held);
        } catch (e) {
          // A held payment that can't pay any more (used, too old, never landed) is dropped.
          if (!["FEE_USED", "BAD_FEE", "FEE_NOT_FOUND"].includes(errCode(e) ?? "")) throw e;
          heldFee.set(wallet, null);
        }
      }
      if (!res) {
        try {
          res = await post();
        } catch (e) {
          if (!(errCode(e) === "FEE_REQUIRED" && config.launchFee.to && wallet)) throw e;
        }
      }
      if (!res) {
        // A paid launch: the wallet sends the fee, then the same request carries the payment for the API
        // to check on chain. A launch refused after that keeps the fee for the next one.
        setPaying(true);
        let sig: string;
        try {
          sig = await payLaunchFee(walletCtx, connection, config.launchFee.to!, BigInt(config.launchFee.amount.raw));
        } catch (e) {
          if (e instanceof SentUnconfirmed) heldFee.set(wallet, e.signature);
          throw e;
        } finally {
          setPaying(false);
        }
        heldFee.set(wallet, sig);
        res = await post(sig);
      }
      heldFee.set(wallet, null);
      setLaunch({ id: res.launchId, ticker: t, img: d.upload.url, pays: d.pays });
    } catch (err) {
      if (errCode(err) === "FEE_USED" || errCode(err) === "BAD_FEE") heldFee.set(wallet, null);
      const m = errorText(err, "The launch failed. Try again.");
      if (m) {
        const kept = heldFee.get(wallet) ? " Your launch fee is kept for your next launch." : "";
        toast(m + kept);
        setLaunchError(m + kept);
      }
    }
  };

  const blank = (): Draft => ({ name: "", ticker: "", desc: "", pays: d.pays, x: "", tg: "", web: "", imgPreview: null, upload: null });
  const another = () => {
    setLaunch(null);
    saved = blank();
    setD(saved);
    setImgCheck({ s: "idle", m: "Upload a picture" });
  };

  const done = (s: LaunchStatus) => {
    setLaunch(null);
    if (s.step === "indexed") {
      saved = blank();
      router.push(coinHref(s));
      toast(`$${s.ticker} is live`);
    } else {
      const m = s.error?.message ?? "The launch failed. Nothing was created.";
      toast(m);
      setLaunchError(m);
    }
  };

  const checkRow = (k: string, v: Check) => (
    <li key={k}>
      <span className={"ck " + (v.s === "ok" ? "ok" : v.s === "fail" ? "fail" : "")}>{v.s === "ok" ? <Icon name="check" size={13} /> : v.s === "fail" ? <Icon name="x" size={13} /> : null}</span>
      <div>
        {k}
        <small>{v.m}</small>
      </div>
    </li>
  );

  return (
    <>
      <Link className="back" href="/"><Icon name="back" />Back to the board</Link>
      <div className="create-head">
        <h1>Create a coin</h1>
        <p>It&apos;s free. uspad&apos;s launcher creates your coin in a private bundle and pays the rent. Nobody gets a dev buy, and your holders get the dividend.</p>
      </div>
      <div className="create-grid">
        <form id="frm" noValidate onSubmit={submit}>
          <section className="fsec">
            <div className="fsec-h">
              <span className="n">1</span>
              <div>
                <h2>The coin</h2>
                <p>Name, ticker and picture can&apos;t be changed later.</p>
              </div>
            </div>
            <div className="form-row fld">
              <div>
                <label className="lbl" htmlFor="fName">Name</label>
                <input className={"tinput" + (cn.s === "fail" ? " bad" : "")} id="fName" maxLength={config.limits.nameMaxLen} placeholder="Chip Dog" value={d.name} onChange={set("name")} />
              </div>
              <div>
                <label className="lbl" htmlFor="fTick">Ticker</label>
                <input className={"tinput" + (ct.s === "fail" ? " bad" : "")} id="fTick" maxLength={12} placeholder="CHIPDOG" value={d.ticker} onChange={set("ticker")} style={{ textTransform: "uppercase" }} />
              </div>
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="fDesc">Description <em>optional</em></label>
              <textarea className="tinput" id="fDesc" maxLength={config.limits.descriptionMaxLen} placeholder="One line people will remember" value={d.desc} onChange={set("desc")} />
            </div>
            <div className="fld">
              <span className="lbl">Picture</span>
              <label
                className={"drop" + (over ? " over" : "")}
                id="drop"
                htmlFor="fImg"
                onDragEnter={(e) => (e.preventDefault(), setOver(true))}
                onDragOver={(e) => (e.preventDefault(), setOver(true))}
                onDragLeave={(e) => (e.preventDefault(), setOver(false))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(false);
                  void handleFile(e.dataTransfer.files[0]);
                }}
              >
                {d.imgPreview || d.upload ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={d.imgPreview ?? d.upload!.url} alt="Your coin picture" />
                ) : (
                  <span className="ph"><Icon name="img" size={22} /></span>
                )}
                <p>
                  Drop an image or click to choose
                  <small>PNG, JPG, WEBP or GIF up to {Math.round(config.limits.imageMaxBytes / 1024 / 1024)} MB.</small>
                </p>
              </label>
              <input ref={fileInput} type="file" id="fImg" accept={config.limits.imageTypes.join(",")} className="sr" onChange={(e) => void handleFile(e.target.files?.[0])} />
            </div>
          </section>

          <section className="fsec">
            <div className="fsec-h">
              <span className="n">2</span>
              <div>
                <h2>The dividend</h2>
                <p>What your holders earn every hour. Locked once the coin is live.</p>
              </div>
            </div>
            <div className="stocks" role="radiogroup" aria-label="Dividend stock">
              {config.dividendAssets
                .filter((a) => a.enabled)
                .map((s) => (
                  <button type="button" role="radio" className="stock-opt" key={s.symbol} aria-checked={d.pays === s.symbol} onClick={() => setD((p) => ({ ...p, pays: s.symbol }))}>
                    <Chip sym={s.symbol} />
                    <div style={{ minWidth: 0 }}>
                      <b>{s.symbol}</b>
                      <span>
                        <span>{s.name}</span>
                        <span className={s.change24hPct > 0 ? "up" : s.change24hPct < 0 ? "down" : ""}>{s.change24hPct ? pct(s.change24hPct) : "stable"}</span>
                      </span>
                    </div>
                  </button>
                ))}
            </div>
            <p className="note">Buyers always pay in SOL. The stock is only what holders earn.</p>
          </section>

          <section className="fsec">
            <div className="fsec-h">
              <span className="n">3</span>
              <div>
                <h2>Links</h2>
                <p>All optional.</p>
              </div>
            </div>
            <div className="form-row fld">
              <div>
                <label className="lbl" htmlFor="fX">X account <em>optional</em></label>
                <input className={"tinput" + (cx.s === "fail" ? " bad" : "")} id="fX" placeholder="x.com/yourproject" value={d.x} onChange={set("x")} />
              </div>
              <div>
                <label className="lbl" htmlFor="fTg">Telegram <em>optional</em></label>
                <input className="tinput" id="fTg" placeholder="t.me/yourgroup" value={d.tg} onChange={set("tg")} />
              </div>
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="fWeb">Website <em>optional</em></label>
              <input className="tinput" id="fWeb" placeholder="https://" value={d.web} onChange={set("web")} />
            </div>
          </section>
        </form>

        <aside className="sticky stack">
          <div className="panel">
            <h3>Your coin on the board</h3>
            <div id="preview">
              <CoinCard
                asDiv
                c={{ name: d.name || "Your coin", ticker: t, imageUrl: previewImg, pays: d.pays, mcap: 2900, ch: 0, ageMin: 0, creatorLabel: "you", progress: 0, graduated: false, paidUsd: 0, holders: 1, spark: [] }}
              />
            </div>
          </div>
          <div className="panel">
            <h3>Checks</h3>
            <ul className="checks" id="checks">
              {checkRow("Ticker", ct)}
              {checkRow("Name", cn)}
              {checkRow("Picture", ci)}
              {checkRow("X account", cx)}
            </ul>
          </div>
          <div className="panel">
            <div className="sumline"><span>Cost to launch</span><b>{feeSol ? `${feeSol} SOL` : "Free"}</b></div>
            <div className="sumline"><span>Your share of every trade</span><b>{bpsLabel(config.fees.creatorBps)}</b></div>
            <div className="sumline"><span>Holders&apos; share</span><b id="holdShare">{bpsLabel(config.fees.holdersBps)} in {d.pays}</b></div>
            <div className="sumline"><span>Dev buy</span><b>None, for anyone</b></div>
            <button className="btn btn-g btn-lg" id="launchBtn" type="submit" form="frm" style={{ width: "100%", marginTop: 14 }} disabled={!ready || paying || (!config.launchesOpen && !me?.isAdmin) || !!me?.blocked}>
              Launch coin
            </button>
            <p className="note" id="launchHint" style={{ textAlign: "center", color: launchError ? "var(--red)" : undefined }}>
              {me?.blocked
                ? "uspad isn't available in your country."
                : launchError
                  ? launchError
                  : config.launchesOpen
                    ? hint
                    : me?.isAdmin
                      ? `Paused for everyone else; you can launch as an admin. ${hint}`
                      : (config.launchesPausedReason ?? "Launches are paused.")}
            </p>
          </div>
        </aside>
      </div>
      {launch && <LaunchModal launchId={launch.id} ticker={launch.ticker} img={launch.img} pays={launch.pays} onDone={done} onAnother={another} />}
    </>
  );
}
