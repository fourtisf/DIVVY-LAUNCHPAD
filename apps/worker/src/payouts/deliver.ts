/**
 * Delivery (HANDOFF §3.4). Rounds credit a ledger; this module moves credits out of the payout vault:
 *   - auto-send to wallets that already have the asset's token account once the credit passes
 *     AUTO_PUSH_MIN_USD (both models),
 *   - push model only: also create the account and send, once the credit passes PUSH_NEW_ATA_MIN_USD,
 *   - claim model: everyone else claims (claims.ts) and pays their own account rent.
 *
 * Holders pay their own delivery (owner decision 2026-10-27): each send keeps DELIVERY_FEE_USD of the
 * credit, and a send that creates the token account also keeps that account's rent, both in the
 * stock and rounded up (`deliveryCharge`). What's kept stays in the payout vault as uspad's
 * (PayoutTransfer."feeAmount"); the vault's SOL pays the rent and network fees.
 *
 * A credit is debited in the same database transaction that records the PayoutTransfer, before the
 * transaction is sent. The reconciler confirms it, or gives the credit back once the blockhash has
 * certainly expired.
 */
import { ComputeBudgetProgram, PublicKey, SendTransactionError, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import type { Prisma } from "@divvy/db";
import { assertCanSend, existingAtas, getMintInfo, newAtaLen, signatureOf, transferIxs, ata, type MintInfo } from "@divvy/solana/live";
import type { WorkerDeps } from "../deps";
import { deliveryAction, deliveryCharge } from "./plan";

const MAX_CREDITS_PER_RUN = 5000;
/** Blocks past lastValidBlockHeight before a missing transaction counts as expired (load-balanced RPCs lag). */
export const EXPIRY_MARGIN = 150n;
/**
 * Wallets whose transfers keep failing (frozen account, required memo, ...) are skipped for a day,
 * then tried again; a refused send costs nothing (preflight). Each wallet keeps its own time, so one
 * new failure doesn't extend the others (audit). Under the claim model the wallet can also claim.
 */
const blockedKey = (assetId: string) => `divvy:push-blocked-at:${assetId}`;
const BLOCK_MS = 24 * 3_600_000;

async function blockedWallets(d: WorkerDeps, assetId: string): Promise<string[]> {
  const all = await d.redis.hgetall(blockedKey(assetId));
  const now = Date.now();
  const expired = Object.keys(all).filter((w) => now - Number(all[w]) >= BLOCK_MS);
  if (expired.length) await d.redis.hdel(blockedKey(assetId), ...expired);
  return Object.keys(all).filter((w) => !expired.includes(w));
}

async function blockWallet(d: WorkerDeps, assetId: string, symbol: string, wallet: string) {
  await d.redis.hset(blockedKey(assetId), wallet, String(Date.now()));
  await d.alerts.send(`push-blocked-${assetId}-${wallet}`, "warn", `Sending ${symbol} to ${wallet} keeps failing; its credit waits and is retried once a day`, 86_400);
}

interface Planned {
  wallet: string;
  /** Taken from the credit: amount + fee. */
  debit: bigint;
  /** Sent to the wallet. */
  amount: bigint;
  /** Kept by uspad (delivery fee, plus the rent when createAta). */
  fee: bigint;
  createAta: boolean;
  rentLamports: bigint;
}

export async function deliverCredits(d: WorkerDeps): Promise<{ sent: number; held: number }> {
  assertCanSend(d.sol, "payout.send");
  const prices = await d.prices();
  const assets = await d.prisma.dividendAsset.findMany({ where: { credits: { some: { amount: { gt: 0n } } } } });
  let sent = 0;
  let held = 0;

  for (const asset of assets) {
    const usd = prices.byMint[asset.mint] ?? 0;
    if (!usd) {
      await d.alerts.send(`no-price-${asset.symbol}`, "warn", `No ${asset.symbol} price; deliveries for it wait`);
      continue;
    }
    const info = await getMintInfo(d.conn, new PublicKey(asset.mint));
    if (info.paused || info.transferHookProgram) {
      await d.alerts.send(`asset-blocked-${asset.symbol}`, "critical", `${asset.symbol} is ${info.paused ? "paused by its issuer" : "using a transfer hook"}; deliveries wait`);
      continue;
    }
    const credits = await d.prisma.credit.findMany({ where: { assetId: asset.id, amount: { gt: 0n } }, orderBy: { amount: "desc" }, take: MAX_CREDITS_PER_RUN });
    const [pendingT, pendingC, blocked] = await Promise.all([
      d.prisma.payoutTransfer.findMany({ where: { assetId: asset.id, status: "pending" }, select: { wallet: true, amount: true } }),
      d.prisma.claim.findMany({ where: { assetId: asset.id, status: "pending" }, select: { wallet: true, amount: true } }),
      blockedWallets(d, asset.id),
    ]);
    const busy = new Set([...pendingT, ...pendingC].map((x) => x.wallet).concat(blocked));
    const have = await existingAtas(d.conn, credits.map((c) => new PublicKey(c.wallet)), info);
    const rentLamports = BigInt(await d.conn.getMinimumBalanceForRentExemption(newAtaLen(info)));
    const plan: Planned[] = [];
    for (const c of credits) {
      if (busy.has(c.wallet)) continue;
      const action = deliveryAction({
        delivery: d.params.delivery,
        hasAta: have.has(c.wallet),
        creditUsd: (Number(c.amount) / 10 ** asset.decimals) * usd,
        autoPushMinUsd: d.params.autoPushMinUsd,
        pushNewAtaMinUsd: d.env.PUSH_NEW_ATA_MIN_USD,
      });
      // Never pay rent for an account owned by a program (it can't claim or use it; audit).
      const go = action === "send" || (action === "send_create_ata" && PublicKey.isOnCurve(new PublicKey(c.wallet).toBytes()));
      const createAta = action === "send_create_ata";
      const charge = go
        ? deliveryCharge({ credit: c.amount, createAta, feeUsd: d.params.deliveryFeeUsd, rentLamports, solUsd: prices.solUsd, assetUsd: usd, decimals: asset.decimals })
        : null;
      if (charge) plan.push({ wallet: c.wallet, debit: c.amount, amount: charge.net, fee: charge.fee, createAta, rentLamports: createAta ? rentLamports : 0n });
      else held++;
    }
    if (!plan.length) continue;

    // Hourly cap on what the payout vault sends (HANDOFF §9). Whatever fits this hour goes; the rest
    // waits for the next hour (audit: reserving the whole plan let a large backlog block every send).
    const capKey = `divvy:push-usd:${new Date().toISOString().slice(0, 13)}`;
    const unitUsd = usd / 10 ** asset.decimals;
    let room = d.env.PUSH_HOURLY_CAP_USD - Number((await d.redis.get(capKey)) ?? 0);
    const fits: Planned[] = [];
    for (const p of plan) {
      const u = Number(p.amount) * unitUsd;
      if (u > room) continue;
      fits.push(p);
      room -= u;
    }
    if (fits.length < plan.length) {
      await d.alerts.send("push-cap", "critical", `Payout vault hourly send cap ($${d.env.PUSH_HOURLY_CAP_USD}) reached: ${plan.length - fits.length} ${asset.symbol} sends wait for the next hour`);
    }
    if (!fits.length) continue;

    // Never promise more than the vault holds: tokens reserved by pending transfers and claims are
    // still in it, so they count against the balance.
    const vault = d.wallets.payoutVault();
    const source = ata(vault.publicKey, info.address, info.programId);
    const bal = BigInt((await d.conn.getTokenAccountBalance(source, "confirmed").catch(() => null))?.value.amount ?? "0");
    const reserved = [...pendingT, ...pendingC].reduce((a, x) => a + x.amount, 0n);
    const owed = fits.reduce((a, p) => a + p.amount, 0n);
    if (owed + reserved > bal) {
      await d.alerts.send(`vault-short-${asset.symbol}`, "critical", `Payout vault holds ${bal} ${asset.symbol} base units but owes ${owed} more on top of ${reserved} in flight; sends stopped`);
      continue;
    }
    // The vault pays the new accounts' rent and the fees in SOL. Short of it, a send fails its
    // preflight and would wrongly block the wallet, so wait and alert instead.
    const lamportsNeeded = fits.reduce((a, p) => a + p.rentLamports, 0n) + BigInt(Math.ceil(fits.length / d.env.PUSH_BATCH_SIZE)) * 100_000n;
    const lamports = BigInt(await d.conn.getBalance(vault.publicKey, "confirmed"));
    if (lamports < lamportsNeeded) {
      await d.alerts.send("vault-sol-short", "critical", `Payout vault holds ${lamports} lamports but its ${asset.symbol} sends need ${lamportsNeeded} for account rent and fees; sends wait. Top it up from the fee claimer.`, 3600);
      continue;
    }
    await d.redis.incrbyfloat(capKey, Number(owed) * unitUsd);
    await d.redis.expire(capKey, 7200);
    plan.splice(0, plan.length, ...fits);

    for (let i = 0; i < plan.length; i += d.env.PUSH_BATCH_SIZE) {
      const batch = plan.slice(i, i + d.env.PUSH_BATCH_SIZE);
      const r = await sendBatch(d, asset.id, info, batch);
      if (r === "confirmed") sent += batch.length;
      else if (r === "failed" && batch.length > 1) {
        // One bad recipient mustn't block the others (audit): retry each alone; persistent failures go to claim-only.
        for (const p of batch) {
          const one = await sendBatch(d, asset.id, info, [p]);
          if (one === "confirmed") sent++;
          else if (one === "failed") await blockWallet(d, asset.id, asset.symbol, p.wallet);
        }
      } else if (r === "failed") await blockWallet(d, asset.id, asset.symbol, batch[0]!.wallet);
    }
  }
  return { sent, held };
}

/** Debits, records, sends and confirms one transaction. "unknown" is left to the reconciler. */
async function sendBatch(d: WorkerDeps, assetId: string, info: MintInfo, batch: Planned[]): Promise<"confirmed" | "failed" | "unknown" | "skipped"> {
  const vault = d.wallets.payoutVault();
  const ixs = [
    ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 * batch.length }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports: d.env.CU_PRICE_MICRO_LAMPORTS }),
    ...batch.flatMap((p) => transferIxs({ mint: info, authority: vault.publicKey, to: new PublicKey(p.wallet), amount: p.amount, payer: vault.publicKey, createAta: p.createAta })),
  ];
  const { blockhash, lastValidBlockHeight } = await d.conn.getLatestBlockhash("confirmed");
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: vault.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
  tx.sign([vault]);
  const sig = signatureOf(tx);
  try {
    await d.prisma.$transaction(async (db) => {
      for (const p of batch) {
        const n = await db.credit.updateMany({ where: { wallet: p.wallet, assetId, amount: { gte: p.debit } }, data: { amount: { decrement: p.debit } } });
        if (n.count !== 1) throw new Error(`credit for ${p.wallet} changed`);
        await db.payoutTransfer.create({
          data: { sig, wallet: p.wallet, assetId, amount: p.amount, feeAmount: p.fee, createdAta: p.createAta, rentLamports: p.rentLamports, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
        });
      }
    });
  } catch (e) {
    d.log("deliver: batch skipped, credits moved", { error: e instanceof Error ? e.message : String(e) });
    return "skipped";
  }
  await d.txlog({ purpose: "payout.send", signer: "payout_vault", signature: sig });
  try {
    await d.conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Refused by preflight simulation: never broadcast, so the credit comes straight back. Any other
    // error (network, timeout) may have broadcast it: the reconciler decides from the chain.
    if (e instanceof SendTransactionError && /simulation failed/i.test(msg)) {
      d.log("deliver: send refused", { sig, error: msg });
      await settleTransfers(d, sig, "expired");
      return "failed";
    }
    d.log("deliver: send outcome unknown", { sig, error: msg });
    return "unknown";
  }
  try {
    const r = await d.conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (r.value.err) {
      await settleTransfers(d, sig, "expired");
      return "failed";
    }
    await settleTransfers(d, sig, "confirmed");
    return "confirmed";
  } catch (e) {
    d.log("deliver: send outcome unknown", { sig, error: e instanceof Error ? e.message : String(e) });
    return "unknown";
  }
}

