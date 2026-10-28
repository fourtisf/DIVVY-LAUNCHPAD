import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PublicKey } from "@solana/web3.js";
import { Prisma } from "@divvy/db";
import {
  checkImageFile,
  DEV_BUY_MAX_LAMPORTS,
  DEV_BUY_MIN_LAMPORTS,
  checkName,
  checkTicker,
  checkX,
  displayTicker,
  foldName,
  foldTicker,
  IMAGE_MAX_BYTES,
  imageOk,
  KEYS,
  LaunchRequestSchema,
  LaunchSignSchema,
  normalizeXHandle,
  xProfileUrl,
  type CheckResponse,
  type CheckResult,
  type LaunchStatus,
  type UploadResponse,
} from "@divvy/shared";
import { getLaunchSettings } from "@divvy/server";
import { createFits } from "@divvy/solana/live";
import { sendCheckFailure, sendError } from "../../errors";
import { processImage } from "../../media";
import type { LiveDeps } from "../deps";
import { invalidateBoard } from "../data";
import { CREATE_BALANCE_LAMPORTS, CREATE_COST_LAMPORTS, DEV_BUY_ACCOUNTS_LAMPORTS, launchFee } from "../launchfee";
import { getViewer, refuseBlockedCountry, requireViewer } from "../viewer";

/**
 * Coins may share a ticker, a name, a picture or an X account (owner decision 2026-10-27): only the
 * format rules refuse, and tickers already trading elsewhere with real volume (reserved).
 */
export async function runChecks(d: LiveDeps, q: { ticker?: string; name?: string; x?: string }): Promise<CheckResponse> {
  const out: CheckResponse = {};
  if (q.ticker !== undefined) {
    const reserved = !!(await d.prisma.reservedTicker.findUnique({ where: { tickerNorm: foldTicker(q.ticker) } }));
    out.ticker = checkTicker(q.ticker, { findByTickerNorm: () => undefined, isReserved: () => reserved });
  }
  if (q.name !== undefined) out.name = checkName(q.name, { candidates: () => [] });
  if (q.x !== undefined) out.x = checkX(q.x, { findByX: () => undefined });
  return out;
}

