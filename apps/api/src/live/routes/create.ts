import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { Prisma } from "@divvy/db";
import {
  checkImageFile,
  checkName,
  checkTicker,
  checkX,
  displayTicker,
  foldName,
  foldTicker,
  hamming,
  IMAGE_HAMMING_LIMIT,
  IMAGE_MAX_BYTES,
  imageCollision,
  imageOk,
  KEYS,
  LaunchRequestSchema,
  normalizeXHandle,
  type CheckResponse,
  type CheckResult,
  type LaunchStatus,
  type UploadResponse,
} from "@divvy/shared";
import { getLaunchSettings } from "@divvy/server";
import { sendCheckFailure, sendError } from "../../errors";
import { processImage } from "../../media";
import type { LiveDeps } from "../deps";
import { antiVampContexts, identityOf, invalidateBoard, invalidatePictures, pictureCandidates } from "../data";
import { refuseBlockedCountry, requireViewer } from "../viewer";

export async function runChecks(d: LiveDeps, q: { ticker?: string; name?: string; x?: string }): Promise<CheckResponse> {
  const ctx = await antiVampContexts(d);
  const out: CheckResponse = {};
  if (q.ticker !== undefined) {
    const { hit, reserved } = await ctx.ticker(foldTicker(q.ticker));
    out.ticker = checkTicker(q.ticker, { findByTickerNorm: () => hit, isReserved: () => reserved });
  }
  if (q.name !== undefined) {
    const candidates = await ctx.nameCandidates(q.name);
    out.name = checkName(q.name, { candidates: () => candidates });
  }
  if (q.x !== undefined) {
    const h = normalizeXHandle(q.x);
    const hit = h ? await ctx.xHandle(h) : undefined;
    out.x = checkX(q.x, { findByX: () => hit });
  }
  return out;
}

export async function checkPicture(d: LiveDeps, sha256: string, phash: string): Promise<CheckResult> {
  const rows = await pictureCandidates(d);
  const exact = rows.find((r) => r.imageSha256 === sha256);
  if (exact) return imageCollision(identityOf(exact), true);
  const near = rows.find((r) => hamming(r.imagePhash, phash) <= IMAGE_HAMMING_LIMIT);
  return near ? imageCollision(identityOf(near), false) : imageOk();
}

const Website = z.union([z.literal(""), z.string().url().max(200).refine((u) => /^https?:\/\//i.test(u), "http(s) only")]);
const Telegram = z.union([z.literal(""), z.string().regex(/^(?:https:\/\/)?t\.me\/[A-Za-z0-9_]{5,32}$|^@[A-Za-z0-9_]{5,32}$/)]);
const tgUrl = (t: string) => (!t ? null : t.startsWith("@") ? `https://t.me/${t.slice(1)}` : t.startsWith("https://") ? t : `https://${t}`);

/** Maps a unique-constraint race to the same error contract as the checks. */
function uniqueViolation(e: unknown): { code: string; message: string } | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const target = String((e.meta?.target as string[] | string | undefined) ?? "");
  if (target.includes("tickerNorm")) return { code: "TICKER_TAKEN", message: "That ticker was just taken" };
  if (target.includes("imageSha256") || target.includes("uploadId")) return { code: "IMAGE_DUPLICATE", message: "That picture was just used by another coin" };
  if (target.includes("creatorXUserId")) return { code: "X_TAKEN", message: "This X account already launched a coin" };
  return { code: "CONFLICT", message: "Something about this coin was just taken. Check the form again." };
}

type Reply = Parameters<typeof sendError>[0];

/** A refusal raised inside the launch transaction, answered after it rolls back. */
class Refusal extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly send?: (reply: Reply) => unknown,
  ) {
    super(message);
  }
}

/** The server-side launch checks: ticker, name, picture (uncached when invalidated) and asset. */
async function launchChecks(d: LiveDeps, b: { ticker: string; name: string; imageId: string; dividendAsset: string }, userId: string) {
  const checks = await runChecks(d, { ticker: b.ticker, name: b.name });
  if (checks.ticker!.status !== "ok") return { fail: (r: Reply) => sendCheckFailure(r, checks.ticker as CheckResult) } as const;
  if (checks.name!.status !== "ok") return { fail: (r: Reply) => sendCheckFailure(r, checks.name as CheckResult) } as const;
  const up = await d.prisma.upload.findUnique({ where: { id: b.imageId } });
  if (!up || up.ownerUserId !== userId) return { fail: (r: Reply) => sendError(r, 422, "IMAGE_EMPTY", "Upload a picture") } as const;
  const pic = await checkPicture(d, up.sha256, up.imagePhash);
  if (pic.status !== "ok") return { fail: (r: Reply) => sendCheckFailure(r, pic) } as const;
  const asset = await d.prisma.dividendAsset.findFirst({ where: { symbol: b.dividendAsset, enabled: true } });
  if (!asset) return { fail: (r: Reply) => sendError(r, 422, "ASSET_UNKNOWN", "Pick a stock from the list") } as const;
  return { fail: null, up, asset } as const;
}

