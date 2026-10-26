import { Redis } from "ioredis";
import { KEYS, type LiveEvent } from "@divvy/shared";

export const createRedis = (url: string): Redis => new Redis(url, { maxRetriesPerRequest: 3, enableReadyCheck: true });

/** BullMQ needs its own connections with maxRetriesPerRequest = null. */
export const bullConnection = (url: string): Redis => new Redis(url, { maxRetriesPerRequest: null });

export async function publishLive(redis: Redis, e: LiveEvent): Promise<void> {
  await redis.publish(KEYS.liveChannel, JSON.stringify(e));
}

/** Subscribes on a dedicated connection; returns an unsubscribe function. */
export function subscribeLive(url: string, onEvent: (e: LiveEvent) => void): () => Promise<void> {
  const sub = new Redis(url);
  void sub.subscribe(KEYS.liveChannel);
  sub.on("message", (_ch, msg) => {
    try {
      onEvent(JSON.parse(msg) as LiveEvent);
    } catch {
      /* ignore malformed */
    }
  });
  return async () => {
    await sub.quit();
  };
}

export interface PriceCache {
  solUsd: number;
  /** USD per whole token, keyed by mint. */
  byMint: Record<string, number>;
  change24h: Record<string, number>;
  at: number;
}

export async function readPrices(redis: Redis): Promise<PriceCache | null> {
  const raw = await redis.get(KEYS.prices);
  return raw ? (JSON.parse(raw) as PriceCache) : null;
}

export async function writePrices(redis: Redis, p: PriceCache): Promise<void> {
  await redis.set(KEYS.prices, JSON.stringify(p), "EX", 3600);
}

/** Worker heartbeat and hot-wallet balances, read by the admin overview. */
export interface WorkerStatus {
  at: number;
  indexerSlot: number | null;
  indexerLagSec: number | null;
  wallets: { role: string; address: string; sol: number; lowBalance: boolean }[];
}

export async function readStatus(redis: Redis): Promise<WorkerStatus | null> {
  const raw = await redis.get(KEYS.status);
  return raw ? (JSON.parse(raw) as WorkerStatus) : null;
}

export async function writeStatus(redis: Redis, s: WorkerStatus): Promise<void> {
  await redis.set(KEYS.status, JSON.stringify(s), "EX", 600);
}
