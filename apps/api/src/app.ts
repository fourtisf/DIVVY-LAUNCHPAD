import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import websocket from "@fastify/websocket";
import { avatarSvg, IMAGE_MAX_BYTES, loadParams, phash64 } from "@divvy/shared";
import type { Env } from "./env";
import { sendError } from "./errors";
import { memoryKv, redisKv, type Kv } from "./kv";
import { createLiveDeps, type LiveDeps } from "./live/deps";
import { registerLive } from "./live";
import { grayPixels, sha256Hex } from "./media";
import { MockStore } from "./mock/store";
import { authRoutes, makeSessionLookup } from "./routes/auth";
import { createRoutes } from "./routes/create";
import { extrasRoutes } from "./routes/extras";
import { liveRoutes } from "./routes/live";
import { publicRoutes } from "./routes/public";
import { tradeRoutes } from "./routes/trade";

export interface BuildOptions {
  env: Env;
  /** Mock mode only. */
  store?: MockStore;
  kv?: Kv;
  /** Live mode only (tests inject their own). */
  live?: LiveDeps;
}

export async function buildApp({ env, store, kv, live }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.LOG_LEVEL === "silent" ? false : { level: env.LOG_LEVEL, redact: ["req.headers.cookie", "req.headers.authorization"] },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 0 } });
  await app.register(websocket);

  // State-changing requests must come from the web app's origin. SameSite=Lax cookies already stop
  // most cross-site requests; this closes the rest (e.g. multipart form posts).
  const allowedOrigin = new URL(env.WEB_ORIGIN).origin;
  app.addHook("onRequest", async (req, reply) => {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return;
    const o = req.headers.origin;
    if (o && o !== allowedOrigin) return sendError(reply, 403, "BAD_ORIGIN", "Requests must come from the Divvy app");
  });

  if (env.API_MODE === "live") {
    const d = live ?? createLiveDeps(env);
    await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute", redis: d.redis, nameSpace: "divvy-rl:" });
    await registerLive(app, d);
    return app;
  }

  // ---------- mock mode: deterministic demo data, no chain, no database ----------
  await app.register(rateLimit, { global: true, max: 600, timeWindow: "1 minute" });
  const s = store ?? new MockStore();
  const kv_ = kv ?? (env.REDIS_URL ? redisKv(env.REDIS_URL) : memoryKv());
  app.addHook("onClose", async () => kv_.close());

  // Fingerprint the demo coins' pictures so uploads of them are refused.
  for (const c of s.coins) {
    if (c.image.kind !== "svg") continue;
    const svg = Buffer.from(avatarSvg(c.image.seed));
    s.sha256s.set(c.ticker, sha256Hex(svg));
    s.phashes.set(c.ticker, phash64(await grayPixels(svg)));
  }

  const session = makeSessionLookup(s);
  const adminWallets = loadParams().adminWallets;
  await app.register(publicRoutes, { store: s });
  await app.register(createRoutes, { store: s, session });
  await app.register(authRoutes, { store: s, env, kv: kv_, session, adminWallets });
  await app.register(extrasRoutes, { store: s, session, adminWallets });
  await app.register(tradeRoutes, { store: s, session });
  await app.register(liveRoutes, { store: s });
  return app;
}
