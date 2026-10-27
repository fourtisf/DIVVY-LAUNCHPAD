"use client";

import { useEffect, useState } from "react";
import { useSWRConfig } from "swr";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { bpsLabel, num, sol, type CoinDetail, type TradeBuildResponse } from "@divvy/shared";
import { api } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { errorText } from "@/lib/session";
import { signAndSend } from "@/lib/tx";
import { Chip } from "../Chip";
import { useToast } from "../Toasts";

let lastSide: "buy" | "sell" = "buy";

/** Buy/sell box (prototype trade panel). Quotes are local estimates; the API builds the transaction. */
export function TradeBox({ coin }: { coin: CoinDetail }) {
  const config = useConfig();
  const toast = useToast();
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
  const wallet = publicKey?.toBase58() ?? null;
  const solUsd = config.quote.priceUsd;
  const price = coin.priceUsd;
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

  const v = parseAmount(amt);
  const f = config.fees;
  const keep = 1 - f.tradeFeeBps / 10_000;
  const recv =
    side === "buy" ? num(((v * solUsd * keep) / price) * (1 - Math.min(0.25, v / 40))) + " $" + coin.ticker : sol((v * price * keep) / solUsd);
  const balLabel = wallet ? (side === "buy" ? (bal.sol != null ? `Balance ${bal.sol.toFixed(3)} SOL` : "") : bal.tokens != null ? `Balance ${num(bal.tokens)} $${coin.ticker}` : "") : "";
  const feeLabel = `${+(f.tradeFeeBps / 100).toFixed(2)}%, ${f.holdersBps * 2 === f.tradeFeeBps ? "half of it" : `${bpsLabel(f.holdersBps)} of it`} to holders`;

  const pick = (s: "buy" | "sell") => {
    setSide(s);
    lastSide = s;
    setAmt(s === "buy" ? "0.5" : sellPreset);
  };

  const trade = async () => {
    if (!wallet) return setVisible(true);
    setBusy(true);
    setStage("wallet");
    try {
      const amountIn = toBaseUnits(amt, side === "buy" ? 9 : 6);
      if (!amountIn) return toast("Enter an amount like 0.5");
      const r = await api<TradeBuildResponse>("/api/trade/build", { method: "POST", body: JSON.stringify({ mint: coin.mint, side, amountIn, slippageBps, wallet }) });
      // Demo mode builds nothing to sign.
      if (r.tx === null) return toast(side === "buy" ? `Bought ${recv} (demo)` : `Sold for ${recv} (demo)`);
      // The server's numbers, checked before the wallet opens (audit): the minimum must match the slippage
      // you chose, and a quote far below the estimate shown here is put to you first.
      if (r.minOut.ui < r.expectedOut.ui * (1 - slippageBps / 10_000) * 0.999) return toast("The quote didn't match your slippage setting. Nothing was sent.");
      const unit = side === "buy" ? `$${coin.ticker}` : "SOL";
      const shownEstimate = side === "buy" ? ((v * solUsd * 0.99) / price) * (1 - Math.min(0.25, v / 40)) : (v * price * 0.99) / solUsd;
      if (r.expectedOut.ui < shownEstimate * 0.85 && !window.confirm(`You'd get about ${num(r.expectedOut.ui)} ${unit} (at least ${num(r.minOut.ui)}), less than shown. Continue?`)) return;
      if (r.priceImpactBps > 1500 && !window.confirm(`This trade moves the price by about ${(r.priceImpactBps / 100).toFixed(1)}%. Continue?`)) return;
      await signAndSend(walletCtx, connection, r.tx, { network: config.network, kind: "trade", coinMint: coin.mint }, () => setStage("confirming"));
      toast(side === "buy" ? `Bought ${num(r.expectedOut.ui)} $${coin.ticker}` : `Sold for ${sol(r.expectedOut.ui)}`);
      // The wallet's balances now, the coin's numbers once the indexer has seen the trade (it polls every 4 s).
      setBalTick((t) => t + 1);
      for (const ms of [2_500, 7_000]) {
        setTimeout(() => {
          setBalTick((t) => t + 1);
          void mutate((k) => typeof k === "string" && k.startsWith(`/api/coins/${coin.mint}`));
        }, ms);
      }
    } catch (e) {
      // Errors after sending come back with their own wording; this one is only for before.
      console.error("trade", e);
      const m = errorText(e, "The trade didn't go through. Nothing was sent.");
      if (m) toast(m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="panel">
      <div className="toggle" role="group" aria-label="Buy or sell">
        <button type="button" className="b" aria-pressed={side === "buy"} onClick={() => pick("buy")}>Buy</button>
        <button type="button" className="s" aria-pressed={side === "sell"} onClick={() => pick("sell")}>Sell</button>
      </div>
      <label className="field">
        <span>
          <span id="payLbl">{side === "buy" ? "You pay" : "You sell"}</span>
          <span className="faint" id="bal">{balLabel}</span>
        </span>
        <div className="input">
          <input id="amt" inputMode="decimal" value={amt} onChange={(e) => setAmt(e.target.value)} aria-label="Amount" />
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
      <div className="kv"><span>You receive</span><b id="recv">{recv}</b></div>
      <div className="kv"><span>Route</span><b id="route">{side === "buy" ? (graduated ? "SOL into the Raydium pool" : "SOL into the bonding curve") : graduated ? "Raydium pool to SOL" : "Bonding curve to SOL"}</b></div>
      <div className="kv"><span>Trading fee</span><b>{feeLabel}</b></div>
      {live && (
        <div className="kv">
          <span>Max slippage</span>
          <b>
            <select className="slip" aria-label="Max slippage" value={slippageBps} onChange={(e) => setSlippageBps(Number(e.target.value))}>
              {[50, 100, 200, 500].map((b) => (
                <option key={b} value={b}>{b / 100}%</option>
              ))}
            </select>
          </b>
        </div>
      )}
      <button
        className={"btn btn-lg " + (!wallet || side === "buy" ? "btn-g" : "btn-red")}
        style={{ width: "100%", marginTop: 14 }}
        id="tradeBtn"
        type="button"
        disabled={(!!wallet && !(v > 0)) || busy}
        onClick={trade}
      >
        {!wallet
          ? "Connect wallet to trade"
          : busy
            ? stage === "confirming"
              ? "Confirming on Solana…"
              : "Approve in your wallet…"
            : side === "buy"
              ? `Buy $${coin.ticker}`
              : `Sell $${coin.ticker}`}
      </button>
      {graduated ? (
        <p className="note">Graduated. Trades go to the Raydium pool.</p>
      ) : (
        <div style={{ marginTop: 16 }}>
          <div className="bar-row">
            <span>Bonding curve, graduates at {usdShort(config.graduation.targetUsd)}</span>
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
