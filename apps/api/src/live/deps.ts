/** Everything the live routes need, created once per process. The API holds no private keys. */
import { Queue, QueueEvents } from "bullmq";
import type { Redis } from "ioredis";
import type { Connection } from "@solana/web3.js";
import { prisma as defaultPrisma, type PrismaClient } from "@divvy/db";
import { loadParams, QUEUES, type ClaimJob, type DivvyParams, type LaunchJob } from "@divvy/shared";
import { bullConnection, createRedis, loadStorage, readPrices, type PriceCache, type Storage } from "@divvy/server";
import {
  connection,
  decodeGlobalConfig,
  decodePlatform,
  JupiterClient,
  loadSolanaEnv,
  programs,
  type GlobalConfigState,
  type PlatformState,
  type SolanaEnv,
} from "@divvy/solana/live";
import type { Env } from "../env";

export interface LiveDeps {
  env: Env;
  params: DivvyParams;
  prisma: PrismaClient;
  redis: Redis;
  storage: Storage;
  sol: SolanaEnv;
  conn: Connection;
  jupiter: JupiterClient;
  programs: ReturnType<typeof programs>;
  queues: { launch: Queue<LaunchJob>; claims: Queue<ClaimJob> };
  claimEvents: QueueEvents;
  /** Cached on-chain configs (they change only by an admin transaction). */
  chain(): Promise<{ global: GlobalConfigState; platform: PlatformState }>;
  prices(): Promise<PriceCache>;
  close(): Promise<void>;
}

export function createLiveDeps(env: Env, overrides: Partial<Pick<LiveDeps, "prisma" | "storage" | "conn">> = {}): LiveDeps {
  const redisUrl = env.REDIS_URL!;
  const redis = createRedis(redisUrl);
  const sol = loadSolanaEnv();
  const conn = overrides.conn ?? connection(sol);
  const bull = bullConnection(redisUrl);
  const queues = { launch: new Queue<LaunchJob>(QUEUES.launch, { connection: bull }), claims: new Queue<ClaimJob>(QUEUES.claims, { connection: bull }) };
  const claimEvents = new QueueEvents(QUEUES.claims, { connection: bullConnection(redisUrl) });
  let chainCache: { at: number; v: { global: GlobalConfigState; platform: PlatformState } } | null = null;
  let priceCache: { at: number; v: PriceCache } | null = null;

  return {
    env,
    params: loadParams(),
    prisma: overrides.prisma ?? defaultPrisma,
    redis,
    storage: overrides.storage ?? loadStorage(),
    sol,
    conn,
    jupiter: new JupiterClient(sol.jupBaseUrl, sol.jupApiKey),
    programs: programs(sol.cluster),
    queues,
    claimEvents,
    async chain() {
      if (chainCache && Date.now() - chainCache.at < 60_000) return chainCache.v;
      const [g, p] = await conn.getMultipleAccountsInfo([sol.globalConfig, sol.platformConfig]);
      if (!g || !p) throw new Error("LaunchLab GlobalConfig or Divvy PlatformConfig not found on chain");
      chainCache = { at: Date.now(), v: { global: decodeGlobalConfig(g.data), platform: decodePlatform(p.data) } };
      return chainCache.v;
    },
    async prices() {
      if (priceCache && Date.now() - priceCache.at < 10_000) return priceCache.v;
      const v = (await readPrices(redis)) ?? { solUsd: 0, byMint: {}, change24h: {}, at: 0 };
      priceCache = { at: Date.now(), v };
      return v;
    },
    async close() {
      await Promise.allSettled([queues.launch.close(), queues.claims.close(), claimEvents.close(), redis.quit(), bull.quit()]);
    },
  };
}
