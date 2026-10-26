/**
 * Signing and sending with the mainnet gate and an audit log entry for every signed transaction
 * (CLAUDE.md conventions). Coin creates never come through here: they go only through Jito.
 */
import { Connection, VersionedTransaction, type Commitment } from "@solana/web3.js";
import bs58 from "bs58";
import { assertCanSend, type SolanaEnv } from "./config";

export interface SignedTxLog {
  purpose: string;
  signer: string;
  signature: string;
  coinId?: string | null;
  bundleId?: string | null;
  dryRun?: boolean;
}

export type TxLogger = (entry: SignedTxLog) => Promise<void>;

export const signatureOf = (tx: VersionedTransaction): string => bs58.encode(tx.signatures[0]!);

/** Logs, sends and confirms a fully signed transaction through the RPC. Returns the signature. */
export async function sendAndConfirm(
  conn: Connection,
  env: Pick<SolanaEnv, "cluster" | "mainnetEnabled">,
  tx: VersionedTransaction,
  meta: { purpose: string; signer: string; coinId?: string | null; lastValidBlockHeight: number },
  log: TxLogger,
  commitment: Commitment = "confirmed",
): Promise<string> {
  if (meta.purpose.startsWith("launch.create")) throw new Error("coin creates must go through a Jito bundle");
  assertCanSend(env, meta.purpose);
  const signature = signatureOf(tx);
  await log({ purpose: meta.purpose, signer: meta.signer, signature, coinId: meta.coinId ?? null });
  await conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
  const r = await conn.confirmTransaction({ signature, blockhash: tx.message.recentBlockhash, lastValidBlockHeight: meta.lastValidBlockHeight }, commitment);
  if (r.value.err) throw new Error(`${meta.purpose} failed on chain: ${JSON.stringify(r.value.err)}`);
  return signature;
}
