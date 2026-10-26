import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  checkImageFile,
  checkName,
  checkTicker,
  checkX,
  displayTicker,
  hamming,
  IMAGE_HAMMING_LIMIT,
  IMAGE_MAX_BYTES,
  imageCollision,
  imageOk,
  LaunchRequestSchema,
  type CheckResponse,
  type CheckResult,
  type LaunchStatus,
  type UploadResponse,
} from "@divvy/shared";
import { sendCheckFailure, sendError } from "../errors";
import { processImage } from "../media";
import { ASSET, type MockCoin } from "../mock/data";
import { DEMO_WALLET, LAUNCH_STEP_MS, type MockStore } from "../mock/store";
import type { SessionLookup } from "./auth";

const MAX_MOCK_UPLOADS = 500;

const CheckQuery = z.object({ ticker: z.string().max(64).optional(), name: z.string().max(64).optional(), x: z.string().max(64).optional() });

/** Picture check against every live coin: exact SHA-256 first, then pHash distance. */
function checkPicture(store: MockStore, sha256: string, phash: string): CheckResult {
  const coins = store.allCoins();
  for (const c of coins) {
    if (store.sha256s.get(c.ticker) === sha256) return imageCollision(store.identity(c), true);
  }
  for (const c of coins) {
    const h = store.phashes.get(c.ticker);
    if (h && hamming(h, phash) <= IMAGE_HAMMING_LIMIT) return imageCollision(store.identity(c), false);
  }
  return imageOk();
}

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
    return { imageId: id, url: `/api/media/upload/${id}`, sha256: processed.sha256, check: checkPicture(store, processed.sha256, processed.phash) };
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
    const pic = checkPicture(store, up.sha256, up.phash);
    if (pic.status !== "ok") return sendCheckFailure(reply, pic);
    const asset = ASSET[b.dividendAsset];
    if (!asset) return sendError(reply, 422, "ASSET_UNKNOWN", "Pick a stock from the list");

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
    };
    // Reserve the identity now so a second launch can't race this one (unique indexes do this in Postgres).
    store.sha256s.set(ticker, up.sha256);
    store.phashes.set(ticker, up.phash);
    const id = store.newId();
    store.launches.set(id, { id, startedAt: Date.now(), ticker, coin, indexed: false });
    return reply.code(201).send({ launchId: id });
  });

  app.get<{ Params: { id: string } }>("/api/launch/:id", async (req, reply): Promise<LaunchStatus | void> => {
    store.tick();
    const l = store.launches.get(req.params.id);
    if (!l) return sendError(reply, 404, "LAUNCH_NOT_FOUND", "No such launch");
    const k = Math.floor((Date.now() - l.startedAt) / LAUNCH_STEP_MS);
    const step = l.indexed ? "indexed" : (["checking", "bundling", "landed"] as const)[Math.min(2, k)]!;
    const out: LaunchStatus = { id: l.id, step, ticker: l.ticker };
    // The mint stays secret until the create lands (HANDOFF §3.5).
    if (step === "landed" || step === "indexed") {
      out.mint = l.coin.mint;
      out.signature = `mock-${l.id}`;
    }
    return out;
  });
}
