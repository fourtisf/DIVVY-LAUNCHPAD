import Fastify, { type FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { avatarSvg, IMAGE_MAX_BYTES, phash64 } from "@divvy/shared";
import type { Env } from "./env";
import { memoryKv, redisKv, type Kv } from "./kv";
import { grayPixels, sha256Hex } from "./media";
import { MockStore } from "./mock/store";
import { authRoutes, makeSessionLookup } from "./routes/auth";
import { createRoutes } from "./routes/create";
import { liveRoutes } from "./routes/live";
import { publicRoutes } from "./routes/public";
import { tradeRoutes } from "./routes/trade";

export interface BuildOptions {
  env: Env;
  store?: MockStore;
  kv?: Kv;
}

export async function buildApp({ env, store = new MockStore(), kv }: BuildOptions): Promise<FastifyInstance> {
  const app = Fastify({
    logger: env.LOG_LEVEL === "silent" ? false : { level: env.LOG_LEVEL, redact: ["req.headers.cookie", "req.headers.authorization"] },
    trustProxy: true,
    bodyLimit: 64 * 1024,
  });
  const kv_ = kv ?? (env.REDIS_URL ? redisKv(env.REDIS_URL) : memoryKv());
  app.addHook("onClose", async () => kv_.close());

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: IMAGE_MAX_BYTES, files: 1, fields: 0 } });
  await app.register(websocket);

  // Fingerprint the demo coins' pictures so uploads of them are refused.
  for (const c of store.coins) {
    if (c.image.kind !== "svg") continue;
    const svg = Buffer.from(avatarSvg(c.image.seed));
    store.sha256s.set(c.ticker, sha256Hex(svg));
    store.phashes.set(c.ticker, phash64(await grayPixels(svg)));
  }

  const session = makeSessionLookup(store);
  await app.register(publicRoutes, { store: store });
  await app.register(createRoutes, { store: store, session });
  await app.register(authRoutes, { store: store, env, kv: kv_, session });
  await app.register(tradeRoutes, { store: store, session });
  await app.register(liveRoutes, { store: store });
  return app;
}
