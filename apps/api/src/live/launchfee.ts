/**
 * Creator-paid launches (owner decision 2026-10-27). Before a launch the creator's wallet sends
 * LAUNCH_FEE_LAMPORTS to LAUNCH_FEE_WALLET, the operations wallet that pays the create; the API reads
 * that transfer from the chain before it queues the launch. Each payment is a LaunchFee row, used by
 * one launch: a launch that fails gives it back as credit for the creator's next one (worker failLaunch).
 */
import type { VersionedTransactionResponse } from "@solana/web3.js";
import { Prisma } from "@divvy/db";
import { getTransactionAnyVersion } from "@divvy/solana/live";
import { sendError } from "../errors";
import type { LiveDeps } from "./deps";

type Reply = Parameters<typeof sendError>[0];
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
/**
 * A payment older than this can't pay for a launch: it was made for something else. A day, so a
 * payment whose launch was interrupted (a closed tab, a slow confirmation) still pays for the retry.
 */
const MAX_AGE_SEC = 86_400;

/** Why `tx` doesn't pay the launch fee, or null when it does: signed by `payer`, `lamports` or more to `to`. */
export function feePaymentProblem(tx: VersionedTransactionResponse, payer: string, to: string, lamports: bigint, nowSec: number): string | null {
  const meta = tx.meta;
  if (!meta || meta.err) return "The payment failed on chain. Nothing was charged but the network fee.";
  if (tx.blockTime && nowSec - tx.blockTime > MAX_AGE_SEC) return "That payment is more than a day old. Pay the launch fee again.";
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses });
  if (keys.get(0)?.toBase58() !== payer) return "The payment has to come from the wallet you're signed in with";
  let i = 0;
  while (i < keys.length && keys.get(i)!.toBase58() !== to) i++;
  if (i === keys.length) return "That payment didn't go to uspad's launch wallet";
  const received = BigInt(meta.postBalances[i] ?? 0) - BigInt(meta.preBalances[i] ?? 0);
  if (received < lamports) return `That payment is ${Number(received) / 1e9} SOL; launching costs ${Number(lamports) / 1e9} SOL`;
  return null;
}

/**
 * The viewer's unused launch fee: a credit left by a failed launch, or the transfer `sig` they just made,
 * checked on chain and recorded. Answers FEE_REQUIRED when there is neither.
 */
export async function launchFee(d: LiveDeps, v: { userId: string; wallet: string }, sig: string | undefined): Promise<{ id: string; fail?: never } | { fail: (r: Reply) => unknown }> {
  const credit = await d.prisma.launchFee.findFirst({ where: { userId: v.userId, launchId: null }, orderBy: { createdAt: "asc" } });
  if (credit) return { id: credit.id };
  const lamports = d.env.LAUNCH_FEE_LAMPORTS;
  if (!sig) return { fail: (r) => sendError(r, 402, "FEE_REQUIRED", `Launching costs ${Number(lamports) / 1e9} SOL. Approve it in your wallet.`) };
  if (!SIGNATURE.test(sig)) return { fail: (r) => sendError(r, 400, "BAD_FEE", "That isn't a transaction signature") };
  if (await d.prisma.launchFee.findUnique({ where: { sig } })) return { fail: (r) => sendError(r, 409, "FEE_USED", "That payment already paid for a launch") };
  const tx = await getTransactionAnyVersion(d.conn, sig).catch(() => null);
  if (!tx) return { fail: (r) => sendError(r, 409, "FEE_NOT_FOUND", "The payment isn't confirmed yet. Try again in a few seconds.") };
  const problem = feePaymentProblem(tx, v.wallet, d.env.LAUNCH_FEE_WALLET!, lamports, Math.floor(Date.now() / 1000));
  if (problem) return { fail: (r) => sendError(r, 422, "BAD_FEE", problem) };
  try {
    const row = await d.prisma.launchFee.create({ data: { userId: v.userId, sig, lamports } });
    return { id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { fail: (r) => sendError(r, 409, "FEE_USED", "That payment already paid for a launch") };
    throw e;
  }
}
