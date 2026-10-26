/** Everything the worker's jobs need, created once per process. Tests build their own with stubs. */
import type { Redis } from "ioredis";
import type { Connection, Keypair } from "@solana/web3.js";
import { prisma as defaultPrisma, type PrismaClient } from "@divvy/db";
import { loadParams, type DivvyParams } from "@divvy/shared";
import { createRedis, loadStorage, prismaTxLogger, readPrices, type PriceCache, type Storage } from "@divvy/server";
import {
  connection,
  decodeGlobalConfig,
  decodePlatform,
  JitoClient,
  JupiterClient,
  loadKeypair,
  loadSolanaEnv,
  programs,
  type GlobalConfigState,
  type PlatformState,
  type SolanaEnv,
  type TxLogger,
  type WalletRole,
} from "@divvy/solana/live";
import { createAlerts, type Alerts } from "./alerts";
import type { WorkerEnv } from "./env";

export type Log = (msg: string, extra?: Record<string, unknown>) => void;

export interface Wallets {
  launcher(): Keypair;
  payoutVault(): Keypair;
  feeClaimer(): Keypair;
}

export interface WorkerDeps {
  env: WorkerEnv;
  params: DivvyParams;
  prisma: PrismaClient;
  redis: Redis;
  storage: Storage;
  sol: SolanaEnv;
  conn: Connection;
  jito: JitoClient;
  jupiter: JupiterClient;
  programs: ReturnType<typeof programs>;
  alerts: Alerts;
  log: Log;
  txlog: TxLogger;
  wallets: Wallets;
  chain(): Promise<{ global: GlobalConfigState; platform: PlatformState }>;
  prices(): Promise<PriceCache>;
  close(): Promise<void>;
}

export const jsonLog: Log = (msg, extra = {}) =>
  console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));

/** Keys are loaded on first use, so a process only reads the keys of the roles it runs. */
export function lazyWallets(env: Pick<WorkerEnv, "LAUNCHER_KEYPAIR_PATH" | "PAYOUT_VAULT_KEYPAIR_PATH" | "FEE_CLAIMER_KEYPAIR_PATH">): Wallets {
  const cache = new Map<WalletRole, Keypair>();
  const get = (role: WalletRole, path: string | undefined) => {
    const hit = cache.get(role);
    if (hit) return hit;
    if (!path) throw new Error(`${role} keypair path is not configured`);
    const kp = loadKeypair(path, role);
    cache.set(role, kp);
    return kp;
  };
  return {
    launcher: () => get("launcher", env.LAUNCHER_KEYPAIR_PATH),
    payoutVault: () => get("payout_vault", env.PAYOUT_VAULT_KEYPAIR_PATH),
    feeClaimer: () => get("fee_claimer", env.FEE_CLAIMER_KEYPAIR_PATH),
  };
}

export function createWorkerDeps(env: WorkerEnv, log: Log = jsonLog): WorkerDeps {
  const redis = createRedis(env.REDIS_URL);
  const sol = loadSolanaEnv();
  const conn = connection(sol);
  let chainCache: { at: number; v: { global: GlobalConfigState; platform: PlatformState } } | null = null;
  return {
    env,
    params: loadParams(),
    prisma: defaultPrisma,
    redis,
    storage: loadStorage(),
    sol,
    conn,
    jito: new JitoClient(sol.jitoUrl, sol.jitoUuid),
    jupiter: new JupiterClient(sol.jupBaseUrl, sol.jupApiKey),
    programs: programs(sol.cluster),
    alerts: createAlerts({ redis, botToken: env.TELEGRAM_BOT_TOKEN, chatId: env.TELEGRAM_ALERT_CHAT_ID, log }),
    log,
    txlog: prismaTxLogger(defaultPrisma),
    wallets: lazyWallets(env),
    async chain() {
      if (chainCache && Date.now() - chainCache.at < 60_000) return chainCache.v;
      const [g, p] = await conn.getMultipleAccountsInfo([sol.globalConfig, sol.platformConfig]);
      if (!g || !p) throw new Error("LaunchLab GlobalConfig or Divvy PlatformConfig not found on chain");
      chainCache = { at: Date.now(), v: { global: decodeGlobalConfig(g.data), platform: decodePlatform(p.data) } };
      return chainCache.v;
    },
    async prices() {
      return (await readPrices(redis)) ?? { solUsd: 0, byMint: {}, change24h: {}, at: 0 };
    },
    async close() {
      await Promise.allSettled([redis.quit(), defaultPrisma.$disconnect()]);
    },
  };
}
