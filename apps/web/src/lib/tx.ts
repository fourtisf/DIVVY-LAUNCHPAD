"use client";

import { VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";

/**
 * Signs a base64 transaction built by the API and sends it from the browser. Transactions the API
 * already partially signed (claims) go through signTransaction so the existing signature is kept.
 * Returns the signature once it's confirmed.
 */
export async function signAndSend(wallet: WalletContextState, connection: Connection, base64: string, opts: { partiallySigned?: boolean } = {}): Promise<string> {
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  const blockhash = tx.message.recentBlockhash;
  // An upper bound for the API's blockhash (it was fetched moments ago), so confirmation waits long enough.
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  let sig: string;
  if (opts.partiallySigned || !wallet.sendTransaction) {
    if (!wallet.signTransaction) throw new Error("This wallet can't sign transactions");
    const signed = await wallet.signTransaction(tx);
    sig = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  } else {
    sig = await wallet.sendTransaction(tx, connection, { maxRetries: 3 });
  }
  const r = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  if (r.value.err) throw new Error("The transaction failed on chain");
  return sig;
}

export const explorerTx = (sig: string, network: "mainnet-beta" | "devnet") => `https://solscan.io/tx/${sig}${network === "devnet" ? "?cluster=devnet" : ""}`;
