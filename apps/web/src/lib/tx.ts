"use client";

import { PublicKey, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { checkTransaction, type TxKind } from "./txcheck";

/** The transaction was broadcast but its confirmation wasn't seen: it may still land (audit). */
export class SentUnconfirmed extends Error {
  override name = "SentUnconfirmed";
  constructor(readonly signature: string) {
    super("Sent. Confirmation is taking a while; check the explorer before trying again.");
  }
}

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
): Promise<string> {
  if (!wallet.publicKey) throw new Error("Connect a wallet first");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  checkTransaction(tx, wallet.publicKey, check.network, check.kind, check.coinMint ? new PublicKey(check.coinMint) : undefined);
  const blockhash = tx.message.recentBlockhash;
  // An upper bound for the API's blockhash (it was fetched moments ago), so confirmation waits long enough.
  const { lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  let sig: string;
  if (check.kind === "claim" || !wallet.sendTransaction) {
    if (!wallet.signTransaction) throw new Error("This wallet can't sign transactions");
    const signed = await wallet.signTransaction(tx);
    sig = await connection.sendRawTransaction(signed.serialize(), { maxRetries: 3 });
  } else {
    sig = await wallet.sendTransaction(tx, connection, { maxRetries: 3 });
  }
  // From here on the transaction is out: never tell the user "nothing was spent".
  try {
    const r = await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (r.value.err) throw new Error("The transaction failed on chain. Only the network fee was spent.");
    return sig;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("The transaction failed on chain")) throw e;
    const st = (await connection.getSignatureStatuses([sig]).catch(() => null))?.value[0];
    if (st && !st.err && st.confirmationStatus !== "processed") return sig;
    throw new SentUnconfirmed(sig);
  }
}

export const explorerTx = (sig: string, network: "mainnet-beta" | "devnet") => `https://solscan.io/tx/${sig}${network === "devnet" ? "?cluster=devnet" : ""}`;
