import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Runs `fn` only if this process wins the lock, so a job fires once even with several workers.
 * Correctness still comes from the database (unique coin+hour); the lock just avoids duplicate work.
 */
export async function withLock<T>(redis: Redis, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const token = randomBytes(16).toString("hex");
  const ok = await redis.set(`divvy:lock:${key}`, token, "PX", ttlMs, "NX");
  if (ok !== "OK") return null;
  try {
    return await fn();
  } finally {
    // Release only our own lock.
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, `divvy:lock:${key}`, token);
  }
}
