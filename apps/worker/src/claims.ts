/**
 * Holder claims (claim delivery model, HANDOFF §3.4). The API can't sign, so it asks the worker:
 * the payout vault pays the network fee and partially signs a transferChecked of the holder's whole
 * credit; the holder signs as payer of their own token-account rent and sends it. The amount is
 * reserved until the transaction lands or its blockhash expires.
 */
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { ClaimJob, ClaimJobResult } from "@divvy/shared";
import { assertCanSend, getMintInfo, MainnetDisabledError, signatureOf, transferIxs } from "@divvy/solana/live";
import type { WorkerDeps } from "./deps";
import { EXPIRY_MARGIN, markItems } from "./payouts/deliver";

const fail = (code: string, message: string): ClaimJobResult => ({ tx: null, amount: "0", error: { code, message } });

export async function buildClaim(d: WorkerDeps, job: ClaimJob): Promise<ClaimJobResult> {
  if (d.params.delivery !== "claim") return fail("PUSH_DELIVERY", "Payouts are sent automatically; there's nothing to claim");
  if (d.params.dryRun) return fail("CLAIMS_CLOSED", "Claims aren't open yet");
  // A claim that failed on chain recently (frozen or memo-required account): wait before the vault
  // pays for another attempt (audit).
  if (await d.redis.exists(backoffKey(job.wallet, job.assetId))) return fail("CLAIM_BACKOFF", "Your last claim failed. Try again in an hour.");
  try {
    assertCanSend(d.sol, "payout.claim");
  } catch (e) {
    if (e instanceof MainnetDisabledError) return fail("CLAIMS_CLOSED", "Claims aren't open yet");
    throw e;
  }
  const holder = new PublicKey(job.wallet);
  const asset = await d.prisma.dividendAsset.findUnique({ where: { id: job.assetId } });
  if (!asset) return fail("ASSET_UNKNOWN", "Unknown asset");
  const open = await d.prisma.claim.findFirst({ where: { wallet: job.wallet, assetId: asset.id, status: "pending" } });
  if (open) return fail("CLAIM_PENDING", "You have a claim waiting. Sign it, or wait a minute and try again.");
  const credit = await d.prisma.credit.findUnique({ where: { wallet_assetId: { wallet: job.wallet, assetId: asset.id } } });
  if (!credit || credit.amount <= 0n) return fail("NOTHING_TO_CLAIM", "There's nothing to claim yet");
  // The vault pays each claim's network fee, so tiny claims wait until they're worth it.
  const usd = (await d.prices()).byMint[asset.mint] ?? 0;
  const creditUsd = (Number(credit.amount) / 10 ** asset.decimals) * usd;
  // Without a price the minimum can't be checked, so claims for that stock wait (audit: otherwise
  // anyone could make the vault pay fees for dust claims during a price outage).
  if (usd <= 0) return fail("NO_PRICE", `${asset.symbol} claims are paused while its price updates. Try again in a few minutes.`);
  if (creditUsd < d.params.autoPushMinUsd) return fail("CLAIM_TOO_SMALL", `You can claim once it's worth $${d.params.autoPushMinUsd}`);

  const info = await getMintInfo(d.conn, new PublicKey(asset.mint));
  if (info.paused) return fail("ASSET_PAUSED", `${asset.symbol} transfers are paused by its issuer. Try again later.`);
  if (info.transferHookProgram) return fail("ASSET_UNSUPPORTED", `${asset.symbol} can't be claimed right now`);

  const vault = d.wallets.payoutVault();
  const amount = credit.amount;
  const { blockhash, lastValidBlockHeight } = await d.conn.getLatestBlockhash("confirmed");
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 100_000 }),
    // The holder pays their own token-account rent; the vault only moves tokens it owes them.
    ...transferIxs({ mint: info, authority: vault.publicKey, to: holder, amount, payer: holder, createAta: true }),
  ];
  // The vault is the fee payer, so the transaction id is known now (it's the vault's signature).
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: vault.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  tx.sign([vault]);
  const sig = signatureOf(tx);

  const reserved = await d.prisma.$transaction(async (db) => {
    const n = await db.credit.updateMany({ where: { wallet: job.wallet, assetId: asset.id, amount: { gte: amount } }, data: { amount: { decrement: amount } } });
    if (n.count !== 1) return false;
    await db.claim.create({ data: { wallet: job.wallet, assetId: asset.id, amount, sig, lastValidBlockHeight: BigInt(lastValidBlockHeight) } });
    return true;
  });
  if (!reserved) return fail("CLAIM_CHANGED", "Your balance just changed. Try again.");
  await d.txlog({ purpose: "payout.claim", signer: "payout_vault", signature: sig });
  return { tx: Buffer.from(tx.serialize()).toString("base64"), amount: amount.toString() };
}

const backoffKey = (wallet: string, assetId: string) => `divvy:claim-backoff:${wallet}:${assetId}`;

/** Only a pending claim moves, and only the call that moved it restores the credit (audit). */
async function settleClaim(d: WorkerDeps, id: string, to: "confirmed" | "expired", failedOnChain = false): Promise<void> {
  await d.prisma.$transaction(async (db) => {
    const c = await db.claim.findUnique({ where: { id } });
    if (!c) return;
    const moved = await db.claim.updateMany({ where: { id, status: "pending" }, data: { status: to } });
    if (moved.count !== 1) return;
    if (to === "expired") {
      await db.credit.upsert({
        where: { wallet_assetId: { wallet: c.wallet, assetId: c.assetId } },
        create: { wallet: c.wallet, assetId: c.assetId, amount: c.amount },
        update: { amount: { increment: c.amount } },
      });
      if (failedOnChain) await d.redis.set(backoffKey(c.wallet, c.assetId), "1", "EX", 3600);
    } else await markItems(db, c.wallet, c.assetId, c.amount, "claimed", c.sig);
  });
}

/** Every minute: confirmed claims close their items; expired ones give the credit back. */
export async function reconcileClaims(d: WorkerDeps): Promise<void> {
  const pending = await d.prisma.claim.findMany({ where: { status: "pending" }, orderBy: { createdAt: "asc" }, take: 256 });
  if (!pending.length) return;
  // Block height first, statuses second; and a margin, since the holder chooses when to submit (audit).
  const height = BigInt(await d.conn.getBlockHeight("confirmed"));
  const statuses = (await d.conn.getSignatureStatuses(pending.map((p) => p.sig), { searchTransactionHistory: true })).value;
  for (let i = 0; i < pending.length; i++) {
    const st = statuses[i];
    const c = pending[i]!;
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) await settleClaim(d, c.id, "confirmed");
    else if (st?.err) await settleClaim(d, c.id, "expired", true);
    else if (!st && height > c.lastValidBlockHeight + EXPIRY_MARGIN) await settleClaim(d, c.id, "expired");
  }
}
