import { createPublicKey, verify } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import BN from "bn.js";
import { Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { LAUNCHLAB_DEFAULT_CURVE } from "@divvy/solana";
import { createTransaction, CreateTooLargeError, programs, type PlatformState } from "@divvy/solana/live";
import {
  checkImageFile,
  checkName,
  checkTicker,
  checkX,
  DEV_BUY_TOO_LONG,
  devBuyEstimate,
  devBuyProblem,
  displayTicker,
  IMAGE_MAX_BYTES,
  imageOk,
  LaunchRequestSchema,
  LaunchSignSchema,
  type CheckResponse,
  type LaunchStatus,
  type UploadResponse,
} from "@divvy/shared";
import { sendCheckFailure, sendError } from "../errors";
import { processImage } from "../media";
import { ASSET, type MockCoin } from "../mock/data";
import { FEES } from "./public";
import { DEMO_WALLET, LAUNCH_STEP_MS, launchClock, type MockStore } from "../mock/store";
import type { SessionLookup } from "./auth";

const MAX_MOCK_UPLOADS = 500;

/**
 * The coin's create for a signed-in creator's wallet to sign, built like the worker builds it (mainnet
 * program, the curve, a Jito tip) and signed by its mint, so the page's checks and the wallet see the
 * real thing. Returned without signatures, as the API hands it over in live mode.
 */
function mockCreate(creator: PublicKey, ticker: string, name: string, devBuyLamports: bigint): { mint: string; unsigned: string } {
  const mint = Keypair.generate();
  const P = programs("mainnet-beta");
  const tx = createTransaction({
    programId: P.launchLab,
    payer: creator,
    creator,
    globalConfig: P.defaultGlobalConfig,
    platformId: Keypair.generate().publicKey,
    // createInstruction reads only these two flags of the PlatformConfig.
    platform: { restrictGlobalConfig: false, restrictCurveParam: false } as unknown as PlatformState,
    mint: mint.publicKey,
    mintKeypair: mint,
    name,
    symbol: ticker,
    uri: "https://uspad.fun/demo.json",
    supply: new BN(LAUNCHLAB_DEFAULT_CURVE.supply.toString()),
    totalSellA: new BN(LAUNCHLAB_DEFAULT_CURVE.totalSellA.toString()),
    totalFundRaisingB: new BN(LAUNCHLAB_DEFAULT_CURVE.totalFundRaisingB.toString()),
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    tip: { account: Keypair.generate().publicKey, lamports: 100_000 },
    devBuyLamports,
  });
  return { mint: mint.publicKey.toBase58(), unsigned: Buffer.from(new VersionedTransaction(tx.message).serialize()).toString("base64") };
}

const ED25519_SPKI = Buffer.from("302a300506032b6570032100", "hex");
/** Whether `b64` is the create `unsigned`, with a good signature from `creator` (the fee payer). */
function signedByCreator(b64: string, unsigned: string, creator: string): boolean {
  try {
    const back = VersionedTransaction.deserialize(Buffer.from(b64, "base64"));
    const ours = VersionedTransaction.deserialize(Buffer.from(unsigned, "base64"));
    const message = back.message.serialize();
    if (!Buffer.from(message).equals(Buffer.from(ours.message.serialize()))) return false;
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI, new PublicKey(creator).toBuffer()]), format: "der", type: "spki" });
    return verify(null, message, key, back.signatures[0]!);
  } catch {
    return false;
  }
}

const CheckQuery = z.object({ ticker: z.string().max(64).optional(), name: z.string().max(64).optional(), x: z.string().max(64).optional() });

