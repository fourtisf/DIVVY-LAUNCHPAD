/**
 * Short-lived keys (SIWS nonces now; rate limits later). Redis when REDIS_URL is set, otherwise an
 * in-process map, which is only correct for a single API process.
 */
import { Redis } from "ioredis";

export interface Kv {
  setNonce(nonce: string, value: string, ttlSec: number): Promise<void>;
  /** Returns the value and deletes it in one step, so a nonce can only be used once. */
  takeNonce(nonce: string): Promise<string | null>;
  close(): Promise<void>;
  readonly kind: "redis" | "memory";
}

export function redisKv(url: string): Kv {
  const redis = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 2 });
  const key = (n: string) => `divvy:siws:${n}`;
  return {
    kind: "redis",
    async setNonce(n, v, ttl) {
      await redis.set(key(n), v, "EX", ttl);
    },
    async takeNonce(n) {
      return redis.getdel(key(n));
    },
    async close() {
      await redis.quit();
    },
  };
}

export function memoryKv(): Kv {
  const m = new Map<string, { v: string; exp: number }>();
  return {
    kind: "memory",
    async setNonce(n, v, ttl) {
      m.set(n, { v, exp: Date.now() + ttl * 1000 });
    },
    async takeNonce(n) {
      const e = m.get(n);
      m.delete(n);
      return e && e.exp > Date.now() ? e.v : null;
    },
    async close() {
      m.clear();
    },
  };
}
