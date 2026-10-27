"use client";

import { ComputeBudgetProgram, PublicKey, SystemProgram, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import { checkTransaction, type TxKind } from "./txcheck";

/** The transaction was broadcast but its confirmation wasn't seen: it may still land (audit). */
export class SentUnconfirmed extends Error {
  override name = "SentUnconfirmed";
  constructor(readonly signature: string) {
    super("Sent. Confirmation is taking a while; check the explorer before trying again.");
  }
}

/** Its blockhash expired and the chain has no trace of it: it can't land any more, and nothing was spent. */
export class TxExpired extends Error {
  override name = "TxExpired";
  constructor() {
    super("The transaction didn't land in time. Nothing was spent; try again.");
  }
}

/** The wallet can't cover what it's about to send, checked before the wallet opens. */
export class NotEnoughSol extends Error {
  override name = "NotEnoughSol";
}

const failedOnChain = () => new Error("The transaction failed on chain. Only the network fee was spent.");
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
  if (!wallet.publicKey) throw new Error("Connect a wallet first");
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
  checkTransaction(tx, wallet.publicKey, check.network, check.kind, check.coinMint ? new PublicKey(check.coinMint) : undefined);
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
  onSent?.(sig);
  return confirmSignature(connection, sig, lastValidBlockHeight);
}

/**
 * Waits for a sent transaction to confirm. By polling, not a websocket subscription: the browser's RPC is
 * uspad's HTTP relay. An RPC hiccup doesn't end the wait (it used to, and reported a payment that went
 * through as unconfirmed). Once the blockhash has expired and the chain has no trace of the transaction,
 * it can't land any more: TxExpired. `resend` broadcasts it again every few seconds until then.
 */
export async function confirmSignature(connection: Connection, sig: string, lastValidBlockHeight: number, resend?: () => Promise<unknown>): Promise<string> {
  let misses = 0;
  for (let i = 0; ; i++) {
    try {
      const st = (await connection.getSignatureStatuses([sig])).value[0];
      if (st?.err) throw failedOnChain();
      if (st?.confirmationStatus === "confirmed" || st?.confirmationStatus === "finalized") return sig;
      if (i % 3 === 2) {
        if ((await connection.getBlockHeight("confirmed")) > lastValidBlockHeight) {
          // It may have landed in the last valid block: look through history before calling it expired.
          const last = (await connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0];
          if (last?.err) throw failedOnChain();
          if (last?.confirmationStatus === "confirmed" || last?.confirmationStatus === "finalized") return sig;
          if (!last) throw new TxExpired();
        } else if (resend) {
          await resend().catch(() => {});
        }
      }
      misses = 0;
    } catch (e) {
      if (e instanceof TxExpired || (e instanceof Error && e.message.startsWith("The transaction failed on chain"))) throw e;
      // The relay or the RPC didn't answer: keep waiting, up to about half a minute without an answer.
      if (++misses >= 30) throw new SentUnconfirmed(sig);
    }
    await sleep(1000);
  }
}

/** Room left in the wallet after the fee: the network and priority fees, and an account that stays rent exempt. */
const FEE_HEADROOM_LAMPORTS = 1_000_000n;
const FEE_TX_CU = 2_000;
/** About 0.00001 SOL of priority fee, so the payment gets into a busy block. */
const FEE_TX_CU_PRICE = 5_000_000;

/**
 * The creator's launch fee: a SOL transfer from the connected wallet to uspad's launch wallet
 * (Config.launchFee), built here so there's nothing to check. The balance is checked before the wallet
 * opens. The signed transaction is sent from here and again every few seconds until it lands (wallets
 * that can only sign-and-send send it once). `onSent` gets the signature and its last valid block
 * height as soon as it's out, so a payment survives a reload. Returns once it's confirmed; the API then
 * verifies it on chain before it queues the launch.
 */
export async function payLaunchFee(
  wallet: WalletContextState,
  connection: Connection,
  to: string,
  lamports: bigint,
  onSent: (sig: string, lastValidBlockHeight: number) => void,
): Promise<string> {
  if (!wallet.publicKey || (!wallet.signTransaction && !wallet.sendTransaction)) throw new Error("Connect a wallet first");
  const need = lamports + FEE_HEADROOM_LAMPORTS;
  if (BigInt(await connection.getBalance(wallet.publicKey, "confirmed")) < need)
    throw new NotEnoughSol(`Your wallet needs at least ${Number(need) / 1e9} SOL to launch: the ${Number(lamports) / 1e9} SOL fee plus a little for the network.`);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const message = new TransactionMessage({
    payerKey: wallet.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitLimit({ units: FEE_TX_CU }),
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: FEE_TX_CU_PRICE }),
      SystemProgram.transfer({ fromPubkey: wallet.publicKey, toPubkey: new PublicKey(to), lamports }),
    ],
  }).compileToV0Message();
  const tx = new VersionedTransaction(message);
  if (wallet.signTransaction) {
    const raw = (await wallet.signTransaction(tx)).serialize();
    // The first send runs the preflight, so a refusal (a balance that changed) shows up here.
    const sig = await connection.sendRawTransaction(raw, { maxRetries: 0 });
    onSent(sig, lastValidBlockHeight);
    return confirmSignature(connection, sig, lastValidBlockHeight, () => connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 }));
  }
  const sig = await wallet.sendTransaction(tx, connection, { maxRetries: 3 });
  onSent(sig, lastValidBlockHeight);
  return confirmSignature(connection, sig, lastValidBlockHeight);
}

export const explorerTx = (sig: string, network: "mainnet-beta" | "devnet") => `https://solscan.io/tx/${sig}${network === "devnet" ? "?cluster=devnet" : ""}`;