/**
 * Free-launch abuse guard without X: at least LAUNCH_MIN_WALLET_LAMPORTS, and a first transaction
 * at least LAUNCH_MIN_WALLET_AGE_DAYS old (one RPC page; a wallet with 1,000+ transactions passes).
 */
async function fundedAndAged(d: LiveDeps, wallet: string): Promise<boolean> {
  const p = d.params;
  const owner = new PublicKey(wallet);
  const lamports = await d.conn.getBalance(owner).catch(() => 0);
  if (BigInt(lamports) < p.launchMinWalletLamports) return false;
  if (p.launchMinWalletAgeDays <= 0) return true;
  const sigs = await d.conn.getSignaturesForAddress(owner, { limit: 1000 }).catch(() => null);
  if (!sigs?.length) return false;
  if (sigs.length === 1000) return true;
  const first = sigs[sigs.length - 1]!.blockTime;
  return !!first && Date.now() / 1000 - first >= p.launchMinWalletAgeDays * 86_400;
}

export async function liveCreateRoutes(app: FastifyInstance, { d }: { d: LiveDeps }) {
  app.get("/api/check", { config: { rateLimit: { max: 240, timeWindow: "1 minute" } } }, async (req, reply) => {
    const q = z.object({ ticker: z.string().max(64).optional(), name: z.string().max(64).optional(), x: z.string().max(64).optional() }).safeParse(req.query);
    if (!q.success) return sendError(reply, 400, "BAD_QUERY", "That isn't a valid check");
    return runChecks(d, q.data);
  });

  app.post("/api/upload", { config: { rateLimit: { max: 30, timeWindow: "1 hour" } } }, async (req, reply): Promise<UploadResponse | void> => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    const file = await req.file({ limits: { fileSize: IMAGE_MAX_BYTES, files: 1 } });
    if (!file) return sendError(reply, 400, "IMAGE_MISSING", "Upload a picture");
    const buf = await file.toBuffer().catch(() => null);
    if (!buf || file.file.truncated) return sendError(reply, 413, "IMAGE_SIZE", "That file is over 8 MB");
    const gate = checkImageFile(file.mimetype, buf.length);
    if (gate) return sendCheckFailure(reply, gate);
    let img;
    try {
      img = await processImage(buf);
    } catch {
      return sendError(reply, 415, "IMAGE_TYPE", "Use a PNG, JPG, WEBP or GIF");
    }
    // Content-addressed key: the same picture always lands on the same object.
    const key = `img/${img.sha256.slice(0, 2)}/${img.sha256}.webp`;
    const url = await d.storage.put(key, img.webp, "image/webp");
    const row = await d.prisma.upload.create({
      data: { sha256: img.sha256, imagePhash: img.phash, url, storageKey: key, contentType: "image/webp", bytes: img.webp.length, ownerUserId: v.userId },
    });
    return { imageId: row.id, url, sha256: img.sha256, check: await checkPicture(d, img.sha256, img.phash) };
  });

  app.post("/api/launch", { config: { rateLimit: { max: 10, timeWindow: "1 hour" } } }, async (req, reply) => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    if (await refuseBlockedCountry(d, req, reply)) return;
    const settings = await getLaunchSettings(d.prisma);
    if (!settings.launchesOpen) return sendError(reply, 503, "LAUNCHES_PAUSED", settings.reason ?? "Launches are paused for now");

    const parsed = LaunchRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "BAD_REQUEST", "Some launch fields are missing or too long");
    const b = parsed.data;
    const web = Website.safeParse(b.website ?? "");
    const tg = Telegram.safeParse(b.telegram ?? "");
    if (!web.success) return sendError(reply, 422, "BAD_WEBSITE", "The website must be an http(s) link");
    if (!tg.success) return sendError(reply, 422, "BAD_TELEGRAM", "Use a t.me link or @group for Telegram");

    // One launch request per wallet at a time: concurrent requests would all pass the checks below.
    const lockKey = `divvy:launch-lock:${v.wallet}`;
    if ((await d.redis.set(lockKey, "1", "EX", 60, "NX")) !== "OK") return sendError(reply, 429, "LAUNCH_IN_PROGRESS", "A launch from this wallet is already on its way");
    try {
      const p = d.params;
      if (await d.redis.exists(KEYS.launchCooldown(v.wallet))) return sendError(reply, 429, "COOLDOWN", "Wait a couple of minutes between launches");

      // Abuse guard for free launches: a linked X account, or a funded wallet with some history.
      if (!v.xUserId && !(await fundedAndAged(d, v.wallet)))
        return sendError(
          reply,
          403,
          "NEEDS_X_OR_SOL",
          `Link your X account, or use a wallet that holds at least ${Number(p.launchMinWalletLamports) / 1e9} SOL and is ${p.launchMinWalletAgeDays} days old, to launch for free`,
        );

      // Quick answers before the locked transaction; the server re-checks everything inside it.
      const early = await launchChecks(d, b, v.userId);
      if (early.fail) return early.fail(reply);
      const { up, asset } = early;

      let launchId: string;
      try {
        launchId = await d.prisma.$transaction(
          async (tx) => {
            // Launches are serialised: the limits and the similarity checks (which no unique index can
            // express) see every launch committed before this one (HANDOFF §5 race safety).
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`;
            const dayStart = new Date(new Date().setUTCHours(0, 0, 0, 0));
            const [mine, all] = await Promise.all([
              tx.launch.count({ where: { userId: v.userId, createdAt: { gte: dayStart }, step: { not: "failed" } } }),
              tx.launch.count({ where: { createdAt: { gte: dayStart }, step: { not: "failed" } } }),
            ]);
            if (mine >= p.launchesPerWalletPerDay) throw new Refusal(429, "DAILY_LIMIT", `You can launch ${p.launchesPerWalletPerDay} coins a day`);
            if (all >= p.launchesPerDayGlobal) throw new Refusal(429, "GLOBAL_LIMIT", "Divvy hit today's launch limit. Try again tomorrow.");
            invalidatePictures();
            const again = await launchChecks(d, b, v.userId);
            if (again.fail) throw new Refusal(0, "", "", again.fail);
            // Unique indexes on tickerNorm, imageSha256, uploadId and creatorXUserId back this up.
            const coin = await tx.coin.create({
              data: {
                ticker: displayTicker(b.ticker),
                tickerNorm: foldTicker(b.ticker),
                name: b.name.trim(),
                nameNorm: foldName(b.name),
                description: b.description,
                imageUrl: up.url,
                imageSha256: up.sha256,
                imagePhash: up.imagePhash,
                uploadId: up.id,
                dividendAssetId: asset.id,
                creatorUserId: v.userId,
                creatorWallet: v.wallet,
                creatorXUserId: v.xUserId,
                status: "pending",
                links: { website: web.data || undefined, telegram: tgUrl(tg.data) ?? undefined, x: v.xHandle ? `https://x.com/${v.xHandle}` : undefined },
              },
            });
            const launch = await tx.launch.create({ data: { userId: v.userId, coinId: coin.id, step: "checking", request: b as unknown as Prisma.InputJsonValue } });
            return launch.id;
          },
          { timeout: 20_000, maxWait: 20_000 },
        );
      } catch (e) {
        if (e instanceof Refusal) return e.send ? e.send(reply) : sendError(reply, e.status, e.code, e.message);
        const u = uniqueViolation(e);
        if (u) return sendError(reply, 422, u.code, u.message);
        throw e;
      }
      await d.redis.set(KEYS.launchCooldown(v.wallet), "1", "EX", p.launchCooldownSec || 1);
      await d.queues.launch.add("create", { launchId }, { jobId: launchId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
      invalidatePictures();
      invalidateBoard();
      return reply.code(201).send({ launchId });
    } finally {
      await d.redis.del(lockKey);
    }
  });

  app.get<{ Params: { id: string } }>("/api/launch/:id", async (req, reply): Promise<LaunchStatus | void> => {
    if (!/^[a-z0-9]{20,40}$/.test(req.params.id)) return sendError(reply, 404, "LAUNCH_NOT_FOUND", "No such launch");
    const l = await d.prisma.launch.findUnique({ where: { id: req.params.id }, include: { coin: true } });
    if (!l || !l.coin) return sendError(reply, 404, "LAUNCH_NOT_FOUND", "No such launch");
    const out: LaunchStatus = { id: l.id, step: l.step, ticker: l.coin.ticker };
    // The mint is revealed only once the create has landed (HANDOFF §3.5).
    if ((l.step === "landed" || l.step === "indexed") && l.coin.mint) {
      out.mint = l.coin.mint;
      if (l.signature) out.signature = l.signature;
    }
    if (l.step === "failed") {
      const e = (l.error ?? {}) as { code?: string; message?: string };
      out.error = { code: e.code ?? "LAUNCH_FAILED", message: e.message ?? "The launch failed. Nothing was created.", collidesWith: null };
    }
    return out;
  });
}
