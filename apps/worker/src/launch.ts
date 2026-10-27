/**
 * Launch pipeline (HANDOFF §3.1, §3.5). The API reserved the identity as a pending Coin; here we:
 *   1. write the token metadata JSON,
 *   2. generate the mint keypair in memory (only the public key is stored, never returned by the API
 *      until the create lands),
 *   3. build initialize_with_token_2022 signed by the launcher and the mint, with the Jito tip inside,
 *   4. send it ONLY as a Jito bundle on mainnet (devnet has no block engine, so devnet uses the RPC),
 *   5. confirm, then mark the coin live.
 * A failed launch releases the ticker, picture and X account so the user can try again.
 */
import BN from "bn.js";
import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { publishLive, getLaunchSettings } from "@divvy/server";
import { KEYS } from "@divvy/shared";
import { LAUNCHLAB_DEFAULT_CURVE } from "@divvy/solana";
import { assertCanSend, createTransaction, decodePool, MainnetDisabledError, poolAddresses, poolPriceSol, signatureOf } from "@divvy/solana/live";
import type { WorkerDeps } from "./deps";

/** Rough lamports a create costs the launcher before the tip (account rent + fees), counted against the hourly cap. */
export const CREATE_COST_ESTIMATE = 40_000_000n;
const MAX_ATTEMPTS = 3;

class LaunchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const hourKey = (d = new Date()) => d.toISOString().slice(0, 13);

