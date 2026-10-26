import type { FastifyInstance } from "fastify";
import { redisKv } from "../kv";
import type { LiveDeps } from "./deps";
import { liveAdminRoutes } from "./routes/admin";
import { liveAuthRoutes } from "./routes/auth";
import { liveCreateRoutes } from "./routes/create";
import { liveWsRoutes } from "./routes/live";
import { livePublicRoutes } from "./routes/public";
import { liveTradeRoutes } from "./routes/trade";

export async function registerLive(app: FastifyInstance, d: LiveDeps) {
  const kv = redisKv(d.env.REDIS_URL!);
  app.addHook("onClose", async () => {
    await kv.close();
    await d.close();
  });
  await app.register(livePublicRoutes, { d });
  await app.register(liveCreateRoutes, { d });
  await app.register(liveAuthRoutes, { d, kv });
  await app.register(liveTradeRoutes, { d });
  await app.register(liveAdminRoutes, { d });
  await app.register(liveWsRoutes, { d });
}