export async function createRoutes(app: FastifyInstance, { store, session }: { store: MockStore; session: SessionLookup }) {
  app.get("/api/check", async (req, reply): Promise<CheckResponse | void> => {
    const q = CheckQuery.safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid check");
    const out: CheckResponse = {};
    if (q.data.ticker !== undefined) out.ticker = checkTicker(q.data.ticker, store.tickerCtx);
    if (q.data.name !== undefined) out.name = checkName(q.data.name, store.nameCtx);
    if (q.data.x !== undefined) out.x = checkX(q.data.x, store.xCtx);
    return out;
  });

  app.post("/api/upload", async (req, reply): Promise<UploadResponse | void> => {
    const file = await req.file({ limits: { fileSize: IMAGE_MAX_BYTES, files: 1 } });
    if (!file) return sendError(reply, 400, "IMAGE_MISSING", "Upload a picture");
    const buf = await file.toBuffer().catch(() => null);
    if (!buf || file.file.truncated) return sendError(reply, 413, "IMAGE_SIZE", "That file is over 8 MB");
    const gate = checkImageFile(file.mimetype, buf.length);
    if (gate) return sendCheckFailure(reply, gate);
    let processed;
    try {
      processed = await processImage(buf);
    } catch {
      return sendError(reply, 415, "IMAGE_TYPE", "Use a PNG, JPG, WEBP or GIF");
    }
    const id = store.newId();
    // Mock mode keeps uploads in memory: cap it. Images referenced by a launch are never evicted.
    if (store.uploads.size >= MAX_MOCK_UPLOADS) {
      const used = new Set([...store.launches.values()].map((l) => (l.coin.image.kind === "upload" ? l.coin.image.id : "")));
      for (const k of store.uploads.keys()) if (!used.has(k)) { store.uploads.delete(k); break; }
    }
    store.uploads.set(id, { id, buf: processed.webp, contentType: "image/webp", sha256: processed.sha256, phash: processed.phash, owner: session(req)?.wallet ?? null });
    return { imageId: id, url: `/api/media/upload/${id}`, sha256: processed.sha256, check: imageOk() };
  });

  app.post("/api/launch", async (req, reply) => {
    const body = LaunchRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, 400, "BAD_REQUEST", "Some launch fields are missing or too long");
    const b = body.data;
    // The server is the authority: every check runs again here, whatever the client showed.
    const tk = checkTicker(b.ticker, store.tickerCtx);
    if (tk.status !== "ok") return sendCheckFailure(reply, tk);
    const nm = checkName(b.name, store.nameCtx);
    if (nm.status !== "ok") return sendCheckFailure(reply, nm);
    const up = store.uploads.get(b.imageId);
    if (!up) return sendError(reply, 422, "IMAGE_EMPTY", "Upload a picture");
    const asset = ASSET[b.dividendAsset];
    if (!asset) return sendError(reply, 422, "ASSET_UNKNOWN", "Pick a stock from the list");
    const devBuy = BigInt(b.devBuyLamports);
    const devBad = devBuyProblem(devBuy);
    if (devBad) return sendError(reply, 422, devBad.code, devBad.message);

    const ticker = displayTicker(b.ticker);
    const wallet = session(req)?.wallet ?? DEMO_WALLET;
    const coin: MockCoin = {
      name: b.name.trim(),
      ticker,
      pays: b.dividendAsset,
      desc: b.description,
      mint: store.newMint(ticker),
      image: { kind: "upload", id: up.id },
      mcap: 2900,
      ath: 2900,
      progress: 0,
      graduated: false,
      createdAt: Date.now(),
      vol: 0,
      holders: 1,
      paidUsd: 0,
      ch: 0,
      creatorWallet: wallet,
      xHandle: null,
      links: { x: null, telegram: b.telegram || null, website: b.website || null },
      devBuy: devBuyEstimate(devBuy, FEES.tradeFeeBps).pct,
    };
    // A signed-in wallet signs its coin's create, as in live mode; the demo's walletless launch doesn't.
    // Built before anything is reserved: a name too long for the dev buy leaves nothing behind (audit).
    let sign: { creator: string; unsigned: string; signedAt: null; refused: boolean } | undefined;
    if (wallet !== DEMO_WALLET) {
      let c: ReturnType<typeof mockCreate>;
      try {
        c = mockCreate(new PublicKey(wallet), ticker, coin.name, devBuy);
      } catch (e) {
        if (e instanceof CreateTooLargeError) return sendError(reply, 422, "DEV_BUY_TOO_LONG", DEV_BUY_TOO_LONG);
        throw e;
      }
      coin.mint = c.mint;
      sign = { creator: wallet, unsigned: c.unsigned, signedAt: null, refused: false };
    }
    // Reserve the identity now so a second launch can't race this one (unique indexes do this in Postgres).
    store.sha256s.set(ticker, up.sha256);
    store.phashes.set(ticker, up.phash);
    const id = store.newId();
    store.launches.set(id, { id, startedAt: Date.now(), ticker, coin, indexed: false, sign });
    return reply.code(201).send({ launchId: id });
  });

  app.get<{ Params: { id: string } }>("/api/launch/:id", async (req, reply): Promise<LaunchStatus | void> => {
    store.tick();
    const l = store.launches.get(req.params.id);
    if (!l) return sendError(reply, 404, "LAUNCH_NOT_FOUND", "No such launch");
    if (l.sign?.refused) return { id: l.id, step: "failed", ticker: l.ticker, error: { code: "LAUNCH_CANCELLED", message: "You turned the launch down in your wallet. Nothing was charged.", collidesWith: null } };
    const clock = launchClock(l);
    let step: LaunchStatus["step"];
    if (l.indexed) step = "indexed";
    else if (clock === null) step = Date.now() - l.startedAt < LAUNCH_STEP_MS ? "checking" : "signing";
    else if (l.sign) step = Date.now() - clock < LAUNCH_STEP_MS ? "bundling" : "landed";
    else step = (["checking", "bundling", "landed"] as const)[Math.min(2, Math.floor((Date.now() - clock) / LAUNCH_STEP_MS))]!;
    const out: LaunchStatus = { id: l.id, step, ticker: l.ticker };
    // The create names the mint: only its creator gets it before the coin lands.
    if (step === "signing" && l.sign && session(req)?.wallet === l.sign.creator) out.tx = l.sign.unsigned;
    // The mint stays secret until the create lands (HANDOFF §3.5).
    if (step === "landed" || step === "indexed") {
      out.mint = l.coin.mint;
      out.signature = `mock-${l.id}`;
    }
    return out;
  });

  // The creator's wallet signed the create (or turned it down); checked against the create handed over.
  app.post<{ Params: { id: string } }>("/api/launch/:id/sign", async (req, reply) => {
    const l = store.launches.get(req.params.id);
    if (!l?.sign || session(req)?.wallet !== l.sign.creator) return sendError(reply, 404, "LAUNCH_NOT_FOUND", "No such launch");
    const b = LaunchSignSchema.safeParse(req.body);
    if (!b.success) return sendError(reply, 422, "BAD_SIGNATURE", "That isn't a signature");
    if (l.sign.signedAt !== null || l.sign.refused) return sendError(reply, 409, "NOT_SIGNING", "This launch isn't waiting for a signature");
    if ("refused" in b.data) l.sign.refused = true;
    else if (signedByCreator(b.data.signedTx, l.sign.unsigned, l.sign.creator)) l.sign.signedAt = Date.now();
    else return sendError(reply, 422, "BAD_SIGNATURE", "That isn't this create, signed by its creator");
    return { ok: true };
  });
}