export async function processLaunch(d: WorkerDeps, launchId: string): Promise<void> {
  const launch = await d.prisma.launch.findUnique({ where: { id: launchId }, include: { coin: { include: { creator: true } } } });
  if (!launch || !launch.coin) return d.log("launch: not found", { launchId });
  if (launch.step !== "checking") {
    // A retried job after a crash: the reconciler owns anything already sent.
    return d.log("launch: already past checking", { launchId, step: launch.step });
  }
  const coin = launch.coin;

  try {
    // Admins can launch while launches are paused, as the API lets them: the owner's test launch.
    const settings = await getLaunchSettings(d.prisma);
    if (!settings.launchesOpen && !d.params.adminWallets.has(coin.creatorWallet)) throw new LaunchError("LAUNCHES_PAUSED", settings.reason ?? "Launches are paused for now");
    assertCanSend(d.sol, "launch.create");

    // Hourly spend cap for the launcher hot wallet (HANDOFF §9).
    const reserve = CREATE_COST_ESTIMATE + BigInt(d.sol.jitoTipLamports);
    const spendKey = KEYS.launcherSpend(hourKey());
    const spent = BigInt(await d.redis.incrby(spendKey, Number(reserve)));
    await d.redis.expire(spendKey, 7200);
    if (spent > d.params.launcherHourlyCapLamports) {
      await d.redis.decrby(spendKey, Number(reserve));
      await d.alerts.send("launcher-cap", "warn", "Launcher hourly spend cap reached; launches are being refused");
      throw new LaunchError("LAUNCHES_BUSY", "Launches are busy right now. Try again in a few minutes.");
    }

    // 1. Token metadata (Metaplex-style JSON, as pump-style launchpads use).
    const links = (coin.links ?? {}) as { x?: string; telegram?: string; website?: string };
    const meta = {
      name: coin.name,
      symbol: coin.ticker,
      description: coin.description,
      image: coin.imageUrl,
      ...(links.website ? { website: links.website } : {}),
      ...(links.telegram ? { telegram: links.telegram } : {}),
      ...(links.x ? { twitter: links.x } : {}),
      createdOn: "uspad.fun",
    };
    const metadataUri = await d.storage.put(`meta/${coin.id}.json`, Buffer.from(JSON.stringify(meta)), "application/json");

    // 2. Mint keypair: memory only. Only the public key is written down.
    const mint = Keypair.generate();
    const launcher = d.wallets.launcher();
    const { poolId } = poolAddresses(d.programs.launchLab, mint.publicKey);
    await d.prisma.coin.update({ where: { id: coin.id }, data: { metadataUri, mint: mint.publicKey.toBase58(), poolState: poolId.toBase58() } });
    await d.prisma.launch.update({ where: { id: launchId }, data: { mintPubkey: mint.publicKey.toBase58() } });

    const { platform } = await d.chain();
    let landedSig: string | null = null;
    let sentAny = false;
    let lastError = "The create didn't land";
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !landedSig; attempt++) {
      // A previous attempt may have landed late.
      if (await d.conn.getAccountInfo(mint.publicKey, "confirmed")) {
        landedSig = await createSignature(d.conn, mint.publicKey);
        break;
      }
      const { blockhash, lastValidBlockHeight } = await d.conn.getLatestBlockhash("confirmed");
      const useJito = d.sol.cluster === "mainnet-beta";
      const tx = createTransaction({
        programId: d.programs.launchLab,
        payer: launcher.publicKey,
        payerKeypair: launcher,
        creator: new PublicKey(coin.creatorWallet),
        globalConfig: d.sol.globalConfig,
        platformId: d.sol.platformConfig,
        platform,
        mint: mint.publicKey,
        mintKeypair: mint,
        name: coin.name,
        symbol: coin.ticker,
        uri: metadataUri,
        supply: new BN(LAUNCHLAB_DEFAULT_CURVE.supply.toString()),
        totalSellA: new BN(LAUNCHLAB_DEFAULT_CURVE.totalSellA.toString()),
        totalFundRaisingB: new BN(LAUNCHLAB_DEFAULT_CURVE.totalFundRaisingB.toString()),
        recentBlockhash: blockhash,
        cuPriceMicroLamports: useJito ? undefined : d.env.CU_PRICE_MICRO_LAMPORTS,
        tip: useJito ? { account: await d.jito.randomTipAccount(), lamports: d.sol.jitoTipLamports } : undefined,
      });
      const signature = signatureOf(tx);
      await d.txlog({ purpose: "launch.create", signer: "launcher", signature, coinId: coin.id });
      await d.prisma.launch.update({
        where: { id: launchId },
        data: { step: "bundling", signature, lastValidBlockHeight: BigInt(lastValidBlockHeight), attempts: { increment: 1 } },
      });

      // From here on the create may be on its way: only the chain can say it didn't land.
      sentAny = true;
      try {
        if (useJito) {
          const bundleId = await d.jito.sendBundle([Buffer.from(tx.serialize()).toString("base64")]);
          await d.prisma.launch.update({ where: { id: launchId }, data: { bundleId } });
          await d.prisma.signedTx.update({ where: { signature }, data: { bundleId } });
          const st = await d.jito.waitForBundle(bundleId, 60_000);
          // Jito's "Landed" is processed-level; wait for the cluster to confirm it.
          if (st?.status === "Landed" && (await confirmed(d.conn, signature))) landedSig = signature;
          else lastError = `bundle ${st?.status ?? "timed out"}`;
        } else {
          await d.conn.sendRawTransaction(tx.serialize(), { skipPreflight: false, maxRetries: 3 });
          const r = await d.conn.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed").catch((e: Error) => ({ value: { err: e.message } }));
          if (!r.value.err) landedSig = signature;
          else lastError = JSON.stringify(r.value.err);
        }
      } catch (e) {
        // A refused or failed send (e.g. Jito rate limit) doesn't end the attempts.
        lastError = e instanceof Error ? e.message : String(e);
      }
      // The bundle may still land after we stopped polling: check the chain before the next try.
      if (!landedSig && (await waitForMint(d.conn, mint.publicKey, 4000))) landedSig = await createSignature(d.conn, mint.publicKey);
      if (!landedSig) {
        d.log("launch: attempt failed", { launchId, attempt, error: lastError });
        await d.alerts.send(`jito-fail-${hourKey()}`, "warn", `Launch create attempt failed (${lastError})`, 900);
      }
    }
    if (!landedSig && sentAny) {
      // A create may still land until its blockhash expires: the reconciler decides then (audit).
      d.log("launch: not confirmed yet, left to the reconciler", { launchId, error: lastError });
      return;
    }
    if (!landedSig) throw new LaunchError("LAUNCH_FAILED", "The launch didn't land on chain. Nothing was created. Try again.");
    await markLanded(d, launchId, landedSig);
  } catch (e) {
    if (e instanceof LaunchError) return failLaunch(d, launchId, e.code, e.message);
    if (e instanceof MainnetDisabledError) return failLaunch(d, launchId, "LAUNCHES_PAUSED", "Launches aren't open yet");
    d.log("launch: unexpected error", { launchId, error: e instanceof Error ? e.message : String(e) });
    // Unknown state: if a create was sent, the reconciler decides once its blockhash expires.
    const l = await d.prisma.launch.findUnique({ where: { id: launchId } });
    if (l?.step === "checking") await failLaunch(d, launchId, "LAUNCH_FAILED", "The launch failed. Nothing was created. Try again.");
  }
}

/** The oldest signature touching the mint is its create (paged back to the beginning). */
async function createSignature(conn: Connection, mint: PublicKey): Promise<string> {
  let before: string | undefined;
  let oldest = "";
  for (let page = 0; page < 50; page++) {
    const sigs = await conn.getSignaturesForAddress(mint, { limit: 1000, before }, "confirmed");
    const ok = sigs.filter((s) => !s.err);
    if (ok.length) oldest = ok[ok.length - 1]!.signature;
    if (sigs.length < 1000) break;
    before = sigs[sigs.length - 1]!.signature;
  }
  return oldest;
}

