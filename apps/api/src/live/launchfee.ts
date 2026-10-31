/**
 * Creator-paid launches (owner decisions 2026-10-27). The creator's wallet signs and pays for its coin's
 * create, with uspad's LAUNCH_FEE_LAMPORTS to LAUNCH_FEE_WALLET inside it (apps/worker/src/launch.ts):
 * the fee lands with the coin or not at all. Before that move the fee was a transfer of its own, which
 * the API read from the chain; each such payment is a LaunchFee row. One that no launch used is credit:
 * the next launch's create then carries no fee (worker failLaunch gives a failed launch's back).
 */
import type { VersionedTransactionResponse } from "@solana/web3.js";
import { Prisma } from "@divvy/db";
import { getTransactionAnyVersion } from "@divvy/solana/live";
import { sendError } from "../errors";
import type { LiveDeps } from "./deps";
import { BRAND } from "@divvy/shared";

type Reply = Parameters<typeof sendError>[0];

/**
 * About what a create costs its creator besides the fee: the rent of the pool, its vaults and the mint,
 * the network fee and the Jito tip. uspad's creates on 2026-10-27 moved about 0.0086 SOL (Solscan,
 * initialize_with_token_2022 by the operations wallet), so 0.009 is shown and 0.012 is required.
 */
export const CREATE_COST_LAMPORTS = 9_000_000n;
export const CREATE_BALANCE_LAMPORTS = 12_000_000n;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{64,90}$/;
/**
 * A payment older than this can't pay for a launch: it was made for something else. A day, so a
 * payment whose launch was interrupted (a closed tab, a slow confirmation) still pays for the retry.
 */
const MAX_AGE_SEC = 86_400;

/**
 * Why `tx` doesn't pay the launch fee, or null when it does: signed by `payer`, `lamports` or more to `to`.
 * A coin's create also sends the fee (since the creator signs it), but that fee paid for that coin: a
 * transaction that calls LaunchLab is never a separate payment (audit).
 */
export function feePaymentProblem(tx: VersionedTransactionResponse, payer: string, to: string, lamports: bigint, nowSec: number, launchLab?: string): string | null {
  const meta = tx.meta;
  if (!meta || meta.err) return "The payment failed on chain. Nothing was charged but the network fee.";
  if (tx.blockTime && nowSec - tx.blockTime > MAX_AGE_SEC) return "That payment is more than a day old. Pay the launch fee again.";
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: meta.loadedAddresses });
  if (keys.get(0)?.toBase58() !== payer) return "The payment has to come from the wallet you're signed in with";
  if (launchLab && tx.transaction.message.compiledInstructions.some((ix) => keys.get(ix.programIdIndex)?.toBase58() === launchLab)) {
    return "That's a coin's create: its fee paid for that coin";
  }
  let i = 0;
  while (i < keys.length && keys.get(i)!.toBase58() !== to) i++;
  if (i === keys.length) return `That payment didn't go to ${BRAND}'s launch wallet`;
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
  const problem = feePaymentProblem(tx, v.wallet, d.env.LAUNCH_FEE_WALLET!, lamports, Math.floor(Date.now() / 1000), d.programs.launchLab.toBase58());
  if (problem) return { fail: (r) => sendError(r, 422, "BAD_FEE", problem) };
  try {
    const row = await d.prisma.launchFee.create({ data: { userId: v.userId, sig, lamports } });
    return { id: row.id };
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return { fail: (r) => sendError(r, 409, "FEE_USED", "That payment already paid for a launch") };
    throw e;
  }
}
