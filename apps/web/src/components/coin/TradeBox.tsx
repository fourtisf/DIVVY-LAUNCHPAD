"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import { num, sol, type CoinDetail, type TradeBuildResponse } from "@divvy/shared";
import { api, ApiRequestError } from "@/lib/api";
import { useConfig } from "@/lib/config";
import { Chip } from "../Chip";
import { useToast } from "../Toasts";

let lastSide: "buy" | "sell" = "buy";

/** Buy/sell box (prototype trade panel). Quotes are local estimates; the API builds the transaction. */
export function TradeBox({ coin }: { coin: CoinDetail }) {
  const config = useConfig();
  const toast = useToast();
  const { publicKey } = useWallet();
  const { connection } = useConnection();
  const { setVisible } = useWalletModal();
  const [side, setSide] = useState<"buy" | "sell">(lastSide);
  const [amt, setAmt] = useState(side === "buy" ? "0.5" : "1000000");
  const [bal, setBal] = useState<{ sol: number | null; tokens: number | null }>({ sol: null, tokens: null });
  const [busy, setBusy] = useState(false);
  const wallet = publicKey?.toBase58() ?? null;
  const solUsd = config.quote.priceUsd;
  const price = coin.priceUsd;
  const graduated = coin.status === "graduated";

  // Balances only when an RPC is configured; the public endpoint is too rate-limited to poll.
  useEffect(() => {
    if (!publicKey || !process.env.NEXT_PUBLIC_SOLANA_RPC_URL) return setBal({ sol: null, tokens: null });
    let off = false;
    (async () => {
      const lamports = await connection.getBalance(publicKey).catch(() => null);
      const accts = await connection.getParsedTokenAccountsByOwner(publicKey, { mint: new PublicKey(coin.mint) }).catch(() => null);
      const tokens = accts ? accts.value.reduce((a, x) => a + (x.account.data.parsed?.info?.tokenAmount?.uiAmount ?? 0), 0) : null;
      if (!off) setBal({ sol: lamports == null ? null : lamports / 1e9, tokens });
    })();
    return () => {
      off = true;
    };
  }, [publicKey, connection, coin.mint]);

  const v = parseFloat((amt || "0").replace(",", ".")) || 0;
  const recv =
    side === "buy" ? num(((v * solUsd * 0.99) / price) * (1 - Math.min(0.25, v / 40))) + " $" + coin.ticker : sol((v * price * 0.99) / solUsd);
  const balLabel = wallet ? (side === "buy" ? (bal.sol != null ? `Balance ${bal.sol.toFixed(3)} SOL` : "") : bal.tokens != null ? `Balance ${num(bal.tokens)} $${coin.ticker}` : "") : "";
  const f = config.fees;
  const feeLabel = `${f.tradeFeeBps / 100}%, ${f.holdersBps * 2 === f.tradeFeeBps ? "half of it" : `${f.holdersBps / 100}% of it`} to holders`;

  const pick = (s: "buy" | "sell") => {
    setSide(s);
    lastSide = s;
    setAmt(s === "buy" ? "0.5" : "1000000");
  };

  const trade = async () => {
    if (!wallet) return setVisible(true);
    setBusy(true);
    try {
      const amountIn = side === "buy" ? BigInt(Math.round(v * 1e9)).toString() : BigInt(Math.round(v * 1e6)).toString();
      const r = await api<TradeBuildResponse>("/api/trade/build", { method: "POST", body: JSON.stringify({ mint: coin.mint, side, amountIn, slippageBps: 100, wallet }) });
      // Signing and sending the built transaction arrives with Phase 3; in demo mode there is no tx.
      if (r.tx === null) toast(side === "buy" ? `Bought ${recv} (demo)` : `Sold for ${recv} (demo)`);
    } catch (e) {
      toast(e instanceof ApiRequestError ? e.message : "Couldn't build the trade");
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
                <button type="button" key={q} onClick={() => bal.tokens != null && setAmt(String(Math.round((bal.tokens * parseFloat(q)) / 100)))}>
                  {q}
                </button>
              ))}
        </div>
      </label>
      <div className="kv"><span>You receive</span><b id="recv">{recv}</b></div>
      <div className="kv"><span>Route</span><b id="route">{side === "buy" ? (graduated ? "SOL into the Raydium pool" : "SOL into the bonding curve") : graduated ? "Raydium pool to SOL" : "Bonding curve to SOL"}</b></div>
      <div className="kv"><span>Trading fee</span><b>{feeLabel}</b></div>
      <button
        className={"btn btn-lg " + (!wallet || side === "buy" ? "btn-g" : "btn-red")}
        style={{ width: "100%", marginTop: 14 }}
        id="tradeBtn"
        type="button"
        disabled={(!!wallet && !(v > 0)) || busy}
        onClick={trade}
      >
        {wallet ? (side === "buy" ? `Buy $${coin.ticker}` : `Sell $${coin.ticker}`) : "Connect wallet to trade"}
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

/** "$48k" style, as in the prototype copy. */
const usdShort = (v: number) => (v >= 1e6 ? `$${+(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${Math.round(v / 1e3)}k` : `$${Math.round(v)}`);
