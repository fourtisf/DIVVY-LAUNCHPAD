"use client";

import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { checkTransaction, type TxKind } from "./txcheck";
import { txErrors } from "../i18n/msgs/errors";

/** The transaction was broadcast but its confirmation wasn't seen: it may still land (audit). */
export class SentUnconfirmed extends Error {
  override name = "SentUnconfirmed";
  constructor(readonly signature: string) {
    super(txErrors.en.sentUnconfirmed);
  }
}

/** Its blockhash expired and the chain has no trace of it: it can't land any more, and nothing was spent. */
export class TxExpired extends Error {
  override name = "TxExpired";
  constructor(readonly signature: string) {
    super(txErrors.en.expired);
  }
}

/** It landed and failed (slippage, a price that moved): Solscan shows why. */
export class FailedOnChain extends Error {
  override name = "FailedOnChain";
  constructor(readonly signature: string) {
    super(txErrors.en.failedOnChain);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Checks a base64 transaction built by the API (txcheck.ts), has the wallet sign it and sends it from
 * the browser. Transactions the API already partially signed (claims) go through signTransaction so
 * the existing signature is kept. Returns the signature once it's confirmed.
 */
export async function signAndSend(
  wallet: WalletContextState,
  connection: Connection,
  base64: string,
  check: { network: "mainnet-beta" | "devnet"; kind: TxKind; coinMint?: string },
  /** Called once the wallet has signed and the transaction is out, before confirmation. */
  onSent?: (signature: string) => void,
): Promise<string> {
  if (!wallet.publicKey) throw new Error(txErrors.en.noWallet);
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  checkTransaction(tx, wallet.publicKey, check.network, check.kind, check.coinMint ? new PublicKey(check.coinMint) : undefined);
  // An upper bound for the API's blockhash (it was fetched moments ago), so confirmation waits long enough.
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  let sig: string;
  if (check.kind === "claim" || !wallet.sendTransaction) {
    if (!wallet.signTransaction) throw new Error(txErrors.en.cantSign);
    const signed = await wallet.signTransaction(tx);
    sig = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  } else {
    sig = await wallet.sendTransaction(tx, connection, { maxRetries: 3 });
  }
  onSent?.(sig);
  return confirmSignature(connection, sig, lastValidBlockHeight);
}

/**
 * Waits for a sent transaction to confirm. By polling, not a websocket subscription: the browser's RPC is
 * the site's HTTP relay. An RPC hiccup doesn't end the wait (it used to, and reported a payment that went
 * through as unconfirmed). Once the blockhash has expired and the chain has no trace of the transaction,
 * it can't land any more: TxExpired. `resend` broadcasts it again every few seconds until then.
 */
export async function confirmSignature(connection: Connection, sig: string, lastValidBlockHeight: number, resend?: () => Promise<unknown>): Promise<string> {
  let misses = 0;
  for (let i = 0; ; i++) {
    try {
      const st = (await connection.getSignatureStatuses([sig])).value[0];
      if (st?.err) throw new FailedOnChain(sig);
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
      if (i % 3 === 2) {
        if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
          // It may have landed in the last valid block: look through history before calling it expired.
          const last = (await connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
          if (last?.err) throw new FailedOnChain(sig);
          if (last?.confirmationStatus === "confirmed" || last?.confirmationStatus === "finalized") return sig;
          if (!last) throw new TxExpired(sig);
        } else if (resend) {
          await resend().catch(() => {});
        }
      }
      misses = 0;
    } catch (e) {
      if (e instanceof TxExpired || e instanceof FailedOnChain) throw e;
      // The relay or the RPC didn't answer: keep waiting, up to about half a minute without an answer.
      if (++misses >= 30) throw new SentUnconfirmed(sig);
    }
    await sleep(1000);
  }
}

export const explorerTx = (sig: string, network: "mainnet-beta" | "devnet") => `https://solscan.io/tx/${sig}${network === "devnet" ? "?cluster=devnet" : ""}`;
