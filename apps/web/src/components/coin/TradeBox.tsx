"use client";

import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { bpsLabel, num, sol, type CoinDetail, type TradeBuildResponse } from "@divvy/shared";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { useErrorText } from "@/lib/session";
import { poolFees } from "@/lib/poolfees";
import { explorerTx, FailedOnChain, SentUnconfirmed, signAndSend, TxExpired } from "@/lib/tx";
import { useMsgs } from "@/i18n/client";
import { tradeMsgs } from "@/i18n/msgs/coin";
import { Chip } from "../Chip";
import { useToast } from "../Toasts";

let lastSide: "buy" | "sell" = "buy";

/** Buy/sell box (prototype trade panel). Quotes are local estimates; the API builds the transaction. */
export function TradeBox({ coin }: { coin: CoinDetail }) {
  const config = useConfig();
  const toast = useToast();
  const t = useMsgs(tradeMsgs);
  const errorText = useErrorText();
  const walletCtx = useWallet();
  const { publicKey } = walletCtx;
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [side, setSide] = useState<"buy" | "sell">(lastSide);
  const live = config.flags.trading;
  // Demo keeps the prototype's preset; live starts a sell empty so nobody sells a default by accident.
  const sellPreset = live ? "" : "1000000";
  const [amt, setAmt] = useState(side === "buy" ? "0.5" : sellPreset);
  const [bal, setBal] = useState<{ sol: number | null; tokens: number | null; tokensRaw: bigint | null }>({ sol: null, tokens: null, tokensRaw: null });
  const [busy, setBusy] = useState(false);
  // Bumped after a trade, so the balances are read again.
  const [balTick, setBalTick] = useState(0);
  const { mutate } = useSWRConfig();
  // What a trade in progress is waiting for, on the button: the wallet's approval, then the network.
  const [stage, setStage] = useState<"wallet" | "confirming">("wallet");
  const [slippageBps, setSlippageBps] = useState(100);
  // A trade that was sent but whose confirmation never came: no new trade until it's checked (audit).
  const [unconfirmed, setUnconfirmed] = useState<string | null>(null);
  // The last trade that failed on chain or expired: Solscan says why.
  const [failed, setFailed] = useState<{ sig: string; expired: boolean } | null>(null);
  const wallet = publicKey?.toBase58() ?? null;
  // In SOL, as the coin is priced: the layout's SOL price is only as fresh as the first page load (audit).
  const price = coin.priceSol;
  const graduated = coin.status === "graduated";

  // Balances only when an RPC is configured; the public endpoint is too rate-limited to poll.
  useEffect(() => {
    if (!publicKey || !process.env.NEXT_PUBLIC_SOLANA_RPC_URL) return setBal({ sol: null, tokens: null, tokensRaw: null });
    let off = false;
    (async () => {
      const lamports = await connection.getBalance(publicKey).catch(() => null);
      const accts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(coin.mint) }).catch(() => null);
      // Raw base units, so "100%" sells exactly the balance (a float can round above it).
      const tokensRaw = accts ? accts.value.reduce((a, x) => a + BigInt(x.account.data.parsed?.info?.tokenAmount?.amount ?? "0"), 0n) : null;
      if (!off) setBal({ sol: lamports == null ? null : lamports / 1e9, tokens: tokensRaw === null ? null : Number(tokensRaw) / 1e6, tokensRaw });
    })();
    return () => {
      off = true;
    };
  }, [publicKey, connection, coin.mint, balTick]);

  // The confirmation may still turn up: look for it now and then, and clear the hold once it's settled.
  useEffect(() => {
    if (!unconfirmed) return;
    const timer = setInterval(async () => {
      const st = (await connection.getSignatureStatuses([unconfirmed], { searchTransactionHistory: true }).catch(() => null))?.value[0];
      if (st?.err || st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") {
        setUnconfirmed(null);
        setBalTick((n) => n + 1);
        toast(st.err ? t.lastFailed : t.lastWentThrough);
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [unconfirmed, connection, toast, t]);

  const v = parseAmount(amt);
  const f = config.fees;
  // A graduated coin trades in its Raydium pool, which has its own fee (lib/poolfees.ts).
  const pool = poolFees(f.afterGraduation);
  const feeBps = graduated ? pool.total : f.tradeFeeBps;
  const holdersBps = graduated ? pool.holders : f.holdersBps;
  const keep = 1 - feeBps / 10_000;
  // Local estimates only (the API quotes the real amount); none without a price.
  const estimate = !(price > 0) ? null : side === "buy" ? ((v * keep) / price) * (1 - Math.min(0.25, v / 40)) : v * price * keep;
  const recv = estimate === null ? "–" : side === "buy" ? num(estimate) + " $" + coin.ticker : sol(estimate);
  const balLabel = wallet ? (side === "buy" ? (bal.sol != null ? t.balanceSol(bal.sol.toFixed(3)) : "") : bal.tokens != null ? t.balanceTokens(num(bal.tokens), coin.ticker) : "") : "";
  const feeLabel = t.feeLabel(String(+(feeBps / 100).toFixed(2)), holdersBps * 2 === feeBps ? null : bpsLabel(holdersBps));

  const pick = (s: "buy" | "sell") => {
    setSide(s);
    lastSide = s;
    setAmt(s === "buy" ? "0.5" : sellPreset);
  };

  const trade = async () => {
    if (!wallet) return setVisible(true);
    setBusy(true);
    setStage("wallet");
    setFailed(null);
    try {
      const amountIn = toBaseUnits(amt, side === "buy" ? 9 : 6);
      if (!amountIn) return toast(t.enterAmount);
      const r = await api<TradeBuildResponse>("/api/trade/build", { method: "POST", body: JSON.stringify({ mint: coin.mint, side, amountIn, slippageBps, wallet }) });
      // Demo mode builds nothing to sign.
      if (r.tx === null) return toast(side === "buy" ? t.demoBought(recv) : t.demoSold(recv));
      // The server's numbers, checked before the wallet opens (audit): the minimum must match the slippage
      // you chose, and a quote far below the estimate shown here is put to you first.
      if (r.minOut.ui < r.expectedOut.ui * (1 - slippageBps / 10_000) * 0.999) return toast(t.quoteMismatch);
      const unit = side === "buy" ? `$${coin.ticker}` : "SOL";
      if (estimate !== null && r.expectedOut.ui < estimate * 0.85 && !window.confirm(t.lessThanShown(num(r.expectedOut.ui), unit, num(r.minOut.ui)))) return;
      if (r.priceImpactBps > 1500 && !window.confirm(t.priceImpact((r.priceImpactBps / 100).toFixed(1)))) return;
      await signAndSend(walletCtx, connection, r.tx, { network: config.network, kind: "trade", coinMint: coin.mint }, () => setStage("confirming"));
      toast(side === "buy" ? t.bought(num(r.expectedOut.ui), coin.ticker) : t.sold(sol(r.expectedOut.ui)));
      // The wallet's balances now, the coin's numbers once the indexer has seen the trade (it polls every 4 s).
      setBalTick((n) => n + 1);
      for (const ms of [2_500, 7_000]) {
        setTimeout(() => {
          setBalTick((n) => n + 1);
          void mutate((k) => typeof k === "string" && k.startsWith(`/api/coins/${coin.mint}`));
        }, ms);
      }
    } catch (e) {
      if (e instanceof SentUnconfirmed) setUnconfirmed(e.signature);
      if (e instanceof FailedOnChain || e instanceof TxExpired) setFailed({ sig: e.signature, expired: e instanceof TxExpired });
      // Errors after sending come back with their own wording; this one is only for before.
      console.error("trade", e);
      const m = errorText(e, t.tradeFailed);
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="toggle" role="group" aria-label={t.buyOrSell}>
        <button type="button" className="b" aria-pressed={side === "buy"} onClick={() => pick("buy")}>{t.buy}</button>
        <button type="button" className="s" aria-pressed={side === "sell"} onClick={() => pick("sell")}>{t.sell}</button>
      </div>
      <label className="field">
        <span>
          <span id="payLbl">{side === "buy" ? t.youPay : t.youSell}</span>
          <span className="faint" id="bal">{balLabel}</span>
        </span>
        <div className="input">
          <input id="amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label={t.amount} />
          <span className="unit" id="unit">
            {side === "buy" ? (
              <>
                <Chip sym="SOL" />SOL
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={coin.imageUrl} alt="" style={{ width: 26, height: 26, borderRadius: "50%" }} />${coin.ticker}
              </>
            )}
          </span>
        </div>
        <div className="quick" id="quick">
          {side === "buy"
            ? ["0.1", "0.5", "1", "5"].map((q) => (
                <button type="button" key={q} onClick={() => setAmt(q)}>{q} SOL</button>
              ))
            : ["25%", "50%", "100%"].map((q) => (
                <button type="button" key={q} onClick={() => bal.tokensRaw != null && setAmt(fromBaseUnits((bal.tokensRaw * BigInt(parseInt(q, 10))) / 100n, 6))}>
                  {q}
                </button>
              ))}
        </div>
      </label>
      <div className="kv"><span>{t.youReceive}</span><b id="recv">{recv}</b></div>
      <div className="kv"><span>{t.route}</span><b id="route">{side === "buy" ? (graduated ? t.routeBuyPool : t.routeBuyCurve) : graduated ? t.routeSellPool : t.routeSellCurve}</b></div>
      <div className="kv"><span>{t.tradingFee}</span><b>{feeLabel}</b></div>
      {live && (
        <div className="kv">
          <span>{t.maxSlippage}</span>
          <b>
            <select className="slip" aria-label={t.maxSlippage} value={slippageBps} onChange={(e) => setSlippageBps(Number(e.target.value))}>
              {[50, 100, 200, 500].map((b) => (
                <option key={b} value={b}>{b / 100}%</option>
              ))}
            </select>
          </b>
        </div>
      )}
      <button
        className={"btn btn-lg " + (!wallet ? "btn-g" : side === "buy" ? "btn-buy" : "btn-sell")}
        style={{ width: "100%", marginTop: 14 }}
        id="tradeBtn"
        type="button"
        disabled={(!!wallet && (!(v > 0) || !!unconfirmed)) || busy}
        onClick={trade}
      >
        {!wallet
          ? t.connectToTrade
          : busy
            ? stage === "confirming"
              ? t.confirming
              : t.approve
            : side === "buy"
              ? t.buyTicker(coin.ticker)
              : t.sellTicker(coin.ticker)}
      </button>
      {failed && (
        <p className="note" role="status" id="tradeFailed">
          {t.failedNote(failed.expired, (text) => (
            <a className="link" href={explorerTx(failed.sig, config.network)} target="_blank" rel="noreferrer">{text}</a>
          ))}
        </p>
      )}
      {unconfirmed && (
        <p className="note" role="status">
          {t.unconfirmedNote((text) => (
            <a className="link" href={explorerTx(unconfirmed, config.network)} target="_blank" rel="noreferrer">{text}</a>
          ))}{" "}
          <button type="button" className="link" onClick={() => setUnconfirmed(null)}>{t.iChecked}</button>
        </p>
      )}
      {graduated ? (
        <p className="note">{t.graduated}</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          <div className="bar-row">
            <span>{t.curve(usdShort(config.graduation.targetUsd))}</span>
            <span>{Math.round(coin.progress * 100)}%</span>
          </div>
          <div className="bar">
            <i style={{ width: (coin.progress * 100).toFixed(1) + "%" }} />
          </div>
        </div>
      )}
    </div>
  );
}

/** "0.5" or "0,5" (one decimal separator, no thousands separators); anything else is 0. */
function parseAmount(s: string): number {
  const t = s.trim();
  return /^\d+([.,]\d+)?$/.test(t) ? Number(t.replace(",", ".")) : 0;
}

/** Exact base units from the typed amount, without going through a float; null if it isn't a valid amount. */
function toBaseUnits(s: string, decimals: number): string | null {
  const t = s.trim().replace(",", ".");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(t);
  if (!m || (m[2]?.length ?? 0) > decimals) return null;
  const v = BigInt(m[1]!) * 10n ** BigInt(decimals) + BigInt((m[2] ?? "").padEnd(decimals, "0") || "0");
  return v > 0n ? v.toString() : null;
}

function fromBaseUnits(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return s.slice(0, -decimals) + (frac ? "." + frac : "");
}

/** "$48k" style, as in the prototype copy. */
const usdShort = (v: number) => (v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