const Website = z.union([z.literal(""), z.string().url().max(200).refine((u) => /^https?:\/\//i.test(u), "http(s) only")]);
const Telegram = z.union([z.literal(""), z.string().regex(/^(?:https:\/\/)?t\.me\/[A-Za-z0-9_]{5,32}$|^@[A-Za-z0-9_]{5,32}$/)]);
const tgUrl = (t: string) => (!t ? null : t.startsWith("@") ? `https://t.me/${t.slice(1)}` : t.startsWith("https://") ? t : `https://${t}`);

/** Maps a unique-constraint race to the same error contract as the checks. */
function uniqueViolation(e: unknown): { code: string; message: string } | null {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== "P2002") return null;
  const target = String((e.meta?.target as string[] | string | undefined) ?? "");
  if (target.includes("uploadId")) return { code: "IMAGE_DUPLICATE", message: "That upload was just used by another coin. Upload the picture again." };
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
async function launchChecks(d: LiveDeps, b: { ticker: string; name: string; x: string; imageId: string; dividendAsset: string }, userId: string) {
  const checks = await runChecks(d, { ticker: b.ticker, name: b.name, x: b.x });
  if (checks.ticker!.status !== "ok") return { fail: (r: Reply) => sendCheckFailure(r, checks.ticker as CheckResult) } as const;
  if (checks.name!.status !== "ok") return { fail: (r: Reply) => sendCheckFailure(r, checks.name as CheckResult) } as const;
  if (checks.x!.status !== "ok") return { fail: (r: Reply) => sendCheckFailure(r, checks.x as CheckResult) } as const;
  const up = await d.prisma.upload.findUnique({ where: { id: b.imageId } });
  if (!up || up.ownerUserId !== userId) return { fail: (r: Reply) => sendError(r, 422, "IMAGE_EMPTY", "Upload a picture") } as const;
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
    const q = z.object({ ticker: z.string().max(64).optional(), name: z.string().max(64).optional(), x: z.string().max(200).optional() }).safeParse(req.query);
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
    return { imageId: row.id, url, sha256: img.sha256, check: imageOk() };
  });

  // Paid launches have no daily limit, so a creator can launch often; each one takes two calls (the
  // FEE_REQUIRED answer, then the call with the payment).
  app.post("/api/launch", { config: { rateLimit: { max: 60, timeWindow: "1 hour" } } }, async (req, reply) => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    if (await refuseBlockedCountry(d, req, reply)) return;
    const settings = await getLaunchSettings(d.prisma);
    // Admins can still launch while launches are paused: the owner's test launch before opening them
    // (deploy/mainnet/README.md, phase 4).
    if (!settings.launchesOpen && !v.isAdmin) return sendError(reply, 503, "LAUNCHES_PAUSED", settings.reason ?? "Launches are paused for now");

    const parsed = LaunchRequestSchema.safeParse(req.body);
    if (!parsed.success) return sendError(reply, 400, "BAD_REQUEST", "Some launch fields are missing or too long");
    const b = parsed.data;
    // The typed X link (checked in launchChecks: valid and unused), else a verified X account.
    const xHandle = normalizeXHandle(b.x) ?? v.xHandle ?? null;
    const web = Website.safeParse(b.website ?? "");
    const tg = Telegram.safeParse(b.telegram ?? "");
    if (!web.success) return sendError(reply, 422, "BAD_WEBSITE", "The website must be an http(s) link");
    if (!tg.success) return sendError(reply, 422, "BAD_TELEGRAM", "Use a t.me link or @group for Telegram");
    // The creator's dev buy, inside the create (owner decision 2026-10-28: no cap but the curve's own).
    const devBuy = BigInt(b.devBuyLamports);
    if (devBuy > 0n && devBuy < DEV_BUY_MIN_LAMPORTS) return sendError(reply, 422, "DEV_BUY_TOO_SMALL", `A dev buy starts at ${Number(DEV_BUY_MIN_LAMPORTS) / 1e9} SOL`);
    if (devBuy > DEV_BUY_MAX_LAMPORTS) return sendError(reply, 422, "DEV_BUY_TOO_BIG", `A dev buy can be up to ${Number(DEV_BUY_MAX_LAMPORTS) / 1e9} SOL: the curve fills at 85`);
    // Creator-paid launches (LAUNCH_FEE_LAMPORTS): the fee stands in for the free-launch limits. Admins
    // don't pay; the fee goes to the wallet they run.
    const paid = d.env.LAUNCH_FEE_LAMPORTS > 0n && !v.isAdmin;

    // One launch request per wallet at a time: concurrent requests would all pass the checks below.
    const lockKey = `divvy:launch-lock:${v.wallet}`;
    if ((await d.redis.set(lockKey, "1", "EX", 60, "NX")) !== "OK") return sendError(reply, 429, "LAUNCH_IN_PROGRESS", "A launch from this wallet is already on its way");
    try {
      const p = d.params;
      if (!paid && (await d.redis.exists(KEYS.launchCooldown(v.wallet)))) return sendError(reply, 429, "COOLDOWN", "Wait a couple of minutes between launches");

      // Abuse guard for free launches: a verified X account, or a funded wallet with some history. A typed
      // X link proves nothing, so it doesn't count. Admins are trusted.
      if (!paid && !v.xUserId && !v.isAdmin && !(await fundedAndAged(d, v.wallet))) {
        const wallet = `a wallet that holds at least ${Number(p.launchMinWalletLamports) / 1e9} SOL and is ${p.launchMinWalletAgeDays} days old`;
        const xOAuth = !!(d.env.X_CLIENT_ID && d.env.X_REDIRECT_URI);
        return sendError(reply, 403, "NEEDS_X_OR_SOL", xOAuth ? `Link your X account, or use ${wallet}, to launch for free` : `Use ${wallet} to launch for free`);
      }

      // Quick answers before the locked transaction; the server re-checks everything inside it.
      const early = await launchChecks(d, b, v.userId);
      if (early.fail) return early.fail(reply);
      const { up, asset } = early;
      // An earlier fee paid on its own, or a failed launch's, covers this launch: its create then carries none.
      const credit = paid ? await launchFee(d, v, b.feeSig) : null;
      const fee = credit && !credit.fail ? credit : null;
      // The creator's wallet pays for the create and the fee inside it: check it can before anything is
      // reserved (an RPC hiccup doesn't block the launch; the wallet's own check comes before signing).
      const feeDue = paid && !fee ? d.env.LAUNCH_FEE_LAMPORTS : 0n;
      if (devBuy > 0n) {
        // A long name in multi-byte characters can leave no room for the buy in the create. The chain
        // read is cached; without it the worker's own check still stops the launch before anything is sent.
        const platform = await d
          .chain()
          .then((c) => c.platform)
          .catch(() => null);
        const fits =
          !platform ||
          createFits({
            programId: d.programs.launchLab,
            globalConfig: d.sol.globalConfig,
            platformId: d.sol.platformConfig,
            platform,
            name: b.name.trim(),
            symbol: displayTicker(b.ticker),
            // The worker writes meta/<coin id>.json; coin ids are 25-character cuids.
            uri: d.storage.publicUrl(`meta/${"c".repeat(25)}.json`),
            devBuyLamports: devBuy,
            feeLamports: feeDue,
            tip: d.sol.cluster === "mainnet-beta",
          });
        if (!fits) return sendError(reply, 422, "DEV_BUY_TOO_LONG", "This name is too long to fit a dev buy in the create. Shorten it, or launch without a dev buy.");
      }
      const need = CREATE_BALANCE_LAMPORTS + feeDue + (devBuy > 0n ? devBuy + DEV_BUY_ACCOUNTS_LAMPORTS : 0n);
      const balance = await d.conn.getBalance(new PublicKey(v.wallet), "confirmed").catch(() => null);
      if (balance !== null && BigInt(balance) < need) {
        const parts = [
          feeDue > 0n ? `the ${Number(feeDue) / 1e9} SOL launch fee` : null,
          `about ${Number(CREATE_COST_LAMPORTS) / 1e9} SOL to create the coin`,
          devBuy > 0n ? `your ${Number(devBuy) / 1e9} SOL dev buy` : null,
        ].filter(Boolean);
        const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} plus ${parts[parts.length - 1]}` : parts[0];
        return sendError(reply, 402, "NOT_ENOUGH_SOL", `Your wallet needs at least ${Number(need) / 1e9} SOL to launch: ${list}.`);
      }

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
            if (!paid && mine >= p.launchesPerWalletPerDay) throw new Refusal(429, "DAILY_LIMIT", `You can launch ${p.launchesPerWalletPerDay} coins a day`);
            // One launch on its way per creator: a launch nobody signs holds a launcher slot for a few
            // minutes, so unsigned launches mustn't pile up (audit). Admins may test several at once.
            if (!v.isAdmin && (await tx.launch.count({ where: { userId: v.userId, step: { in: ["checking", "signing", "bundling"] } } })) > 0) {
              throw new Refusal(429, "LAUNCH_IN_PROGRESS", "Your last launch is still on its way. Approve it in your wallet, or wait a few minutes for it to finish.");
            }
            if (all >= p.launchesPerDayGlobal) throw new Refusal(429, "GLOBAL_LIMIT", "uspad hit today's launch limit. Try again tomorrow.");
            // On this transaction's connection: the lock holder must not wait for a second pooled
            // connection while other launches hold the rest waiting on the lock (audit).
            const again = await launchChecks({ ...d, prisma: tx as unknown as LiveDeps["prisma"] }, b, v.userId);
            if (again.fail) throw new Refusal(0, "", "", again.fail);
            // The unique index on uploadId backs this up: one upload, one coin.
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
                links: { website: web.data || undefined, telegram: tgUrl(tg.data) ?? undefined, x: xHandle ? xProfileUrl(xHandle) : undefined },
              },
            });
            const launch = await tx.launch.create({ data: { userId: v.userId, coinId: coin.id, step: "checking", request: b as unknown as Prisma.InputJsonValue } });
            if (fee) {
              const used = await tx.launchFee.updateMany({ where: { id: fee.id, launchId: null }, data: { launchId: launch.id } });
              if (used.count !== 1) throw new Refusal(409, "FEE_USED", "That payment already paid for a launch");
            }
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
      if (!paid) await d.redis.set(KEYS.launchCooldown(v.wallet), "1", "EX", p.launchCooldownSec || 1);
      await d.queues.launch.add("create", { launchId }, { jobId: launchId, attempts: 1, removeOnComplete: 1000, removeOnFail: 1000 });
      invalidateBoard();
      return reply.code(201).send({ launchId });
    } finally {
      await d.redis.del(lockKey);
    }
  });

  // Log lines for the signing step, once each (the page polls every 400 ms).
  const handedOver = new Set<string>();
  const withheld = new Set<string>();
  app.get<{ Params: { id: string } }>("/api/launch/:id", async (req, reply): Promise<LaunchStatus | void> => {
    if (!/^[a-z0-9]{20,40}$/.test(req.params.id)) return sendError(reply, 404, "LAUNCH_NOT_FOUND", "No such launch");
    const l = await d.prisma.launch.findUnique({ where: { id: req.params.id }, include: { coin: true } });
    if (!l || !l.coin) return sendError(reply, 404, "LAUNCH_NOT_FOUND", "No such launch");
    const out: LaunchStatus = { id: l.id, step: l.step, ticker: l.coin.ticker };
    // The create to sign names the mint: its creator alone gets it before the coin lands.
    if (l.step === "signing" && l.unsignedTx) {
      const v = await getViewer(d, req);
      if (v?.userId === l.userId) {
        out.tx = l.unsignedTx;
        if (!handedOver.has(l.unsignedTx)) {
          handedOver.add(l.unsignedTx);
          if (handedOver.size > 1000) handedOver.clear();
          req.log.info({ launchId: l.id }, "launch: create handed to its creator's wallet");
        }
      } else if (!withheld.has(l.id)) {
        // Once per launch: a creator whose page never gets the create can't approve it (debugging).
        withheld.add(l.id);
        if (withheld.size > 1000) withheld.clear();
        req.log.warn({ launchId: l.id, signedIn: !!v }, "launch: create withheld, the viewer isn't its creator");
      }
    }
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

  // The creator's wallet signed the create the worker handed over (or turned it down). The worker checks
  // the signature against the create's message before it adds the mint's and sends it.
  app.post<{ Params: { id: string } }>("/api/launch/:id/sign", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (req, reply) => {
    const v = await requireViewer(d, req, reply);
    if (!v) return;
    const b = LaunchSignSchema.safeParse(req.body);
    if (!b.success) return sendError(reply, 422, "BAD_SIGNATURE", "That isn't a signature");
    if ("signedTx" in b.data && !/^[A-Za-z0-9+/]+={0,2}$/.test(b.data.signedTx)) return sendError(reply, 422, "BAD_SIGNATURE", "That isn't a signed transaction");
    const l = await d.prisma.launch.findUnique({ where: { id: req.params.id } });
    if (!l || l.userId !== v.userId) return sendError(reply, 404, "LAUNCH_NOT_FOUND", "No such launch");
    const data = "signedTx" in b.data ? { creatorSigned: b.data.signedTx } : { signRefused: true };
    const done = await d.prisma.launch.updateMany({ where: { id: l.id, step: "signing" }, data });
    if (done.count !== 1) return sendError(reply, 409, "NOT_SIGNING", "This launch isn't waiting for a signature");
    return { ok: true };
  });
}
