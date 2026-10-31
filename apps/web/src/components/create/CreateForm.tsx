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
  DEV_BUY_ACCOUNTS_LAMPORTS,
  devBuyEstimate,
  displayTicker,
  pct,
  type CheckResponse,
  type LaunchStatus,
  type UploadResponse,
} from "@divvy/shared";
import { api, ApiRequestError, qs } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { useDebounced } from "@/lib/hooks";
import { useErrorText, useSession } from "@/lib/session";
import { useMsgs } from "@/i18n/client";
import { common } from "@/i18n/msgs/common";
import { create } from "@/i18n/msgs/create";
import { Chip } from "../Chip";
import { CoinCard } from "../CoinCard";
import { Icon } from "../Icon";
import { useToast } from "../Toasts";
import { LaunchModal } from "./LaunchModal";
import { coinHref } from "@/lib/links";
import { DEV_BUY_PICKS, maxDevBuy, parseDevBuy, shareLabel, solText } from "@/lib/devbuy";

interface Draft {
  name: string;
  ticker: string;
  desc: string;
  pays: string;
  x: string;
  tg: string;
  web: string;
  /** The creator's dev buy in SOL, as typed (owner decision 2026-10-28). */
  dev: string;
  /** Local preview URL and the server's answer for the uploaded picture. */
  imgPreview: string | null;
  upload: UploadResponse | null;
}

// Kept across page changes, like the prototype's `draft`.
let saved: Draft = { name: "", ticker: "", desc: "", pays: "NVDAx", x: "", tg: "", web: "", dev: "", imgPreview: null, upload: null };

type Check = { s: "idle" | "ok" | "fail"; m: string };
/** The picture's check: the server's message as it came, or the page's own in the visitor's language. */
type ImgCheck = { s: Check["s"]; m: string | ((c: (typeof create)["en"]) => string) };
const toCheck = (r: { status: Check["s"]; message: string } | undefined, idle: string): Check => (r ? { s: r.status, m: r.message } : { s: "idle", m: idle });

/**
 * A launch fee this wallet paid on its own, before the fee moved into the coin's create (2026-10-27),
 * that no launch used. The next launch hands it to the API, which credits it: that launch's create then
 * carries no fee. Read only; nothing new is written here.
 */
const heldFee = {
  get(w: string): string | null {
    try {
      const raw = w ? sessionStorage.getItem(`uspad:launch-fee:${w}`) : null;
      if (!raw) return null;
      if (/^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(raw)) return raw;
      const v = JSON.parse(raw);
      return typeof v?.sig === "string" ? v.sig : null;
    } catch {
      return null;
    }
  },
  clear(w: string) {
    try {
      sessionStorage.removeItem(`uspad:launch-fee:${w}`);
    } catch {
      /* storage off */
    }
  },
};

