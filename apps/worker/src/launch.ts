/**
 * Launch pipeline (HANDOFF §3.1, §3.5). The API reserved the coin as a pending Coin; here we:
 *   1. write the token metadata JSON,
 *   2. generate the mint keypair in memory (only the public key is stored, never returned by the API
 *      until the create lands),
 *   3. build initialize_with_token_2022 paid by the creator's wallet, with uspad's launch fee and the
 *      Jito tip inside, and sign it with the mint,
 *   4. hand it to the creator's wallet to sign (owner decision 2026-10-27: the creator, not uspad, signs
 *      and pays, so explorers show them as the coin's dev). The wallet gets it without the mint's
 *      signature, so it can't go out without this process,
 *   5. send it ONLY as a Jito bundle on mainnet (devnet has no block engine, so devnet uses the RPC),
 *   6. confirm, then mark the coin live.
 * A failed launch frees its upload and X link so the user can try again; nothing is charged, since the
 * fee is in the create.
 */
import { createPublicKey, verify } from "node:crypto";
import BN from "bn.js";
import { ComputeBudgetProgram, Keypair, PublicKey, TransactionMessage, VersionedTransaction, type Connection } from "@solana/web3.js";
import { MINT_SIZE, TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { publishLive, getLaunchSettings } from "@divvy/server";
import { LAUNCHLAB_DEFAULT_CURVE } from "@divvy/solana";
import { assertCanSend, createTransaction, decodePool, MainnetDisabledError, poolAddresses, poolPriceSol, signatureOf } from "@divvy/solana/live";
import type { WorkerDeps } from "./deps";

/** Creates sent per launch (each needs the creator's signature). */
const MAX_ATTEMPTS = 3;
/** Rounds the creator may leave unapproved (each with a fresh blockhash) before the launch is given up. */
const MAX_SIGN_ROUNDS = 3;
/** How long one round waits for the creator's signature, and how often it looks (tests shorten them). */
export const signing = { waitMs: 60_000, pollMs: 500 };

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
    const creator = new PublicKey(coin.creatorWallet);
    const { poolId } = poolAddresses(d.programs.launchLab, mint.publicKey);
    // uspad's fee rides inside the create: none for admins, nor when an earlier payment covers this launch.
    const credited = await d.prisma.launchFee.findUnique({ where: { launchId } });
    const feeLamports = d.env.LAUNCH_FEE_LAMPORTS > 0n && !d.params.adminWallets.has(coin.creatorWallet) && !credited ? d.env.LAUNCH_FEE_LAMPORTS : 0n;
    await d.prisma.coin.update({ where: { id: coin.id }, data: { metadataUri, mint: mint.publicKey.toBase58(), poolState: poolId.toBase58() } });
    await d.prisma.launch.update({ where: { id: launchId }, data: { mintPubkey: mint.publicKey.toBase58(), feeLamports } });

    const { platform } = await d.chain();
    let landedSig: string | null = null;
    let sentAny = false;
    let lastError = "The create didn't land";
    let unapproved = 0;
    // The last create sent: if the launch stops before it is known to have landed, the reconciler
    // waits for this blockhash to expire before calling it failed.
    let sentHeight: number | null = null;
    /** Stops asking the wallet: an earlier create may still land, so the reconciler decides (audit). */
    const handOff = async () => {
      await d.prisma.launch.updateMany({ where: { id: launchId, step: "signing" }, data: { step: "bundling", lastValidBlockHeight: BigInt(sentHeight!), unsignedTx: null, creatorSigned: null } });
    };
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !landedSig; ) {
      // A previous attempt may have landed late.
      if (await mintCreated(d.conn, mint.publicKey)) {
        landedSig = await createSignature(d.conn, mint.publicKey);
        break;
      }
      const { blockhash, lastValidBlockHeight } = await d.conn.getLatestBlockhash("confirmed");
      const useJito = d.sol.cluster === "mainnet-beta";
      const tx = createTransaction({
        programId: d.programs.launchLab,
        payer: creator,
        creator,
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
        fee: feeLamports > 0n ? { to: new PublicKey(d.env.LAUNCH_FEE_WALLET!), lamports: feeLamports } : undefined,
      });

      // 4. The creator signs in their wallet.
      const signed = await creatorSigned(d, launchId, tx, mint, lastValidBlockHeight);
      if (signed === "refused") {
        // Turning down a later round doesn't stop a create already sent from landing (audit).
        if (sentAny) {
          await handOff();
          break;
        }
        throw new LaunchError("LAUNCH_CANCELLED", "You turned the launch down in your wallet. Nothing was charged.");
      }
      // A signature that came back after the blockhash expired can't land: ask again (audit).
      const late = signed && (await d.conn.getBlockHeight("confirmed")) > lastValidBlockHeight;
      if (!signed || late) {
        if (await mintCreated(d.conn, mint.publicKey)) continue; // an earlier attempt landed
        if (++unapproved >= MAX_SIGN_ROUNDS) {
          if (sentAny) {
            await handOff();
            break;
          }
          throw new LaunchError("LAUNCH_NOT_APPROVED", "The launch wasn't approved in your wallet in time. Nothing was charged. Try again.");
        }
        continue; // asked again, with a fresh blockhash
      }
      const create = signed;
      const signature = signatureOf(create);
      await d.txlog({ purpose: "launch.create", signer: "creator", signature, coinId: coin.id });
      // Conditional: a launch the indexer or the reconciler already settled is never sent again (audit).
      const moved = await d.prisma.launch.updateMany({
        where: { id: launchId, step: "signing" },
        data: { step: "bundling", signature, lastValidBlockHeight: BigInt(lastValidBlockHeight), attempts: { increment: 1 }, unsignedTx: null, creatorSigned: null },
      });
      if (moved.count !== 1) return d.log("launch: settled elsewhere while signing", { launchId });
      attempt++;
      sentHeight = lastValidBlockHeight;

      // From here on the create may be on its way: only the chain can say it didn't land.
      sentAny = true;
      try {
        if (useJito) {
          const bundleId = await d.jito.sendBundle([Buffer.from(create.serialize()).toString("base64")]);
          await d.prisma.launch.update({ where: { id: launchId }, data: { bundleId } });
          await d.prisma.signedTx.update({ where: { signature }, data: { bundleId } });
          const st = await d.jito.waitForBundle(bundleId, 60_000);
          // Jito's "Landed" is processed-level; wait for the cluster to confirm it.
          if (st?.status === "Landed" && (await confirmed(d.conn, signature))) landedSig = signature;
          else lastError = `bundle ${st?.status ?? "timed out"}`;
        } else {
          await d.conn.sendRawTransaction(create.serialize(), { skipPreflight: false, maxRetries: 3 });
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

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");

/** Whether `sig` is `signer`'s ed25519 signature over `message`. */
export function signedBy(signer: PublicKey, message: Uint8Array, sig: Uint8Array): boolean {
  try {
    return verify(null, message, createPublicKey({ key: Buffer.concat([ED25519_SPKI, signer.toBuffer()]), format: "der", type: "spki" }), sig);
  } catch {
    return false;
  }
}

/**
 * Hands the create to the creator's wallet (GET /api/launch/:id returns it to them alone, without the
 * mint's signature) and waits for it to come back signed. Returns the create to send, with the mint's
 * signature added: the same message, or one the wallet changed only by adding or adjusting compute
 * budget instructions (a priority fee), which the mint then signs. Null when no good signature came in
 * time or the launch moved on (an earlier attempt landed); "refused" when they turned it down.
 */
async function creatorSigned(d: WorkerDeps, launchId: string, tx: VersionedTransaction, mint: Keypair, lastValidBlockHeight: number): Promise<VersionedTransaction | "refused" | null> {
  const unsigned = Buffer.from(new VersionedTransaction(tx.message).serialize()).toString("base64");
  const asked = await d.prisma.launch.updateMany({
    where: { id: launchId, step: { in: ["checking", "signing", "bundling"] } },
    data: { step: "signing", unsignedTx: unsigned, creatorSigned: null, signRefused: false, lastValidBlockHeight: BigInt(lastValidBlockHeight) },
  });
  if (asked.count !== 1) return null; // settled elsewhere (landed or failed)
  const creator = tx.message.staticAccountKeys[0]!;
  const end = Date.now() + signing.waitMs;
  while (Date.now() < end) {
    const l = await d.prisma.launch.findUnique({ where: { id: launchId }, select: { step: true, creatorSigned: true, signRefused: true } });
    if (!l || l.step !== "signing") return null;
    // A signature wins over a refusal posted after it (a retried request whose answer was lost).
    if (l.creatorSigned) {
      const back = acceptSigned(l.creatorSigned, tx, creator, mint);
      if (back) return back;
      d.log("launch: the signed create isn't this create, or isn't signed by its creator", { launchId });
      // Only that one: a good signature posted meanwhile stays (audit).
      await d.prisma.launch.updateMany({ where: { id: launchId, creatorSigned: l.creatorSigned }, data: { creatorSigned: null } });
    }
    if (l.signRefused) return "refused";
    await new Promise((r) => setTimeout(r, signing.pollMs));
  }
  return null;
}

/** The create, with the creator's good signature on it, ready for the mint's; null for anything else. */
export function acceptSigned(b64: string, ours: VersionedTransaction, creator: PublicKey, mint: Keypair): VersionedTransaction | null {
  let back: VersionedTransaction;
  try {
    back = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
  } catch {
    return null;
  }
  const i = back.message.staticAccountKeys.findIndex((k) => k.equals(creator));
  const sig = i >= 0 && i < back.message.header.numRequiredSignatures ? back.signatures[i] : undefined;
  if (!sig || !signedBy(creator, back.message.serialize(), sig)) return null;
  if (Buffer.from(back.message.serialize()).equals(Buffer.from(ours.message.serialize()))) {
    ours.addSignature(creator, sig);
    return ours;
  }
  if (!sameCreate(back, ours)) return null;
  back.sign([mint]);
  return back;
}

/** Same payer, blockhash and instructions, compute budget instructions aside (a wallet's priority fee). */
function sameCreate(a: VersionedTransaction, b: VersionedTransaction): boolean {
  if (a.message.addressTableLookups.length || b.message.addressTableLookups.length) return false;
  const [x, y] = [a, b].map((t) => TransactionMessage.decompile(t.message));
  if (!x!.payerKey.equals(y!.payerKey) || x!.recentBlockhash !== y!.recentBlockhash) return false;
  const core = (m: TransactionMessage) => m.instructions.filter((ix) => !ix.programId.equals(ComputeBudgetProgram.programId));
  const [p, q] = [core(x!), core(y!)];
  return (
    p.length === q.length &&
    p.every((ix, n) => {
      const o = q[n]!;
      return (
        ix.programId.equals(o.programId) &&
        Buffer.from(ix.data).equals(Buffer.from(o.data)) &&
        ix.keys.length === o.keys.length &&
        ix.keys.every((k, j) => k.pubkey.equals(o.keys[j]!.pubkey) && k.isSigner === o.keys[j]!.isSigner && k.isWritable === o.keys[j]!.isWritable)
      );
    })
  );
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

/**
 * Whether the create landed: the mint exists as a Token-2022 mint. Anyone who knows the address (the
 * creator does, from the create they sign) can send it lamports, which makes a bare system account
 * there; that isn't a coin (audit).
 */
export async function mintCreated(conn: Connection, mint: PublicKey): Promise<boolean> {
  const info = await conn.getAccountInfo(mint, "confirmed");
  return !!info && info.owner.equals(TOKEN_2022_PROGRAM_ID) && info.data.length >= MINT_SIZE;
}

async function waitForMint(conn: Connection, mint: PublicKey, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await mintCreated(conn, mint).catch(() => false)) return true;
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
    const l = await tx.launch.updateMany({ where: { id: launchId, step: { in: ["checking", "signing", "bundling"] } }, data: { step: "landed", signature, unsignedTx: null } });
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
    const l = await tx.launch.updateMany({ where: { id: launchId, step: { in: ["checking", "signing", "bundling"] } }, data: { step: "failed", error: { code, message }, unsignedTx: null } });
    if (l.count !== 1) return;
    // A paid launch's fee becomes the creator's credit for their next launch (apps/api/src/live/launchfee.ts).
    await tx.launchFee.updateMany({ where: { launchId }, data: { launchId: null } });
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
      if (mint && (await mintCreated(d.conn, new PublicKey(mint)))) await markLanded(d, l.id, await createSignature(d.conn, new PublicKey(mint)));
      else if (l.lastValidBlockHeight !== null && BigInt(height) > l.lastValidBlockHeight + 150n) await failLaunch(d, l.id, "LAUNCH_FAILED", "The launch didn't land on chain. Nothing was created. Try again.");
    }
  }
  // Waiting for a signature for 5 minutes means the worker that held the mint key stopped: an earlier
  // create may still have landed (its blockhash expired long ago), otherwise nothing can go out any more.
  const unsigned = await d.prisma.launch.findMany({ where: { step: "signing", updatedAt: { lt: new Date(Date.now() - 5 * 60_000) } }, include: { coin: true }, take: 50 });
  for (const l of unsigned) {
    const mint = l.coin?.mint ?? l.mintPubkey;
    if (mint && (await mintCreated(d.conn, new PublicKey(mint)))) await markLanded(d, l.id, await createSignature(d.conn, new PublicKey(mint)));
    else await failLaunch(d, l.id, "LAUNCH_FAILED", "The launch stopped before it was sent. Nothing was charged. Try again.");
  }
  const lost = await d.prisma.launch.findMany({ where: { step: "checking", createdAt: { lt: new Date(Date.now() - 5 * 60_000) } }, select: { id: true }, take: 50 });
  for (const l of lost) await requeue(l.id);
}