async function confirmed(conn: Connection, signature: string, ms = 30_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const st = (await conn.getSignatureStatuses([signature]).catch(() => null))?.value[0];
    if (st?.err) return false;
    if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function waitForMint(conn: Connection, mint: PublicKey, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await conn.getAccountInfo(mint, "confirmed").catch(() => null)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

/** The create is on chain: the coin goes live and appears on the board. */
export async function markLanded(d: WorkerDeps, launchId: string, signature: string): Promise<void> {
  const launch = await d.prisma.launch.findUnique({ where: { id: launchId }, include: { coin: true } });
  if (!launch?.coin) return;
  const now = new Date();
  // Idempotent: the launch processor, the indexer and the reconciler may all get here (audit).
  const moved = await d.prisma.$transaction(async (tx) => {
    const l = await tx.launch.updateMany({ where: { id: launchId, step: { in: ["checking", "bundling"] } }, data: { step: "landed", signature } });
    if (l.count !== 1) return false;
    await tx.coin.updateMany({ where: { id: launch.coin!.id, status: "pending" }, data: { status: "live", createdSig: signature, launchedAt: now } });
    return true;
  });
  if (!moved) return;
  // Opening price from the empty curve (virtual reserves); the indexer takes over from the first trade.
  let priceSol = 0;
  const info = launch.coin.poolState ? await d.conn.getAccountInfo(new PublicKey(launch.coin.poolState), "confirmed").catch(() => null) : null;
  if (info) priceSol = poolPriceSol(decodePool(info.data));
  await d.prisma.coinStats.upsert({ where: { coinId: launch.coin.id }, create: { coinId: launch.coin.id, priceSol }, update: {} });
  await d.prisma.launch.update({ where: { id: launchId }, data: { step: "indexed" } });
  await publishLive(d.redis, { type: "launch", at: now.toISOString(), mint: launch.coin.mint!, ticker: launch.coin.ticker, imageUrl: launch.coin.imageUrl, name: launch.coin.name });
  d.log("launch: live", { launchId, coinId: launch.coin.id, signature });
}

/** Marks the launch failed and frees the coin's unique identity (ticker, picture, X account). */
export async function failLaunch(d: WorkerDeps, launchId: string, code: string, message: string): Promise<void> {
  const launch = await d.prisma.launch.findUnique({ where: { id: launchId }, include: { coin: true } });
  if (!launch) return;
  await d.prisma.$transaction(async (tx) => {
    const l = await tx.launch.updateMany({ where: { id: launchId, step: { in: ["checking", "bundling"] } }, data: { step: "failed", error: { code, message } } });
    if (l.count !== 1) return;
    const c = launch.coin;
    // Conditional, so a coin the indexer just marked live is never wiped (audit). The mint and pool
    // stay recorded: if the create lands after all, the indexer recognises it and alerts.
    if (c) {
      await tx.coin.updateMany({
        where: { id: c.id, status: "pending" },
        data: { status: "failed", tickerNorm: `~failed~${c.id}`, imageSha256: `~failed~${c.id}`, creatorXUserId: null, uploadId: null },
      });
    }
  });
  d.log("launch: failed", { launchId, code });
}

/**
 * Crash recovery, every minute. A create that was sent but not recorded either landed (the mint
 * exists) or can't land any more (its blockhash expired). Lost jobs are re-queued.
 */
export async function reconcileLaunches(d: WorkerDeps, requeue: (launchId: string) => Promise<void>): Promise<void> {
  const stale = new Date(Date.now() - 90_000);
  const bundling = await d.prisma.launch.findMany({ where: { step: "bundling", updatedAt: { lt: stale } }, include: { coin: true }, take: 50 });
  if (bundling.length) {
    const height = await d.conn.getBlockHeight("confirmed");
    for (const l of bundling) {
      const mint = l.coin?.mint ?? l.mintPubkey;
      if (mint && (await d.conn.getAccountInfo(new PublicKey(mint), "confirmed"))) await markLanded(d, l.id, await createSignature(d.conn, new PublicKey(mint)));
      else if (l.lastValidBlockHeight !== null && BigInt(height) > l.lastValidBlockHeight + 150n) await failLaunch(d, l.id, "LAUNCH_FAILED", "The launch didn't land on chain. Nothing was created. Try again.");
    }
  }
  const lost = await d.prisma.launch.findMany({ where: { step: "checking", createdAt: { lt: new Date(Date.now() - 5 * 60_000) } }, select: { id: true }, take: 50 });
  for (const l of lost) await requeue(l.id);
}