export function CreateForm() {
  const config = useConfig();
  const toast = useToast();
  const router = useRouter();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const { me, ensureSignedIn } = useSession();
  const t = useMsgs(create);
  const tc = useMsgs(common);
  const errText = useErrorText();
  const [d, setD] = useState<Draft>(saved);
  const [imgCheck, setImgCheck] = useState<ImgCheck>(() => (saved.upload ? { s: saved.upload.check.status, m: saved.upload.check.message } : { s: "idle", m: (c) => c.uploadPicture }));
  const [over, setOver] = useState(false);
  const [launch, setLaunch] = useState<{ id: string; ticker: string; img: string; pays: string; devBuy: bigint } | null>(null);
  // Why the last launch didn't happen, kept under the button: a toast alone is gone in 2.6 s.
  const [launchError, setLaunchError] = useState<string | null>(null);
  // The creator's wallet pays for the coin's create (owner decision 2026-10-27): the launch fee inside it,
  // and about what the create itself costs.
  const feeSol = config.launchFee.to ? config.launchFee.amount.ui : 0;
  const createSol = config.launchFee.createCost.ui;
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
  const ct = d.ticker.trim() ? toCheck(checks?.ticker, t.checking) : { s: "idle" as const, m: t.typeTicker };
  const cn = d.name.trim() ? toCheck(checks?.name, t.checking) : { s: "idle" as const, m: t.typeName };
  // The project's X link (owner decision 2026-10-27): typed like the Telegram link, one coin per account.
  const cx = d.x.trim() ? toCheck(checks?.x, t.checking) : { s: "ok" as const, m: t.optionalCheck };
  const stale = dq.ticker !== d.ticker || dq.name !== d.name || dq.x !== d.x;
  const ci: Check = { s: imgCheck.s, m: typeof imgCheck.m === "string" ? imgCheck.m : imgCheck.m(t) };
  // The dev buy: none when empty; about what it gets on the empty curve, after the trade fee.
  const devBuy = parseDevBuy(d.dev);
  const devSol = devBuy ? Number(devBuy) / 1e9 : 0;
  const devShare = devBuy ? devBuyEstimate(devBuy, config.fees.tradeFeeBps).pct : 0;

  const handleFile = async (f: File | undefined) => {
    if (!f) return;
    if (!config.limits.imageTypes.includes(f.type)) return setImgCheck({ s: "fail", m: (c) => c.imageType });
    if (f.size > config.limits.imageMaxBytes) return setImgCheck({ s: "fail", m: (c) => c.imageTooBig(Math.round(config.limits.imageMaxBytes / 1024 / 1024)) });
    if (!config.demo) {
      try {
        if (!(await ensureSignedIn())) return setImgCheck({ s: "idle", m: (c) => c.connectToUpload });
      } catch (e) {
        return setImgCheck({ s: "idle", m: errText(e, t.signInToUpload) ?? t.signInToUpload });
      }
    }
    const preview = URL.createObjectURL(f);
    setD((p) => ({ ...p, imgPreview: preview, upload: null }));
    setImgCheck({ s: "idle", m: (c) => c.checkingPicture });
    const fd = new FormData();
    fd.append("file", f);
    try {
      const r = await api<UploadResponse>("/api/upload", { method: "POST", body: fd });
      setD((p) => ({ ...p, upload: r }));
      setImgCheck({ s: r.check.status, m: r.check.message });
    } catch (e) {
      setImgCheck({ s: "fail", m: e instanceof ApiRequestError ? e.message : (c) => c.uploadFailed });
    }
  };

  // "Max": what the wallet holds less what the launch itself costs (owner request 2026-10-28).
  const [maxBusy, setMaxBusy] = useState(false);
  const pickMax = async () => {
    if (!publicKey) return setVisible(true);
    setMaxBusy(true);
    try {
      const lamports = await connection.getBalance(publicKey, "confirmed");
      const max = maxDevBuy(BigInt(lamports), config.launchFee.to ? BigInt(config.launchFee.amount.raw) : 0n, BigInt(config.launchFee.createCost.raw));
      if (max === null) toast(t.devTooPoor);
      else setD((p) => ({ ...p, dev: solText(max) }));
    } catch {
      toast(t.balanceFailed);
    } finally {
      setMaxBusy(false);
    }
  };

  const ready = !stale && ct.s === "ok" && cn.s === "ok" && cx.s !== "fail" && ci.s === "ok" && devBuy !== null;
  const costs = [feeSol ? t.costFee(feeSol) : null, createSol ? t.costCreate(createSol) : null, devSol ? t.costDev(devSol, Number(DEV_BUY_ACCOUNTS_LAMPORTS) / 1e9) : null].filter(Boolean) as string[];
  const hint =
    ct.s !== "ok"
      ? t.fixTicker
      : cn.s !== "ok"
        ? t.fixName
        : ci.s !== "ok"
          ? t.fixPicture
          : cx.s === "fail"
            ? t.fixX
            : devBuy === null
              ? t.fixDev
              : costs.length
                ? t.readyApproves(costs)
                : t.readyFree;

  const tick = displayTicker(d.ticker) || "TICKER";
  const previewImg = d.upload?.url ?? d.imgPreview ?? avatarDataUri(tick);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready || !d.upload) return;
    // Demo mode keeps the prototype's flow (launch without a wallet). Live mode needs a signed-in wallet.
    if (!publicKey && !config.demo) return setVisible(true);
    setLaunchError(null);
    const wallet = publicKey?.toBase58() ?? "";
    try {
      if (!config.demo && !(await ensureSignedIn())) return;
      // The launch modal takes it from here: the wallet signs the create when the server hands it over.
      const feeSig = heldFee.get(wallet) ?? undefined;
      const res = await api<{ launchId: string }>("/api/launch", {
        method: "POST",
        body: JSON.stringify({
          name: d.name, ticker: d.ticker, description: d.desc, imageId: d.upload.imageId, dividendAsset: d.pays, x: d.x, telegram: d.tg, website: d.web, feeSig,
          devBuyLamports: (devBuy ?? 0n).toString(),
        }),
      });
      if (feeSig) heldFee.clear(wallet);
      setLaunch({ id: res.launchId, ticker: tick, img: d.upload.url, pays: d.pays, devBuy: devBuy ?? 0n });
    } catch (err) {
      const m = errText(err, t.launchFailed);
      if (m) {
        toast(m);
        setLaunchError(m);
      }
    }
  };

  const blank = (): Draft => ({ name: "", ticker: "", desc: "", pays: d.pays, x: "", tg: "", web: "", dev: "", imgPreview: null, upload: null });
  const another = () => {
    setLaunch(null);
    saved = blank();
    setD(saved);
    setImgCheck({ s: "idle", m: (c) => c.uploadPicture });
  };

  const done = (s: LaunchStatus) => {
    setLaunch(null);
    if (s.step === "indexed") {
      saved = blank();
      router.push(coinHref(s));
      toast(t.isLive(s.ticker));
    } else {
      const m = s.error?.message ?? t.launchFailedNothing;
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
      <Link className="back" href="/"><Icon name="back" />{tc.backToBoard}</Link>
      <div className="create-head">
        <h1>{t.title}</h1>
        <p>{feeSol || createSol ? t.headPaid(feeSol, createSol) : t.headFree}</p>
      </div>
      <div className="create-grid">
        <form id="frm" noValidate onSubmit={submit}>
          <section className="fsec">
            <div className="fsec-h">
              <span className="n">1</span>
              <div>
                <h2>{t.coinTitle}</h2>
                <p>{t.coinNote}</p>
              </div>
            </div>
            <div className="form-row fld">
              <div>
                <label className="lbl" htmlFor="fName">{t.name}</label>
                <input className={"tinput" + (cn.s === "fail" ? " bad" : "")} id="fName" maxLength={config.limits.nameMaxLen} placeholder={t.namePlaceholder} value={d.name} onChange={set("name")} />
              </div>
              <div>
                <label className="lbl" htmlFor="fTick">{t.ticker}</label>
                <input className={"tinput" + (ct.s === "fail" ? " bad" : "")} id="fTick" maxLength={12} placeholder="CHIPDOG" value={d.ticker} onChange={set("ticker")} style={{ textTransform: "uppercase" }} />
              </div>
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="fDesc">{t.description} <em>{t.optional}</em></label>
              <textarea className="tinput" id="fDesc" maxLength={config.limits.descriptionMaxLen} placeholder={t.descPlaceholder} value={d.desc} onChange={set("desc")} />
            </div>
            <div className="fld">
              <span className="lbl">{t.picture}</span>
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
                  <img src={d.imgPreview ?? d.upload!.url} alt={t.pictureAlt} />
                ) : (
                  <span className="ph"><Icon name="img" size={22} /></span>
                )}
                <p>
                  {t.drop}
                  <small>{t.dropLimit(Math.round(config.limits.imageMaxBytes / 1024 / 1024))}</small>
                </p>
              </label>
              <input ref={fileInput} type="file" id="fImg" accept={config.limits.imageTypes.join(",")} className="sr" onChange={(e) => void handleFile(e.target.files?.[0])} />
            </div>
          </section>

          <section className="fsec">
            <div className="fsec-h">
              <span className="n">2</span>
              <div>
                <h2>{t.dividendTitle}</h2>
                <p>{t.dividendNote}</p>
              </div>
            </div>
            <div className="stocks" role="radiogroup" aria-label={t.dividendStock}>
              {config.dividendAssets
                .filter((a) => a.enabled)
                .map((s) => (
                  <button type="button" role="radio" className="stock-opt" key={s.symbol} aria-checked={d.pays === s.symbol} onClick={() => setD((p) => ({ ...p, pays: s.symbol }))}>
                    <Chip sym={s.symbol} />
                    <div style={{ minWidth: 0 }}>
                      <b>{s.symbol}</b>
                      <span>
                        <span>{s.name}</span>
                        <span className={s.change24hPct > 0 ? "up" : s.change24hPct < 0 ? "down" : ""}>{s.change24hPct ? pct(s.change24hPct) : t.stable}</span>
                      </span>
                    </div>
                  </button>
                ))}
            </div>
            <p className="note">{t.paysNote}</p>
          </section>

          <section className="fsec">
            <div className="fsec-h">
              <span className="n">3</span>
              <div>
                <h2>{t.linksTitle}</h2>
                <p>{t.linksNote}</p>
              </div>
            </div>
            <div className="form-row fld">
              <div>
                <label className="lbl" htmlFor="fX">{t.xAccount} <em>{t.optional}</em></label>
                <input className={"tinput" + (cx.s === "fail" ? " bad" : "")} id="fX" placeholder="x.com/yourproject" value={d.x} onChange={set("x")} />
              </div>
              <div>
                <label className="lbl" htmlFor="fTg">Telegram <em>{t.optional}</em></label>
                <input className="tinput" id="fTg" placeholder="t.me/yourgroup" value={d.tg} onChange={set("tg")} />
              </div>
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="fWeb">{t.website} <em>{t.optional}</em></label>
              <input className="tinput" id="fWeb" placeholder="https://" value={d.web} onChange={set("web")} />
            </div>
          </section>

          <section className="fsec">
            <div className="fsec-h">
              <span className="n">4</span>
              <div>
                <h2>{t.devBuy}</h2>
                <p>{t.devNote}</p>
              </div>
            </div>
            <div className="fld">
              <label className="lbl" htmlFor="fDev">{t.devAmount} <em>{t.optional}</em></label>
              <input className={"tinput" + (devBuy === null ? " bad" : "")} id="fDev" inputMode="decimal" autoComplete="off" placeholder="0" value={d.dev} onChange={set("dev")} />
              <div className="quick" id="devQuick">
                {DEV_BUY_PICKS.map((q) => (
                  <button type="button" key={q} aria-pressed={d.dev === q} onClick={() => (setLaunchError(null), setD((p) => ({ ...p, dev: q })))}>
                    {q} SOL
                  </button>
                ))}
                <button type="button" id="devMax" disabled={maxBusy} title={t.maxTitle} onClick={() => void pickMax()}>
                  {maxBusy ? "…" : t.max}
                </button>
              </div>
            </div>
            <p className="note" id="devNote">
              {devBuy === null
                ? t.devRange
                : devBuy
                  ? t.devShare(shareLabel(devShare))
                  : t.devEmpty}
            </p>
          </section>
        </form>

        <aside className="sticky stack">
          <div className="panel">
            <h3>{t.previewTitle}</h3>
            <div id="preview">
              <CoinCard
                asDiv
                c={{ name: d.name || t.previewName, ticker: tick, imageUrl: previewImg, pays: d.pays, mcap: 2900, ch: 0, ageMin: 0, creatorLabel: t.previewCreator, progress: 0, graduated: false, paidUsd: 0, holders: 1, spark: [] }}
              />
            </div>
          </div>
          <div className="panel">
            <h3>{t.checksTitle}</h3>
            <ul className="checks" id="checks">
              {checkRow(t.ticker, ct)}
              {checkRow(t.name, cn)}
              {checkRow(t.picture, ci)}
              {checkRow(t.xAccount, cx)}
            </ul>
          </div>
          <div className="panel">
            <div className="sumline"><span>{t.costToLaunch}</span><b>{feeSol || createSol ? `${feeSol ? `${feeSol} + ` : ""}~${createSol} SOL` : t.free}</b></div>
            <div className="sumline"><span>{t.yourShare}</span><b>{bpsLabel(config.fees.creatorBps)}</b></div>
            <div className="sumline"><span>{t.holdersShare}</span><b id="holdShare">{t.holdersShareValue(bpsLabel(config.fees.holdersBps), d.pays)}</b></div>
            <div className="sumline"><span>{t.devBuy}</span><b id="devSum">{devSol ? t.devSum(devSol, shareLabel(devShare)) : t.none}</b></div>
            <button className="btn btn-g btn-lg" id="launchBtn" type="submit" form="frm" style={{ width: "100%", marginTop: 14 }} disabled={!ready || (!config.launchesOpen && !me?.isAdmin) || !!me?.blocked}>
              {t.launchCoin}
            </button>
            <p className="note" id="launchHint" style={{ textAlign: "center", color: launchError ? "var(--red)" : undefined }}>
              {me?.blocked
                ? t.blocked
                : launchError
                  ? launchError
                  : config.launchesOpen
                    ? hint
                    : me?.isAdmin
                      ? t.adminPaused(hint)
                      : (config.launchesPausedReason ?? t.paused)}
            </p>
          </div>
        </aside>
      </div>
      {launch && <LaunchModal launchId={launch.id} ticker={launch.ticker} img={launch.img} pays={launch.pays} devBuy={launch.devBuy} onDone={done} onAnother={another} />}
    </>
  );
}
