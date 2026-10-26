/**
 * Delivery (HANDOFF §3.4). Rounds credit a ledger; this module moves credits out of the payout vault:
 *   - auto-send to wallets that already have the asset's token account once the credit passes
 *     AUTO_PUSH_MIN_USD (both models),
 *   - push model only: also create the account and send, once the credit passes PUSH_NEW_ATA_MIN_USD,
 *   - claim model: everyone else claims (claims.ts) and pays their own account rent.
 *
 * A credit is debited in the same database transaction that records the PayoutTransfer, before the
 * transaction is sent. The reconciler confirms it, or gives the credit back once the blockhash expires.
 */
import { ComputeBudgetProgram, PublicKey, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { assertCanSend, existingAtas, getMintInfo, signatureOf, transferIxs, ata } from "@divvy/solana/live";
import type { WorkerDeps } from "../deps";
import { deliveryAction } from "./plan";

const MAX_CREDITS_PER_RUN = 5000;

export async function deliverCredits(d: WorkerDeps): Promise<{ sent: number; held: number }> {
  assertCanSend(d.sol, "payout.send");
  const prices = await d.prices();
  const vault = d.wallets.payoutVault();
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
    const [pendingT, pendingC] = await Promise.all([
      d.prisma.payoutTransfer.findMany({ where: { assetId: asset.id, status: "pending" }, select: { wallet: true } }),
      d.prisma.claim.findMany({ where: { assetId: asset.id, status: "pending" }, select: { wallet: true } }),
    ]);
    const busy = new Set([...pendingT, ...pendingC].map((x) => x.wallet));
    const have = await existingAtas(d.conn, credits.map((c) => new PublicKey(c.wallet)), info);
    const plan = credits
      .filter((c) => !busy.has(c.wallet))
      .map((c) => ({
        c,
        action: deliveryAction({
          delivery: d.params.delivery,
          hasAta: have.has(c.wallet),
          creditUsd: (Number(c.amount) / 10 ** asset.decimals) * usd,
          autoPushMinUsd: d.params.autoPushMinUsd,
          pushNewAtaMinUsd: d.env.PUSH_NEW_ATA_MIN_USD,
        }),
      }));
    const todo = plan.filter((p) => p.action !== "hold");
    held += plan.length - todo.length;
    if (!todo.length) continue;

    // Never promise more than the vault holds.
    const source = ata(vault.publicKey, info.address, info.programId);
    const bal = BigInt((await d.conn.getTokenAccountBalance(source, "confirmed").catch(() => null))?.value.amount ?? "0");
    const owed = todo.reduce((a, p) => a + p.c.amount, 0n);
    if (owed > bal) {
      await d.alerts.send(`vault-short-${asset.symbol}`, "critical", `Payout vault holds ${bal} ${asset.symbol} base units but owes ${owed} for this delivery; sends stopped`);
      continue;
    }

    for (let i = 0; i < todo.length; i += d.env.PUSH_BATCH_SIZE) {
      const batch = todo.slice(i, i + d.env.PUSH_BATCH_SIZE);
      const ixs = [
        ComputeBudgetProgram.setComputeUnitLimit({ units: 120_000 * batch.length }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: d.env.CU_PRICE_MICRO_LAMPORTS }),
        ...batch.flatMap((p) =>
          transferIxs({ mint: info, authority: vault.publicKey, to: new PublicKey(p.c.wallet), amount: p.c.amount, payer: vault.publicKey, createAta: p.action === "send_create_ata" }),
        ),
      ];
      const { blockhash, lastValidBlockHeight } = await d.conn.getLatestBlockhash("confirmed");
      const tx = new VersionedTransaction(new TransactionMessage({ payerKey: vault.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message());
      tx.sign([vault]);
      const sig = signatureOf(tx);
      try {
        await d.prisma.$transaction(async (db) => {
          for (const p of batch) {
            const n = await db.credit.updateMany({ where: { wallet: p.c.wallet, assetId: asset.id, amount: { gte: p.c.amount } }, data: { amount: { decrement: p.c.amount } } });
            if (n.count !== 1) throw new Error(`credit for ${p.c.wallet} changed`);
            await db.payoutTransfer.create({
              data: { sig, wallet: p.c.wallet, assetId: asset.id, amount: p.c.amount, createdAta: p.action === "send_create_ata", lastValidBlockHeight: BigInt(lastValidBlockHeight) },
            });
          }
        });
      } catch (e) {
        d.log("deliver: batch skipped, credits moved", { error: e instanceof Error ? e.message : String(e) });
        continue;
      }
      await d.txlog({ purpose: "payout.send", signer: "payout_vault", signature: sig });
      try {
        await d.conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 5 });
        const r = await d.conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
        if (r.value.err) await settleTransfers(d, sig, "expired");
        else {
          await settleTransfers(d, sig, "confirmed");
          sent += batch.length;
        }
      } catch (e) {
        // Unknown outcome: the reconciler settles it from the chain.
        d.log("deliver: send outcome unknown", { sig, error: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  return { sent, held };
}

/**
 * Confirmed: the wallet's credited PayoutItems for that asset become "sent". Expired: the credit is
 * given back. Idempotent: only pending transfers move.
 */
export async function settleTransfers(d: WorkerDeps, sig: string, to: "confirmed" | "expired"): Promise<void> {
  await d.prisma.$transaction(async (db) => {
    const rows = await db.payoutTransfer.findMany({ where: { sig, status: "pending" } });
    for (const t of rows) {
      await db.payoutTransfer.update({ where: { id: t.id }, data: { status: to } });
      if (to === "expired") {
        await db.credit.upsert({
          where: { wallet_assetId: { wallet: t.wallet, assetId: t.assetId } },
          create: { wallet: t.wallet, assetId: t.assetId, amount: t.amount },
          update: { amount: { increment: t.amount } },
        });
      } else {
        await db.payoutItem.updateMany({
          where: { wallet: t.wallet, status: "credited", createdAt: { lte: t.createdAt }, round: { dryRun: false, coin: { dividendAssetId: t.assetId } } },
          data: { status: "sent", sendSig: sig },
        });
      }
    }
  });
  if (to === "expired") d.log("deliver: transfer expired, credit restored", { sig });
}

/** Every minute: settle pending push transfers from the chain. */
export async function reconcileTransfers(d: WorkerDeps): Promise<void> {
  const pending = await d.prisma.payoutTransfer.findMany({ where: { status: "pending" }, distinct: ["sig"], select: { sig: true, lastValidBlockHeight: true }, take: 256 });
  if (!pending.length) return;
  const statuses = (await d.conn.getSignatureStatuses(pending.map((p) => p.sig), { searchTransactionHistory: true })).value;
  const height = BigInt(await d.conn.getBlockHeight("confirmed"));
  for (let i = 0; i < pending.length; i++) {
    const st = statuses[i];
    const p = pending[i]!;
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) await settleTransfers(d, p.sig, "confirmed");
    else if (st?.err || (!st && height > p.lastValidBlockHeight)) await settleTransfers(d, p.sig, "expired");
  }
}