/**
 * Marks the oldest credited items of (wallet, asset) as sent/claimed until they add up to `amount`,
 * so items whose amount is still in the credit stay credited (audit).
 */
export async function markItems(db: Prisma.TransactionClient, wallet: string, assetId: string, amount: bigint, status: "sent" | "claimed", sig: string): Promise<void> {
  const items = await db.payoutItem.findMany({
    where: { wallet, status: "credited", round: { dryRun: false, coin: { dividendAssetId: assetId } } },
    orderBy: { createdAt: "asc" },
    select: { id: true, amountAsset: true },
  });
  const ids: string[] = [];
  let left = amount;
  for (const i of items) {
    if (i.amountAsset > left) break;
    ids.push(i.id);
    left -= i.amountAsset;
  }
  if (ids.length) await db.payoutItem.updateMany({ where: { id: { in: ids } }, data: { status, sendSig: sig } });
}

/**
 * Settles a push transaction. Only rows still pending move, and the credit is restored only by the
 * call that moved them, so two settlers can't restore it twice (audit).
 */
export async function settleTransfers(d: WorkerDeps, sig: string, to: "confirmed" | "expired"): Promise<void> {
  await d.prisma.$transaction(async (db) => {
    const rows = await db.payoutTransfer.findMany({ where: { sig, status: "pending" } });
    for (const t of rows) {
      const moved = await db.payoutTransfer.updateMany({ where: { id: t.id, status: "pending" }, data: { status: to } });
      if (moved.count !== 1) continue;
      // The credit lost the amount sent and the fee kept; an expired send gives both back.
      const debit = t.amount + t.feeAmount;
      if (to === "expired") {
        await db.credit.upsert({
          where: { wallet_assetId: { wallet: t.wallet, assetId: t.assetId } },
          create: { wallet: t.wallet, assetId: t.assetId, amount: debit },
          update: { amount: { increment: debit } },
        });
      } else await markItems(db, t.wallet, t.assetId, debit, "sent", sig);
    }
  });
  if (to === "expired") d.log("deliver: transfer expired, credit restored", { sig });
}

/** Every minute: settle pending push transfers from the chain. */
export async function reconcileTransfers(d: WorkerDeps): Promise<void> {
  const pending = await d.prisma.payoutTransfer.findMany({ where: { status: "pending" }, distinct: ["sig"], select: { sig: true, lastValidBlockHeight: true }, take: 256 });
  if (!pending.length) return;
  // Block height first, statuses second: a transaction that lands in between is then seen (audit).
  const height = BigInt(await d.conn.getBlockHeight("confirmed"));
  const statuses = (await d.conn.getSignatureStatuses(pending.map((p) => p.sig), { searchTransactionHistory: true })).value;
  for (let i = 0; i < pending.length; i++) {
    const st = statuses[i];
    const p = pending[i]!;
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) await settleTransfers(d, p.sig, "confirmed");
    else if (st?.err || (!st && height > p.lastValidBlockHeight + EXPIRY_MARGIN)) await settleTransfers(d, p.sig, "expired");
  }
}
