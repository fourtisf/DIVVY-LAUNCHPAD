import { randomBytes } from "node:crypto";
import type { Redis } from "ioredis";

/**
 * Runs `fn` only if this process wins the lock, so a job fires once even with several workers.
 * The lock is extended while `fn` runs, so a run longer than `ttlMs` keeps it (a crashed process
 * releases it within `ttlMs`). Correctness still comes from the database (unique keys and
 * conditional updates); the lock avoids duplicate work.
 */
export async function withLock<T>(redis: Redis, key: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  const token = randomBytes(16).toString("hex");
  const k = `divvy:lock:${key}`;
  const ok = await redis.set(k, token, "PX", ttlMs, "NX");
  if (ok !== "OK") return null;
  const renew = setInterval(() => {
    void redis
      .eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end", 1, k, token, String(ttlMs))
      .catch(() => {});
  }, Math.max(1000, Math.floor(ttlMs / 3)));
  try {
    return await fn();
  } finally {
    clearInterval(renew);
    // Release only our own lock.
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, k, token);
  }
}
